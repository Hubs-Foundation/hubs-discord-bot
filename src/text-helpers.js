const moment = require("moment-timezone");

// Prepends a timestamp to a string.
function ts(str) {
  return `[${new Date().toISOString()}] ${str}`;
}

// base64ified so we don't have to sit around wondering where habitat drops files on the filesystem
const DUCK_AVATAR =
  "data:image/png;base64,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";

// Formats a message indicating that the user formerly known as `prev` is now known as `curr`.
function formatRename(user) {
  return `**${user.prevName}** changed their name to **${user.name}**.`;
}

// Formats a message of the form "Alice, Bob, and Charlie".
function formatList(users) {
  if (users.length === 1) {
    return `**${users[0].name}**`;
  } else {
    return `**${users
      .slice(0, -1)
      .map(u => u.name)
      .join(", ")}** and **${users[users.length - 1].name}**`;
  }
}

// Formats user activity statistics for a hub.
function formatStats(stats, where, when) {
  const header = when != null ? `Hubs activity in <${where}> for ${when}:\n` : `Hubs activity in <${where}>:\n`;
  const peakTimeDescription = stats.peakTime == null ? "N/A" : moment(stats.peakTime).format("LTS z");
  return (
    header +
    "```\n" +
    `Room joins: ${stats.arrivals}\n` +
    `Peak user count: ${stats.peakCcu}\n` +
    `Peak time: ${peakTimeDescription}\n` +
    "```"
  );
}

const HELP_PREFIX =
  "Hi! I'm the Hubs bot. I connect <chatAppType> channels with rooms on Hubs (<https://hubs.mozilla.com/>). Type `<hubsCommand> help` for more information.";

const COMMAND_HELP_TEXT =
  "Command reference:\n\n" +
  "🦆 `<hubsCommand>` - Shows general information about the Hubs integration with the current <chatAppType> channel.\n" +
  "🦆 `<hubsCommand> help` - Shows this text you're reading right now.\n" +
  "🦆 `<hubsCommand> create` - Creates a default Hubs room and puts its URL into the channel topic. " +
  "Rooms created with `<hubsCommand> create` will inherit moderation permissions from this <chatAppType> channel and only allow <chatAppType> users in this channel to join the room.\n" +
  "🦆 `<hubsCommand> create [environment URL] [name]` - Creates a new room with the given environment and name, and puts its URL into the channel topic. " +
  "Valid environment URLs include GLTFs, GLBs, and Spoke scene pages.\n" +
  "🦆 `<hubsCommand> stats` - Shows some summary statistics about room usage.\n" +
  "🦆 `<hubsCommand> remove` - Removes the room URL from the topic and stops bridging this <chatAppType> channel with Hubs.\n" +
  "🦆 `<hubsCommand> notify set [datetime]` - Sets a one-time notification to notify @here to join the room at some future time.\n" +
  "🦆 `<hubsCommand> notify clear` - Removes all pending notifications.\n" +
  "🦆 `<hubsCommand> users` - Lists the users currently in the Hubs room bridged to this channel.\n\n" +
  "See the documentation and source at https://github.com/MozillaReality/hubs-discord-bot for a more detailed reference " +
  "of bot functionality, including guidelines on what permissions the bot needs, what kinds of bridging the bot can do, " +
  "and more about how the bot bridges channels to rooms. You can invite the bot to your own server at https://hubs.mozilla.com/discord.";

const OAUTH_ONLY_COMMAND_HELP_TEXT =
  "Command reference:\n\n" +
  "🦆 `<hubsCommand>` - Shows general information about the Hubs integration with the current <chatAppType> channel.\n" +
  "🦆 `<hubsCommand> help` - Shows this text you're reading right now.\n" +
  "🦆 `<hubsCommand> create` - Creates a default Hubs room and puts its URL into the channel topic. " +
  "Rooms created with `<hubsCommand> create` will inherit moderation permissions from this <chatAppType> channel and only allow <chatAppType> users in this channel to join the room.\n" +
  "🦆 `<hubsCommand> create [environment URL] [name]` - Creates a new room with the given environment and name, and puts its URL into the channel topic. " +
  "Valid environment URLs include GLTFs, GLBs, and Spoke scene pages.\n" +
  "🦆 `<hubsCommand> remove` - Removes the room URL from the topic and stops bridging this <chatAppType> channel with Hubs.\n" +
  "See the documentation and source at https://github.com/MozillaReality/hubs-discord-bot for a more detailed reference " +
  "of bot functionality, including guidelines on what permissions the bot needs, what kinds of bridging the bot can do, " +
  "and more about how the bot bridges channels to rooms. You can invite the bot to your own server at https://hubs.mozilla.com/discord.";

function helpPrefix(hubsCommand, chatAppType) {
  let prefix = HELP_PREFIX.replace("<hubsCommand>", hubsCommand);
  prefix = prefix.replace(/<chatAppType>/g, chatAppType);
  return prefix;
}

function helpCommandText(hubsCommand, chatAppType) {
  let helpText =
    chatAppType === "slack"
      ? OAUTH_ONLY_COMMAND_HELP_TEXT.replace(/<hubsCommand>/g, hubsCommand)
      : COMMAND_HELP_TEXT.replace(/<hubsCommand>/g, hubsCommand);
  helpText = helpText.replace("<chatAppType>", chatAppType);
  return helpText;
}

module.exports = {
  ts,
  DUCK_AVATAR,
  formatStats,
  formatRename,
  formatList,
  helpCommandText,
  helpPrefix
};
