// Numbers for comparing two layouts of the same sheet. They don't decide the go/no-go on their
// own, since a layout can score well and still read badly, but they catch what the eye misses.

import type { Placement, Pt, Route } from "./layout/types.ts";
import type { Sheet } from "./sheet.ts";

export interface Metrics {
  area: number;
  length: number;
  /** Corners on orthogonal routes. Null for splines, which bend everywhere. */
  bends: number | null;
  crossings: number;
  /** Wires that pass through the body of a card. */
  throughCards: number;
  /** Tags that sit over a card or another tag. */
  tagOverlaps: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function measure(sheet: Sheet, place: Placement): Metrics {
  const lines = sheet.wires.map((w) => sample(place.routes.get(w.id)!));
  const boxes: Box[] = sheet.cards.map((c) => {
    const p = place.cards.get(c.id)!;
    return { x0: p.x, y0: p.y, x1: p.x + c.w, y1: p.y + c.h };
  });

  let crossings = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) crossings += crossCount(lines[i], lines[j]);
  }

  const inset = (b: Box, d: number): Box => ({ x0: b.x0 + d, y0: b.y0 + d, x1: b.x1 - d, y1: b.y1 - d });
  const throughCards = lines.filter((pts) => boxes.some((b) => segments(pts).some(([a, z]) => hitsBox(a, z, inset(b, 3))))).length;

  const tags: Box[] = sheet.wires.flatMap((w) => {
    const t = place.routes.get(w.id)!.tag;
    return w.tag && t ? [{ x0: t.x - w.tag.w / 2, y0: t.y - w.tag.h / 2, x1: t.x + w.tag.w / 2, y1: t.y + w.tag.h / 2 }] : [];
  });
  const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const tagOverlaps = tags.filter((t, i) => boxes.some((b) => overlap(t, b)) || tags.some((u, j) => i !== j && overlap(t, u))).length;

  const routes = [...place.routes.values()];
  const poly = routes.every((r) => r.kind === "poly");
  return {
    area: Math.round(place.width * place.height),
    length: Math.round(lines.reduce((s, pts) => s + segments(pts).reduce((t, [a, b]) => t + Math.hypot(b.x - a.x, b.y - a.y), 0), 0)),
    bends: poly ? routes.reduce((s, r) => s + Math.max(0, r.points.length - 2), 0) : null,
    crossings,
    throughCards,
    tagOverlaps,
  };
}

/** A route as a polyline: splines are sampled finely enough to find crossings. */
function sample(r: Route): Pt[] {
  if (r.kind === "poly") return r.points;
  const out: Pt[] = [r.points[0]];
  for (let i = 1; i + 2 < r.points.length; i += 3) {
    const [p0, p1, p2, p3] = [r.points[i - 1], r.points[i], r.points[i + 1], r.points[i + 2]];
    for (let k = 1; k <= 16; k++) {
      const t = k / 16, u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  }
  return out;
}

const segments = (pts: Pt[]): [Pt, Pt][] => pts.slice(1).map((p, i) => [pts[i], p]);

function crossCount(a: Pt[], b: Pt[]): number {
  // A spline crossing is sampled into many short segments, and a crossing can land on a sample
  // point and be found twice; count distinct points instead.
  const hits: Pt[] = [];
  for (const [p, q] of segments(a)) {
    for (const [r, s] of segments(b)) {
      const x = properIntersection(p, q, r, s);
      if (x && !hits.some((h) => Math.hypot(h.x - x.x, h.y - x.y) < 2)) hits.push(x);
    }
  }
  return hits.length;
}

function properIntersection(p: Pt, q: Pt, r: Pt, s: Pt): Pt | null {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  const e = 1e-6;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
  return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
}

function hitsBox(a: Pt, b: Pt, box: Box): boolean {
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return false;
  // Liang–Barsky clip: does any part of the segment lie strictly inside the box?
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, qq] of [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]]) {
    if (pp === 0) {
      if (qq <= 0) return false;
      continue;
    }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}
