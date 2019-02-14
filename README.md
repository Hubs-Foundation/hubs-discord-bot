# hubs-discord-bot

A Discord bot that interacts with [Mozilla Hubs](https://hubs.mozilla.com). Mostly bridges information (chat, media links, joins/leaves) and lets you see who is currently in Hubs from Discord.

To configure it, either create a `.env` file in the root directory with settings, or set equivalent environment
variables. You can see configurables in `.env.defaults`.

To run it, after installing dependencies (`npm ci`) run `npm start` to start the server, connect to Discord and Reticulum,
and operate indefinitely.

## I want to run this on my Discord server.

1. [Create a Discord bot on the Discord website.](https://discordapp.com/developers/docs/intro)

2. Invite the bot to whichever server you want to run it on. Give it permissions to read and send messages in the
   channels you want it to run in.

3. Create a webhook named "Hubs" in the channels you want it to run in. It will use this webhook to bridge chat and
   send Hubs status updates.

3. Grab the Discord API token for your bot.

4. Create an .env file with your bot's token. If you want it to work with rooms on hubs.mozilla.com, also include `RETICULUM_HOST=hubs.mozilla.com` and `HUBS_HOSTS=hubs.mozilla.com`.

5. Run the bot. You should see it come online in Discord.

6. While the bot is running, you can put a Hubs URL in the topic of a channel, and the bot will bridge activity between
   the channel and the hub at that URL.

Check out the bot in action on the [Hubs development Discord](https://discord.gg/wHmY4nd)!
