# 7UB Chess

Vercel chess invite app. It is not a Discord bot.

## What This Is

This repository runs on Vercel as:

- A Vite frontend.
- Serverless API routes for chess rooms.
- Optional Upstash/Vercel KV persistence for shared multiplayer state.

## Features

- Invite owner creates a room and shares three links: white/owner, black, and spectator.
- Only the invite owner can start the game.
- White sees the white pieces at the bottom.
- Black sees the black pieces at the bottom.
- Spectators can only watch and cannot move, start, resign, or flip the board.
- Both players can resign.
- Winner message includes who won against whom.
- Server-side legal move validation with `chess.js`.

## Deploy To Vercel

1. Import this repository in Vercel.
2. Build command:

```bash
npm run build
```

3. Root directory:

```text
.
```

Leave it empty/default in Vercel. Do not set it to `src` or `api`.

4. Output directory:

```text
dist
```

5. For reliable multiplayer on Vercel, add an Upstash Redis/Vercel KV database and set one of these env pairs:

```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

or:

```env
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

Without Redis/KV, local development works with memory storage, but production serverless rooms can disappear between function cold starts.

## Local Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Notes

This repo intentionally does not include Discord Gateway code or bot tokens. A Discord bot must be deployed separately if you want automatic Discord messages.
