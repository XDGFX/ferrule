// Draws a laid-out sheet in the Instrument style: Inter, quiet cards with a colour chip, filleted
// wires with a hairline casing, and a dashed tracer on two-colour wires. Colours are CSS
// variables, switched by prefers-color-scheme; `flatten` resolves them for PNG rasterisers.

import { WIRE } from "./colours.ts";
import type { Placement, Pt, Route } from "./layout/types.ts";
import { FACES, fontFaces, type Face } from "./measure.ts";
import { STYLE as S, tagWidth, type Card, type Sheet, type Wire } from "./sheet.ts";

// A white core on a white card needs a darker casing than the rest to stay visible; a black one
// on the dark ground needs a lighter one.
export const THEMES = {
  light: {
    bg: "#eef0f3", card: "#ffffff", line: "#d5d9df", text: "#1b1f24", muted: "#5e6670", faint: "#9aa1aa",
    casing: "#7f8792", "case-bk": "#7f8792", "case-wh": "#4c535d", "tag-bg": "#ffffff",
  },
  dark: {
    bg: "#121418", card: "#1c1f25", line: "#323741", text: "#e8eaed", muted: "#9aa1ab", faint: "#626a75",
    casing: "#5d6570", "case-bk": "#9aa1ab", "case-wh": "#5d6570", "tag-bg": "#23272e",
  },
} as const;

/** Height of the band above the layout that holds the sheet's title and caption. */
const TITLE_BAND = 76;
const RADIUS = 9;
const FILLET = 14;
const CASING = 1.2;

const vars = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";");

const CSS = `
svg{${vars(THEMES.light)}}
@media (prefers-color-scheme: dark){svg{${vars(THEMES.dark)}}}
text{font-family:Inter,'Helvetica Neue',Arial,sans-serif;fill:var(--text)}
.bg{fill:var(--bg)}
.card{fill:var(--card);stroke:var(--line);stroke-width:1}
.rule{stroke:var(--line);stroke-width:1;stroke-opacity:.55}
.muted{fill:var(--muted)}
.faint{fill:var(--faint)}
.casing{fill:none;stroke:var(--casing);stroke-linejoin:round}
.case-bk{stroke:var(--case-bk)}
.case-wh{stroke:var(--case-wh)}
.core{fill:none;stroke-linejoin:round}
.tag{fill:var(--tag-bg);stroke:var(--line);stroke-width:1}
.port{fill:var(--card);stroke:var(--muted);stroke-width:1.2}
.mate{fill:none;stroke:var(--muted);stroke-linejoin:round}
.mate-gap{fill:none;stroke:var(--bg);stroke-linejoin:round}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => String(Math.round(v * 10) / 10);

/** The characters each face draws on one sheet, so its embedded font carries only those glyphs. */
type Glyphs = Map<Face, Set<string>>;

/** A `<text>` element, recording its characters against the face it is set in. */
function text(g: Glyphs, attrs: string, body: string, weight = 400, italic = false): string {
  const face = FACES.find((f) => f.weight === weight && (f.style === "italic") === italic)!;
  const set = g.get(face) ?? new Set();
  for (const ch of body) set.add(ch);
  g.set(face, set);
  const style = (weight === 400 ? "" : ` font-weight="${weight}"`) + (italic ? ' font-style="italic"' : "");
  return `<text ${attrs}${style}>${esc(body)}</text>`;
}

export async function render(sheet: Sheet, place: Placement, caption = ""): Promise<string> {
  const g: Glyphs = new Map();
  const W = Math.ceil(place.width);
  const H = Math.ceil(place.height) + TITLE_BAND;
  const cards = new Map(sheet.cards.map((c) => [c.id, c]));
  const at = (id: string) => {
    const p = place.cards.get(id)!;
    return { x: p.x, y: p.y + TITLE_BAND };
  };
  const shift = (p: Pt) => ({ x: p.x, y: p.y + TITLE_BAND });

  const o: string[] = [
    `<rect class="bg" width="${W}" height="${H}"/>`,
    text(g, 'x="24" y="36" font-size="20"', sheet.title, 600),
  ];
  if (caption) o.push(text(g, 'class="muted" x="24" y="56" font-size="11.5"', caption));
  for (const c of sheet.cards) o.push(...drawCard(g, c, at(c.id)));

  const tags: string[] = [];
  const ports: string[] = [];
  for (const w of sheet.wires) {
    const r = place.routes.get(w.id)!;
    const pts = r.points.map(shift);
    if (w.kind === "mate") {
      o.push(...drawMate(path(r.kind, pts)));
      continue;
    }
    o.push(...drawWire(path(r.kind, pts), w));
    if (w.tag && r.tag) tags.push(...drawTag(g, shift(r.tag), w.tag.text, w.tag.w));
    for (const [end, p] of [[w.from, pts[0]], [w.to, pts[pts.length - 1]]] as const) {
      if (cards.get(end.card)!.kind !== "cable") ports.push(`<circle class="port" cx="${n(p.x)}" cy="${n(p.y)}" r="3.2"/>`);
    }
  }
  for (const c of sheet.cards) for (const loop of c.loops) o.push(...drawLoop(c, at(c.id), loop));
  // Cores pass straight through a cable card, drawn over the card so the run reads as continuous.
  for (const c of sheet.cards.filter((k) => k.kind === "cable")) {
    const p = at(c.id);
    c.rows.forEach((row, i) => {
      const y = p.y + c.rowTop + i * c.rowH + c.rowH / 2;
      const wire = sheet.wires.find((w) => w.to.card === c.id && w.to.port.startsWith(`${row.key}:`)) ??
        sheet.wires.find((w) => w.from.card === c.id && w.from.port.startsWith(`${row.key}:`));
      if (!wire) return;
      o.push(...drawWire(`M${n(p.x)},${n(y)} L${n(p.x + c.w)},${n(y)}`, wire));
      const label = row.label || row.num;
      tags.push(...drawTag(g, { x: p.x + c.w / 2, y }, label, tagWidth(label)));
    });
  }
  o.push(...new Set(ports), ...tags, "</svg>");

  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(sheet.title)}">`,
    `<style>${await fontFaces(new Map([...g].map(([f, chars]) => [f, [...chars].sort().join("")])))}${CSS}</style>`,
  ];
  return [...head, ...o].join("\n");
}

