const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = {};
const RECONNECT_MS = 120000;
const REDRAW_VOTE_MS = 20000;

function code() {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let x;
  do {
    x = '';
    for (let i = 0; i < 6; i++) x += c[Math.floor(Math.random() * c.length)];
  } while (rooms[x]);
  return x;
}

function shuffledDeck() {
  const s = [];
  for (let i = 0; i <= 6; i++) for (let j = i; j <= 6; j++) s.push([i, j]);
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

function need(r) {
  return r.mode === '2v2' ? 4 : 2;
}

function same(a, b) {
  return a && b && ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));
}

function edges(r) {
  if (!r.board.length) return { left: null, right: null };
  return { left: r.board[0].domino[0], right: r.board[r.board.length - 1].domino[1] };
}

function orient(r, d, side) {
  if (!r.board.length) return { ok: true, domino: [...d] };
  const { left, right } = edges(r);
  const [a, b] = d;
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

function legal(r, d) {
  if (!r.board.length) {
    if (r.firstRequired && !same(d, r.firstRequired)) return [];
    return ['start'];
  }
  const s = [];
  if (orient(r, d, 'left').ok) s.push('left');
  if (orient(r, d, 'right').ok) s.push('right');
  return s;
}

function hasPlay(r, p) {
  return p.hand.some((d) => legal(r, d).length > 0);
}

function startInfo(r) {
  const six = r.players.find((p) => p.hand.some((d) => d[0] === 6 && d[1] === 6));
  if (r.mode === '2v2') {
    if (six) return { starter: six, required: [6, 6] };
  } else if (six) return { starter: six, required: [6, 6] };
  let best = null;
  r.players.forEach((p) =>
    p.hand.forEach((d) => {
      if (d[0] === d[1] && (!best || d[0] > best.domino[0])) best = { player: p, domino: d };
    })
  );
  if (best) return { starter: best.player, required: [...best.domino] };
  let high = null;
  r.players.forEach((p) =>
    p.hand.forEach((d) => {
      const sum = d[0] + d[1];
      if (!high || sum > high.sum) high = { player: p, domino: d, sum };
    })
  );
  return { starter: high.player, required: [...high.domino] };
}

/** First tile rule for a chosen starter (used after blocked / go-out rounds). */
function openingRequiredForPlayer(p) {
  const six = p.hand.find((d) => d[0] === 6 && d[1] === 6);
  if (six) return [6, 6];
  let best = null;
  for (const d of p.hand) {
    if (d[0] === d[1] && (!best || d[0] > best[0])) best = [...d];
  }
  if (best) return best;
  let pick = p.hand[0];
  let bestSum = pick ? pick[0] + pick[1] : 0;
  for (const d of p.hand) {
    const s = d[0] + d[1];
    if (s > bestSum) {
      pick = d;
      bestSum = s;
    }
  }
  return pick ? [...pick] : [0, 0];
}

function countDoublesInHand(hand) {
  return hand.filter((d) => d[0] === d[1]).length;
}

function teamPipSum(r, teamNum) {
  let sum = 0;
  r.players.forEach((p) => {
    if (p.team !== teamNum) return;
    p.hand.forEach((d) => {
      sum += d[0] + d[1];
    });
  });
  return sum;
}

function next(r, id) {
  const i = r.players.findIndex((p) => p.id === id);
  if (i < 0) return null;
  return r.players[(i + 1) % r.players.length].id;
}

function collectAllDominoes(r) {
  const pool = [];
  r.players.forEach((p) => {
    while (p.hand.length) pool.push(p.hand.pop());
  });
  while (r.board.length) {
    const placed = r.board.pop();
    pool.push(placed.domino);
  }
  while (r.boneyard.length) pool.push(r.boneyard.pop());
  return pool;
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealHands(r, pool) {
  r.players.forEach((p) => {
    p.hand = [];
  });
  r.boneyard = [];
  r.board = [];
  for (let k = 0; k < 7; k++) {
    r.players.forEach((p) => {
      if (pool.length) p.hand.push(pool.shift());
    });
  }
  r.boneyard = pool;
}

function clearRedrawTimer(r) {
  if (r.redrawTimer) {
    clearTimeout(r.redrawTimer);
    r.redrawTimer = null;
  }
}

function buildRedrawVote(r, subject) {
  const voterPids = r.players.filter((p) => p.pid !== subject.pid).map((p) => p.pid);
  const neededAgrees = r.mode === '2v2' ? 2 : 1;
  return {
    subjectPid: subject.pid,
    subjectName: subject.name,
    voterPids,
    neededAgrees,
    votes: {},
  };
}

function startPlayPhase(r, forcedStarterPid = null) {
  clearRedrawTimer(r);
  r.gamePhase = 'play';
  r.redrawVote = null;
  r.consecutivePasses = 0;
  const s = startInfo(r);
  let starter = s.starter;
  let required = [...s.required];
  if (forcedStarterPid) {
    const fp = r.players.find((p) => p.pid === forcedStarterPid);
    if (fp) {
      starter = fp;
      required = openingRequiredForPlayer(fp);
    }
  }
  r.turn = starter.id;
  r.firstRequired = required;
  r.lastPlayedBy = null;
  ensureTurnCanAct(r);
}

function maybeStartRedrawVoteWithStarter(r) {
  const suspect = r.players.find((p) => countDoublesInHand(p.hand) >= 5);
  if (suspect) {
    r.gamePhase = 'redraw_vote';
    r.redrawVote = buildRedrawVote(r, suspect);
    r.redrawVote.votes = {};
    broadcast(r);
    hands(r);
    clearRedrawTimer(r);
    r.redrawTimer = setTimeout(() => finalizeRedrawVote(r, true), REDRAW_VOTE_MS);
    return;
  }
  const forced = r.pendingRoundStarterPid || null;
  startPlayPhase(r, forced);
  r.pendingRoundStarterPid = null;
  broadcast(r);
  hands(r);
}

function finalizeRedrawVote(r, timedOut) {
  clearRedrawTimer(r);
  if (!r.started || r.gamePhase !== 'redraw_vote' || !r.redrawVote) return;
  const { voterPids, neededAgrees, votes } = r.redrawVote;
  const agrees = voterPids.filter((pid) => votes[pid] === true).length;
  const allAnswered = voterPids.every((pid) => votes[pid] !== undefined);
  if (agrees >= neededAgrees) {
    const pool = collectAllDominoes(r);
    shuffleInPlace(pool);
    dealHands(r, pool);
    r.pendingRoundStarterPid = null;
    maybeStartRedrawVoteWithStarter(r);
    return;
  }
  if (allAnswered || timedOut) {
    startPlayPhase(r, r.pendingRoundStarterPid || null);
    r.pendingRoundStarterPid = null;
    broadcast(r);
    hands(r);
    ensureTurnCanAct(r);
  }
}

function beginRound(r, nextStarterPid = null) {
  r.lastPlayedBy = null;
  r.consecutivePasses = 0;
  r.pendingRoundStarterPid = nextStarterPid || null;
  const pool = collectAllDominoes(r);
  if (!pool.length) shuffleInPlace(shuffledDeck()).forEach((t) => pool.push(t));
  else shuffleInPlace(pool);
  dealHands(r, pool);
  maybeStartRedrawVoteWithStarter(r);
}

function pub(r) {
  return {
    code: r.code,
    players: r.players.map((p) => ({
      id: p.id,
      pid: p.pid,
      name: p.name,
      host: p.host,
      team: p.team,
      handCount: p.hand.length,
      connected: p.connected !== false,
    })),
    started: r.started,
    mode: r.mode,
    targetScore: r.targetScore,
    entryScore: r.entryScore,
    teamLoss: r.teamLoss || { 1: 0, 2: 0 },
    board: r.board,
    turn: r.turn,
    neededPlayers: need(r),
    boneyardCount: r.boneyard ? r.boneyard.length : 0,
    firstRequired: r.firstRequired,
    gamePhase: r.gamePhase || 'lobby',
    redrawVote: r.redrawVote
      ? {
          subjectPid: r.redrawVote.subjectPid,
          subjectName: r.redrawVote.subjectName,
          voterPids: r.redrawVote.voterPids,
          neededAgrees: r.redrawVote.neededAgrees,
          votes: { ...r.redrawVote.votes },
        }
      : null,
    lastPlayedBy: r.lastPlayedBy,
  };
}

function broadcast(r) {
  io.to(r.code).emit('roomUpdated', pub(r));
}

function hands(r) {
  r.players.forEach((p) => {
    if (p.connected !== false) io.to(p.id).emit('yourHand', p.hand);
  });
}

function autoDraw(r) {
  if (!r.started || !r.turn || !r.board.length) return;
  const p = r.players.find((x) => x.id === r.turn);
  if (!p) return;
  let drew = 0;
  while (!hasPlay(r, p) && r.boneyard.length) {
    p.hand.push(r.boneyard.shift());
    drew++;
  }
  if (drew) io.to(p.id).emit('autoDrew', { count: drew });
}

function ensureTurnCanAct(r) {
  if (!r.started || r.gamePhase !== 'play') return;
  let guard = 0;
  while (guard++ < 40) {
    const p = r.players.find((x) => x.id === r.turn);
    if (!p) return;
    autoDraw(r);
    if (hasPlay(r, p)) {
      r.consecutivePasses = 0;
      broadcast(r);
      hands(r);
      return;
    }
    if (r.boneyard.length) continue;
    r.consecutivePasses = (r.consecutivePasses || 0) + 1;
    if (r.consecutivePasses >= r.players.length) {
      resolveBlockedRound(r);
      return;
    }
    r.turn = next(r, p.id);
  }
}

function resolveBlockedRound(r) {
  const t1 = teamPipSum(r, 1);
  const t2 = teamPipSum(r, 2);
  r.consecutivePasses = 0;
  if (t1 === t2) {
    io.to(r.code).emit('roundMessage', { text: 'Blocked round — tied pip totals. No points. New deal.' });
    beginRound(r, r.lastPlayedBy ? r.players.find((p) => p.id === r.lastPlayedBy)?.pid : null);
    return;
  }
  const loserTeam = t1 > t2 ? 1 : 2;
  const loserPips = loserTeam === 1 ? t1 : t2;
  let applied = 0;
  if (loserPips >= r.entryScore) {
    r.teamLoss[loserTeam] += loserPips;
    applied = loserPips;
  }
  io.to(r.code).emit('roundMessage', {
    text:
      applied > 0
        ? `Blocked round — team ${loserTeam} loses (${loserPips} pips). +${applied} toward their ${r.targetScore} cap (entry ${r.entryScore}).`
        : `Blocked round — team ${loserTeam} would lose ${loserPips} pips, below entry ${r.entryScore}. No points counted.`,
  });
  if (r.teamLoss[loserTeam] >= r.targetScore) {
    const winTeam = loserTeam === 1 ? 2 : 1;
    const names = r.players
      .filter((p) => p.team === winTeam)
      .map((p) => p.name)
      .join(' & ');
    io.to(r.code).emit('gameWon', {
      winnerName: names || `Team ${winTeam}`,
      reason: `Team ${loserTeam} reached ${r.targetScore} loss points.`,
    });
    r.started = false;
    r.turn = null;
    r.gamePhase = 'lobby';
    broadcast(r);
    hands(r);
    return;
  }
  const starterPid = r.lastPlayedBy ? r.players.find((p) => p.id === r.lastPlayedBy)?.pid : null;
  beginRound(r, starterPid);
}

function winMatch(r, winnerTeam, reason) {
  const names = r.players
    .filter((p) => p.team === winnerTeam)
    .map((p) => p.name)
    .join(' & ');
  io.to(r.code).emit('gameWon', { winnerName: names || `Team ${winnerTeam}`, reason });
  r.started = false;
  r.turn = null;
  r.gamePhase = 'lobby';
  broadcast(r);
}

function finishRoundByEmptyHand(r, winner) {
  io.to(r.code).emit('roundMessage', { text: `${winner.name} emptied their hand. New round — they start.` });
  beginRound(r, winner.pid);
}

function removeAfterGrace(r, p, reason) {
  clearTimeout(p.reconnectTimer);
  p.reconnectTimer = setTimeout(() => {
    const room = rooms[r.code];
    if (!room) return;
    const player = room.players.find((x) => x.pid === p.pid);
    if (!player || player.connected !== false) return;
    room.players = room.players.filter((x) => x.pid !== p.pid);
    if (room.hostPid === p.pid && room.players[0]) {
      room.players[0].host = true;
      room.hostPid = room.players[0].pid;
      room.hostId = room.players[0].id;
    }
    if (room.started && room.players.length > 0) winMatch(room, room.players[0].team, reason);
    broadcast(room);
  }, RECONNECT_MS);
}

io.on('connection', (socket) => {
  socket.on('hostGame', (d) => {
    const pid = d.pid || socket.id;
    const roomCode = code();
    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      hostPid: pid,
      started: false,
      banned: [],
      mode: d.mode === '2v2' ? '2v2' : '1v1',
      targetScore: Math.max(1, +d.targetScore) || 100,
      entryScore: Math.max(0, +d.entryScore) || 21,
      players: [
        {
          id: socket.id,
          pid,
          name: d.name || 'Host',
          host: true,
          hand: [],
          team: 1,
          connected: true,
        },
      ],
      board: [],
      turn: null,
      lastPlayedBy: null,
      boneyard: [],
      firstRequired: null,
      teamLoss: { 1: 0, 2: 0 },
      gamePhase: 'lobby',
      redrawVote: null,
      consecutivePasses: 0,
      pendingRoundStarterPid: null,
    };
    socket.join(roomCode);
    socket.emit('session', { pid, code: roomCode });
    socket.emit('roomJoined', pub(rooms[roomCode]));
  });

  socket.on('rejoinGame', (d) => {
    const r = rooms[(d.code || '').toUpperCase()];
    if (!r) return socket.emit('errorMessage', 'Room not found');
    const p = r.players.find((x) => x.pid === d.pid);
    if (!p) return socket.emit('errorMessage', 'Reconnect session not found');
    clearTimeout(p.reconnectTimer);
    p.id = socket.id;
    p.connected = true;
    if (r.hostPid === p.pid) r.hostId = socket.id;
    socket.join(r.code);
    socket.emit('session', { pid: p.pid, code: r.code });
    socket.emit('roomJoined', pub(r));
    socket.emit('yourHand', p.hand);
    broadcast(r);
  });

  socket.on('joinGame', (d) => {
    const r = rooms[(d.code || '').toUpperCase()];
    if (!r) return socket.emit('errorMessage', 'Room not found');
    if (r.banned.includes(d.name)) return socket.emit('errorMessage', 'You are banned from this room');
    if (r.started) return socket.emit('errorMessage', 'Game already started');
    if (r.players.length >= need(r)) return socket.emit('errorMessage', 'Room is full');
    const pid = d.pid || socket.id;
    const team = r.mode === '2v2' ? (r.players.length % 2) + 1 : r.players.length + 1;
    r.players.push({
      id: socket.id,
      pid,
      name: d.name || 'Player',
      host: false,
      hand: [],
      team,
      connected: true,
    });
    socket.join(r.code);
    socket.emit('session', { pid, code: r.code });
    broadcast(r);
  });

  socket.on('updateRoomSettings', (d) => {
    const r = rooms[d.code];
    if (!r || r.hostId !== socket.id || r.started) return;
    if (d.mode === '2v2' || d.mode === '1v1') r.mode = d.mode;
    if (d.targetScore != null) r.targetScore = Math.max(1, +d.targetScore) || r.targetScore;
    if (d.entryScore != null) r.entryScore = Math.max(0, +d.entryScore);
    broadcast(r);
  });

  socket.on('kickPlayer', (d) => {
    const r = rooms[d.code];
    if (!r || r.hostId !== socket.id || r.started) return;
    const p = r.players.find((x) => x.id === d.playerId);
    if (!p) return;
    io.to(p.id).emit('kicked');
    io.sockets.sockets.get(p.id)?.leave(d.code);
    r.players = r.players.filter((x) => x.id !== d.playerId);
    broadcast(r);
  });

  socket.on('banPlayer', (d) => {
    const r = rooms[d.code];
    if (!r || r.hostId !== socket.id || r.started) return;
    const p = r.players.find((x) => x.id === d.playerId);
    if (!p) return;
    r.banned.push(p.name);
    io.to(p.id).emit('banned');
    io.sockets.sockets.get(p.id)?.leave(d.code);
    r.players = r.players.filter((x) => x.id !== d.playerId);
    broadcast(r);
  });

  socket.on('startGame', (c) => {
    const r = rooms[c];
    if (!r || r.hostId !== socket.id) return;
    if (r.players.length !== need(r)) return socket.emit('errorMessage', `Need ${need(r)} players to start`);
    const dom = shuffledDeck();
    r.board = [];
    r.players.forEach((p) => {
      p.hand = [];
    });
    r.boneyard = [];
    for (let k = 0; k < 7; k++) {
      r.players.forEach((p) => {
        if (dom.length) p.hand.push(dom.shift());
      });
    }
    r.boneyard = dom;
    r.teamLoss = { 1: 0, 2: 0 };
    r.started = true;
    r.lastPlayedBy = null;
    r.consecutivePasses = 0;
    r.pendingRoundStarterPid = null;
    maybeStartRedrawVoteWithStarter(r);
    io.to(c).emit('gameStarted', { room: pub(r) });
    hands(r);
    if (r.gamePhase === 'play') ensureTurnCanAct(r);
  });

  socket.on('redrawVote', (d) => {
    const r = rooms[d.code];
    if (!r || !r.started || r.gamePhase !== 'redraw_vote' || !r.redrawVote) return;
    const p = r.players.find((x) => x.id === socket.id);
    if (!p) return;
    if (!r.redrawVote.voterPids.includes(p.pid)) return;
    r.redrawVote.votes[p.pid] = !!d.agree;
    broadcast(r);
    const { voterPids } = r.redrawVote;
    if (voterPids.every((pid) => r.redrawVote.votes[pid] !== undefined)) finalizeRedrawVote(r, false);
  });

  socket.on('getLegalSides', (d) => {
    const r = rooms[d.code];
    if (!r || r.turn !== socket.id) return;
    socket.emit('legalSides', { domino: d.domino ? [...d.domino] : [], sides: legal(r, d.domino) });
  });

  socket.on('playDomino', (d) => {
    const r = rooms[d.code];
    if (!r || r.turn !== socket.id || !r.started || r.gamePhase !== 'play') return;
    const p = r.players.find((x) => x.id === socket.id);
    if (!p) return;
    const i = p.hand.findIndex((x) => same(x, d.domino));
    if (i === -1) return;
    const raw = p.hand[i];
    let side = d.side || 'right';
    if (!r.board.length) side = 'start';
    const sides = legal(r, raw);
    if (!sides.includes(side)) return socket.emit('errorMessage', 'This domino cannot be placed there');
    const o = side === 'start' ? { ok: true, domino: [...raw] } : orient(r, raw, side);
    if (!o.ok) return socket.emit('errorMessage', 'This domino cannot be placed there');
    p.hand.splice(i, 1);
    const placed = { domino: o.domino, by: p.id, side };
    if (side === 'left') r.board.unshift(placed);
    else r.board.push(placed);
    r.lastPlayedBy = p.id;
    r.firstRequired = null;
    r.consecutivePasses = 0;
    if (!p.hand.length) {
      io.to(d.code).emit('boardUpdated', { room: pub(r) });
      hands(r);
      finishRoundByEmptyHand(r, p);
      return;
    }
    r.turn = next(r, p.id);
    autoDraw(r);
    io.to(d.code).emit('boardUpdated', { room: pub(r) });
    hands(r);
    ensureTurnCanAct(r);
  });

  socket.on('passTurn', (d) => {
    const r = rooms[d.code];
    if (!r || r.turn !== socket.id || !r.started || r.gamePhase !== 'play') return;
    const p = r.players.find((x) => x.id === socket.id);
    if (!p) return;
    autoDraw(r);
    if (hasPlay(r, p) || r.boneyard.length) return;
    r.consecutivePasses = (r.consecutivePasses || 0) + 1;
    if (r.consecutivePasses >= r.players.length) {
      resolveBlockedRound(r);
      return;
    }
    r.turn = next(r, p.id);
    broadcast(r);
    hands(r);
    ensureTurnCanAct(r);
  });

  socket.on('quitGame', (c) => {
    const r = rooms[c];
    if (!r) return;
    const p = r.players.find((x) => x.id === socket.id);
    if (!p) return;
    r.players = r.players.filter((x) => x.id !== socket.id);
    socket.leave(c);
    if (r.started && r.players.length > 0) winMatch(r, r.players[0].team, `${p.name} quit`);
    broadcast(r);
  });

  socket.on('disconnect', () => {
    Object.values(rooms).forEach((r) => {
      const p = r.players.find((x) => x.id === socket.id);
      if (!p) return;
      p.connected = false;
      broadcast(r);
      removeAfterGrace(r, p, `${p.name} disconnected`);
    });
  });
});

app.get('/', (_, res) => res.send('Domino realtime server running'));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
