import { Chess } from 'https://esm.sh/chess.js@1.0.0-beta.8';

const socket = io();
const game = new Chess();

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

const SNITHIK_AVATAR_SVG = `
<svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
  <path d="M32 6 L34.5 11 L40 9 L37.5 14.5 L26.5 14.5 L24 9 L29.5 11 Z" fill="#c084fc" />
  <circle cx="32" cy="22" r="7.5" fill="#09070f" stroke="#a855f7" stroke-width="2.2" />
  <ellipse cx="29.3" cy="21.5" rx="1.6" ry="1" fill="#f0abfc" />
  <ellipse cx="34.7" cy="21.5" rx="1.6" ry="1" fill="#f0abfc" />
  <path d="M23 31 C23 28.5, 41 28.5, 41 31 L45 48 L19 48 Z" fill="#09070f" stroke="#9333ea" stroke-width="2.2" />
  <rect x="15" y="48" width="34" height="6" rx="3" fill="#09070f" stroke="#a855f7" stroke-width="2.2" />
</svg>`;

// DOM Elements
const lobby = document.getElementById('lobby');
const arena = document.getElementById('arena');
const boardEl = document.getElementById('custom-board');
const arrowOverlay = document.getElementById('arrow-overlay');
const statusPill = document.getElementById('status-pill');
const eloSlider = document.getElementById('elo-slider');
const eloDisplay = document.getElementById('elo-display');
const serverSeatTag = document.getElementById('server-seat-tag');
const lobbyError = document.getElementById('lobby-error');
const opponentAvatar = document.getElementById('opponent-avatar');
const opponentName = document.getElementById('opponent-name');
const playerName = document.getElementById('player-name');
const modeBadge = document.getElementById('mode-badge');
const turnLabel = document.getElementById('turn-label');
const moveList = document.getElementById('move-list');
const moveCount = document.getElementById('move-count');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const matchControlsRow = document.getElementById('match-controls-row');
const undoBtn = document.getElementById('undo-btn');
const resignBtn = document.getElementById('resign-btn');
const resetBoardBtn = document.getElementById('reset-board-btn');
const undoRequestBanner = document.getElementById('undo-request-banner');
const undoRequestText = document.getElementById('undo-request-text');
const acceptUndoBtn = document.getElementById('accept-undo-btn');
const declineUndoBtn = document.getElementById('decline-undo-btn');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverCrown = document.getElementById('gameover-crown');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverSubtitle = document.getElementById('gameover-subtitle');
const confettiLayer = document.getElementById('confetti-layer');
const dismissGameoverBtn = document.getElementById('dismiss-gameover-btn');

// State
let mode = null; // 'bot' | 'snithik' | 'global'
let playerColor = 'w'; // 'w' | 'b' | 'spectator'
let orientation = 'w';
let targetElo = 1200;
let botWorker = null;
let hintWorker = null;
let selectedSquare = null;
let legalTargets = [];
let lastMoveSquares = [];
let queuedPremove = null;
let hintArrow = null; // { from, to }
let resignedBy = null; // 'w' | 'b' | null
let celebrationShownForMatch = false;

eloSlider.addEventListener('input', (e) => {
  targetElo = parseInt(e.target.value, 10);
  eloDisplay.textContent = targetElo;
});

dismissGameoverBtn.addEventListener('click', () => {
  gameoverOverlay.classList.add('hidden');
});

