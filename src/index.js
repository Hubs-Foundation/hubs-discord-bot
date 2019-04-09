// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");
const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const MEDIA_DEDUPLICATE_MS = 60 * 1000;

const discord = require('discord.js');
const { ChannelBindings, HubState } = require("./bindings.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");

// Serializes invocations of the tasks in the queue. Used to ensure that we completely finish processing
// a single Discord event before processing the next one, e.g. we don't interleave work from a user command
// and from a channel topic update, or from two channel topic updates in quick succession.
class DiscordEventQueue {

  constructor() {
    this.curr = Promise.resolve();
  }

  // Enqueues the given function to run as soon as no other functions are currently running.
  enqueue(fn) {
    return this.curr = this.curr.then(_ => fn());
  }

}

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
  return hooks.find(h => h.name === process.env.HUBS_HOOK) || hooks.first(); // todo: should we do this .first?
}

// Either sets the topic to something new, or complains that we didn't have the permissions.
async function trySetTopic(discordCh, newTopic) {
  return discordCh.setTopic(newTopic).catch(e => {
    if (!(e instanceof discord.DiscordAPIError)) {
      throw e;
    } else {
      discordCh.send(`I don't seem to have "manage channel" permission in this channel, so I can't change the topic.`);
    }
  });
}

function subscribeToEvents(binding) {
  const { reticulumCh, discordCh, hubState: state } = binding;
  console.info(ts(`Hubs room ${state.id} bound to Discord channel ${discordCh.id}; joining.`));
  const presenceRollups = new PresenceRollups();
  const mediaBroadcasts = {}; // { url: timestamp }
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
    discordCh.send(`${whom} changed the scene in ${state.url} to ${scene.name}.`);
  });
  reticulumCh.on('renamehub', (id, whom, name, slug) => {
    state.name = name;
    state.slug = slug;
    if (VERBOSE) {
      console.debug(ts(`Relaying name change by ${whom} (${id}) in ${state.id} to channel ${discordCh.id}.`));
    }
    discordCh.send(`${whom} renamed the hub at ${state.url} to ${state.name}.`);
  });
  reticulumCh.on("message", (id, whom, type, body) => {
    const webhook = binding.webhook; // note that this may change over the lifetime of the binding
    if (webhook == null) {
      if (VERBOSE) {
        console.debug(`Ignoring message of type ${type} in channel ${discordCh.id} because no webhook is associated.`);
      }
      return;
    }
    if (VERBOSE) {
      const msg = ts(`Relaying message of type ${type} from ${whom} (${id}) via ${state.id} to channel ${discordCh.id}: %j`);
      console.debug(msg, body);
    }
    if (type === "chat") {
      webhook.send(body, { username: whom });
    } else if (type === "media") {
      // we really like to deduplicate media broadcasts of the same object in short succession,
      // mostly because of the case where people are repositioning pinned media, but also because
      // sometimes people will want to clone a bunch of one thing and pin them all in one go
      const timestamp = Date.now();
      const lastBroadcast = mediaBroadcasts[body.src];
      if (lastBroadcast != null) {
        const elapsedMs = timestamp - lastBroadcast;
        if (elapsedMs <= MEDIA_DEDUPLICATE_MS) {
          if (VERBOSE) {
            console.debug(ts(`Declining to rebroadcast ${body.src} so soon after previous broadcast.`));
          }
          return;
        }
      }
      mediaBroadcasts[body.src] = timestamp;
      webhook.send(body.src, { username: whom });
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
  console.info(ts(`Connected to Reticulum (${reticulumHost}; session ID: ${JSON.stringify(reticulumClient.socket.params().session_id)}).`));

  const bindings = new ChannelBindings();
  const topicManager = new TopicManager(HOSTNAMES);
  const q = new DiscordEventQueue();

  // one-time scan through all channels to look for existing bindings
  console.info(ts(`Monitoring channels for Hubs hosts: ${HOSTNAMES.join(", ")}`));
  for (let [_, chan] of discordClient.channels.filter(ch => ch.type === "text")) {
    q.enqueue(async () => {
      const { hubUrl, hubId } = topicManager.matchHub(chan.topic) || {};
      if (hubUrl) {
        try {
          const { hub, subscription } = await reticulumClient.subscribeToHub(hubId, chan.name);
          const webhook = await getHubsWebhook(chan);
          const state = new HubState(hubUrl.host, hub.hub_id, hub.name, hub.slug, new Date());
          const binding = bindings.associate(subscription, chan, webhook, state, hubUrl.host);
          subscribeToEvents(binding);
        } catch (e) {
          console.error(ts(`Failed to subscribe to ${hubUrl}:`), e);
        }
      }
    });
  }

  discordClient.on('webhookUpdate', (discordCh) => {
    q.enqueue(async () => {
      const hubId = bindings.hubsByChannel[discordCh.id];
      const binding = bindings.bindingsByHub[hubId];
      const oldWebhook = binding.webhook;
      const newWebhook = await getHubsWebhook(discordCh);
      if (oldWebhook != null && newWebhook == null) {
        await discordCh.send("Webhook disabled; Hubs will no longer bridge chat. Re-add a channel webhook to re-enable bridging.");
      } else if (newWebhook != null && (oldWebhook == null || newWebhook.id !== oldWebhook.id)) {
        await discordCh.send(`The webhook "${newWebhook.name}" (${newWebhook.id}) will now be used for bridging chat in Hubs.`);
      }
      binding.webhook = newWebhook;
    });
  });

  discordClient.on('channelUpdate', (oldChannel, newChannel) => {
    q.enqueue(async () => {
      console.log("channelupdate");
      const prevHubId = bindings.hubsByChannel[oldChannel.id];
      const { hubUrl: currHubUrl, hubId: currHubId } = topicManager.matchHub(newChannel.topic) || {};
      if (prevHubId !== currHubId) {
        try {
          if (prevHubId) {
            console.info(ts(`Hubs room ${prevHubId} no longer bridged to Discord channel ${oldChannel.id}; leaving.`));
            const { hubState, reticulumCh } = bindings.bindingsByHub[prevHubId];
            await reticulumCh.close();
            bindings.dissociate(prevHubId);
            await newChannel.send(`<#${newChannel.id}> no longer bridged to <${hubState.url}>.`);
          }
          if (currHubId) {
            const { hub, subscription } = await reticulumClient.subscribeToHub(currHubId, newChannel.name);
            const webhook = await getHubsWebhook(newChannel);
            const state = new HubState(currHubUrl.host, hub.hub_id, hub.name, hub.slug, new Date());
            const binding = bindings.associate(subscription, newChannel, webhook, state, currHubUrl.host);
            subscribeToEvents(binding);
            if (webhook != null) {
              await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}.`);
            } else {
              await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}. No webhook is present, so bridging won't work. Add a channel webhook to enable bridging.`);
            }
          }
        } catch (e) {
          console.error(ts(`Failed to update channel bridging from ${prevHubId} to ${currHubId}:`), e);
        }
      }
    });
  });

  const HELP_TEXT = "Bot command usage:\n\n" +
        "🦆 `!hubs create` - Creates a default Hubs room and puts its URL into the channel topic. " +
        "A room URL in the channel topic will be bridged between Hubs and Discord.\n" +
        "🦆 `!hubs create [scene URL] [name]` - Creates a new room with the given scene and name, and puts its URL into the channel topic.\n" +
        "🦆 `!hubs status` - Shows general information about the Hubs integration with the current Discord channel.\n" +
        "🦆 `!hubs remove` - Removes the room URL from the topic and stops bridging this Discord channel with Hubs.\n" +
        "🦆 `!hubs users` - Lists the users currently in the Hubs room bridged to this channel.\n\n" +
        "See the documentation and source at https://github.com/MozillaReality/hubs-discord-bot for a more detailed reference " +
        "of bot functionality, including guidelines on what permissions the bot needs, what kinds of bridging the bot can do, " +
        "and more about how the bot bridges channels to rooms.";

  discordClient.on('message', msg => {
    q.enqueue(async () => {
      const args = msg.content.split(' ');
      const discordCh = msg.channel;
      const guildId = discordCh.guild.id;
      const channelId = discordCh.id;

      // echo normal chat messages into the hub, if we're bridged to a hub
      if (args[0] !== "!hubs") {
        if (discordCh.id in bindings.hubsByChannel) {
          const hubId = bindings.hubsByChannel[discordCh.id];
          const binding = bindings.bindingsByHub[hubId];
          // don't echo our own messages
          if (msg.author.id === discordClient.user.id) {
            return;
          }
          if (binding.webhook != null && msg.webhookID === binding.webhook.id) {
            return;
          }
          if (VERBOSE) {
            console.debug(ts(`Relaying chat message via channel ${discordCh.id} to hub ${hubId}.`));
          }
          binding.reticulumCh.sendMessage(msg.author.username, msg.cleanContent);
        }
        return;
      }

      console.info(ts(`Processing bot command from ${msg.author.id}: "${msg.content}"`));

      switch (args[1]) {

      case "status": {
        // "!hubs status" == emit useful info about the current bot and hub state
        if (discordCh.id in bindings.hubsByChannel) {
          const hubId = bindings.hubsByChannel[discordCh.id];
          const binding = bindings.bindingsByHub[hubId];
          await discordCh.send(
            `I am the Hubs Discord bot, linking to any Hubs room URLs I see in channel topics on ${HOSTNAMES.join(", ")}.\n\n` +
              `🦆 <#${discordCh.id}> bridged to Hubs room "${binding.hubState.name}" (${binding.hubState.id}) at <${binding.hubState.url}>.\n` +
              `🦆 ${binding.webhook ? `Bridging chat using the webhook "${binding.webhook.name}" (${binding.webhook.id}).` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n` +
              `🦆 Connected since ${binding.hubState.ts.toISOString()}.\n\n`
          );
        } else {
          const webhook = await getHubsWebhook(msg.channel);
          await discordCh.send(
            `I am the Hubs Discord bot, linking to any Hubs room URLs I see in channel topics on ${HOSTNAMES.join(", ")}.\n\n` +
              `🦆 This channel isn't bridged to any room on Hubs. Use !hubs to create or add a Hubs room to the topic to bridge it.\n` +
              `🦆 ${webhook ? `The webhook "${webhook.name}" (${webhook.id}) will be used for bridging chat.` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n`
          );
        }
        return;
      }

      case "create": {
        if (topicManager.matchHub(discordCh.topic)) {
          await discordCh.send("A Hubs room is already bridged in the topic, so I am cowardly refusing to replace it.");
          return;
        }

        if (args.length == 2) { // !hubs create
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHub(discordCh.name);
          await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
          await reticulumClient.bindHub(hubId, guildId, channelId);
          return;
        }

        const { sceneUrl, sceneId, sceneSlug } = topicManager.matchScene(args[2]) || {};
        if (sceneUrl) { // !hubs create [scene URL] [name]
          const name = sceneSlug || discordCh.name;
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHub(name, sceneId);
          await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
          await reticulumClient.bindHub(hubId, guildId, channelId);
          return;
        }

        await discordCh.send(HELP_TEXT);
        return;
      }

      case "remove": {
        // "!hubs remove" == if a hub is bridged, remove it
        const { hubUrl } = topicManager.matchHub(discordCh.topic) || {};
        if (!hubUrl) {
          await discordCh.send("No Hubs room is bridged in the topic, so doing nothing :eyes:");
          return;
        }

        await trySetTopic(discordCh, topicManager.removeHub(discordCh.topic));
        return;
      }

      case "users": {
        // "!hubs users" == list users
        if (discordCh.id in bindings.hubsByChannel) {
          const hubId = bindings.hubsByChannel[discordCh.id];
          const binding = bindings.bindingsByHub[hubId];
          const users = binding.reticulumCh.getUsers();
          const description = users.join(", ");
          await discordCh.send(`Users currently in <${binding.hubState.url}>: **${description}**`);
        } else {
          await discordCh.send("No Hubs room is currently bridged to this channel.");
        }
        return;
      }

      case undefined:
      default: {
        await discordCh.send(HELP_TEXT);
        return;
      }

      }
    });
  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
