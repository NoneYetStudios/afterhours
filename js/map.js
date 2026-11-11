/* After Hours - office floor map, collision, line of sight and path flow field. */
(function () {
  'use strict';
  window.AH = window.AH || {};

  const COLS = 32, ROWS = 23, T = 32;
  const FLOOR = 0, WALL = 1, FURN = 2, CUBE = 3, RACK = 4;
  const grid = new Uint8Array(COLS * ROWS);
  const tint = new Int8Array(COLS * ROWS).fill(-1);
  const rooms = [];

  function set(x, y, v) { if (x >= 0 && y >= 0 && x < COLS && y < ROWS) grid[y * COLS + x] = v; }
  function rect(x, y, w, h, v) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, v); }
  function box(x, y, w, h) {
    for (let i = 0; i < w; i++) { set(x + i, y, WALL); set(x + i, y + h - 1, WALL); }
    for (let j = 0; j < h; j++) { set(x, y + j, WALL); set(x + w - 1, y + j, WALL); }
  }
  function room(name, x, y, w, h, color, doors, furn, furnType) {
    box(x, y, w, h);
    doors.forEach(d => set(d[0], d[1], FLOOR));
    (furn || []).forEach(f => rect(f[0], f[1], f[2], f[3], furnType || FURN));
    rooms.push({ name, x, y, w, h, color, walled: true });
  }

  box(0, 0, COLS, ROWS);

  room('OFFICE 201', 2, 2, 7, 5, '#2c3a57', [[4, 6], [5, 6]], [[4, 4, 2, 1]]);
  room('CONFERENCE B', 11, 2, 10, 5, '#35304f', [[13, 6], [14, 6], [17, 6], [18, 6]], [[14, 4, 4, 1]]);
  room('OFFICE 202', 23, 2, 7, 5, '#2c3a57', [[25, 6], [26, 6]], [[25, 4, 2, 1]]);

  room('BREAK ROOM', 2, 9, 7, 6, '#2b4a40', [[8, 11], [8, 12], [4, 9], [5, 9]], [[4, 11, 2, 2]]);
  room('OFFICE 203', 23, 9, 7, 6, '#2c3a57', [[23, 11], [23, 12], [26, 14], [27, 14]], [[26, 11, 2, 2]]);

  room('OFFICE 204', 2, 17, 7, 5, '#2c3a57', [[4, 17], [5, 17]], [[4, 19, 3, 1]]);
  room('SERVER ROOM', 11, 17, 10, 5, '#1f3b40', [[15, 17], [16, 17]], [[13, 19, 2, 1], [17, 19, 2, 1]], RACK);
  room('OFFICE 205', 23, 17, 7, 5, '#2c3a57', [[25, 17], [26, 17]], [[25, 19, 3, 1]]);

  // Open-plan cubicle farm (no outer walls; partitions only).
  [[12, 10, 3, 1], [12, 13, 3, 1], [14, 11, 1, 2],
   [17, 10, 3, 1], [17, 13, 3, 1], [17, 11, 1, 2]].forEach(r => rect(r[0], r[1], r[2], r[3], CUBE));
  rooms.push({ name: 'CUBICLE FARM', x: 11, y: 9, w: 10, h: 6, color: '#2d3a4a', walled: false });

  rooms.forEach((r, i) => {
    const x0 = r.walled ? r.x + 1 : r.x, y0 = r.walled ? r.y + 1 : r.y;
    const x1 = r.walled ? r.x + r.w - 1 : r.x + r.w, y1 = r.walled ? r.y + r.h - 1 : r.y + r.h;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) tint[y * COLS + x] = i;
  });

  function solid(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
    return grid[ty * COLS + tx] !== FLOOR;
  }
  function solidPx(x, y) { return solid(Math.floor(x / T), Math.floor(y / T)); }

  function collides(x, y, r) {
    const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T);
    const y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solid(tx, ty)) continue;
        const cx = Math.max(tx * T, Math.min(x, tx * T + T));
        const cy = Math.max(ty * T, Math.min(y, ty * T + T));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  function los(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 6);
    for (let i = 1; i < n; i++) {
      if (solidPx(x1 + dx * i / n, y1 + dy * i / n)) return false;
    }
    return true;
  }

  // Player start: centre aisle of the cubicle farm.
  const start = { x: 16 * T, y: 11.5 * T };

  // Reachable floor tiles (flood fill from the start) so nothing ever spawns in a sealed pocket.
  const reach = new Uint8Array(COLS * ROWS);
  const floorTiles = [];
  (function () {
    const q = [[16, 11]]; reach[11 * COLS + 16] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const nx = x + d[0], ny = y + d[1];
        if (!solid(nx, ny) && !reach[ny * COLS + nx]) { reach[ny * COLS + nx] = 1; q.push([nx, ny]); }
      });
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (reach[y * COLS + x]) floorTiles.push({ tx: x, ty: y });
  })();

  const queue = new Int16Array(COLS * ROWS);
  // BFS distance field from a pixel position (4-connected). Unreachable = -1.
  function flowFrom(px, py, dist) {
    dist.fill(-1);
    const sx = Math.floor(px / T), sy = Math.floor(py / T);
    if (solid(sx, sy)) return;
    let head = 0, tail = 0;
    dist[sy * COLS + sx] = 0; queue[tail++] = sy * COLS + sx;
    while (head < tail) {
      const i = queue[head++], x = i % COLS, y = (i / COLS) | 0, d = dist[i] + 1;
      if (x > 0 && !solid(x - 1, y) && dist[i - 1] < 0) { dist[i - 1] = d; queue[tail++] = i - 1; }
      if (x < COLS - 1 && !solid(x + 1, y) && dist[i + 1] < 0) { dist[i + 1] = d; queue[tail++] = i + 1; }
      if (y > 0 && !solid(x, y - 1) && dist[i - COLS] < 0) { dist[i - COLS] = d; queue[tail++] = i - COLS; }
      if (y < ROWS - 1 && !solid(x, y + 1) && dist[i + COLS] < 0) { dist[i + COLS] = d; queue[tail++] = i + COLS; }
    }
  }

  AH.Map = {
    COLS, ROWS, T, W: COLS * T, H: ROWS * T,
    FLOOR, WALL, FURN, CUBE, RACK,
    grid, tint, rooms, reach, floorTiles, start,
    solid, solidPx, collides, los, flowFrom
  };
})();
