// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

if (process.env.SENTRY_DSN) {
  const Sentry = require("@sentry/node");
  Sentry.init({ dsn: process.env.SENTRY_DSN });
}

const moment = require('moment-timezone');
const discord = require('discord.js');
const schedule = require('node-schedule');
const { Bridges, HubState } = require("./bridges.js");
const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");
const { NotificationManager } = require("./notifications.js");
const { HubStats } = require("./hub-stats.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { StatsdClient } = require("./statsd-client.js");

// someday we will probably have different locales and timezones per server
moment.tz.setDefault(process.env.TIMEZONE);
moment.locale(process.env.LOCALE);

const VERBOSE = (process.env.VERBOSE === "true");

function logger(kind, msg, data) {
  if ((kind !== "push" && kind !== "receive" && msg !== "dropping outdated message") || VERBOSE) {
    console.log("Phoenix:", kind, msg, data);
  }
}

const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const MEDIA_DEDUPLICATE_MS = 60 * 60 * 1000; // 1 hour
const IMAGE_URL_RE = /\.(png)|(gif)|(jpg)|(jpeg)$/;
const ACTIVE_ICON = "🔸";
const ACTIVE_WEBHOOKS = {}; // { discordChId: webhook }
const DISABLED_EVENTS = [ // only bother to disable processing on relatively high-volume events
  "TYPING_START",
  "MESSAGE_REACTION_ADD",
  "MESSAGE_REACTION_REMOVE",
  "PRESENCE_UPDATE"
];

// base64ified so we don't have to sit around wondering where habitat drops files on the filesystem
const DUCK_AVATAR = "data:image/png;base64,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";

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

  constructor(id = "global") {
    this.id = id;
    this.size = 0;
    this.curr = Promise.resolve();
    this._onSizeChanged();
  }

  _onSizeChanged() {
    if (this.size >= 5 || VERBOSE) {
      console.log(`Event queue [${this.id}] size: ${this.size}`);
    }
  }

  // Enqueues the given function to run as soon as no other functions are currently running.
  enqueue(fn) {
    this.size += 1;
    this._onSizeChanged();
    return (this.curr = this.curr
      .then(_ => fn())
      .catch(e => {
        console.error(`Event queue [${this.id}] exception: ${ts(e.stack)}`);
      })
      .finally(() => {
        this.size -= 1;
        this._onSizeChanged();
      }));
  }

}

// Creates global an per channel event queues
class DiscordEventQueueManager {
  constructor() {
    this.globalQueue = new DiscordEventQueue();
    this.channelQueue = {};
  }

  enqueue(task, channelId = null) {
    let queue = this.globalQueue;
    if (channelId) {
      if (this.channelQueue[channelId]) {
        queue = this.channelQueue[channelId];
      } else {
        queue = this.channelQueue[channelId] = new DiscordEventQueue(channelId);
      }
    }
    const ret = queue.enqueue(task).then(() => {
      this._queueUpdated();
    });
    this._queueUpdated();
    
    return ret;
  }

  _queueUpdated() {
    if (statsdClient != null) {
      const size = this.globalQueue.size + Object.values(this.channelQueue).reduce((acc, item) => acc + item.size, 0);
      statsdClient.send("discord.queuesize", size, "g");
    }
  }
}

const q = new DiscordEventQueueManager();

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

