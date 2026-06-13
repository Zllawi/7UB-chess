# 7UB Chess

Standalone Discord mini chess bot.

## Features

- `/chess invite` opens a modal for player time and invitation timeout.
- `/chess panel` sends a fixed panel where any member can create an invite.
- Two players join from Discord; everyone else can watch.
- Web chess board with legal move validation from the server.
- Supports normal chess rules through `chess.js`: check, checkmate, castling, promotion, draw states, and legal moves.
- Sends a Discord result message when the game ends.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_client_id
GUILD_ID=optional_guild_id_for_fast_command_deploy
PORT=3000
PUBLIC_BASE_URL=https://your-public-domain.example
```

`PUBLIC_BASE_URL` must be a public HTTPS URL. If it is `localhost`, Discord members will not be able to open game links from their own devices.

3. Deploy the slash command:

```bash
npm run deploy
```

4. Start the bot:

```bash
npm start
```

Health check:

```text
GET /health
```

## Notes

- Games are stored in memory. Restarting the process clears active games.
- Use a reverse proxy, Cloudflare Tunnel, ngrok, or any deployed host to provide `PUBLIC_BASE_URL`.
