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
  a.start({ x: 3, z: -2, fx: 1, fz: 0 });
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
  a.start({ x: 0, z: 0, fx: 0, fz: -1 }); // ARCore north, home says facing right
  const ahead = a.point(0, -1); // 1 m in front of the camera
  near(ahead.x, 700); near(ahead.y, 600);
});

test('feature points become obstacles only after enough votes, floor and ceiling ignored', () => {
  const g = new Grid(1200, 1200);
  const a = new Aligner({ x: 600, y: 600, heading: 0 });
  a.start({ x: 0, z: 0, fx: 0, fz: -1 });
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

test('frames before the first tracked frame are ignored', () => {
  const g = new Grid(1200, 1200);
  const aligner = new Aligner({ x: 600, y: 600, heading: 0 });
  const r = handleFrame({ f: { tracking: 'PAUSED', x: 0, z: 0, fx: 0, fz: -1 }, nav: null, aligner, pointMap: new PointMap(g, aligner), now: 0 });
  assert.equal(r.pose, null);
  assert.equal(aligner.ready, false);
});
