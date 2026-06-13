# 7UB Chess

Frontend-only chess board for Vercel.

## What This Is

This repository is only the web interface. It does not run a Discord bot, Express server, API, database, or background process.

The app runs completely in the browser using `chess.js` for legal chess moves.

## Features

- Two-player chess on the same device.
- Legal move validation, check, checkmate, castling, promotion, and draw detection.
- Adjustable player names and time control.
- Player clocks, resign button, board flip, move list, and local browser persistence.
- Vercel-ready Vite build.

## Deploy To Vercel

1. Import this repository in Vercel.
2. Vercel should detect Vite automatically.
3. Build command:

```bash
npm run build
```

4. Output directory:

```text
dist
```

No Discord tokens or backend environment variables are required.

## Local Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Important

Because this is frontend-only, it cannot send Discord messages, host online multiplayer sessions, or keep shared game state between different devices. Those features require a separate backend/bot service.
