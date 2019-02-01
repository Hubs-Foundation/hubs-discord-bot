const EventEmitter = require('events');
const escapeStringRegexp = require('escape-string-regexp');
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

// State related to a single Hubs Phoenix channel subscription.
class ReticulumChannel extends EventEmitter {

  constructor(channel) {
    super();
    this.channel = channel;
    this.presence = {};
  }

  async connect() {
    const onJoin = (id, curr, p) => {
      const mostRecent = p.metas[p.metas.length - 1];
      this.emit('join', id, mostRecent.presence, mostRecent.profile.displayName);
    };
    const onLeave = (id, curr, p) => {
      const mostRecent = p.metas[p.metas.length - 1];
      this.emit('leave', id, mostRecent.presence, mostRecent.profile.displayName);
    };
    this.channel.on("presence_state", state => {
      this.presence = phoenix.Presence.syncState(this.presence, state, onJoin, onLeave);
    });
    this.channel.on("presence_diff", diff => {
      this.presence = phoenix.Presence.syncDiff(this.presence, diff, onJoin, onLeave);
    });
    this.channel.on("message", ({ session_id, type, body, from }) => {
      if (this.channel.socket.params.session_id === session_id) {
        return;
      }
      const getSender = () => {
        const userInfo = this.presence[session_id];
        if (from) {
          return from;
        } else if (userInfo) {
          return userInfo.metas[0].profile.displayName;
        } else {
          return null;
        }
      };
      const name = getSender();
      this.emit('message', session_id, name, type, body);

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

  getUsers() {
    return Object.values(this.presence).map(info => info.metas[0].profile.displayName);
  }

  sendMessage(name, body) {
    return this.channel.push("message", { type: "chat", from: name, body });
  }

}

// State related to the Phoenix connection to Reticulum, independent of any particular Phoenix channel.
class ReticulumClient {

  constructor(hostname) {
    this.socket = new phoenix.Socket(`wss://${hostname}/socket`, { params: { session_id: uuid() }});
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket.onOpen(resolve);
      this.socket.onError(reject);
      this.socket.connect();
    });
  }

  // Subscribes to the Phoenix channel for the given hub ID and resolves to the Phoenix channel object.
  async subscribeToHub(hubId) {
    const ch = this.socket.channel(`hub:${hubId}`, hubsBotJoinParameters);
    const subscription = new ReticulumChannel(ch);
    await subscription.connect();
    return subscription;
  }

}

module.exports = { ReticulumClient, ReticulumChannel };
