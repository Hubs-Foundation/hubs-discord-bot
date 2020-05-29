const escapeStringRegexp = require("escape-string-regexp");
const URL = require("url").URL;

const HUB_ID_RE = new RegExp("^\\w{7}$");
const SCENE_ID_RE = new RegExp("^\\w{7}$");

// Cleans up trailing separators and whitespace hanging off the end of a topic string.
function cleanSuffix(topic) {
  return topic.replace(/(\s*\|\s*)+$/, "");
}

// Splits a URL's path into components, ignoring extra leading and trailing slashes.
function splitPath(path) {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed.split("/");
}

// Tools to manage the channel topic without murdering things that humans have written in it themselves.
// Gently tries to enforce that Hub URLs are put at the end of the topic, separated with a pipe
// from any other content.
class TopicManager {
  constructor(hostnames) {
    this.hubUrlRe = TopicManager.buildHubUrlRegex(hostnames);
    this.sceneUrlRe = TopicManager.buildSceneUrlRegex(hostnames);
  }

  matchHub(topic) {
    const [hubUrlStr, _host] = (topic || "").match(this.hubUrlRe) || [];
    if (!hubUrlStr) {
      return null;
    }
    try {
      const hubUrl = new URL(hubUrlStr);
      {
        // check for query form hub URL: http://hubs.local:8080/hub.html?hub_id=a0b1c2d
        const hubId = hubUrl.searchParams.get("hub_id");
        if (hubId != null && HUB_ID_RE.test(hubId)) {
          return { hubUrl, hubId };
        }
      }
      {
        // check for path form URL: http://hubs.local:8080/a0b1c2d/foo-bar
        const pathElements = splitPath(hubUrl.pathname);
        if (pathElements.length >= 1) {
          const hubId = pathElements[0];
          if (hubId != null && HUB_ID_RE.test(hubId)) {
            if (pathElements.length >= 2) {
              const hubSlug = pathElements[1];
              return { hubUrl, hubId, hubSlug };
            } else {
              return { hubUrl, hubId };
            }
          }
        }
      }
    } catch (e) {
      /* not a valid URL */
    }

    return null;
  }

  matchScene(topic) {
    const [sceneUrlStr, _host] = (topic || "").match(this.sceneUrlRe) || [];
    if (!sceneUrlStr) {
      return null;
    }
    try {
      const sceneUrl = new URL(sceneUrlStr);
      // check for scene URL: https://hubs.mozilla.com/scenes/a0b1c2d/foo-bar
      const pathElements = splitPath(sceneUrl.pathname);
      if (pathElements.length >= 1) {
        const sceneId = pathElements[1]; // pathElements[0] === "scenes"
        if (sceneId != null && SCENE_ID_RE.test(sceneId)) {
          if (pathElements.length >= 3) {
            const sceneSlug = pathElements[2];
            return { sceneUrl, sceneId, sceneSlug };
          } else {
            return { sceneUrl, sceneId };
          }
        }
      }
    } catch (e) {
      /* not a valid URL */
    }

    return null;
  }

  removeHub(topic) {
    return cleanSuffix(topic.replace(this.hubUrlRe, ""));
  }

  addHub(topic, hubUrl) {
    return topic ? `${topic} | ${hubUrl}` : hubUrl;
  }

  static buildHubUrlRegex(hostnames) {
    const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
    return new RegExp(`https?://(${hostClauses})/\\S*`);
  }

  static buildSceneUrlRegex(hostnames) {
    const hostClauses = hostnames.map(host => `${escapeStringRegexp(host)}(?:\\:\\d+)?`).join("|");
    return new RegExp(`https?://(${hostClauses})/scenes/\\S*`);
  }
}

module.exports = { TopicManager };