function createEngineWorker() {
  const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
  const blob = new Blob([`importScripts('${stockfishUrl}');`], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
}

// Calibrated ELO controller:
// Stockfish 10's built-in UCI_Elo bottoms out around 1350 and plays much stronger than nominal
// at lower depths. Combining Skill Level + MultiPV controlled inaccuracy rates makes
// 400–2800 feel genuinely accurate to human ELO brackets, while Snithik runs full strength.
function getCalibratedProfile(elo, isSnithik) {
  if (isSnithik) {
    return {
      skillLevel: 20,
      useUciElo: false,
      uciElo: 3200,
      depth: 14,
      movetime: 900,
      multiPv: 1,
      blunderChance: 0,
      inaccuracyChance: 0
    };
  }

  if (elo <= 550) {
    return { skillLevel: 0, useUciElo: false, depth: 1, movetime: 40, multiPv: 5, blunderChance: 0.58, inaccuracyChance: 0.30 };
  }
  if (elo <= 800) {
    return { skillLevel: 1, useUciElo: false, depth: 1, movetime: 60, multiPv: 4, blunderChance: 0.36, inaccuracyChance: 0.34 };
  }
  if (elo <= 1050) {
    return { skillLevel: 3, useUciElo: false, depth: 2, movetime: 90, multiPv: 3, blunderChance: 0.20, inaccuracyChance: 0.32 };
  }
  if (elo <= 1300) {
    return { skillLevel: 5, useUciElo: false, depth: 3, movetime: 130, multiPv: 3, blunderChance: 0.10, inaccuracyChance: 0.25 };
  }
  if (elo <= 1550) {
    return { skillLevel: 8, useUciElo: true, uciElo: elo, depth: 4, movetime: 180, multiPv: 2, blunderChance: 0.04, inaccuracyChance: 0.18 };
  }
  if (elo <= 1850) {
    return { skillLevel: 12, useUciElo: true, uciElo: elo, depth: 6, movetime: 250, multiPv: 2, blunderChance: 0.01, inaccuracyChance: 0.10 };
  }
  if (elo <= 2200) {
    return { skillLevel: 16, useUciElo: true, uciElo: elo, depth: 8, movetime: 360, multiPv: 1, blunderChance: 0, inaccuracyChance: 0 };
  }
  if (elo <= 2550) {
    return { skillLevel: 18, useUciElo: true, uciElo: elo, depth: 10, movetime: 500, multiPv: 1, blunderChance: 0, inaccuracyChance: 0 };
  }
  return { skillLevel: 20, useUciElo: true, uciElo: 2800, depth: 12, movetime: 700, multiPv: 1, blunderChance: 0, inaccuracyChance: 0 };
}

let activeBotProfile = getCalibratedProfile(1200, false);
let candidateMultiPvMoves = {};

async function initBotEngine(elo, isSnithik = false) {
  if (botWorker) botWorker.terminate();
  botWorker = createEngineWorker();
  activeBotProfile = getCalibratedProfile(elo, isSnithik);

  botWorker.postMessage('uci');

  if (activeBotProfile.useUciElo) {
    botWorker.postMessage('setoption name UCI_LimitStrength value true');
    botWorker.postMessage(`setoption name UCI_Elo value ${activeBotProfile.uciElo}`);
  } else {
    botWorker.postMessage('setoption name UCI_LimitStrength value false');
  }
  botWorker.postMessage(`setoption name Skill Level value ${activeBotProfile.skillLevel}`);
  botWorker.postMessage(`setoption name MultiPV value ${activeBotProfile.multiPv}`);
  botWorker.postMessage('ucinewgame');

  botWorker.onmessage = (event) => {
    const line = event.data;
    if (typeof line !== 'string') return;

    if (line.startsWith('info ') && line.includes(' multipv ') && line.includes(' pv ')) {
      const mpvMatch = line.match(/multipv (\d+)/);
      const pvMatch = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (mpvMatch && pvMatch) {
        candidateMultiPvMoves[parseInt(mpvMatch[1], 10)] = pvMatch[1];
      }
    }

    if (line.startsWith('bestmove')) {
      let chosenUci = line.split(' ')[1];

      // Pick lower-ranked MultiPV candidate proportionally to calibrated ELO error rate
      if (activeBotProfile.multiPv > 1) {
        const ranked = Object.keys(candidateMultiPvMoves)
          .map(Number)
          .sort((a, b) => a - b)
          .map((k) => candidateMultiPvMoves[k]);

        if (ranked.length > 1) {
          const roll = Math.random();
          if (roll < activeBotProfile.blunderChance) {
            chosenUci = ranked[ranked.length - 1];
          } else if (roll < activeBotProfile.blunderChance + activeBotProfile.inaccuracyChance) {
            chosenUci = ranked[Math.min(1, ranked.length - 1)];
          } else {
            chosenUci = ranked[0];
          }
        }
      }

      if (chosenUci && chosenUci !== '(none)' && !resignedBy) {
        const from = chosenUci.substring(0, 2);
        const to = chosenUci.substring(2, 4);
        const promotion = chosenUci.length > 4 ? chosenUci[4] : 'q';
        const moved = game.move({ from, to, promotion });
        if (moved) {
          lastMoveSquares = [moved.from, moved.to];
        }
        syncBoard();
      }
    }
  };
}

// Pre-warm hint engine immediately so `gui` draws an arrow in ~120ms
function initHintEngine() {
  if (hintWorker) return;
  hintWorker = createEngineWorker();
  hintWorker.postMessage('uci');
  hintWorker.postMessage('setoption name UCI_LimitStrength value false');
  hintWorker.postMessage('setoption name Skill Level value 20');
  hintWorker.postMessage('isready');
}

initHintEngine();

function requestFastHintArrow() {
  if (isMatchOver()) return;
  if (!hintWorker) initHintEngine();

  const fenAtRequest = game.fen();
  hintWorker.onmessage = (event) => {
    const line = event.data;
    if (typeof line === 'string' && line.startsWith('bestmove')) {
      const uciMove = line.split(' ')[1];
      if (uciMove && uciMove !== '(none)' && game.fen() === fenAtRequest) {
        hintArrow = {
          from: uciMove.substring(0, 2),
          to: uciMove.substring(2, 4)
        };
        renderHintArrow();
      }
    }
  };

  hintWorker.postMessage(`position fen ${fenAtRequest}`);
  hintWorker.postMessage('go movetime 120');
}

function clearHintArrow() {
  hintArrow = null;
  arrowOverlay.innerHTML = '';
}

function squareToBoardCoords(sq) {
  const fileIdx = sq.charCodeAt(0) - 97;
  const rankIdx = parseInt(sq[1], 10) - 1;
  const col = orientation === 'w' ? fileIdx : 7 - fileIdx;
  const row = orientation === 'w' ? 7 - rankIdx : rankIdx;
  return {
    x: col * 100 + 50,
    y: row * 100 + 50
  };
}

function renderHintArrow() {
  arrowOverlay.innerHTML = '';
  if (!hintArrow) return;

  const start = squareToBoardCoords(hintArrow.from);
  const end = squareToBoardCoords(hintArrow.to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const shaftStartOffset = 18;
  const headLength = 42;
  const shaftHalfWidth = 11;
  const headHalfWidth = 26;

  const sx = start.x + ux * shaftStartOffset;
  const sy = start.y + uy * shaftStartOffset;
  const neckX = end.x - ux * headLength;
  const neckY = end.y - uy * headLength;

  const points = [
    `${sx + px * shaftHalfWidth},${sy + py * shaftHalfWidth}`,
    `${neckX + px * shaftHalfWidth},${neckY + py * shaftHalfWidth}`,
    `${neckX + px * headHalfWidth},${neckY + py * headHalfWidth}`,
    `${end.x},${end.y}`,
    `${neckX - px * headHalfWidth},${neckY - py * headHalfWidth}`,
    `${neckX - px * shaftHalfWidth},${neckY - py * shaftHalfWidth}`,
    `${sx - px * shaftHalfWidth},${sy - py * shaftHalfWidth}`
  ].join(' ');

  const ns = 'http://www.w3.org/2000/svg';
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'rgba(129, 182, 76, 0.86)');
  poly.setAttribute('stroke', 'rgba(42, 66, 20, 0.45)');
  poly.setAttribute('stroke-width', '3');
  poly.setAttribute('stroke-linejoin', 'round');

  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', end.x);
  ring.setAttribute('cy', end.y);
  ring.setAttribute('r', '42');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', 'rgba(129, 182, 76, 0.65)');
  ring.setAttribute('stroke-width', '6');

  arrowOverlay.appendChild(ring);
  arrowOverlay.appendChild(poly);
}

function triggerBotMove() {
  if (isMatchOver()) return;
  candidateMultiPvMoves = {};
  statusPill.textContent = mode === 'snithik' ? 'Snithik calculating...' : 'Bot thinking...';
  botWorker.postMessage(`position fen ${game.fen()}`);

  if (mode === 'snithik') {
    botWorker.postMessage(`go depth ${activeBotProfile.depth} movetime ${activeBotProfile.movetime}`);
  } else if (activeBotProfile.depth <= 3) {
    botWorker.postMessage(`go depth ${activeBotProfile.depth}`);
  } else {
    botWorker.postMessage(`go movetime ${activeBotProfile.movetime}`);
  }
}

function isMatchOver() {
  return Boolean(resignedBy) || game.isGameOver();
}

function triggerEndAnimation({ title, subtitle, isCheckmateWin }) {
  if (celebrationShownForMatch) return;
  celebrationShownForMatch = true;

  gameoverTitle.textContent = title;
  gameoverSubtitle.textContent = subtitle;
  gameoverCrown.textContent = isCheckmateWin ? '♛' : (resignedBy ? '🏳' : '🤝');
  gameoverOverlay.classList.remove('hidden');

  confettiLayer.innerHTML = '';
  if (!isCheckmateWin) return;

  const colors = mode === 'snithik'
    ? ['#c084fc', '#f0abfc', '#ffd54f', '#ffffff', '#9333ea']
    : ['#81b64c', '#ffd54f', '#ffffff', '#a3d96c', '#ff8a65'];

  for (let i = 0; i < 54; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[i % colors.length];
    piece.style.animationDuration = `${1.4 + Math.random() * 1.4}s`;
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    confettiLayer.appendChild(piece);
  }
}

// Premove helpers
function clearPremove() {
  queuedPremove = null;
}

function isPseudoLegalPremove(from, to) {
  const piece = game.get(from);
  if (!piece || piece.color !== playerColor) return false;
  if (from === to) return false;

  const targetPiece = game.get(to);
  if (targetPiece && targetPiece.color === playerColor) return false;

  const f1 = from.charCodeAt(0) - 97;
  const r1 = parseInt(from[1], 10);
  const f2 = to.charCodeAt(0) - 97;
  const r2 = parseInt(to[1], 10);
  const df = f2 - f1;
  const dr = r2 - r1;
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  switch (piece.type) {
    case 'p': {
      const dir = piece.color === 'w' ? 1 : -1;
      const startRank = piece.color === 'w' ? 2 : 7;
      if (df === 0 && dr === dir && !targetPiece) return true;
      if (df === 0 && r1 === startRank && dr === 2 * dir && !targetPiece) {
        const midSq = `${from[0]}${r1 + dir}`;
        if (!game.get(midSq)) return true;
      }
      if (adf === 1 && dr === dir) return true;
      return false;
    }
    case 'n':
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case 'b':
      return adf === adr && adf > 0 && isPathClear(f1, r1, f2, r2);
    case 'r':
      return (df === 0 || dr === 0) && (adf + adr > 0) && isPathClear(f1, r1, f2, r2);
    case 'q':
      return ((adf === adr) || df === 0 || dr === 0) && (adf + adr > 0) && isPathClear(f1, r1, f2, r2);
    case 'k':
      if (adf <= 1 && adr <= 1) return true;
      if (dr === 0 && adf === 2) return true;
      return false;
    default:
      return false;
  }
}

function isPathClear(f1, r1, f2, r2) {
  const stepF = Math.sign(f2 - f1);
  const stepR = Math.sign(r2 - r1);
  let cf = f1 + stepF;
  let cr = r1 + stepR;
  while (cf !== f2 || cr !== r2) {
    const sq = `${String.fromCharCode(97 + cf)}${cr}`;
    if (game.get(sq)) return false;
    cf += stepF;
    cr += stepR;
  }
  return true;
}

function tryExecuteQueuedPremove() {
  if (!queuedPremove) return false;
  if (isMatchOver()) {
    clearPremove();
    return false;
  }
  if (game.turn() !== playerColor) return false;

  const pm = queuedPremove;
  clearPremove();

  if (mode === 'bot' || mode === 'snithik') {
    try {
      const moved = game.move(pm);
      if (moved) {
        lastMoveSquares = [moved.from, moved.to];
        clearHintArrow();
        syncBoard();
        setTimeout(triggerBotMove, 180);
        return true;
      }
    } catch {
      // Premove became illegal
    }
    return false;
  }

  if (mode === 'global') {
    const probe = new Chess(game.fen());
    try {
      const valid = probe.move(pm);
      if (valid) {
        clearHintArrow();
        socket.emit('makeMove', { move: pm });
        return true;
      }
    } catch {
      // Premove became illegal
    }
    return false;
  }

  return false;
}

// Custom Board Rendering
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
      if (queuedPremove && (queuedPremove.from === sq || queuedPremove.to === sq)) {
        sqDiv.classList.add('premove-square');
      }

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
        img.draggable = canQueuePiece(piece.color);

        img.addEventListener('dragstart', (e) => {
          if (!canQueuePiece(piece.color)) {
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
          handleMoveOrPremove(fromSq, sq);
        }
      });

      sqDiv.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (queuedPremove) {
          clearPremove();
          clearSelection();
          syncBoard();
        }
      });

      sqDiv.addEventListener('click', () => handleSquareClick(sq));

      boardEl.appendChild(sqDiv);
    }
  }

  renderHintArrow();
}