// Formats a message of the form "Alice, Bob, and Charlie".
function formatList(users) {
  if (users.length === 1) {
    return `**${users[0].name}**`;
  } else {
    return `**${users.slice(0, -1).map(u => u.name).join(", ")}** and **${users[users.length - 1].name}**`;
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

// Returns the name of a Discord channel without the presence indicator included.
function getChannelBaseName(annotatedName) {
  return annotatedName.replace(new RegExp(`${ACTIVE_ICON}$`, "u"), "");
}

// Updates the names of the given channels to have or not have the presence icon at the end of it, depending on whether
// anyone is in the room or not.
async function updateChannelPresenceIcons(channels, active) {
  for (const channel of channels) {
    const updatedName = active ? (getChannelBaseName(channel.name) + ACTIVE_ICON) : getChannelBaseName(channel.name);
    // disabled as an attempted hack. this check is a kind of obvious culprit for the "orange diamond" bug, because it
    // relies on the discord channel cache having the right name. it's a shame to not do it, because it means we're
    // hitting the discord API for no reason, but our scale isn't high enough that it really matters.
    // if (updatedName !== channel.name) {
    await channel.setName(updatedName, `Hubs room became ${active ? "active" : "inactive"}.`);
    // }
  }
}

// Returns a promise indicating when the Discord client is connected and ready to query the API.
async function connectToDiscord(client, token) {
  return new Promise((resolve, reject) => {
    client.on("ready", () => resolve(client));
    client.login(token).catch(e => reject(e));
  });
}

async function tryGetWebhook(discordCh) {
  const hooks = await discordCh.fetchWebhooks();
  return hooks.find(h => h.name === process.env.HUBS_HOOK) || hooks.first();
}

// Gets the canonical Hubs webhook to post messages through for a Discord channel, or creates one if it doesn't exist.
// Complains if we don't have "manage webhooks" permission.
async function tryGetOrCreateWebhook(discordCh) {
  try {
    const existingHook = await tryGetWebhook(discordCh);
    if (existingHook != null) {
      return existingHook;
    } else {
      const newHook = await discordCh.createWebhook(process.env.HUBS_HOOK, DUCK_AVATAR, "Bridging chat between Hubs and Discord.");
      discordCh.send(`Created a new webhook (${newHook.id}) to use for Hubs chat bridging.`);
      return newHook;
    }
  } catch(e) {
    if (!(e instanceof discord.DiscordAPIError)) {
      throw e;
    } else {
      discordCh.send("Sorry, but you'll need to give me \"manage webhooks\" permission, or else I won't be able to use webhooks to bridge chat.");
      return null;
    }
  }
}

async function tryPin(discordCh, message) {
 try {
   return await message.pin();
  } catch(e) {
    if (!(e instanceof discord.DiscordAPIError)) {
      throw e;
    } else {
      message.edit("Sorry, but you'll need to give me \"manage messages\" and \"read message history\" permissions, or else I won't be able to pin messages for notifications.");
      return null;
    }
  }
}

// Sets the topic to something new, or complains if we don't have "manage channel" permissions.
async function trySetTopic(discordCh, newTopic) {
  try {
    return await discordCh.setTopic(newTopic);
  } catch(e) {
    if (!(e instanceof discord.DiscordAPIError)) {
      throw e;
    } else {
      discordCh.send("Sorry, but you'll need to give me \"manage channel\" permissions in this channel to do that, so that I can change the topic.");
      return null;
    }
  }
}

// Wires up the given HubState so that messages coming out of its Reticulum channel are bridged to wherever they ought to go,
// per the set of bridges currently present in `bridges`.
async function establishBridging(hubState, bridges) {
  const { reticulumCh, presenceRollups } = hubState;

  const lastPresenceMessages = {}; // { discordCh: message object }
  presenceRollups.on('new', ({ kind, users, fresh }) => {
    try {
      if (statsdClient != null) {
        statsdClient.send("reticulum.presencechanges", 1, "c");
      }
      for (const discordCh of bridges.getChannels(hubState.id).values()) {
        if (VERBOSE) {
          console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
        }
        if (kind === "arrive") {
          const msg = fresh ?
            `${formatList(users)} joined the Hubs room. Join them: ${hubState.shortUrl}` :
            `${formatList(users)} joined the Hubs room.`;
          lastPresenceMessages[discordCh.id] = discordCh.send(msg);
        } else if (kind === "depart") {
          const msg = `${formatList(users)} left the Hubs room.`;
          lastPresenceMessages[discordCh.id] = discordCh.send(msg);
        } else if (kind === "rename") {
          lastPresenceMessages[discordCh.id] = discordCh.send(formatRename(users[0]));
        }
      }
    } catch (e) {
      console.error(ts(`Error relaying presence ${kind} in ${hubState.id}.`), e);
    }
  });
  presenceRollups.on('update', ({ kind, users, fresh }) => {
    try {
      if (statsdClient != null) {
        statsdClient.send("reticulum.presencechanges", 1, "c");
      }
      for (const discordCh of bridges.getChannels(hubState.id).values()) {
        if (VERBOSE) {
          console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
        }
        if (kind === "arrive") {
          const msg = fresh ?
            `${formatList(users)} joined the Hubs room. Join them: ${hubState.shortUrl}` :
            `${formatList(users)} joined the Hubs room.`;
          lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev => prev.edit(msg));
        } else if (kind === "depart") {
          const msg = `${formatList(users)} left the Hubs room.`;
          lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev => prev.edit(msg));
        } else if (kind === "rename") {
          lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev => prev.edit(formatRename(users[0])));
        }
      }
    } catch (e) {
      console.error(ts(`Error relaying presence update ${kind} in ${hubState.id}.`), e);
    }
  });

  reticulumCh.on('rescene', (timestamp, id, whom, scene) => {
    try {
      for (const discordCh of bridges.getChannels(hubState.id).values()) {
        if (VERBOSE) {
          console.debug(ts(`Relaying scene change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
        }
        if (scene) {
          discordCh.send(`${whom} changed the scene in ${hubState.shortUrl} to ${scene.name}.`);
        } else {
          // the API response has a totally convoluted structure we could use to dig up the scene URL in theory,
          // but it doesn't seem worth reproducing the dozen lines of hubs code that does this here
          discordCh.send(`${whom} changed ${hubState.shortUrl} to a new scene.`);
        }
      }
    } catch (e) {
      console.error(ts(`Error relaying presence scene change by ${whom} (${id}) in ${hubState.id}.`), e);
    }
  });
  reticulumCh.on('renamehub', (timestamp, id, whom, name, slug) => {
    try {
      for (const discordCh of bridges.getChannels(hubState.id).values()) {
        hubState.name = name;
        hubState.slug = slug;
        if (VERBOSE) {
          console.debug(ts(`Relaying name change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
        }
        discordCh.send(`${whom} renamed the Hubs room at ${hubState.shortUrl} to ${hubState.name}.`);
      }
    } catch (e) {
      console.error(ts(`Error relaying name change by ${whom} (${id}) in ${hubState.id}.`), e);
    }
  });

  const mediaBroadcasts = {}; // { url: timestamp }
  reticulumCh.on("message", (timestamp, id, whom, type, body) => {
    try {
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
        } else if (type === "photo" || type == "video") {
          // we like to just broadcast all camera photos and videos, without waiting for anyone to pin them
          webhook.send(body.src, { username: whom });
        }
      }
    } catch (e) {
      console.error(ts(`Error relaying message of type ${type} from ${whom} (${id}) via ${hubState.id}.`), e);
    }
  });

  reticulumCh.on('sync', async () => {
    try {
      await updateChannelPresenceIcons(bridges.getChannels(hubState.id).values(), reticulumCh.getUserCount() > 0);
    } catch (e) {
      console.error(ts(`Error updating channel presence icons in ${hubState.id}`), e);
    }
  });

  // also get it right for the initial state
  await updateChannelPresenceIcons(bridges.getChannels(hubState.id).values(), reticulumCh.getUserCount() > 0);
}

