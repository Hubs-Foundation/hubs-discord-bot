// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
require("dotenv").config();

const moment = require("moment-timezone");
const discord = require("discord.js");
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

const SLACK_BOT_API_BASE_URL = "https://slack.com/api/";
// https://api.slack.com/docs/conversations-api
const SLACK_SET_TOPIC = "conversations.setTopic";
const SLACK_GET_CHANNEL_LIST = "conversations.list";
const SLACK_GET_CHANNEL_INFO = "conversations.info";
const SLACK_RENAME_CHANNEL = "conversations.rename";

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
      // The token you used to initialize your app
      token: process.env.SLACK_BOT_TOKEN
    });
    return result.channels;
  } catch (error) {
    console.error(error);
  }
}

// Put conversations into the JavaScript object
const conversationsStore = {};
function saveConversations(conversationsArray) {
  let conversationId = "";
  conversationsArray.forEach(function(conversation) {
    // Key conversation info on its unique ID
    conversationId = conversation.id;
    // Store the entire conversation object (you may not need all of the info)
    conversationsStore[conversationId] = conversation;
  });
}

async function sendMessage() {}

async function changeChannelTopic(channelId, newTopic) {
  // permissions "needed": "channels:write,groups:write,mpim:write,im:write",
  try {
    const result = await app.client.conversations.setTopic({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId,
      topic: newTopic
    });
    return result.channel; // channelInfo
  } catch (error) {
    console.error(error);
  }
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

function formatChannel() {}

async function sendMessageToChannel(channelId, text) {
  try {
    const result = await app.client.chat.postMessage({
      token: context.botToken,
      channel: channelId,
      // Text in the notification
      text: text
    });
  } catch (e) {
    console.error(error);
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

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

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
  await reticulumClient.connect();
  console.info(ts(`Connected to Reticulum @ ${reticulumHost}.`));
  return reticulumClient;
}

async function start() {
  // ***
  // const reticulumClient = await setupReticulumClient();
  // const connectedHubs = {}; // { hubId: hubState }
  // const bridges = new Bridges();
  // const notificationManager = new NotificationManager();
  // const topicManager = new TopicManager(HOSTNAMES);
  // const candidateBridges = findBridges(topicManager, await getChannelList());
  // ***
  // todo scheduleSummaryPosting(bridges, q);
}

app.command("/hubs", async ({ ack, payload, context }) => {
  ack(); // Acknowledge command for slack

  const channelId = payload.channel_id;
  const channelName = payload.channel_name;
  const userId = payload.user_id;
  const userName = payload.user_name;

  const command = payload.text ? payload.text.split(" ")[0] : undefined;
  const argumentList = payload.text ? payload.text.split(" ").slice(1) : [];

  const hubState = bridges.getHub(channelId);
  switch (payload.text) {
    case undefined:
      // Shows general information about the Hubs integration with the current Discord channel
      await app.client.chat.postMessage({
        token: context.botToken,
        channel: channelId,
        // Text in the notification
        text: "Message from Test App"
      });
      break;
    case "help":
      // Shows text needed
      await sendMessageToChannel(channelId, helpCommandText("/hubs", "Slack"));
      break;
    case "create":
      await sendMessageToChannel(channelId, "Create was messaged");
      console.log(payload.channel);
      // if (topicManager.matchHub(discordCh.topic)) {
      //   return discordCh.send(
      //     "A Hubs room is already bridged in the topic, so I am cowardly refusing to replace it."
      //   );
      // }
      break;
    case "remove":
      // Shows text needed
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
      console.log(await getChannelList());
      await app.client.chat.postMessage({
        token: context.botToken,
        channel: channelId,
        // Text in the notification
        text: "Message from Test App"
      });
  }

  console.log("hello");
  console.log("payload text");
  console.log(payload.text ? payload.text : "NO PAYLOAD TEXT ADDED");
  console.log("context");
  console.log(context);
});

(async () => {
  // Start your app

  await app.start(3000);
  await start();

  console.log("⚡️ Bolt app is running! on port:" + 3000);
})();
