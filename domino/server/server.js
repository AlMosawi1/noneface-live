const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createDominoSet() {
  const set = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      set.push([i, j]);
    }
  }
  return set.sort(() => Math.random() - 0.5);
}

function getPublicRoom(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      host: p.host,
      team: p.team
    })),
    started: room.started,
    mode: room.mode,
    targetScore: room.targetScore,
    entryScore: room.entryScore,
    board: room.board,
    turn: room.turn
  };
}

io.on('connection', socket => {
  socket.on('hostGame', data => {
    const code = generateCode();

    rooms[code] = {
      code,
      hostId: socket.id,
      started: false,
      banned: [],
      mode: data.mode,
      targetScore: data.targetScore,
      entryScore: data.entryScore,
      players: [
        {
          id: socket.id,
          name: data.name,
          host: true,
          hand: [],
          team: 1,
          score: 0
        }
      ],
      board: [],
      turn: null,
      lastPlayedBy: null
    };

    socket.join(code);
    socket.emit('roomJoined', getPublicRoom(rooms[code]));
  });

  socket.on('joinGame', data => {
    const room = rooms[data.code];

    if (!room) {
      socket.emit('errorMessage', 'Room not found');
      return;
    }

    if (room.banned.includes(data.name)) {
      socket.emit('errorMessage', 'You are banned from this room');
      return;
    }

    if (room.started) {
      socket.emit('errorMessage', 'Game already started');
      return;
    }

    const team = room.mode === '2v2'
      ? (room.players.length % 2) + 1
      : room.players.length + 1;

    room.players.push({
      id: socket.id,
      name: data.name,
      host: false,
      hand: [],
      team,
      score: 0
    });

    socket.join(data.code);

    io.to(data.code).emit('roomUpdated', getPublicRoom(room));
  });

  socket.on('kickPlayer', data => {
    const room = rooms[data.code];
    if (!room || room.hostId !== socket.id) return;

    const player = room.players.find(p => p.id === data.playerId);
    if (!player) return;

    io.to(player.id).emit('kicked');
    io.sockets.sockets.get(player.id)?.leave(data.code);

    room.players = room.players.filter(p => p.id !== data.playerId);

    io.to(data.code).emit('roomUpdated', getPublicRoom(room));
  });

  socket.on('banPlayer', data => {
    const room = rooms[data.code];
    if (!room || room.hostId !== socket.id) return;

    const player = room.players.find(p => p.id === data.playerId);
    if (!player) return;

    room.banned.push(player.name);

    io.to(player.id).emit('banned');
    io.sockets.sockets.get(player.id)?.leave(data.code);

    room.players = room.players.filter(p => p.id !== data.playerId);

    io.to(data.code).emit('roomUpdated', getPublicRoom(room));
  });

  socket.on('startGame', code => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    const dominoes = createDominoSet();

    room.players.forEach(player => {
      player.hand = dominoes.splice(0, 7);
    });

    room.started = true;

    const starter = room.players.find(player =>
      player.hand.some(d => d[0] === 6 && d[1] === 6)
    );

    room.turn = starter?.id || room.players[0].id;

    io.to(code).emit('gameStarted', {
      room: getPublicRoom(room),
      hands: room.players.map(p => ({
        id: p.id,
        handCount: p.hand.length
      }))
    });

    room.players.forEach(player => {
      io.to(player.id).emit('yourHand', player.hand);
    });
  });

  socket.on('playDomino', data => {
    const room = rooms[data.code];
    if (!room || room.turn !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const index = player.hand.findIndex(d =>
      d[0] === data.domino[0] && d[1] === data.domino[1]
    );

    if (index === -1) return;

    const played = player.hand.splice(index, 1)[0];

    room.board.push(played);
    room.lastPlayedBy = socket.id;

    const currentIndex = room.players.findIndex(p => p.id === socket.id);
    const nextIndex = (currentIndex + 1) % room.players.length;

    room.turn = room.players[nextIndex].id;

    io.to(data.code).emit('boardUpdated', {
      board: room.board,
      turn: room.turn,
      playerId: socket.id,
      domino: played
    });

    room.players.forEach(p => {
      io.to(p.id).emit('yourHand', p.hand);
    });
  });

  socket.on('disconnect', () => {
    Object.values(rooms).forEach(room => {
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(room.code).emit('roomUpdated', getPublicRoom(room));
    });
  });
});

app.get('/', (_, res) => {
  res.send('Domino realtime server running');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
