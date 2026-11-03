/* =====================================================================
   E1 (EQUATION 1) - SERVER (the "referee" for online games)
   ---------------------------------------------------------------------
   - Sends the game files to every browser that visits.
   - Creates games ("rooms") with 6-character joining codes.
   - Keeps the official race state: laps, checkpoints, positions,
     lap times and finish order. Players can't fake these.
   - Passes each car's position on to all the other players.
   ("Play Offline" runs fully inside the browser and doesn't need this.)
   Start it with:   npm start
   ===================================================================== */

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const Tracks = require('./shared/tracks');
const Physics = require('./shared/physics');
const Rules = require('./shared/race');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000; // Render (and other hosts) tell us which port to use

// Serve the browser files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
// The Three.js 3D library (downloaded by "npm install" into node_modules)
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules/three/examples/jsm')));

/* ---------------- Game settings ---------------- */
const TICK_MS = 50;  // send race updates 20 times per second
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I (easy to mix up)
const COLORS = Rules.COLORS;

// All the games that exist right now, looked up by joining code
const rooms = new Map();

/* ---------------- Room helpers ---------------- */

function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const n = String(name || '').replace(/[<>]/g, '').trim().slice(0, 14);
  return n || 'Racer';
}

function freeColor(room, wanted) {
  const used = new Set([...room.players.values()].map(p => p.color));
  if (wanted && COLORS.some(c => c.id === wanted) && !used.has(wanted)) return wanted;
  const c = COLORS.find(c => !used.has(c.id));
  return c ? c.id : COLORS[0].id;
}

function addPlayer(room, socket, data) {
  const player = { id: socket.id, name: cleanName(data && data.name), color: freeColor(room, data && data.color), race: null };
  room.players.set(socket.id, player);
  room.order.push(socket.id);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  return player;
}

// Everything the lobby screen needs to know
function lobbySnapshot(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: room.settings,
    maxPlayers: Rules.MAX_PLAYERS,
    players: room.order.map(id => {
      const p = room.players.get(id);
      return { id: p.id, name: p.name, color: p.color };
    })
  };
}

function sendLobby(room) { io.to(room.code).emit('lobby', lobbySnapshot(room)); }
function notice(room, text) { io.to(room.code).emit('notice', { text }); }

function removePlayer(socket) {
  const code = socket.data.roomCode;
  const room = rooms.get(code);
  socket.data.roomCode = null;
  if (!room) return;
  const player = room.players.get(socket.id);
  socket.leave(code);
  if (!player) return;

  room.players.delete(socket.id);
  room.order = room.order.filter(id => id !== socket.id);

  // Nobody left? Delete the game completely.
  if (room.players.size === 0) {
    clearRoomTimers(room);
    rooms.delete(code);
    console.log(`Game ${code} closed (everyone left)`);
    return;
  }

  io.to(code).emit('playerLeft', { id: socket.id, name: player.name });
  notice(room, `${player.name} left the game`);

  // If the host left, the next player who joined becomes the host
  if (room.hostId === socket.id) {
    room.hostId = room.order[0];
    notice(room, `${room.players.get(room.hostId).name} is now the host`);
  }

  // If everyone still racing has finished, end the race now
  if (room.state === 'racing' || room.state === 'finishing') checkRaceOver(room);
  sendLobby(room);
}

function clearRoomTimers(room) {
  room.timers.forEach(t => clearTimeout(t));
  room.timers = [];
}

/* ---------------- Race logic ---------------- */

