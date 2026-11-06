/* =====================================================================
   E1 (EQUATION 1) - PLAY OFFLINE (race against AI cars)
   ---------------------------------------------------------------------
   This is a tiny "pretend server" that runs inside your browser.
   It drives the AI cars and uses the SAME race rules as the online
   server (shared/race.js). It sends the same kind of messages
   ("raceStart", "countdown", "go", "state", "results"...) so the rest
   of the game doesn't need to know if it's online or offline.
   ===================================================================== */

const Offline = (() => {
  // Original AI driver names (not real people)
  const AI_NAMES = ['Nova', 'Blaze', 'Comet', 'Rocket', 'Viper', 'Flash', 'Bolt', 'Storm', 'Zippy'];
  const PLAYER_ID = 'me';
  const STEP = 1 / 60;

  let events = null;    // functions to call (like the server sending a message)
  let track = null, race = null, state = 'idle';
  let racers = [];      // [{ id, name, color, race, ai?: { car, brain } }]
  let timers = [], loop = 0;

  // opts: { name, color, trackId, laps, aiCount }
  function start(opts, eventHandlers) {
    stop();
    events = eventHandlers;
    track = Tracks.get(opts.trackId);
    race = { trackId: track.id, laps: opts.laps, startTime: 0, finishOrder: [], deadline: null };
    state = 'countdown';

    // The player starts in the middle of the grid, so there are cars to overtake
    const total = opts.aiCount + 1;
    const playerSlot = Math.floor(total / 2);
    const aiColors = RaceRules.COLORS.map(c => c.id).filter(c => c !== opts.color);
    racers = [];
    let aiIndex = 0;
    for (let slot = 0; slot < total; slot++) {
      const r = RaceRules.newRacer(track, slot);
      if (slot === playerSlot) {
        racers.push({ id: PLAYER_ID, name: opts.name, color: opts.color, race: r });
      } else {
        // Each AI gets a different skill level: some fast, some slower
        const skill = 0.8 + Math.random() * 0.17;
        const lane = Math.random() * 2 - 1;
        racers.push({
          id: 'ai' + aiIndex, name: AI_NAMES[aiIndex], color: aiColors[aiIndex], race: r,
          ai: { car: Physics.createCar(r.x, r.y, r.a), brain: AI.createBrain(skill, lane) }
        });
        aiIndex++;
      }
    }

    events.raceStart({
      trackId: track.id,
      laps: race.laps,
      timeOfDay: opts.timeOfDay || 'day',
      weather: opts.weather || 'clouds',
      players: racers.map(p => ({ id: p.id, name: p.name, color: p.color, slot: p.race.slot }))
    });

    // Countdown lights, then GO
    [1, 2, 3].forEach(n => timers.push(setTimeout(() => events.countdown({ lights: n }), 1000 * n)));
    timers.push(setTimeout(() => {
      state = 'racing';
      race.startTime = Date.now();
      racers.forEach(p => { p.race.lapStart = race.startTime; });
      events.go();
    }, 4000 + Math.random() * 600));

    loop = setInterval(tick, 50); // 20 times a second, like the server
  }

  function stop() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
    clearInterval(loop);
    state = 'idle';
  }

  // My car's position, sent by the game (same as online)
  function onCarState(data) {
    if (state !== 'racing' && state !== 'finishing') return;
    const me = racers.find(p => p.id === PLAYER_ID);
    Object.assign(me.race, { x: data.x, y: data.y, a: data.a, vx: data.vx, vy: data.vy, d: data.d, ts: Date.now() });
    progress(me, Date.now());
  }

  // Check checkpoints and laps for one racer, and announce laps/finishes
  function progress(p, now) {
    const lap = RaceRules.updateProgress(p.id, p.race, track, race, now);
    if (!lap) return;
    events.lapDone({ id: p.id, lap: lap.lap, lapTime: lap.lapTime, isBest: lap.isBest });
    if (lap.place) {
      events.playerFinished({ id: p.id, name: p.name, place: lap.place, time: p.race.finishTime });
      if (lap.place === 1) {
        state = 'finishing';
        race.deadline = now + RaceRules.FINISH_GRACE_MS;
        events.winner({ id: p.id, name: p.name, graceMs: RaceRules.FINISH_GRACE_MS });
        timers.push(setTimeout(endRace, RaceRules.FINISH_GRACE_MS));
      }
      if (racers.every(r => r.race.finished)) endRace();
    }
  }

  function tick() {
    if (state === 'idle' || state === 'results') return;
    const now = Date.now();
    const racing = state === 'racing' || state === 'finishing';

    if (racing) {
      const me = racers.find(p => p.id === PLAYER_ID).race;
      racers.forEach(p => {
        if (!p.ai) return;
        const car = p.ai.car;
        // 3 small physics steps = 0.05 seconds
        for (let i = 0; i < 3; i++) {
          Physics.step(car, AI.drive(car, track, p.ai.brain, STEP), STEP, track);
          racers.forEach(o => {
            if (o === p) return;
            Physics.bump(car, o.ai ? o.ai.car : { x: me.x, y: me.y, vx: me.vx, vy: me.vy });
          });
        }
        Object.assign(p.race, { x: car.x, y: car.y, a: car.angle, vx: car.vx, vy: car.vy, d: car.drifting, ts: now });
        progress(p, now);
      });
    }
    if (state === 'results') return; // the race may have just ended

    const sorted = RaceRules.standings(racers, race.finishOrder);
    events.state({
      t: now,
      phase: state,
      remaining: race.deadline ? Math.max(0, race.deadline - now) : null,
      players: sorted.map((p, i) => RaceRules.stateRow(p.id, p.race, i + 1, now, racing))
    });
  }

  function endRace() {
    if (state === 'results' || state === 'idle') return;
    const rows = RaceRules.standings(racers, race.finishOrder).map((p, i) => RaceRules.resultRow(p, i + 1));
    stop();
    state = 'results';
    events.results({ rows, trackId: race.trackId, laps: race.laps });
  }

  return { PLAYER_ID, start, stop, onCarState };
})();
