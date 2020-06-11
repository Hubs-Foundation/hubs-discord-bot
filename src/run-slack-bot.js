process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
require("dotenv").config();

const moment = require("moment-timezone");
const schedule = require("node-schedule");
const { Bridges, HubState } = require("./bridges.js");
const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");
const { NotificationManager } = require("./notifications.js");
const { HubStats } = require("./hub-stats.js");
const { PresenceRollups } = require("./presence-rollups.js");
const { StatsdClient } = require("./statsd-client.js");
const {
  ts,
  DUCK_AVATAR,
  formatRename,
  formatList,
  formatStats,
  helpCommandText,
  helpPrefix
} = require("./text-helpers.js");
const { BotEventQueue } = require("./helpers.js");

const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const IMAGE_URL_RE = /\.(png)|(gif)|(jpg)|(jpeg)$/;
const ACTIVE_ICON = "🔸";
const VERBOSE = process.env.VERBOSE;

let statsdClient = null;
const statsdHost = process.env.STATSD_HOST;
if (statsdHost) {
  const [hostname, port] = statsdHost.split(":");
  statsdClient = new StatsdClient(hostname, port ? parseInt(port, 10) : 8125, process.env.STATSD_PREFIX);
  console.info(ts(`Sending metrics to statsd @ ${statsdHost}.`));
}
const q = new BotEventQueue(statsdClient);

function getChannelName(channelInfo) {
  return channelInfo.name;
}
function getChannelTopic(channelInfo) {
  return channelInfo.topic.value;
}
async function getChannelList() {
  // permissions "needed": "channels:read,groups:read,mpim:read,im:read"
  try {
    // Call the conversations.list method using the built-in WebClient
    const result = await app.client.conversations.list({
      token: process.env.SLACK_BOT_TOKEN
    });
    return result.channels;
  } catch (error) {
    console.error(error);
  }
}
async function getChannelInfo(channelId) {
  try {
    const result = await app.client.conversations.info({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId
    });
    return result.channel;
  } catch (e) {
    console.log(e);
  }
}

// // Put conversations into the JavaScript object
// const conversationsStore = {};
// function saveConversations(conversationsArray) {
//   let conversationId = "";
//   conversationsArray.forEach(function(conversation) {
//     // Key conversation info on its unique ID
//     conversationId = conversation.id;
//     // Store the entire conversation object (you may not need all of the info)
//     conversationsStore[conversationId] = conversation;
//   });
// }

const SET_CHANNEL_TOPIC = "setChannelTopic";
async function setChannelTopic(channelId, newTopic) {
  // permissions "needed": "channels:write,groups:write,mpim:write,im:write",
  try {
    const result = await app.client.conversations.setTopic({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      topic: newTopic
    });
    return result.channel; // channelInfo
  } catch (e) {
    console.log(e);
    console.log(e.data);
    if (isMissingScopeError(e)) {
      // setting custom permissions to match bot oauth
      // not user oauth
      handleMissingScope(SET_CHANNEL_TOPIC, "channels:manage,groups:write,im:write,mpim:write", channelId);
    } else {
      // another unexpected error
      console.log(e);
    }
    return null;
  }
}

const ACTION_TO_MESSAGE = {
  [SET_CHANNEL_TOPIC]: "To change the channel topic"
};
const DIRECTIONS_TO_MANAGE_BOT_SCOPES =
  'Select your Hubs Slack bot in: https://api.slack.com/apps > "OAuth & Permissions" > "Scopes" section > Click "Add an OAuth Scope" > Add needed scopes for bot oauth then try again.';
/**
 * If missing permission error and tell user that the bot needs additional permissions to do action
 * Generally arguments for slack is (SET_CHANNEL_TOPIC, e.data.needed, channelId)
 * @param {*} error
 */
async function handleMissingScope(action, neededScopes, channelId) {
  const actionMessage = `${ACTION_TO_MESSAGE[action]}, I need "${neededScopes}" bot token scopes.\n\n${DIRECTIONS_TO_MANAGE_BOT_SCOPES}`;
  try {
    sendMessageToChannel(channelId, actionMessage);
  } catch (e) {
    console.log(e);
  }
}

