/* After Hours - unified keyboard / mouse / touch input. */
(function () {
  'use strict';
  window.AH = window.AH || {};

  const W = AH.Map.W, H = AH.Map.H;
  const canvas = document.getElementById('game');
  const stage = document.getElementById('stage');
  const zone = document.getElementById('stickZone');
  const base = document.getElementById('stickBase');
  const knob = document.getElementById('stickKnob');
  const fireBtn = document.getElementById('fireBtn');

  const keys = Object.create(null);
  const s = {
    mx: W / 2, my: H / 2, mouseDown: false, touch: false, mouseSeen: false,
    stickId: null, sx: 0, sy: 0, vx: 0, vy: 0,
    fireId: null, fireAim: null, fireCx: 0, fireCy: 0
  };
  const STICK_R = 52;

  function setTouch() {
    if (s.touch) return;
    s.touch = true;
    document.body.classList.add('touch');
  }
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) setTouch();

  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', function (e) {
    if (typing(e)) return;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
    s.mouseDown = false;
  });

  function updateMouse(e) {
    const r = canvas.getBoundingClientRect();
    s.mx = (e.clientX - r.left) / r.width * W;
    s.my = (e.clientY - r.top) / r.height * H;
  }
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') { s.mouseSeen = true; updateMouse(e); }
  });
  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;
    s.mouseSeen = true; updateMouse(e);
    if (e.button === 0) s.mouseDown = true;
    e.preventDefault();
  });
  window.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'mouse' && e.button === 0) s.mouseDown = false;
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---- Virtual stick (floating, left side of the screen) ---- */
  zone.addEventListener('pointerdown', function (e) {
    setTouch();
    if (s.stickId !== null) return;
    s.stickId = e.pointerId; zone.setPointerCapture(e.pointerId);
    s.sx = e.clientX; s.sy = e.clientY; s.vx = 0; s.vy = 0;
    const r = stage.getBoundingClientRect();
    base.style.left = (e.clientX - r.left) + 'px';
    base.style.top = (e.clientY - r.top) + 'px';
    base.classList.add('on');
    knob.style.transform = 'translate(-50%,-50%)';
    e.preventDefault();
  });
  zone.addEventListener('pointermove', function (e) {
    if (e.pointerId !== s.stickId) return;
    let dx = e.clientX - s.sx, dy = e.clientY - s.sy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
    knob.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
    s.vx = dx / STICK_R; s.vy = dy / STICK_R;
    if (Math.hypot(s.vx, s.vy) < 0.18) { s.vx = 0; s.vy = 0; }
  });
  function endStick(e) {
    if (e.pointerId !== s.stickId) return;
    s.stickId = null; s.vx = 0; s.vy = 0; base.classList.remove('on');
  }
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  /* ---- Fire button: hold to shoot (auto-aim); drag to aim manually ---- */
  fireBtn.addEventListener('pointerdown', function (e) {
    setTouch();
    if (s.fireId !== null) return;
    s.fireId = e.pointerId; fireBtn.setPointerCapture(e.pointerId);
    const r = fireBtn.getBoundingClientRect();
    s.fireCx = r.left + r.width / 2; s.fireCy = r.top + r.height / 2;
    s.fireAim = null; fireBtn.classList.add('down');
    e.preventDefault();
  });
  fireBtn.addEventListener('pointermove', function (e) {
    if (e.pointerId !== s.fireId) return;
    const dx = e.clientX - s.fireCx, dy = e.clientY - s.fireCy, d = Math.hypot(dx, dy);
    s.fireAim = d > 30 ? { x: dx / d, y: dy / d } : null;
  });
  function endFire(e) {
    if (e.pointerId !== s.fireId) return;
    s.fireId = null; s.fireAim = null; fireBtn.classList.remove('down');
  }
  fireBtn.addEventListener('pointerup', endFire);
  fireBtn.addEventListener('pointercancel', endFire);

  ['touchstart', 'touchmove'].forEach(function (n) {
    stage.addEventListener(n, function (e) { if (document.body.classList.contains('playing')) e.preventDefault(); }, { passive: false });
  });

  AH.Input = {
    state: s,
    isTouch: function () { return s.touch && !s.mouseSeen ? true : (s.touch && s.fireId !== null); },
    getMove: function () {
      let x = 0, y = 0;
      if (keys.KeyA || keys.ArrowLeft) x -= 1;
      if (keys.KeyD || keys.ArrowRight) x += 1;
      if (keys.KeyW || keys.ArrowUp) y -= 1;
      if (keys.KeyS || keys.ArrowDown) y += 1;
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      x += s.vx; y += s.vy;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      return { x: x, y: y };
    },
    isFiring: function () { return s.mouseDown || !!keys.Space || s.fireId !== null; },
    hasMouse: function () { return s.mouseSeen; },
    touchAim: function () { return s.fireAim; },
    reset: function () {
      for (const k in keys) keys[k] = false;
      s.mouseDown = false;
    }
  };
})();
