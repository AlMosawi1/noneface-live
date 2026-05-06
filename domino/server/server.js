const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[code]);
  return code;
}
function createDominoSet() {
  const set = [];
  for (let i = 0; i <= 6; i++) for (let j = i; j <= 6; j++) set.push([i, j]);
  return set.sort(() => Math.random() - 0.5);
}
function neededPlayers(room) { return room.mode === '2v2' ? 4 : 2; }
function sameDomino(a, b) { return a && b && ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])); }
function getEdges(room) {
  if (!room.board.length) return { left: null, right: null };
  return { left: room.board[0].domino[0], right: room.board[room.board.length - 1].domino[1] };
}
function orientForSide(room, domino, side) {
  if (!room.board.length) return { ok: true, domino: [...domino] };
  const { left, right } = getEdges(room);
  const [a, b] = domino;
  if (side === 'left') {
    if (b === left) return { ok: true, domino: [a, b] };
    if (a === left) return { ok: true, domino: [b, a] };
  }
  if (side === 'right') {
    if (a === right) return { ok: true, domino: [a, b] };
    if (b === right) return { ok: true, domino: [b, a] };
  }
  return { ok: false };
}
function legalSides(room, domino) {
  if (!room.board.length) {
    if (room.firstRequired && !sameDomino(domino, room.firstRequired)) return [];
    return ['start'];
  }
  const sides = [];
  if (orientForSide(room, domino, 'left').ok) sides.push('left');
  if (orientForSide(room, domino, 'right').ok) sides.push('right');
  return sides;
}
function hasPlayable(room, player) { return player.hand.some(d => legalSides(room, d).length > 0); }
function findStartingPlayer(room) {
  let starter = null;
  let required = null;
  const doubleSixPlayer = room.players.find(p => p.hand.some(d => d[0] === 6 && d[1] === 6));
  if (room.mode === '2v2') {
    starter = doubleSixPlayer;
    required = [6, 6];
  } else {
    if (doubleSixPlayer) {
      starter = doubleSixPlayer;
      required = [6, 6];
    } else {
      let best = null;
      room.players.forEach(p => p.hand.forEach(d => {
        if (d[0] === d[1] && (!best || d[0] > best.domino[0])) best = { player: p, domino: d };
      }));
      if (best) {
        starter = best.player;
        required = [...best.domino];
      } else {
        let high = null;
        room.players.forEach(p => p.hand.forEach(d => {
          const sum = d[0] + d[1];
          if (!high || sum > high.sum) high = { player: p, domino: d, sum };
        }));
        starter = high.player;
        required = [...high.domino];
      }
    }
  }
  return { starter, required };
}
function getPublicRoom(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name, host: p.host, team: p.team, handCount: p.hand.length })),
    started: room.started,
    mode: room.mode,
    targetScore: room.targetScore,
    entryScore: room.entryScore,
    board: room.board,
    turn: room.turn,
    neededPlayers: neededPlayers(room),
    boneyardCount: room.boneyard ? room.boneyard.length : 0,
    firstRequired: room.firstRequired
  };
}
function broadcastRoom(room) { io.to(room.code).emit('roomUpdated', getPublicRoom(room)); }
function sendHands(room) { room.players.forEach(p => io.to(p.id).emit('yourHand', p.hand)); }
function nextTurn(room, currentId) {
  const idx = room.players.findIndex(p => p.id === currentId);
  if (idx === -1 || !room.players.length) return null;
  return room.players[(idx + 1) % room.players.length].id;
}
function autoDrawForTurn(room) {
  if (!room.started || !room.turn || !room.board.length) return;
  const player = room.players.find(p => p.id === room.turn);
  if (!player) return;
  let drew = 0;
  while (!hasPlayable(room, player) && room.boneyard.length > 0) {
    player.hand.push(room.boneyard.shift());
    drew++;
  }
  if (drew > 0) io.to(player.id).emit('autoDrew', { count: drew });
  if (!hasPlayable(room, player) && room.boneyard.length === 0) {
    room.turn = nextTurn(room, player.id);
  }
}
function endWithWinner(room, winnerName, reason) {
  io.to(room.code).emit('gameWon', { winnerName, reason });
  room.started = false;
  room.turn = null;
}

