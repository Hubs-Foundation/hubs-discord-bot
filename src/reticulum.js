const escapeStringRegexp = require('escape-string-regexp');
const EventEmitter = require('events');
const phoenix = require("phoenix-channels");
const uuid = require("uuid");

// The metadata passed for the Hubs bot user when joining a Hubs room.
const hubsBotJoinParameters = {
  context: { mobile: false, hmd: false },
  profile: {
    displayName: "Hubs Bot",
    avatarId: "" // todo: is this good?
  }
};

// Given a set of hostnames, return a regex that matches Hubs URLs hosted at any of the given
// hostnames and extracts hub information from the matching URLs.
function buildUrlRegex(hostnames) {
  const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
  return new RegExp(`https?://(${hostClauses})/(\\w{7})(?:/(\\S*)/?)?$`);
}

// State related to a single Hubs Phoenix channel subscription.
class ReticulumChannel extends EventEmitter {

  constructor(channel) {
    super();
    this.channel = channel;
    this.presence = {};
  }

  async connect() {

    const onJoin = (id, curr, p) => {
      if (this.channel.socket.params.session_id === id) {
        return;
      }
      const mostRecent = p.metas[p.metas.length - 1];
      if (curr != null && curr.metas != null && curr.metas.length > 0) {
        // this guy was already in the lobby or room, notify iff their name changed
        const previous = curr.metas[curr.metas.length - 1];
        if (previous.profile && mostRecent.profile && previous.profile.displayName !== mostRecent.profile.displayName) {
          this.emit('renameuser', id, mostRecent.presence, previous.profile.displayName, mostRecent.profile.displayName);
        }
        return;
      }
      // this guy was not previously present, notify for a join
      this.emit('join', id, mostRecent.presence, mostRecent.profile.displayName);
    };

    const onLeave = (id, curr, p) => {
      if (this.channel.socket.params.session_id === id) {
        return;
      }
      if (curr != null && curr.metas != null && curr.metas.length > 0) {
        return; // this guy is still in the lobby or room, don't notify yet
      }
      const mostRecent = p.metas[p.metas.length - 1];
      this.emit('leave', id, mostRecent.presence, mostRecent.profile.displayName);
    };

    this.channel.on("presence_state", state => {
      this.presence = phoenix.Presence.syncState(this.presence, state, onJoin, onLeave);
    });

    this.channel.on("presence_diff", diff => {
      this.presence = phoenix.Presence.syncDiff(this.presence, diff, onJoin, onLeave);
    });

    this.channel.on("hub_refresh", ({ session_id, stale_fields, hubs }) => {
      const sender = this.getName(session_id);
      if (stale_fields.includes('scene')) {
        this.emit('rescene', session_id, sender, hubs[0].scene);
      }
      if (stale_fields.includes('name')) { // for some reason it doesn't say that the slug is stale, but it is
        this.emit('renamehub', session_id, sender, hubs[0].name, hubs[0].slug);
      }
    });

    this.channel.on("naf", ({ dataType, data, clientId }) => {
      // if this message is to a particular client, it's catching that client up on
      // something that already happened which everyone else knows, like a spawn, and
      // we have no interest in echoing it to Discord again
      if (clientId) {
        return;
      }

      if (dataType === 'u' && data.isFirstSync) { // spawn an object
        const sessionId = data.owner;
        const sender = this.getName(sessionId);
        if (data.components) {
          const mediaLoader = Object.values(data.components).find(c => c != null && c.src);
          if (mediaLoader) {
            this.emit('message', sessionId, sender, "media", { src: mediaLoader.src });
          }
        }
      }
    });

    this.channel.on("message", ({ session_id, type, body, from }) => {
      // we sent this message ourselves just now, don't notify ourselves about it
      if (this.channel.socket.params.session_id === session_id) {
        return;
      }
      const sender = from || this.getName(session_id);
      this.emit('message', session_id, sender, type, body);

    });

    return new Promise((resolve, reject) => {
      this.channel.join()
        .receive("ok", resolve)
        .receive("error", reject);
    });
  }

  close() {
    return this.channel.leave();
  }

  getName(sessionId) {
    const userInfo = this.presence[sessionId];
    if (userInfo) {
      const mostRecent = userInfo.metas[userInfo.metas.length - 1];
      return mostRecent.profile.displayName;
    }
    return null;
  }

  getUsers() {
    return Object.values(this.presence).map(info => info.metas[0].profile.displayName);
  }

  // Sends a chat message that Hubs users will see in the chat box.
  sendMessage(name, body) {
    return this.channel.push("message", { type: "chat", from: name, body });
  }

}

// State related to the Phoenix connection to Reticulum, independent of any particular Phoenix channel.
class ReticulumClient {

  constructor(hostname) {
    this.socket = new phoenix.Socket(`wss://${hostname}/socket`, {
      params: { session_id: uuid() },
      logger: function(msg, data) { console.log(`${msg} %j`, data); }
    });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket.onOpen(resolve);
      this.socket.onError(reject);
      this.socket.connect();
    });
  }

  // Subscribes to the Phoenix channel for the given hub ID and resolves to a `{ hub, subscription }` pair,
  // where `subscription` is the Phoenix channel object and `hub` is the hub metadata from Reticulum.
  async subscribeToHub(hubId) {
    const ch = this.socket.channel(`hub:${hubId}`, hubsBotJoinParameters);
    const subscription = new ReticulumChannel(ch);
    const hub = (await subscription.connect()).hubs[0];
    return { hub, subscription };
  }

}

module.exports = { buildUrlRegex, ReticulumClient, ReticulumChannel };
