// Turns a harness into what gets laid out: sized cards with fixed ports, and the wires between
// them. Both layout engines start from this, so any difference in their output is layout alone.

import { textWidth } from "./measure.ts";
import type { Cable, Connector, Display, Glyph, Harness } from "./model.ts";

/** The Instrument style's fixed dimensions, in px. */
export const STYLE = {
  headH: 56,
  rowH: 24,
  simpleH: 48,
  numW: 30,
  pad: 12,
  minW: 150,
  maxW: 300,
  titleSize: 13,
  titleLh: 16,
  subSize: 10.5,
  rowSize: 11.5,
  noteSize: 10,
  noteLh: 14,
  subLh: 13,
  tagSize: 10,
  tagH: 17,
  foldFrom: 3,
  /** Room a pin's colour swatch takes before its label, on a card where any pin has one. */
  swatchW: 14,
  /** Where a card's title starts: past the glyph, when the card has one. */
  titleX: 14,
  glyphTitleX: 34,
  /** A pill: one compact, borderless line for a minor part such as a fitting. */
  pillH: 22,
  pillSize: 10.5,
  pillLh: 13,
  /** A compact card for a minor part with ports, such as a tee. */
  compactHeadH: 28,
  compactRowH: 20,
  compactRowSize: 10.5,
  compactMinW: 120,
  compactNumW: 24,
  /** An exit tag: an arrow-ended label where a run leaves the sheet. */
  exitH: 26,
  exitSize: 11,
  exitTip: 11,
  /** A run's label, as plain text above the run: its size, and its gap from the line. */
  labelSize: 10,
  labelGap: 4,
};

export interface Row {
  key: string;
  num: string;
  label: string;
  /** Colour codes for the pin's marking, one per stripe. */
  colours?: string[];
  /** Muted text at the row's end, such as a port's thread and gender. */
  detail?: string;
  /** Set on a row that stands in for a run of unused pins. */
  fold?: string;
}

export type Side = "W" | "E";

export interface Port {
  id: string;
  side: Side;
  x: number;
  y: number;
}

export interface Card {
  id: string;
  kind: "connector" | "simple" | "cable";
  title: string;
  /** The title, wrapped to the card. Only a title wider than the widest card takes two lines. */
  titleLines: string[];
  /** Type and subtype, wrapped to the card. */
  subLines: string[];
  accent: string;
  w: number;
  h: number;
  rowTop: number;
  rowH: number;
  rows: Row[];
  /** Pins bridged on the card itself, by row key. */
  loops: [string, string][];
  notes: string[];
  ports: Port[];
  /** A full card, a compact pill for a minor part, or an arrow-ended exit tag. */
  display: Display;
  /** A symbol before the title, on a full card only. */
  glyph?: Glyph;
}

export interface Tag {
  text: string;
  w: number;
  h: number;
}

export interface Wire {
  id: string;
  /** A mate is two connectors plugged together, drawn between their title bars. */
  kind?: "mate";
  /** The wire doubles back, leaving both ends on their east side. */
  returns?: boolean;
  from: { card: string; port: string };
  to: { card: string; port: string };
  colours: string[];
  weight: number;
  tag?: Tag;
}

export interface Sheet {
  title: string;
  cards: Card[];
  wires: Wire[];
  /** The aspect ratio to aim for when wrapping into rows. Absent, the sheet stays one row. */
  wrap?: number;
}

/**
 * Line weight for a conductor size in mm², so a 50 mm² run looks like one, or for a pipe's bore in
 * mm, which grows faster so a pipe reads heavier than any cable.
 */
export function weight(gauge: number | null, bore: number | null = null): number {
  const w = bore != null ? 2 + 0.25 * bore : gauge == null ? 0 : 2 + 0.75 * Math.sqrt(gauge);
  return Math.round(Math.max(3, w) * 10) / 10;
}