function drawCard(g: Glyphs, c: Card, p: Pt): string[] {
  const o: string[] = [];
  const dash = c.kind === "cable" ? ' stroke-dasharray="5 3"' : "";
  o.push(`<rect class="card" x="${n(p.x)}" y="${n(p.y)}" width="${c.w}" height="${c.h}" rx="${RADIUS}"${dash}/>`);
  o.push(`<rect x="${n(p.x + 12)}" y="${n(p.y + 12)}" width="10" height="10" rx="2.5" style="fill:${c.accent}"/>`);
  o.push(text(g, `x="${n(p.x + 28)}" y="${n(p.y + 21)}" font-size="${S.titleSize}"`, c.title, 600));
  if (c.sub) o.push(text(g, `class="muted" x="${n(p.x + 12)}" y="${n(p.y + 39)}" font-size="${S.subSize}"`, c.sub));
  const swatch = c.rows.some((r) => r.colours) ? S.swatchW : 0;
  // A cable card's rows are drawn later, over the cores that pass through it.
  if (c.kind !== "cable") c.rows.forEach((r, i) => {
    const ry = p.y + c.rowTop + i * c.rowH;
    const base = ry + c.rowH / 2 + S.rowSize * 0.36;
    if (i) o.push(`<line class="rule" x1="${n(p.x + 10)}" y1="${n(ry)}" x2="${n(p.x + c.w - 10)}" y2="${n(ry)}"/>`);
    if (r.fold) {
      o.push(text(g, `class="faint" x="${n(p.x + c.w / 2)}" y="${n(base)}" text-anchor="middle" font-size="${S.rowSize - 1}"`, r.fold, 400, true));
      return;
    }
    const used = c.ports.some((q) => q.id.startsWith(`${r.key}:`)) || c.loops.some((l) => l.includes(r.key));
    o.push(text(g, `class="${used ? "muted" : "faint"}" x="${n(p.x + S.numW - 8)}" y="${n(base)}" text-anchor="end" font-size="${S.rowSize - 1}"`, r.num));
    if (r.colours) o.push(...drawSwatch(p.x + S.numW + 8, ry + c.rowH / 2, r.colours));
    o.push(text(g, `${used ? "" : 'class="faint" '}x="${n(p.x + S.numW + 8 + swatch)}" y="${n(base)}" font-size="${S.rowSize}"`, r.label));
  });
  if (c.notes.length) {
    const ny = p.y + c.rowTop + c.rows.length * c.rowH;
    o.push(`<line class="rule" x1="${n(p.x)}" y1="${n(ny)}" x2="${n(p.x + c.w)}" y2="${n(ny)}" stroke-opacity="1"/>`);
    c.notes.forEach((line, j) => {
      o.push(text(g, `class="muted" x="${n(p.x + 12)}" y="${n(ny + 5 + (j + 1) * S.noteLh)}" font-size="${S.noteSize}"`, line));
    });
  }
  return o;
}

