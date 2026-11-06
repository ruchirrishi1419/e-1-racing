/* =====================================================================
   E1 (EQUATION 1) - HUD (Heads-Up Display)
   Everything drawn ON TOP of the race: lap counter, position, times,
   leaderboard, mini-map, start lights and big messages.
   ===================================================================== */

const Hud = (() => {
  const $ = id => document.getElementById(id);
  let minimapTrack = null;
  let minimapScale = 1, minimapOffX = 0, minimapOffY = 0;
  let messageTimer = null;

  // Turn milliseconds into "1:23.456"
  function formatTime(ms) {
    if (ms === null || ms === undefined) return '--';
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = (totalSec % 60).toFixed(3).padStart(6, '0');
    return `${min}:${sec}`;
  }

  // "1" -> "1st", "2" -> "2nd" ...
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  /* ---------- Top-left info box ---------- */
  // 15 rev lights: 5 green, 5 red, 5 blue (built once)
  let revEls = null;
  function revLights(rpm) {
    if (!revEls) {
      const box = $('hud-revs');
      box.innerHTML = '';
      revEls = [];
      for (let i = 0; i < 15; i++) {
        const d = document.createElement('i');
        d.className = i < 5 ? 'g' : i < 10 ? 'r' : 'b';
        box.appendChild(d);
        revEls.push(d);
      }
    }
    const lit = Math.max(0, Math.min(15, Math.round(((rpm - 0.55) / 0.42) * 15)));
    const flash = rpm > 0.985 && Math.floor(performance.now() / 90) % 2 === 0;
    revEls.forEach((d, i) => d.classList.toggle('on', flash || i < lit));
  }

  // Only touch the page when a value really changes (faster)
  let lastText = {};
  const setText = (id, text) => { if (lastText[id] !== text) { lastText[id] = text; $(id).textContent = text; } };

  function updateInfo({ lap, laps, pos, total, lapTime, best, speedKmh, gear, rpm, gapAhead, drs, drsZone, speedRatio }) {
    setText('hud-lap', `LAP ${Math.min(lap, laps)} / ${laps}`);
    setText('hud-pos', `P${pos} / ${total}`);
    setText('hud-time', formatTime(lapTime === null ? 0 : lapTime));
    setText('hud-best', formatTime(best));
    setText('hud-gap-label', pos > 1 ? `GAP TO P${pos - 1}` : 'LEADING');
    setText('hud-gap', pos > 1 && gapAhead !== null && gapAhead !== undefined ? '+' + gapAhead.toFixed(3) : '--');
    setText('hud-speed', String(speedKmh));
    setText('hud-gear', gear || 'N');
    revLights(rpm || 0.3);
    const d = $('hud-drs');
    d.classList.toggle('open', !!drs);                 // green: DRS open
    d.classList.toggle('zone', !drs && !!drsZone);     // outlined: in a DRS zone
    // speed streaks fade in above about 250 km/h
    $('speed-lines').style.opacity = Math.max(0, Math.min(0.85, ((speedRatio || 0) - 0.72) * 3.2)).toFixed(2);
  }

  /* ---------- Live timing tower (right side, like F1 TV) ----------
     rows: [{ id, name, colorHex, gap, fin }] in race order */
  let towerRows = [];
  function updateTower(rows, myId) {
    const box = $('leaderboard');
    // build the rows once, then just update their text (faster)
    while (towerRows.length < rows.length) {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML = '<span class="lb-pos"></span><span class="lb-stripe"></span><span class="lb-name"></span><span class="lb-info"></span>';
      box.appendChild(row);
      towerRows.push(row);
    }
    while (towerRows.length > rows.length) towerRows.pop().remove();
    rows.forEach((r, i) => {
      const el = towerRows[i];
      el.classList.toggle('me', r.id === myId);
      el.children[0].textContent = i + 1;
      el.children[1].style.background = r.colorHex;
      el.children[2].textContent = r.id === myId ? 'YOU' : r.name.slice(0, 3).toUpperCase();   // 3-letter names like TV graphics
      el.children[3].textContent = r.gap;
      el.children[3].className = 'lb-info' + (r.fin ? ' fin' : '');
    });
  }
  function clearTower() { $('leaderboard').innerHTML = ''; towerRows = []; lastText = {}; revEls = null; }

  // Small banner when someone overtakes ("Ruchir overtakes Alex for P3")
  function overtake(text, mine) {
    const box = $('overtakes');
    const el = document.createElement('div');
    el.className = 'overtake' + (mine ? ' mine' : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
    while (box.children.length > 2) box.firstChild.remove();   // at most 2 at a time
  }


  /* ---------- Track drawing (used by mini-map and lobby previews) ---------- */
  function fitTrack(track, w, h, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    track.path.forEach(p => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    return {
      scale,
      offX: (w - (maxX - minX) * scale) / 2 - minX * scale,
      offY: (h - (maxY - minY) * scale) / 2 - minY * scale
    };
  }

  function drawTrackShape(ctx, track, fit, lineWidth, color) {
    ctx.beginPath();
    track.path.forEach((p, i) => {
      const x = p.x * fit.scale + fit.offX, y = p.y * fit.scale + fit.offY;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // Small picture of a track for the lobby
  function drawPreview(canvas, track) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 150, h = canvas.clientHeight || 90;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = track.theme.bg;
    ctx.fillRect(0, 0, w, h);
    const fit = fitTrack(track, w, h, 8);
    drawTrackShape(ctx, track, fit, 5, '#ffffff');
    drawTrackShape(ctx, track, fit, 3, track.theme.road);
    // Start line marker
    const s = track.path[0];
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(s.x * fit.scale + fit.offX, s.y * fit.scale + fit.offY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------- Mini-map ---------- */
  function setupMinimap(track) {
    const canvas = $('minimap');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    minimapTrack = track;
    const fit = fitTrack(track, w, h, 10);
    minimapScale = fit.scale; minimapOffX = fit.offX; minimapOffY = fit.offY;
  }

  // cars: [{ x, y, colorHex, me }]
  function drawMinimap(cars) {
    if (!minimapTrack) return;
    const canvas = $('minimap');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) setupMinimap(minimapTrack); // window was resized
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fit = { scale: minimapScale, offX: minimapOffX, offY: minimapOffY };
    drawTrackShape(ctx, minimapTrack, fit, 6, 'rgba(255,255,255,0.25)');
    drawTrackShape(ctx, minimapTrack, fit, 3, 'rgba(255,255,255,0.7)');

    // Draw other cars first, my car last (so it's on top)
    cars.slice().sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0)).forEach(c => {
      const x = c.x * fit.scale + fit.offX, y = c.y * fit.scale + fit.offY;
      ctx.beginPath();
      ctx.arc(x, y, c.me ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = c.colorHex;
      ctx.fill();
      ctx.lineWidth = c.me ? 2 : 1;
      ctx.strokeStyle = c.me ? '#ffffff' : '#000000';
      ctx.stroke();
    });
  }

  /* ---------- Start lights ---------- */
  // 5 start lights. The countdown has 3 steps:
  // n = 0: hide, 1: 2 red lights, 2: 4 red, 3: all 5 red, 'go': all green
  function setLights(n) {
    const box = $('start-lights');
    const lights = box.querySelectorAll('.light');
    if (n === 0) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const lit = [0, 2, 4, 5][n] || 0;
    lights.forEach((l, i) => {
      l.classList.remove('red', 'green');
      if (n === 'go') l.classList.add('green');
      else if (i < lit) l.classList.add('red');
    });
    if (n === 'go') setTimeout(() => box.classList.add('hidden'), 1200);
  }

  /* ---------- Big centre message ---------- */
  function message(text, sub = '', duration = 1500) {
    const el = $('big-message');
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text));
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      el.appendChild(small);
    }
    el.classList.remove('show');
    void el.offsetWidth; // restart the pop animation
    el.classList.add('show');
    clearTimeout(messageTimer);
    if (duration > 0) messageTimer = setTimeout(() => el.classList.remove('show'), duration);
  }
  function clearMessage() { $('big-message').classList.remove('show'); }

  /* ---------- "30 seconds left" timer after the winner finishes ---------- */
  function finishTimer(ms) {
    const el = $('finish-timer');
    if (ms === null || ms === undefined) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = `Race ends in ${Math.ceil(ms / 1000)}s`;
  }

  /* ---------- Pop-up notices ---------- */
  function toast(text) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3500);
    while (box.children.length > 4) box.firstChild.remove();
  }

  return { formatTime, ordinal, updateInfo, updateTower, clearTower, overtake, drawPreview, setupMinimap,
           drawMinimap, setLights, message, clearMessage, finishTimer, toast };
})();