export function buildSheet(h: Harness): Sheet {
  const wires: Wire[] = [];
  const used = new Map<string, Map<string, Set<Side>>>();
  const touch = (card: string, key: string, side: Side) => {
    if (!used.has(card)) used.set(card, new Map());
    const m = used.get(card)!;
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(side);
    return { card, port: `${key}:${side}` };
  };
  const cables = new Map(h.cables.map((c) => [c.id, c]));
  // A single core joining two pins is a run, drawn as one wire with a tag. One that splits, or
  // ends open, needs somewhere for its branches to meet, so it gets a card like a multi-core.
  const uses = new Map<string, number>();
  for (const l of h.links) uses.set(l.cable, (uses.get(l.cable) ?? 0) + 1);
  const isRun = (c: Cable) => c.wires.length === 1 && uses.get(c.id) === 1 && h.links.some((l) => l.cable === c.id && l.from && l.to);

  for (const [i, l] of h.links.entries()) {
    const c = cables.get(l.cable)!;
    const core = c.wires[l.wire - 1];
    const base = { colours: core.colours.length ? core.colours : ["GY"], weight: weight(c.gauge, c.bore ?? null) };
    if (isRun(c) && l.from && l.to) {
      wires.push({
        id: `w${i}`,
        from: touch(l.from.connector, l.from.pin, "E"),
        to: touch(l.to.connector, l.to.pin, l.returns ? "E" : "W"),
        ...(l.returns && { returns: true }),
        ...base,
        tag: tag(c, base.weight),
      });
      continue;
    }
    const key = String(l.wire);
    if (l.from) wires.push({ id: `w${i}a`, from: touch(l.from.connector, l.from.pin, "E"), to: touch(c.id, key, "W"), ...base });
    if (l.to) wires.push({ id: `w${i}b`, from: touch(c.id, key, "E"), to: touch(l.to.connector, l.to.pin, "W"), ...base });
  }

  for (const [i, m] of h.mates.entries()) {
    wires.push({ id: `m${i}`, kind: "mate", from: touch(m.from, "mate", "E"), to: touch(m.to, "mate", "W"), colours: [], weight: 0 });
  }

  // Templates drawn as more than one autogenerated card, whose titles need a number.
  const drawn = [...h.connectors, ...h.cables.filter((c) => !isRun(c))].filter((c) => c.id.startsWith("__"));
  const repeated = new Set(drawn.map((c) => c.template).filter((t, i, all) => all.indexOf(t) !== all.lastIndexOf(t)));

  const cards: Card[] = [];
  for (const c of h.connectors) {
    const pins = used.get(c.id) ?? new Map<string, Set<Side>>();
    // A looped pin is in use even with no wire on it, so it isn't folded away.
    const inUse = new Set([...pins.keys(), ...c.loops.flat()]);
    cards.push(connectorCard(c, pins, inUse, repeated));
  }
  for (const c of h.cables) if (!isRun(c)) cards.push(cableCard(c, used.get(c.id) ?? new Map(), repeated));
  return { title: h.title, cards, wires, ...(h.wrap ? { wrap: h.wrap } : {}) };
}

/**
 * A run's label. It's drawn as plain text just above the line, so the layout reserves its height
 * on both sides: the line stays centred in the space and the text clears whatever is above.
 */
function tag(c: Cable, weight: number): Tag | undefined {
  const text = [c.label ?? "", cableSpec(c)].filter(Boolean).join(" · ");
  if (!text) return undefined;
  const above = weight / 2 + STYLE.labelGap + STYLE.labelSize;
  return { text, w: Math.ceil(textWidth(text, STYLE.labelSize, 500) + 8), h: Math.ceil(2 * above) };
}

/** Width of a pill-shaped tag holding `text`, as a cable card labels each core. */
export function tagWidth(text: string): number {
  return Math.ceil(textWidth(text, STYLE.tagSize, 500) + 16);
}

/** Size and length, such as `50 mm² · 1.5 m`, leaving out whichever the YAML doesn't give. */
function cableSpec(c: Cable): string {
  return [c.gauge == null ? "" : `${fmt(c.gauge)} mm²`, c.length].filter(Boolean).join(" · ");
}

export function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * A card's title. An autogenerated instance (`__REAR_LIGHT_2`) shows its template and number,
 * `REAR_LIGHT · 2`, so two of the same part can be told apart. A part drawn once is just its
 * template.
 */
export function displayName(id: string, template: string, repeated: Set<string>): string {
  const m = /^__.+_(\d+)$/.exec(id);
  if (!m) return id;
  return repeated.has(template) ? `${template} · ${m[1]}` : template;
}

