/* After Hours - core game: simulation, difficulty, rendering. */
(function () {
  'use strict';
  window.AH = window.AH || {};

  const M = AH.Map, Snd = AH.Audio, In = AH.Input;
  const W = M.W, H = M.H, T = M.T, COLS = M.COLS, ROWS = M.ROWS;
  const TAU = Math.PI * 2;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const statLayer = document.createElement('canvas');
  const sctx = statLayer.getContext('2d');
  let scale = 1;

  /* ---------------- Tunables ---------------- */
  const PLAYER_SPEED = 170, PLAYER_HP = 100, START_AMMO = 30, MAX_AMMO = 99, REFILL_AMMO = 18;
  const FIRE_DELAY = 0.14, STAPLE_SPEED = 560;

  const TIERS = [
    { t: 1.0, text: 'WORK HOURS COMPLETE', sub: 'Please remain at your desk', say: 'Work hours complete.' },
    { t: 40, text: 'OVERTIME ACTIVE', sub: 'Productivity is mandatory', say: 'Overtime active.' },
    { t: 85, text: 'MANDATORY OVERTIME', sub: 'Additional compliance staff scheduled', say: 'Mandatory overtime activated. Additional compliance staff have been scheduled.' },
    { t: 135, text: 'EXECUTIVE REVIEW IN PROGRESS', sub: 'Your performance is being observed', say: 'Executive review in progress. Please remember to complete your timesheet.' },
    { t: 195, text: 'BUILDING LOCKDOWN', sub: 'Security has been notified', say: 'Building lockdown initiated. Security has been notified.' },
    { t: 265, text: 'ALL PTO REQUESTS DENIED', sub: 'Thank you for your continued dedication', say: 'All PTO requests have been denied.' }
  ];
  const FLAVOR = [
    'Please remember to complete your timesheet.',
    'Conference Room B has been reserved indefinitely.',
    'Thank you for your continued dedication.',
    'Reminder: the break room refrigerator will be cleaned. Labeled items will be discarded.',
    'Your call is important to us. Please hold.',
    'Security has been notified.',
    'Please remember to staple your reports.'
  ];

  /* ---------------- Helpers ---------------- */
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function fmtTime(s) {
    s = Math.floor(s);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------------- State ---------------- */
  let G = null;
  let mode = 'menu';           // menu | play | pause | over
  let lastTs = 0;
  let hiScore = parseInt(lsGet('ah_hi'), 10) || 0;
  const flow = new Int16Array(COLS * ROWS);

  const el = {
    score: document.getElementById('hudScore'), hi: document.getElementById('hudHi'),
    time: document.getElementById('hudTime'), ammo: document.getElementById('hudAmmo'),
    ammoBox: document.getElementById('hudAmmoBox'), enemies: document.getElementById('hudEnemies'),
    hp: document.getElementById('hudHpFill'), announce: document.getElementById('announce'),
    aText: document.getElementById('announceText'), aSub: document.getElementById('announceSub'),
    caption: document.getElementById('caption')
  };
  const hudCache = {};
  function setText(key, node, v) { if (hudCache[key] !== v) { hudCache[key] = v; node.textContent = v; } }

  function newGame() {
    return {
      t: 0, score: 0, scoreF: 0, kills: 0, state: 'play', deadT: 0, over: false,
      p: { x: M.start.x, y: M.start.y, r: 11, hp: PLAYER_HP, ammo: START_AMMO, ang: 0, cd: 0, inv: 0,
           speedT: 0, fx: 1, fy: 0, recoil: 0, walk: 0, emptyMsg: 0 },
      enemies: [], bullets: [], ebullets: [], pickups: [], parts: [], texts: [], spawners: [],
      spawnT: 1.2, refillT: 7, coffeeT: 22, donutT: 40, flowT: 0, tierIdx: 0, flavorT: rand(35, 55),
      captionT: 0, shake: 0, flash: 0, firstDrone: false, shots: 0,
      evpSpawned: false, evpTimer: rand(90, 115),
      hrSpawned: false, hrTimer: rand(120, 150),
      janitorSpawned: false, janitorTimer: rand(180, 230),
      ceoSpawned: false, ceoEverSpawned: false, ceoTimer: 600
    };
  }

  /* ---------------- Announcements / captions ---------------- */
  function announce(text, sub) {
    el.aText.textContent = text; el.aSub.textContent = sub || '';
    el.announce.classList.remove('show'); void el.announce.offsetWidth; el.announce.classList.add('show');
  }
  function caption(text) {
    el.caption.textContent = '“' + text + '”';
    el.caption.classList.add('show');
    G && (G.captionT = 5);
  }
  function say(text) { caption(text); Snd.speak(text); }

  /* ---------------- Difficulty ---------------- */
  const diff = {
    mult: g => 1 + Math.min(0.55, g.t / 420) + 0.04 * Math.max(0, g.tierIdx - 1),
    spawnInterval: g => Math.max(0.5, 3.0 - g.t * 0.0105),
    maxAlive: g => Math.min(38, 5 + Math.floor(g.t / 9)),
    droneChance: g => Math.min(0.5, 0.08 + g.t / 450),
    botHp: g => 4 + (g.tierIdx >= 4 ? 1 : 0) + (g.tierIdx >= 6 ? 1 : 0),
    droneHp: g => 2 + (g.tierIdx >= 5 ? 1 : 0),
    droneFireInterval: g => Math.max(1.4, 3.0 - g.t / 150)
  };

  /* ---------------- Spawning ---------------- */
  function randomFloor() { return pick(M.floorTiles); }

  function pickSpawnPoint(g, minD) {
    const p = g.p;
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const ft = randomFloor(), x = (ft.tx + 0.5) * T, y = (ft.ty + 0.5) * T;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > bestD) { bestD = d; best = { x, y }; }
      if (d < minD) continue;
      if (i < 28 && M.los(x, y, p.x, p.y)) continue;
      if (g.spawners.some(s => Math.hypot(s.x - x, s.y - y) < 60)) continue;
      return { x, y };
    }
    return best;
  }

  function queueEnemy(g, type) {
    const sp = pickSpawnPoint(g, (type === 'ceo' || type === 'evp') ? 360 : 300);
    g.spawners.push({ x: sp.x, y: sp.y, t: 0.9, max: 0.9, type });
    Snd.sfx.spawn();
  }

  function makeEnemy(g, type, x, y) {
    const drone = type === 'drone' || type === 'hr_director';
    let r = 12, hp = diff.botHp(g);
    if (type === 'drone') { r = 10; hp = diff.droneHp(g); }
    else if (type === 'evp') { r = 19; hp = 15; }
    else if (type === 'hr_director') { r = 16; hp = 12; }
    else if (type === 'janitor') { r = 15; hp = 25; }
    else if (type === 'ceo') { r = 24; hp = 100; }

    return {
      type, x, y, vx: 0, vy: 0, r, hp, maxHp: hp, ang: 0, hit: 0, anim: rand(0, 10),
      fireCd: type === 'hr_director' ? rand(1.5, 2.8) : rand(1.2, 2.6),
      charge: 0, burstLeft: 0, burstCd: 0,
      strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 2.5),
      wanderT: 0, wanderTarget: null, summonCd: rand(10, 16),
      talkCd: rand(18, 30), lifeTimer: type === 'janitor' ? rand(150, 240) : 0,
      dead: false
    };
  }

  function spawnPickup(g, type, mode) {
    const p = g.p;
    let cands = [];
    for (let i = 0; i < 16; i++) {
      const ft = randomFloor(), x = (ft.tx + 0.5) * T, y = (ft.ty + 0.5) * T;
      if (Math.hypot(x - p.x, y - p.y) < 200) continue;
      if (g.pickups.some(k => Math.hypot(k.x - x, k.y - y) < 120)) continue;
      cands.push({ x, y });
    }
    if (!cands.length) return;
    let c;
    const roll = Math.random();
    if (type === 'staples' && mode !== 'safe' && roll < 0.35 && g.enemies.length) {
      // Risky: next to a random enemy
      const e = pick(g.enemies);
      cands = cands.filter(k => Math.hypot(k.x - e.x, k.y - e.y) > 90);
      cands.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
      c = cands[0];
    } else if (type === 'staples' && roll < 0.7) {
      c = cands.reduce((a, b) => Math.hypot(b.x - p.x, b.y - p.y) > Math.hypot(a.x - p.x, a.y - p.y) ? b : a);
    }
    c = c || pick(cands);
    const life = type === 'staples' ? 24 : 18;
    g.pickups.push({ type, x: c.x, y: c.y, life, max: life, ph: rand(0, 6) });
    if (type === 'staples') {
      g.texts.push({ x: c.x, y: c.y - 20, txt: 'STAPLES!', life: 1.2, max: 1.2, col: '#ffd23f', vy: -20, big: true });
    }
  }

  /* ---------------- Effects ---------------- */
  function burst(x, y, n, col, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.25, 1) * speed;
      g_parts().push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.5, 1) * life, max: life, size: rand(0.6, 1) * size, col });
    }
  }
  function g_parts() { return G.parts; }
  function floatText(x, y, txt, col) { G.texts.push({ x, y, txt, life: 0.9, max: 0.9, col: col || '#fff', vy: -34 }); }

  /* ---------------- Movement / collision ---------------- */
  function moveEntity(e, dx, dy) {
    if (dx) { e.x += dx; if (M.collides(e.x, e.y, e.r)) e.x -= dx; }
    if (dy) { e.y += dy; if (M.collides(e.x, e.y, e.r)) e.y -= dy; }
  }

  function flowTarget(e) {
    const tx = Math.floor(e.x / T), ty = Math.floor(e.y / T);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
    let bestD = flow[ty * COLS + tx];
    if (bestD < 0) return null;
    let best = null;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox, ny = ty + oy;
        if (M.solid(nx, ny)) continue;
        if (ox && oy && (M.solid(tx + ox, ty) || M.solid(tx, ty + oy))) continue;
        const d = flow[ny * COLS + nx];
        if (d >= 0 && d < bestD) { bestD = d; best = { x: (nx + 0.5) * T, y: (ny + 0.5) * T }; }
      }
    }
    return best;
  }

  function steer(e, tx, ty, speed, dt) {
    let dx = tx - e.x, dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const k = Math.min(1, dt * 7);
    e.vx += (dx * speed - e.vx) * k; e.vy += (dy * speed - e.vy) * k;
    moveEntity(e, e.vx * dt, e.vy * dt);
  }

  /* ---------------- Player actions ---------------- */
  function fire(g) {
    const p = g.p;
    if (p.ammo <= 0) {
      p.cd = 0.3; p.emptyMsg = 0.8; Snd.sfx.empty();
      floatText(p.x, p.y - 22, 'NO STAPLES!', '#ff5a5a');
      return;
    }
    p.ammo--; p.cd = FIRE_DELAY; p.recoil = 1; g.shots++;
    const a = p.ang + rand(-0.02, 0.02);
    let mx = p.x + Math.cos(p.ang) * 20, my = p.y + Math.sin(p.ang) * 20;
    if (M.solidPx(mx, my)) { mx = p.x; my = p.y; }
    g.bullets.push({ x: mx, y: my, dx: Math.cos(a), dy: Math.sin(a), life: 1.1, alive: true });
    burst(mx, my, 3, '#ffe9a0', 90, 0.15, 2);
    Snd.sfx.shoot();
    if (p.ammo === 5 && !g.lowSaid) { g.lowSaid = true; say('Supplies are running low.'); }
  }

  function damagePlayer(g, n, fromX, fromY) {
    const p = g.p;
    if (p.inv > 0 || g.state !== 'play') return;
    p.hp -= n; p.inv = 0.9; g.shake = 9; g.flash = 0.45;
    Snd.sfx.damage();
    burst(p.x, p.y, 10, '#ff6b6b', 160, 0.5, 3);
    if (fromX !== undefined) {
      const d = Math.hypot(p.x - fromX, p.y - fromY) || 1;
      moveEntity(p, (p.x - fromX) / d * 14, (p.y - fromY) / d * 14);
    }
    if (p.hp <= 0) { p.hp = 0; die(g); }
  }

  function die(g) {
    g.state = 'dead'; g.deadT = 0;
    const p = g.p;
    burst(p.x, p.y, 40, '#4aa3ff', 260, 1, 4);
    burst(p.x, p.y, 20, '#ffffff', 200, 0.7, 3);
    g.shake = 16;
    Snd.musicStop();
    Snd.sfx.gameOver();
    Snd.speak('Your shift has ended. Thank you for your continued dedication.');
    caption('Your shift has ended. Thank you for your continued dedication.');
    document.body.classList.remove('playing');
  }

  function hitEnemy(g, e, bx, by) {
    e.hp -= 1; e.hit = 0.1;
    burst(bx, by, 5, e.type === 'drone' ? '#ffb347' : '#cfd8e6', 140, 0.25, 2.5);
    if (e.hp <= 0) { killEnemy(g, e); return; }
    Snd.sfx.hit();
    // small knockback
    const d = Math.hypot(e.x - g.p.x, e.y - g.p.y) || 1;
    moveEntity(e, (e.x - g.p.x) / d * 3, (e.y - g.p.y) / d * 3);
  }

  function killEnemy(g, e) {
    e.dead = true; g.kills++;
    let pts = 100;
    let burstCount = 22;
    let burstCol = '#9aa6b8';

    if (e.type === 'drone') {
      pts = 200;
      burstCol = '#ff9d2e';
    } else if (e.type === 'evp') {
      pts = 1000;
      burstCount = 45;
      burstCol = '#d1d5db';
      g.evpSpawned = false;
      g.evpTimer = rand(70, 110);
      say("Your feedback has been recorded.");
    } else if (e.type === 'hr_director') {
      pts = 1500;
      burstCount = 45;
      burstCol = '#c084fc';
      g.hrSpawned = false;
      g.hrTimer = rand(80, 130);
      say("Human Resources has concluded its investigation.");
    } else if (e.type === 'janitor') {
      pts = 2000;
      burstCount = 50;
      burstCol = '#38bdf8';
      g.janitorSpawned = false;
      g.janitorTimer = rand(150, 220);
      say("Cleaning services have been suspended.");
    } else if (e.type === 'ceo') {
      pts = 10000;
      burstCount = 80;
      burstCol = '#fbbf24';
      g.ceoSpawned = false;
      announce('CEO RETIRED', 'Quarterly transition in progress');
      say("Thank you for your continued dedication.");
    }

    g.score += pts; g.scoreF = g.score;
    floatText(e.x, e.y - 14, '+' + pts, (e.type === 'bot' || e.type === 'drone') ? '#ffe27a' : '#38bdf8');
    burst(e.x, e.y, burstCount, burstCol, 240, 0.8, 4);
    burst(e.x, e.y, Math.floor(burstCount * 0.4), '#ffffff', 180, 0.4, 3);
    burst(e.x, e.y, Math.floor(burstCount * 0.3), '#ff4040', 140, 0.9, 3.5);
    g.shake = Math.max(g.shake, (e.type === 'ceo' ? 14 : (e.type === 'evp' || e.type === 'hr_director' || e.type === 'janitor') ? 8 : 4));
    Snd.sfx.destroy();
  }

  /* ---------------- Update ---------------- */
  function updateAim(g) {
    const p = g.p;
    const touchAim = In.touchAim();
    if (touchAim) { p.ang = Math.atan2(touchAim.y, touchAim.x); return; }
    if (In.hasMouse() && In.state.fireId === null) {
      p.ang = Math.atan2(In.state.my - p.y, In.state.mx - p.x);
      return;
    }
    // Touch auto-aim: nearest visible enemy, else last movement direction
    let best = null, bd = 460 * 460;
    for (const e of g.enemies) {
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < bd && M.los(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    if (best) p.ang = Math.atan2(best.y - p.y, best.x - p.x);
    else p.ang = Math.atan2(p.fy, p.fx);
  }

  function updatePlayer(g, dt) {
    const p = g.p;
    const mv = In.getMove();
    const sp = PLAYER_SPEED * (p.speedT > 0 ? 1.35 : 1);
    moveEntity(p, mv.x * sp * dt, mv.y * sp * dt);
    const m = Math.hypot(mv.x, mv.y);
    if (m > 0.1) { p.fx = mv.x / m; p.fy = mv.y / m; p.walk += dt * 11 * m; }
    updateAim(g);
    p.cd -= dt; p.inv -= dt; p.recoil = Math.max(0, p.recoil - dt * 9);
    p.speedT -= dt; p.emptyMsg -= dt;
    if (In.isFiring() && p.cd <= 0) fire(g);
    if (p.speedT > 0 && Math.random() < 0.5) {
      G.parts.push({ x: p.x, y: p.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.3, max: 0.3, size: 3, col: '#ffcf6a' });
    }
  }

  function updateSpawning(g, dt) {
    g.spawnT -= dt;
    if (g.spawnT <= 0) {
      if (g.enemies.length + g.spawners.length < diff.maxAlive(g)) {
        const type = Math.random() < diff.droneChance(g) && g.t > 15 ? 'drone' : 'bot';
        queueEnemy(g, type);
        if (type === 'drone' && !g.firstDrone) { g.firstDrone = true; setTimeout(() => G === g && g.state === 'play' && say('Security has been notified.'), 600); }
      }
      g.spawnT = diff.spawnInterval(g) * rand(0.8, 1.2);
    }

    // Rare Elite Spawning logic
    if (g.state === 'play') {
      // 1. Executive Vice President (after 90s, only one at a time)
      if (g.t >= 90 && !g.evpSpawned && !g.enemies.some(e => e.type === 'evp') && !g.spawners.some(s => s.type === 'evp')) {
        g.evpTimer -= dt;
        if (g.evpTimer <= 0) {
          g.evpSpawned = true;
          queueEnemy(g, 'evp');
          announce('EXECUTIVE REVIEW IN PROGRESS', 'Executive Vice President has arrived');
          say("Executive review in progress.");
        }
      }

      // 2. HR Director (after 120s, only one at a time)
      if (g.t >= 120 && !g.hrSpawned && !g.enemies.some(e => e.type === 'hr_director') && !g.spawners.some(s => s.type === 'hr_director')) {
        g.hrTimer -= dt;
        if (g.hrTimer <= 0) {
          g.hrSpawned = true;
          queueEnemy(g, 'hr_director');
          announce('HR ENFORCEMENT DEPLOYED', 'Human Resources Director on site');
          say("Your benefits package has been updated.");
        }
      }

      // 3. The Janitor (rare neutral, after 180s, only one at a time)
      if (g.t >= 180 && !g.janitorSpawned && !g.enemies.some(e => e.type === 'janitor') && !g.spawners.some(s => s.type === 'janitor')) {
        g.janitorTimer -= dt;
        if (g.janitorTimer <= 0) {
          g.janitorSpawned = true;
          queueEnemy(g, 'janitor');
          announce('THE JANITOR HAS ENTERED THE BUILDING', 'Floor maintenance in effect');
          say("The janitor has entered the building.");
        }
      }

      // 4. CEO (after 600s / 10 minutes, once per run)
      if (g.t >= 600 && !g.ceoEverSpawned && !g.ceoSpawned && !g.enemies.some(e => e.type === 'ceo') && !g.spawners.some(s => s.type === 'ceo')) {
        g.ceoTimer -= dt;
        if (g.ceoTimer <= 0) {
          g.ceoSpawned = true;
          g.ceoEverSpawned = true;
          queueEnemy(g, 'ceo');
          announce('THE CEO HAS ARRIVED', 'Mandatory town hall in progress');
          say("Let's discuss your long-term commitment to the company.");
        }
      }
    }

    for (const s of g.spawners) {
      s.t -= dt;
      if (s.t <= 0) {
        g.enemies.push(makeEnemy(g, s.type, s.x, s.y));
        const col = (s.type === 'ceo') ? '#fbbf24' : (s.type === 'hr_director') ? '#c084fc' : (s.type === 'janitor') ? '#38bdf8' : (s.type === 'evp') ? '#e2e8f0' : (s.type === 'drone') ? '#ffb347' : '#ff7a7a';
        burst(s.x, s.y, (s.type === 'ceo' || s.type === 'evp' || s.type === 'hr_director' || s.type === 'janitor') ? 26 : 14, col, 170, 0.6, 3.5);
      }
    }
    g.spawners = g.spawners.filter(s => s.t > 0);

    // Pickups
    const hasStaples = g.pickups.some(k => k.type === 'staples');
    g.refillT -= dt;
    if (g.refillT <= 0) {
      const stapleCount = g.pickups.filter(k => k.type === 'staples').length;
      if (stapleCount < 2) spawnPickup(g, 'staples');
      g.refillT = Math.max(6, 10 - g.t / 60) * rand(0.85, 1.15);
    }
    // Safety net: an empty magazine must never be a dead end
    if (g.p.ammo <= 0 && !hasStaples) g.refillT = Math.min(g.refillT, 1.5);
    g.coffeeT -= dt; g.donutT -= dt;
    if (g.coffeeT <= 0) { if (!g.pickups.some(k => k.type === 'coffee')) spawnPickup(g, 'coffee'); g.coffeeT = rand(26, 38); }
    if (g.donutT <= 0) { if (!g.pickups.some(k => k.type === 'donut')) spawnPickup(g, 'donut'); g.donutT = rand(38, 55); }
  }

  function updateEnemies(g, dt) {
    const p = g.p, mult = diff.mult(g);
    g.flowT -= dt;
    if (g.flowT <= 0) { M.flowFrom(p.x, p.y, flow); g.flowT = 0.18; }

    for (const e of g.enemies) {
      e.anim += dt; e.hit = Math.max(0, e.hit - dt);
      const dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy);
      const sight = g.state === 'play' && M.los(e.x, e.y, p.x, p.y);

      if (e.type === 'bot' || e.type === 'evp' || e.type === 'ceo') {
        const baseSpeed = (e.type === 'ceo') ? 42 : (e.type === 'evp') ? 50 : 64;
        const speed = baseSpeed * mult;
        if (g.state !== 'play') { e.vx *= 0.9; e.vy *= 0.9; }
        else if (sight) steer(e, p.x, p.y, speed, dt);
        else { const t = flowTarget(e); if (t) steer(e, t.x, t.y, speed, dt); else steer(e, p.x, p.y, speed, dt); }

        if (g.state === 'play' && dist < e.r + p.r + 2) {
          const dmg = (e.type === 'ceo') ? 25 : (e.type === 'evp') ? 20 : 16;
          damagePlayer(g, dmg, e.x, e.y);
        }

        // CEO summons compliance bots periodically & speaks
        if (e.type === 'ceo' && g.state === 'play') {
          e.summonCd -= dt;
          if (e.summonCd <= 0) {
            e.summonCd = rand(12, 18);
            if (g.enemies.length < diff.maxAlive(g) + 4) {
              queueEnemy(g, 'bot');
              burst(e.x, e.y, 16, '#fbbf24', 120, 0.4, 3);
            }
          }
          e.talkCd -= dt;
          if (e.talkCd <= 0) {
            e.talkCd = rand(25, 45);
            if (!Snd.isSpeaking()) {
              say(pick([
                "I hope this meeting won't take long.",
                "We value employee retention.",
                "Your dedication has been noted."
              ]));
            }
          }
        }
      } else if (e.type === 'janitor') {
        // Neutral Special: Does NOT target player or enemies, wanders through rooms & hallways
        e.wanderT -= dt;
        if (e.wanderT <= 0 || !e.wanderTarget || Math.hypot(e.wanderTarget.x - e.x, e.wanderTarget.y - e.y) < 24) {
          e.wanderT = rand(4, 9);
          const ft = randomFloor();
          e.wanderTarget = { x: (ft.tx + 0.5) * T, y: (ft.ty + 0.5) * T };
        }
        steer(e, e.wanderTarget.x, e.wanderTarget.y, 45, dt);

        // Can damage player slightly if player walks directly into him
        if (g.state === 'play' && dist < e.r + p.r) {
          damagePlayer(g, 6, e.x, e.y);
        }

        // Accidental crowd damage: bumps enemies out of the way and chips their HP
        for (const other of g.enemies) {
          if (other !== e && !other.dead) {
            const odx = other.x - e.x, ody = other.y - e.y, odist = Math.hypot(odx, ody);
            if (odist < e.r + other.r + 4) {
              const push = 24 * dt;
              moveEntity(other, (odx / (odist || 1)) * push, (ody / (odist || 1)) * push);
              if (Math.random() < 0.05) {
                other.hp -= 1;
                other.hit = 0.08;
                burst(other.x, other.y, 3, '#38bdf8', 60, 0.2, 2);
                if (other.hp <= 0) killEnemy(g, other);
              }
            }
          }
        }

        // Janitor idle voice lines
        e.talkCd -= dt;
        if (e.talkCd <= 0) {
          e.talkCd = rand(30, 50);
          if (!Snd.isSpeaking()) {
            say(pick([
              "Please keep the hallways clear.",
              "Lost and found is now closed.",
              "This floor was waxed recently."
            ]));
          }
        }

        // Despawn after several minutes if not defeated
        if (e.lifeTimer > 0) {
          e.lifeTimer -= dt;
          if (e.lifeTimer <= 0) {
            e.dead = true;
            g.janitorSpawned = false;
            burst(e.x, e.y, 25, '#38bdf8', 120, 0.6, 3);
          }
        }
      } else {
        // 'drone' or 'hr_director'
        const isHR = e.type === 'hr_director';
        const speed = (isHR ? 95 : 112) * mult;
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1.2, 2.8); }
        if (g.state !== 'play') { e.vx *= 0.9; e.vy *= 0.9; }
        else if (sight && dist < (isHR ? 320 : 260)) {
          // keep distance and circle the player
          const nx = dx / dist, ny = dy / dist;
          let tx = -ny * e.strafe, ty = nx * e.strafe;
          if (dist < 150) { tx -= nx * 0.9; ty -= ny * 0.9; }
          else if (dist > 230) { tx += nx * 0.7; ty += ny * 0.7; }
          steer(e, e.x + tx * 50, e.y + ty * 50, speed * 0.85, dt);
        } else if (sight) steer(e, p.x, p.y, speed, dt);
        else { const t = flowTarget(e); if (t) steer(e, t.x, t.y, speed, dt); else steer(e, p.x, p.y, speed, dt); }

        // weapons
        if (g.state === 'play') {
          if (isHR && e.burstLeft > 0) {
            e.burstCd -= dt;
            if (e.burstCd <= 0) {
              e.burstLeft--;
              e.burstCd = 0.12;
              const ex = p.x - e.x, ey = p.y - e.y, d = Math.hypot(ex, ey) || 1;
              let aimx = p.x + (In.getMove().x) * PLAYER_SPEED * d / 260 * 0.5;
              let aimy = p.y + (In.getMove().y) * PLAYER_SPEED * d / 260 * 0.5;
              const ax = aimx - e.x, ay = aimy - e.y, ad = Math.hypot(ax, ay) || 1;
              g.ebullets.push({ x: e.x, y: e.y, dx: ax / ad, dy: ay / ad, speed: 280 * Math.min(1.3, mult), life: 3.2, alive: true, elite: true });
              Snd.sfx.droneFire();
            }
          } else if (e.charge > 0) {
            e.charge -= dt;
            if (e.charge <= 0) {
              if (isHR) {
                e.burstLeft = 3;
                e.burstCd = 0;
              } else {
                const ex = p.x - e.x, ey = p.y - e.y, d = Math.hypot(ex, ey) || 1;
                let aimx = p.x, aimy = p.y;
                if (g.tierIdx >= 5) { aimx += (In.getMove().x) * PLAYER_SPEED * d / 260 * 0.6; aimy += (In.getMove().y) * PLAYER_SPEED * d / 260 * 0.6; }
                const ax = aimx - e.x, ay = aimy - e.y, ad = Math.hypot(ax, ay) || 1;
                g.ebullets.push({ x: e.x, y: e.y, dx: ax / ad, dy: ay / ad, speed: 250 * Math.min(1.3, mult), life: 3, alive: true });
                Snd.sfx.droneFire();
              }
            }
          } else {
            e.fireCd -= dt;
            if (e.fireCd <= 0 && sight && dist < (isHR ? 460 : 430)) {
              e.charge = isHR ? 0.55 : 0.45;
              e.fireCd = (isHR ? 2.4 : diff.droneFireInterval(g)) * rand(0.85, 1.25);
              Snd.sfx.droneCharge();
            }
          }
          if (dist < e.r + p.r) damagePlayer(g, isHR ? 14 : 10, e.x, e.y);
        }
      }
      e.ang = Math.atan2(dy, dx);
    }
    // separation
    const L = g.enemies;
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const a = L[i], b = L[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d > 0 && d < min) {
          const push = (min - d) / 2 / d;
          moveEntity(a, -dx * push, -dy * push); moveEntity(b, dx * push, dy * push);
        }
      }
    }
    g.enemies = g.enemies.filter(e => !e.dead);
  }

  function updateBullets(g, dt) {
    for (const b of g.bullets) {
      let rem = STAPLE_SPEED * dt;
      while (rem > 0 && b.alive) {
        const st = Math.min(rem, 6); rem -= st;
        b.x += b.dx * st; b.y += b.dy * st;
        if (M.solidPx(b.x, b.y)) {
          b.alive = false; burst(b.x - b.dx * 3, b.y - b.dy * 3, 4, '#d9dfef', 80, 0.2, 2);
          break;
        }
        for (const e of g.enemies) {
          if (!e.dead && (e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + 2) ** 2) {
            b.alive = false; hitEnemy(g, e, b.x, b.y); break;
          }
        }
      }
      b.life -= dt; if (b.life <= 0) b.alive = false;
    }
    g.bullets = g.bullets.filter(b => b.alive);

    for (const b of g.ebullets) {
      let rem = b.speed * dt;
      while (rem > 0 && b.alive) {
        const st = Math.min(rem, 6); rem -= st;
        b.x += b.dx * st; b.y += b.dy * st;
        if (M.solidPx(b.x, b.y)) { b.alive = false; burst(b.x, b.y, 4, '#ff9d2e', 80, 0.2, 2); break; }
        if (g.state === 'play' && (g.p.x - b.x) ** 2 + (g.p.y - b.y) ** 2 < (g.p.r + 4) ** 2) {
          b.alive = false; damagePlayer(g, 12, b.x, b.y); break;
        }
      }
      b.life -= dt; if (b.life <= 0) b.alive = false;
    }
    g.ebullets = g.ebullets.filter(b => b.alive);
  }

  function updatePickups(g, dt) {
    const p = g.p;
    for (const k of g.pickups) {
      k.life -= dt;
      if (g.state !== 'play') continue;
      if (Math.hypot(k.x - p.x, k.y - p.y) < p.r + 15) {
        k.life = -1;
        if (k.type === 'staples') {
          p.ammo = Math.min(MAX_AMMO, p.ammo + REFILL_AMMO); g.score += 50;
          floatText(k.x, k.y - 12, '+' + REFILL_AMMO + ' STAPLES', '#ffd23f');
          Snd.sfx.refill(); burst(k.x, k.y, 18, '#ffd23f', 170, 0.6, 3);
        } else if (k.type === 'coffee') {
          p.speedT = 8; g.score += 250;
          floatText(k.x, k.y - 12, 'COFFEE! SPEED UP +250', '#ffb58a');
          Snd.sfx.pickup(); burst(k.x, k.y, 14, '#c98a5a', 150, 0.6, 3);
        } else {
          p.hp = Math.min(PLAYER_HP, p.hp + 30); g.score += 100;
          floatText(k.x, k.y - 12, 'DONUT +30 HP +100', '#ff9ec7');
          Snd.sfx.pickup(); burst(k.x, k.y, 14, '#ff9ec7', 150, 0.6, 3);
        }
        g.scoreF = g.score;
      }
    }
    g.pickups = g.pickups.filter(k => k.life > 0);
  }

  function updateEffects(g, dt) {
    for (const q of g.parts) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 1 - Math.min(1, dt * 3.5); q.vy *= 1 - Math.min(1, dt * 3.5);
    }
    g.parts = g.parts.filter(q => q.life > 0);
    if (g.parts.length > 600) g.parts.splice(0, g.parts.length - 600);
    for (const t of g.texts) { t.life -= dt; t.y += t.vy * dt; }
    g.texts = g.texts.filter(t => t.life > 0);
    g.shake = Math.max(0, g.shake - dt * 40);
    g.flash = Math.max(0, g.flash - dt * 1.6);
    if (g.captionT > 0) { g.captionT -= dt; if (g.captionT <= 0) el.caption.classList.remove('show'); }
  }

  function updateDirector(g, dt) {
    while (g.tierIdx < TIERS.length && g.t >= TIERS[g.tierIdx].t) {
      const tr = TIERS[g.tierIdx++];
      announce(tr.text, tr.sub);
      Snd.sfx.alarm();
      setTimeout(() => { if (G === g && mode === 'play') say(tr.say); }, 650);
      g.flavorT = Math.max(g.flavorT, 20);
    }
    if (g.t > 15) {
      g.flavorT -= dt;
      if (g.flavorT <= 0) {
        if (!Snd.isSpeaking() && Snd.quietFor() > 8000) {
          const phrase = (window.AH && AH.Lore) ? AH.Lore.getRandomVoiceAlert() : pick(FLAVOR);
          say(phrase);
          g.flavorT = rand(50, 85);
        } else g.flavorT = 3;
      }
    }
    // survival score
    g.scoreF += 10 * dt;
    g.score = Math.max(g.score, Math.floor(g.scoreF));
  }

  function update(dt) {
    const g = G;
    if (g.state === 'dead') {
      g.deadT += dt;
      updateEnemies(g, dt); updateBullets(g, dt); updateEffects(g, dt);
      if (g.deadT > 1.8 && !g.over) {
        g.over = true; mode = 'over';
        finish(g);
      }
      return;
    }
    g.t += dt;
    updateDirector(g, dt);
    updatePlayer(g, dt);
    updateSpawning(g, dt);
    updateEnemies(g, dt);
    updateBullets(g, dt);
    updatePickups(g, dt);
    updateEffects(g, dt);
    // keep score/scoreF in sync when points were added directly
    g.scoreF = Math.max(g.scoreF, g.score);
  }

  function finish(g) {
    const result = { score: g.score, time: Math.floor(g.t), kills: g.kills, newHigh: g.score > hiScore };
    if (result.newHigh) { hiScore = g.score; lsSet('ah_hi', String(hiScore)); }
    el.caption.classList.remove('show');
    if (AH.Game.onGameOver) AH.Game.onGameOver(result);
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    if (!G) return;
    const p = G.p;
    setText('score', el.score, String(G.score));
    setText('hi', el.hi, String(Math.max(hiScore, G.score)));
    setText('time', el.time, fmtTime(G.t));
    setText('ammo', el.ammo, String(p.ammo));
    setText('en', el.enemies, String(G.enemies.length));
    const hpPct = Math.round(p.hp / PLAYER_HP * 100);
    if (hudCache.hp !== hpPct) { hudCache.hp = hpPct; el.hp.style.width = hpPct + '%'; el.hp.classList.toggle('low', hpPct <= 30); }
    el.ammoBox.classList.toggle('empty', p.ammo === 0);
    el.ammoBox.classList.toggle('low', p.ammo > 0 && p.ammo <= 6);
  }
  function resetHud() {
    setText('hi', el.hi, String(hiScore));
  }

  /* ---------------- Rendering: static map ---------------- */
  function renderStatic() {
    statLayer.width = canvas.width; statLayer.height = canvas.height;
    const c = sctx;
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.fillStyle = '#0d1019'; c.fillRect(0, 0, W, H);
    // floors
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const i = ty * COLS + tx;
        if (M.grid[i] !== M.FLOOR) continue;
        const ri = M.tint[i];
        c.fillStyle = ri >= 0 ? M.rooms[ri].color : ((tx + ty) & 1 ? '#2a3143' : '#272e3e');
        c.fillRect(tx * T, ty * T, T, T);
        if ((tx + ty) & 1) { c.fillStyle = 'rgba(255,255,255,0.028)'; c.fillRect(tx * T, ty * T, T, T); }
      }
    }
    c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= COLS; x++) { c.moveTo(x * T + 0.5, 0); c.lineTo(x * T + 0.5, H); }
    for (let y = 0; y <= ROWS; y++) { c.moveTo(0, y * T + 0.5); c.lineTo(W, y * T + 0.5); }
    c.stroke();
    // hallway centre lines
    c.strokeStyle = 'rgba(255,214,90,0.10)'; c.setLineDash([12, 12]); c.beginPath();
    c.moveTo(9 * T, 8 * T); c.lineTo(23 * T, 8 * T);
    c.moveTo(9 * T, 16 * T); c.lineTo(23 * T, 16 * T);
    c.moveTo(1 * T, 8 * T); c.lineTo(10 * T, 8 * T);
    c.moveTo(22 * T, 8 * T); c.lineTo(31 * T, 8 * T);
    c.moveTo(1 * T, 16 * T); c.lineTo(10 * T, 16 * T);
    c.moveTo(22 * T, 16 * T); c.lineTo(31 * T, 16 * T);
    c.stroke(); c.setLineDash([]);
    // labels
    c.font = 'bold 13px "Trebuchet MS", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,0.16)';
    for (const r of M.rooms) {
      const cx = (r.x + r.w / 2) * T, cy = (r.walled ? r.y + 1.5 : r.y + 0.5 + r.h / 2) * T;
      c.fillText(r.name, cx, r.name === 'CUBICLE FARM' ? (r.y + 0.5) * T : cy);
    }
    // wall tiles
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const v = M.grid[ty * COLS + tx];
        if (v === M.FLOOR) continue;
        drawBlock(c, tx, ty, v);
      }
    }
  }

  function drawBlock(c, tx, ty, v) {
    const x = tx * T, y = ty * T;
    const belowSolid = M.solid(tx, ty + 1) && M.grid[Math.min(ROWS - 1, ty + 1) * COLS + tx] === v;
    const aboveSolid = ty > 0 && M.grid[(ty - 1) * COLS + tx] === v;
    let side, face, hi;
    if (v === M.WALL) { side = '#2e3650'; face = '#66789f'; hi = 'rgba(255,255,255,0.28)'; }
    else if (v === M.CUBE) { side = '#245a62'; face = '#3f8c95'; hi = 'rgba(255,255,255,0.3)'; }
    else if (v === M.RACK) { side = '#10151f'; face = '#222a3a'; hi = 'rgba(120,255,200,0.25)'; }
    else { side = '#5a4128'; face = '#8c6a45'; hi = 'rgba(255,230,180,0.3)'; }
    c.fillStyle = side; c.fillRect(x, y, T, T);
    c.fillStyle = face; c.fillRect(x, y, T, belowSolid ? T : T - 5);
    if (!aboveSolid) { c.fillStyle = hi; c.fillRect(x, y, T, 2); }
    if (v === M.RACK) {
      for (let i = 0; i < 3; i++) {
        c.fillStyle = (tx + i) % 2 ? '#3cff9a' : '#ff9a3c';
        c.fillRect(x + 6 + i * 9, y + 8, 4, 3);
        c.fillStyle = '#0b0f17'; c.fillRect(x + 4, y + 16 + (i % 2) * 3, T - 8, 2);
      }
    } else if (v === M.FURN) {
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x + 3, y + 3, T - 6, T - 11);
    } else if (v === M.CUBE) {
      c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x + 5, y + 5, T - 10, T - 14);
    } else if (v === M.WALL) {
      c.fillStyle = 'rgba(0,0,0,0.10)'; c.fillRect(x + 2, y + 2, T - 4, T - 9);
    }
  }

  /* ---------------- Rendering: entities ---------------- */
  function drawPlayer(c, g) {
    const p = g.p;
    if (g.state === 'dead') return;
    if (p.inv > 0 && Math.floor(p.inv * 18) % 2 === 0) return;
    c.save(); c.translate(p.x, p.y);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(2, 4, 13, 11, 0, 0, TAU); c.fill();
    if (p.speedT > 0) { c.strokeStyle = 'rgba(255,200,100,' + (0.3 + 0.2 * Math.sin(g.t * 20)) + ')'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 17, 0, TAU); c.stroke(); }
    c.rotate(p.ang);
    // legs / feet (walk)
    const sw = Math.sin(p.walk) * 4;
    c.fillStyle = '#1f2433'; rr(c, -6 + sw * 0.5, -8, 9, 5, 2); c.fill(); rr(c, -6 - sw * 0.5, 3, 9, 5, 2); c.fill();
    // shoulders / shirt
    c.fillStyle = '#3d7bff'; rr(c, -7, -12, 14, 24, 6); c.fill();
    c.fillStyle = '#ffffff'; c.fillRect(1, -1, 6, 2); // tie knot direction hint
    c.fillStyle = '#d33a3a'; c.fillRect(2, -1.5, 8, 3);
    // arms
    const rc = p.recoil * 3;
    c.strokeStyle = '#2f62d1'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -9); c.lineTo(11 - rc, -3); c.moveTo(0, 9); c.lineTo(11 - rc, 3); c.stroke();
    // staple gun
    c.fillStyle = '#c93131'; rr(c, 8 - rc, -3.5, 14, 7, 2); c.fill();
    c.fillStyle = '#d9dde6'; c.fillRect(19 - rc, -2, 5, 4);
    c.fillStyle = '#7b0f0f'; c.fillRect(10 - rc, -1, 7, 2);
    // head
    c.fillStyle = '#f0c18d'; c.beginPath(); c.arc(-1, 0, 6.5, 0, TAU); c.fill();
    c.fillStyle = '#3a2a1e'; c.beginPath(); c.arc(-2.5, 0, 6.5, Math.PI * 0.55, Math.PI * 1.45); c.fill();
    c.restore();
    // muzzle flash
    if (p.recoil > 0.6) {
      const mx = p.x + Math.cos(p.ang) * 26, my = p.y + Math.sin(p.ang) * 26;
      c.fillStyle = 'rgba(255,240,170,0.9)'; c.beginPath(); c.arc(mx, my, 4 + p.recoil * 3, 0, TAU); c.fill();
    }
  }

  function drawBot(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(2, 4, 14, 12, 0, 0, TAU); c.fill();
    c.rotate(e.ang);
    const flash = e.hit > 0;
    c.fillStyle = '#262b36'; rr(c, -12, -15, 24, 6, 2); c.fill(); rr(c, -12, 9, 24, 6, 2); c.fill();
    c.strokeStyle = '#4a5160'; c.lineWidth = 1;
    const off = (e.anim * 18) % 6;
    c.beginPath();
    for (let i = -12 + off; i < 12; i += 6) { c.moveTo(i, -15); c.lineTo(i, -9); c.moveTo(i, 9); c.lineTo(i, 15); }
    c.stroke();
    c.fillStyle = flash ? '#fff' : '#8e9bb0'; rr(c, -11, -11, 22, 22, 4); c.fill();
    c.fillStyle = flash ? '#fff' : '#c4cddb'; rr(c, -8, -8, 13, 16, 3); c.fill();
    // clipboard on back (distinct silhouette)
    c.fillStyle = flash ? '#fff' : '#d8c07a'; rr(c, -10, -5, 4, 10, 1); c.fill();
    // visor
    c.shadowColor = '#ff2a2a'; c.shadowBlur = 8;
    c.fillStyle = '#ff3535'; rr(c, 5, -7, 5, 14, 2); c.fill();
    c.shadowBlur = 0;
    // antenna
    c.fillStyle = Math.floor(e.anim * 3) % 2 ? '#ff4d4d' : '#552222';
    c.beginPath(); c.arc(-3, 0, 2.2, 0, TAU); c.fill();
    c.restore();
    if (e.hp < e.maxHp) hpBar(c, e);
  }

  function drawEVP(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(3, 6, 22, 18, 0, 0, TAU); c.fill();
    c.rotate(e.ang);
    const flash = e.hit > 0;
    // Heavy treads
    c.fillStyle = '#1e2430'; rr(c, -18, -23, 36, 9, 3); c.fill(); rr(c, -18, 14, 36, 9, 3); c.fill();
    c.strokeStyle = '#64748b'; c.lineWidth = 1.5;
    const off = (e.anim * 18) % 8;
    c.beginPath();
    for (let i = -18 + off; i < 18; i += 7) { c.moveTo(i, -23); c.lineTo(i, -14); c.moveTo(i, 14); c.lineTo(i, 23); }
    c.stroke();
    // Silver polished chassis
    c.fillStyle = flash ? '#fff' : '#cbd5e1'; rr(c, -16, -16, 32, 32, 5); c.fill();
    c.fillStyle = flash ? '#fff' : '#f1f5f9'; rr(c, -12, -12, 20, 24, 4); c.fill();
    // Golden executive badge
    c.fillStyle = '#f59e0b'; rr(c, -14, -8, 5, 16, 2); c.fill();
    c.strokeStyle = '#fbbf24'; c.lineWidth = 1.2; c.strokeRect(-14, -8, 5, 16);
    // Executive Briefcase attached to side
    c.fillStyle = '#78350f'; rr(c, -6, 17, 18, 10, 2); c.fill();
    c.fillStyle = '#fbbf24'; c.fillRect(-2, 16, 4, 2); c.fillRect(6, 16, 4, 2);
    // Menacing visor
    c.shadowColor = '#e11d48'; c.shadowBlur = 10;
    c.fillStyle = '#f43f5e'; rr(c, 7, -10, 7, 20, 3); c.fill();
    c.shadowBlur = 0;
    c.restore();
    hpBar(c, e, 34);
  }

  function drawCEO(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.ellipse(4, 8, 28, 22, 0, 0, TAU); c.fill();
    c.rotate(e.ang);
    const flash = e.hit > 0;
    // Imposing executive dark suit & gilded gold frame
    c.fillStyle = flash ? '#fff' : '#0f172a'; rr(c, -22, -22, 44, 44, 7); c.fill();
    c.strokeStyle = '#fbbf24'; c.lineWidth = 2.5; c.stroke();
    // White shirt collar & crimson power tie
    c.fillStyle = '#ffffff'; c.fillRect(2, -4, 10, 8);
    c.fillStyle = '#dc2626'; c.beginPath(); c.moveTo(4, -3); c.lineTo(16, 0); c.lineTo(4, 3); c.closePath(); c.fill();
    // Giant Gold Executive Badge
    c.fillStyle = '#f59e0b'; rr(c, -18, -12, 7, 24, 2); c.fill();
    c.strokeStyle = '#fef08a'; c.lineWidth = 1.5; c.strokeRect(-18, -12, 7, 24);
    // Luxury Briefcase
    c.fillStyle = '#451a03'; rr(c, -8, 22, 24, 13, 3); c.fill();
    c.fillStyle = '#fbbf24'; c.fillRect(-4, 20, 6, 3); c.fillRect(8, 20, 6, 3);
    // Golden crown aura / executive visor
    c.shadowColor = '#fbbf24'; c.shadowBlur = 14;
    c.fillStyle = '#fef08a'; rr(c, 11, -12, 8, 24, 3); c.fill();
    c.shadowBlur = 0;
    c.restore();
    hpBar(c, e, 46);
  }

  function drawJanitor(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(2, 4, 17, 14, 0, 0, TAU); c.fill();
    c.rotate(e.ang);
    const flash = e.hit > 0;
    // Janitor work jumpsuit
    c.fillStyle = flash ? '#fff' : '#0284c7'; rr(c, -12, -14, 24, 28, 5); c.fill();
    c.fillStyle = '#38bdf8'; c.fillRect(-4, -12, 8, 24);
    // Cap
    c.fillStyle = '#0369a1'; c.beginPath(); c.arc(-2, 0, 8, 0, TAU); c.fill();
    c.fillStyle = '#0c4a6e'; c.fillRect(2, -6, 6, 12);
    // Yellow mop bucket on tow
    c.fillStyle = '#eab308'; rr(c, -20, -7, 9, 14, 2); c.fill();
    c.strokeStyle = '#ca8a04'; c.lineWidth = 1.2; c.strokeRect(-20, -7, 9, 14);
    // Mop held outward
    c.strokeStyle = '#a16207'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(2, 8); c.lineTo(19, 15); c.stroke();
    // Mop head fibers
    c.fillStyle = '#f1f5f9'; rr(c, 17, 11, 8, 8, 2); c.fill();
    c.restore();
    if (e.hp < e.maxHp) hpBar(c, e, 28);
  }

  function drawDrone(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(5, 12, 11, 7, 0, 0, TAU); c.fill();
    const flash = e.hit > 0;
    c.strokeStyle = '#141b2b'; c.lineWidth = 4; c.lineCap = 'round';
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    c.beginPath(); corners.forEach(k => { c.moveTo(0, 0); c.lineTo(k[0] * 12, k[1] * 12); }); c.stroke();
    corners.forEach((k, i) => {
      const rx = k[0] * 12, ry = k[1] * 12;
      c.fillStyle = 'rgba(170,205,255,0.22)'; c.beginPath(); c.arc(rx, ry, 7.5, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(210,230,255,0.7)'; c.lineWidth = 1.2;
      const a = e.anim * 30 + i;
      c.beginPath(); c.moveTo(rx + Math.cos(a) * 7, ry + Math.sin(a) * 7); c.lineTo(rx - Math.cos(a) * 7, ry - Math.sin(a) * 7); c.stroke();
    });
    c.fillStyle = flash ? '#fff' : '#2a3a5c';
    c.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; c.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); } c.closePath(); c.fill();
    c.strokeStyle = '#ff9d2e'; c.lineWidth = 1.5; c.stroke();
    const ex = Math.cos(e.ang) * 3.5, ey = Math.sin(e.ang) * 3.5;
    c.shadowColor = '#ff9d2e'; c.shadowBlur = e.charge > 0 ? 14 : 6;
    c.fillStyle = e.charge > 0 ? '#ffffff' : '#ff9d2e';
    c.beginPath(); c.arc(ex, ey, e.charge > 0 ? 4.5 : 3.5, 0, TAU); c.fill();
    c.shadowBlur = 0;
    if (e.charge > 0) {
      c.strokeStyle = 'rgba(255,80,40,' + (0.9 - e.charge) + ')'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, 20 * (e.charge / 0.45) + 8, 0, TAU); c.stroke();
    }
    c.restore();
    if (e.hp < e.maxHp) hpBar(c, e);
  }

  function drawHRDirector(c, e, g) {
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(6, 16, 16, 10, 0, 0, TAU); c.fill();
    const flash = e.hit > 0;
    c.strokeStyle = '#3b0764'; c.lineWidth = 5; c.lineCap = 'round';
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    c.beginPath(); corners.forEach(k => { c.moveTo(0, 0); c.lineTo(k[0] * 16, k[1] * 16); }); c.stroke();
    corners.forEach((k, i) => {
      const rx = k[0] * 16, ry = k[1] * 16;
      c.fillStyle = 'rgba(233,213,255,0.3)'; c.beginPath(); c.arc(rx, ry, 9.5, 0, TAU); c.fill();
      c.strokeStyle = '#c084fc'; c.lineWidth = 1.5;
      const a = e.anim * 35 + i;
      c.beginPath(); c.moveTo(rx + Math.cos(a) * 9, ry + Math.sin(a) * 9); c.lineTo(rx - Math.cos(a) * 9, ry - Math.sin(a) * 9); c.stroke();
    });
    // Distinct purple enforcement chassis
    c.fillStyle = flash ? '#fff' : '#581c87';
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); } c.closePath(); c.fill();
    c.strokeStyle = '#a855f7'; c.lineWidth = 2; c.stroke();
    // Purple warning lights
    const ex = Math.cos(e.ang) * 5, ey = Math.sin(e.ang) * 5;
    c.shadowColor = '#c084fc'; c.shadowBlur = e.charge > 0 ? 18 : 8;
    c.fillStyle = (e.charge > 0 || e.burstLeft > 0) ? '#ffffff' : '#c084fc';
    c.beginPath(); c.arc(ex, ey, 5.5, 0, TAU); c.fill();
    c.shadowBlur = 0;
    if (e.charge > 0) {
      c.strokeStyle = 'rgba(192,132,252,' + (1 - e.charge) + ')'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(0, 0, 24 * (e.charge / 0.55) + 10, 0, TAU); c.stroke();
    }
    c.restore();
    hpBar(c, e, 30);
  }

  function hpBar(c, e, customW) {
    const w = customW || 22, x = e.x - w / 2, y = e.y - e.r - 9;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x - 1, y - 1, w + 2, 5);
    c.fillStyle = (e.type === 'ceo') ? '#fbbf24' : (e.type === 'hr_director') ? '#c084fc' : (e.type === 'janitor') ? '#38bdf8' : '#ff4d4d';
    c.fillRect(x, y, w * e.hp / e.maxHp, 3);
  }

  function drawPickup(c, k, g) {
    const t = g.t + k.ph;
    if (k.life < 5 && Math.floor(k.life * 7) % 2 === 0) return;
    const bob = Math.sin(t * 4) * 2;
    const col = k.type === 'staples' ? '255,210,63' : k.type === 'coffee' ? '255,170,110' : '255,150,200';
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    const R = k.type === 'staples' ? 34 + pulse * 6 : 24 + pulse * 4;
    const grad = c.createRadialGradient(k.x, k.y, 2, k.x, k.y, R);
    grad.addColorStop(0, 'rgba(' + col + ',0.55)'); grad.addColorStop(1, 'rgba(' + col + ',0)');
    c.fillStyle = grad; c.beginPath(); c.arc(k.x, k.y, R, 0, TAU); c.fill();
    const ring = (t * 1.2) % 1;
    c.strokeStyle = 'rgba(' + col + ',' + (0.8 * (1 - ring)) + ')'; c.lineWidth = 2;
    c.beginPath(); c.arc(k.x, k.y, 10 + ring * (k.type === 'staples' ? 26 : 16), 0, TAU); c.stroke();
    c.save(); c.translate(k.x, k.y + bob);
    if (k.type === 'staples') {
      c.scale(1.2, 1.2);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(-10, 8, 22, 4);
      c.fillStyle = '#ffd23f'; rr(c, -11, -8, 22, 16, 3); c.fill();
      c.strokeStyle = '#6e4a00'; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#fff1b0'; c.fillRect(-11, -8, 22, 4);
      c.strokeStyle = '#8a8f9c'; c.lineWidth = 2; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(-6, 0); c.lineTo(-6, 5); c.lineTo(6, 5); c.lineTo(6, 0); c.stroke();
    } else if (k.type === 'coffee') {
      c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill();
      c.fillStyle = '#6b3e1e'; c.beginPath(); c.arc(0, 0, 6.5, 0, TAU); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(11, 0, 4, -1.3, 1.3); c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-2, -4); c.quadraticCurveTo(-5, -9 - pulse * 3, -1, -13); c.stroke();
    } else {
      c.fillStyle = '#e0a15f'; c.beginPath(); c.arc(0, 0, 9.5, 0, TAU); c.fill();
      c.fillStyle = '#ff7eb9'; c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
      c.fillStyle = '#2a2a38'; c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill();
      const cs = ['#fff', '#7be0ff', '#ffee70'];
      for (let i = 0; i < 6; i++) { c.fillStyle = cs[i % 3]; c.fillRect(Math.cos(i * 1.05) * 5.6 - 1, Math.sin(i * 1.05) * 5.6 - 0.5, 2.4, 1.2); }
    }
    c.restore();
    if (k.type === 'staples') {
      c.font = 'bold 10px "Trebuchet MS", Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText('STAPLES', k.x, k.y + 22);
      c.fillStyle = '#ffd23f'; c.fillText('STAPLES', k.x, k.y + 22);
    }
  }

  function drawSpawner(c, s) {
    const f = 1 - s.t / s.max;
    c.strokeStyle = 'rgba(255,90,70,' + (0.35 + 0.5 * f) + ')'; c.lineWidth = 2;
    c.beginPath(); c.arc(s.x, s.y, 18 * (1 - f * 0.4), 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,60,40,' + (0.12 + 0.3 * f) + ')'; c.beginPath(); c.arc(s.x, s.y, 16, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,90,70,0.8)'; c.beginPath();
    c.moveTo(s.x - 9, s.y); c.lineTo(s.x + 9, s.y); c.moveTo(s.x, s.y - 9); c.lineTo(s.x, s.y + 9); c.stroke();
  }

  function drawCompass(c, g) {
    const p = g.p;
    if (p.ammo > 5 || g.state !== 'play') return;
    let best = null, bd = 1e9;
    for (const k of g.pickups) if (k.type === 'staples') {
      const d = Math.hypot(k.x - p.x, k.y - p.y); if (d < bd) { bd = d; best = k; }
    }
    if (!best || bd < 70) return;
    const a = Math.atan2(best.y - p.y, best.x - p.x);
    c.save(); c.translate(p.x + Math.cos(a) * 34, p.y + Math.sin(a) * 34); c.rotate(a);
    c.globalAlpha = 0.65 + 0.35 * Math.sin(g.t * 10);
    c.fillStyle = '#ffd23f'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(9, 0); c.lineTo(-5, -7); c.lineTo(-2, 0); c.lineTo(-5, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  function drawCrosshair(c, g) {
    if (!In.hasMouse() || g.state !== 'play' || In.state.fireId !== null) return;
    const x = In.state.mx, y = In.state.my, p = g.p;
    const col = p.ammo === 0 ? '#ff5a5a' : '#ffffff';
    c.strokeStyle = col; c.lineWidth = 1.5; c.globalAlpha = 0.9;
    c.beginPath(); c.arc(x, y, 9, 0, TAU);
    c.moveTo(x - 15, y); c.lineTo(x - 5, y); c.moveTo(x + 5, y); c.lineTo(x + 15, y);
    c.moveTo(x, y - 15); c.lineTo(x, y - 5); c.moveTo(x, y + 5); c.lineTo(x, y + 15); c.stroke();
    c.font = 'bold 12px "Trebuchet MS", Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.8)';
    const txt = p.ammo === 0 ? 'EMPTY' : String(p.ammo);
    c.strokeText(txt, x + 14, y + 14); c.fillStyle = col; c.fillText(txt, x + 14, y + 14);
    c.globalAlpha = 1;
  }

  function render() {
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (!G) {
      c.drawImage(statLayer, 0, 0);
      c.fillStyle = 'rgba(8,10,18,0.6)'; c.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const g = G;
    const sx = g.shake ? rand(-g.shake, g.shake) : 0, sy = g.shake ? rand(-g.shake, g.shake) : 0;
    c.drawImage(statLayer, sx * scale, sy * scale);
    c.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

    g.spawners.forEach(s => drawSpawner(c, s));
    g.pickups.forEach(k => drawPickup(c, k, g));
    g.enemies.forEach(e => {
      if (e.type === 'bot') drawBot(c, e, g);
      else if (e.type === 'evp') drawEVP(c, e, g);
      else if (e.type === 'ceo') drawCEO(c, e, g);
      else if (e.type === 'janitor') drawJanitor(c, e, g);
      else if (e.type === 'hr_director') drawHRDirector(c, e, g);
      else drawDrone(c, e, g);
    });
    drawPlayer(c, g);
    drawCompass(c, g);

    // projectiles
    c.lineCap = 'round';
    for (const b of g.bullets) {
      c.strokeStyle = '#fff6c0'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(b.x - b.dx * 8, b.y - b.dy * 8); c.lineTo(b.x, b.y); c.stroke();
      c.strokeStyle = '#c6cbd8'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(b.x - b.dx * 3 - b.dy * 3, b.y - b.dy * 3 + b.dx * 3); c.lineTo(b.x - b.dx * 3 + b.dy * 3, b.y - b.dy * 3 - b.dx * 3); c.stroke();
    }
    for (const b of g.ebullets) {
      if (b.elite) {
        c.shadowColor = '#c084fc'; c.shadowBlur = 12;
        c.fillStyle = '#e879f9'; c.beginPath(); c.arc(b.x, b.y, 5.5, 0, TAU); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(b.x, b.y, 2.5, 0, TAU); c.fill();
        c.shadowBlur = 0;
      } else {
        c.shadowColor = '#ff6a00'; c.shadowBlur = 10;
        c.fillStyle = '#ffb347'; c.beginPath(); c.arc(b.x, b.y, 4.5, 0, TAU); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(b.x, b.y, 2, 0, TAU); c.fill();
        c.shadowBlur = 0;
      }
    }
    // particles
    for (const q of g.parts) {
      c.globalAlpha = clamp(q.life / q.max, 0, 1);
      c.fillStyle = q.col; c.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    c.globalAlpha = 1;
    // floating text
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const t of g.texts) {
      c.globalAlpha = clamp(t.life / t.max * 1.6, 0, 1);
      c.font = 'bold ' + (t.big ? 15 : 12) + 'px "Trebuchet MS", Arial, sans-serif';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(t.txt, t.x, t.y);
      c.fillStyle = t.col; c.fillText(t.txt, t.x, t.y);
    }
    c.globalAlpha = 1;
    drawCrosshair(c, g);

    // lockdown alarm tint
    if (g.tierIdx >= 5 && g.state === 'play') {
      c.fillStyle = 'rgba(255,0,0,' + (0.03 + 0.04 * Math.sin(g.t * 4)) + ')'; c.fillRect(0, 0, W, H);
    }
    // empty-magazine pulse border
    if (g.p.ammo === 0 && g.state === 'play') {
      c.strokeStyle = 'rgba(255,60,60,' + (0.35 + 0.35 * Math.sin(g.t * 9)) + ')'; c.lineWidth = 8;
      c.strokeRect(4, 4, W - 8, H - 8);
    }
    if (g.flash > 0) { c.fillStyle = 'rgba(255,30,30,' + g.flash * 0.45 + ')'; c.fillRect(0, 0, W, H); }
  }

  /* ---------------- Main loop ---------------- */
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (G && (mode === 'play' || mode === 'over')) update(dt);
    render();
    updateHud();
  }

  function resize() {
    const stage = canvas.parentElement.getBoundingClientRect();
    const s = Math.min(stage.width / W, stage.height / H);
    if (!isFinite(s) || s <= 0) return;
    const cw = Math.floor(W * s), ch = Math.floor(H * s);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    scale = canvas.width / W;
    renderStatic();
  }

  /* ---------------- Public API ---------------- */
  function start() {
    Snd.resume();
    Snd.stopSpeech();
    G = newGame();
    Object.keys(hudCache).forEach(k => delete hudCache[k]);
    M.flowFrom(G.p.x, G.p.y, flow);
    mode = 'play';
    In.reset();
    document.body.classList.add('playing');
    el.caption.classList.remove('show');
    el.announce.classList.remove('show');
    Snd.sfx.start();
    Snd.musicStart(() => (G ? G.t : 0));
    // two opening bots so there is immediate action
    queueEnemy(G, 'bot'); queueEnemy(G, 'bot');
    G.spawners.forEach((s, i) => s.t = s.max = 1.6 + i * 1.5);
  }
  function pause() {
    if (mode !== 'play') return false;
    mode = 'pause'; Snd.musicStop(); Snd.stopSpeech(); In.reset();
    document.body.classList.remove('playing');
    return true;
  }
  function resume() {
    if (mode !== 'pause') return false;
    mode = 'play'; Snd.resume(); Snd.musicStart(() => (G ? G.t : 0)); lastTs = performance.now();
    document.body.classList.add('playing');
    return true;
  }
  function quit() {
    mode = 'menu'; G = null; Snd.musicStop(); Snd.stopSpeech(); In.reset();
    document.body.classList.remove('playing');
    el.caption.classList.remove('show'); el.announce.classList.remove('show');
    resetHud();
    Object.keys(hudCache).forEach(k => delete hudCache[k]);
    ['hudScore', 'hudTime', 'hudAmmo', 'hudEnemies'].forEach(id => { document.getElementById(id).textContent = id === 'hudTime' ? '00:00' : '0'; });
    el.hp.style.width = '100%';
    el.ammoBox.classList.remove('empty', 'low');
  }

  AH.Game = {
    start, pause, resume, quit, resize,
    getMode: () => mode, getHigh: () => hiScore,
    onGameOver: null
  };

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 150); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && mode === 'play') AH.Game.onAutoPause && AH.Game.onAutoPause(); });
  window.addEventListener('blur', function () { if (mode === 'play') AH.Game.onAutoPause && AH.Game.onAutoPause(); });

  resize();
  resetHud();
  requestAnimationFrame(frame);
})();
