import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Grid } from '../src/grid.js';
import { Aligner, PointMap, handleFrame, trackingToLocalization } from '../src/mapping.js';
import { Navigator } from '../src/session.js';
import { makeProfile, deriveSettings } from '../src/profile.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('tracking state -> localization confidence', () => {
  assert.equal(trackingToLocalization('TRACKING'), 1);
  assert.ok(trackingToLocalization('PAUSED') < 0.6);
  assert.equal(trackingToLocalization('STOPPED'), 0);
});

test('first frame is pinned to the home pose, whatever ARCore origin and heading', () => {
  const a = new Aligner({ x: 600, y: 600, heading: 0 });
  // ARCore started at (3, -2) looking toward +x (fx=1, fz=0): east.
  a.startFromCamera({ x: 3, z: -2, fx: 1, fz: 0 });
  const p = a.pose({ x: 3, z: -2, fx: 1, fz: 0 });
  near(p.x, 600); near(p.y, 600); near(p.heading, 0);
  // Walking 2 m straight ahead (east in ARCore) moves 2 m "up" on the map (heading 0).
  const q = a.pose({ x: 5, z: -2, fx: 1, fz: 0 });
  near(q.x, 600); near(q.y, 400); near(q.heading, 0);
  // Turning right 90 degrees (east -> south in ARCore, +z) gives heading 90.
  near(a.pose({ x: 3, z: -2, fx: 0, fz: 1 }).heading, 90);
});

test('points and pose share one transform', () => {
  const a = new Aligner({ x: 600, y: 600, heading: 90 });
  a.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 }); // ARCore north, home says facing right
  const ahead = a.point(0, -1); // 1 m in front of the camera
  near(ahead.x, 700); near(ahead.y, 600);
});

test('feature points become obstacles only after enough votes, floor and ceiling ignored', () => {
  const g = new Grid(1200, 1200);
  const a = new Aligner({ x: 600, y: 600, heading: 0 });
  a.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 });
  const pm = new PointMap(g, a);
  const pose = a.pose({ x: 0, z: 0, fx: 0, fz: -1 });
  const floorY = -1.2;
  // one point at 50 cm height, 1 m ahead: not enough votes
  assert.equal(pm.ingest([0, floorY + 0.5, -1], floorY, pose).length, 0);
  assert.equal(pm.ingest([0.01, floorY + 0.6, -1], floorY, pose).length, 0);
  const rects = pm.ingest([0.02, floorY + 0.7, -1], floorY, pose);
  assert.equal(rects.length, 1);
  assert.ok(rects[0].height >= 69);
  // floor noise and ceiling points never vote
  const n = pm.ingest([1, floorY + 0.02, -1, 1, floorY + 0.02, -1, 1, floorY + 0.02, -1, 1, floorY + 2.5, -1], floorY, pose);
  assert.equal(n.length, 0);
});

test('an obstacle seen by ARCore on the route triggers a reroute', () => {
  const g = new Grid(1200, 1200);
  g.addBorder(5);
  const settings = deriveSettings(makeProfile({ preset: 'lowvision' }).profile);
  const dests = [{ id: 'goal', pos: { x: 600, y: 300 }, names: { mk: ['цел'], en: ['goal'] } }];
  const nav = new Navigator({ grid: g, destinations: dests, settings });
  const aligner = new Aligner({ x: 600, y: 600, heading: 0 });
  aligner.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 });
  const pointMap = new PointMap(g, aligner);
  const floorY = -1.2;
  const frame = (points = [], tracking = 'TRACKING') => ({ tracking, x: 0, z: 0, fx: 0, fz: -1, floorY, points });
  let r = handleFrame({ f: frame(), nav, aligner, pointMap, now: 0 });
  nav.goTo('goal', r.pose, 0);
  assert.equal(nav.state, 'navigating');
  const before = nav.waypoints.length;
  // a box 1.5 m ahead on the straight line: three votes in the same cell
  const box = [0, floorY + 0.4, -1.5, 0.01, floorY + 0.4, -1.5, 0, floorY + 0.5, -1.48];
  r = handleFrame({ f: frame(box), nav, aligner, pointMap, now: 500 });
  assert.ok(r.events.some((e) => e.type === 'say' && e.text.startsWith('Нов предмет')));
  assert.equal(nav.state, 'navigating');
  assert.ok(nav.waypoints.length >= before);
  // tracking lost: navigation halts
  r = handleFrame({ f: frame([], 'PAUSED'), nav, aligner, pointMap, now: 900 });
  assert.equal(nav.state, 'stopped');
  assert.equal(nav.reason, 'localization_lost');
});

