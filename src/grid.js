// Occupancy grid with 5 cm cells. Each cell stores the height (cm) of whatever
// stands on it: 0 = bare floor, small values = thresholds/rugs, WALL = wall.
export const CELL_CM = 5;
export const WALL = 1000;

export class Grid {
  constructor(widthCm, heightCm) {
    this.cols = Math.round(widthCm / CELL_CM);
    this.rows = Math.round(heightCm / CELL_CM);
    this.h = new Float32Array(this.cols * this.rows);
  }

  idx(c, r) {
    return r * this.cols + c;
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  cellOf(xCm, yCm) {
    return { c: Math.floor(xCm / CELL_CM), r: Math.floor(yCm / CELL_CM) };
  }

  centerOf(c, r) {
    return { x: (c + 0.5) * CELL_CM, y: (r + 0.5) * CELL_CM };
  }

  // Raise every cell touched by the rectangle to at least `heightCm`.
  setRect(x0, y0, x1, y1, heightCm) {
    const a = this.cellOf(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.cellOf(Math.max(x0, x1) - 1e-6, Math.max(y0, y1) - 1e-6);
    for (let r = Math.max(0, a.r); r <= Math.min(this.rows - 1, b.r); r++) {
      for (let c = Math.max(0, a.c); c <= Math.min(this.cols - 1, b.c); c++) {
        const i = this.idx(c, r);
        if (heightCm > this.h[i]) this.h[i] = heightCm;
      }
    }
  }

  clearRect(x0, y0, x1, y1) {
    const a = this.cellOf(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.cellOf(Math.max(x0, x1) - 1e-6, Math.max(y0, y1) - 1e-6);
    for (let r = Math.max(0, a.r); r <= Math.min(this.rows - 1, b.r); r++) {
      for (let c = Math.max(0, a.c); c <= Math.min(this.cols - 1, b.c); c++) {
        this.h[this.idx(c, r)] = 0;
      }
    }
  }

  addBorder(thicknessCm = CELL_CM) {
    const w = this.cols * CELL_CM;
    const h = this.rows * CELL_CM;
    this.setRect(0, 0, w, thicknessCm, WALL);
    this.setRect(0, h - thicknessCm, w, h, WALL);
    this.setRect(0, 0, thicknessCm, h, WALL);
    this.setRect(w - thicknessCm, 0, w, h, WALL);
  }

  toJSON() {
    return { cols: this.cols, rows: this.rows, h: Array.from(this.h) };
  }

  // Sparse form for large maps: only cells that are not bare floor.
  toSparse() {
    const cells = [];
    for (let i = 0; i < this.h.length; i++) if (this.h[i] > 0) cells.push([i, this.h[i]]);
    return { cols: this.cols, rows: this.rows, cells };
  }

  static fromSparse(o) {
    const g = new Grid(o.cols * CELL_CM, o.rows * CELL_CM);
    for (const [i, h] of o.cells) g.h[i] = h;
    return g;
  }

  static fromJSON(o) {
    const g = new Grid(o.cols * CELL_CM, o.rows * CELL_CM);
    g.h.set(o.h);
    return g;
  }
}
