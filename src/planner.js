import { CELL_CM } from './grid.js';

const SOFT_CELLS = 4; // prefer paths ~20 cm away from obstacles beyond the hard limit
const EPS = 1e-6;

// Compute which cells the user can occupy: not blocked by a tall-enough
// obstacle, and far enough from every blocked cell to fit body/chair + margin.
export function analyze(grid, s) {
  const { cols, rows } = grid;
  const n = cols * rows;
  const blocked = new Uint8Array(n);
  for (let i = 0; i < n; i++) blocked[i] = grid.h[i] > s.maxStepCm ? 1 : 0;

  const reqCells = (s.halfWidthCm + s.marginCm) / CELL_CM;
  const softCells = reqCells + SOFT_CELLS;
  const R = Math.ceil(softCells) + 1;
  const dist = new Float32Array(n).fill(1e9);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!blocked[r * cols + c]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const nr = r + dy;
        if (nr < 0 || nr >= rows) continue;
        for (let dx = -R; dx <= R; dx++) {
          const nc = c + dx;
          if (nc < 0 || nc >= cols) continue;
          const d = Math.hypot(dx, dy);
          const k = nr * cols + nc;
          if (d < dist[k]) dist[k] = d;
        }
      }
    }
  }
  const passable = new Uint8Array(n);
  for (let i = 0; i < n; i++) passable[i] = !blocked[i] && dist[i] - 0.5 >= reqCells - EPS ? 1 : 0;
  return { blocked, dist, passable, reqCells, softCells };
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  push(f, v) {
    const a = this.a;
    a.push([f, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

function lineOfSight(grid, passable, c0, r0, c1, r1, skipStart = false) {
  let dx = Math.abs(c1 - c0);
  let dy = Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1;
  const sy = r0 < r1 ? 1 : -1;
  let err = dx - dy;
  let c = c0;
  let r = r0;
  for (;;) {
    if (!(skipStart && c === c0 && r === r0) && !passable[r * grid.cols + c]) return false;
    if (c === c1 && r === r1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      c += sx;
    }
    if (e2 < dx) {
      err += dx;
      r += sy;
    }
  }
}

// Plan from `start` to `goal` (both {x,y} in cm). Waypoints are cell centers in cm.
export function plan(grid, s, start, goal, analysis = analyze(grid, s)) {
  const { cols, rows } = grid;
  const { passable, dist, softCells } = analysis;
  const a = grid.cellOf(start.x, start.y);
  const b = grid.cellOf(goal.x, goal.y);
  if (!grid.inBounds(a.c, a.r)) return { ok: false, reason: 'start_out' };
  if (!grid.inBounds(b.c, b.r) || !passable[b.r * cols + b.c]) return { ok: false, reason: 'goal_blocked' };

  const startI = a.r * cols + a.c;
  const goalI = b.r * cols + b.c;
  const g = new Float32Array(cols * rows).fill(Infinity);
  const from = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const heap = new MinHeap();
  const h = (c, r) => Math.hypot(c - b.c, r - b.r);
  g[startI] = 0;
  heap.push(h(a.c, a.r), startI);

  const nb = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  while (heap.size) {
    const [, cur] = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalI) break;
    const cc = cur % cols;
    const cr = (cur / cols) | 0;
    for (const [dx, dy] of nb) {
      const nc = cc + dx;
      const nr = cr + dy;
      if (!grid.inBounds(nc, nr)) continue;
      const ni = nr * cols + nc;
      if (!passable[ni] || closed[ni]) continue;
      if (dx && dy && (!passable[cr * cols + nc] || !passable[nr * cols + cc])) continue; // no corner cutting
      const soft = Math.max(0, softCells - dist[ni]) * 0.3;
      const ng = g[cur] + (dx && dy ? Math.SQRT2 : 1) + soft;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        heap.push(ng + h(nc, nr), ni);
      }
    }
  }
  if (from[goalI] === -1 && startI !== goalI) return { ok: false, reason: 'no_route' };

  const cells = [];
  for (let i = goalI; i !== -1; i = from[i]) cells.push({ c: i % cols, r: (i / cols) | 0 });
  cells.reverse();

  // String-pulling: keep only the corners that the clearance-inflated map requires.
  const pts = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineOfSight(grid, passable, cells[i].c, cells[i].r, cells[j].c, cells[j].r)) j--;
    pts.push(cells[j]);
    i = j;
  }
  const waypoints = pts.slice(1).map((p) => grid.centerOf(p.c, p.r));
  let lengthCm = 0;
  let prev = start;
  for (const w of waypoints) {
    lengthCm += Math.hypot(w.x - prev.x, w.y - prev.y);
    prev = w;
  }
  return { ok: true, waypoints, lengthCm };
}

// Is the remaining route still free after the map changed?
export function routeIsClear(grid, analysis, pose, waypoints) {
  let prev = grid.cellOf(pose.x, pose.y);
  let first = true;
  for (const w of waypoints) {
    const c = grid.cellOf(w.x, w.y);
    // The cell the user stands on is exempt: they are already there.
    if (!lineOfSight(grid, analysis.passable, prev.c, prev.r, c.c, c.r, first)) return false;
    prev = c;
    first = false;
  }
  return true;
}
