import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';

const socket = io();
const game = new Chess();

// DOM Elements
const lobby = document.getElementById('lobby');
const arena = document.getElementById('arena');
const board = document.getElementById('board');
const statusPill = document.getElementById('status-pill');
const eloSlider = document.getElementById('elo-slider');
const eloDisplay = document.getElementById('elo-display');
const lobbyError = document.getElementById('lobby-error');
const opponentName = document.getElementById('opponent-name');
const roomBadge = document.getElementById('room-badge');
const turnLabel = document.getElementById('turn-label');
const moveList = document.getElementById('move-list');
const moveCount = document.getElementById('move-count');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const privateHintBanner = document.getElementById('private-hint-banner');
const privateHintText = document.getElementById('private-hint-text');
const dismissHintBtn = document.getElementById('dismiss-hint-btn');

// State
let mode = null; // 'bot' | 'multiplayer'
let playerColor = 'w';
let currentRoomId = null;
let targetElo = 1200;
let botWorker = null;
let hintWorker = null;

eloSlider.addEventListener('input', (e) => {
  targetElo = parseInt(e.target.value, 10);
  eloDisplay.textContent = targetElo;
});

dismissHintBtn.addEventListener('click', () => {
  privateHintBanner.classList.add('hidden');
});

function createEngineWorker() {
  const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
  const blob = new Blob([`importScripts('${stockfishUrl}');`], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}

async function initBotEngine(elo) {
  if (botWorker) botWorker.terminate();
  botWorker = createEngineWorker();
  botWorker.postMessage('uci');

  if (elo >= 1320) {
    botWorker.postMessage('setoption name UCI_LimitStrength value true');
    botWorker.postMessage(`setoption name UCI_Elo value ${Math.min(elo, 2850)}`);
  } else {
    const skill = Math.max(0, Math.floor((elo - 400) / 150));
    botWorker.postMessage('setoption name UCI_LimitStrength value false');
    botWorker.postMessage(`setoption name Skill Level value ${skill}`);
  }

  botWorker.postMessage('ucinewgame');

  botWorker.onmessage = (event) => {
    const line = event.data;
    if (typeof line === 'string' && line.startsWith('bestmove')) {
      const bestMove = line.split(' ')[1];
      if (bestMove && bestMove !== '(none)') {
        const from = bestMove.substring(0, 2);
        const to = bestMove.substring(2, 4);
        const promotion = bestMove.length > 4 ? bestMove[4] : 'q';
        game.move({ from, to, promotion });
        syncBoard();
      }
    }
  };
}

function initHintEngine() {
  if (hintWorker) hintWorker.terminate();
  hintWorker = createEngineWorker();
  hintWorker.postMessage('uci');
  hintWorker.postMessage('setoption name UCI_LimitStrength value false');
  hintWorker.postMessage('setoption name Skill Level value 20');
  hintWorker.postMessage('ucinewgame');
}

function requestPrivateBestMove() {
  if (game.isGameOver()) {
    showPrivateHint('Game is already over.');
    return;
  }

  if (!hintWorker) initHintEngine();

  showPrivateHint('Calculating best move...');
  const fenAtRequest = game.fen();

  hintWorker.onmessage = (event) => {
    const line = event.data;
    if (typeof line === 'string' && line.startsWith('bestmove')) {
      const uciMove = line.split(' ')[1];
      if (!uciMove || uciMove === '(none)') {
        showPrivateHint('No legal move found.');
        return;
      }

      const probe = new Chess(fenAtRequest);
      const from = uciMove.substring(0, 2);
      const to = uciMove.substring(2, 4);
      const promotion = uciMove.length > 4 ? uciMove[4] : undefined;

      let formattedMove = `${from} → ${to}`;
      try {
        const applied = probe.move({ from, to, promotion: promotion || 'q' });
        if (applied) {
          formattedMove = `${applied.san} (${from} → ${to})`;
        }
      } catch {
        // Fallback to coordinate notation
      }

      showPrivateHint(`Best move: ${formattedMove}`);
    }
  };

  hintWorker.postMessage(`position fen ${fenAtRequest}`);
  hintWorker.postMessage('go depth 14');
}

function showPrivateHint(message) {
  privateHintText.textContent = message;
  privateHintBanner.classList.remove('hidden');
}

function triggerBotMove() {
  if (game.isGameOver()) return;
  statusPill.textContent = 'Bot thinking...';
  botWorker.postMessage(`position fen ${game.fen()}`);

  if (targetElo < 800) {
    botWorker.postMessage('go depth 1');
  } else if (targetElo < 1320) {
    botWorker.postMessage('go depth 3');
  } else {
    botWorker.postMessage('go movetime 600');
  }
}

function enterArena({ matchMode, color, opponentText, roomCode = null }) {
  mode = matchMode;
  playerColor = color;
  currentRoomId = roomCode;

  lobby.classList.add('hidden');
  arena.classList.remove('hidden');
  lobbyError.textContent = '';
  privateHintBanner.classList.add('hidden');
  chatMessages.innerHTML = '';

  opponentName.textContent = opponentText;
  if (roomCode) {
    roomBadge.textContent = `Room ${roomCode}`;
    roomBadge.classList.remove('hidden');
  } else {
    roomBadge.classList.add('hidden');
  }

  board.setOrientation(playerColor === 'w' ? 'white' : 'black');
  syncBoard();

  if (mode === 'bot' && playerColor === 'b') {
    setTimeout(triggerBotMove, 350);
  }
}

function syncBoard() {
  board.setPosition(game.fen());
  renderMoves();

  if (game.isGameOver()) {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      statusPill.textContent = `Checkmate • ${winner} wins`;
    } else {
      statusPill.textContent = 'Draw';
    }
    turnLabel.textContent = 'Game over';
    return;
  }

  const turnSide = game.turn() === 'w' ? 'White' : 'Black';
  turnLabel.textContent = `${turnSide} to move`;
  statusPill.textContent = game.turn() === playerColor ? 'Your turn' : 'Opponent turn';
}