function startRace(room) {
  clearRoomTimers(room);
  const track = Tracks.get(room.settings.trackId);
  room.state = 'countdown';
  room.race = { trackId: track.id, laps: room.settings.laps, startTime: 0, finishOrder: [], deadline: null };

  // Put every player on the starting grid, in the order they joined
  room.order.forEach((id, slot) => { room.players.get(id).race = Rules.newRacer(track, slot); });

  io.to(room.code).emit('raceStart', {
    trackId: track.id,
    laps: room.race.laps,
    players: room.order.map(id => {
      const p = room.players.get(id);
      return { id, name: p.name, color: p.color, slot: p.race.slot };
    })
  });

  // Countdown: 3 red lights come on one by one, then GO!
  [1, 2, 3].forEach(n => {
    room.timers.push(setTimeout(() => io.to(room.code).emit('countdown', { lights: n }), 1000 * n));
  });
  room.timers.push(setTimeout(() => {
    room.state = 'racing';
    room.race.startTime = Date.now();
    room.players.forEach(p => { if (p.race) { p.race.lapStart = room.race.startTime; p.race.ts = Date.now(); } });
    io.to(room.code).emit('go');
  }, 4000 + Math.random() * 600)); // a tiny random delay, like real start lights
}

// Handle a position update from a player's browser
function onCarState(room, player, data) {
  const r = player.race;
  if (!r || !data) return;
  if (room.state !== 'racing' && room.state !== 'finishing') return;
  const x = Number(data.x), y = Number(data.y), a = Number(data.a);
  if (!isFinite(x) || !isFinite(y) || !isFinite(a)) return;

  // Anti-cheat: a car can't jump further than its top speed allows
  const now = Date.now();
  const seconds = Math.max((now - r.ts) / 1000, 0.05);
  const maxMove = Physics.TUNING.maxSpeed * seconds * 2 + 60;
  if (Math.hypot(x - r.x, y - r.y) > maxMove) {
    io.to(player.id).emit('correction', { x: r.x, y: r.y, a: r.a });
    return;
  }

  r.x = x; r.y = y; r.a = a;
  r.vx = Number(data.vx) || 0; r.vy = Number(data.vy) || 0;
  r.d = !!data.d; r.ts = now;

  const lap = Rules.updateProgress(player.id, r, Tracks.get(room.race.trackId), room.race, now);
  if (!lap) return;
  io.to(room.code).emit('lapDone', { id: player.id, lap: lap.lap, lapTime: lap.lapTime, isBest: lap.isBest });
  if (lap.place) {
    io.to(room.code).emit('playerFinished', { id: player.id, name: player.name, place: lap.place, time: r.finishTime });
    if (lap.place === 1) {
      // First car home! Everyone else gets 30 seconds to finish.
      room.state = 'finishing';
      room.race.deadline = now + Rules.FINISH_GRACE_MS;
      io.to(room.code).emit('winner', { id: player.id, name: player.name, graceMs: Rules.FINISH_GRACE_MS });
      room.timers.push(setTimeout(() => endRace(room), Rules.FINISH_GRACE_MS));
    }
    checkRaceOver(room);
  }
}

function checkRaceOver(room) {
  if (!room.race || room.state === 'results') return;
  const racers = [...room.players.values()].filter(p => p.race);
  if (racers.length === 0 || racers.every(p => p.race.finished)) endRace(room);
}

function standings(room) {
  return Rules.standings([...room.players.values()].filter(p => p.race), room.race.finishOrder);
}

function endRace(room) {
  if (!room.race || room.state === 'results') return;
  clearRoomTimers(room);
  room.state = 'results';
  const rows = standings(room).map((p, i) => Rules.resultRow(p, i + 1));
  io.to(room.code).emit('results', { rows, trackId: room.race.trackId, laps: room.race.laps });
  room.players.forEach(p => { p.race = null; });
  room.race = null;
  sendLobby(room);
  console.log(`Game ${room.code}: race finished`);
}

// 20 times a second: send every racing room the latest positions and standings
setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    if (!room.race) return;
    const racing = room.state === 'racing' || room.state === 'finishing';
    io.to(room.code).volatile.emit('state', {
      t: now,
      phase: room.state,
      remaining: room.race.deadline ? Math.max(0, room.race.deadline - now) : null,
      players: standings(room).map((p, i) => Rules.stateRow(p.id, p.race, i + 1, now, racing))
    });
  });
}, TICK_MS);

/* ---------------- Messages from players ---------------- */

