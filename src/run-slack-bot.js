// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
require("dotenv").config();

const { ReticulumClient } = require("./reticulum.js");
const { TopicManager } = require("./topic.js");
const { StatsdClient } = require("./statsd-client.js");
const { ts, helpCommandText } = require("./text-helpers.js");
const { BotEventQueue } = require("./helpers.js");

const HOSTNAMES = process.env.HUBS_HOSTS.split(",");
const VERBOSE = process.env.VERBOSE;

let statsdClient = null;
const statsdHost = process.env.STATSD_HOST;
if (statsdHost) {
  const [hostname, port] = statsdHost.split(":");
  statsdClient = new StatsdClient(hostname, port ? parseInt(port, 10) : 8125, process.env.STATSD_PREFIX);
  console.info(ts(`Sending metrics to statsd @ ${statsdHost}.`));
}

const q = new BotEventQueue(statsdClient);

function getChannelTopic(channelInfo) {
  return channelInfo.topic.value;
}

async function getChannelInfo(channelId) {
  try {
    const result = await app.client.conversations.info({
      token: process.env.SLACK_BOT_TOKEN,
      channel: channelId
    });
    return result.channel;
  } catch (e) {
    console.error(e);
  }
}

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
    console.error(e);
    console.log(e.data);
    if (isMissingScopeError(e)) {
      // setting custom permissions to match bot oauth
      // not user oauth
      handleMissingScope(SET_CHANNEL_TOPIC, "channels:manage,groups:write,im:write,mpim:write", channelId);
    } else {
      // another unexpected error
      console.error(e);
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
    console.error(e);
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

async function setupReticulumClient() {
  const reticulumHost = process.env.RETICULUM_HOST;
  const reticulumClient = new ReticulumClient(reticulumHost);
  try {
    await reticulumClient.connect();
  } catch (e) {
    console.error(e);
  }
  console.info(ts(`Connected to Reticulum @ ${reticulumHost}.`));
  return reticulumClient;
}

let reticulumClient = null;
let topicManager = null;
async function start() {
  try {
    reticulumClient = await setupReticulumClient();
    topicManager = new TopicManager(HOSTNAMES);
  } catch (e) {
    console.error(e);
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

app.command("/hubs", async ({ ack, payload }) => {
  await ack(); // Acknowledge command for slack

  q.enqueue(async () => {
    const teamId = payload.team_id; // T0139U6GLR2

    const channelId = payload.channel_id; // C0133V80YFM
    const channelName = payload.channel_name;
    const userId = payload.user_id;

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
        try {
          await sendMessageToChannel(channelId, 'Type "/hubs help" if you need the list of available commands');
        } catch (e) {
          console.error(e);
        }
        break;
      case "help":
        // Shows text needed
        try {
          await sendMessageToChannel(channelId, helpCommandText("/hubs", "Slack"));
        } catch (e) {
          console.error(e);
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
          console.error(e);
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
          console.error(e);
          return sendMessageToChannel(channelId, "Something went wrong, please try remove command again.");
        }
      default:
        return sendMessageToChannel(channelId, 'Type "/hubs help" if you need the list of available commands');
    }
  });
});

(async () => {
  // Start your app
  try {
    await start();
    await app.start(3000);
    console.log("⚡️ Bolt app is running! on port:" + 3000);
  } catch (e) {
    console.log("Something went wrong on starting slack bot server");
    console.error(e);
  }
})();
