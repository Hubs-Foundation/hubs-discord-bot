// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");

const discord = require('discord.js');
const { ChannelBindings, HubState } = require("./bindings.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { buildUrlRegex, ReticulumClient } = require("./reticulum.js");

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// Formats a message of the form "Alice, Bob, and Charlie verbed."
function formatEvent(users, verb) {
  if (users.length === 1) {
    return `**${users[0].name}** ${verb}.`;
  } else {
    return `**${users.slice(0, -1).map(u => u.name).join(", ")}** and **${users[users.length - 1].name}** ${verb}.`;
  }
}

// Returns a promise indicating when the Discord client is connected and ready to query the API.
async function connectToDiscord(client, token) {
  return new Promise((resolve, reject) => {
    client.on("ready", () => resolve(client));
    client.login(token).catch(e => reject(e));
  });
}

// Gets the canonical Hubs webhook to post messages through for a Discord channel.
async function getHubsWebhook(discordCh) {
  const hooks = await discordCh.fetchWebhooks();
  const hook = hooks.find(h => h.name === process.env.HUBS_HOOK) || hooks.first(); // todo: should we do this .first?
  if (!hook) {
    if (VERBOSE) {
      console.debug(ts(`Discord channel ${discordCh.id} has a Hubs link in the topic, but no webhook is present.`));
      discordCh.send("I found a Hubs URL in the topic, but no webhook exists in this channel yet, so it won't work.");
    }
    return null;
  }
  return hook;
}

function establishBindings(reticulumCh, discordCh, webhook, state) {
  console.info(ts(`Hubs room ${state.id} bound to Discord channel ${discordCh.id}; joining.`));
  const presenceRollups = new PresenceRollups();
  let lastPresenceMessage = null;
  presenceRollups.on('new', ({ kind, users }) => {
    if (kind === "arrive") {
      lastPresenceMessage = webhook.send(formatEvent(users, "joined"));
    } else if (kind === "depart") {
      lastPresenceMessage = webhook.send(formatEvent(users, "left"));
    }
  });
  presenceRollups.on('update', ({ kind, users }) => {
    if (kind === "arrive") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, "joined")));
    } else if (kind === "depart") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, "left")));
    }
  });
  reticulumCh.on('join', (id, kind, whom) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying join for ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    presenceRollups.arrive(id, whom, Date.now());
  });
  reticulumCh.on('leave', (id, kind, whom) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying leave for ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    presenceRollups.depart(id, whom, Date.now());
  });
  reticulumCh.on('rescene', (id, whom, scene) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    webhook.send(`${whom} changed the scene in [${state.name}](${state.url}) to ${scene.name}.`);
  });
  reticulumCh.on('rename', (id, whom, name, slug) => {
    state.name = name;
    state.slug = slug;
    if (VERBOSE) {
      console.debug(ts(`Relaying name change by ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    webhook.send(`${whom} renamed the hub to [${state.name}](${state.url}).`);
  });
  reticulumCh.on("message", (id, whom, type, body) => {
    if (VERBOSE) {
      const msg = ts(`Relaying message of type ${type} from ${whom} (${id}) via ${state.id} to channel ${discordCh.id}: %j`);
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

  // one-time scan through all channels to look for existing bindings
  const bindings = new ChannelBindings();
  const topicRegex = buildUrlRegex(hostnames);
  for (let [_, chan] of discordClient.channels.filter(ch => ch.type === "text")) {
    const [_url, host, id, _slug] = (chan.topic || "").match(topicRegex) || [];
    if (id) {
      try {
        const { hub, subscription } = await reticulumClient.subscribeToHub(id);
        const webhook = await getHubsWebhook(chan);
        if (webhook) {
          const state = new HubState(host, hub.hub_id, hub.name, hub.slug);
          bindings.associate(subscription, chan, webhook, state, host);
          establishBindings(subscription, chan, webhook, state);
        }
      } catch (e) {
        console.error(ts(`Failed to subscribe to hub ${id}:`), e);
      }
    }
  }

  discordClient.on('channelUpdate', async (oldChannel, newChannel) => {
    const prevHubId = bindings.hubsByChannel[oldChannel.id];
    const [currHubUrl, host, currHubId, _slug] = (newChannel.topic || "").match(topicRegex) || [];
    if (prevHubId !== currHubId) {
      if (prevHubId) {
        console.info(ts(`Hubs room ${prevHubId} no longer bound to Discord channel ${oldChannel.id}; leaving.`));
        bindings.bindingsByHub[prevHubId].reticulumCh.close();
        bindings.dissociate(prevHubId);
      }
      if (currHubId) {
        try {
          const { hub, subscription } = await reticulumClient.subscribeToHub(currHubId);
          const webhook = await getHubsWebhook(newChannel);
          if (webhook) {
            const state = new HubState(host, hub.hub_id, hub.name, hub.slug);
            bindings.associate(subscription, newChannel, webhook, state, host);
            establishBindings(subscription, newChannel, webhook, state);
            webhook.send(`<#${newChannel.id}> bound to [${state.name}](${state.url}).`);
          }
        } catch (e) {
          console.error(ts(`Failed to subscribe to hub ${currHubId}:`), e);
        }
      }
    }
  });

  discordClient.on('message', msg => {
    if (msg.content === '!hubs duck') {
      msg.channel.send('Quack :duck:');
      return;
    }
    if (msg.channel.id in bindings.hubsByChannel) {
      const hubId = bindings.hubsByChannel[msg.channel.id];
      const binding = bindings.bindingsByHub[hubId];

      if (msg.content === '!hubs users') {
        const users = binding.reticulumCh.getUsers();
        const description = users.join(", ");
        binding.webhook.send(`Users currently in [${binding.hubState.name}](${binding.hubState.url}): **${description}**`);
        return;
      }

      if (msg.author.id === discordClient.user.id) {
        return;
      }
      if (msg.webhookID === binding.webhook.id) {
        return;
      }
      if (VERBOSE) {
        console.debug(ts(`Relaying message via channel ${msg.channel.id} to hub ${hubId}: ${msg.content}`));
      }
      binding.reticulumCh.sendMessage(msg.author.username, msg.content);
    }
  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
