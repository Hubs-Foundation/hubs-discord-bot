// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");

const discord = require('discord.js');
const phoenix = require("phoenix-channels");
const { ChannelBindings } = require("./bindings.js");
const { PresenceQueue } = require("./presence-queue.js");
const { ReticulumClient } = require("./reticulum.js");

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// Formats a message of the form "Alice, Bob, and Charlie verbed."
function formatEvent(users, verb) {
  if (users.length === 1) {
    return `${users[0].name} ${verb}.`;
  } else {
    return `${users.slice(0, -1).map(u => u.name).join(", ")} and ${users[users.length - 1].name} ${verb}.`;
  }
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

async function updateBindings(reticulumClient, bindings, discordCh, prevHubId, currHubId, currHubUrl) {
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
          discordCh.send("I found a Hubs URL in the topic, but no webhook exists in this channel yet, so it won't work.");
        }
        return;
      }
      bindings.associate(currHubId, currHubUrl, discordCh, reticulumCh, webhook);
      discordCh.send(`<#${discordCh.id}> bound to hub at ${currHubUrl}.`);

      const presenceQueue = new PresenceQueue();
      let lastPresenceMessage = null;
      presenceQueue.on('new', async ({ kind, users }) => {
        if (kind === "arrive") {
          lastPresenceMessage = await discordCh.send(formatEvent(users, "arrived"));
        } else if (kind === "depart") {
          lastPresenceMessage = await discordCh.send(formatEvent(users, "departed"));
        }
      });
      presenceQueue.on('update', async ({ kind, users }) => {
        if (kind === "arrive") {
          lastPresenceMessage = await lastPresenceMessage.edit(formatEvent(users, "arrived"));
        } else if (kind === "depart") {
          lastPresenceMessage = await lastPresenceMessage.edit(formatEvent(users, "departed"));
        }
      });
      reticulumCh.on('join', (id, kind, whom) => {
        if (VERBOSE) {
          console.debug(ts(`Relaying join for ${whom} (${id}) in ${currHubId} to channel ${discordCh.id}.`));
        }
        presenceQueue.arrive(id, whom, Date.now());
      });
      reticulumCh.on('leave', (id, kind, whom) => {
        if (VERBOSE) {
          console.debug(ts(`Relaying leave for ${whom} (${id}) in ${currHubId} to channel ${discordCh.id}.`));
        }
        presenceQueue.depart(id, whom, Date.now());
      });
      reticulumCh.on('rescene', (id, whom, scene) => {
        if (VERBOSE) {
          console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${currHubId} to channel ${discordCh.id}.`));
        }
        discordCh.send(`${whom} (${id}) changed the scene in ${currHubUrl} to ${scene.name}.`);
      });
      reticulumCh.on("message", (id, whom, type, body) => {
        if (VERBOSE) {
          const msg = ts(`Relaying message of type ${type} from ${whom} (${id}) via ${currHubId} to channel ${discordCh.id}: %j`);
          console.debug(msg, body);
        }
        if (type === "spawn") {
          webhook.send(body.src, { username: whom });
        } else if (type === "chat") {
          webhook.send(body, { username: whom });
        } else if (type === "media") {
          // don't bother with media that is "boring", i.e. vendored by us, like chats, ducks, avatars, pens
          if (!body.src.startsWith("https://asset-bundles-prod.reticulum.io")) {
            webhook.send(body.src, { username: whom });
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
    const { url: hubUrl, id: hubId } = bindings.getHub(chan.topic) || {};
    if (hubId) {
      await updateBindings(reticulumClient, bindings, chan, null, hubId, hubUrl);
    }
  }

  discordClient.on('channelUpdate', (oldChannel, newChannel) => {
    const oldHubId = bindings.hubsByChannel[oldChannel.id];
    const { url: newHubUrl, id: newHubId } = bindings.getHub(newChannel.topic) || {};
    updateBindings(reticulumClient, bindings, newChannel, oldHubId, newHubId, newHubUrl);
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
