// Represents our knowledge about a hub on a particular Reticulum server.
class HubState {

  constructor(reticulumCh, host, id, name, slug, ts, stats, presenceRollups) {
    this.reticulumCh = reticulumCh;
    this.host = host;
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.ts = ts;
    this.stats = stats;
    this.presenceRollups = presenceRollups;
  }

  get url() {
    return `https://${this.host}/${this.id}/${this.slug}/`;
  }

}

// Represents the current mapping between Discord channels and Hubs rooms for bridging purposes.
class Bridges {

  constructor() {
    this.hubsByChannel = {}; // {discord channel ID: hub state}
    this.channelsByHub = {}; // {hub ID: Map(discord channel ID: discord channel)}
  }

  getHub(discordChId) { return this.hubsByChannel[discordChId]; }
  getChannels(hubId) { return this.channelsByHub[hubId] || new Map(); }

  // Returns an array of all (hubState, discordCh) bridged pairs.
  entries() {
    const entries = [];
    for (const [discordChId, hubState] of Object.entries(this.hubsByChannel)) {
      const discordCh = this.channelsByHub[hubState.id].get(discordChId);
      entries.push({ hubState, discordCh });
    }
    return entries;
  }

  // Removes an entry from the mapping.
  dissociate(hubId, discordChId) {
    delete this.hubsByChannel[discordChId];
    const channels = this.channelsByHub[hubId];
    if (channels != null) {
      channels.delete(discordChId);
      if (channels.size === 0) {
        delete this.channelsByHub[hubId];
      }
    }
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
