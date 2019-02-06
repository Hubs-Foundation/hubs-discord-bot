const escapeStringRegexp = require('escape-string-regexp');

// Represents all state related to the mapping between Discord channels and Hubs rooms.
class ChannelBindings {

  constructor(hostnames) {
    this.topicRegex = ChannelBindings.buildTopicRegex(hostnames);
    this.hubsByChannel = {};
    this.stateByHub = {};
  }

  // Parses out the first hub ID in this channel topic, or null if no hub is bound.
  getHub(topic) {
    if (topic) {
      const match = topic.match(this.topicRegex);
      if (match) {
        return { url: match[0], id: match[1] };
      }
    }
    return null;
  }

  // Removes an entry from the mapping.
  dissociate(hubId) {
    const state = this.stateByHub[hubId];
    delete this.hubsByChannel[state.discordCh.id];
    delete this.stateByHub[hubId];
  }

  // Adds a new entry to the mapping.
  associate(hubId, hubUrl, discordCh, reticulumCh, webhook) {
    this.hubsByChannel[discordCh.id] = hubId;
    this.stateByHub[hubId] = { hubUrl, discordCh, reticulumCh, webhook };
  }

  // Given a set of hostnames, return a regex that matches Hubs URLs hosted at any of the given
  // hostnames and extracts the hub ID from matching URLs.
  static buildTopicRegex(hostnames) {
    const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
    return new RegExp(`https?://(?:${hostClauses})/(\\w{7})(/\\S*|/)?$`);
  }

}

module.exports = { ChannelBindings };
