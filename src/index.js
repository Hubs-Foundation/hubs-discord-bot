// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");
const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const MEDIA_DEDUPLICATE_MS = 60 * 60 * 1000; // 1 hour
const IMAGE_URL_RE = /\.(png)|(gif)|(jpg)|(jpeg)$/;
const LOCAL_DT_FORMAT = new Intl.DateTimeFormat(process.env.LOCALE, {
  timeZone: process.env.TIMEZONE,
  timeZoneName: "short",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric"
});

const discord = require('discord.js');
const schedule = require('node-schedule');
const { ChannelBindings, HubState } = require("./bindings.js");
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
    return this.curr = this.curr.then(_ => fn()).catch(e => console.error(ts(e.stack)));
  }

}

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// Formats a Discord channel reference, displaying the guild, channel name, and ID.
function formatDiscordCh(discordCh) {
  if (VERBOSE && discordCh.guild && discordCh.name) {
    return `${discordCh.guild.name}/#${discordCh.name} (${discordCh.id})`;
  } else {
    return discordCh.id;
  }
}

// Formats user activity statistics for a hub.
function formatStats(stats, where, when) {
  const header = when != null ? `Hubs activity in <${where}> for ${when}:\n` : `Hubs activity in <${where}>:\n`;
  const peakTimeDescription = stats.peakTime == null ? "N/A" : LOCAL_DT_FORMAT.format(new Date(stats.peakTime));
  return header +
    "```\n" +
    `Room joins: ${stats.arrivals}\n` +
    `Peak user count: ${stats.peakCcu}\n` +
    `Peak time: ${peakTimeDescription}\n` +
    "```";
}

// Formats a message indicating that the user formerly known as `prev` is now known as `curr`.
function formatRename(user) {
  return `**${user.prevName}** changed their name to **${user.name}**.`;
}

// Formats a message of the form "Alice, Bob, and Charlie verb."
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