function scheduleSummaryPosting(bridges) {
  // only enable on hubs discord and test server until we're sure we like this
  const whitelistedGuilds = new Set(["525537221764317195", "498741086295031808"]);
  const rule = new schedule.RecurrenceRule(null, null, null, null, null, 0, 0);
  return schedule.scheduleJob(rule, function(date) {
    const end = moment(date);
    const start = moment(end).subtract(1, "days");
    if (end.hour() !== 0) { // only post once, at midnight local time
      return;
    }
    q.enqueue(async () => {
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

  let resp;
  try {
    resp = (await reticulumCh.connect()).hubs[0];
  } catch(e) {
    if (e.reason && (e.reason === "closed" || e.reason === "join_denied" || e.reason === "not_found")) {
      await reticulumCh.close();
    }

    throw e;
  }

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

  // wait until after the first sync, because we don't want to take action related to users who were already here
  let initialSync = false;
  reticulumCh.on("sync", () => {
    if (!initialSync) {
      initialSync = true;
      presenceRollups.subscribeToChannel(reticulumCh);
    }
  });

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
  const reticulumClient = new ReticulumClient(reticulumHost, logger);
  await reticulumClient.connect();
  console.info(ts(`Connected to Reticulum @ ${reticulumHost}.`));

  const connectedHubs = {}; // { hubId: hubState }
  const bridges = new Bridges();
  const notificationManager = new NotificationManager();
  const topicManager = new TopicManager(HOSTNAMES);

  scheduleSummaryPosting(bridges, q);

  // one-time scan through all channels to look for existing bridges
  console.info(ts(`Scanning channel topics for Hubs hosts: ${HOSTNAMES.join(", ")}`));
  {
    const textChannels = discordClient.channels.cache.array().filter(ch => ch.type === "text");
    const candidateBridges = findBridges(topicManager, textChannels);

    for (const [key, channels] of candidateBridges.entries()) {
      const [host, hubId] = key.split(" ", 2);
      try {
        const hubState = connectedHubs[hubId] = await connectToHub(reticulumClient, channels, host, hubId);
        for (const discordCh of channels) {
          bridges.associate(hubState, discordCh);
          ACTIVE_WEBHOOKS[discordCh.id] = await tryGetWebhook(discordCh);
          console.info(ts(`Hubs room ${hubState.id} bridged to ${formatDiscordCh(discordCh)}.`));
        }
        await establishBridging(hubState, bridges);
      } catch (e) {
        console.error(ts(`Error bridging Hubs room ${hubId}:`), e);
      }
    }
    const { nChannels, nGuilds, nRooms } = getBridgeStats(bridges);
    console.info(ts(`Scan finished; ${nChannels} channel(s), ${nRooms} room(s), ${nGuilds} guild(s).`));

    for (const discordCh of textChannels) {
      try {
        // evaluate permissions as a kind of short-circuiting because asking for pinned messages is slow
        // and it sucks to have to do it on literally every random channel in a server that the bot can read
        const perms = discordCh.permissionsFor(discordClient.user);
        if (perms.has([
          discord.Permissions.FLAGS.MANAGE_MESSAGES,
          discord.Permissions.FLAGS.VIEW_CHANNEL,
          discord.Permissions.FLAGS.READ_MESSAGES,
          discord.Permissions.FLAGS.READ_MESSAGE_HISTORY
        ])) {
          const pins = await discordCh.messages.fetchPinned();
          const notifications = pins.filter(msg => {
            return msg.author.id === discordClient.user.id && NotificationManager.parseTimestamp(msg).isValid();
          });
          for (const msg of notifications.values()) {
            notificationManager.add(NotificationManager.parseTimestamp(msg), msg);
          }
        } else {
          if (VERBOSE) {
            console.debug(ts(`Skipping notification scan on Discord channel ${formatDiscordCh(discordCh)}.`));
          }
        }
      } catch (e) {
        console.error(ts(`Error loading notifications for Discord channel ${formatDiscordCh(discordCh)}:`), e);
      }
    }
    console.info(ts(`Notifications loaded; ${notificationManager.data.size} entries.`));
    notificationManager.start();
  }

  notificationManager.on('notify', async (_when, msg) => {
    if (VERBOSE) {
      console.debug(ts(`Sending notification in channel ${formatDiscordCh(msg.channel)}`));
    }
    const hubState = bridges.getHub(msg.channel.id);
    const description = hubState != null ? `the Hubs room: ${hubState.shortUrl}` : "a Hubs room.";
    try {
      await msg.channel.send(`@here Hey! You should join ${description}`, { disableEveryone: false });
      await msg.unpin();
    } catch(e) {
      console.error(ts(`Error sending notification in channel ${formatDiscordCh(msg.channel)}:`), e);
    }
  });

  // Gets debug event and some rate limit events in the shape of a 429 message (ie. set channel topic)
  discordClient.on("debug", (...args) => {
    if (args[0].startsWith("429")) {
      if (statsdClient != null) {
        statsdClient.send("discord.error429", 1, "c");
      }
    }
    console.log("Debug: ", ...args);
  });

  // Gets rate limit events for some (not all) routes (ie. get channel pins)
  discordClient.on("rateLimit", info => {
    console.log(`Rate limit hit:`);
    console.log(`\ttimeout: ${info.timeout}`);
    console.log(`\tlimit: ${info.limit}`);
    console.log(`\tmethod: ${info.method}`);
    console.log(`\tpath: ${info.path}`);
    console.log(`\troute: ${info.route}`);
    if (statsdClient != null) {
      statsdClient.send("discord.rateLimit", 1, "c");
    }
  });

  discordClient.on('webhookUpdate', (discordCh) => {
    q.enqueue(async () => {
      const hubState = bridges.getHub(discordCh.id);
      if (hubState != null) {
        try {
          // don't create a new webhook except when users try to make a bridge, but respect changes to the webhook configuration
          // and use the most up-to-date available webhooks there
          const oldWebhook = ACTIVE_WEBHOOKS[discordCh.id];
          const newWebhook = await tryGetWebhook(discordCh);
          if (oldWebhook != null && newWebhook == null) {
            await discordCh.send("Webhook disabled; Hubs will no longer bridge chat. Re-add a channel webhook to re-enable chat bridging.");
          } else if (newWebhook != null && (oldWebhook == null || newWebhook.id !== oldWebhook.id)) {
            await discordCh.send(`The webhook "${newWebhook.name}" (${newWebhook.id}) will now be used for bridging chat in Hubs.`);
          }
          ACTIVE_WEBHOOKS[discordCh.id] = newWebhook;
        } catch(e) {
          if (!(e instanceof discord.DiscordAPIError)) { // if we don't have webhook looking permissions just ignore
            throw e;
          }
        }
      }
    }, discordCh.id);
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
            await establishBridging(currHub, bridges);
            bridges.associate(currHub, newChannel);
          } else {
            bridges.associate(currHub, newChannel);
            const bridgedChannels = bridges.getChannels(currHubId);
            currHub.reticulumCh.updateProfile(serializeProfile("Hubs Bot", Array.from(bridgedChannels.values())));
          }
          ACTIVE_WEBHOOKS[newChannel.id] = await tryGetOrCreateWebhook(newChannel);
          console.info(ts(`Hubs room ${currHubId} bridged to ${formatDiscordCh(newChannel)}.`));
          await newChannel.send(`<#${newChannel.id}> bridged to ${currHubUrl}.`);
        }
      } catch (e) {
        const prevHubDesc = prevHub != null ? prevHub.id : "nowhere";
        const currHubDesc = currHubId != null ? currHubId : "nowhere";
        console.error(ts(`Failed to update ${formatDiscordCh(newChannel)} bridge from ${prevHubDesc} to ${currHubDesc}:`), e);
      }
    }, oldChannel.id);
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
        "🦆 `!hubs notify set [datetime]` - Sets a one-time notification to notify @here to join the room at some future time.\n" +
        "🦆 `!hubs notify clear` - Removes all pending notifications.\n" +
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
        return discordCh.send(HELP_PREFIX + "\n\n" +
          "I only work in public channels. Find a channel that you want to be bridged to a Hubs room and talk to me there.\n\n" +
          "If you're curious about what I do, try `!hubs help` or check out https://github.com/MozillaReality/hubs-discord-bot."
        );
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
          return discordCh.send(
            HELP_PREFIX + `.\n\n` +
              `🦆 <#${discordCh.id}> bridged to Hubs room "${hubState.name}" (${hubState.id}) at <${hubState.url}>.\n` +
              `🦆 ${activeWebhook ? `Bridging chat using the webhook "${activeWebhook.name}" (${activeWebhook.id}).` : "No webhook configured. Add a channel webhook to bridge chat to Hubs."}\n` +
              `🦆 Connected since ${moment(hubState.ts).format("LLLL z")}.\n` +
              `🦆 There ${userCount == 1 ? "is 1 user" : `are ${userCount} users`} in the room.`
          );
        } else {
          return discordCh.send(
            HELP_PREFIX + `.\n\n` +
              `🦆 This channel isn't bridged to any room on Hubs. Use \`!hubs create\` to create a room, or add an existing Hubs room to the topic to bridge it.\n`
          );
        }
      }

      case "help": {
        // !hubs help == bot command reference
        return discordCh.send(COMMAND_HELP_TEXT);
      }

      case "create": {
        // should this check the topic, or hubState? does it matter?
        if (topicManager.matchHub(discordCh.topic)) {
          return discordCh.send("A Hubs room is already bridged in the topic, so I am cowardly refusing to replace it.");
        }

        const url = args.length > 2 ? args[2] : process.env.DEFAULT_SCENE_URL;
        const { sceneId } = topicManager.matchScene(url) || {};
        const name = args.length > 3 ? args[3] : getChannelBaseName(discordCh.name);
        const guildId = discordCh.guild.id;
        if (sceneId) { // !hubs create [scene URL] [name]
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHubFromScene(name, sceneId);
          const updatedTopic = topicManager.addHub(discordCh.topic, hubUrl);
          if (await trySetTopic(discordCh, updatedTopic) != null) {
            return reticulumClient.bindHub(hubId, guildId, discordCh.id);
          }
        } else { // !hubs create [environment URL] [name]
          const { url: hubUrl, hub_id: hubId } = await reticulumClient.createHubFromUrl(name, url);
          const updatedTopic = topicManager.addHub(discordCh.topic, hubUrl);
          if (await trySetTopic(discordCh, updatedTopic) != null) {
            return reticulumClient.bindHub(hubId, guildId, discordCh.id);
          }
        }
        return;
      }

      case "remove": {
        // "!hubs remove" == if a hub is bridged, remove it
        const { hubUrl } = topicManager.matchHub(discordCh.topic) || {};
        if (!hubUrl) {
          return discordCh.send("No Hubs room is bridged in the topic, so doing nothing :eyes:");
        }

        return trySetTopic(discordCh, topicManager.removeHub(discordCh.topic));
      }

      case "users": {
        // "!hubs users" == list users
        if (hubState != null) {
          const names = Object.values(hubState.reticulumCh.getUsers()).map(info => info.metas[0].profile.displayName);
          if (names.length) {
            return discordCh.send(`Users currently in <${hubState.url}>: **${names.join(", ")}**`);
          } else {
            return discordCh.send(`No users currently in <${hubState.url}>.`);
          }
        } else {
          return discordCh.send("No Hubs room is currently bridged to this channel.");
        }
      }

      case "stats": {
        // "!hubs stats" == stats for the current hub
        if (hubState != null) {
          return discordCh.send(formatStats(hubState.stats.summarize(), hubState.url));
        } else {
          return discordCh.send("No Hubs room is currently bridged to this channel.");
        }
      }

      case "notify": {
        if (args.length === 2) {
          return discordCh.send(COMMAND_HELP_TEXT);
        }
        if (args.length === 3 && args[2] !== "clear") {
          return discordCh.send(COMMAND_HELP_TEXT);
        }
        if (args.length >= 4 && args[2] !== "set") {
          return discordCh.send(COMMAND_HELP_TEXT);
        }
        if (args.length === 3) { // !hubs notify clear
          const pins = await discordCh.messages.fetchPinned();
          const notifications = pins.filter(msg => {
            return msg.author.id === discordClient.user.id && NotificationManager.parseTimestamp(msg).isValid();
          });
          if (notifications.size === 0) {
            return discordCh.send("No notifications were scheduled, so there's nothing to remove.");
          } else {
            for (const msg of notifications.values()) {
              await msg.delete();
              notificationManager.remove(NotificationManager.parseTimestamp(msg), msg);
            }
            return discordCh.send(`Removed ${notifications.size} scheduled notification(s).`);
          }
        } else { // !hubs notify set [date/time descriptor]
          const descriptor = args.slice(3).join(" ");
          const when = moment(descriptor);
          if (!when.isValid()) {
            return discordCh.send("Sorry, I can't tell what time you are trying to tell me :(  I can read any time that Javascript's `Date.parse` knows how to read: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse");
          }
          const msg = await discordCh.send(NotificationManager.formatMessage(when));
          if (await tryPin(discordCh, msg) != null) {
            notificationManager.add(when, msg);
          }
          return;
        }
      }

      case "kill": {
        // todo: probably make this configurable
        const WHITELISTED_USERS = [
          "339914448032497664", // gfodor
          "544406895889350676", // elgin
          "407386567305330688", // liv
          "146595594155196416" // mqp
        ];
        if (!WHITELISTED_USERS.includes(msg.author.id)) {
          return discordCh.send("You are not powerful enough to kill the bot.");
        }
        await discordCh.send("Goodbye, cruel world!");
        process.exit(0);
      }

      }

    }, discordCh.id);

  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
