/* =====================================================================
   E1 (EQUATION 1) - MAIN (the "conductor")
   ---------------------------------------------------------------------
   - Switches between the screens.
   - Handles all the buttons (Play Offline, Host, Join, colors, tracks...).
   - Online: talks to the server.  Offline: talks to Offline (offline.js).
   - Passes race messages to the game (game.js) and the display (hud.js).
   ===================================================================== */

(() => {
  const $ = id => document.getElementById(id);
  const socket = io(); // connect to the server that sent us this page

  let screen = 'home';
  let mode = 'online';     // 'online' or 'offline'
  let lobby = null;        // latest lobby info from the server
  let currentCode = null;  // the joining code of the online game I'm in
  let raceInfo = null;     // track + laps of the current race

  // Settings for Play Offline (remembered between races)
  const offline = { trackId: 0, laps: 3, color: 'red', aiCount: 5, timeOfDay: 'day' };
  const TIMES = [{ v: 'day', label: '☀️ Day' }, { v: 'sunset', label: '🌇 Sunset' }, { v: 'night', label: '🌙 Night' }];

  /* ---------------- Small helpers ---------------- */

  if (Input.isTouch) document.body.classList.add('touch');
  Input.setupTouch();

  // Remember the player's name and offline settings (if the browser allows it)
  try {
    $('input-name').value = localStorage.getItem('e1-name') || '';
    Object.assign(offline, JSON.parse(localStorage.getItem('e1-offline') || '{}'));
  } catch (e) { /* not allowed - that's fine */ }
  if (!Tracks.list[offline.trackId]) offline.trackId = 0;   // e.g. a track that no longer exists
  offline.laps = Math.max(RaceRules.MIN_LAPS, Math.min(RaceRules.MAX_LAPS, offline.laps));   // laps are now 2-5
  if (!RaceRules.COLORS.some(c => c.id === offline.color)) offline.color = RaceRules.COLORS[0].id;   // old color -> first team
  function saveOffline() { try { localStorage.setItem('e1-offline', JSON.stringify(offline)); } catch (e) { /* ignore */ } }

  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    screen = name;
    Input.setEnabled(name === 'race');
    $('touch-controls').classList.toggle('hidden', !(name === 'race' && Input.isTouch));
  }

  function colorHex(colorId) {
    const c = RaceRules.COLORS.find(c => c.id === colorId);
    return c ? c.hex : '#ffffff';
  }

  function myId() { return mode === 'offline' ? Offline.PLAYER_ID : socket.id; }

  // The game always uses Low graphics (fastest on every laptop and phone)
  function graphicsQuality() { return 'low'; }
  function getSetting(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function setSetting(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }

  /* ---------------- Main menu settings: Racing line, Volume ---------------- */
  function renderSettings() {
    const line = getSetting('e1-line', 'on');
    $('set-line').querySelectorAll('button').forEach(b => b.classList.toggle('selected', b.dataset.v === line));
  }
  $('set-line').addEventListener('click', e => {
    if (!e.target.dataset.v) return;
    setSetting('e1-line', e.target.dataset.v); renderSettings();
  });
  $('set-volume').value = getSetting('e1-volume', '70');
  Sound.setVolume(Number($('set-volume').value) / 100);
  $('set-volume').addEventListener('input', e => {
    Sound.init();
    Sound.setVolume(Number(e.target.value) / 100);
    setSetting('e1-volume', e.target.value);
  });
  renderSettings();

  /* ---------------- Controls guide (keyboard, controller, phone) ---------------- */
  function showControls(onGrid) {
    $('controls-modal').classList.remove('hidden');
    $('controls-modal').classList.toggle('race-guide', !!onGrid);   // on the grid: smaller, clicks pass through
  }
  function hideControls() { $('controls-modal').classList.add('hidden'); }
  $('btn-controls').addEventListener('click', () => { Sound.init(); showControls(false); });
  $('btn-controls-close').addEventListener('click', hideControls);

  // A row of buttons for a list of choices, e.g. Day / Sunset / Night
  function choicePicker(box, choices, selected, disabled, onPick) {
    box.innerHTML = '';
    choices.forEach(c => {
      const b = document.createElement('button');
      b.className = 'lap-btn' + (c.v === selected ? ' selected' : '');
      b.textContent = c.label;
      b.disabled = disabled;
      b.addEventListener('click', () => onPick(c.v));
      box.appendChild(b);
    });
  }

  /* ---------------- Reusable pickers (tracks, numbers, colors) ---------------- */

  function buildTrackCards(box, onPick) {
    box.innerHTML = '';
    Tracks.list.forEach(t => {
      const card = document.createElement('button');
      card.className = 'track-card';
      card.dataset.id = t.id;
      card.title = t.description;
      card.innerHTML = '<canvas></canvas><div class="t-name"></div><div class="t-diff"></div>';
      card.querySelector('.t-name').textContent = `${t.id + 1}. ${t.name}`;
      card.querySelector('.t-diff').textContent = t.difficulty;
      card.addEventListener('click', () => onPick(t.id));
      box.appendChild(card);
      Hud.drawPreview(card.querySelector('canvas'), t);
    });
  }

  function updateTrackCards(box, selectedId, disabled) {
    box.querySelectorAll('.track-card').forEach(card => {
      card.classList.toggle('selected', Number(card.dataset.id) === selectedId);
      card.disabled = disabled;
    });
  }

  function numberPicker(box, from, to, selected, disabled, onPick) {
    box.innerHTML = '';
    for (let n = from; n <= to; n++) {
      const b = document.createElement('button');
      b.className = 'lap-btn' + (n === selected ? ' selected' : '');
      b.textContent = n;
      b.disabled = disabled;
      b.addEventListener('click', () => onPick(n));
      box.appendChild(b);
    }
  }

  // takenBy: { colorId: 'name of player who has it' }
  function colorPicker(box, mine, takenBy, onPick) {
    box.innerHTML = '';
    RaceRules.COLORS.forEach(c => {
      const owner = c.id !== mine && takenBy[c.id];
      const btn = document.createElement('button');
      btn.className = 'color-option team-option' + (c.id === mine ? ' mine' : owner ? ' taken' : '');
      // team card: the livery colors as stripes, with the team name
      btn.style.background = `linear-gradient(135deg, ${c.hex} 0 58%, ${c.second} 58% 82%, ${c.accent} 82% 100%)`;
      btn.style.color = c.text;
      btn.innerHTML = '<span></span>';
      btn.firstChild.textContent = c.label;
      btn.title = owner ? `${c.label} (${owner})` : c.label;
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', () => { if (!owner) { Sound.click(); onPick(c.id); } });
      box.appendChild(btn);
    });
  }

  /* ---------------- Clock sync (online only) ----------------
     Asks the server for its time a few times so that other cars can be
     shown smoothly even if my computer's clock is a bit different. */
  let clockOffset = 0, bestRtt = Infinity;
  function syncClock() {
    const t0 = Date.now();
    socket.emit('timeSync', serverTime => {
      const t1 = Date.now(), rtt = t1 - t0;
      if (rtt <= bestRtt + 15) {
        clockOffset = serverTime + rtt / 2 - t1;
        bestRtt = Math.min(bestRtt, rtt);
      }
      bestRtt += 2; // slowly allow newer measurements to win
    });
  }
  socket.on('connect', () => {
    bestRtt = Infinity;
    for (let i = 0; i < 5; i++) setTimeout(syncClock, i * 300);
  });
  setInterval(() => { if (socket.connected) syncClock(); }, 10000);
  const serverNow = () => Date.now() + clockOffset;

  /* ---------------- Main menu ---------------- */

  function getName(required) {
    const name = $('input-name').value.trim();
    if (!name && required) {
      $('home-error').textContent = 'Please type your name first.';
      $('input-name').focus();
      return null;
    }
    try { localStorage.setItem('e1-name', name); } catch (e) { /* ignore */ }
    return name || 'You';
  }

  function needServer() {
    if (socket.connected) return true;
    $('home-error').textContent = "Can't reach the game server right now. You can still Play Offline!";
    return false;
  }

  $('btn-offline').addEventListener('click', () => {
    Sound.init();
    $('home-error').textContent = '';
    mode = 'offline';
    show('offline');
    renderOffline();
  });

  $('btn-host').addEventListener('click', () => {
    Sound.init();
    const name = getName(true);
    if (!name || !needServer()) return;
    $('home-error').textContent = '';
    socket.emit('createRoom', { name, color: offline.color }, res => {
      if (!res || !res.ok) { $('home-error').textContent = 'Could not create a game. Try again.'; return; }
      enterLobby(res.code);
    });
  });

  $('btn-show-join').addEventListener('click', () => {
    Sound.init();
    $('join-panel').classList.remove('hidden');
    $('input-code').focus();
  });

  function joinGame() {
    Sound.init();
    const name = getName(true);
    if (!name) return;
    const code = $('input-code').value.trim().toUpperCase();
    if (code.length !== 6) { $('home-error').textContent = 'The joining code has 6 characters, e.g. K7P2XQ.'; return; }
    if (!needServer()) return;
    $('home-error').textContent = '';
    socket.emit('joinRoom', { name, code, color: offline.color }, res => {
      if (!res || !res.ok) { $('home-error').textContent = (res && res.error) || 'Could not join.'; return; }
      enterLobby(res.code);
    });
  }
  $('btn-join').addEventListener('click', joinGame);
  $('input-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });
  $('input-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  function toMainMenu() {
    if (window.Podium) Podium.stop();
    hideControls();
    if (mode === 'online' && currentCode) socket.emit('leaveRoom');
    Offline.stop();
    Game.stop();
    lobby = null;
    currentCode = null;
    show('home');
  }

  /* ---------------- Play Offline setup ---------------- */

  let offlineCardsBuilt = false;
  function renderOffline() {
    if (!offlineCardsBuilt) {
      buildTrackCards($('offline-tracks'), id => { offline.trackId = id; saveOffline(); renderOffline(); });
      offlineCardsBuilt = true;
    }
    updateTrackCards($('offline-tracks'), offline.trackId, false);
    numberPicker($('offline-laps'), RaceRules.MIN_LAPS, RaceRules.MAX_LAPS, offline.laps, false,
      n => { offline.laps = n; saveOffline(); renderOffline(); });
    numberPicker($('offline-ai'), 1, 9, offline.aiCount, false,
      n => { offline.aiCount = n; saveOffline(); renderOffline(); });
    colorPicker($('offline-colors'), offline.color, {},
      c => { offline.color = c; saveOffline(); renderOffline(); });
    choicePicker($('offline-tod'), TIMES, offline.timeOfDay, false,
      v => { offline.timeOfDay = v; saveOffline(); renderOffline(); });
  }

  $('btn-offline-back').addEventListener('click', () => show('home'));
  $('btn-offline-start').addEventListener('click', () => {
    Sound.init();
    mode = 'offline';
    Offline.start({ name: getName(false), color: offline.color, trackId: offline.trackId,
                    laps: offline.laps, aiCount: offline.aiCount, timeOfDay: offline.timeOfDay }, RaceEvents);
  });

  /* ---------------- Online lobby ---------------- */

  function enterLobby(code) {
    mode = 'online';
    currentCode = code;
    $('lobby-error').textContent = '';
    show('lobby');
    renderLobby();
  }

  socket.on('lobby', data => {
    lobby = data;
    if (screen === 'lobby') renderLobby();
  });

  let lobbyCardsBuilt = false;
  function renderLobby() {
    $('lobby-code').textContent = currentCode || '------';
    if (!lobby || lobby.code !== currentCode) return; // info not arrived yet
    const isHost = lobby.hostId === socket.id;

    // Player list
    const list = $('player-list');
    list.innerHTML = '';
    lobby.players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:${colorHex(p.color)}"></span><span class="player-name"></span>`;
      li.querySelector('.player-name').textContent = p.name;
      if (p.id === lobby.hostId) li.insertAdjacentHTML('beforeend', '<span class="badge">HOST</span>');
      if (p.id === socket.id) li.insertAdjacentHTML('beforeend', '<span class="badge you">YOU</span>');
      list.appendChild(li);
    });
    $('player-count').textContent = `${lobby.players.length}/${lobby.maxPlayers}`;

    // Colors (taken ones are crossed out)
    const me = lobby.players.find(p => p.id === socket.id);
    const takenBy = {};
    lobby.players.forEach(p => { takenBy[p.color] = p.name; });
    colorPicker($('color-picker'), me && me.color, takenBy, c => {
      socket.emit('chooseColor', c, res => {
        $('lobby-error').textContent = res && !res.ok ? res.error : '';
        if (res && res.ok) { offline.color = c; saveOffline(); }
      });
    });

    // Track and laps (only the host can change them)
    if (!lobbyCardsBuilt) {
      buildTrackCards($('track-picker'), id => {
        if (lobby) socket.emit('updateSettings', { trackId: id, laps: lobby.settings.laps });
      });
      lobbyCardsBuilt = true;
    }
    updateTrackCards($('track-picker'), lobby.settings.trackId, !isHost);
    numberPicker($('lap-picker'), RaceRules.MIN_LAPS, RaceRules.MAX_LAPS, lobby.settings.laps, !isHost,
      n => socket.emit('updateSettings', { trackId: lobby.settings.trackId, laps: n }));
    choicePicker($('tod-picker'), TIMES, lobby.settings.timeOfDay || 'day', !isHost,
      v => socket.emit('updateSettings', { trackId: lobby.settings.trackId, laps: lobby.settings.laps, timeOfDay: v }));

    $('settings-note').textContent = isHost ? '' : 'Only the host can change these';
    $('btn-start').classList.toggle('hidden', !isHost);
    $('waiting-text').classList.toggle('hidden', isHost);
  }

  $('btn-start').addEventListener('click', () => { Sound.init(); socket.emit('startRace'); });
  $('btn-leave-lobby').addEventListener('click', toMainMenu);

  /* ---------------- Race events ----------------
     The same functions are used online (messages from the server)
     and offline (messages from offline.js). */

  const RaceEvents = {
    raceStart(data) {
      if (window.Podium) Podium.stop();
      Sound.init();
      raceInfo = data;
      show('race');
      Hud.setLights(0);
      Hud.clearTower();
      showControls(true);   // remind everyone of the controls while the lights count down
      Hud.message(Tracks.get(data.trackId).name, `${data.laps} laps`, 900);
      Game.start({
        trackId: data.trackId,
        laps: data.laps,
        myId: myId(),
        players: data.players.map(p => ({ ...p, colorHex: colorHex(p.color) })),
        send: mode === 'offline'
          ? state => Offline.onCarState(state)
          : state => socket.volatile.emit('carState', state),
        serverNow: mode === 'offline' ? () => Date.now() : serverNow,
        quality: graphicsQuality(),
        timeOfDay: data.timeOfDay || 'day',
        racingLine: getSetting('e1-line', 'on') === 'on'
      });
    },

    countdown({ lights }) {
      Hud.setLights(lights);
      Game.setLights(lights);
      Sound.countdown();
    },

    go() {
      Hud.setLights('go');
      Game.setLights('go');
      Sound.go();
      Hud.message('GO!', '', 900);
      setTimeout(hideControls, 600);
      Game.go();
    },

    state(state) { if (screen === 'race') Game.onState(state); },

    lapDone(d) {
      if (d.id !== myId() || !raceInfo || d.lap >= raceInfo.laps) return;
      const title = raceInfo.laps - d.lap === 1 ? 'FINAL LAP' : `LAP ${d.lap + 1}`;
      if (d.isBest && d.lap > 1) {
        Sound.bestLap();
        Hud.message(title, `Best lap! ${Hud.formatTime(d.lapTime)}`, 1600);
      } else {
        Sound.lap();
        Hud.message(title, Hud.formatTime(d.lapTime), 1400);
      }
    },

    winner(d) {
      if (d.id === myId()) {
        Sound.finish();
        Hud.message('WINNER!', 'You won the race!', 3500);
      } else {
        Hud.message('WINNER!', `${d.name} wins! You have ${d.graceMs / 1000}s to finish`, 3000);
      }
      Game.cheer(1.2);
    },

    playerFinished(d) {
      if (d.place === 1) return; // already shown by "winner"
      if (d.id === myId()) {
        Sound.finish();
        Hud.message(`${Hud.ordinal(d.place)} PLACE`, `Finished in ${Hud.formatTime(d.time)}`, 3000);
      } else {
        Hud.toast(`${d.name} finished ${Hud.ordinal(d.place)}`);
        Game.cheer(0.6);
      }
    },

    results(r) {
      Game.stop();
      // 3D podium with the top 3 (after the results screen is visible, below)
      setTimeout(() => { if (window.Podium) Podium.show($('podium-canvas'), r.rows.slice(0, 3).map(x => ({ name: x.name, colorId: x.color }))); }, 50);
      Hud.setLights(0);
      Hud.clearMessage();
      Hud.finishTimer(null);
      $('results-sub').textContent = `${Tracks.get(r.trackId).name} · ${r.laps} laps` + (mode === 'offline' ? ' · Offline' : '');
      const body = $('results-body');
      body.innerHTML = '';
      r.rows.forEach(row => {
        const tr = document.createElement('tr');
        if (row.id === myId()) tr.className = 'me';
        tr.innerHTML = `
          <td class="place">${row.place}</td>
          <td><div class="driver"><span class="swatch" style="background:${colorHex(row.color)}"></span><span class="n"></span></div></td>
          <td>${row.finished ? Hud.formatTime(row.totalTime) : `DNF (${row.laps}/${r.laps} laps)`}</td>
          <td>${Hud.formatTime(row.bestLap)}</td>`;
        tr.querySelector('.n').textContent = row.name;
        body.appendChild(tr);
      });
      show('results');
    }
  };

  // Online: connect each server message to the matching function above
  ['raceStart', 'countdown', 'go', 'state', 'lapDone', 'winner', 'playerFinished', 'results'].forEach(ev => {
    socket.on(ev, data => { if (mode === 'online' && currentCode) RaceEvents[ev](data); });
  });
  socket.on('playerLeft', d => { if (mode === 'online') Game.removePlayer(d.id); });
  socket.on('correction', pos => { if (mode === 'online') Game.correct(pos); });
  socket.on('notice', n => { if (mode === 'online' && currentCode) Hud.toast(n.text); });

  // Camera button (T-cam <-> Cockpit)
  $('btn-camera').addEventListener('click', e => { Input.pressCamera(); e.target.blur(); });

  $('btn-mute').addEventListener('click', () => {
    Sound.init();
    $('btn-mute').textContent = Sound.toggleMute() ? '🔇' : '🔊';
  });
  $('btn-quit').addEventListener('click', () => {
    if (confirm('Leave this race and go back to the main menu?')) toMainMenu();
  });

  /* ---------------- Results buttons ---------------- */

  $('btn-race-again').addEventListener('click', () => {
    if (window.Podium) Podium.stop();
    if (mode === 'offline') {
      show('offline');
      renderOffline();
    } else {
      socket.emit('raceAgain');
      show('lobby');
      renderLobby();
    }
  });
  $('btn-main-menu').addEventListener('click', toMainMenu);

  /* ---------------- Lost connection (online only) ---------------- */

  socket.on('disconnect', () => {
    if (mode === 'online' && currentCode) {
      Game.stop();
      show('home');
      $('home-error').textContent = 'Lost connection to the server. Please host or join a game again.';
    }
    lobby = null;
    currentCode = null;
  });
})();
