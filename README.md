# IndoChess

Node.js chess web application ready for Render deployment.

## Features
- Chess.com-inspired dark charcoal UI with custom SVG piece rendering (click-to-move, drag-and-drop, and premoves).
- Calibrated bot ELO scaling (400–2800) using Skill Level and MultiPV error calibration.
- **Against Snithik** mode: custom glowing black king-pawn emblem, full-strength Stockfish engine, and zero ELO displayed.
- Single shared live multiplayer server with mutual-consent Undo and Resign buttons.
- Hidden `gui` command in chat: draws an instant translucent green best-move arrow directly on the board.
- Checkmate confetti and floating crown celebration overlay.

## Run Locally
```bash
npm install
npm start
```

## Deploy on Render
1. Upload the files inside `indochess/` (`package.json`, `server.js`, and the `public/` folder) to your GitHub repo.
2. Render runs `npm install` and `npm start` automatically.
