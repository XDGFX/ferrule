// Draws a laid-out sheet in the Instrument style: Inter, quiet cards outlined and faintly tinted
// in their own colour, filleted wires with a hairline casing, a dashed tracer on two-colour
// wires, and run labels as plain text over the line. Colours are CSS variables, switched by
// prefers-color-scheme; `flatten` resolves them for PNG rasterisers.

import { WIRE } from "./colours.ts";
import type { Placement, Pt, Route } from "./layout/types.ts";
import { FACES, fontFaces, type Face } from "./measure.ts";
import type { Glyph } from "./model.ts";
import { STYLE as S, tagWidth, titleX, type Card, type Sheet, type Wire } from "./sheet.ts";

// A white core on a white card needs a darker casing than the rest to stay visible; a black one
// on the dark ground needs a lighter one.
export const THEMES = {
  light: {
    bg: "#eef0f3", card: "#ffffff", line: "#d5d9df", text: "#1b1f24", muted: "#5e6670", faint: "#9aa1aa",
    casing: "#7f8792", "case-bk": "#7f8792", "case-wh": "#5e6670", "tag-bg": "#ffffff",
    // A pure white core on the light ground reads as a hollow outline; a pale grey reads as filled.
    "core-bk": WIRE.BK, "core-wh": "#dde0e5",
    // A card's tint and outline in its own colour: faint enough to keep its text at full contrast.
    pill: "#e2e5ea", "pill-text": "#5e6670", tint: "0.05", "edge-op": "0.55",
  },
  dark: {
    bg: "#121418", card: "#1c1f25", line: "#323741", text: "#e8eaed", muted: "#9aa1ab", faint: "#626a75",
    casing: "#5d6570", "case-bk": "#9aa1ab", "case-wh": "#5d6570", "tag-bg": "#23272e",
    // On the dark ground a true black core vanishes and leaves its casing looking hollow.
    "core-bk": "#474d57", "core-wh": WIRE.WH,
    pill: "#1f2228", "pill-text": "#959ca6", tint: "0.06", "edge-op": "0.6",
  },
} as const;

/** Height of the band above the layout that holds the sheet's title and caption. */
const TITLE_BAND = 76;
const RADIUS = 9;
const FILLET = 14;
const CASING = 1.2;

const vars = (t: Record<string, string>) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";");

const css = (light: string, dark: string) => `
svg{${vars(THEMES.light)}${light}}
@media (prefers-color-scheme: dark){svg{${vars(THEMES.dark)}${dark}}}
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
.mate{fill:none;stroke:var(--muted);stroke-linecap:round;stroke-linejoin:round}
.cap{stroke:var(--muted);stroke-width:1.5;stroke-linecap:round}
.pill{fill:var(--pill)}
.pill-text{fill:var(--pill-text)}
.exit{fill:var(--card);stroke:var(--muted);stroke-width:1;stroke-opacity:.7;stroke-linejoin:round}
.label{paint-order:stroke;stroke:var(--bg);stroke-width:3.5;stroke-linejoin:round}
.glyph{fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}`;

/**
 * The colours a sheet draws accents in, each as a theme variable. A colour is given as it looks in
 * life, which may be too pale for the light ground or too dark for the dark one, so each theme
 * clamps its lightness: no lighter than 40% on light, no darker than 63% and no more than 55%
 * saturated on dark.
 */
interface Palette {
  /** The variable for `hex`, recording it so the sheet defines it. */
  of(hex: string): string;
  /** The variable definitions for each theme, to append to its block. */
  vars(theme: "light" | "dark"): string;
}

function palette(): Palette {
  const used = new Map<string, string>();
  return {
    of(hex) {
      const k = `acc-${hex.replace("#", "").toLowerCase()}`;
      used.set(k, hex);
      return `var(--${k})`;
    },
    vars(theme) {
      const adjust = theme === "light" ? (h: string) => clamp(h, 0, 0.4, 1) : (h: string) => clamp(h, 0.63, 1, 0.55);
      return [...used].map(([k, v]) => `;--${k}:${adjust(v)}`).join("");
    },
  };
}

