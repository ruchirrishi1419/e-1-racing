/* =====================================================================
   E1 (EQUATION 1) - CONTROLS
   ---------------------------------------------------------------------
   Reads the keyboard, a game controller (gamepad) and the on-screen
   touch buttons, and stores the result in Input.state:

     up / down / left / right   true or false (keyboard style)
     steer                      -1 (full left) .. 1 (full right)  (smooth on a controller)
     throttle, brake            0 .. 1  (a controller's triggers can press halfway)
     lookBack                   true while looking behind (rear view)

   KEYBOARD                      CONTROLLER (Xbox / PlayStation style)
   Arrow Up or W    accelerate   Right trigger (R2/RT) or A / Cross
   Arrow Down or S  brake        Left trigger (L2/LT) or B / Circle
   Arrow Left/Right steer        Left stick or D-pad
   or A / D
   Tab (hold)       rear view    Y / Triangle (hold)
   Space            change view  RB / R1  (T-cam <-> Cockpit)
   ===================================================================== */

const Input = (() => {
  const state = { up: false, down: false, left: false, right: false, steer: 0, throttle: 0, brake: 0, lookBack: false, camSwitch: false };
  let camPresses = 0, padCamWasDown = false;
  const keys = { up: false, down: false, left: false, right: false, lookBack: false };   // keyboard
  const touch = { up: false, down: false, left: false, right: false, lookBack: false };  // touch buttons
  let enabled = false; // only listen while racing (so typing your name still works)
  let padName = '';

  // Which keyboard key does what
  const KEYS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Tab: 'lookBack'
  };

  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && enabled) { if (!e.repeat) camPresses++; e.preventDefault(); return; }   // Space = change camera
    const control = KEYS[e.code];
    if (control && enabled) { keys[control] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && enabled) { e.preventDefault(); return; }
    const control = KEYS[e.code];
    if (control) { keys[control] = false; if (enabled) e.preventDefault(); }
  });
  // If the window loses focus, let go of everything (stops "stuck" keys)
  window.addEventListener('blur', reset);

  function reset() {
    Object.keys(keys).forEach(k => { keys[k] = false; });
    Object.keys(touch).forEach(k => { touch[k] = false; });
    poll();
  }

  /* ---------- Game controller ----------
     Browsers only "see" a controller after you press one of its buttons. */
  window.addEventListener('gamepadconnected', e => { padName = e.gamepad.id; });
  window.addEventListener('gamepaddisconnected', () => { padName = ''; });

  function readPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = i => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      let stick = p.axes[0] || 0;
      if (Math.abs(stick) < 0.12) stick = 0;                                     // dead zone
      else stick = Math.sign(stick) * (Math.abs(stick) - 0.12) / 0.88;
      const dpad = (btn(15) > 0.5 ? 1 : 0) - (btn(14) > 0.5 ? 1 : 0);
      return {
        steer: dpad || stick,
        throttle: Math.max(btn(7), btn(0)),    // right trigger, or A / Cross
        brake: Math.max(btn(6), btn(1)),       // left trigger, or B / Circle
        lookBack: btn(3) > 0.5,                // Y / Triangle
        camera: btn(5) > 0.5                   // RB / R1
      };
    }
    return null;
  }

  // Combine keyboard, controller and touch. Called every frame by the game.
  function poll() {
    const pad = enabled ? readPad() : null;
    const kSteer = ((keys.right || touch.right) ? 1 : 0) - ((keys.left || touch.left) ? 1 : 0);
    state.steer = kSteer !== 0 ? kSteer : (pad ? pad.steer : 0);
    state.throttle = Math.max(keys.up || touch.up ? 1 : 0, pad ? pad.throttle : 0);
    state.brake = Math.max(keys.down || touch.down ? 1 : 0, pad ? pad.brake : 0);
    state.lookBack = keys.lookBack || touch.lookBack || !!(pad && pad.lookBack);
    // change camera view: once per press (keyboard C, controller RB, or the screen button)
    const padCam = !!(pad && pad.camera);
    if (padCam && !padCamWasDown) camPresses++;
    padCamWasDown = padCam;
    state.camSwitch = camPresses > 0;
    camPresses = 0;
    state.up = state.throttle > 0.1;
    state.down = state.brake > 0.1;
    state.left = state.steer < -0.3;
    state.right = state.steer > 0.3;
    return state;
  }

  // Is this a phone or tablet with a touch screen?
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  // Hook up the touch buttons. Each button has data-control="up/down/left/right/lookBack".
  // Several buttons can be held at once (e.g. GAS + LEFT).
  function setupTouch() {
    document.querySelectorAll('.touch-btn').forEach(btn => {
      const control = btn.dataset.control;
      const press = e => {
        e.preventDefault();
        if (btn.setPointerCapture && e.pointerId !== undefined) btn.setPointerCapture(e.pointerId);
        touch[control] = true;
        btn.classList.add('pressed');
      };
      const release = e => {
        e.preventDefault();
        touch[control] = false;
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

  const hasController = () => !!padName || !!readPad();

  const pressCamera = () => { camPresses++; };

  return { state, isTouch, setupTouch, setEnabled, poll, hasController, pressCamera };
})();
