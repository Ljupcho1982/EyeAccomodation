// Simulated apartment used by the demo and the tests.
// 6 m x 5 m. A dividing wall at x = 3 m with three openings:
//   A: 60 cm gap (the passage a wheelchair must avoid)
//   C: 100 cm gap
//   B: 90 cm door with a 4 cm threshold
import { Grid, WALL } from './grid.js';

export function buildDemoRoom() {
  const g = new Grid(600, 500);
  g.addBorder(5);
  // dividing wall with gaps at y 100-160 (A), 200-300 (C), 330-420 (B)
  g.setRect(295, 0, 305, 100, WALL);
  g.setRect(295, 160, 305, 200, WALL);
  g.setRect(295, 300, 305, 330, WALL);
  g.setRect(295, 420, 305, 500, WALL);
  g.setRect(295, 330, 305, 420, 4); // threshold in door B
  g.setRect(100, 150, 200, 250, 75); // table
  g.setRect(420, 380, 580, 480, 50); // bed
  g.setRect(350, 200, 450, 300, 1); // rug (passable)
  return g;
}

export const DESTINATIONS = [
  { id: 'door', pos: { x: 60, y: 60 }, names: { mk: ['врата', 'влез'], en: ['door', 'entrance'] } },
  { id: 'table', pos: { x: 150, y: 290 }, names: { mk: ['маса'], en: ['table'] } },
  { id: 'kitchen', pos: { x: 540, y: 110 }, names: { mk: ['кујна'], en: ['kitchen'] } },
  { id: 'bed', pos: { x: 380, y: 430 }, names: { mk: ['кревет'], en: ['bed'] } },
];

export const START_POSE = { x: 50, y: 110, heading: 90 };