/** `hex` with its HSL lightness clamped to [lo, hi] and its saturation capped. */
export function clamp(hex: string, lo: number, hi: number, cap: number): string {
  const v = parseInt(hex.slice(1), 16);
  let [r, g, b] = [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, sat = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(Math.max(l, lo), hi);
  sat = Math.min(sat, cap);
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  [r, g, b] = [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  return "#" + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

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
  const acc = palette();
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
  for (const c of sheet.cards) o.push(...drawCard(g, acc, c, at(c.id)));

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
    if (w.tag && r.tag) tags.push(drawLabel(g, acc, pts, shift(r.tag), w));
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
      const into = sheet.wires.find((w) => w.to.card === c.id && w.to.port.startsWith(`${row.key}:`));
      const out = sheet.wires.find((w) => w.from.card === c.id && w.from.port.startsWith(`${row.key}:`));
      const wire = into ?? out;
      if (!wire) return;
      o.push(...drawWire(`M${n(p.x)},${n(y)} L${n(p.x + c.w)},${n(y)}`, wire));
      // A core that goes nowhere on one side ends in a cap, so it reads as unterminated, not cut.
      for (const [open, x] of [[!into, p.x], [!out, p.x + c.w]] as const) {
        if (open) o.push(`<line class="cap" x1="${n(x)}" y1="${n(y - 6)}" x2="${n(x)}" y2="${n(y + 6)}"/>`);
      }
      const label = row.label || row.num;
      tags.push(...drawTag(g, { x: p.x + c.w / 2, y }, label, tagWidth(label)));
    });
  }
  o.push(...new Set(ports), ...tags, "</svg>");

  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(sheet.title)}">`,
    `<style>${await fontFaces(new Map([...g].map(([f, chars]) => [f, [...chars].sort().join("")])))}${css(acc.vars("light"), acc.vars("dark"))}</style>`,
  ];
  return [...head, ...o].join("\n");
}