io.on('connection', socket => {
  socket.data.roomCode = null;
  const myRoom = () => rooms.get(socket.data.roomCode);
  const isHost = room => room && room.hostId === socket.id;
  const reply = (cb, value) => { if (typeof cb === 'function') cb(value); };

  // Lets browsers match their clock to the server's clock (for smooth movement)
  socket.on('timeSync', cb => reply(cb, Date.now()));

  socket.on('createRoom', (data, cb) => {
    removePlayer(socket); // leave any old game first
    const room = {
      code: makeCode(), hostId: socket.id, players: new Map(), order: [],
      settings: { trackId: 0, laps: 3 }, state: 'lobby', race: null, timers: []
    };
    rooms.set(room.code, room);
    addPlayer(room, socket, data);
    console.log(`Game ${room.code} created`);
    reply(cb, { ok: true, code: room.code });
    sendLobby(room);
  });

  socket.on('joinRoom', (data, cb) => {
    const code = String((data && data.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const room = rooms.get(code);
    if (code.length !== 6) return reply(cb, { ok: false, error: 'The joining code must be 6 characters long.' });
    if (!room) return reply(cb, { ok: false, error: `No game found with code ${code}. Check the code and try again.` });
    if (room.players.has(socket.id)) return reply(cb, { ok: true, code });
    if (room.players.size >= Rules.MAX_PLAYERS)
      return reply(cb, { ok: false, error: `This game is full (${Rules.MAX_PLAYERS}/${Rules.MAX_PLAYERS} players).` });
    if (room.state === 'countdown' || room.state === 'racing' || room.state === 'finishing')
      return reply(cb, { ok: false, error: 'This race has already started. Try again when it has finished.' });

    removePlayer(socket);
    const player = addPlayer(room, socket, data);
    reply(cb, { ok: true, code });
    notice(room, `${player.name} joined`);
    sendLobby(room);
  });

  socket.on('chooseColor', (color, cb) => {
    const room = myRoom();
    if (!room || room.race) return;
    if (!COLORS.some(c => c.id === color)) return;
    const takenBy = [...room.players.values()].find(p => p.color === color && p.id !== socket.id);
    if (takenBy) return reply(cb, { ok: false, error: `${takenBy.name} already has that color.` });
    room.players.get(socket.id).color = color;
    reply(cb, { ok: true });
    sendLobby(room);
  });

  socket.on('updateSettings', data => {
    const room = myRoom();
    if (!isHost(room) || room.race || !data) return; // only the host can change settings
    const trackId = Number(data.trackId), laps = Number(data.laps);
    if (Number.isInteger(trackId) && trackId >= 0 && trackId < Tracks.list.length) room.settings.trackId = trackId;
    if (Number.isInteger(laps) && laps >= Rules.MIN_LAPS && laps <= Rules.MAX_LAPS) room.settings.laps = laps;
    sendLobby(room);
  });

  socket.on('startRace', () => {
    const room = myRoom();
    if (!isHost(room) || room.race) return; // only the host can start
    startRace(room);
  });

  socket.on('carState', data => {
    const room = myRoom();
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) onCarState(room, player, data);
  });

  socket.on('raceAgain', () => {
    const room = myRoom();
    if (!room) return;
    if (room.state === 'results') room.state = 'lobby';
    sendLobby(room);
  });

  socket.on('leaveRoom', () => removePlayer(socket));
  socket.on('disconnect', () => removePlayer(socket));
});

/* ---------------- Start the server ---------------- */

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  E1 - EQUATION 1 server is running!');
  console.log('');
  console.log(`  On this computer, open:   http://localhost:${PORT}`);
  // Show this computer's Wi-Fi address so friends on the same network can join
  Object.values(os.networkInterfaces()).flat().forEach(net => {
    if (net && net.family === 'IPv4' && !net.internal)
      console.log(`  Friends on your Wi-Fi:    http://${net.address}:${PORT}`);
  });
  console.log('');
  console.log('  (Press Ctrl + C in this window to stop the server)');
});
