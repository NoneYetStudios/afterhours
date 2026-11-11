/* After Hours - menus, leaderboard client, game-over flow. */
(function () {
  'use strict';
  const CFG = AH.CONFIG, Game = AH.Game, Snd = AH.Audio;
  const $ = id => document.getElementById(id);
  const screens = ['menu', 'how', 'board', 'pause', 'over'];
  let current = 'menu', boardReturn = 'menu', lastResult = null, submitted = false, highlight = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function fmtTime(s) { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

  $('backBtn').href = CFG.ARCADE_URL;

  function show(name) {
    current = name;
    screens.forEach(s => $('screen-' + s).classList.toggle('active', s === name));
    if (name === 'menu') {
      $('menuHi').textContent = Game.getHigh();
      if ($('menuTipText') && AH.Lore) $('menuTipText').textContent = AH.Lore.getRandomTip();
    }
  }
  function hideAll() { current = 'none'; screens.forEach(s => $('screen-' + s).classList.remove('active')); }

  function play() { Snd.resume(); hideAll(); Game.start(); }

  /* ---------- Toggles ---------- */
  function syncToggles() {
    $('btnSound').classList.toggle('off', !Snd.sfxOn);
    $('btnVoice').classList.toggle('off', !Snd.voiceOn);
  }
  function toggleSound() { Snd.resume(); Snd.setSfx(!Snd.sfxOn); syncToggles(); }
  function toggleVoice() { Snd.setVoice(!Snd.voiceOn); syncToggles(); }
  $('btnSound').addEventListener('click', function () { toggleSound(); this.blur(); });
  $('btnVoice').addEventListener('click', function () { toggleVoice(); this.blur(); });
  syncToggles();

  /* ---------- Pause ---------- */
  function pause() { if (Game.pause()) show('pause'); }
  function resume() { if (Game.resume()) hideAll(); }
  Game.onAutoPause = pause;
  $('btnPause').addEventListener('click', function () { this.blur(); if (Game.getMode() === 'play') pause(); else if (Game.getMode() === 'pause') resume(); });
  $('btnResume').addEventListener('click', resume);
  $('btnQuit').addEventListener('click', function () { Game.quit(); show('menu'); });

  /* ---------- Menu wiring ---------- */
  $('btnPlay').addEventListener('click', play);
  $('btnHow').addEventListener('click', function () { show('how'); });
  $('btnHowPlay').addEventListener('click', play);
  $('btnHowBack').addEventListener('click', function () { show('menu'); });
  $('btnBoard').addEventListener('click', function () { boardReturn = 'menu'; openBoard(); });
  $('btnBoardPlay').addEventListener('click', play);
  $('btnBoardRefresh').addEventListener('click', loadBoard);
  $('btnBoardBack').addEventListener('click', function () { highlight = null; show(boardReturn); });
  $('btnAgain').addEventListener('click', function () { Game.quit(); play(); });
  $('btnOverBoard').addEventListener('click', function () { boardReturn = 'over'; openBoard(); });
  $('btnOverMenu').addEventListener('click', function () { Game.quit(); show('menu'); });

  window.addEventListener('keydown', function (e) {
    const typing = e.target && e.target.tagName === 'INPUT';
    if (e.code === 'KeyM' && !typing) toggleSound();
    else if (e.code === 'KeyV' && !typing) toggleVoice();
    else if ((e.code === 'Escape' || e.code === 'KeyP') && !typing) {
      const m = Game.getMode();
      if (m === 'play') pause(); else if (m === 'pause') resume();
      else if (current === 'how' || current === 'board') $(current === 'how' ? 'btnHowBack' : 'btnBoardBack').click();
    } else if (e.code === 'Enter' && !typing && current === 'menu') play();
  });

  /* ---------- Icons for the handbook ---------- */
  function drawIcons() {
    const TAU = Math.PI * 2;
    function ctxOf(id) { const c = $(id).getContext('2d'); c.clearRect(0, 0, 48, 48); c.save(); c.translate(24, 24); return c; }
    function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    let c = ctxOf('icoBot'); c.scale(1.4, 1.4);
    c.fillStyle = '#262b36'; rr(c, -12, -15, 24, 6, 2); c.fill(); rr(c, -12, 9, 24, 6, 2); c.fill();
    c.fillStyle = '#8e9bb0'; rr(c, -11, -11, 22, 22, 4); c.fill();
    c.fillStyle = '#c4cddb'; rr(c, -8, -8, 13, 16, 3); c.fill();
    c.fillStyle = '#ff3535'; rr(c, 5, -7, 5, 14, 2); c.fill(); c.restore();

    c = ctxOf('icoDrone'); c.scale(1.2, 1.2);
    c.strokeStyle = '#141b2b'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(k => { c.moveTo(0, 0); c.lineTo(k[0] * 12, k[1] * 12); }); c.stroke();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(k => { c.fillStyle = 'rgba(170,205,255,0.35)'; c.beginPath(); c.arc(k[0] * 12, k[1] * 12, 7.5, 0, TAU); c.fill(); });
    c.fillStyle = '#2a3a5c'; c.beginPath(); for (let i = 0; i < 6; i++) c.lineTo(Math.cos(i * TAU / 6) * 9, Math.sin(i * TAU / 6) * 9); c.closePath(); c.fill();
    c.strokeStyle = '#ff9d2e'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#ff9d2e'; c.beginPath(); c.arc(3, 0, 3.5, 0, TAU); c.fill(); c.restore();

    c = ctxOf('icoStaple'); c.scale(1.5, 1.5);
    c.fillStyle = '#ffd23f'; rr(c, -11, -8, 22, 16, 3); c.fill(); c.strokeStyle = '#6e4a00'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#fff1b0'; c.fillRect(-11, -8, 22, 4);
    c.strokeStyle = '#8a8f9c'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, 0); c.lineTo(-6, 5); c.lineTo(6, 5); c.lineTo(6, 0); c.stroke(); c.restore();

    c = ctxOf('icoCoffee'); c.scale(1.5, 1.5);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill();
    c.fillStyle = '#6b3e1e'; c.beginPath(); c.arc(0, 0, 6.5, 0, TAU); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(11, 0, 4, -1.3, 1.3); c.stroke(); c.restore();

    c = ctxOf('icoDonut'); c.scale(1.6, 1.6);
    c.fillStyle = '#e0a15f'; c.beginPath(); c.arc(0, 0, 9.5, 0, TAU); c.fill();
    c.fillStyle = '#ff7eb9'; c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
    c.fillStyle = '#232a3c'; c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill(); c.restore();
  }
  drawIcons();

  /* ---------- Leaderboard ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  /* ---------- Leaderboard Storage (Server + Local Fallback) ---------- */
  const LOCAL_SCORES_KEY = 'ah_local_scores_v1';
  let serverAvailable = null; // null = untried, true = php ok, false = fallback local

  function getLocalScores() {
    try {
      const raw = localStorage.getItem(LOCAL_SCORES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalScores(list) {
    try {
      localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(list));
    } catch (e) { }
  }

  function submitLocalScore(name, score, time) {
    let list = getLocalScores();
    const nameKey = name.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const existingIndex = list.findIndex(e => (e.name || '').toLowerCase() === nameKey);
    let status = 'new';
    let record = { name, score, survival_time: time, created_at: now };

    if (existingIndex >= 0) {
      const existing = list[existingIndex];
      if (score > existing.score) {
        list[existingIndex] = record;
        status = 'improved';
      } else if (score === existing.score && time === existing.survival_time) {
        status = 'duplicate';
        record = existing;
      } else {
        status = 'not_improved';
        record = existing;
      }
    } else {
      list.push(record);
      status = 'new';
    }

    // Sort: score desc, time desc, created_at asc
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.survival_time !== a.survival_time) return b.survival_time - a.survival_time;
      return (a.created_at || 0) - (b.created_at || 0);
    });

    if (list.length > 100) list = list.slice(0, 100);
    saveLocalScores(list);

    const rank = list.findIndex(e => (e.name || '').toLowerCase() === nameKey) + 1;
    return { ok: true, status, rank: rank || 1 };
  }

  function renderTableRows(entries) {
    const body = $('boardBody');
    body.innerHTML = entries.map(e => {
      const me = highlight && e.name.toLowerCase() === highlight.toLowerCase();
      const cls = (me ? 'me ' : '') + (e.rank <= 3 ? 'top' + e.rank : '');
      const date = e.created_at ? new Date(e.created_at * 1000).toLocaleDateString() : '';
      return '<tr class="' + cls + '"><td>' + e.rank + '</td><td>' + esc(e.name) + '</td><td>' +
        Number(e.score).toLocaleString() + '</td><td>' + fmtTime(e.survival_time) + '</td><td class="hide-sm">' + esc(date) + '</td></tr>';
    }).join('');
  }

  function renderLocalBoard() {
    const notice = $('boardModeNotice');
    if (notice) notice.textContent = 'Local leaderboard active.';
    const list = getLocalScores();
    const msg = $('boardMsg');
    const body = $('boardBody');
    if (!list.length) {
      msg.textContent = 'No local scores yet. Be the first employee on the board!';
      body.innerHTML = '';
      return;
    }
    msg.textContent = '';
    const slice = list.slice(0, CFG.LEADERBOARD_SIZE).map((e, idx) => Object.assign({ rank: idx + 1 }, e));
    renderTableRows(slice);
  }

  function openBoard() {
    if ($('boardTitle') && AH.Lore) $('boardTitle').textContent = AH.Lore.getRandomBoardTitle();
    if ($('boardTipText') && AH.Lore) $('boardTipText').textContent = AH.Lore.getRandomTip();
    show('board');
    loadBoard();
  }

  function loadBoard() {
    const body = $('boardBody'), msg = $('boardMsg'), notice = $('boardModeNotice');
    msg.textContent = 'Loading…'; body.innerHTML = '';
    if (notice) notice.textContent = '';

    fetch(CFG.API_LEADERBOARD + '?limit=' + CFG.LEADERBOARD_SIZE + '&_=' + Date.now(), { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) throw new Error('Not JSON');
        return r.json();
      })
      .then(d => {
        if (!d || !d.ok) throw new Error((d && d.error) || 'Bad response');
        serverAvailable = true;
        if (notice) notice.textContent = '';
        if (!d.entries.length) { msg.textContent = 'No scores yet. Be the first employee on the board!'; return; }
        msg.textContent = '';
        renderTableRows(d.entries);
      })
      .catch(() => {
        // Automatically activate local development mode
        serverAvailable = false;
        renderLocalBoard();
      });
  }

  /* ---------- Game over + score submission ---------- */
  function cleanName(s) { return s.replace(/[^A-Za-z0-9 _.\-!?]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12); }

  Game.onGameOver = function (r) {
    lastResult = r; submitted = false;
    $('goScore').textContent = r.score.toLocaleString();
    $('goTime').textContent = fmtTime(r.time);
    $('goKills').textContent = r.kills;
    $('newHigh').classList.toggle('show', r.newHigh);
    if (r.newHigh && $('newHigh') && AH.Lore) {
      $('newHigh').textContent = AH.Lore.getRandomPersonalBest();
    }
    if ($('overTipText') && AH.Lore) $('overTipText').textContent = AH.Lore.getRandomTip();
    if ($('btnAgain') && AH.Lore) $('btnAgain').textContent = '▶ ' + AH.Lore.getRandomRestartPhrase();
    if ($('badgeCaption') && AH.Lore) $('badgeCaption').textContent = AH.Lore.getRandomBadgeCaption();
    const msg = $('submitMsg'); msg.textContent = ''; msg.className = 'submit-msg';
    $('btnSubmit').disabled = false; $('btnSubmit').textContent = 'SUBMIT';
    $('nameInput').value = cleanName(lsGet('ah_name') || '');
    $('nameInput').disabled = false;
    show('over');
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => { if (current === 'over') $('nameInput').focus(); }, 900);
  };

  $('nameInput').addEventListener('input', function () {
    const pos = this.selectionStart;
    const v = this.value.replace(/[^A-Za-z0-9 _.\-!?]/g, '');
    if (v !== this.value) { this.value = v; this.setSelectionRange(pos - 1, pos - 1); }
  });

  function completeSubmissionSuccess(d, name) {
    const msg = $('submitMsg'), btn = $('btnSubmit');
    highlight = name;
    const txt = {
      new: 'Score filed! You are ranked #' + d.rank + '.',
      improved: 'New best for ' + name + '! You are ranked #' + d.rank + '.',
      not_improved: 'Already on file with a higher score (rank #' + d.rank + ').',
      duplicate: 'This score is already on file (rank #' + d.rank + ').'
    }[d.status] || 'Score filed. Rank #' + d.rank + '.';
    msg.className = 'submit-msg ok';
    msg.textContent = (serverAvailable === false ? '[Local Mode] ' : '') + txt;
    submitted = true;
    btn.textContent = 'SUBMITTED';
    $('nameInput').disabled = true;
    setTimeout(function () { if (current === 'over') { boardReturn = 'over'; openBoard(); } }, 1200);
  }

  $('submitForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!lastResult || submitted) return;
    const msg = $('submitMsg'), name = cleanName($('nameInput').value);
    if (!name) { msg.className = 'submit-msg err'; msg.textContent = 'Please enter a name (letters, numbers, spaces).'; return; }
    lsSet('ah_name', name);
    const btn = $('btnSubmit'); btn.disabled = true; btn.textContent = '…';
    msg.className = 'submit-msg'; msg.textContent = 'Filing paperwork…';

    // If server was already found unavailable, immediately use local mode
    if (serverAvailable === false) {
      const res = submitLocalScore(name, lastResult.score, lastResult.time);
      completeSubmissionSuccess(res, name);
      return;
    }

    fetch(CFG.API_SUBMIT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ name: name, score: lastResult.score, time: lastResult.time })
    })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') === -1) throw new Error('Not JSON');
        return r.json();
      })
      .then(d => {
        if (!d.ok) throw new Error(d.error || 'Submission failed');
        serverAvailable = true;
        completeSubmissionSuccess(d, name);
      })
      .catch(() => {
        // Automatic fallback: server API unavailable, store locally without displaying error
        serverAvailable = false;
        const res = submitLocalScore(name, lastResult.score, lastResult.time);
        completeSubmissionSuccess(res, name);
      });
  });

  if ($('menuSubtitle') && AH.Lore) $('menuSubtitle').textContent = AH.Lore.getRandomSubtitle();
  show('menu');
})();
