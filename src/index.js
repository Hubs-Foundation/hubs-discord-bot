// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");

const discord = require('discord.js');
const phoenix = require("phoenix-channels");
const ChannelBindings = require("./bindings.js").ChannelBindings;
const ReticulumClient = require("./reticulum.js").ReticulumClient;

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

async function connectToDiscord(client, token) {
  return new Promise((resolve, reject) => {
    client.on("ready", () => resolve(client));
    client.login(token).catch(e => reject(e));
  });
}

// Gets the canonical Hubs webhook to post messages through for a Discord channel.
async function getHubsWebhook(discordCh) {
  return (await discordCh.fetchWebhooks()).first(); // todo: pretty unprincipled to do .first
}

async function updateBindings(reticulumClient, bindings, discordCh, prevHubId, currHubId) {
  if (prevHubId !== currHubId) {
    if (prevHubId) {
      console.info(ts(`Hubs room ${prevHubId} no longer bound to Discord channel ${discordCh.id}; leaving.`));
      bindings.stateByHub[prevHubId].reticulumCh.close();
      bindings.dissociate(prevHubId);
    }
    if (currHubId) {
      console.info(ts(`Hubs room ${currHubId} bound to Discord channel ${discordCh.id}; joining.`));
      const webhook = await getHubsWebhook(discordCh);
      const reticulumCh = await reticulumClient.subscribeToHub(currHubId);
      if (!webhook) {
        if (VERBOSE) {
          console.debug(ts(`Discord channel ${discordCh.id} has a Hubs link in the topic, but no webhook is present.`));
        }
        return;
      }
      bindings.associate(currHubId, discordCh, reticulumCh, webhook);
      reticulumCh.on('join', (id, kind, name) => {
        if (kind === 'room') {
          if (VERBOSE) {
            console.debug(ts(`Relaying join for ${name} via hub ${currHubId} to channel ${discordCh.id}.`));
          }
          discordCh.send(`${name} joined.`);
        }
      });
      reticulumCh.on('leave', (id, kind, name) => {
        if (kind === 'room') {
          if (VERBOSE) {
            console.debug(ts(`Relaying leave for ${name} via hub ${currHubId} to channel ${discordCh.id}.`));
          }
          discordCh.send(`${name} departed.`);
        }
      });
      reticulumCh.on("message", (id, name, type, body) => {
        if (VERBOSE) {
          const msg = ts(`Relaying message of type ${type} from ${name} (session ID ${id}) via hub ${currHubId} to channel ${discordCh.id}: %j`);
          console.debug(msg, body);
        }
        if (type === "spawn") {
          webhook.send({ username: name, files: [{ attachment: body.src, name: "photo.png" }] });
        } else if (type === "chat") {
          webhook.send(body, { username: name });
        } else if (type === "media") {
          // don't bother with media that is "boring", i.e. vendored by us, like chats, ducks, avatars, pens
          if (!body.src.startsWith("https://asset-bundles-prod.reticulum.io")) {
            webhook.send(body.src, { username: name });
          }
        }
      });
    }
  }
}

async function start() {

  const shardId = parseInt(process.env.SHARD_ID, 10);
  const shardCount = parseInt(process.env.SHARD_COUNT, 10);
  const discordClient = new discord.Client({ shardId, shardCount });
  await connectToDiscord(discordClient, process.env.TOKEN);
  console.info(ts(`Connected to Discord (shard ID: ${shardId}/${shardCount})...`));

  const reticulumHost = process.env.RETICULUM_HOST;
  const reticulumClient = new ReticulumClient(reticulumHost);
  await reticulumClient.connect();
  console.info(ts(`Connected to Reticulum (${reticulumHost}; session ID: ${reticulumClient.socket.params.session_id}).`));

  const hostnames = process.env.HUBS_HOSTS.split(",");
  console.info(ts(`Binding to channels with Hubs hosts: ${hostnames.join(", ")}`));

  const bindings = new ChannelBindings(hostnames);
  for (let [cid, chan] of discordClient.channels.filter(ch => ch.type === "text")) {
    const hubId = bindings.getHub(chan.topic);
    if (hubId) {
      await updateBindings(reticulumClient, bindings, chan, null, hubId);
    }
  }

  discordClient.on('channelUpdate', (oldChannel, newChannel) => {
    const oldHubId = bindings.hubsByChannel[oldChannel.id];
    const newHubId = bindings.getHub(newChannel.topic);
    updateBindings(reticulumClient, bindings, newChannel, oldHubId, newHubId);
  });

  discordClient.on('message', msg => {
    if (msg.content === '!hubs duck') {
      msg.channel.send('Quack :duck:');
      return;
    }
    if (msg.content === '!hubs users') {
      const hubId = bindings.hubsByChannel[msg.channel.id];
      const hubState = bindings.stateByHub[hubId];
      const users = hubState.reticulumCh.getUsers();
      const description = users.join(", ");
      msg.channel.send(`Users currently in hub ${hubId}: ${description}`);
      return;
    }
    if (msg.channel.id in bindings.hubsByChannel) {
      const hubId = bindings.hubsByChannel[msg.channel.id];
      const hubState = bindings.stateByHub[hubId];
      if (msg.author.id === discordClient.user.id) {
        return;
      }
      if (msg.webhookID === hubState.webhook.id) {
        return;
      }
      if (VERBOSE) {
        console.debug(ts(`Relaying message via channel ${msg.channel.id} to hub ${hubId}: ${msg.content}`));
      }
      hubState.reticulumCh.sendMessage(msg.author.username, msg.content);
    }
  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
