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

// The map frame is tied to something the user can find again, because ARCore starts every
// session with a new, arbitrary world frame:
//   'marker': a printed image on a wall. Its position is map `home`; its outward normal
//             points to MARKER_HEADING on the map (the room extends away from the wall).
//   'start' : no marker. The user stands at `home` facing `home.heading` and confirms.
// A saved map remembers which kind it uses (`expected`) and refuses the other one.
export const MARKER_HEADING = 180;

export class Aligner {
  constructor(home, expected = null) {
    this.home = home;
    this.expected = expected;
    this.ready = false;
    this.kind = null;
  }

  static headingOf(f) {
    return (Math.atan2(f.fx, -f.fz) * 180) / Math.PI;
  }

  canUse(kind) {
    return this.expected === null || this.expected === kind;
  }

  // f: { x, z, fx, fz } camera position and horizontal forward vector in ARCore world.
  startFromCamera(f) {
    if (!this.canUse('start')) return false;
    this._pin(f.x, f.z, this.home.heading - Aligner.headingOf(f), 'start');
    return true;
  }

  // m: { x, z, nx, nz } marker centre and horizontal outward normal in ARCore world.
  startFromMarker(m) {
    if (!this.canUse('marker')) return false;
    this._pin(m.x, m.z, MARKER_HEADING - Aligner.headingOf({ fx: m.nx, fz: m.nz }), 'marker');
    return true;
  }

  _pin(x, z, delta, kind) {
    this.x0 = x;
    this.z0 = z;
    this.delta = delta;
    this.kind = kind;
    this.expected = kind;
    this.ready = true;
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
// `anchored` is set on the frame where the map frame was (re)pinned to a marker.
export function handleFrame({ f, nav, aligner, pointMap, now }) {
  const loc = trackingToLocalization(f.tracking);
  let anchored = null;
  // A marker in view pins the map frame. Once guidance is running, only re-pin while
  // stopped: a sudden shift of the map under a walking user is worse than some drift.
  if (f.marker && loc === TRACKING_OK && (!aligner.ready || nav.state !== 'navigating')) {
    if (aligner.startFromMarker(f.marker)) {
      anchored = 'marker';
      nav.needsRelocalize = false;
    }
  }
  if (!aligner.ready) return { pose: null, events: [], anchored };
  const pose = aligner.pose(f);
  const events = [];
  if (loc === TRACKING_OK && f.points?.length && f.floorY != null) {
    const rects = pointMap.ingest(f.points, f.floorY, pose);
    if (rects.length) events.push(...nav.addObstacles(rects, pose, now));
  }
  events.push(...nav.update(pose, { localization: loc, now }));
  return { pose, events, anchored };
}
