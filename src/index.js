// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");

const discord = require('discord.js');
const { ChannelBindings, HubState } = require("./bindings.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// Formats a message indicating that the user formerly known as `prev` is now known as `curr`.
function formatRename(user) {
  return `**${user.prevName}** changed their name to **${user.name}**.`;
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

// Either sets the topic to something new, or complains that we didn't have the permissions.
async function trySetTopic(discordCh, newTopic) {
  return discordCh.setTopic(newTopic).catch(e => {
    if (!e instanceof discord.DiscordAPIError) {
      throw e;
    } else {
      discordCh.send("I don't seem to have permission to set the topic of the channel.");
    }
  });
}

function establishBindings(reticulumCh, discordCh, webhook, state) {
  console.info(ts(`Hubs room ${state.id} bound to Discord channel ${discordCh.id}; joining.`));
  const presenceRollups = new PresenceRollups();
  let lastPresenceMessage = null;
  presenceRollups.on('new', ({ kind, users }) => {
    if (kind === "arrive") {
      lastPresenceMessage = discordCh.send(formatEvent(users, "joined"));
    } else if (kind === "depart") {
      lastPresenceMessage = discordCh.send(formatEvent(users, "left"));
    } else if (kind === "rename") {
      lastPresenceMessage = discordCh.send(formatRename(users[0]));
    }
  });
  presenceRollups.on('update', ({ kind, users }) => {
    if (kind === "arrive") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, "joined")));
    } else if (kind === "depart") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, "left")));
    } else if (kind === "rename") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatRename(users[0])));
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
  reticulumCh.on('renameuser', (id, kind, prev, curr) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying rename from ${prev} to ${curr} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    presenceRollups.rename(id, prev, curr, Date.now());
  });
  reticulumCh.on('rescene', (id, whom, scene) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    discordCh.send(`${whom} changed the scene in [${state.name}](${state.url}) to ${scene.name}.`);
  });
  reticulumCh.on('renamehub', (id, whom, name, slug) => {
    state.name = name;
    state.slug = slug;
    if (VERBOSE) {
      console.debug(ts(`Relaying name change by ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    discordCh.send(`${whom} renamed the hub to [${state.name}](${state.url}).`);
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

  const bindings = new ChannelBindings();
  const topicManager = new TopicManager(hostnames);

  // one-time scan through all channels to look for existing bindings
  for (let [_, chan] of discordClient.channels.filter(ch => ch.type === "text")) {
    const [_url, host, id, _slug] = topicManager.matchHub(chan.topic || "") || [];
    if (id) {
      try {
        const { hub, subscription } = await reticulumClient.subscribeToHub(id);
        const webhook = await getHubsWebhook(chan);
        if (webhook) {
          const state = new HubState(host, hub.hub_id, hub.name, hub.slug, new Date());
          bindings.associate(subscription, chan, webhook, state, host);
          establishBindings(subscription, chan, webhook, state);
        }
      } catch (e) {
        console.error(ts(`Failed to subscribe to hub ${id}:`), e);
      }
    }
  }

  discordClient.on('channelUpdate', async (oldChannel, newChannel) => {
    console.log("%j %j", oldChannel, newChannel);
    const prevHubId = bindings.hubsByChannel[oldChannel.id];
    const [currHubUrl, host, currHubId, _slug] = topicManager.matchHub(newChannel.topic || "") || [];
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
            const state = new HubState(host, hub.hub_id, hub.name, hub.slug, new Date());
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

  discordClient.on('message', async msg => {
    const args = msg.content.split(' ');
    const discordCh = msg.channel;

    // echo normal chat messages into the hub, if we're bound to a hub
    if (args[0] !== "!hubs") {
      if (discordCh.id in bindings.hubsByChannel) {
        const hubId = bindings.hubsByChannel[discordCh.id];
        const binding = bindings.bindingsByHub[hubId];
        // don't echo our own messages
        if (msg.author.id === discordClient.user.id) {
          return;
        }
        if (msg.webhookID === binding.webhook.id) {
          return;
        }
        if (VERBOSE) {
          console.debug(ts(`Relaying message via channel ${discordCh.id} to hub ${hubId}: ${msg.content}`));
        }
        binding.reticulumCh.sendMessage(msg.author.username, msg.content);
      }
      return;
    }

    switch (args[1]) {

    case undefined:
    case "status":
      // "!hubs" == "!hubs status" == emit useful info about the current bot and hub state
      if (discordCh.id in bindings.hubsByChannel) {
        const hubId = bindings.hubsByChannel[discordCh.id];
        const binding = bindings.bindingsByHub[hubId];
        discordCh.send(
          `I am the Hubs Discord bot, linking to any hubs I see on ${hostnames.join(", ")}.\n\n` +
            `🦆 <#${discordCh.id}> bound to hub ${binding.hubState.name} (${binding.hubState.id}) at <${binding.hubState.url}>.\n` +
            `🦆 ${binding.webhook ? `Bridging chat using the webhook "${binding.webhook.name}" (${binding.webhook.id}).` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n` +
            `🦆 Connected since ${binding.hubState.ts.toISOString()}.\n\n`
        );
      } else {
        const webhook = await getHubsWebhook(msg.channel);
        discordCh.send(
          `I am the Hubs Discord bot, linking to any hubs I see on ${hostnames.join(", ")}.\n\n` +
            `🦆 This channel isn't bound to any hub. Use !hubs create or add a Hubs link to the topic to bind.\n` +
            `🦆 ${webhook ? `The webhook "${webhook.name}" (${webhook.id}) will be used for bridging chat.` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n`
        );
      }
      return;

    case "bind":
      // "!hubs bind" == if no hub is already bound, bind one and put it in the topic
      if (topicManager.matchHub(discordCh.topic)) {
        discordCh.send("A hub is already bound in the topic, so I am cowardly refusing to replace it.");
        return;
      }

      // valid options:
      //
      // !hubs bind [hub URL] -- bind the given existing hub URL
      // !hubs bind [scene URL] [name] -- create and bind a new hub

      if (args.length == 2) { // !hubs bind
        const { url: hubUrl } = await reticulumClient.createHub(discordCh.name.trimStart("#"));
        await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
        return;
      }

      const hub = topicManager.matchHub(args[2]);
      if (hub) { // !hubs bind [hub URL]
        const [hubUrl, ..._rest] = hub;
        await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
        return;
      }

      const scene = topicManager.matchScene(args[2]);
      if (scene) { // !hubs bind [scene URL] [name]
        const [_url, _host, sceneId, ..._rest] = scene;
        const name = args[3] || discordCh.name.trimStart("#");
        const { url: hubUrl } = await reticulumClient.createHub(name, sceneId);
        await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
        return;
      }

      // todo: help output?
      return;

    case "unbind":
      // "!hubs unbind" == if a hub is bound, remove it
      if (!topicManager.matchHub(discordCh.topic)) {
        discordCh.send("No hub is bound in the topic, so doing nothing :eyes:");
        return;
      }

      await trySetTopic(discordCh, topicManager.removeHub(discordCh.topic));
      return;

    default:
      // todo: help output?:
      return;

    }

  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
