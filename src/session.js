// Navigation session: ties planner, guidance and safety rules together.
// Core safety rule: when the system is not sure, it says so and stops.
import { analyze, plan, routeIsClear } from './planner.js';
import { instruction, hapticFor, relativeBearing, clockHour, roundMeters, strings, HAPTIC } from './guidance.js';

export const LOC_MIN = 0.6; // below this localization confidence, navigation halts
const WP_TOL_CM = 30;
const GOAL_TOL_CM = 30;
const HAPTIC_EVERY_MS = 800;
const REPEAT_OFF_COURSE_MS = 3000;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Navigator {
  constructor({ grid, destinations, settings }) {
    this.grid = grid;
    this.destinations = destinations;
    this.settings = settings;
    this.state = 'idle'; // idle | navigating | stopped | arrived
    this.reason = null;
    this.waypoints = [];
    this.dest = null;
    this.needsRelocalize = false;
    this._announced = null;
    this._lastSay = -Infinity;
    this._lastHaptic = -Infinity;
    this.pose = null;
  }

  get t() {
    return strings(this.settings.lang);
  }

  destName(d) {
    return d.names[this.settings.lang]?.[0] ?? d.names.mk[0];
  }

  _halt(reason, say, haptic) {
    this.state = 'stopped';
    this.reason = reason;
    const ev = [{ type: 'say', text: say }];
    if (haptic) ev.push({ type: 'haptic', pattern: haptic, side: 'lost' });
    ev.push({ type: 'state', state: this.state, reason });
    return ev;
  }

  _plan(pose) {
    this.analysis = analyze(this.grid, this.settings);
    return plan(this.grid, this.settings, pose, this.dest.pos, this.analysis);
  }

  _total(waypoints, pose) {
    let len = 0;
    let prev = pose;
    for (const w of waypoints) {
      len += dist(prev, w);
      prev = w;
    }
    return roundMeters(len);
  }

  goTo(destId, pose, now = Date.now()) {
    const dest = this.destinations.find((d) => d.id === destId);
    if (!dest) return [{ type: 'say', text: this.t.unknown }];
    if (this.needsRelocalize) return [{ type: 'say', text: this.t.needRelocalize }];
    this.dest = dest;
    this.pose = pose;
    const res = this._plan(pose);
    if (!res.ok) {
      const text = res.reason === 'goal_blocked' ? this.t.goalBlocked(this.destName(dest)) : this.t.noRoute;
      this.waypoints = [];
      return this._halt(res.reason, text);
    }
    this.waypoints = res.waypoints;
    this.state = 'navigating';
    this.reason = null;
    this._announced = null;
    const m = this._total(res.waypoints, pose);
    const ev = [
      { type: 'say', text: this.t.start(this.destName(dest), this.t.num(m), this.t.unit(m)) },
      { type: 'state', state: this.state, reason: null },
    ];
    return ev.concat(this.update(pose, { localization: 1, now }));
  }

  update(pose, { localization = 1, now = Date.now() } = {}) {
    if (this.state !== 'navigating') return [];
    this.pose = pose;
    if (localization < LOC_MIN) {
      this.needsRelocalize = true;
      return this._halt('localization_lost', this.t.locLost, HAPTIC.lost);
    }
    while (this.waypoints.length) {
      const last = this.waypoints.length === 1;
      if (dist(pose, this.waypoints[0]) <= (last ? GOAL_TOL_CM : WP_TOL_CM)) this.waypoints.shift();
      else break;
    }
    if (!this.waypoints.length) {
      this.state = 'arrived';
      return [
        { type: 'say', text: this.t.arrived(this.destName(this.dest)) },
        { type: 'state', state: this.state, reason: null },
      ];
    }
    const ev = [];
    const wp = this.waypoints[0];
    const ins = instruction(pose, wp, this.settings.lang);
    const newSegment = this._announced !== wp;
    const offCourse = Math.abs(ins.rel) > 45 && now - this._lastSay > REPEAT_OFF_COURSE_MS;
    if (newSegment || offCourse) {
      ev.push({ type: 'say', text: ins.text });
      this._announced = wp;
      this._lastSay = now;
    }
    if (now - this._lastHaptic >= HAPTIC_EVERY_MS) {
      const h = hapticFor(ins.rel);
      if (h.pattern.length) {
        ev.push({ type: 'haptic', ...h });
        this._lastHaptic = now;
      }
    }
    return ev;
  }

  // A new object was detected. Replan only if it actually blocks the route.
  addObstacle(rect, pose, now = Date.now()) {
    return this.addObstacles([rect], pose, now);
  }

  addObstacles(rects, pose, now = Date.now()) {
    for (const rect of rects) this.grid.setRect(rect.x0, rect.y0, rect.x1, rect.y1, rect.height);
    if (!rects.length) return [];
    if (this.state !== 'navigating') return [];
    this.analysis = analyze(this.grid, this.settings);
    if (routeIsClear(this.grid, this.analysis, pose, this.waypoints)) return [];
    const ev = [{ type: 'say', text: this.t.obstacle }];
    const res = plan(this.grid, this.settings, pose, this.dest.pos, this.analysis);
    if (!res.ok) {
      this.waypoints = [];
      return ev.concat(this._halt('no_route', this.t.noRoute, HAPTIC.lost));
    }
    this.waypoints = res.waypoints;
    this._announced = null;
    return ev.concat(this.update(pose, { localization: 1, now }));
  }

  stop() {
    this.state = 'stopped';
    this.reason = 'user_stop';
    return [
      { type: 'say', text: this.t.stopped },
      { type: 'state', state: this.state, reason: this.reason },
    ];
  }

  // The user (or a re-scan) confirms where they are after localization was lost.
  relocalize(pose) {
    this.pose = pose;
    this.needsRelocalize = false;
    return [];
  }

  resume(pose, now = Date.now()) {
    if (!this.dest) return [{ type: 'say', text: this.t.notNavigating }];
    if (this.needsRelocalize) return [{ type: 'say', text: this.t.needRelocalize }];
    const res = this._plan(pose);
    if (!res.ok) return this._halt(res.reason, this.t.noRoute);
    this.waypoints = res.waypoints;
    this.state = 'navigating';
    this.reason = null;
    this._announced = null;
    return [
      { type: 'say', text: this.t.resumed },
      { type: 'state', state: this.state, reason: null },
    ].concat(this.update(pose, { localization: 1, now }));
  }

  repeat(pose, now = Date.now()) {
    if (this.state !== 'navigating' || !this.waypoints.length) return [{ type: 'say', text: this.t.notNavigating }];
    return [{ type: 'say', text: instruction(pose, this.waypoints[0], this.settings.lang).text }];
  }

  where(pose) {
    let best = null;
    for (const d of this.destinations) {
      const m = dist(pose, d.pos);
      if (!best || m < best.m) best = { d, m };
    }
    if (!best) return [{ type: 'say', text: this.t.unknown }];
    const meters = roundMeters(best.m);
    const hour = clockHour(relativeBearing(pose, best.d.pos));
    return [{ type: 'say', text: this.t.where(this.destName(best.d), hour, this.t.num(meters), this.t.unit(meters)) }];
  }

  // Save the current spot under a spoken name (used when mapping a real room).
  remember(name, pose) {
    if (!name) return [{ type: 'say', text: this.t.noName }];
    this.destinations.push({ id: `u${this.destinations.length + 1}`, pos: { x: pose.x, y: pose.y }, names: { mk: [name], en: [name] } });
    return [{ type: 'say', text: this.t.remembered(name) }, { type: 'dests' }];
  }

  // Dispatch a parsed voice command.
  handle(cmd, pose, now = Date.now()) {
    switch (cmd.type) {
      case 'stop': return this.stop();
      case 'repeat': return this.repeat(pose, now);
      case 'where': return this.where(pose);
      case 'remember': return this.remember(cmd.name, pose);
      case 'resume': return this.resume(pose, now);
      case 'go': return cmd.dest ? this.goTo(cmd.dest, pose, now) : [{ type: 'say', text: this.t.unknown }];
      default: return [{ type: 'say', text: this.t.unknown }];
    }
  }
}
