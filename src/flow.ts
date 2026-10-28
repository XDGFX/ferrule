// Where a run's flow chevrons sit: on its straight stretches, clear of its corners, its ends, its
// label and every line that crosses it. Pure geometry, so the renderer only draws what this picks.

import type { Pt } from "./layout/types.ts";

/** A chevron's centre and heading, in degrees clockwise from east. */
export interface Mark extends Pt {
  angle: number;
}

/** A run as the renderer sees it: its route from `from` to `to`, its line weight and its label. */
export interface FlowRun {
  points: Pt[];
  weight: number;
  /** +1 when flow runs along the route, -1 against it. */
  dir: 1 | -1;
  /** The label's centre on the line and its width, when the run has one. */
  label?: { at: Pt; w: number };
}

/** Clear space kept round a chevron: from a corner's fillet, a port, a label or a crossing line. */
const FILLET = 14;
const END_CLEAR = 14;
const PAD = 8;
/** The vertical room a label beside a vertical stretch takes. */
const LABEL_H = 12;
/** The least free line a chevron is put on, on a run with no label. */
const MIN_FREE = 64;
/** A stretch with this much free line gets a chevron of its own, beyond the run's first. */
const EXTRA_RUN = 360;

/** How long a chevron is along its line, for a line of `weight`. */
export const chevronDepth = (weight: number) => Math.max(5, weight);

/**
 * The chevrons for one run: one on its longest free stretch, at that stretch's middle, and one
 * more on any other stretch long enough to want its own.
 * `others` are every other run's routes and weights, whose crossings a chevron keeps clear of.
 */
export function flowMarks(run: FlowRun, others: { points: Pt[]; weight: number }[]): Mark[] {
  const pts = run.points;
  const depth = chevronDepth(run.weight);
  const need = depth + 2 * PAD;
  const found: { at: Pt; free: number; order: number; angle: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const flat = Math.abs(a.y - b.y) < 0.5, upright = Math.abs(a.x - b.x) < 0.5;
    if (flat === upright) continue;
    // Measured along the stretch's own axis, from a towards b.
    const axis = flat ? "x" : "y", across = flat ? "y" : "x";
    const s = Math.sign(b[axis] - a[axis]);
    const along = (p: Pt) => (p[axis] - a[axis]) * s;
    const len = Math.abs(b[axis] - a[axis]);
    const lo = i === 1 ? END_CLEAR : FILLET + PAD, hi = len - (i === pts.length - 1 ? END_CLEAR : FILLET + PAD);
    const blocked: [number, number][] = [];
    if (run.label && Math.abs(run.label.at[across] - a[across]) < 1 && between(run.label.at[axis], a[axis], b[axis])) {
      const half = (flat ? run.label.w / 2 : LABEL_H) + PAD + depth / 2;
      blocked.push([along(run.label.at) - half, along(run.label.at) + half]);
    }
    for (const o of others) {
      for (let j = 1; j < o.points.length; j++) {
        const c = o.points[j - 1], d = o.points[j];
        // A line across this stretch: constant on our axis, spanning our line.
        if (Math.abs(c[axis] - d[axis]) > 0.5 || !between(a[across], c[across], d[across])) continue;
        if (!between(c[axis], a[axis], b[axis])) continue;
        const half = o.weight / 2 + PAD + depth / 2;
        blocked.push([along(c) - half, along(c) + half]);
      }
    }
    // A short unlabelled hop, such as between two fittings that screw together, reads plainly
    // enough without one.
    const free = gaps(lo, hi, blocked).filter(([x, y]) => y - x >= (run.label ? need : Math.max(need, MIN_FREE)));
    if (!free.length) continue;
    // The middle of the longest free stretch, so a chevron sits midway between a label and a port
    // rather than crowding either.
    const [x, y] = free.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] + 0.5 ? g : best));
    const t = (x + y) / 2;
    const at = flat ? { x: a.x + s * t, y: a.y } : { x: a.x, y: a.y + s * t };
    const heading = flat ? (s > 0 ? 0 : 180) : s > 0 ? 90 : 270;
    found.push({ at, free: Math.max(...free.map(([x, y]) => y - x)), order: i, angle: run.dir > 0 ? heading : (heading + 180) % 360 });
  }
  if (!found.length) return [];
  const first = found.reduce((best, f) => (f.free > best.free ? f : best));
  return found
    .filter((f) => f === first || f.free >= EXTRA_RUN)
    .sort((p, q) => p.order - q.order)
    .map((f) => ({ ...f.at, angle: f.angle }));
}

const between = (v: number, a: number, b: number) => Math.min(a, b) <= v && v <= Math.max(a, b);

/** The parts of [lo, hi] that no blocked interval covers. */
function gaps(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [x, y] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (x > at) out.push([at, Math.min(x, hi)]);
    at = Math.max(at, y);
    if (at >= hi) break;
  }
  if (at < hi) out.push([at, hi]);
  return out.filter(([x, y]) => y > x);
}