const MISSING_SCOPE = "missing_scope";
const API_PLATFORM_ERROR = "slack_webapi_platform_error";
/**
 * Many platforms have different ways of checking if it's a scope error
 * Specific to this platform pass in the error and see if it's a missing scope error
 */
function isMissingScopeError(error) {
  return error.code === API_PLATFORM_ERROR && error.data && error.data.error === MISSING_SCOPE;
}

async function renameChannel(channelId, newName) {
  try {
    const result = await app.client.conversations.rename({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      name: newName
    });
    return result.channel; // channelInfo
  } catch (error) {
    console.error(error);
  }
}

// Formats a Slack channel reference, displays the team, channel name, and ID.
function formatChannel(channelName, channelId, teamName, teamId) {
  if (VERBOSE && teamName && channelName) {
    return `${teamName}/#${channelName} (${channelId})`;
  } else if (teamId) {
    return `${teamId}/${channelId}`;
  } else {
    return channelId;
  }
}

// sends a message to channel
async function sendMessageToChannel(channelId, text) {
  try {
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      // Text in the notification
      text: text
    });
  } catch (e) {
    console.error(e);
  }
}

// https://api.slack.com/events-api#subscriptions
// Choosing event subscriptions in your app
// channels_rename
// Events dispatched as JSON
// Get a POST request to your request URL
// API Event types https://api.slack.com/events

// slash commands must enable it on the bot level
// Create new Command

// Returns a mapping of { (host, hubId): [discord channels] } for Hubs bridges in the given channels.
function findBridges(topicManager, channels) {
  const result = new Map();
  for (const channel of channels) {
    const { hubUrl, hubId } = topicManager.matchHub(getChannelTopic(channel)) || {};
    if (hubUrl != null) {
      const key = `${hubUrl.host} ${hubId}`;
      let bridgedChannels = result.get(key);
      if (bridgedChannels == null) {
        result.set(key, (bridgedChannels = []));
      }
      bridgedChannels.push(channel);
    }
  }
  return result;
}

// Wires up the given HubState so that messages coming out of its Reticulum channel are bridged to wherever they ought to go,
// per the set of bridges currently present in `bridges`.
async function establishBridging(hubState, bridges) {
  const { reticulumCh, presenceRollups } = hubState;

  const lastPresenceMessages = {}; // { discordCh: message object }
  presenceRollups.on("new", ({ kind, users, fresh }) => {
    if (statsdClient != null) {
      statsdClient.send("reticulum.presencechanges", 1, "c");
    }
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      if (kind === "arrive") {
        const msg = fresh
          ? `${formatList(users)} joined the Hubs room. Join them: ${hubState.shortUrl}`
          : `${formatList(users)} joined the Hubs room.`;
        lastPresenceMessages[discordCh.id] = discordCh.send(msg);
      } else if (kind === "depart") {
        const msg = `${formatList(users)} left the Hubs room.`;
        lastPresenceMessages[discordCh.id] = discordCh.send(msg);
      } else if (kind === "rename") {
        lastPresenceMessages[discordCh.id] = discordCh.send(formatRename(users[0]));
      }
    }
  });
  presenceRollups.on("update", ({ kind, users, fresh }) => {
    if (statsdClient != null) {
      statsdClient.send("reticulum.presencechanges", 1, "c");
    }
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(ts(`Relaying presence ${kind} in ${hubState.id} to ${formatDiscordCh(discordCh)}.`));
      }
      if (kind === "arrive") {
        const msg = fresh
          ? `${formatList(users)} joined the Hubs room. Join them: ${hubState.shortUrl}`
          : `${formatList(users)} joined the Hubs room.`;
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev => prev.edit(msg));
      } else if (kind === "depart") {
        const msg = `${formatList(users)} left the Hubs room.`;
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev => prev.edit(msg));
      } else if (kind === "rename") {
        lastPresenceMessages[discordCh.id] = lastPresenceMessages[discordCh.id].then(prev =>
          prev.edit(formatRename(users[0]))
        );
      }
    }
  });

  reticulumCh.on("rescene", (timestamp, id, whom, scene) => {
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      if (VERBOSE) {
        console.debug(
          ts(`Relaying scene change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`)
        );
      }
      if (scene) {
        discordCh.send(`${whom} changed the scene in ${hubState.shortUrl} to ${scene.name}.`);
      } else {
        // the API response has a totally convoluted structure we could use to dig up the scene URL in theory,
        // but it doesn't seem worth reproducing the dozen lines of hubs code that does this here
        discordCh.send(`${whom} changed ${hubState.shortUrl} to a new scene.`);
      }
    }
  });
  reticulumCh.on("renamehub", (timestamp, id, whom, name, slug) => {
    for (const discordCh of bridges.getChannels(hubState.id).values()) {
      hubState.name = name;
      hubState.slug = slug;
      if (VERBOSE) {
        console.debug(
          ts(`Relaying name change by ${whom} (${id}) in ${hubState.id} to ${formatDiscordCh(discordCh)}.`)
        );
      }
      discordCh.send(`${whom} renamed the Hubs room at ${hubState.shortUrl} to ${hubState.name}.`);
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
            console.debug(
              ts(
                `Declining to rebroadcast ${body.src} only ${(elapsedMs / 1000).toFixed(
                  0
                )} second(s) after previous broadcast.`
              )
            );
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
          console.debug(
            `Ignoring message of type ${type} in ${formatDiscordCh(discordCh)} because no webhook is associated.`
          );
        }
        return;
      }
      if (VERBOSE) {
        const msg = ts(
          `Relaying message of type ${type} from ${whom} (${id}) via ${hubState.id} to ${formatDiscordCh(
            discordCh
          )}: %j`
        );
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
  });

  reticulumCh.on("sync", async () => {
    await updateChannelPresenceIcons(bridges.getChannels(hubState.id).values(), reticulumCh.getUserCount() > 0);
  });

  // also get it right for the initial state
  await updateChannelPresenceIcons(bridges.getChannels(hubState.id).values(), reticulumCh.getUserCount() > 0);
}

