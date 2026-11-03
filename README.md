# hubs-discord-bot (Beta)

### [Go here to add the hosted discord bot to your server!][invite-page]

### [Discord Bot Video introduction](https://www.youtube.com/watch?v=5HtRJolThZ8)

**Note: self-hosting the bot and pointing it at production Hubs servers is currently broken. If you want to run the bot as-is, you'll need to also run your own Hubs server. We're trying to fix this.**

A Discord bot that interacts with Hubs. Mostly bridges information (chat, media links, joins/leaves), lets you see who is currently in Hubs from Discord and sets Hubs permissions and abilities based on Discord roles. Check out the bot in action on our own [Hubs community Discord][hubs-discord]!

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
  - The "View Channel" permission allows them to enter a room.
  - The "Kick Members" permission provides them the following capabilities (this basically makes them a moderator):
     - They can kick and mute members in the hubs room.
     - They can create and manipulate objects, draw, fly, share video, etc. even if these are turned off in the room settings.
     - Note: only Discord users with verified emails can gain these permissions.
  - The "Manage Channels" permission provides them the following capabilities (this, along with "Kick Members" makes them the equivalent of a room owner):
     - They are able to change the name and scene in the room, modify other room settings, and close the room.
     - Note: only Discord users with verified emails can gain these permissions.
  - The Discord permissions can be set either via their Discord role globally, or permissions given on the specific channel to that user/role.
- Their display name in the Hubs room will reflect their Discord display name.

This only happens with rooms that you create using `!hubs create` -- simply bridging a room by putting it in the topic won't cause it to become permission-linked. This linkage will persist for the lifetime of the Hubs room -- if you don't like it, make a new Hubs room.

> [!IMPORTANT]
> The instance you're connecting the Hubs Bot to must have the "Disable room creation" toggle disabled, i.e. non-administrators must be allowed to create rooms, when attempting to use `!hubs create` otherwise the room creation will fail.  The toggle can be found in the Rooms tab of the App Settings section of the Admin Panel and can be re-enabled after you have created your room.

> [!IMPORTANT]
> You are advised not to set a Hubs bot created room to be invite only.  The bot cannot join invite only rooms and if you haven't saved your invite code you may permanently lose access to your room if your authorization expires.

### Room/channel bridging

Independently of being permission-linked, the bot will detect any Hubs rooms in channel topics in channels that the bot can read and join those rooms, establishing a bridge between the room and the Discord channel. Specifically:

- A notification will appear in the Discord channel when someone joins or leaves the Hubs room, or if administrative stuff happens in the Hubs room.
- Text chat and images will be bridged from the Discord channel into the Hubs room.
 - Supported image formats are: PNG, GIF, and JPEG.
- Text chat and photos will be bridged from the Hubs room into the Discord channel.
- Links to media (images, videos, models) which are _pinned_ in the Hubs room will be bridged to Discord.

Note: the Hubs bot will set up a webhook for the bot to use in the Discord channel to be able to post chat from Hubs.  You can also set up a global one with the name Hubs and a custom icon, if you prefer.

If you remove the Hubs room from the topic, bridging will stop.

Note2: the Hubs bot can't join/bridge non-permission-linked invite only rooms either, they must be set to `Shared link` in order for the bot to join/bridge them.

### Great. I want to run this on my Discord server.

