/* =====================================================================
   E1 (EQUATION 1) - RACE RULES  (shared by the server AND the browser)
   ---------------------------------------------------------------------
   The rules for laps, checkpoints, positions and finishing.
   The online server uses these, and so does "Play Offline", so both
   modes work exactly the same way.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'));
  else root.RaceRules = factory(root.Tracks);
})(typeof self !== 'undefined' ? self : this, function (Tracks) {
  'use strict';

  const MAX_PLAYERS = 10;
  const MIN_LAPS = 2, MAX_LAPS = 5;
  const FINISH_GRACE_MS = 30000; // time the others get after the winner finishes

  // The 10 teams. Players pick a team; the car's whole paint scheme (livery) comes with it.
  // (Kept under the old name COLORS so the rest of the game keeps working.)
  //   hex = main body color, second = big second color, accent = stripes, text = writing, wing = wings
  const COLORS = [
    { id: 'redbull',  label: 'Red Bull Racing', short: 'RBR', hex: '#1b2a4e', second: '#d71920', accent: '#ffc906', text: '#ffffff', wing: '#1b2a4e' },
    { id: 'ferrari',  label: 'Ferrari',         short: 'FER', hex: '#dc0000', second: '#111111', accent: '#ffffff', text: '#ffffff', wing: '#dc0000' },
    { id: 'mercedes', label: 'Mercedes',        short: 'MER', hex: '#0d0d0d', second: '#c6ccd2', accent: '#00d2be', text: '#ffffff', wing: '#0d0d0d' },
    { id: 'mclaren',  label: 'McLaren',         short: 'MCL', hex: '#ff8000', second: '#141414', accent: '#47c7fc', text: '#141414', wing: '#141414' },
    { id: 'aston',    label: 'Aston Martin',    short: 'AMR', hex: '#00594f', second: '#00352f', accent: '#cedc00', text: '#ffffff', wing: '#00594f' },
    { id: 'alpine',   label: 'Alpine',          short: 'ALP', hex: '#0055a5', second: '#f276b5', accent: '#ffffff', text: '#ffffff', wing: '#0055a5' },
    { id: 'williams', label: 'Williams',        short: 'WIL', hex: '#041e42', second: '#00a0de', accent: '#ffffff', text: '#ffffff', wing: '#00a0de' },
    { id: 'rb',       label: 'Racing Bulls',    short: 'RB',  hex: '#eef1f6', second: '#1534cc', accent: '#e10600', text: '#1534cc', wing: '#1534cc' },
    { id: 'haas',     label: 'Haas',            short: 'HAA', hex: '#f2f2f2', second: '#1b1b1b', accent: '#e10600', text: '#1b1b1b', wing: '#1b1b1b' },
    { id: 'sauber',   label: 'Kick Sauber',     short: 'SAU', hex: '#151515', second: '#52e252', accent: '#52e252', text: '#52e252', wing: '#151515' }
  ];

  // A fresh racer standing on grid slot "slot"
  function newRacer(track, slot) {
    const g = Tracks.gridSlot(track, slot);
    return {
      slot, x: g.x, y: g.y, a: g.angle, vx: 0, vy: 0, d: false, ts: Date.now(),
      s: 0.99, lap: 0, cp: 0, lapStart: 0, bestLap: null, lastLap: null,
      finished: false, finishTime: null, progress: -0.01
    };
  }

  // Difference between two lap fractions, between -0.5 and 0.5
  function wrapDiff(a, b) {
    let d = a - b;
    while (d > 0.5) d -= 1;
    while (d < -0.5) d += 1;
    return d;
  }

  /* Call this after a racer moves (r.x / r.y already updated).
     Checkpoints are evenly spaced around the lap. They must be passed IN ORDER,
     then the start/finish line, for a lap to count. No shortcuts!
     race = { laps, startTime, finishOrder: [] }
     Returns null, or { lap, lapTime, isBest, place } when a lap was completed
     ("place" is only set when the racer just finished the whole race). */
  function updateProgress(id, r, track, race, now) {
    if (r.finished) return null;
    r.s = Tracks.nearest(track, r.x, r.y).s;
    const N = track.checkpoints;
    const target = r.cp < N - 1 ? (r.cp + 1) / N : 0; // next checkpoint (0 = finish line)
    const diff = wrapDiff(r.s, target);
    let result = null;

    if (diff >= 0 && diff < 0.05) {
      if (target !== 0) {
        r.cp += 1;
      } else {
        // Lap complete!
        const lapTime = now - r.lapStart;
        r.lap += 1;
        r.cp = 0;
        r.lastLap = lapTime;
        const isBest = r.bestLap === null || lapTime < r.bestLap;
        if (isBest) r.bestLap = lapTime;
        r.lapStart = now;
        result = { lap: r.lap, lapTime, isBest, place: null };
        if (r.lap >= race.laps) {
          r.finished = true;
          r.finishTime = now - race.startTime;
          race.finishOrder.push(id);
          result.place = race.finishOrder.length;
        }
      }
    }

    // "progress" ranks the racers: laps done + how far into the current lap
    const base = r.cp / N;
    const rel = Math.max(-1 / N, Math.min(1 / N, wrapDiff(r.s, base)));
    r.progress = r.lap + base + rel;
    return result;
  }

  // Sort racers: finished ones by finish order, then everyone else by progress.
  // list = [{ id, race }]
  function standings(list, finishOrder) {
    return list.slice().sort((a, b) => {
      const fa = finishOrder.indexOf(a.id), fb = finishOrder.indexOf(b.id);
      if (fa !== -1 || fb !== -1) {
        if (fa === -1) return 1;
        if (fb === -1) return -1;
        return fa - fb;
      }
      return b.race.progress - a.race.progress;
    });
  }

  // One car's entry in the 20-times-a-second race update
  function stateRow(id, r, pos, now, racing) {
    return {
      id, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      a: Math.round(r.a * 1000) / 1000, vx: Math.round(r.vx), vy: Math.round(r.vy),
      d: r.d, ts: r.ts, pos, lap: r.lap, cp: r.cp,
      best: r.bestLap, last: r.lastLap, fin: r.finished, total: r.finishTime,
      cur: racing && !r.finished ? now - r.lapStart : null
    };
  }

  // One line of the final results table
  function resultRow(p, place) {
    return {
      place, id: p.id, name: p.name, color: p.color,
      finished: p.race.finished, totalTime: p.race.finishTime,
      bestLap: p.race.bestLap, laps: p.race.lap
    };
  }

  return { MAX_PLAYERS, MIN_LAPS, MAX_LAPS, FINISH_GRACE_MS, COLORS,
           newRacer, updateProgress, standings, stateRow, resultRow };
});
