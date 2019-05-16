const { HubStats } = require("./stats.js");
const { PresenceRollups } = require("./presence-rollups.js");

// Represents our knowledge about a hub on a particular Reticulum server.
class HubState {

  constructor(reticulumCh, host, id, name, slug, ts) {
    this.reticulumCh = reticulumCh;
    this.host = host;
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.ts = ts;
    this.stats = new HubStats();
    this.presenceRollups = new PresenceRollups();
  }

  // Begins tracking activity on the Phoenix channel in the `stats` and `presenceRollups`.
  initializePresence() {
    let nRoomOccupants = 0;
    for (const p of Object.values(this.reticulumCh.getUsers())) {
      if (p.metas.some(m => m.presence === "room")) {
        nRoomOccupants++;
      }
    }
    if (nRoomOccupants > 0) {
      this.stats.arrive(Date.now(), nRoomOccupants);
    }

    this.reticulumCh.on('join', (id, kind, whom) => {
      const now = Date.now();
      this.presenceRollups.arrive(id, whom, now);
      if (kind === "room") {
        this.stats.arrive(Date.now());
      }
    });
    this.reticulumCh.on('moved', (id, kind, _prev) => {
      if (kind === "room") {
        this.stats.arrive(Date.now());
      }
    });
    this.reticulumCh.on('leave', (id, kind, whom) => {
      const now = Date.now();
      this.presenceRollups.depart(id, whom, now);
      if (kind === "room") {
        this.stats.depart(now);
      }
    });
    this.reticulumCh.on('renameuser', (id, kind, prev, curr) => {
      this.presenceRollups.rename(id, prev, curr, Date.now());
    });
  }

  get url() {
    return `https://${this.host}/${this.id}/${this.slug}/`;
  }

}

// Represents the current mapping between Discord channels and Hubs rooms for bridging purposes.
class Bridges {

  constructor() {
    this.hubsByChannel = {}; // {discord channel ID: hub state}
    this.channelsByHub = {}; // {hub ID: {discord channel ID: discord channel}}
  }

  getHub(discordChId) { return this.hubsByChannel[discordChId]; }
  getChannels(hubId) { return this.channelsByHub[hubId] || new Map(); }

  // Returns an array of all (hubState, discordCh) bridged pairs.
  entries() {
    const entries = [];
    for (const [discordChId, hubState] of Object.entries(this.hubsByChannel)) {
      const discordCh = this.channelsByHub[hubState.id][discordChId];
      entries.push({ hubState, discordCh });
    }
    return entries;
  }

  // Removes an entry from the mapping.
  dissociate(hubId, discordChId) {
    delete this.hubsByChannel[discordChId];
    const channels = this.channelsByHub[hubId];
    if (channels != null) {
      if (channels.size === 0) {
        delete this.channelsByHub[hubId];
      }
    }
    channels.delete(discordChId);
  }

  // Adds a new entry to the mapping.
  associate(hubState, discordCh) {
    this.hubsByChannel[discordCh.id] = hubState;
    let channels = this.channelsByHub[hubState.id];
    if (channels == null) {
      channels = this.channelsByHub[hubState.id] = new Map();
    }
    channels.set(discordCh.id, discordCh);
  }

}

module.exports = { Bridges, HubState };