function establishBridge(binding) {
  const { reticulumCh, discordCh, hubState: state } = binding;
  const { stats, presenceRollups, mediaBroadcasts } = state;

  let nRoomOccupants = 0;
  for (const p of Object.values(reticulumCh.getUsers())) {
    if (p.metas.some(m => m.presence === "room")) {
      nRoomOccupants++;
    }
  }
  if (nRoomOccupants > 0) {
    stats.arrive(Date.now(), nRoomOccupants);
  }

  console.info(ts(`Hubs room ${state.id} bridged to ${formatDiscordCh(discordCh)}.`));

  let lastPresenceMessage = null;
  presenceRollups.on('new', ({ kind, users, fresh }) => {
    if (kind === "arrive") {
      const verb = fresh ? `joined <${state.url}>` : "joined";
      lastPresenceMessage = discordCh.send(formatEvent(users, verb));
    } else if (kind === "depart") {
      const verb = fresh ? `left <${state.url}>` : "left";
      lastPresenceMessage = discordCh.send(formatEvent(users, verb));
    } else if (kind === "rename") {
      lastPresenceMessage = discordCh.send(formatRename(users[0]));
    }
  });
  presenceRollups.on('update', ({ kind, users, fresh }) => {
    if (kind === "arrive") {
      const verb = fresh ? `joined ${state.url}` : "joined";
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, verb)));
    } else if (kind === "depart") {
      const verb = fresh ? `left ${state.url}` : "left";
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatEvent(users, verb)));
    } else if (kind === "rename") {
      lastPresenceMessage = lastPresenceMessage.then(msg => msg.edit(formatRename(users[0])));
    }
  });

  reticulumCh.on('join', (id, kind, whom) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying join for ${whom} (${id}) in ${state.id} to ${formatDiscordCh(discordCh)}.`));
    }
    const now = Date.now();
    presenceRollups.arrive(id, whom, now);
    if (kind === "room") {
      stats.arrive(Date.now());
    }
  });
  reticulumCh.on('moved', (id, kind, _prev) => {
    if (kind === "room") {
      stats.arrive(Date.now());
    }
  });
  reticulumCh.on('leave', (id, kind, whom) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying leave for ${whom} (${id}) in ${state.id} to ${formatDiscordCh(discordCh)}.`));
    }
    const now = Date.now();
    presenceRollups.depart(id, whom, now);
    if (kind === "room") {
      stats.depart(now);
    }
  });
  reticulumCh.on('renameuser', (id, kind, prev, curr) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying rename from ${prev} to ${curr} (${id}) in ${state.id} to ${formatDiscordCh(discordCh)}.`));
    }
    presenceRollups.rename(id, prev, curr, Date.now());
  });
  reticulumCh.on('rescene', (id, whom, scene) => {
    if (VERBOSE) {
      console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${state.id} to ${formatDiscordCh(discordCh)}.`));
    }
    discordCh.send(`${whom} changed the scene in ${state.url} to ${scene.name}.`);
  });
  reticulumCh.on('renamehub', (id, whom, name, slug) => {
    state.name = name;
    state.slug = slug;
    if (VERBOSE) {
      console.debug(ts(`Relaying name change by ${whom} (${id}) in ${state.id} to ${formatDiscordCh(discordCh)}.`));
    }
    discordCh.send(`${whom} renamed the hub at ${state.url} to ${state.name}.`);
  });

  reticulumCh.on("message", (id, whom, type, body) => {
    const webhook = binding.webhook; // note that this may change over the lifetime of the binding
    if (webhook == null) {
      if (VERBOSE) {
        console.debug(`Ignoring message of type ${type} in ${formatDiscordCh(discordCh)} because no webhook is associated.`);
      }
      return;
    }
    if (VERBOSE) {
      const msg = ts(`Relaying message of type ${type} from ${whom} (${id}) via ${state.id} to ${formatDiscordCh(discordCh)}: %j`);
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
            console.debug(ts(`Declining to rebroadcast ${body.src} only ${(elapsedMs / 1000).toFixed(0)} second(s) after previous broadcast.`));
          }
          return;
        }
      }
      mediaBroadcasts[body.src] = timestamp;
      webhook.send(body.src, { username: whom });
    } else if (type === "photo") {
      // we like to just broadcast all photos, without waiting for anyone to pin them
      webhook.send(body.src, { username: whom });
    }
  });
}

