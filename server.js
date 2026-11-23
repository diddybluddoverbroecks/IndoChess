const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ preferredColor }) => {
    const roomId = generateRoomCode();
    const chess = new Chess();

    const hostColor = preferredColor === 'random'
      ? (Math.random() < 0.5 ? 'w' : 'b')
      : preferredColor;

    rooms.set(roomId, {
      chess,
      players: {
        [hostColor]: socket.id,
        [hostColor === 'w' ? 'b' : 'w']: null
      }
    });

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, color: hostColor, fen: chess.fen() });
  });

  socket.on('joinRoom', ({ roomId }) => {
    const code = roomId.trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('errorMsg', 'Room not found.');
    }

    const openColor = !room.players.w ? 'w' : (!room.players.b ? 'b' : null);
    if (!openColor) {
      return socket.emit('errorMsg', 'Room is full.');
    }

    room.players[openColor] = socket.id;
    socket.join(code);

    io.to(code).emit('gameStart', {
      roomId: code,
      fen: room.chess.fen(),
      players: room.players
    });
  });

  socket.on('makeMove', ({ roomId, move }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const turn = room.chess.turn();
    if (room.players[turn] !== socket.id) return;

    try {
      const result = room.chess.move(move);
      if (result) {
        io.to(roomId).emit('boardUpdate', {
          fen: room.chess.fen(),
          lastMove: result,
          isGameOver: room.chess.isGameOver(),
          isCheckmate: room.chess.isCheckmate(),
          isDraw: room.chess.isDraw(),
          turn: room.chess.turn()
        });
      }
    } catch (e) {
      socket.emit('errorMsg', 'Illegal move.');
    }
  });

  socket.on('chatMessage', ({ roomId, text }) => {
    const room = rooms.get(roomId);
    if (!room || typeof text !== 'string') return;

    const trimmed = text.trim().slice(0, 240);
    if (!trimmed) return;

    const senderColor =
      room.players.w === socket.id ? 'White' :
      room.players.b === socket.id ? 'Black' : 'Spectator';

    io.to(roomId).emit('chatMessage', {
      sender: senderColor,
      text: trimmed,
      ts: Date.now()
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.w === socket.id || room.players.b === socket.id) {
        io.to(roomId).emit('opponentDisconnected');
        rooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`IndoChess server listening on port ${PORT}`);
});
