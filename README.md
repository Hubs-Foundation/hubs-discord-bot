# hubs-discord-bot (Beta) & hubs-slackbot (Alpha)

### [Go here to add the hosted discord bot to your server!][invite-page]

### [Discord Bot Video introduction](https://www.youtube.com/watch?v=5HtRJolThZ8)

**Note: self-hosting the bot and pointing it at production Hubs servers is currently broken. If you want to run the bot as-is, you'll need to also run your own Hubs server. We're trying to fix this.**

A Discord bot that interacts with [Mozilla Hubs](https://hubs.mozilla.com). Mostly bridges information (chat, media links, joins/leaves), lets you see who is currently in Hubs from Discord and sets Hubs permissions and abilities based on Discord roles. Check out the bot in action on our own [Hubs community Discord][hubs-discord]!

Discord
- [What it does](#what-it-does)
  - [Room/channel permissions linkage](#room-channel-permissions-linkage)
  - [Room/channel bridging](#room-channel-bridging)
- [Running the bot](#great-i-want-to-run-this-on-my-discord-server)
- [Permissions](#permissions)
- [Hacking on it](#hacking-on-it)
Slack (Alpha)
- [What it does](#slack-what-it-does)
- [Running the slack-bot](#slack-running-the-slack-bot)
- [Hacking on the slack-bot](#slack-hacking-on-the-slack-bot)

## What it does

The bot has two primary functions, both related to linking Discord text channels and Hubs rooms.

### Room/channel permissions linkage

When you create a Hubs room using the `!hubs create` bot command, you establish a permanent association between the Hubs room and the Discord channel where you typed the command. This association will cause the Hubs room to use information from your Discord server to authenticate participants. Specifically:

- People can only join the Hubs room via Discord OAuth, and only if they are a member of the channel that the Hubs room is associated with.
- When they join, their permissions are based on their Discord roles. (People with Discord "manage channels" permission will be able to change the name and scene in the room, and people with Discord "kick users" permission will be able to kick and mute people in the Hubs room.)
- Their display name in the Hubs room will reflect their Discord display name.

This only happens with rooms that you create using `!hubs create` -- simply bridging a room by putting it in the topic won't cause it to become permission-linked. This linkage will persist for the lifetime of the Hubs room -- if you don't like it, make a new Hubs room.

### Room/channel bridging

Independently of being permission-linked, the bot will detect any Hubs rooms in channel topics in channels that the bot can read and join those rooms, establishing a bridge between the room and the Discord channel. Specifically:

- A notification will appear in the Discord channel when someone joins or leaves the Hubs room, or if administrative stuff happens in the Hubs room.
- Text chat and images will be bridged from the Discord channel into the Hubs room.
- Text chat and photos will be bridged from the Hubs room into the Discord channel.
- Links to media (images, videos, models) which are _pinned_ in the Hubs room will be bridged to Discord.

Note that you need to set up a webhook for the bot to use in the Discord channel, or it won't be able to post chat from Hubs.

If you remove the Hubs room from the topic, bridging will stop.

### Great. I want to run this on my Discord server.

[Head over here to get a bot invite link.][invite-page]

Once the bot is running on your server:

1. Give the bot [appropriate permissions](#permissions) on the channels you want it to run in.

2. Create a webhook named "Hubs" in the channels you want it to run in. It will use this webhook to bridge chat and send Hubs status updates.

3. Try out the bot! Type `!hubs` in a channel the bot is in to see all of the ways you can control the bot. Put your favorite Hubs room into a channel topic to start bridging, or use the `!hubs create` command to create a new room.

### Permissions

The bot requires several permissions in order to work:

General Permissions
- Manage Webhooks
- Manage Channels - Grant locally per channel not in Developer Portal
Text Permissions
- Send Messages
- Manage Messages
- Embed Links
- Read Message History

- "Send messages" and "Embed links" are necessary in order to bridge between the Hubs room that is linked to a channel and the messages that are sent within the channel on Discord.
- "Manage webhooks" is necessary in order for the bot to find and use a webhook for bridging chat.
- "Manage channels" is necessary in order for the bot to set the channel topic and bridge chat. **Note:** We do not ask for this permission globally when you add the bot to your server, instead we recommend you grant this permission to the bot in specific groups or channels.
- "Manage messages" and "read message history" are necessary in order for the bot to pin notification messages. Like "manage channels", you should probably grant these for specific groups and channels.

You can and should assign these on a channel-by-channel basis to the bot role after adding the bot to your guild.

## Hacking on it

If you want to run the bot yourself or contribute to it right now, your best bet is to join our Discord and ask for help, because there are some parts of the server code that you will need to run and hack up. In the future this process should be easier.

To simply run the bot process:

1. Clone this repository.

2. Install Node and `npm`. The instructions [at the NPM website][npm] should suffice.

3. Install Javascript dependencies by running `npm ci`.

4. [Create a Discord bot on the Discord website.][discord-docs]

5. Add redirect URI in the OAuth page and select the bot permissions
   - Redirect URI: `https://hubs.local:4000/api/v1/oauth/discord`

6. Create an `.env` file with your bot's API token. Include `RETICULUM_HOST={your server}` and `HUBS_HOSTS={your server}` to point it at your local backend. Set `IS_RUNNING_LOCALLY` to true and your `RETICULUM_HOST={your server}` should point to 'hubs.local:4000'. You can see the different configuration bits you can override in [`.env.defaults`](./.env.defaults). You can also pass these values as environment variables when you run `npm start`.

7. Inside your local reticulum instance in reticulum/config/dev.exs change the configuration for `Ret.DiscordClient` to point to your bot's: `client_id`, `client_secret`, and `bot_token` found inside your discord bot.

8. Run `npm start` to start the server, connect to Discord and Reticulum, and operate indefinitely.

9. [Follow the instructions above](#usage) to set up and use the bot on your Discord guild.

[npm]: https://nodejs.org/en/
[discord-docs]: https://discordapp.com/developers/docs/intro
[invite-page]: https://hubs.mozilla.com/discord
[hubs-discord]: https://discord.gg/wHmY4nd
[bot-invite]: mailto:hubs@mozilla.com

# Slack-bot

## Slack what it does

If you add the slackbot to your slack team, you'll be able to use Slack OAuth to connect to your hub's rooms.

## Slack Running the slack-bot

Coming soon!

## Hacking on the slack-bot

Running your local development environment.

1. Run `npm ci` in the root
2. Create a new app in https://api.slack.com/apps
3. Apps > OAuth 2.0 > Add bot scopes:
   - channels:manage
   - channels:read
   - chat:write
   - commands
   - groups:read
   - groups:write
   - im:read
   - im:write
   - mpim:read
   - mpim:write
4. Redirect URLS = https://hubs.local:4000/api/v1/oauth/slack
5. Setup .env file
   - Duplicate .env.defaults and rename to .env
   - Copy the SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET into the .env file from your bot https://api.slack.com/apps
6. On your local reticulum instance add these to the dev.exs: client_id, client_secret, bot_token, signing_secret
7. Set up ngrok
   - Download: https://ngrok.com/download
   - Set up ngrok in your $PATH
   - Run in command prompt or terminal: `ngrok http 3000`
   **NOTE** Every time you update ngrok to another url, you'll need to update the slash command
8. Create a slash command in the slack menu:
   - Command: /hubs
   - Request URL = http://<yourRootDomain>/slack/events
9. Run /hubs: `npm ci` then `npm run local`
10. Run /reticulum
   - To test oauth you can delete the accounts + rooms with `mix ecto.drop` then `mix ecto.create`
11. `npm run slack`
12. Add the slackbot to your team + invite the slackbot to your channel and write the command "/hubs help"
13. Run "/hubs create" then connect to the generated rooms

#### Issues with dev environment and fixes:
- Error Fetching the gltf - your client is blocking the proxy
   - hubs-proxy.local -- error fetching the gltf
   - In hosts: mac `sudo vim /etc/hosts` add hubs-proxy.local
   - Try to download the gltf file using that domain in your browser to accept the unsafe certificate "Your connection is not private"
- Certificate expired in the client - need to refresh the self-signed local certs
   - If you're running /hubs and /reticulum locally
   - Refresh cert /hubs at https://hubs.local:8080
   - Refresh cert via /reticulum served at https://hubs.local:4000
- Error "invalid_service" in slack after slack command
   - Reinstall slack app and possibly regenerate keys
- Error "http_client_error" in slack after slack command
   - Your bot isn't running, your ngrok isn't connected, or you need to update the ngrok url in the slack app menus
