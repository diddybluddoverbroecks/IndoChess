# IndoChess

Node.js chess web application ready for Render deployment.

## Features
- Chess.com-inspired dark charcoal UI and classic board colors with soft tactile buttons.
- Adjustable Stockfish bot ELO (400–2800) and live Socket.io multiplayer rooms.
- Hidden `gui` command in chat: shows the Stockfish best move in a private banner without posting to chat or sending to opponents.

## Run Locally
```bash
npm install
npm start
```

## Deploy on Render
1. Push `indochess/` to GitHub.
2. Create a new **Web Service** on Render.
3. Set Build Command to `npm install` and Start Command to `npm start`.
