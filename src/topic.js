const escapeStringRegexp = require('escape-string-regexp');

// Tools to manage the channel topic without murdering things that humans have written in it themselves.
// Gently tries to enforce that Hub URLs are put at the end of the topic, separated with a pipe
// from any other content.
class TopicManager {

  constructor(hostnames) {
    this.hubRe = TopicManager.buildHubUrlRegex(hostnames);
    this.sceneRe = TopicManager.buildSceneUrlRegex(hostnames);
  }

  matchHub(topic) {
    return topic.match(this.hubRe);
  }

  matchScene(topic) {
    return topic.match(this.sceneRe);
  }

  removeHub(topic) {
    const result = topic.replace(this.hubRe, "");
    // if there's a trailing separator hanging off the end after removing hub URLs, clean it up
    return result.replace(/\s*\|\s*$/, "");
  }

  addHub(topic, hubUrl) {
    if (topic) {
      return `${topic} | ${hubUrl}`;
    } else {
      return hubUrl;
    }
  }

  // Return a regex that matches Hubs URLs hosted at any of the given hostnames and extracts
  // hub information from the matching URLs. Note that the returned regex has the global flag set.
  static buildHubUrlRegex(hostnames) {
    const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
    return new RegExp(`https?://(${hostClauses})/(\\w{7})(?:/(\\S*)/?)?$`);
  }

  // Return a regex that matches scene URLs hosted at any of the given hostnames and extracts
  // scene information from the matching URLs. Note that the returned regex has the global flag set.
  static buildSceneUrlRegex(hostnames) {
    const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
    return new RegExp(`https?://(${hostClauses})/scenes/(\\w{7})(?:/(\\S*)/?)?$`);
  }

}

module.exports = { TopicManager };
