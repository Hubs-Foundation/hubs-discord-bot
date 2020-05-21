// Require the Bolt package (github.com/slackapi/bolt)
const { App } = require("@slack/bolt");
require("dotenv").config();

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
async function getChannelList() {}

async function sendMessage() {}

async function changeChannelTopic() {}

async function changeChannelName() {}

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

async function start() {}

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

  // try {
  //   const result = await app.client.chat.postMessage({
  //     token: context.botToken,
  //     // Channel to send message to
  //     channel: payload.channel_id,
  //     // Include a button in the message (or whatever blocks you want!)
  //     blocks: [
  //       {
  //         type: "section",
  //         text: {
  //           type: "mrkdwn",
  //           text: "Go ahead.!!! Click it."
  //         },
  //         accessory: {
  //           type: "button",
  //           text: {
  //             type: "plain_text",
  //             text: "Click me!!!!"
  //           },
  //           action_id: "button_abc"
  //         }
  //       }
  //     ],
  //     // Text in the notification
  //     text: "Message from Test App"
  //   });
  //   console.log(result);
  // } catch (error) {
  //   console.error(error);
  // }
});

// console.log(app)

// // Listens to incoming messages that contain "hello"
// app.message('hello', async ({ message, say }) => {
//   // say() sends a message to the channel where the event was triggered
//   await say({
//     blocks: [
//       {
//         type: 'section',
//         text: {
//           type: 'mrkdwn',
//           text: `Hey there <@${message.user}>!`
//         },
//         accessory: {
//           type: 'button',
//           text: {
//             type: 'plain_text',
//             text: 'Click Me'
//           },
//           action_id: 'button_click'
//         }
//       }
//     ]
//   })
// })

// app.action('button_click', async ({ body, ack, say }) => {
//   // Acknowledge the action
//   await ack()
//   await say(`<@${body.user.id}> clicked the button`)
// })

// app.event('app_home_opened', async ({ event, context }) => {
//   try {
//     /* view.publish is the method that your app uses to push a view to the Home tab */
//     const result = await app.client.views.publish({
//       /* retrieves your xoxb token from context */
//       token: context.botToken,

//       /* the user that opened your app's app home */
//       user_id: event.user,

//       /* the view payload that appears in the app home*/
//       view: {
//         type: 'home',
//         callback_id: 'home_view',

//         /* body of the view */
//         blocks: [
//           {
//             type: 'section',
//             text: {
//               type: 'mrkdwn',
//               text: "*Welcome to your _App's Home_* :tada:"
//             }
//           },
//           {
//             type: 'divider'
//           },
//           {
//             type: 'section',
//             text: {
//               type: 'mrkdwn',
//               text:
//                 "This button won't do much for now but you can set up a listener for it using the `actions()` method and passing its unique `action_id`. See an example in the `examples` folder within your Bolt app."
//             }
//           },
//           {
//             type: 'actions',
//             elements: [
//               {
//                 type: 'button',
//                 text: {
//                   type: 'plain_text',
//                   text: 'Click me!'
//                 }
//               }
//             ]
//           }
//         ]
//       }
//     })
//   } catch (error) {
//     console.error(error)
//   }
// })

// Listen for a slash command invocation
// https://api.slack.com/app
// Inside your slack bot
// Features > "Slash Commands" >
app.command("/helloworld", async ({ ack, payload, context }) => {
  console.log("hello");
  console.log("payload text");
  // console.log(payload)
  console.log(payload.text ? payload.text : "NO PAYLOAD TEXT ADDED");
  // console.log('context')
  // console.log(context)
  // Acknowledge the command request
  ack();

  try {
    const result = await app.client.chat.postMessage({
      token: context.botToken,
      // Channel to send message to
      channel: payload.channel_id,
      // Include a button in the message (or whatever blocks you want!)
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Go ahead.!!! Click it."
          },
          accessory: {
            type: "button",
            text: {
              type: "plain_text",
              text: "Click me!!!!"
            },
            action_id: "button_abc"
          }
        }
      ],
      // Text in the notification
      text: "Message from Test App"
    });
    console.log(result);
  } catch (error) {
    console.error(error);
  }
});

// Listen for a button invocation with action_id `button_abc`
// You must set up a Request URL under Interactive Components on your app configuration page
app.action("button_abc", async ({ ack, body, context }) => {
  // Acknowledge the button request
  ack();

  try {
    // Update the message
    const result = await app.client.chat.update({
      token: context.botToken,
      // ts of message to update
      ts: body.message.ts,
      // Channel of message
      channel: body.channel.id,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*The button was clicked!*"
          }
        }
      ],
      text: "Message from Test App"
    });
    console.log(result);
  } catch (error) {
    console.error(error);
  }
});
(async () => {
  // Start your app
  await app.start(3000);

  console.log("⚡️ Bolt app is running! on port:" + 3000);
})();

// function handleRequest(request, response) {
//   response.end('Ngrok is working! -  Path Hit: ' + request.url)
// }

// // We create the web server object calling the createServer function. Passing our request function onto createServer guarantees the function is called once for every HTTP request that's made against the server
// var server = http.createServer(handleRequest)

// server.listen(PORT, function() {
//   // Callback triggered when server is successfully listening. Hurray!
//   console.log('Server listening on: http://localhost:%s', PORT)
// })
