// Represents our knowledge about a hub on a particular Reticulum server.
class HubState {

  constructor(host, id, name, slug, ts) {
    this.host = host;
    this.id = id;
    this.name = name;
    this.slug = slug;
    this.ts = ts;
  }

  get url() {
    return `https://${this.host}/${this.id}/${this.slug}/`;
  }

}

// Represents all state related to the mapping between Discord channels and Hubs rooms.
class ChannelBindings {

  constructor() {
    this.hubsByChannel = {};
    this.bindingsByHub = {};
  }

  // Removes an entry from the mapping.
  dissociate(hubId) {
    const binding = this.bindingsByHub[hubId];
    delete this.hubsByChannel[binding.discordCh.id];
    delete this.bindingsByHub[hubId];
  }

  // Adds a new entry to the mapping.
  associate(reticulumCh, discordCh, webhook, hubState, host) {
    this.hubsByChannel[discordCh.id] = hubState.id;
    return this.bindingsByHub[hubState.id] = { hubState, host, discordCh, reticulumCh, webhook };
  }

}

module.exports = { ChannelBindings, HubState };
