import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';

const socket = io();
const game = new Chess();

// Reliable Wikimedia Commons Cburnett SVG piece URLs (never fail to load)
const PIECE_IMAGES = {
  wP: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
  wR: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
  wN: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
  wB: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
  wQ: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
  wK: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
  bP: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
  bR: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
  bN: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
  bB: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
  bQ: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
  bK: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg'
};

// DOM Elements
const lobby = document.getElementById('lobby');
const arena = document.getElementById('arena');
const boardEl = document.getElementById('custom-board');
const statusPill = document.getElementById('status-pill');
const eloSlider = document.getElementById('elo-slider');
const eloDisplay = document.getElementById('elo-display');
const serverSeatTag = document.getElementById('server-seat-tag');
const lobbyError = document.getElementById('lobby-error');
const opponentName = document.getElementById('opponent-name');
const playerName = document.getElementById('player-name');
const modeBadge = document.getElementById('mode-badge');
const turnLabel = document.getElementById('turn-label');
const moveList = document.getElementById('move-list');
const moveCount = document.getElementById('move-count');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const privateHintBanner = document.getElementById('private-hint-banner');
const privateHintText = document.getElementById('private-hint-text');
const dismissHintBtn = document.getElementById('dismiss-hint-btn');
const resetBoardBtn = document.getElementById('reset-board-btn');

// State
let mode = null; // 'bot' | 'global'
let playerColor = 'w'; // 'w' | 'b' | 'spectator'
let orientation = 'w';
let targetElo = 1200;
let botWorker = null;
let hintWorker = null;
let selectedSquare = null;
let legalTargets = [];
let lastMoveSquares = [];

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
        const moved = game.move({ from, to, promotion });
        if (moved) {
          lastMoveSquares = [moved.from, moved.to];
        }
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
        // Fallback
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

// Custom Board Rendering (click-to-move AND drag-and-drop)
function renderBoard() {
  boardEl.innerHTML = '';
  const files = orientation === 'w'
    ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    : ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
  const ranks = orientation === 'w'
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];

  for (let rIdx = 0; rIdx < 8; rIdx++) {
    for (let fIdx = 0; fIdx < 8; fIdx++) {
      const file = files[fIdx];
      const rank = ranks[rIdx];
      const sq = `${file}${rank}`;
      const fileNum = 'abcdefgh'.indexOf(file);
      const isLight = (fileNum + rank) % 2 === 1;

      const sqDiv = document.createElement('div');
      sqDiv.className = `square ${isLight ? 'light' : 'dark'}`;
      sqDiv.dataset.square = sq;

      if (selectedSquare === sq) sqDiv.classList.add('selected');
      if (lastMoveSquares.includes(sq)) sqDiv.classList.add('last-move');

      const targetMatch = legalTargets.find((m) => m.to === sq);
      if (targetMatch) {
        sqDiv.classList.add(targetMatch.captured ? 'legal-capture' : 'legal-target');
      }

      if (fIdx === 0) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord-rank';
        rankLabel.textContent = rank;
        sqDiv.appendChild(rankLabel);
      }

      if (rIdx === 7) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord-file';
        fileLabel.textContent = file;
        sqDiv.appendChild(fileLabel);
      }

      const piece = game.get(sq);
      if (piece) {
        const key = `${piece.color}${piece.type.toUpperCase()}`;
        const img = document.createElement('img');
        img.src = PIECE_IMAGES[key];
        img.alt = key;
        img.className = 'piece-img';
        img.draggable = canInteractWithPiece(piece.color);

        img.addEventListener('dragstart', (e) => {
          if (!canInteractWithPiece(piece.color)) {
            e.preventDefault();
            return;
          }
          selectSquare(sq);
          e.dataTransfer.setData('text/plain', sq);
        });

        sqDiv.appendChild(img);
      }

      sqDiv.addEventListener('dragover', (e) => e.preventDefault());
      sqDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromSq = e.dataTransfer.getData('text/plain');
        if (fromSq && fromSq !== sq) {
          attemptMove(fromSq, sq);
        }
      });

      sqDiv.addEventListener('click', () => handleSquareClick(sq));

      boardEl.appendChild(sqDiv);
    }
  }
}

function canInteractWithPiece(pieceColor) {
  if (game.isGameOver()) return false;
  if (playerColor !== 'w' && playerColor !== 'b') return false;
  if (game.turn() !== playerColor) return false;
  return pieceColor === playerColor;
}

