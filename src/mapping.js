// ARCore -> room map. ARCore reports points and the camera pose in its own world
// frame (metres, y up, arbitrary origin and heading). This module aligns that
// frame to the saved map and turns feature points into obstacle cells.
import { CELL_CM } from './grid.js';
import { normalizeAngle } from './guidance.js';

export const TRACKING_OK = 1;
export const TRACKING_PAUSED = 0.3; // below session.js LOC_MIN, so navigation halts

export function trackingToLocalization(state) {
  if (state === 'TRACKING') return TRACKING_OK;
  if (state === 'PAUSED') return TRACKING_PAUSED;
  return 0;
}

// Maps ARCore world coordinates onto the saved map. The first tracked frame is
// pinned to `home` ({x, y, heading} in map cm/deg): the user starts each session
// standing at the saved home spot, facing the saved direction.
export class Aligner {
  constructor(home) {
    this.home = home;
    this.ready = false;
  }

  // f: { x, z, fx, fz } camera position and horizontal forward vector in ARCore world.
  start(f) {
    this.x0 = f.x;
    this.z0 = f.z;
    this.delta = this.home.heading - Aligner.headingOf(f);
    this.ready = true;
  }

  static headingOf(f) {
    return (Math.atan2(f.fx, -f.fz) * 180) / Math.PI;
  }

  point(x, z) {
    const a = (this.delta * Math.PI) / 180;
    const dx = (x - this.x0) * 100;
    const dy = (z - this.z0) * 100;
    return {
      x: this.home.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: this.home.y + dx * Math.sin(a) + dy * Math.cos(a),
    };
  }

  pose(f) {
    const p = this.point(f.x, f.z);
    return { x: p.x, y: p.y, heading: ((normalizeAngle(Aligner.headingOf(f) + this.delta) % 360) + 360) % 360 };
  }
}

// Votes feature points into grid cells. A cell becomes an obstacle after `minHits`
// points above the floor, which filters single noisy points.
export class PointMap {
  constructor(grid, aligner, opts = {}) {
    this.grid = grid;
    this.aligner = aligner;
    this.minHits = opts.minHits ?? 3;
    this.floorTolCm = opts.floorTolCm ?? 8; // cannot see thresholds below this with feature points
    this.maxHeightCm = opts.maxHeightCm ?? 190; // ignore the ceiling
    this.rangeCm = opts.rangeCm ?? 400;
    this.hits = new Uint8Array(grid.cols * grid.rows);
    this.top = new Float32Array(grid.cols * grid.rows);
  }

  // points: flat [x, y, z, ...] in ARCore metres. Returns rects for newly occupied cells.
  ingest(points, floorY, pose) {
    const rects = [];
    const g = this.grid;
    for (let i = 0; i + 2 < points.length; i += 3) {
      const hCm = (points[i + 1] - floorY) * 100;
      if (hCm < this.floorTolCm || hCm > this.maxHeightCm) continue;
      const p = this.aligner.point(points[i], points[i + 2]);
      if (Math.hypot(p.x - pose.x, p.y - pose.y) > this.rangeCm) continue;
      const { c, r } = g.cellOf(p.x, p.y);
      if (!g.inBounds(c, r)) continue;
      const k = g.idx(c, r);
      if (this.hits[k] < 255) this.hits[k]++;
      if (hCm > this.top[k]) this.top[k] = hCm;
      if (this.hits[k] === this.minHits && g.h[k] < this.top[k]) {
        rects.push({ x0: c * CELL_CM, y0: r * CELL_CM, x1: (c + 1) * CELL_CM, y1: (r + 1) * CELL_CM, height: this.top[k] });
      }
    }
    return rects;
  }
}

// One ARCore frame in, navigation events out.
export function handleFrame({ f, nav, aligner, pointMap, now }) {
  const loc = trackingToLocalization(f.tracking);
  if (!aligner.ready) {
    if (f.tracking !== 'TRACKING') return { pose: null, events: [] };
    aligner.start(f);
  }
  const pose = aligner.pose(f);
  const events = [];
  if (loc === TRACKING_OK && f.points?.length && f.floorY != null) {
    const rects = pointMap.ingest(f.points, f.floorY, pose);
    if (rects.length) events.push(...nav.addObstacles(rects, pose, now));
  }
  events.push(...nav.update(pose, { localization: loc, now }));
  return { pose, events };
}
