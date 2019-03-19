const EventEmitter = require('events');
const https = require('https');
const phoenix = require("phoenix-channels");
const uuid = require("uuid");

// The URL for the scene used if users create a new room but don't specify a scene.
const DEFAULT_BUNDLE_URL = "https://asset-bundles-prod.reticulum.io/rooms/atrium/Atrium.bundle.json";

// Converts a Phoenix message push object into a promise that resolves when the push
// is acknowledged by Reticulum or rejects when it times out or Reticulum produces an error.
function promisifyPush(push) {
  return new Promise((resolve, reject) => {
    return push
      .receive("ok", resolve)
      .receive("timeout", reject)
      .receive("error", reject);
  });
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

    this.channel.on("pin", (data) => {
      const { object_id, gltf_node, pinner } = data;
      if (gltf_node &&
          gltf_node.extensions &&
          gltf_node.extensions.HUBS_components &&
          gltf_node.extensions.HUBS_components.media &&
          gltf_node.extensions.HUBS_components.media.src) {
        const sender = this.getName(pinner);
        this.emit('message', null, sender, "media", { src: gltf_node.extensions.HUBS_components.media.src });
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

    return promisifyPush(this.channel.join());
  }

  async close() {
    return promisifyPush(this.channel.leave());
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
    this.channel.push("message", { type: "chat", from: name, body }); // no ack is expected
  }

}

// State related to the Phoenix connection to Reticulum, independent of any particular Phoenix channel.
class ReticulumClient {

  constructor(hostname) {
    this.hostname = hostname;
    this.socket = new phoenix.Socket(`wss://${hostname}/socket`, {
      params: { session_id: uuid() }
    });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket.onOpen(resolve);
      this.socket.onError(reject);
      this.socket.connect();
    });
  }

  // Creates a new hub with the name and scene, or a random scene if not specified. Returns the URL for the hub.
  async createHub(name, sceneId) {
    const endpoint = `https://${this.hostname}/api/v1/hubs`;
    const headers = { "content-type": "application/json" };
    const payload = { hub: { name } };

    // wow, what a hack
    if (sceneId) {
      payload.hub.scene_id = sceneId;
    } else {
      payload.hub.default_environment_gltf_bundle_url = DEFAULT_BUNDLE_URL;
    }

    return new Promise((resolve, reject) => {
      const req = https.request(endpoint, { method: "POST", headers }, res => {
        let json = "";
        res.on("data", chunk => json += chunk);
        res.on("end", () => resolve(JSON.parse(json)));
      });
      req.on("error", reject);
      req.end(JSON.stringify(payload));
    });
  }

  // Subscribes to the Phoenix channel for the given hub ID and resolves to a `{ hub, subscription }` pair,
  // where `subscription` is the Phoenix channel object and `hub` is the hub metadata from Reticulum.
  // The channel name is used to inform other users which Discord channel we're bridging to.
  async subscribeToHub(hubId, channelName) {
    const payload = {
      context: { mobile: false, hmd: false, discord: channelName },
      profile: {
        displayName: "Hubs Bot",
        avatarId: "" // todo: is this good?
      }
    };
    const ch = this.socket.channel(`hub:${hubId}`, payload);
    const subscription = new ReticulumChannel(ch);
    const hub = (await subscription.connect()).hubs[0];
    return { hub, subscription };
  }

}

module.exports = { ReticulumClient, ReticulumChannel };
