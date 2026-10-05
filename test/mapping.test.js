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

// ---- Depth API --------------------------------------------------------------
function depthSetup() {
  const g = new Grid(1200, 1200);
  const a = new Aligner({ x: 600, y: 600, heading: 0 });
  a.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 });
  const pm = new PointMap(g, a);
  const pose = a.pose({ x: 0, z: 0, fx: 0, fz: -1 });
  return { g, a, pm, pose, floorY: -1.2 };
}

test('depth: floor noise at close range is ignored, a 12 cm object at 1 m is seen', () => {
  const { pm, pose, floorY } = depthSetup();
  // floor points with 3 cm of noise
  assert.equal(pm.ingestDepth([0, floorY + 0.03, -1, 0.01, floorY + 0.03, -1], floorY, pose).add.length, 0);
  // a 12 cm object: two votes suffice
  const d = pm.ingestDepth([0.5, floorY + 0.12, -1, 0.5, floorY + 0.12, -1], floorY, pose);
  assert.equal(d.add.length, 1);
  assert.ok(Math.abs(d.add[0].height - 12) < 0.01);
});

test('depth: tolerance widens with range (8 cm bump at 3 m is treated as floor noise)', () => {
  const { pm, pose, floorY } = depthSetup();
  assert.ok(PointMap.depthFloorTolCm(300) > PointMap.depthFloorTolCm(100));
  const d = pm.ingestDepth([0, floorY + 0.08, -3, 0, floorY + 0.08, -3], floorY, pose);
  assert.equal(d.add.length, 0);
});

test('depth: a moved chair is cleared after floor is seen for a while, a table seen from above is not', () => {
  const { g, pm, pose, floorY } = depthSetup();
  const chair = [0.2, floorY + 0.45, -1.5];
  const floorThere = [0.2, floorY + 0.01, -1.5];
  // chair seen
  let d = pm.ingestDepth([...chair, ...chair], floorY, pose);
  assert.equal(d.add.length, 1);
  g.setRect(d.add[0].x0, d.add[0].y0, d.add[0].x1, d.add[0].y1, d.add[0].height);
  // chair gone: floor seen in the same cell. Not cleared right away (quiet period).
  for (let i = 0; i < 10; i++) d = pm.ingestDepth(floorThere, floorY, pose);
  assert.equal(g.h[g.idx(124, 90)] > 0, true);
  let cleared = 0;
  for (let i = 0; i < 40; i++) cleared += pm.ingestDepth(floorThere, floorY, pose).clear.length;
  assert.equal(cleared, 1);

  // table: floor under it is seen, but the top keeps being seen too, so it stays.
  const { g: g2, pm: pm2, pose: pose2, floorY: fy } = depthSetup();
  const top = [0.2, fy + 0.75, -1.5];
  const under = [0.2, fy + 0.01, -1.5];
  const t = pm2.ingestDepth([...top, ...top], fy, pose2);
  g2.setRect(t.add[0].x0, t.add[0].y0, t.add[0].x1, t.add[0].y1, t.add[0].height);
  let wrongClears = 0;
  for (let i = 0; i < 60; i++) wrongClears += pm2.ingestDepth([...top, ...under, ...under], fy, pose2).clear.length;
  assert.equal(wrongClears, 0);
});

test('depth: walls (tall cells) are never cleared by floor votes', () => {
  const { g, pm, pose, floorY } = depthSetup();
  const wall = [0.2, floorY + 1.6, -1.5];
  const d = pm.ingestDepth([...wall, ...wall], floorY, pose);
  g.setRect(d.add[0].x0, d.add[0].y0, d.add[0].x1, d.add[0].y1, d.add[0].height);
  let cleared = 0;
  for (let i = 0; i < 80; i++) cleared += pm.ingestDepth([0.2, floorY + 0.01, -1.5], floorY, pose).clear.length;
  assert.equal(cleared, 0);
});

test('handleFrame: depth obstacle on the route reroutes; depth can be switched off', () => {
  const g = new Grid(1200, 1200);
  g.addBorder(5);
  const settings = deriveSettings(makeProfile({ preset: 'lowvision' }).profile);
  const dests = [{ id: 'goal', pos: { x: 600, y: 300 }, names: { mk: ['цел'], en: ['goal'] } }];
  const make = () => {
    const grid = new Grid(1200, 1200);
    grid.addBorder(5);
    const nav = new Navigator({ grid, destinations: dests, settings });
    const aligner = new Aligner({ x: 600, y: 600, heading: 0 });
    aligner.startFromCamera({ x: 0, z: 0, fx: 0, fz: -1 });
    return { nav, aligner, pointMap: new PointMap(grid, aligner) };
  };
  const base = { tracking: 'TRACKING', x: 0, z: 0, fx: 0, fz: -1, floorY: -1.2, points: [] };
  const box = [0, -0.8, -1.5, 0, -0.8, -1.5, 0.01, -0.8, -1.5];
  const on = make();
  on.nav.goTo('goal', on.aligner.pose(base), 0);
  const r = handleFrame({ f: { ...base, depth: box }, ...on, now: 100 });
  assert.ok(r.events.some((e) => e.type === 'say' && e.text.startsWith('Нов предмет')));
  assert.equal(r.mapChanged, true);
  const off = make();
  off.nav.goTo('goal', off.aligner.pose(base), 0);
  const r2 = handleFrame({ f: { ...base, depth: box }, ...off, now: 100, useDepth: false });
  assert.equal(r2.mapChanged, false);
});