function drawCard(g: Glyphs, acc: Palette, c: Card, p: Pt): string[] {
  if (c.display === "exit") return drawExit(g, c, p);
  if (c.display === "pill" && c.kind === "simple") return drawPill(g, c, p);
  const compact = c.display === "pill";
  const o: string[] = [];
  const box = `x="${n(p.x)}" y="${n(p.y)}" width="${c.w}" height="${c.h}" rx="${compact ? 7 : RADIUS}"`;
  if (compact) {
    o.push(`<rect class="pill" ${box}/>`);
    c.titleLines.forEach((line, j) => {
      o.push(text(g, `class="pill-text" x="${n(p.x + S.pad)}" y="${n(p.y + 18 + j * S.pillLh)}" font-size="${S.pillSize}"`, line, 500));
    });
  } else {
    const a = acc.of(c.accent);
    const dash = c.kind === "cable" ? ' stroke-dasharray="5 3"' : "";
    o.push(`<rect class="card" ${box} style="stroke:none"/>`);
    o.push(`<rect ${box} style="fill:${a};fill-opacity:var(--tint);stroke:${a};stroke-opacity:var(--edge-op);stroke-width:1"${dash}/>`);
    if (c.glyph) o.push(drawGlyph(c.glyph, p.x + 19, p.y + 16.5, a));
    c.titleLines.forEach((line, j) => {
      o.push(text(g, `x="${n(p.x + titleX(c.glyph))}" y="${n(p.y + 21 + j * S.titleLh)}" font-size="${S.titleSize}"`, line, 600));
    });
  }
  const subTop = p.y + 39 + (c.titleLines.length - 1) * S.titleLh;
  c.subLines.forEach((line, j) => {
    o.push(text(g, `class="muted" x="${n(p.x + 12)}" y="${n(subTop + j * S.subLh)}" font-size="${S.subSize}"`, line));
  });
  const swatch = c.rows.some((r) => r.colours) ? S.swatchW : 0;
  // A cable card's rows are drawn later, over the cores that pass through it.
  const rowSize = compact ? S.compactRowSize : S.rowSize;
  const numW = compact ? S.compactNumW : S.numW;
  if (c.kind !== "cable") c.rows.forEach((r, i) => {
    const ry = p.y + c.rowTop + i * c.rowH;
    const base = ry + c.rowH / 2 + rowSize * 0.36;
    if (i) o.push(`<line class="rule" x1="${n(p.x + 10)}" y1="${n(ry)}" x2="${n(p.x + c.w - 10)}" y2="${n(ry)}"/>`);
    if (r.fold) {
      o.push(text(g, `class="faint" x="${n(p.x + c.w / 2)}" y="${n(base)}" text-anchor="middle" font-size="${rowSize - 1}"`, r.fold, 400, true));
      return;
    }
    const used = c.ports.some((q) => q.id.startsWith(`${r.key}:`)) || c.loops.some((l) => l.includes(r.key));
    o.push(text(g, `class="${used ? "muted" : "faint"}" x="${n(p.x + numW - 8)}" y="${n(base)}" text-anchor="end" font-size="${rowSize - 1}"`, r.num));
    if (r.colours) o.push(...drawSwatch(p.x + numW + 8, ry + c.rowH / 2, r.colours));
    o.push(text(g, `${used ? "" : 'class="faint" '}x="${n(p.x + numW + 8 + swatch)}" y="${n(base)}" font-size="${rowSize}"`, r.label));
    if (r.detail) o.push(text(g, `class="faint" x="${n(p.x + c.w - 12)}" y="${n(base)}" text-anchor="end" font-size="${rowSize - 1}"`, r.detail));
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

/** A minor part: a borderless rounded pill in muted text. */
function drawPill(g: Glyphs, c: Card, p: Pt): string[] {
  const o = [`<rect class="pill" x="${n(p.x)}" y="${n(p.y)}" width="${c.w}" height="${c.h}" rx="5"/>`];
  const top = p.y + c.h / 2 - ((c.titleLines.length - 1) * S.pillLh) / 2 + S.pillSize * 0.36;
  c.titleLines.forEach((line, j) => {
    o.push(text(g, `class="pill-text" x="${n(p.x + c.w / 2)}" y="${n(top + j * S.pillLh)}" text-anchor="middle" font-size="${S.pillSize}"`, line, 500));
  });
  return o;
}

/** Where a run leaves the sheet: a tag whose east end is an arrow. */
function drawExit(g: Glyphs, c: Card, p: Pt): string[] {
  const { x, y } = p;
  const r = 6, t = S.exitTip, w = c.w, h = c.h;
  const d = `M${n(x + r)},${n(y)} H${n(x + w - t)} L${n(x + w)},${n(y + h / 2)} L${n(x + w - t)},${n(y + h)} H${n(x + r)} Q${n(x)},${n(y + h)} ${n(x)},${n(y + h - r)} V${n(y + r)} Q${n(x)},${n(y)} ${n(x + r)},${n(y)} Z`;
  return [
    `<path class="exit" d="${d}"/>`,
    text(g, `class="muted" x="${n(x + S.pad)}" y="${n(y + h / 2 + S.exitSize * 0.36)}" font-size="${S.exitSize}"`, c.title, 600),
  ];
}

/** A monoline P&ID-style symbol, 14 px across, centred on (cx, cy). */
function drawGlyph(name: Glyph, cx: number, cy: number, colour: string): string {
  const shapes: Record<Glyph, string> = {
    valve: `<path d="M-7,-4.5 L7,4.5 V-4.5 L-7,4.5 Z"/>`,
    pump: `<circle r="6.5"/><path d="M-3.2,-5.6 L6.5,0 L-3.2,5.6"/>`,
    filter: `<path d="M0,-7 L7,0 L0,7 L-7,0 Z"/><path d="M0,-7 V7" stroke-dasharray="1.6 1.6"/>`,
    heater: `<path d="M-7,0 H-5.2 L-3.4,-4.5 L-0.9,4.5 L1.6,-4.5 L4.1,4.5 L5.4,0 H7"/>`,
    tank: `<rect x="-5.5" y="-7" width="11" height="14" rx="2.5"/><path d="M-5.5,0.5 H5.5"/>`,
    trap: `<path d="M-5,-6.5 V0.5 A5,5 0 0 0 5,0.5 V-6.5"/>`,
    vent: `<path d="M0,7 V-6.5 M-4.5,-2 L0,-6.5 L4.5,-2"/>`,
    fixture: `<path d="M-6.5,-1.5 A6.5,6 0 0 1 6.5,-1.5 Z"/><path d="M-3.5,2 L-4.5,6 M0,2 V6.5 M3.5,2 L4.5,6"/>`,
  };
  return `<g class="glyph" transform="translate(${n(cx)},${n(cy)})" style="stroke:${colour}">${shapes[name]}</g>`;
}

/** A pin's colour marking: a small chip, split down the middle for a two-colour mark. */
function drawSwatch(x: number, cy: number, colours: string[]): string[] {
  const size = 8;
  const y = cy - size / 2;
  const [a, b] = colours;
  const kase = `casing${casing(a)}`;
  const o = [`<rect class="${kase}" x="${n(x)}" y="${n(y)}" width="${size}" height="${size}" rx="2" stroke-width="1" style="fill:${coreColour(a)}"/>`];
  if (b) o.push(`<path d="M${n(x + size)},${n(y)} V${n(y + size)} H${n(x)} Z" style="fill:${coreColour(b)}"/>`);
  return o;
}

/** Two connectors plugged together: a chain of dots, which no wire is drawn as. */
function drawMate(d: string): string[] {
  return [`<path class="mate" d="${d}" stroke-width="5" stroke-dasharray="0 8"/>`];
}

/** A bridge between two pins of one connector, drawn as a short grey wire looping off its side. */
function drawLoop(c: Card, p: Pt, [a, b]: [string, string]): string[] {
  const rowY = (key: string) => p.y + c.rowTop + c.rows.findIndex((r) => r.key === key) * c.rowH + c.rowH / 2;
  // Loop off whichever side has no wire on either pin, preferring the east. With wires on both
  // sides, the loop is a bracket inside the card's left margin instead, clear of every wire.
  const busy = (side: string) => c.ports.some((q) => q.side === side && (q.id === `${a}:${side}` || q.id === `${b}:${side}`));
  const inside = busy("E") && busy("W");
  const east = !busy("E");
  const x = inside ? p.x + 5 : east ? p.x + c.w : p.x;
  const out = inside ? p.x + 2 : east ? x + 14 : x - 14;
  if (inside) {
    const d = `M${n(x)},${n(rowY(a))} L${n(out)},${n(rowY(a))} L${n(out)},${n(rowY(b))} L${n(x)},${n(rowY(b))}`;
    return [`<path class="core" d="${d}" style="stroke:${WIRE.GY}" stroke-width="1.6"/>`];
  }
  const pts = [{ x, y: rowY(a) }, { x: out, y: rowY(a) }, { x: out, y: rowY(b) }, { x, y: rowY(b) }];
  const wire: Wire = { id: "loop", from: { card: c.id, port: a }, to: { card: c.id, port: b }, colours: ["GY"], weight: 2.5 };
  return [
    ...drawWire(path("poly", pts), wire),
    ...pts.filter((_, i) => i === 0 || i === 3).map((q) => `<circle class="port" cx="${n(q.x)}" cy="${n(q.y)}" r="3.2"/>`),
  ];
}

/** The extra casing class for a black or white core, which each theme outlines in its own colour. */
function casing(code: string): string {
  return code === "BK" ? " case-bk" : code === "WH" ? " case-wh" : "";
}

/**
 * A core's stroke, from a colour code or a hex value. Black and white follow the theme, so neither
 * matches the ground it's drawn on.
 */
function coreColour(code: string): string {
  if (code.startsWith("#")) return code;
  if (code === "BK") return "var(--core-bk)";
  if (code === "WH") return "var(--core-wh)";
  return WIRE[code] ?? WIRE.GY;
}

function drawWire(d: string, w: Wire): string[] {
  const [c1, c2] = w.colours;
  const kase = casing(c1);
  const o = [
    `<path class="casing${kase}" d="${d}" stroke-width="${n(w.weight + 2 * CASING)}"/>`,
    `<path class="core" d="${d}" style="stroke:${coreColour(c1)}" stroke-width="${n(w.weight)}"/>`,
  ];
  if (c2) o.push(`<path class="core" d="${d}" style="stroke:${coreColour(c2)}" stroke-width="${n(w.weight / 2)}" stroke-dasharray="12 7"/>`);
  return o;
}

/**
 * A pipe label as plain text: above a horizontal run, centred where the tag would sit, or beside a
 * vertical one. A halo in the ground colour keeps it legible over any line it crosses.
 */
function drawLabel(g: Glyphs, acc: Palette, pts: Pt[], at: Pt, w: Wire): string {
  const c = nearest(pts, at);
  let dx = 1, dy = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const within = Math.min(a.x, b.x) - 0.5 <= c.x && c.x <= Math.max(a.x, b.x) + 0.5 && Math.min(a.y, b.y) - 0.5 <= c.y && c.y <= Math.max(a.y, b.y) + 0.5;
    if (within && (a.x !== b.x || a.y !== b.y)) [dx, dy] = [b.x - a.x, b.y - a.y];
    if (within) break;
  }
  // The label takes its run's colour, so it reads as belonging to that line; a grey run's is muted.
  const code = w.colours[0];
  const colour = code?.startsWith("#") ? code : code && code !== "GY" ? WIRE[code] : undefined;
  const paint = colour ? `class="label" style="fill:${acc.of(colour)}"` : 'class="label muted"';
  const off = w.weight / 2 + S.labelGap;
  const attrs = Math.abs(dx) >= Math.abs(dy)
    ? `x="${n(c.x)}" y="${n(c.y - off - 1)}" text-anchor="middle"`
    : `x="${n(c.x + off + 1)}" y="${n(c.y + S.labelSize * 0.36)}"`;
  return text(g, `${paint} ${attrs} font-size="${S.labelSize}"`, w.tag!.text, 500);
}

function drawTag(g: Glyphs, c: Pt, label: string, w: number): string[] {
  return [
    `<rect class="tag" x="${n(c.x - w / 2)}" y="${n(c.y - S.tagH / 2)}" width="${n(w)}" height="${S.tagH}" rx="${S.tagH / 2}"/>`,
    text(g, `x="${n(c.x)}" y="${n(c.y + S.tagSize * 0.36)}" text-anchor="middle" font-size="${S.tagSize}"`, label, 500),
  ];
}

/**
 * The point on a route closest to `p`. A layout engine puts a label beside its wire; a tag sits
 * on the wire it describes, so it can't be read as belonging to the next one along.
 */
export function nearest(route: Pt[], p: Pt): Pt {
  let best = route[0];
  let bestD = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
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
  const block = (re: RegExp) => Object.fromEntries([...(re.exec(svg)?.[1] ?? "").matchAll(/--([a-z0-9-]+):([^;}]+)/g)].map((m) => [m[1], m[2]]));
  const t: Record<string, string> = theme === "dark"
    ? { ...block(/@media \(prefers-color-scheme: dark\)\{svg\{([^}]*)\}\}/), ...THEMES.dark }
    : { ...block(/\nsvg\{([^}]*)\}/), ...THEMES.light };
  return svg
    .replace(/@media \(prefers-color-scheme: dark\)\{svg\{[^}]*\}\}/, "")
    .replace(/var\(--([a-z0-9-]+)\)/g, (_, k: string) => t[k]);
}