function connectorCard(c: Connector, used: Map<string, Set<Side>>, inUse: Set<string>, repeated: Set<string>): Card {
  const sub = [c.type, c.subtype].filter(Boolean).join(" · ");
  const title = c.label || displayName(c.id, c.template, repeated);
  const display = c.display ?? "card";
  if (display === "exit") return exitCard(c, title, used);
  if (display === "pill" && c.simple) return pillCard(c, title, used);
  if (c.simple) {
    const room = titleX(c.glyph) + STYLE.pad;
    const w = width([textWidth(title, STYLE.titleSize, 600) + room, textWidth(sub, STYLE.subSize) + 24]);
    const card = base(c.id, "simple", title, sub, c.accent, w, [], []);
    if (c.glyph) card.glyph = c.glyph;
    card.titleLines = wrapTitle(title, w - room);
    card.subLines = wrap([sub], w - 24, STYLE.subSize);
    card.h = STYLE.simpleH + extraHead(card);
    card.ports = ports(used, card, () => card.h / 2);
    return card;
  }
  const rows: Row[] = [];
  let run: Row[] = [];
  const flush = () => {
    if (run.length >= STYLE.foldFrom) {
      const a = run[0].num, b = run[run.length - 1].num;
      rows.push({ key: `fold-${a}`, num: "", label: "", fold: `${a}–${b} · ${run.length} unused` });
    } else rows.push(...run);
    run = [];
  };
  for (const p of c.pins) {
    const row: Row = { key: p.num, num: p.num, label: p.label || p.num };
    if (p.colours.length) row.colours = p.colours;
    if (p.detail) row.detail = p.detail;
    if (inUse.has(p.num)) {
      flush();
      rows.push(row);
    } else run.push(row);
  }
  flush();
  if (display === "pill") return compactCard(base(c.id, "connector", title, "", c.accent, 0, rows, []), used);
  const card = base(c.id, "connector", title, sub, c.accent, 0, rows, c.notes);
  card.loops = c.loops;
  if (c.glyph) card.glyph = c.glyph;
  return finish(card, used);
}

/** Where a full card's title starts, given its glyph. */
export function titleX(glyph?: Glyph): number {
  return glyph ? STYLE.glyphTitleX : STYLE.titleX;
}

/** A minor simple part as a single borderless line, wrapping only when wider than a card. */
function pillCard(c: Connector, title: string, used: Map<string, Set<Side>>): Card {
  const s = STYLE;
  const w = Math.min(s.maxW, Math.ceil(textWidth(title, s.pillSize, 500) + 2 * s.pad));
  const card = base(c.id, "simple", title, "", c.accent, w, [], []);
  card.display = "pill";
  card.titleLines = wrap([title], w - 2 * s.pad, s.pillSize, 500);
  card.h = s.pillH + (card.titleLines.length - 1) * s.pillLh;
  card.ports = ports(used, card, () => card.h / 2);
  return card;
}

/** A minor part with ports: a short title line and tight rows, no subtitle or notes. */
function compactCard(card: Card, used: Map<string, Set<Side>>): Card {
  const s = STYLE;
  card.display = "pill";
  const numW = s.compactNumW;
  card.w = Math.min(s.maxW, Math.ceil(Math.max(
    s.compactMinW,
    textWidth(card.title, s.pillSize, 500) + 2 * s.pad,
    ...card.rows.map((r) => (r.fold ? textWidth(r.fold, s.compactRowSize - 1, 400, true) + 2 * s.pad : numW + 8 + textWidth(r.label, s.compactRowSize) + 24 + (r.detail ? textWidth(r.detail, s.compactRowSize - 1) + 12 : 0))),
  ) / 2) * 2);
  card.titleLines = wrap([card.title], card.w - 2 * s.pad, s.pillSize, 500);
  card.rowTop = s.compactHeadH + (card.titleLines.length - 1) * s.pillLh;
  card.rowH = s.compactRowH;
  card.h = card.rowTop + card.rows.length * card.rowH + 2;
  card.ports = ports(used, card, (key) => card.rowTop + card.rows.findIndex((r) => r.key === key) * card.rowH + card.rowH / 2);
  return card;
}

/** Where a run leaves the sheet: an arrow-ended tag, every port on its centre line. */
function exitCard(c: Connector, title: string, used: Map<string, Set<Side>>): Card {
  const s = STYLE;
  const w = Math.ceil(textWidth(title, s.exitSize, 600) + 2 * s.pad + s.exitTip);
  const card = base(c.id, "simple", title, "", c.accent, w, [], []);
  card.display = "exit";
  card.h = s.exitH;
  card.ports = ports(used, card, () => card.h / 2);
  return card;
}

