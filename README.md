# IndoChess

Node.js chess web application ready for Render deployment.

## Features
- Chess.com-inspired dark charcoal UI with custom SVG piece rendering (supports both click-to-move and drag-and-drop).
- Chess.com-style premoves (red highlights, right-click or re-click to cancel, automatic execution when your turn starts).
- Single shared live multiplayer server (no room codes required) + Stockfish bot with adjustable ELO (400–2800).
- Hidden `gui` command in chat: privately calculates and displays the best move without posting to chat.

## Run Locally
```bash
npm install
npm start
```

## Deploy on Render
1. Upload the files inside `indochess/` (`package.json`, `server.js`, and the `public/` folder) to your GitHub repo.
2. Render runs `npm install` and `npm start` automatically.
