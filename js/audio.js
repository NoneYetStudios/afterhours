/* After Hours - Web Audio (SFX + ping/pong 1980s style pulse) and speech narration. */
(function () {
  'use strict';
  window.AH = window.AH || {};

  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxOn = true, voiceOn = true;
  let musicRunning = false, timer = null, nextT = 0, step = 0;
  let getTime = function () { return 0; };
  let voiceCache = null, lastSpeechEnd = 0;

  try {
    sfxOn = localStorage.getItem('ah_sfx') !== '0';
    voiceOn = localStorage.getItem('ah_voice') !== '0';
  } catch (e) { /* storage unavailable */ }

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = sfxOn ? 0.7 : 0; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function resume() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone(o) {
    if (!ctx || !sfxOn) return;
    const t = o.t !== undefined ? o.t : ctx.currentTime + (o.at || 0);
    const d = o.d || 0.1, v = o.v || 0.25;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g); g.connect(o.dest || sfxBus);
    osc.start(t); osc.stop(t + d + 0.03);
  }

  function noise(o) {
    if (!ctx || !sfxOn) return;
    const t = ctx.currentTime + (o.at || 0), d = o.d || 0.1, v = o.v || 0.25;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf; src.loop = true;
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(t); src.stop(t + d + 0.03);
  }

  const sfx = {
    shoot() { noise({ d: 0.05, v: 0.22, f: 4000, type: 'highpass' }); tone({ f: 950, f2: 220, d: 0.07, v: 0.12 }); },
    empty() { tone({ f: 140, d: 0.05, v: 0.18 }); },
    hit() { tone({ f: 320, f2: 150, d: 0.05, v: 0.16 }); noise({ d: 0.04, v: 0.12, f: 3000 }); },
    destroy() {
      noise({ d: 0.4, v: 0.4, f: 2500, f2: 150 });
      tone({ f: 220, f2: 35, d: 0.35, v: 0.25, type: 'sawtooth' });
    },
    pickup() { tone({ f: 660, d: 0.07, v: 0.2 }); tone({ f: 880, d: 0.07, v: 0.2, at: 0.07 }); tone({ f: 1320, d: 0.12, v: 0.2, at: 0.14 }); },
    refill() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, d: 0.08, v: 0.22, at: i * 0.06 })); },
    damage() { tone({ f: 130, f2: 55, d: 0.28, v: 0.4, type: 'sawtooth' }); noise({ d: 0.15, v: 0.25, f: 1200 }); },
    droneFire() { tone({ f: 900, f2: 350, d: 0.14, v: 0.12 }); },
    droneCharge() { tone({ f: 500, f2: 800, d: 0.3, v: 0.05 }); },
    spawn() { tone({ f: 80, f2: 160, d: 0.2, v: 0.12, type: 'triangle' }); },
    alarm() { for (let i = 0; i < 4; i++) tone({ f: i % 2 ? 520 : 760, d: 0.14, v: 0.2, at: i * 0.16 }); },
    gameOver() {
      [440, 392, 349, 330, 262].forEach((f, i) => tone({ f, d: 0.2, v: 0.28, at: i * 0.2 }));
      tone({ f: 130, f2: 60, d: 0.9, v: 0.3, type: 'sawtooth', at: 1.0 });
    },
    start() { [262, 330, 392, 523].forEach((f, i) => tone({ f, d: 0.09, v: 0.22, at: i * 0.08 })); },
    click() { tone({ f: 600, d: 0.03, v: 0.1 }); }
  };

  /* ---- Ping / pong pulse -------------------------------------------------
     Two fixed low square-wave bleeps. Pitch never changes: tension comes only
     from tempo, and from the pair tightening up ("ping... pong..." becomes
     "ping-pong... ping-pong..."). */
  const PING = 196, PONG = 147;

  function cycleLength(t) { return Math.max(0.36, 1.7 * Math.pow(0.9945, t)); }
  function pairing(t) { return 0.5 - 0.2 * Math.min(1, t / 200); }

  function schedule() {
    if (!ctx || !musicRunning) return;
    while (nextT < ctx.currentTime + 0.15) {
      const t = getTime(), cyc = cycleLength(t), f = pairing(t);
      const isPing = step % 2 === 0;
      tone({ t: nextT, f: isPing ? PING : PONG, d: 0.09, v: 0.5, type: 'square', dest: musicBus });
      tone({ t: nextT, f: (isPing ? PING : PONG) / 2, d: 0.12, v: 0.4, type: 'triangle', dest: musicBus });
      nextT += isPing ? cyc * f : cyc * (1 - f);
      step++;
    }
  }

  function musicStart(timeFn) {
    if (!init()) return;
    resume();
    getTime = timeFn || getTime;
    if (musicRunning) return;
    musicRunning = true; step = 0; nextT = ctx.currentTime + 0.3;
    timer = setInterval(schedule, 25);
  }
  function musicStop() {
    musicRunning = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---- Speech ---------------------------------------------------------- */
  function pickVoice() {
    if (voiceCache) return voiceCache;
    if (!('speechSynthesis' in window)) return null;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return null;
    voiceCache = vs.find(v => /en[-_]US/i.test(v.lang) && /david|mark|male|guy|alex|daniel/i.test(v.name)) ||
                 vs.find(v => /^en/i.test(v.lang)) || null;
    return voiceCache;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = function () { voiceCache = null; };
  }

  function speak(text) {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.lang = (v && v.lang) || 'en-US';
      u.rate = 0.92; u.pitch = 0.6; u.volume = 1;
      u.onend = function () { lastSpeechEnd = performance.now(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }
  function isSpeaking() {
    return ('speechSynthesis' in window) && speechSynthesis.speaking;
  }
  function quietFor() { return performance.now() - lastSpeechEnd; }

  function setSfx(on) {
    sfxOn = !!on;
    try { localStorage.setItem('ah_sfx', sfxOn ? '1' : '0'); } catch (e) { }
    if (master) master.gain.value = sfxOn ? 0.7 : 0;
  }
  function setVoice(on) {
    voiceOn = !!on;
    try { localStorage.setItem('ah_voice', voiceOn ? '1' : '0'); } catch (e) { }
    if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
  }

  AH.Audio = {
    resume, sfx, musicStart, musicStop, speak, isSpeaking, quietFor,
    setSfx, setVoice,
    get sfxOn() { return sfxOn; },
    get voiceOn() { return voiceOn; },
    stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  };
})();
