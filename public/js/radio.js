/* =====================================================================
   E1 (EQUATION 1) - TEAM RADIO
   ---------------------------------------------------------------------
   Like real F1 team radio: a box slides in on the right of the screen
   ("FERRARI · RADIO" + the message) and a voice reads it out, with a
   radio click-and-beep before and after.
   The voice uses the browser's built-in speech (no recordings needed).
   Messages wait in a queue so they never talk over each other.
   ===================================================================== */

const Radio = (() => {
  const queue = [];
  let busy = false, team = { label: 'E1', hex: '#1b4fd6' }, hideTimer = 0;
  let voice = null;

  // Pick an English voice (some browsers load the voice list a moment later)
  function pickVoice() {
    if (!window.speechSynthesis) return;
    const all = speechSynthesis.getVoices();
    voice = all.find(v => /en[-_](GB|US)/i.test(v.lang) && /male|daniel|david|george|google uk/i.test(v.name))
         || all.find(v => /^en/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

  // The team whose radio this is (sets the name and colour of the box)
  function setTeam(t) { if (t) team = t; }

  // Show + speak a message. text = what the box shows, speech = what the voice says (optional)
  function say(text, speech) {
    queue.push({ text, speech: speech || text });
    if (!busy) next();
  }

  function next() {
    const m = queue.shift();
    if (!m) { busy = false; return; }
    busy = true;
    const box = document.getElementById('radio-box');
    document.getElementById('radio-team').textContent = team.label.toUpperCase();
    document.getElementById('radio-bar').style.background = team.hex;
    document.getElementById('radio-text').textContent = m.text;
    box.classList.remove('hidden');
    void box.offsetWidth;            // restart the slide-in animation
    box.classList.add('show');
    if (typeof Sound !== 'undefined') { Sound.radioBeep(); Sound.radioStatic(true); }   // F1-style opening chirp + hiss

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (typeof Sound !== 'undefined') { Sound.radioStatic(false); Sound.radioBeep(true); }   // closing click
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        box.classList.remove('show');
        setTimeout(next, 350);
      }, 1200);
    };
    const muted = typeof Sound !== 'undefined' && Sound.isMuted();
    if (window.speechSynthesis && !muted) {
      setTimeout(() => {
        const u = new SpeechSynthesisUtterance(m.speech);
        if (voice) u.voice = voice;
        u.rate = 1.05; u.pitch = 0.9;
        u.volume = typeof Sound !== 'undefined' ? Sound.getVolume() : 0.8;
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
      }, 650);   // wait for the opening chirp to finish
      setTimeout(done, 7500);        // just in case the voice never says it's finished
    } else {
      setTimeout(done, 2600);        // no voice: just show the box for a while
    }
  }

  // Clear everything (new race / leaving the race)
  function reset() {
    queue.length = 0;
    busy = false;
    clearTimeout(hideTimer);
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (typeof Sound !== 'undefined') Sound.radioStatic(false);
    const box = document.getElementById('radio-box');
    if (box) { box.classList.remove('show'); box.classList.add('hidden'); }
  }

  return { setTeam, say, reset };
})();
window.Radio = Radio;   // so the game files can find it