[//]: # ([Head over here to get a bot invite link.][invite-page])

Set up an instance of your bot and invite it to your Discord server with the steps listed in [Hacking on it](#hacking-on-it).

Once the bot is running on your server:

1. Give the bot [appropriate permissions](#permissions) on the channels you want it to run in.

2. (Optional) Create a webhook named "Hubs" in the channels you want it to run in. It will use this webhook to bridge chat and send Hubs status updates.

3. Try out the bot! Type `!hubs` in a channel the bot is in to see all of the ways you can control the bot. Put your favorite Hubs room into a channel topic to start bridging, or use the `!hubs create` command to create a new room.

### Permissions

The bot requires several permissions in order to work:

General Permissions
- Manage Webhooks
- Manage Channels - Grant locally per channel not in Developer Portal
Text Permissions
- Send Messages
- Manage Messages - Grant locally per channel not in Developer Portal
- Embed Links
- Read Message History - Grant locally per channel not in Developer Portal
- Mention @everyone, @here, and All Roles - Grant locally per channel not in Developer Portal

- "Send Messages" and "Embed Links" are necessary in order to bridge between the Hubs room that is linked to a channel and the messages that are sent within the channel on Discord.
- "Manage Webhooks" is necessary in order for the bot to either create or find and use a webhook for bridging chat.
- "Manage Channels" is necessary in order for the bot to set the channel topic and bridge chat. **Note:** We do not advise asking for this permission globally when adding the bot to your server, instead we recommend you grant this permission to the bot in specific groups or channels.
- "Manage Messages" and "Read Message History" are necessary in order for the bot to pin notification messages. Like "Manage Channels", you should probably grant these for specific groups and channels.
- "Mention @everyone, @here, and All Roles" is necessary in order for the bot to notify the people present when the scheduled notification messages are posted. Like "Manage Channels", you should probably grant this for specific groups and channels.

You can and should assign these on a channel-by-channel basis to the bot role after adding the bot to your guild.

## Hacking on it

If you want to run the bot yourself or contribute to it right now, your best bet is to join our Discord and ask for help, because there are some parts of the server code that you will need to run and hack up. In the future this process should be easier.

To simply run the bot process:

1. Clone this repository.

2. Install Node v22 (v22.23.4 or later) and the corresponding version of `npm`. The instructions [at the NPM website][npm] should suffice.

3. Install [Python 3][python] (whatever the latest release is should be fine).

4. Install Javascript dependencies by running `npm ci`.
   - Note: check the comment section of package.json when updating dependencies.

5. [Create a Discord bot on the Discord website.][discord-docs]

6. Add redirect URI in the OAuth page and select the bot permissions.
   - Redirect URI: `https://hubs.local:4000/api/v1/oauth/discord`

7. Make sure "REQUIRES OAUTH2 CODE GRANT" is disabled in the Bot page.

8. Enable the "MESSAGE CONTENT INTENT" in the Privileged Gateway Intents section of the Bot page.

9. Create an `.env` file with your bot's API token. Include `RETICULUM_HOST={your server}` and `HUBS_HOSTS={your server}` to point it at your local backend. `RETICULUM_HOST={your server}` should point to 'hubs.local:4000' (or the domain name of your Hubs instance, e.g. example.org). You can see the different configuration bits you can override in [`.env.defaults`](./.env.defaults). You can also pass these values as environment variables when you run `npm start`/`npm run local`.

10. Create a random alphanumeric string and set the RETICULUM_BOT_ACCESS_KEY in `.env` to it.

11. Inside your local reticulum instance in reticulum/config/dev.exs change the configuration for `Ret.DiscordClient` to point to your bot's: `client_id` ([Discord Developer Portal][discord-dev-portal], OAuth page), `client_secret` (Discord Developer Portal, OAuth page), and `bot_token` (Discord Developer Portal, Bot page) found inside your Discord bot, then change bot_access_key to the value of RETICULUM_BOT_ACCESS_KEY that you set in `.env`.  Add `cdn.discordapp.com` to the img_src cors policy in order to allow Discord images to be rendered in the Hubs chat.  If you're using a Community Edition instance, these fields can be found in `hcce.yaml` (you will need to redeploy your instance with the new values).
   - Note: this is only required for accessing/creating Discord bound rooms and isn't required if you're just bridging to non Discord bound rooms.

12. Run `npm run local` or `npm run start` (for Community Edition instances) to start the server, connect to Discord and Reticulum, and operate indefinitely.

13. Set the Scope for the OAuth 2 URL Generator to "bot" in the OAuth page of the Discord Devloper Portal and then select the permissions you want the bot to globally have (if you navigate away from this page and then return you will need to redo this step)

14. Copy the URL from the bottom of the OAuth page of your Discord bot after everything is set up and you have set your desired permissions and paste it into a new tab to add the bot to your server.

15. [Follow the instructions above](#usage) to set up and use the bot on your Discord guild/server.

[npm]: https://nodejs.org/en/
[python]: https://www.python.org/downloads/
[discord-docs]: https://discordapp.com/developers/docs/intro
[discord-dev-portal]: https://discord.com/developers/applications/
[invite-page]: https://your-server.com/discord
[hubs-discord]: https://discord.gg/wHmY4nd
[bot-invite]: mailto:mail@your-server.com

## Deploying to your-server.com

The Hubs Discord Bot doesn't have a Jenkins job to build it yet. SO we need to build it manually.

### Prerequisites
You'll need the [Habitat CLI](https://www.habitat.sh/docs/install-habitat/) installed locally.

You'll also need access to the Habitat Builder Token. Ask someone for help with that.


### Import the Habitat Builder Keys

Ask someone about getting the private key.

You'll download it and then feed it into Habitat using:

```bash
hab origin key import path/to/your-org.sig.key
```

Then for the public key run:

```bash
hab origin key download your-org
```

### Building the Habitat Package
In the project directory run:

```bash
HAB_ORIGIN=your-org hab pkg build .
```

If everything builds successfully you should see a `/results` folder in the project directory. Take note of the `your-org-hubs-discord-bot-0.0.1-<version>-x86_64-linux.hart` file.

We now need to upload that file to the habitat.sh repository.

Run the following command in the project directory:

```
HAB_AUTH_TOKEN="<habitat builder token>" hab pkg upload ./results/your-org-hubs-discord-bot-0.0.1-<version>-x86_64-linux.hart
```

You should see a success message. Your uploaded package should be visible at: https://bldr.habitat.sh/#/pkgs/your-org/hubs-discord-bot/latest

### Promoting the Habitat Package

This step will promote the package to be live on your-server.com

Run this command to promote the package:

```
HAB_AUTH_TOKEN="<habitat builder token>" hab pkg promote your-org/hubs-discord-bot/0.0.1/<version> stable
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
