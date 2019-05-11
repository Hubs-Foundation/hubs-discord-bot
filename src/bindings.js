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
    this.mediaBroadcasts = {}; // { url: timestamp }
  }

  get url() {
    return `https://${this.host}/${this.id}/${this.slug}/`;
  }

}

// Represents all state related to the mapping between Discord channels and Hubs rooms.
class ChannelBindings {

  constructor() {
    this.hubsByChannel = {}; // channel ID: hub ID or null
    this.bindingsByHub = {};
  }

  // Removes an entry from the mapping.
  dissociate(hubId) {
    const binding = this.bindingsByHub[hubId];
    delete this.hubsByChannel[binding.discordCh.id];
    delete this.bindingsByHub[hubId];
  }

  // Adds a new entry to the mapping.
  associate(discordCh, webhook, hubState) {
    this.hubsByChannel[discordCh.id] = hubState.id;
    return this.bindingsByHub[hubState.id] = { hubState, discordCh, webhook };
  }

}

module.exports = { ChannelBindings, HubState };
