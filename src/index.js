// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const moment = require('moment-timezone');
const discord = require('discord.js');
const schedule = require('node-schedule');
const { Bridges, HubState } = require("./bridges.js");
const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");
const { HubStats } = require("./hub-stats.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { StatsdClient } = require("./statsd-client.js");

// someday we will probably have different locales and timezones per server
moment.tz.setDefault(process.env.TIMEZONE);
moment.locale(process.env.LOCALE);

const VERBOSE = (process.env.VERBOSE === "true");
const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const MEDIA_DEDUPLICATE_MS = 60 * 60 * 1000; // 1 hour
const IMAGE_URL_RE = /\.(png)|(gif)|(jpg)|(jpeg)$/;
const ACTIVE_WEBHOOKS = {}; // { discordChId: webhook }
const DISABLED_EVENTS = [ // only bother to disable processing on relatively high-volume events
  "TYPING_START",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
  "PRESENCE_UPDATE"
];

let statsdClient = null;
const statsdHost = process.env.STATSD_HOST;
if (statsdHost) {
  const [hostname, port] = statsdHost.split(":");
  statsdClient = new StatsdClient(hostname, port ? parseInt(port, 10) : 8125, process.env.STATSD_PREFIX);
  console.info(ts(`Sending metrics to statsd @ ${statsdHost}.`));
}

// Serializes invocations of the tasks in the queue. Used to ensure that we completely finish processing
// a single Discord event before processing the next one, e.g. we don't interleave work from a user command
// and from a channel topic update, or from two channel topic updates in quick succession.
class DiscordEventQueue {

  constructor() {
    this.size = 0;
    this.curr = Promise.resolve();
    this._onSizeChanged();
  }

  _onSizeChanged() {
    if (statsdClient != null) {
      statsdClient.send("discord.queuesize", this.size, "g");
    }
  }

  // Enqueues the given function to run as soon as no other functions are currently running.
  enqueue(fn) {
    this.size += 1;
    this._onSizeChanged();
    return this.curr = this.curr.then(_ => fn()).catch(e => console.error(ts(e.stack))).finally(() => {
      this.size -= 1;
      this._onSizeChanged();
    });
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
  } else if (discordCh.guild) {
    return `${discordCh.guild.id}/${discordCh.id}`;
  } else {
    return discordCh.id;
  }
}

// Formats user activity statistics for a hub.
function formatStats(stats, where, when) {
  const header = when != null ? `Hubs activity in <${where}> for ${when}:\n` : `Hubs activity in <${where}>:\n`;
  const peakTimeDescription = stats.peakTime == null ? "N/A" : moment(stats.peakTime).format('LTS z');
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

// Creates a presence profile object suitable for the bot user.
function serializeProfile(displayName, discordChannels) {
  return {
    displayName,
    avatarId: "",
    discordBridges: discordChannels.map(c => {
      return {
        guild: { id: c.guild.id, name: c.guild.name },
        channel: { id: c.id, name: c.name }
      };
    })
  };
}

// Updates the channel name to have or not have the presence icon at the end of it, depending on whether
// anyone is in the room or not.
function updateChannelPresenceIcon(channel, active) {
  const activeIcon = "🔹";
  const cleanedName = channel.name.replace(new RegExp(`\s*${activeIcon}$`, "u"), "");
  const updatedName = active ? (cleanedName + activeIcon) : cleanedName;
  if (updatedName !== channel.name) {
    channel.setName(updatedName, `Hubs room became ${active ? "active" : "inactive"}.`);
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
      discordCh.send("Sorry, you'll need to give me \"manage channel\" permissions in this channel to do that, so that I can change the topic.");
      return null;
    }
  });
}