function selectSquare(sq) {
  selectedSquare = sq;
  legalTargets = game.moves({ square: sq, verbose: true });
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function handleSquareClick(sq) {
  if (game.isGameOver()) return;
  if (playerColor !== 'w' && playerColor !== 'b') return;
  if (game.turn() !== playerColor) return;

  if (selectedSquare) {
    const isLegalTarget = legalTargets.some((m) => m.to === sq);
    if (isLegalTarget) {
      attemptMove(selectedSquare, sq);
      return;
    }
  }

  const piece = game.get(sq);
  if (piece && canInteractWithPiece(piece.color)) {
    if (selectedSquare === sq) {
      clearSelection();
      renderBoard();
    } else {
      selectSquare(sq);
    }
  } else {
    clearSelection();
    renderBoard();
  }
}

function attemptMove(from, to) {
  const moveObj = { from, to, promotion: 'q' };
  clearSelection();

  if (mode === 'bot') {
    try {
      const move = game.move(moveObj);
      if (!move) {
        renderBoard();
        return;
      }
      lastMoveSquares = [move.from, move.to];
      privateHintBanner.classList.add('hidden');
      syncBoard();
      setTimeout(triggerBotMove, 220);
    } catch {
      renderBoard();
    }
  } else if (mode === 'global') {
    const temp = new Chess(game.fen());
    try {
      const valid = temp.move(moveObj);
      if (!valid) {
        renderBoard();
        return;
      }
      privateHintBanner.classList.add('hidden');
      socket.emit('makeMove', { move: moveObj });
    } catch {
      renderBoard();
    }
  }
}

function enterArena({ matchMode, role, opponentText, badgeText }) {
  mode = matchMode;
  playerColor = role;
  orientation = role === 'b' ? 'b' : 'w';
  clearSelection();
  lastMoveSquares = [];

  lobby.classList.add('hidden');
  arena.classList.remove('hidden');
  lobbyError.textContent = '';
  privateHintBanner.classList.add('hidden');
  chatMessages.innerHTML = '';

  opponentName.textContent = opponentText;
  playerName.textContent =
    role === 'w' ? 'You (White)' :
    role === 'b' ? 'You (Black)' : 'You (Spectator)';

  modeBadge.textContent = badgeText;

  if (mode === 'global' && (role === 'w' || role === 'b')) {
    resetBoardBtn.classList.remove('hidden');
  } else {
    resetBoardBtn.classList.add('hidden');
  }

  syncBoard();

  if (mode === 'bot' && playerColor === 'b') {
    setTimeout(triggerBotMove, 350);
  }
}

function syncBoard() {
  renderBoard();
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

  if (playerColor === 'spectator') {
    statusPill.textContent = `Watching • ${turnSide} turn`;
  } else {
    statusPill.textContent = game.turn() === playerColor ? 'Your turn' : 'Opponent turn';
  }
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

  if (mode === 'global') {
    socket.emit('chatMessage', { text: raw });
  } else {
    appendChatMessage('You', raw);
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
    role: chosenColor,
    opponentText: `Bot (${targetElo} ELO)`,
    badgeText: `BOT • ${targetElo}`
  });
});

document.getElementById('join-global-btn').addEventListener('click', () => {
  const preferredColor = document.getElementById('mp-color').value;
  socket.emit('joinGlobal', { preferredColor });
});

resetBoardBtn.addEventListener('click', () => {
  socket.emit('resetGlobalGame');
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  if (mode === 'global') {
    socket.emit('leaveGlobal');
  }
  if (botWorker) botWorker.terminate();
  if (hintWorker) hintWorker.terminate();
  window.location.reload();
});

// Socket Events
socket.on('seatStatus', ({ w, b }) => {
  const count = (w ? 1 : 0) + (b ? 1 : 0);
  serverSeatTag.textContent = `${count}/2 Seated`;
});

socket.on('joinedGlobal', ({ role }) => {
  initHintEngine();
  enterArena({
    matchMode: 'global',
    role,
    opponentText: role === 'w' ? 'Black Player' : (role === 'b' ? 'White Player' : 'Black (Top)'),
    badgeText: 'LIVE SERVER'
  });
});

socket.on('globalState', ({ fen, players, lastMove }) => {
  const count = (players.w ? 1 : 0) + (players.b ? 1 : 0);
  serverSeatTag.textContent = `${count}/2 Seated`;

  if (mode !== 'global') return;

  game.load(fen);
  if (lastMove) {
    lastMoveSquares = [lastMove.from, lastMove.to];
  } else if (game.history().length === 0) {
    lastMoveSquares = [];
  }

  if (playerColor === 'w') {
    opponentName.textContent = players.b ? 'Black Player (Online)' : 'Waiting for Black...';
  } else if (playerColor === 'b') {
    opponentName.textContent = players.w ? 'White Player (Online)' : 'Waiting for White...';
  } else {
    opponentName.textContent = players.b ? 'Black Player' : 'Open Seat (Black)';
    playerName.textContent = players.w ? 'White Player (Watching)' : 'Open Seat (White)';
  }

  syncBoard();
});

socket.on('chatMessage', ({ sender, text }) => {
  if (mode === 'global') {
    appendChatMessage(sender, text);
  }
});

socket.on('errorMsg', (msg) => {
  lobbyError.textContent = msg;
});
