// Variables in .env and .env.defaults will be added to process.env
const dotenv = require("dotenv");
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.defaults" });

const VERBOSE = (process.env.VERBOSE === "true");

const discord = require('discord.js');
const uuid = require("uuid");
const phoenix = require("phoenix-channels");
const escapeStringRegexp = require('escape-string-regexp');

// The metadata passed for the Hubs bot user when joining a Hubs room.
const hubsBotJoinParameters = {
  context: { mobile: false, hmd: false },
  profile: {
    displayName: "Hubs Bot",
    avatarId: "" // todo: is this good?
  }
};

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// Given a set of hostnames, return a regex that matches Hubs URLs hosted at any of the given
// hostnames and extracts the hub ID from matching URLs.
function buildTopicRegex(hostnames) {
  const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
  return new RegExp(`https?://(?:${hostClauses})/(\\w+)/?\\S*`);
}

// Subscribes to the Phoenix channel for the given hub ID and resolves to the Phoenix channel object.
async function subscribeToHubChannel(reticulumClient, hubId) {
  const ch = reticulumClient.channel(`hub:${hubId}`, hubsBotJoinParameters);
  return new Promise((resolve, reject) => {
    ch.join()
      .receive("ok", () => resolve(ch))
      .receive("error", e => reject(e));
  });
}

async function connectToDiscord(shardId, shardCount, token) {
  const options = { shardId, shardCount };
  const client = new discord.Client(options);
  return new Promise((resolve, reject) => {
    client.on("ready", () => resolve(client));
    client.login(token).catch(e => reject(e));
  });
}

async function connectToReticulum(hostname, sessionId) {
  const socketUrl = `wss://${hostname}/socket`;
  const socketSettings = { params: { session_id: sessionId } };
  if (VERBOSE) {
    socketSettings.logger = (kind, msg, data) => {
      console.debug(ts(`Phoenix channel event: ${kind}: ${msg}`), data);
    };
  }

  const socket = new phoenix.Socket(socketUrl, socketSettings);
  return new Promise((resolve, reject) => {
    socket.onOpen(() => resolve(socket));
    socket.onError(e => reject(e));
    socket.connect();
  });
}

async function start() {

  const shardId = parseInt(process.env.SHARD_ID, 10);
  const shardCount = parseInt(process.env.SHARD_COUNT, 10);
  console.info(ts(`Connecting to Discord (shard ID: ${shardId}/${shardCount})...`));
  const discordClient = await connectToDiscord(shardId, shardCount, process.env.TOKEN);
  console.info(ts("Successfully connected to Discord."));

  const reticulumSessionId = uuid();
  console.info(ts(`Connecting to Reticulum (session ID: ${reticulumSessionId})...`));
  const reticulumClient = await connectToReticulum(process.env.RETICULUM_HOST, reticulumSessionId);
  console.info(ts("Successfully connected to Reticulum."));

  const hostnames = process.env.HUBS_HOSTS.split(",");
  const hostRegex = buildTopicRegex(hostnames);
  console.info(ts(`Binding to channels with Hubs hosts: ${hostnames.join(", ")}`));

  const hubsByChannel = {};
  const channelsByHub = {};
  const webhooksByHub = {};
  const subscriptionsByHub = {};
  for (let [cid, chan] of discordClient.channels) {
    if (chan.topic) {
      const match = chan.topic.match(hostRegex);
      const webhook = (await chan.fetchWebhooks()).first(); // todo: pretty unprincipled to do .first
      if (match && !webhook) {
        if (VERBOSE) {
          console.debug(ts(`Discord channel ${cid} has a Hubs link in the topic, but no webhook is present.`));
        }
      }
      if (match && webhook) {
        const hubId = match[1];
        console.info(ts(`Hubs room ${hubId} bound to Discord channel ${cid}; joining.`));
        hubsByChannel[cid] = hubId;
        channelsByHub[hubId] = cid;
        webhooksByHub[hubId] = webhook;

        let presences = {}; // client's initial empty presence state
        const hubSubscription = await subscribeToHubChannel(reticulumClient, hubId);
        subscriptionsByHub[hubId] = hubSubscription;
        const onUserJoin = (id, current, newPresence) => {
          const name = newPresence.metas[0].profile.displayName;
          if (VERBOSE) {
            console.debug(ts(`Relaying join for ${name} via hub ${hubId} to channel ${cid}: %j`));
          }
          chan.send(`${name} joined.`);
        };
        const onUserLeave = (id, current, leftPresence) => {
          const name = leftPresence.metas[0].profile.displayName;
          if (VERBOSE) {
            console.debug(ts(`Relaying leave for ${name} via hub ${hubId} to channel ${cid}: %j`));
          }
          chan.send(`${name} departed.`);
        };
        hubSubscription.on("presence_state", state => {
          presences = phoenix.Presence.syncState(presences, state, onUserJoin, onUserLeave);
        });
        hubSubscription.on("presence_diff", diff => {
          presences = phoenix.Presence.syncDiff(presences, diff, onUserJoin, onUserLeave);
        });
        hubSubscription.on("message", ({ session_id, type, body, from }) => {
          if (reticulumSessionId === session_id) {
            return;
          }
          const getAuthor = () => {
            const userInfo = presences[session_id];
            if (from) {
              return from;
            } else if (userInfo) {
              return userInfo.metas[0].profile.displayName;
            } else {
              return "Mystery user";
            }
          };
          const name = getAuthor();
          if (VERBOSE) {
            const msg = ts(`Relaying message of type ${type} from ${name} (session ID ${session_id}) via hub ${hubId} to channel ${cid}: %j`);
            console.debug(msg, body);
          }
          webhook.send(body, { username: name });
        });
      }
    }
  }

  discordClient.on('message', msg => {
    if (msg.content === '!duck') {
      msg.channel.send('Quack :duck:');
      return;
    }
    if (msg.channel.id in hubsByChannel) {
      const hubId = hubsByChannel[msg.channel.id];
      const hubWebhook = webhooksByHub[hubId];
      if (msg.author.id === discordClient.user.id) {
        return;
      }
      if (msg.webhookID === hubWebhook.id) {
        return;
      }
      if (VERBOSE) {
        console.debug(ts(`Relaying message via channel ${msg.channel.id} to hub ${hubId}: ${msg.content}`));
      }
      const hubSubscription = subscriptionsByHub[hubId];
      hubSubscription.push("message", { type: "chat", body: msg.content, from: msg.author.username });
    }
  });
}

start().catch(e => {
  console.error(ts("Error starting Discord bot:"), e);
  process.exit(1);
});