function canQueuePiece(pieceColor) {
  if (isMatchOver()) return false;
  if (playerColor !== 'w' && playerColor !== 'b') return false;
  return pieceColor === playerColor;
}

function selectSquare(sq) {
  selectedSquare = sq;
  if (game.turn() === playerColor) {
    legalTargets = game.moves({ square: sq, verbose: true });
  } else {
    legalTargets = [];
  }
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function handleSquareClick(sq) {
  if (isMatchOver()) return;
  if (playerColor !== 'w' && playerColor !== 'b') return;

  if (selectedSquare) {
    if (selectedSquare === sq) {
      clearSelection();
      renderBoard();
      return;
    }
    const pieceOnSelected = game.get(selectedSquare);
    if (pieceOnSelected && pieceOnSelected.color === playerColor) {
      handleMoveOrPremove(selectedSquare, sq);
      return;
    }
  }

  const piece = game.get(sq);
  if (piece && canQueuePiece(piece.color)) {
    selectSquare(sq);
  } else {
    clearSelection();
    renderBoard();
  }
}

function handleMoveOrPremove(from, to) {
  const moveObj = { from, to, promotion: 'q' };
  clearSelection();

  if (game.turn() === playerColor) {
    clearPremove();
    if (mode === 'bot' || mode === 'snithik') {
      try {
        const move = game.move(moveObj);
        if (!move) {
          renderBoard();
          return;
        }
        lastMoveSquares = [move.from, move.to];
        clearHintArrow();
        syncBoard();
        setTimeout(triggerBotMove, 200);
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
        clearHintArrow();
        socket.emit('makeMove', { move: moveObj });
      } catch {
        renderBoard();
      }
    }
    return;
  }

  if (queuedPremove && queuedPremove.from === from && queuedPremove.to === to) {
    clearPremove();
    renderBoard();
    return;
  }

  if (isPseudoLegalPremove(from, to)) {
    queuedPremove = moveObj;
    syncBoard();
  } else {
    renderBoard();
  }
}

function enterArena({ matchMode, role, opponentText, badgeText, isSnithik = false }) {
  mode = matchMode;
  playerColor = role;
  orientation = role === 'b' ? 'b' : 'w';
  resignedBy = null;
  celebrationShownForMatch = false;
  clearSelection();
  clearPremove();
  clearHintArrow();
  lastMoveSquares = [];

  lobby.classList.add('hidden');
  arena.classList.remove('hidden');
  gameoverOverlay.classList.add('hidden');
  undoRequestBanner.classList.add('hidden');
  lobbyError.textContent = '';
  chatMessages.innerHTML = '';

  opponentName.textContent = opponentText;
  if (isSnithik) {
    opponentAvatar.innerHTML = SNITHIK_AVATAR_SVG;
    opponentAvatar.classList.add('snithik-avatar');
    modeBadge.classList.add('snithik-badge');
  } else {
    opponentAvatar.textContent = '♟';
    opponentAvatar.classList.remove('snithik-avatar');
    modeBadge.classList.remove('snithik-badge');
  }

  playerName.textContent =
    role === 'w' ? 'You (White)' :
    role === 'b' ? 'You (Black)' : 'You (Spectator)';

  modeBadge.textContent = badgeText;

  const isSeatedPlayer = role === 'w' || role === 'b';
  if (isSeatedPlayer) {
    matchControlsRow.classList.remove('hidden');
  } else {
    matchControlsRow.classList.add('hidden');
  }

  if (mode === 'global' && isSeatedPlayer) {
    resetBoardBtn.classList.remove('hidden');
  } else {
    resetBoardBtn.classList.add('hidden');
  }

  syncBoard();

  if ((mode === 'bot' || mode === 'snithik') && playerColor === 'b') {
    setTimeout(triggerBotMove, 350);
  }
}

function syncBoard() {
  if (!isMatchOver() && game.turn() === playerColor && queuedPremove) {
    const executed = tryExecuteQueuedPremove();
    if (executed) return;
  }

  renderBoard();
  renderMoves();

  const historyLen = game.history().length;
  const over = isMatchOver();
  undoBtn.disabled = over || historyLen === 0;
  resignBtn.disabled = over;

  if (over) {
    clearPremove();
    clearHintArrow();
    undoRequestBanner.classList.add('hidden');

    if (resignedBy) {
      const winner = resignedBy === 'w' ? 'Black' : (mode === 'snithik' ? 'Snithik' : 'White');
      const loser = resignedBy === 'w' ? 'White' : 'Black';
      statusPill.textContent = `${loser} resigned • ${winner} wins`;
      turnLabel.textContent = 'Game over';
      triggerEndAnimation({
        title: 'Resignation',
        subtitle: `${loser} resigned — ${winner} wins!`,
        isCheckmateWin: false
      });
    } else if (game.isCheckmate()) {
      const winnerSide = game.turn() === 'w' ? 'b' : 'w';
      const winnerLabel = mode === 'snithik' && winnerSide !== playerColor
        ? 'Snithik'
        : (winnerSide === 'w' ? 'White' : 'Black');
      statusPill.textContent = `Checkmate • ${winnerLabel} wins`;
      turnLabel.textContent = 'Checkmate!';
      triggerEndAnimation({
        title: 'Checkmate!',
        subtitle: `${winnerLabel} wins the match`,
        isCheckmateWin: true
      });
    } else {
      statusPill.textContent = 'Draw';
      turnLabel.textContent = 'Game drawn';
      triggerEndAnimation({
        title: 'Draw',
        subtitle: 'Match ended in a draw',
        isCheckmateWin: false
      });
    }
    return;
  }

  const turnSide = game.turn() === 'w' ? 'White' : 'Black';
  turnLabel.textContent = `${turnSide} to move`;

  if (playerColor === 'spectator') {
    statusPill.textContent = `Watching • ${turnSide} turn`;
  } else if (game.turn() === playerColor) {
    statusPill.textContent = 'Your turn';
  } else if (queuedPremove) {
    statusPill.textContent = `Premove: ${queuedPremove.from}→${queuedPremove.to}`;
  } else {
    statusPill.textContent = mode === 'snithik' ? 'Snithik turn' : 'Opponent turn';
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

// Secret `gui` command draws fast hint arrow directly on the board
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = chatInput.value.trim();
  if (!raw) return;

  chatInput.value = '';

  if (raw.toLowerCase() === 'gui') {
    requestFastHintArrow();
    return;
  }

  if (mode === 'global') {
    socket.emit('chatMessage', { text: raw });
  } else {
    appendChatMessage('You', raw);
  }
});

// Undo & Resign Controls
undoBtn.addEventListener('click', () => {
  if (isMatchOver() || game.history().length === 0) return;

  if (mode === 'bot' || mode === 'snithik') {
    clearPremove();
    clearHintArrow();
    if (game.turn() === playerColor && game.history().length >= 2) {
      game.undo();
      game.undo();
    } else {
      game.undo();
    }
    const hist = game.history({ verbose: true });
    lastMoveSquares = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : [];
    syncBoard();
    if (game.turn() !== playerColor) {
      setTimeout(triggerBotMove, 250);
    }
  } else if (mode === 'global') {
    socket.emit('requestUndo');
    undoBtn.textContent = '⏳ Waiting...';
    undoBtn.disabled = true;
  }
});

acceptUndoBtn.addEventListener('click', () => {
  socket.emit('respondUndo', { accept: true });
  undoRequestBanner.classList.add('hidden');
});

declineUndoBtn.addEventListener('click', () => {
  socket.emit('respondUndo', { accept: false });
  undoRequestBanner.classList.add('hidden');
});

resignBtn.addEventListener('click', () => {
  if (isMatchOver()) return;
  if (playerColor !== 'w' && playerColor !== 'b') return;

  if (mode === 'bot' || mode === 'snithik') {
    resignedBy = playerColor;
    syncBoard();
  } else if (mode === 'global') {
    socket.emit('resignGame');
  }
});

// Lobby Actions
document.getElementById('start-bot-btn').addEventListener('click', async () => {
  const pref = document.getElementById('bot-color').value;
  const chosenColor = pref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pref;

  game.reset();
  await initBotEngine(targetElo, false);

  enterArena({
    matchMode: 'bot',
    role: chosenColor,
    opponentText: `Bot (${targetElo} ELO)`,
    badgeText: `BOT • ${targetElo}`,
    isSnithik: false
  });
});

// Against Snithik: Max ELO boss, no ELO shown anywhere
document.getElementById('against-snithik-btn').addEventListener('click', async () => {
  const pref = document.getElementById('bot-color').value;
  const chosenColor = pref === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : pref;

  game.reset();
  await initBotEngine(3200, true);

  enterArena({
    matchMode: 'snithik',
    role: chosenColor,
    opponentText: 'Snithik',
    badgeText: 'SNITHIK',
    isSnithik: true
  });
});

document.getElementById('join-global-btn').addEventListener('click', () => {
  const preferredColor = document.getElementById('mp-color').value;
  socket.emit('joinGlobal', { preferredColor });
});

resetBoardBtn.addEventListener('click', () => {
  clearPremove();
  clearHintArrow();
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
  enterArena({
    matchMode: 'global',
    role,
    opponentText: role === 'w' ? 'Black Player' : (role === 'b' ? 'White Player' : 'Black (Top)'),
    badgeText: 'LIVE SERVER',
    isSnithik: false
  });
});

socket.on('globalState', ({ fen, players, lastMove, resignedBy: srvResignedBy, pendingUndoFrom }) => {
  const count = (players.w ? 1 : 0) + (players.b ? 1 : 0);
  serverSeatTag.textContent = `${count}/2 Seated`;

  if (mode !== 'global') return;

  const prevHistoryLen = game.history().length;
  game.load(fen);
  resignedBy = srvResignedBy || null;

  if (game.history().length === 0 && prevHistoryLen > 0) {
    celebrationShownForMatch = false;
    gameoverOverlay.classList.add('hidden');
    clearPremove();
    clearHintArrow();
  }

  if (lastMove) {
    lastMoveSquares = [lastMove.from, lastMove.to];
  } else {
    const hist = game.history({ verbose: true });
    lastMoveSquares = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : [];
  }

  // Handle mutual undo request UI
  undoBtn.textContent = '↺ Undo';
  if (pendingUndoFrom && (playerColor === 'w' || playerColor === 'b')) {
    if (pendingUndoFrom === playerColor) {
      undoBtn.textContent = '⏳ Requested';
      undoRequestBanner.classList.add('hidden');
    } else {
      const requesterLabel = pendingUndoFrom === 'w' ? 'White' : 'Black';
      undoRequestText.textContent = `${requesterLabel} wants to undo last move.`;
      undoRequestBanner.classList.remove('hidden');
    }
  } else {
    undoRequestBanner.classList.add('hidden');
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

  if (pendingUndoFrom === playerColor) {
    undoBtn.disabled = true;
  }
});

socket.on('chatMessage', ({ sender, text }) => {
  if (mode === 'global') {
    appendChatMessage(sender, text);
  }
});

socket.on('errorMsg', (msg) => {
  appendChatMessage('System', msg);
});