// Wires up the given HubState so that messages coming out of its Reticulum channel are bridged to wherever they ought to go,
// per the set of bridges currently present in `bridges`.
function establishBridging(hubState, bridges) {
  const { reticulumCh, presenceRollups } = hubState;

  const lastPresenceMessages = {}; // { discordCh: message object }
  presenceRollups.on('new', ({ kind, users, fresh }) => {
    if (statsdClient != null) {
      statsdClient.send("reticulum.presencechanges", 1, "c");
    }
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      if (kind === "arrive") {
        const verb = fresh ? `joined <${hubState.url}>` : "joined";
        lastPresenceMessages[discordCh.id] = discordCh.send(formatEvent(users, verb));
      } else if (kind === "depart") {
        const verb = fresh ? `left <${hubState.url}>` : "left";
        lastPresenceMessages[discordCh.id] = discordCh.send(formatEvent(users, verb));
      } else if (kind === "rename") {
        lastPresenceMessages[discordCh.id] = discordCh.send(formatRename(users[0]));
      }
    }
  });
  presenceRollups.on('update', ({ kind, users, fresh }) => {
    if (statsdClient != null) {
      statsdClient.send("reticulum.presencechanges", 1, "c");
    }
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      if (kind === "arrive") {
        const verb = fresh ? `joined ${hubState.url}` : "joined";
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(msg => msg.edit(formatEvent(users, verb)));
      } else if (kind === "depart") {
        const verb = fresh ? `left ${hubState.url}` : "left";
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(msg => msg.edit(formatEvent(users, verb)));
      } else if (kind === "rename") {
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(msg => msg.edit(formatRename(users[0])));
      }
    }
  });

  reticulumCh.on('rescene', (timestamp, id, whom, scene) => {
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      discordCh.send(`${whom} changed the scene in ${hubState.url} to ${scene.name}.`);
    }
  });
  reticulumCh.on('renamehub', (timestamp, id, whom, name, slug) => {
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      hubState.name = name;
      hubState.slug = slug;
      if (VERBOSE) {
        console.debug(ts(`Relaying name change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      discordCh.send(`${whom} renamed the hub at ${hubState.url} to ${hubState.name}.`);
    }
  });

  const mediaBroadcasts = {}; // { url: timestamp }
  reticulumCh.on("message", (timestamp, id, whom, type, body) => {
    if (statsdClient != null) {
      statsdClient.send("reticulum.contentmsgs", 1, "c");
    }
    if (type === "media") {
      // we really like to deduplicate media broadcasts of the same object in short succession,
      // mostly because of the case where people are repositioning pinned media, but also because
      // sometimes people will want to clone a bunch of one thing and pin them all in one go
      const lastBroadcast = mediaBroadcasts[body.src];
      if (lastBroadcast != null) {
        const elapsedMs = timestamp - lastBroadcast;
        if (elapsedMs <= MEDIA_DEDUPLICATE_MS) {
          if (VERBOSE) {
            console.debug(ts(`Declining to rebroadcast ${body.src} only ${(elapsedMs / 1000).toFixed(0)} second(s) after previous broadcast.`));
          }
          return;
        }
      } else {
        mediaBroadcasts[body.src] = timestamp;
      }
    }
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      const webhook = ACTIVE_WEBHOOKS[discordCh.id]; // note that this may change over the lifetime of the bridge
      if (webhook == null) {
        if (VERBOSE) {
          console.debug(`Ignoring message of type ${type} in ${formatDiscordCh(discordCh)} because no webhook is associated.`);
        }
        return;
      }
      if (VERBOSE) {
        const msg = ts(`Relaying message of type ${type} from ${whom} (${id}) via ${hubState.id} to ${formatDiscordCh(discordCh)}: %j`);
        console.debug(msg, body);
      }
      if (type === "chat") {
        webhook.send(body, { username: whom });
      } else if (type === "media") {
        webhook.send(body.src, { username: whom });
      } else if (type === "photo") {
        // we like to just broadcast all photos, without waiting for anyone to pin them
        webhook.send(body.src, { username: whom });
      }
    }
  });

  reticulumCh.on('sync', () => {
    const userCount = reticulumCh.getUserCount();
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      updateChannelPresenceIcon(discordCh, userCount > 0);
    }
  });

  // also get it right for the initial state
  const userCount = reticulumCh.getUserCount();
  for (const discordCh of bridges.getChannels(hubState.id).values()) {
    updateChannelPresenceIcon(discordCh, userCount > 0);
  }
}

function scheduleSummaryPosting(bridges, queue) {
  // only enable on hubs discord and test server until we're sure we like this
  const whitelistedGuilds = new Set(["525537221764317195", "498741086295031808"]);
  const rule = new schedule.RecurrenceRule(null, null, null, null, null, 0, 0);
  return schedule.scheduleJob(rule, function(date) {
    const end = moment(date);
    const start = moment(end).subtract(1, "days");
    if (end.hour() !== 0) { // only post once, at midnight local time
      return;
    }
    queue.enqueue(async () => {
      const when = start.format("LL");
      const startTs = start.valueOf();
      const endTs = end.valueOf();
      for (const { hubState, discordCh } of bridges.entries()) {
        if (discordCh.guild && whitelistedGuilds.has(discordCh.guild.id)) {
          const summary = hubState.stats.summarize(startTs, endTs);
          if (summary.peakCcu > 0) {
            await discordCh.send(formatStats(summary, hubState.url, when));
          }
        }
      }
    });
  });
}

// Connects to the Phoenix channel for a hub and returns a HubState for that hub.
async function connectToHub(reticulumClient, discordChannels, host, hubId) {
  const reticulumCh = reticulumClient.channelForHub(hubId, serializeProfile("Hubs Bot", discordChannels));
  reticulumCh.on("connect", (timestamp, id) => { console.info(ts(`Connected to Hubs room ${hubId} with session ID ${id}.`)); });
  const resp = (await reticulumCh.connect()).hubs[0];
  const stats = new HubStats();
  const presenceRollups = new PresenceRollups();
  let nRoomOccupants = 0;
  for (const p of Object.values(reticulumCh.getUsers())) {
    if (p.metas.some(m => m.presence === "room")) {
      nRoomOccupants++;
    }
  }
  if (nRoomOccupants > 0) {
    stats.arrive(Date.now(), nRoomOccupants);
  }
  stats.subscribeToChannel(reticulumCh);
  presenceRollups.subscribeToChannel(reticulumCh);
  return new HubState(reticulumCh, host, resp.hub_id, resp.name, resp.slug, new Date(), stats, presenceRollups);
}

// Returns a mapping of { (host, hubId): [discord channels] } for Hubs bridges in the given channels.
function findBridges(topicManager, channels) {
  const result = new Map();
  for (const discordCh of channels) {
    const { hubUrl, hubId } = topicManager.matchHub(discordCh.topic) || {};
    if (hubUrl != null) {
      const key = `${hubUrl.host} ${hubId}`;
      let bridgedChannels = result.get(key);
      if (bridgedChannels == null) {
        result.set(key, bridgedChannels = []);
      }
      bridgedChannels.push(discordCh);
    }
  }
  return result;
}

function getBridgeStats(bridges) {
  const bridgedChannels = new Set();
  const bridgedGuilds = new Set();
  const bridgedRooms = new Set();
  for (const { hubState, discordCh } of bridges.entries()) {
    bridgedChannels.add(discordCh);
    bridgedGuilds.add(discordCh.guild);
    bridgedRooms.add(hubState);
  }
  return {
    nChannels: bridgedChannels.size,
    nGuilds: bridgedGuilds.size,
    nRooms: bridgedRooms.size
  };
}

async function start() {

  const shardId = parseInt(process.env.SHARD_ID, 10);
  const shardCount = parseInt(process.env.SHARD_COUNT, 10);
  const discordClient = new discord.Client({
    shardId,
    shardCount,
    messageCacheMaxSize: 1, // we have no use for manipulating historical messages
    disabledEvents: DISABLED_EVENTS,
    disableEveryone: true
  });

  await connectToDiscord(discordClient, process.env.TOKEN);
  console.info(ts(`Connected to Discord (shard ID: ${shardId}/${shardCount})...`));

  const reticulumHost = process.env.RETICULUM_HOST;
  const reticulumClient = new ReticulumClient(reticulumHost);
  await reticulumClient.connect();
  console.info(ts(`Connected to Reticulum @ ${reticulumHost}.`));

  const connectedHubs = {}; // { hubId: hubState }
  const bridges = new Bridges();
  const topicManager = new TopicManager(HOSTNAMES);
  const q = new DiscordEventQueue();

  scheduleSummaryPosting(bridges, q);

  // one-time scan through all channels to look for existing bridges
  console.info(ts(`Scanning channel topics for Hubs hosts: ${HOSTNAMES.join(", ")}`));
  {
    const candidateBridges = findBridges(topicManager, discordClient.channels.filter(ch => ch.type === "text").values());
    for (const [key, channels] of candidateBridges.entries()) {
      const [host, hubId] = key.split(" ", 2);
      try {
        const hubState = connectedHubs[hubId] = await connectToHub(reticulumClient, channels, host, hubId);
        for (const discordCh of channels) {
          bridges.associate(hubState, discordCh);
          ACTIVE_WEBHOOKS[discordCh.id] = await getHubsWebhook(discordCh);
          console.info(ts(`Hubs room ${hubState.id} bridged to ${formatDiscordCh(discordCh)}.`));
        }
        establishBridging(hubState, bridges);
      } catch (e) {
        console.error(ts(`Error bridging Hubs room ${hubId}: `), e);
      }
    }
    const { nChannels, nGuilds, nRooms } = getBridgeStats(bridges);
    console.info(ts(`Scan finished; ${nChannels} channel(s), ${nRooms} room(s), ${nGuilds} guild(s).`));
  }

  discordClient.on('webhookUpdate', (discordCh) => {
    q.enqueue(async () => {
      const hubState = bridges.getHub(discordCh.id);
      if (hubState != null) {
        const oldWebhook = ACTIVE_WEBHOOKS[discordCh.id];
        const newWebhook = await getHubsWebhook(discordCh);
        if (oldWebhook != null && newWebhook == null) {
          await discordCh.send("Webhook disabled; Hubs will no longer bridge chat. Re-add a channel webhook to re-enable chat bridging.");
        } else if (newWebhook != null && (oldWebhook == null || newWebhook.id !== oldWebhook.id)) {
          await discordCh.send(`The webhook "${newWebhook.name}" (${newWebhook.id}) will now be used for bridging chat in Hubs.`);
        }
        ACTIVE_WEBHOOKS[discordCh.id] = newWebhook;
      }
    });
  });

  discordClient.on('channelUpdate', (oldChannel, newChannel) => {
    q.enqueue(async () => {
      const prevHub = bridges.getHub(oldChannel.id);
      const { hubUrl: currHubUrl, hubId: currHubId } = topicManager.matchHub(newChannel.topic) || {};
      try {
        if (prevHub != null && prevHub.id != currHubId) {
          console.info(ts(`Hubs room ${prevHub.id} no longer bridged to ${formatDiscordCh(newChannel)}; leaving.`));
          bridges.dissociate(prevHub.id, newChannel.id);
          const bridgedChannels = bridges.getChannels(prevHub.id);
          if (bridgedChannels.size === 0) {
            console.info(ts(`Disconnecting from Hubs room ${prevHub.id}.`));
            connectedHubs[prevHub.id] = null;
            await prevHub.reticulumCh.close();
          } else {
            prevHub.reticulumCh.updateProfile(serializeProfile("Hubs Bot", Array.from(bridgedChannels.values())));
          }
          await newChannel.send(`<#${newChannel.id}> no longer bridged to <${prevHub.url}>.`);
        }
        if (currHubId != null && (prevHub == null || prevHub.id != currHubId)) {
          let currHub = connectedHubs[currHubId];
          if (currHub == null) {
            currHub = connectedHubs[currHubId] = await connectToHub(reticulumClient, [newChannel], currHubUrl.host, currHubId);
            establishBridging(currHub, bridges);
            bridges.associate(currHub, newChannel);
          } else {
            bridges.associate(currHub, newChannel);
            const bridgedChannels = bridges.getChannels(currHubId);
            currHub.reticulumCh.updateProfile(serializeProfile("Hubs Bot", Array.from(bridgedChannels.values())));
          }

          const webhook = ACTIVE_WEBHOOKS[newChannel.id] = await getHubsWebhook(newChannel);
          if (webhook != null) {
            await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}.`);
          } else {
            await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}. No webhook is present, so chat won't work. If you add a channel webhook, chat will get bridged as well.`);
          }
          console.info(ts(`Hubs room ${currHubId} bridged to ${formatDiscordCh(newChannel)}.`));
        }
      } catch (e) {
        const prevHubDesc = prevHub != null ? prevHub.id : "nowhere";
        const currHubDesc = currHubId != null ? currHubId : "nowhere";
        console.error(ts(`Failed to update ${formatDiscordCh(newChannel)} bridge from ${prevHubDesc} to ${currHubDesc}:`), e);
      }
    });
  });

  const HELP_PREFIX = "Hi! I'm the Hubs bot. I connect Discord channels with rooms on Hubs (<https://hubs.mozilla.com/>). Type `!hubs help` for more information.";

  const COMMAND_HELP_TEXT =
        "Command reference:\n\n" +
        "🦆 `!hubs` - Shows general information about the Hubs integration with the current Discord channel.\n" +
        "🦆 `!hubs help` - Shows this text you're reading right now.\n" +
        "🦆 `!hubs create` - Creates a default Hubs room and puts its URL into the channel topic. " +
        "Rooms created with `!hubs create` will inherit moderation permissions from this Discord channel and only allow Discord users in this channel to join the room.\n" +
        "🦆 `!hubs create [environment URL] [name]` - Creates a new room with the given environment and name, and puts its URL into the channel topic. " +
        "Valid environment URLs include GLTFs, GLBs, and Spoke scene pages.\n" +
        "🦆 `!hubs stats` - Shows some summary statistics about room usage.\n" +
        "🦆 `!hubs remove` - Removes the room URL from the topic and stops bridging this Discord channel with Hubs.\n" +
        "🦆 `!hubs users` - Lists the users currently in the Hubs room bridged to this channel.\n\n" +
        "See the documentation and source at https://github.com/MozillaReality/hubs-discord-bot for a more detailed reference " +
        "of bot functionality, including guidelines on what permissions the bot needs, what kinds of bridging the bot can do, " +
        "and more about how the bot bridges channels to rooms. You can invite the bot to your own server at https://hubs.mozilla.com/discord.";

  discordClient.on('message', msg => {
    const args = msg.content.split(' ');
    const discordCh = msg.channel;

    // early & cheap bailout if this message isn't a bot command and isn't in a bridged channel
    if (args[0] !== "!hubs" && bridges.getHub(discordCh.id) == null) {
      return;
    }

    q.enqueue(async () => {

      // don't process our own messages
      const activeWebhook = ACTIVE_WEBHOOKS[discordCh.id];
      if (msg.author.id === discordClient.user.id) {
        return;
      }
      if (activeWebhook != null && msg.webhookID === activeWebhook.id) {
        return;
      }

      if (VERBOSE) {
        console.debug(ts(`Processing message from ${msg.author.id}: "${msg.content}"`));
      }

      if (statsdClient != null) {
        statsdClient.send("discord.msgs", 1, "c");
      }

      if (!discordCh.guild) { // e.g. you DMed the bot
        await discordCh.send(HELP_PREFIX + "\n\n" +
          "I only work in public channels. Find a channel that you want to be bridged to a Hubs room and talk to me there.\n\n" +
          "If you're curious about what I do, try `!hubs help` or check out https://github.com/MozillaReality/hubs-discord-bot."
        );
        return;
      }

      // echo normal chat messages into the hub, if we're bridged to a hub
      const hubState = bridges.getHub(discordCh.id);
      if (args[0] !== "!hubs") {
        if (hubState == null) {
          return;
        }
        if (msg.cleanContent) { // could be blank if the message is e.g. only an attachment
          if (VERBOSE) {
            console.debug(ts(`Relaying chat message via ${formatDiscordCh(discordCh)} to hub ${hubState.id}.`));
          }
          hubState.reticulumCh.sendMessage(msg.author.username, "chat", msg.cleanContent);
        }

        // todo: we don't currently have any principled way of representing non-image attachments in hubs --
        // sometimes we could spawn them (e.g. a PDF or a model) but where would we place them, and who would own them?
        // we could send a chat message that said something like "mqp linked a file" with a spawn button,
        // but i fear the spawn button is too obscure for this to be clear. work for later date
        const imageAttachments = Array.from(msg.attachments.values()).filter(a => IMAGE_URL_RE.test(a.url));
        for (const attachment of imageAttachments) {
          if (VERBOSE) {
            console.debug(ts(`Relaying attachment via ${formatDiscordCh(discordCh)} to hub ${hubState.id}.`));
          }
          hubState.reticulumCh.sendMessage(msg.author.username, "image", { "src": attachment.url });
        }
        return;
      }

      switch (args[1]) {

      case undefined: {
        // "!hubs" == emit useful info about the current bot and hub state
        if (hubState != null) {
          const userCount = Object.values(hubState.reticulumCh.getUsers()).length;
          await discordCh.send(
            HELP_PREFIX + `.\n\n` +
              `🦆 <#${discordCh.id}> bridged to Hubs room "${hubState.name}" (${hubState.id}) at <${hubState.url}>.\n` +
              `🦆 ${activeWebhook ? `Bridging chat using the webhook "${activeWebhook.name}" (${activeWebhook.id}).` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n` +
              `🦆 Connected since ${moment(hubState.ts).format("LLLL z")}.\n` +
              `🦆 There are ${userCount} users in the room.`
          );
        } else {
          const candidateWebhook = await getHubsWebhook(msg.channel);
          await discordCh.send(
            HELP_PREFIX + `.\n\n` +
              `🦆 This channel isn't bridged to any room on Hubs. Use \`!hubs create\` to create a room, or add an existing Hubs room to the topic to bridge it.\n` +
              `🦆 ${candidateWebhook ? `The webhook "${candidateWebhook.name}" (${candidateWebhook.id}) will be used for bridging chat.` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n`
          );
        }
        return;
      }

      case "help": {
        // !hubs help == bot command reference
        await discordCh.send(COMMAND_HELP_TEXT);
        return;
      }

      case "create": {
        // should this check the topic, or hubState? does it matter?
        if (topicManager.matchHub(discordCh.topic)) {
          await discordCh.send("A Hubs room is already bridged in the topic, so I am cowardly refusing to replace it.");
          return;
        }

        if (args.length === 2) { // !hubs create
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHubFromUrl(discordCh.name);
          const updatedTopic = topicManager.addHub(discordCh.topic, hubUrl);
          if (await trySetTopic(discordCh, updatedTopic) != null) {
            await reticulumClient.bindHub(hubId, discordCh.guild.id, discordCh.id);
          }
          return;
        }

        const { sceneUrl, sceneId, sceneSlug } = topicManager.matchScene(args[2]) || {};
        const name = args.length === 4 ? args[3] : (sceneSlug || discordCh.name);
        const guildId = discordCh.guild.id;
        if (sceneUrl) { // !hubs create [scene URL] [name]
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHubFromScene(name, sceneId);
          const updatedTopic = topicManager.addHub(discordCh.topic, hubUrl);
          if (await trySetTopic(discordCh, updatedTopic) != null) {
            await reticulumClient.bindHub(hubId, guildId, discordCh.id);
          }
        } else { // !hubs create [environment URL] [name]
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHubFromUrl(name, args[2]);
          const updatedTopic = topicManager.addHub(discordCh.topic, hubUrl);
          if (await trySetTopic(discordCh, updatedTopic) != null) {
            await reticulumClient.bindHub(hubId, guildId, discordCh.id);
          }
        }
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
        if (hubState != null) {
          const names = Object.values(hubState.reticulumCh.getUsers()).map(info => info.metas[0].profile.displayName);
          if (names.length) {
            await discordCh.send(`Users currently in <${hubState.url}>: **${names.join(", ")}**`);
          } else {
            await discordCh.send(`No users currently in <${hubState.url}>.`);
          }
        } else {
          await discordCh.send("No Hubs room is currently bridged to this channel.");
        }
        return;
      }

      case "stats": {
        // "!hubs stats" == stats for the current hub
        if (hubState != null) {
          await discordCh.send(formatStats(hubState.stats.summarize(), hubState.url));
        } else {
          await discordCh.send("No Hubs room is currently bridged to this channel.");
        }
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
