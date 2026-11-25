const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const globalMatch = {
  chess: new Chess(),
  players: { w: null, b: null },
  resignedBy: null, // 'w' | 'b' | null
  pendingUndoFrom: null // 'w' | 'b' | null
};

function getPlayersSnapshot() {
  return {
    w: Boolean(globalMatch.players.w),
    b: Boolean(globalMatch.players.b)
  };
}

function broadcastState(extra = {}) {
  const isResigned = Boolean(globalMatch.resignedBy);
  io.emit('globalState', {
    fen: globalMatch.chess.fen(),
    history: globalMatch.chess.history(),
    turn: globalMatch.chess.turn(),
    isGameOver: globalMatch.chess.isGameOver() || isResigned,
    isCheckmate: globalMatch.chess.isCheckmate(),
    isDraw: !isResigned && globalMatch.chess.isDraw(),
    resignedBy: globalMatch.resignedBy,
    pendingUndoFrom: globalMatch.pendingUndoFrom,
    players: getPlayersSnapshot(),
    ...extra
  });
}

io.on('connection', (socket) => {
  socket.emit('seatStatus', getPlayersSnapshot());

  socket.on('joinGlobal', ({ preferredColor } = {}) => {
    if (globalMatch.players.w === socket.id) {
      socket.emit('joinedGlobal', { role: 'w' });
      broadcastState();
      return;
    }
    if (globalMatch.players.b === socket.id) {
      socket.emit('joinedGlobal', { role: 'b' });
      broadcastState();
      return;
    }

    let assignedRole = 'spectator';

    if (preferredColor === 'w' && !globalMatch.players.w) {
      globalMatch.players.w = socket.id;
      assignedRole = 'w';
    } else if (preferredColor === 'b' && !globalMatch.players.b) {
      globalMatch.players.b = socket.id;
      assignedRole = 'b';
    } else if (!globalMatch.players.w && !globalMatch.players.b) {
      assignedRole = preferredColor === 'b' ? 'b' : (preferredColor === 'w' ? 'w' : (Math.random() < 0.5 ? 'w' : 'b'));
      globalMatch.players[assignedRole] = socket.id;
    } else if (!globalMatch.players.w) {
      globalMatch.players.w = socket.id;
      assignedRole = 'w';
    } else if (!globalMatch.players.b) {
      globalMatch.players.b = socket.id;
      assignedRole = 'b';
    }

    socket.emit('joinedGlobal', { role: assignedRole });
    broadcastState();
  });

  socket.on('leaveGlobal', () => {
    let changed = false;
    if (globalMatch.players.w === socket.id) {
      globalMatch.players.w = null;
      changed = true;
    }
    if (globalMatch.players.b === socket.id) {
      globalMatch.players.b = null;
      changed = true;
    }
    if (changed) {
      globalMatch.pendingUndoFrom = null;
      broadcastState();
    }
  });

  socket.on('resetGlobalGame', () => {
    if (globalMatch.players.w !== socket.id && globalMatch.players.b !== socket.id) return;
    globalMatch.chess.reset();
    globalMatch.resignedBy = null;
    globalMatch.pendingUndoFrom = null;
    broadcastState();
  });

  socket.on('makeMove', ({ move }) => {
    if (globalMatch.resignedBy || globalMatch.chess.isGameOver()) return;
    const turn = globalMatch.chess.turn();
    if (globalMatch.players[turn] !== socket.id) return;

    try {
      const result = globalMatch.chess.move(move);
      if (result) {
        globalMatch.pendingUndoFrom = null;
        broadcastState({ lastMove: result });
      }
    } catch (e) {
      socket.emit('errorMsg', 'Illegal move.');
    }
  });

  socket.on('requestUndo', () => {
    if (globalMatch.resignedBy || globalMatch.chess.isGameOver()) return;
    if (globalMatch.chess.history().length === 0) return;

    const requesterColor =
      globalMatch.players.w === socket.id ? 'w' :
      globalMatch.players.b === socket.id ? 'b' : null;
    if (!requesterColor) return;

    const opponentColor = requesterColor === 'w' ? 'b' : 'w';
    if (!globalMatch.players[opponentColor]) {
      socket.emit('errorMsg', 'Opponent must be seated to agree to an undo.');
      return;
    }

    if (globalMatch.pendingUndoFrom === requesterColor) return;

    globalMatch.pendingUndoFrom = requesterColor;
    broadcastState();
  });

  socket.on('respondUndo', ({ accept }) => {
    if (!globalMatch.pendingUndoFrom) return;
    const responderColor =
      globalMatch.players.w === socket.id ? 'w' :
      globalMatch.players.b === socket.id ? 'b' : null;
    if (!responderColor || responderColor === globalMatch.pendingUndoFrom) return;

    globalMatch.pendingUndoFrom = null;
    if (accept) {
      globalMatch.chess.undo();
    }
    broadcastState({ undoAccepted: Boolean(accept) });
  });

  socket.on('resignGame', () => {
    if (globalMatch.resignedBy || globalMatch.chess.isGameOver()) return;
    const resignerColor =
      globalMatch.players.w === socket.id ? 'w' :
      globalMatch.players.b === socket.id ? 'b' : null;
    if (!resignerColor) return;

    globalMatch.resignedBy = resignerColor;
    globalMatch.pendingUndoFrom = null;
    broadcastState();
  });

  socket.on('chatMessage', ({ text }) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 240);
    if (!trimmed) return;

    const sender =
      globalMatch.players.w === socket.id ? 'White' :
      globalMatch.players.b === socket.id ? 'Black' : 'Spectator';

    io.emit('chatMessage', {
      sender,
      text: trimmed,
      ts: Date.now()
    });
  });

  socket.on('disconnect', () => {
    let changed = false;
    if (globalMatch.players.w === socket.id) {
      globalMatch.players.w = null;
      changed = true;
    }
    if (globalMatch.players.b === socket.id) {
      globalMatch.players.b = null;
      changed = true;
    }
    if (changed) {
      globalMatch.pendingUndoFrom = null;
      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`IndoChess server listening on port ${PORT}`);
});