io.on('connection', socket => {
  socket.on('hostGame', data => {
    const code = generateCode();
    rooms[code] = {
      code, hostId: socket.id, started: false, banned: [],
      mode: data.mode === '2v2' ? '2v2' : '1v1',
      targetScore: Number(data.targetScore || 100), entryScore: Number(data.entryScore || 21),
      players: [{ id: socket.id, name: data.name || 'Host', host: true, hand: [], team: 1, score: 0 }],
      board: [], turn: null, lastPlayedBy: null, boneyard: [], firstRequired: null
    };
    socket.join(code);
    socket.emit('roomJoined', getPublicRoom(rooms[code]));
  });

  socket.on('joinGame', data => {
    const room = rooms[(data.code || '').toUpperCase()];
    if (!room) return socket.emit('errorMessage', 'Room not found');
    if (room.banned.includes(data.name)) return socket.emit('errorMessage', 'You are banned from this room');
    if (room.started) return socket.emit('errorMessage', 'Game already started');
    if (room.players.length >= neededPlayers(room)) return socket.emit('errorMessage', 'Room is full');
    const team = room.mode === '2v2' ? (room.players.length % 2) + 1 : room.players.length + 1;
    room.players.push({ id: socket.id, name: data.name || 'Player', host: false, hand: [], team, score: 0 });
    socket.join(room.code);
    broadcastRoom(room);
  });

  socket.on('kickPlayer', data => {
    const room = rooms[data.code];
    if (!room || room.hostId !== socket.id || room.started) return;
    const player = room.players.find(p => p.id === data.playerId);
    if (!player) return;
    io.to(player.id).emit('kicked');
    io.sockets.sockets.get(player.id)?.leave(data.code);
    room.players = room.players.filter(p => p.id !== data.playerId);
    broadcastRoom(room);
  });

  socket.on('banPlayer', data => {
    const room = rooms[data.code];
    if (!room || room.hostId !== socket.id || room.started) return;
    const player = room.players.find(p => p.id === data.playerId);
    if (!player) return;
    room.banned.push(player.name);
    io.to(player.id).emit('banned');
    io.sockets.sockets.get(player.id)?.leave(data.code);
    room.players = room.players.filter(p => p.id !== data.playerId);
    broadcastRoom(room);
  });

  socket.on('startGame', code => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length !== neededPlayers(room)) return socket.emit('errorMessage', `Need ${neededPlayers(room)} players to start`);
    const dominoes = createDominoSet();
    room.board = [];
    room.players.forEach(p => { p.hand = dominoes.splice(0, 7); });
    room.boneyard = dominoes;
    const start = findStartingPlayer(room);
    room.started = true;
    room.turn = start.starter.id;
    room.firstRequired = start.required;
    io.to(code).emit('gameStarted', { room: getPublicRoom(room) });
    sendHands(room);
  });

  socket.on('getLegalSides', data => {
    const room = rooms[data.code];
    if (!room || room.turn !== socket.id) return;
    socket.emit('legalSides', { domino: data.domino, sides: legalSides(room, data.domino) });
  });

  socket.on('playDomino', data => {
    const room = rooms[data.code];
    if (!room || room.turn !== socket.id || !room.started) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const idx = player.hand.findIndex(d => sameDomino(d, data.domino));
    if (idx === -1) return;
    const playedRaw = player.hand[idx];
    let side = data.side || 'right';
    if (!room.board.length) side = 'start';
    const sides = legalSides(room, playedRaw);
    if (!sides.includes(side)) return socket.emit('errorMessage', 'This domino cannot be placed there');
    const oriented = side === 'start' ? { ok: true, domino: [...playedRaw] } : orientForSide(room, playedRaw, side);
    if (!oriented.ok) return socket.emit('errorMessage', 'This domino cannot be placed there');
    player.hand.splice(idx, 1);
    const placed = { domino: oriented.domino, by: player.id, side };
    if (side === 'left') room.board.unshift(placed); else room.board.push(placed);
    room.lastPlayedBy = player.id;
    if (player.hand.length === 0) {
      endWithWinner(room, player.name, 'finished all dominoes');
    } else {
      room.firstRequired = null;
      room.turn = nextTurn(room, player.id);
      autoDrawForTurn(room);
    }
    io.to(data.code).emit('boardUpdated', { room: getPublicRoom(room) });
    sendHands(room);
  });

  socket.on('quitGame', code => {
    const room = rooms[code];
    if (!room) return;
    const quitter = room.players.find(p => p.id === socket.id);
    if (!quitter) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(code);
    if (room.started && room.players.length > 0) endWithWinner(room, room.players[0].name, `${quitter.name} quit`);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    Object.values(rooms).forEach(room => {
      const leaving = room.players.find(p => p.id === socket.id);
      if (!leaving) return;
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.started && room.players.length > 0) endWithWinner(room, room.players[0].name, `${leaving.name} disconnected`);
      broadcastRoom(room);
    });
  });
});

app.get('/', (_, res) => res.send('Domino realtime server running'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