test('no pose and no guidance until the map frame is anchored', () => {
  const g = new Grid(1200, 1200);
  const aligner = new Aligner({ x: 600, y: 600, heading: 0 });
  const r = handleFrame({ f: { tracking: 'TRACKING', x: 0, z: 0, fx: 0, fz: -1 }, nav: { needsRelocalize: true }, aligner, pointMap: new PointMap(g, aligner), now: 0 });
  assert.equal(r.pose, null);
  assert.equal(aligner.ready, false);
});

test('marker anchoring: same wall marker gives the same map pose in any ARCore session', () => {
  const home = { x: 600, y: 600, heading: 0 };
  // Session 1: marker at ARCore (2, -1), outward normal toward +z (south). User stands 1 m in front of it.
  const s1 = new Aligner(home);
  assert.ok(s1.startFromMarker({ x: 2, z: -1, nx: 0, nz: 1 }));
  const p1 = s1.pose({ x: 2, z: 0, fx: 0, fz: 1 }); // 1 m out from the wall, facing away from it
  // Session 2: ARCore chose a different origin and heading; marker now at (-4, 7), normal toward +x.
  const s2 = new Aligner(home);
  assert.ok(s2.startFromMarker({ x: -4, z: 7, nx: 1, nz: 0 }));
  const p2 = s2.pose({ x: -3, z: 7, fx: 1, fz: 0 });
  near(p1.x, p2.x, 1e-6); near(p1.y, p2.y, 1e-6); near(p1.heading, p2.heading, 1e-6);
  near(p1.x, 600); near(p1.y, 700); near(p1.heading, 180); // room extends "down" from the marker
});

test('a map made with a marker refuses a camera-start anchor, and the reverse', () => {
  const home = { x: 600, y: 600, heading: 0 };
  const m = new Aligner(home, 'marker');
  assert.equal(m.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 }), false);
  assert.equal(m.ready, false);
  const c = new Aligner(home, 'start');
  assert.equal(c.startFromMarker({ x: 0, z: 0, nx: 0, nz: 1 }), false);
});

test('seeing the marker clears the relocalize gate, but never re-pins a walking user', () => {
  const g = new Grid(1200, 1200);
  g.addBorder(5);
  const settings = deriveSettings(makeProfile({ preset: 'lowvision' }).profile);
  const dests = [{ id: 'goal', pos: { x: 600, y: 900 }, names: { mk: ['цел'], en: ['goal'] } }];
  const nav = new Navigator({ grid: g, destinations: dests, settings });
  const aligner = new Aligner({ x: 600, y: 600, heading: 0 }, 'marker');
  const pointMap = new PointMap(g, aligner);
  nav.needsRelocalize = true;
  const marker = { x: 0, z: 0, nx: 0, nz: 1 };
  const frame = (o = {}) => ({ tracking: 'TRACKING', x: 0, z: 1, fx: 0, fz: 1, floorY: -1.2, points: [], ...o });
  let r = handleFrame({ f: frame({ marker }), nav, aligner, pointMap, now: 0 });
  assert.equal(r.anchored, 'marker');
  assert.equal(nav.needsRelocalize, false);
  nav.goTo('goal', r.pose, 0);
  assert.equal(nav.state, 'navigating');
  // marker seen again mid-walk with a different world transform: ignored
  const before = aligner.delta;
  r = handleFrame({ f: frame({ marker: { x: 5, z: 5, nx: 1, nz: 0 } }), nav, aligner, pointMap, now: 100 });
  assert.equal(r.anchored, null);
  assert.equal(aligner.delta, before);
  // after stopping, a sighting re-pins and clears the gate lost with tracking
  nav.update(r.pose, { localization: 0.3, now: 200 });
  assert.equal(nav.needsRelocalize, true);
  r = handleFrame({ f: frame({ marker }), nav, aligner, pointMap, now: 300 });
  assert.equal(r.anchored, 'marker');
  assert.equal(nav.needsRelocalize, false);
});
