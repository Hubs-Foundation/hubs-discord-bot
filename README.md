# hubs-discord-bot (Beta)

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

## What it does

The bot has two primary functions, both related to linking Discord text channels and Hubs rooms.

### Room/channel permissions linkage

When you create a Hubs room using the `!hubs create` bot command, you establish a permanent association between the Hubs room and the Discord channel where you typed the command. This association will cause the Hubs room to use information from your Discord server to authenticate participants. Specifically:

- People can only join the Hubs room via Discord OAuth, and only if they are a member of the channel that the Hubs room is associated with.
- When they join, their permissions are based on their Discord permissions 
  - To enter the room they must have "View Channel" permission
  - To be a moderator they must have "Kick Members" permission (and "View Channel").
     - Moderators can kick and mute members in the hubs room. 
     - Moderators can also create and manipulate objects, draw and share video even if these are turned off in the room settings.
     - Note: only discord users with verified emails can become moderators
  - To be a room owner they must have "Manage Channels" (and "Kick Members and "View Channel")
     - Room owners are able to change the name and scene in the room, modify other room settings, and close the room.
     - Note: only discord users with verified emails can become room owners
  - The discord permissions can set either via their discord role globally, or permissions given on the specific channel to that user/role
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

6. Create an `.env` file with your bot's API token. Include `RETICULUM_HOST={your server}` and `HUBS_HOSTS={your server}` to point it at your local backend. `RETICULUM_HOST={your server}` should point to 'hubs.local:4000'. You can see the different configuration bits you can override in [`.env.defaults`](./.env.defaults). You can also pass these values as environment variables when you run `npm start`/`npm run local`.

7. Inside your local reticulum instance in reticulum/config/dev.exs change the configuration for `Ret.DiscordClient` to point to your bot's: `client_id`, `client_secret`, and `bot_token` found inside your discord bot.

8. Run `npm run local` to start the server, connect to Discord and Reticulum, and operate indefinitely.

9. [Follow the instructions above](#usage) to set up and use the bot on your Discord guild.

[npm]: https://nodejs.org/en/
[discord-docs]: https://discordapp.com/developers/docs/intro
[invite-page]: https://hubs.mozilla.com/discord
[hubs-discord]: https://discord.gg/wHmY4nd
[bot-invite]: mailto:hubs@mozilla.com

## Deploying to hubs.mozilla.com

The Hubs Discord Bot doesn't have a Jenkins job to build it yet. SO we need to build it manually.

### Prerequisites
You'll need the [Habitat CLI](https://www.habitat.sh/docs/install-habitat/) installed locally.

You'll also need access to the Habitat Builder Token. Ask someone for help with that.


### Import the Habitat Builder Keys

Ask someone about getting the private key.

You'll download it and then feed it into Habitat using:

```bash
hab origin key import path/to/mozillareality.sig.key
```

Then for the public key run:

```bash
hab origin key download mozillareality
```

### Building the Habitat Package
In the project directory run:

```bash
HAB_ORIGIN=mozillareality hab pkg build .
```

If everything builds successfully you should see a `/results` folder in the project directory. Take note of the `mozillareality-hubs-discord-bot-0.0.1-<version>-x86_64-linux.hart` file.

We now need to upload that file to the habitat.sh repository.

Run the following command in the project directory:

```
HAB_AUTH_TOKEN="<habitat builder token>" hab pkg upload ./results/mozillareality-hubs-discord-bot-0.0.1-<version>-x86_64-linux.hart
```

You should see a success message. Your uploaded package should be visible at: https://bldr.habitat.sh/#/pkgs/mozillareality/hubs-discord-bot/latest

### Promoting the Habitat Package

This step will promote the package to be live on hubs.mozilla.com

Run this command to promote the package:

```
HAB_AUTH_TOKEN="<habitat builder token>" hab pkg promote mozillareality/hubs-discord-bot/0.0.1/<version> stable
```

To verify the install you can ssh into the box and tail journalctl. To do so run the following command in the `hubs-ops` directory.

```
./bin/ssh.sh discord prod
```

Once logged into the box run `journalctl -f` to tail the logs.

You'll see a bunch of logs saying:

```
Connected to Hubs room
```

Some errors that are caused by users revoking access to the hubs bot or deleting their guild. These are normal.

And finally:
```
Scan finished
```
