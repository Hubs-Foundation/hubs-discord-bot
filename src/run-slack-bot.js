// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
require("dotenv").config();

const request = require("request-promise");

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
  // {
  //     "ok": false,
  //     "error": "missing_scope",
  //     "needed": "channels:read,groups:read,mpim:read,im:read",
  //     "provided": "app_mentions:read,chat:write,commands"
  // }
  try {
    // Call the conversations.list method using the built-in WebClient
    const result = await app.client.conversations.list({
      // The token you used to initialize your app
      token: process.env.SLACK_BOT_TOKEN
    });

    saveConversations(result.channels);
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

async function changeChannelTopic() {}

async function changeChannelName() {}

function formatChannel() {}

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

function searchForChannelTopicsAndHubHosts() {}

async function start() {
  const reticulumHost = setupReticulumClient();
  const connectedHubs = {}; // { hubId: hubState }
  const bridges = new Bridges();
  const notificationManager = new NotificationManager();
  const topicManager = new TopicManager(HOSTNAMES);
}

function setup() {}

app.command("/hubs", async ({ ack, payload, context }) => {
  // Acknowledge command
  ack();

  const channelId = payload.channel_id;
  const channelName = payload.channel_name;
  const userId = payload.user_id;
  const userName = payload.user_name;

  const command = payload.text ? payload.text.split(" ")[0] : undefined;
  const argumentList = payload.text ? payload.text.split(" ").slice(1) : [];

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
      break;
    case "create":
      // handle optional arguments too
      await app.client.chat.postMessage({
        token: context.botToken,
        channel: channelId,
        // Text in the notification
        text: "Create room"
      });
      break;
    default:
      await getChannelList();
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

  console.log("⚡️ Bolt app is running! on port:" + 3000);
})();