function renderMoves() {
  const history = game.history();
  let lines = '';
  for (let i = 0; i < history.length; i += 2) {
    lines += `${Math.floor(i / 2) + 1}. ${history[i]} ${history[i + 1] || ''}
`;
  }
  moveList.textContent = lines;
  moveList.scrollTop = moveList.scrollHeight;
  moveCount.textContent = `${history.length} ${history.length === 1 ? 'move' : 'moves'}`;
}

function appendChatMessage(sender, text) {
  const row = document.createElement('div');
  row.className = 'chat-msg';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-sender';
  nameSpan.textContent = `${sender}:`;

  const bodySpan = document.createElement('span');
  bodySpan.textContent = text;

  row.appendChild(nameSpan);
  row.appendChild(bodySpan);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Secret `gui` command handler: never sent to chat or server
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = chatInput.value.trim();
  if (!raw) return;

  chatInput.value = '';

  if (raw.toLowerCase() === 'gui') {
    requestPrivateBestMove();
    return;
  }

  if (mode === 'multiplayer' && currentRoomId) {
    socket.emit('chatMessage', { roomId: currentRoomId, text: raw });
  } else {
    appendChatMessage('You', raw);
  }
});

// Board Drag & Drop
board.addEventListener('drag-start', (e) => {
  const { piece } = e.detail;
  if (game.isGameOver()) return e.preventDefault();
  if (game.turn() !== playerColor) return e.preventDefault();
  if ((playerColor === 'w' && piece.startsWith('b')) ||
      (playerColor === 'b' && piece.startsWith('w'))) {
    return e.preventDefault();
  }
});

board.addEventListener('drop', (e) => {
  const { source, target, setAction } = e.detail;
  const moveObj = { from: source, to: target, promotion: 'q' };

  if (mode === 'bot') {
    try {
      const move = game.move(moveObj);
      if (!move) return setAction('snapback');
      privateHintBanner.classList.add('hidden');
      syncBoard();
      setTimeout(triggerBotMove, 220);
    } catch {
      setAction('snapback');
    }
  } else if (mode === 'multiplayer') {
    const temp = new Chess(game.fen());
    try {
      if (!temp.move(moveObj)) return setAction('snapback');
      privateHintBanner.classList.add('hidden');
      socket.emit('makeMove', { roomId: currentRoomId, move: moveObj });
    } catch {
      setAction('snapback');
    }
  }
});

// Lobby Actions
document.getElementById('start-bot-btn').addEventListener('click', async () => {
  const pref = document.getElementById('bot-color').value;
  const chosenColor = pref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pref;

  game.reset();
  await initBotEngine(targetElo);
  initHintEngine();

  enterArena({
    matchMode: 'bot',
    color: chosenColor,
    opponentText: `Bot (${targetElo} ELO)`
  });
});

document.getElementById('create-room-btn').addEventListener('click', () => {
  const preferredColor = document.getElementById('mp-color').value;
  socket.emit('createRoom', { preferredColor });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const roomId = document.getElementById('room-code-input').value;
  if (!roomId) {
    lobbyError.textContent = 'Please enter a 5-character room code.';
    return;
  }
  socket.emit('joinRoom', { roomId });
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  if (botWorker) botWorker.terminate();
  if (hintWorker) hintWorker.terminate();
  window.location.reload();
});

// Socket Events
socket.on('roomCreated', ({ roomId, color, fen }) => {
  game.load(fen);
  initHintEngine();
  enterArena({
    matchMode: 'multiplayer',
    color,
    opponentText: 'Waiting for opponent...',
    roomCode: roomId
  });
  statusPill.textContent = 'Waiting for join';
});

socket.on('gameStart', ({ roomId, fen, players }) => {
  game.load(fen);
  initHintEngine();
  const myColor = players.w === socket.id ? 'w' : 'b';
  enterArena({
    matchMode: 'multiplayer',
    color: myColor,
    opponentText: 'Opponent',
    roomCode: roomId
  });
});

socket.on('boardUpdate', ({ fen }) => {
  game.load(fen);
  syncBoard();
});

socket.on('chatMessage', ({ sender, text }) => {
  appendChatMessage(sender, text);
});

socket.on('opponentDisconnected', () => {
  statusPill.textContent = 'Opponent left';
  turnLabel.textContent = 'Match ended';
});

socket.on('errorMsg', (msg) => {
  lobbyError.textContent = msg;
});