/** A pin's colour marking: a small chip, split down the middle for a two-colour mark. */
function drawSwatch(x: number, cy: number, colours: string[]): string[] {
  const size = 8;
  const y = cy - size / 2;
  const [a, b] = colours;
  const kase = a === "WH" ? "case-wh" : "casing";
  const o = [`<rect class="${kase}" x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="2" stroke-width="1" style="fill:${WIRE[a] ?? WIRE.GY}"/>`];
  if (b) o.push(`<path d="M${n(x + size)},${n(y)} V${n(y + size)} H${n(x)} Z" style="fill:${WIRE[b] ?? WIRE.GY}"/>`);
  return o;
}

/** Two connectors plugged together: a double line, so it can't be read as a wire. */
function drawMate(d: string): string[] {
  return [`<path class="mate" d="${d}" stroke-width="6"/>`, `<path class="mate-gap" d="${d}" stroke-width="2.4"/>`];
}

/** A bridge between two pins of one connector, drawn as a short grey wire looping off its side. */
function drawLoop(c: Card, p: Pt, [a, b]: [string, string]): string[] {
  const rowY = (key: string) => p.y + c.rowTop + c.rows.findIndex((r) => r.key === key) * c.rowH + c.rowH / 2;
  // Loop off whichever side has no wire on either pin, preferring the east.
  const busy = (side: string) => c.ports.some((q) => q.side === side && (q.id === `${a}:${side}` || q.id === `${b}:${side}`));
  const east = !busy("E") || busy("W");
  const x = east ? p.x + c.w : p.x;
  const out = east ? x + 14 : x - 14;
  const pts = [{ x, y: rowY(a) }, { x: out, y: rowY(a) }, { x: out, y: rowY(b) }, { x, y: rowY(b) }];
  const wire: Wire = { id: "loop", from: { card: c.id, port: a }, to: { card: c.id, port: b }, colours: ["GY"], weight: 2.5 };
  return [
    ...drawWire(path("poly", pts), wire),
    ...pts.filter((_, i) => i === 0 || i === 3).map((q) => `<circle class="port" cx="${n(q.x)}" cy="${n(q.y)}" r="3.2"/>`),
  ];
}

function drawWire(d: string, w: Wire): string[] {
  const [c1, c2] = w.colours;
  const kase = c1 === "BK" ? " case-bk" : c1 === "WH" ? " case-wh" : "";
  const o = [
    `<path class="casing${kase}" d="${d}" stroke-width="${n(w.weight + 2 * CASING)}"/>`,
    `<path class="core" d="${d}" stroke="${WIRE[c1] ?? WIRE.GY}" stroke-width="${n(w.weight)}"/>`,
  ];
  if (c2) o.push(`<path class="core" d="${d}" stroke="${WIRE[c2] ?? WIRE.GY}" stroke-width="${n(w.weight / 2)}" stroke-dasharray="12 7"/>`);
  return o;
}

function drawTag(g: Glyphs, c: Pt, label: string, w: number): string[] {
  return [
    `<rect class="tag" x="${n(c.x - w / 2)}" y="${n(c.y - S.tagH / 2)}" width="${n(w)}" height="${S.tagH}" rx="${S.tagH / 2}"/>`,
    text(g, `x="${n(c.x)}" y="${n(c.y + S.tagSize * 0.36)}" text-anchor="middle" font-size="${S.tagSize}"`, label, 500),
  ];
}

/** An SVG path for a route: filleted corners on a polyline, cubic segments on a spline. */
export function path(kind: Route["kind"], pts: Pt[]): string {
  if (kind === "bezier") {
    const d = [`M${n(pts[0].x)},${n(pts[0].y)}`];
    for (let i = 1; i + 2 < pts.length; i += 3) {
      d.push(`C${[pts[i], pts[i + 1], pts[i + 2]].map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}`);
    }
    return d.join(" ");
  }
  const d = [`M${n(pts[0].x)},${n(pts[0].y)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(FILLET, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d.push(`L${n(b.x)},${n(b.y)}`);
      continue;
    }
    d.push(`L${n(b.x - ((b.x - a.x) / l1) * r)},${n(b.y - ((b.y - a.y) / l1) * r)}`);
    d.push(`Q${n(b.x)},${n(b.y)} ${n(b.x + ((c.x - b.x) / l2) * r)},${n(b.y + ((c.y - b.y) / l2) * r)}`);
  }
  const z = pts[pts.length - 1];
  d.push(`L${n(z.x)},${n(z.y)}`);
  return d.join(" ");
}

/** Resolve the CSS variables for one theme. resvg cannot evaluate var(), so a PNG needs literal colours. */
export function flatten(svg: string, theme: keyof typeof THEMES): string {
  const t: Record<string, string> = THEMES[theme];
  return svg
    .replace(/@media \(prefers-color-scheme: dark\)\{svg\{[^}]*\}\}/, "")
    .replace(/var\(--([a-z-]+)\)/g, (_, k: string) => t[k]);
}