function scheduleSummaryPosting(bindings, queue) {
  // only enable on hubs discord and test server until we're sure we like this
  const whitelistedGuilds = new Set(["525537221764317195", "498741086295031808"]);
  const rule = new schedule.RecurrenceRule(null, null, null, null, 23, 59, 59);
  return schedule.scheduleJob(rule, function(date) {
    var start = date;
    var end = new Date(start.getTime());
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const when = start.toLocaleDateString(process.env.LOCALE, {
      timeZone: process.env.TIMEZONE,
      weekday: "long",
      year: "numeric",
      month: "numeric",
      day: "numeric"
    });
    queue.enqueue(async () => {
      for (const { discordCh, hubState } of Object.values(bindings.bindingsByHub)) {
        if (discordCh.guild && whitelistedGuilds.has(discordCh.guild.id)) {
          const summary = hubState.stats.summarize(start.getTime(), end.getTime());
          if (summary.peakCcu > 0) {
            await discordCh.send(formatStats(summary, hubState.url, when));
          }
        }
      }
    });
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

  scheduleSummaryPosting(bindings, q);

  // one-time scan through all channels to look for existing bindings
  console.info(ts(`Monitoring channels for Hubs hosts: ${HOSTNAMES.join(", ")}`));
  for (let [_, chan] of discordClient.channels.filter(ch => ch.type === "text")) {
    q.enqueue(async () => {
      const { hubUrl, hubId } = topicManager.matchHub(chan.topic) || {};
      if (hubUrl) {
        try {
          const reticulumCh = reticulumClient.channelForHub(hubId, chan.name);
          reticulumCh.on("connect", id => { console.info(ts(`Connected to Hubs room ${hubId} with session ID ${id}.`)); });
          const hub = (await reticulumCh.connect()).hubs[0];
          const webhook = await getHubsWebhook(chan);
          const state = new HubState(hubUrl.host, hub.hub_id, hub.name, hub.slug, new Date());
          const binding = bindings.associate(reticulumCh, chan, webhook, state, hubUrl.host);
          establishBridge(binding);
        } catch (e) {
          console.error(ts(`Failed to bridge to ${hubUrl}:`), e);
        }
      }
    });
  }

  discordClient.on('webhookUpdate', (discordCh) => {
    q.enqueue(async () => {
      const hubId = bindings.hubsByChannel[discordCh.id];
      const binding = bindings.bindingsByHub[hubId];
      if (binding != null) {
        const oldWebhook = binding.webhook;
        const newWebhook = await getHubsWebhook(discordCh);
        if (oldWebhook != null && newWebhook == null) {
          await discordCh.send("Webhook disabled; Hubs will no longer bridge chat. Re-add a channel webhook to re-enable bridging.");
        } else if (newWebhook != null && (oldWebhook == null || newWebhook.id !== oldWebhook.id)) {
          await discordCh.send(`The webhook "${newWebhook.name}" (${newWebhook.id}) will now be used for bridging chat in Hubs.`);
        }
        binding.webhook = newWebhook;
      }
    });
  });

  discordClient.on('channelUpdate', (oldChannel, newChannel) => {
    q.enqueue(async () => {
      const prevHubId = bindings.hubsByChannel[oldChannel.id];
      const { hubUrl: currHubUrl, hubId: currHubId } = topicManager.matchHub(newChannel.topic) || {};
      if (prevHubId !== currHubId) {
        try {
          if (prevHubId) {
            console.info(ts(`Hubs room ${prevHubId} no longer bridged to ${formatDiscordCh(newChannel)}; leaving.`));
            const { hubState, reticulumCh } = bindings.bindingsByHub[prevHubId];
            await reticulumCh.close();
            bindings.dissociate(prevHubId);
            await newChannel.send(`<#${newChannel.id}> no longer bridged to <${hubState.url}>.`);
          }
          if (currHubId) {
            const reticulumCh = reticulumClient.channelForHub(currHubId, newChannel.name);
            reticulumCh.on("connect", id => { console.info(ts(`Connected to Hubs room ${currHubId} with session ID ${id}.`)); });
            const hub = (await reticulumCh.connect()).hubs[0];
            const webhook = await getHubsWebhook(newChannel);
            const state = new HubState(currHubUrl.host, hub.hub_id, hub.name, hub.slug, new Date());
            const binding = bindings.associate(reticulumCh, newChannel, webhook, state, currHubUrl.host);
            establishBridge(binding);
            if (webhook != null) {
              await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}.`);
            } else {
              await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}. No webhook is present, so bridging won't work. Add a channel webhook to enable bridging.`);
            }
          }
        } catch (e) {
          console.error(ts(`Failed to update bridge from ${prevHubId} to ${currHubId}:`), e);
        }
      }
    });
  });

  const HELP_TEXT = "Hi! I'm the Hubs bot. I connect Discord channels with rooms on Hubs (https://hubs.mozilla.com/). Any room with its URL in a channel topic will bridge chat and media back and forth between the channel and the room." +
        "You can also use the following commands:\n\n" +
        "🦆 `!hubs create` - Creates a default Hubs room and puts its URL into the channel topic. " +
        "Rooms created with `!hubs create` will inherit moderation permissions from this Discord channel and only allow Discord users in this channel to join the room.\n" +
        "🦆 `!hubs create [scene URL] [name]` - Creates a new room with the given scene and name, and puts its URL into the channel topic.\n" +
        "🦆 `!hubs stats` - Shows some summary statistics about room usage.\n" +
        "🦆 `!hubs status` - Shows general information about the Hubs integration with the current Discord channel.\n" +
        "🦆 `!hubs remove` - Removes the room URL from the topic and stops bridging this Discord channel with Hubs.\n" +
        "🦆 `!hubs users` - Lists the users currently in the Hubs room bridged to this channel.\n\n" +
        "See the documentation and source at https://github.com/MozillaReality/hubs-discord-bot for a more detailed reference " +
        "of bot functionality, including guidelines on what permissions the bot needs, what kinds of bridging the bot can do, " +
        "and more about how the bot bridges channels to rooms.";

  discordClient.on('message', msg => {
    q.enqueue(async () => {
      // don't process our own messages
      if (msg.author.id === discordClient.user.id) {
        return;
      }

      if (VERBOSE) {
        console.debug(ts(`Processing message from ${msg.author.id}: "${msg.content}"`));
      }

      const args = msg.content.split(' ');
      const discordCh = msg.channel;
      const channelId = discordCh.id;

      if (msg.content === "!hubs") {
        await discordCh.send(HELP_TEXT);
        return;
      }

      if (!discordCh.guild) { // e.g. you DMed the bot
        await discordCh.send(
          "Hi! I'm the Hubs bot. I connect Discord channels with rooms on Hubs (https://hubs.mozilla.com/).\n\n" +
          "I only work in public channels. Find a channel that you want to be bridged to a Hubs room and talk to me there.\n\n" +
          "If you're curious about what I do, try `!hubs` or check out https://github.com/MozillaReality/hubs-discord-bot."
        );
        return;
      }

      // echo normal chat messages into the hub, if we're bridged to a hub
      if (args[0] !== "!hubs") {
        if (discordCh.id in bindings.hubsByChannel) {
          const hubId = bindings.hubsByChannel[discordCh.id];
          const binding = bindings.bindingsByHub[hubId];
          if (binding.webhook != null && msg.webhookID === binding.webhook.id) { // don't echo our own messages
            return;
          }
          if (msg.cleanContent) { // could be blank if the message is e.g. only an attachment
            if (VERBOSE) {
              console.debug(ts(`Relaying chat message via ${formatDiscordCh(discordCh)} to hub ${hubId}.`));
            }
            binding.reticulumCh.sendMessage(msg.author.username, "chat", msg.cleanContent);
          }

          // todo: we don't currently have any principled way of representing non-image attachments in hubs --
          // sometimes we could spawn them (e.g. a PDF or a model) but where would we place them, and who would own them?
          // we could send a chat message that said something like "mqp linked a file" with a spawn button,
          // but i fear the spawn button is too obscure for this to be clear. work for later date
          const imageAttachments = Array.from(msg.attachments.values()).filter(a => IMAGE_URL_RE.test(a.url));
          for (const attachment of imageAttachments) {
            if (VERBOSE) {
              console.debug(ts(`Relaying attachment via ${formatDiscordCh(discordCh)} to hub ${hubId}.`));
            }
            binding.reticulumCh.sendMessage(msg.author.username, "image", { "src": attachment.url });
          }
        }
        return;
      }

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
              `🦆 Connected since ${LOCAL_DT_FORMAT.format(new Date(binding.hubState.ts))}.\n\n`
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
          const guildId = discordCh.guild.id;
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHub(discordCh.name);
          await trySetTopic(discordCh, topicManager.addHub(discordCh.topic, hubUrl));
          await reticulumClient.bindHub(hubId, guildId, channelId);
          return;
        }

        const { sceneUrl, sceneId, sceneSlug } = topicManager.matchScene(args[2]) || {};
        if (sceneUrl) { // !hubs create [scene URL] [name]
          const name = sceneSlug || discordCh.name;
          const guildId = discordCh.guild.id;
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
          const { hubState, reticulumCh } = bindings.bindingsByHub[hubId];
          const names = Object.values(reticulumCh.getUsers()).map(info => info.metas[0].profile.displayName).join(", ");
          await discordCh.send(`Users currently in <${hubState.url}>: **${names}**`);
        } else {
          await discordCh.send("No Hubs room is currently bridged to this channel.");
        }
        return;
      }

      case "stats": {
        // "!hubs stats" == stats for the current hub
        if (discordCh.id in bindings.hubsByChannel) {
          const hubId = bindings.hubsByChannel[discordCh.id];
          const { hubState } = bindings.bindingsByHub[hubId];
          await discordCh.send(formatStats(hubState.stats.summarize(), hubState.url));
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