// Connects to the Phoenix channel for a hub and returns a HubState for that hub.
async function connectToHub(reticulumClient, discordChannels, host, hubId) {
  const reticulumCh = reticulumClient.channelForHub(hubId, serializeProfile("Hubs Bot", discordChannels));
  reticulumCh.on("connect", (timestamp, id) => {
    console.info(ts(`Connected to Hubs room ${hubId} with session ID ${id}.`));
  });
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

async function establishBridgingWithCandidateBridges(reticulumClient, candidateBridges, connectedHubs) {
  for (const [key, channels] of candidateBridges.entries()) {
    const [host, hubId] = key.split(" ", 2);
    try {
      const hubState = (connectedHubs[hubId] = await connectToHub(reticulumClient, channels, host, hubId));
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
      if (
        perms.has([
          discord.Permissions.FLAGS.MANAGE_MESSAGES,
          discord.Permissions.FLAGS.READ_MESSAGES,
          discord.Permissions.FLAGS.READ_MESSAGE_HISTORY
        ])
      ) {
        const pins = await discordCh.fetchPinnedMessages();
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

async function searchForChannelTopicsAndHubHosts() {
  let channels = await getChannelList();
}

async function setupReticulumClient() {
  const reticulumHost = process.env.RETICULUM_HOST;
  const reticulumClient = new ReticulumClient(reticulumHost);
  try {
    await reticulumClient.connect();
  } catch (e) {
    console.log(e);
  }
  console.info(ts(`Connected to Reticulum @ ${reticulumHost}.`));
  return reticulumClient;
}

let reticulumClient = null;
let topicManager = null;
let bridges = null;
let connectedHubs = {};
let notificationManager = null;
async function start() {
  try {
    reticulumClient = await setupReticulumClient();
    console.log(reticulumClient);
    connectedHubs = {}; // { hubId: hubState }
    bridges = new Bridges();
    notificationManager = new NotificationManager();
    topicManager = new TopicManager(HOSTNAMES);
    // const candidateBridges = findBridges(topicManager, await getChannelList());
    // ***
    // todo scheduleSummaryPosting(bridges, q);
  } catch (e) {
    console.log(e);
  }
}

function setupWebhooks() {
  setupNotifications();
  setupSlackUpdates();
}

function setupNotifications() {
  notificationManager.on("notify", async (_when, msg) => {
    console.log("notificationManager.on(notify");
    if (msg && msg.channel && msg.channel.id) console.log(bridges.getHub(msg.channel.id));
  });
}

function setupSlackUpdates() {}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.command("/hubs", async ({ ack, payload, context }) => {
  await ack(); // Acknowledge command for slack
  const teamId = payload.team_id; // T0139U6GLR2
  const teamDomain = payload.team_domain; // hellohubs

  const channelId = payload.channel_id; // C0133V80YFM
  const channelName = payload.channel_name;
  const userId = payload.user_id;
  const userName = payload.user_name;

  const command = payload.text ? payload.text.split(" ")[0] : undefined;
  const argumentList = payload.text ? payload.text.split(" ").slice(1) : [];

  if (VERBOSE) {
    console.log(`teamId: ${teamId}, channelId: ${channelId}, userId: ${userId}`);
    console.log("command is: " + command);
    console.log("argumentList is: ");
    console.log(argumentList);
  }

  switch (command) {
    case undefined:
      await sendMessageToChannel(channelId, 'Type "/hubs help" if you need the list of available commands');
      break;
    case "help":
      // Shows text needed
      try {
        await sendMessageToChannel(channelId, helpCommandText("/hubs", "Slack"));
      } catch (e) {
        console.log(e);
      }
      break;
    case "create":
      // <hubsCommand> create [environment URL] [name]
      // <hubsCommand> create
      // should this check the topic, or hubState? does it matter?
      try {
        const channelInfo = await getChannelInfo(channelId);
        const channelTopic = getChannelTopic(channelInfo);
        const environmentURL = argumentList[0] ? argumentList[0] : process.env.DEFAULT_SCENE_URL;
        const name = argumentList[1] ? argumentList[1] : channelName;
        if (VERBOSE) {
          console.log("channelId is: " + channelId);
          console.log("arg1: environmentURL is: " + environmentURL);
          console.log("arg2: name is: " + name);
        }
        if (topicManager.matchHub(channelTopic)) {
          return sendMessageToChannel(
            channelId,
            "A Hubs room is already bridged in the topic, so I am cowardly refusing to replace it."
          );
        }

        await sendMessageToChannel(channelId, "Creating room...");

        const { sceneId } = topicManager.matchScene(environmentURL) || {};
        const { url: hubUrl, hub_id: hubId } = sceneId
          ? await reticulumClient.createHubFromScene(name, sceneId)
          : await reticulumClient.createHubFromUrl(name, environmentURL);
        const updatedTopic = topicManager.addHub(channelTopic, hubUrl);
        if (VERBOSE) console.log(`Updated topic is: "${updatedTopic}"`);
        if ((await setChannelTopic(channelId, updatedTopic)) != null) {
          if (VERBOSE) console.log("Set channel topic, now binding Hub: " + hubId);
          return reticulumClient.bindHub(hubId, "slack", teamId, channelId);
        }
      } catch (e) {
        console.log(e);
        return sendMessageToChannel(channelId, "Something went wrong, please try create command again.");
      }
      break;
    case "remove":
      // Shows text needed
      // "!hubs remove" == if a hub is bridged, remove it
      try {
        let channelInfo = await getChannelInfo(channelId);
        let curTopic = getChannelTopic(channelInfo);

        // In Slack topic, hub url is surrounded by '<>' in slack ex: <https://etc>
        // A topic set in slack with <> will not match regex. It's coded with '&gt;&lt;'
        curTopic = curTopic.replace(/[<>]/gi, "");
        const { hubUrl } = topicManager.matchHub(curTopic) || {};
        if (!hubUrl) {
          return sendMessageToChannel(channelId, "No Hubs room is bridged in the topic, so doing nothing :eyes:");
        }
        return setChannelTopic(channelId, topicManager.removeHub(curTopic));
      } catch (e) {
        console.log(e);
        await sendMessageToChannel(channelId, "Something went wrong, please try remove command again.");
      }
      break;
    case "users":
      // Shows text needed
      break;
    case "stats":
      // Shows text needed
      break;
    case "notify":
      // Shows text needed
      break;
    case "kill":
      // Shows text needed
      break;
    default:
      return sendMessageToChannel(channelId, 'Type "/hubs help" if you need the list of available commands');
  }
});

(async () => {
  // Start your app
  try {
    await start();
    await app.start(3000);
    console.log("⚡️ Bolt app is running! on port:" + 3000);
  } catch (e) {
    console.log("Something went wrong on starting slack bot server");
    console.log(e);
  }
})();
