/* =====================================================================
   E1 (EQUATION 1) - CONTROLS
   Reads the keyboard (Arrow keys or W A S D) and the on-screen touch
   buttons, and stores which controls are pressed right now in Input.state.
   ===================================================================== */

const Input = (() => {
  // true = being pressed right now
  const state = { up: false, down: false, left: false, right: false };
  let enabled = false; // only listen while racing (so typing your name still works)

  // Which keyboard key does what
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  window.addEventListener('keydown', e => {
    const control = KEYS[e.code];
    if (control && enabled) { state[control] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const control = KEYS[e.code];
    if (control) state[control] = false;
  });
  // If the window loses focus, let go of everything (stops "stuck" keys)
  window.addEventListener('blur', reset);

  function reset() { Object.keys(state).forEach(k => { state[k] = false; }); }

  // Is this a phone or tablet with a touch screen?
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  // Hook up the touch buttons. Each button has data-control="up/down/left/right".
  // Several buttons can be held at once (e.g. GAS + LEFT).
  function setupTouch() {
    document.querySelectorAll('.touch-btn').forEach(btn => {
      const control = btn.dataset.control;
      const press = e => {
        e.preventDefault();
        if (btn.setPointerCapture && e.pointerId !== undefined) btn.setPointerCapture(e.pointerId);
        state[control] = true;
        btn.classList.add('pressed');
      };
      const release = e => {
        e.preventDefault();
        state[control] = false;
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) reset();
  }

  return { state, isTouch, setupTouch, setEnabled };
})();