function cableCard(c: Cable, used: Map<string, Set<Side>>, repeated: Set<string>): Card {
  const title = c.label || displayName(c.id, c.template, repeated);
  const sub = [c.type, cableSpec(c)].filter(Boolean).join(" · ");
  const rows = c.wires.map((w) => ({ key: String(w.index), num: String(w.index), label: w.label }));
  return finish(base(c.id, "cable", title, sub, c.accent, 0, rows, c.notes), used);
}

function base(id: string, kind: Card["kind"], title: string, sub: string, accent: string, w: number, rows: Row[], notes: string[]): Card {
  return { id, kind, title, titleLines: [title], subLines: sub ? [sub] : [], accent, w, h: 0, rowTop: STYLE.headH, rowH: STYLE.rowH, rows, loops: [], notes, ports: [], display: "card" };
}

/** How much a wrapped title and subtitle deepen the header: one line of each fits as standard. */
function extraHead(card: Card): number {
  return (card.titleLines.length - 1) * STYLE.titleLh + Math.max(0, card.subLines.length - 1) * STYLE.subLh;
}

function finish(card: Card, used: Map<string, Set<Side>>): Card {
  const s = STYLE;
  const swatch = card.rows.some((r) => r.colours) ? s.swatchW : 0;
  const notes = paragraphs(card.notes);
  // Notes may widen a card up to its limit, so they wrap less and the card stays shorter.
  card.w = width([
    textWidth(card.title, s.titleSize, 600) + titleX(card.glyph) + s.pad,
    ...card.subLines.map((l) => textWidth(l, s.subSize) + 2 * s.pad),
    ...card.rows.map((r) => (r.fold ? textWidth(r.fold, s.rowSize - 1, 400, true) + 2 * s.pad : s.numW + 8 + swatch + textWidth(r.label, s.rowSize) + 34 + (r.detail ? textWidth(r.detail, s.rowSize - 1) + 16 : 0))),
    ...notes.map((n) => textWidth(n, s.noteSize) + 2 * s.pad),
  ]);
  card.titleLines = wrapTitle(card.title, card.w - titleX(card.glyph) - s.pad);
  card.subLines = wrap(card.subLines, card.w - 2 * s.pad, s.subSize);
  card.notes = wrap(notes, card.w - 2 * s.pad, s.noteSize);
  card.rowTop = s.headH + extraHead(card);
  card.h = card.rowTop + card.rows.length * s.rowH + (card.notes.length ? 10 + card.notes.length * s.noteLh : 0);
  card.ports = ports(used, card, (key) => {
    if (key === "mate") return card.rowTop / 2;
    const i = card.rows.findIndex((r) => r.key === key);
    return card.rowTop + i * card.rowH + card.rowH / 2;
  });
  return card;
}

function ports(used: Map<string, Set<Side>>, card: Card, y: (key: string) => number): Port[] {
  // The mate port sits in the title bar, above every pin, so it sorts first.
  const rank = (k: string) => (k === "mate" ? -1 : Number(k));
  const keys = [...used.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return keys.flatMap((key) =>
    (["W", "E"] as const).filter((s) => used.get(key)!.has(s)).map((side) => ({ id: `${key}:${side}`, side, x: side === "W" ? 0 : card.w, y: y(key) })),
  );
}

function width(candidates: number[]): number {
  const w = Math.max(STYLE.minW, ...candidates);
  return Math.min(STYLE.maxW, Math.ceil(w / 2) * 2);
}

/**
 * Source lines rejoined where the author wrapped a sentence by hand, which wrapping again line by
 * line would leave as orphans. Only a line starting in lowercase continues the one before: a
 * capital, a bullet or a number starts a new item, and those line breaks are deliberate.
 */
function paragraphs(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (out.length && /^\p{Ll}/u.test(line)) out[out.length - 1] += ` ${line}`;
    else out.push(line);
  }
  return out;
}

/** A title wrapped to `max`, keeping an instance's ` · 2` with the word before it. */
function wrapTitle(title: string, max: number): string[] {
  return wrap([title.replace(/ · /g, "\u00a0·\u00a0")], max, STYLE.titleSize, 600).map((l) => l.replace(/\u00a0/g, " "));
}

function wrap(texts: string[], max: number, size: number, fontWeight = 400): string[] {
  const out: string[] = [];
  for (const text of texts) {
    let line = "";
    for (const word of text.split(/[ \t\n\r]+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, fontWeight) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
