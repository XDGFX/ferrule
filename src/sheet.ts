// Turns a harness into what gets laid out: sized cards with fixed ports, and the wires between
// them. Both layout engines start from this, so any difference in their output is layout alone.

import { textWidth } from "./measure.ts";
import type { Cable, Connector, Harness } from "./model.ts";

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
  subSize: 10.5,
  rowSize: 11.5,
  noteSize: 10,
  noteLh: 14,
  tagSize: 10,
  tagH: 17,
  foldFrom: 3,
};

export interface Row {
  key: string;
  num: string;
  label: string;
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
  sub: string;
  accent: string;
  w: number;
  h: number;
  rowTop: number;
  rowH: number;
  rows: Row[];
  notes: string[];
  ports: Port[];
}

export interface Tag {
  text: string;
  w: number;
  h: number;
}

export interface Wire {
  id: string;
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
}

/** Line weight for a conductor size in mm², so a 50 mm² run looks like one. */
export function weight(gauge: number | null): number {
  const w = gauge == null ? 0 : 2 + 0.75 * Math.sqrt(gauge);
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

  for (const [i, l] of h.links.entries()) {
    const c = cables.get(l.cable)!;
    const core = c.wires[l.wire - 1];
    const base = { colours: core.colours.length ? core.colours : ["GY"], weight: weight(c.gauge) };
    if (c.wires.length === 1) {
      if (!l.from || !l.to) throw new Error(`${c.template}: a single-core run needs both ends`);
      wires.push({
        id: `w${i}`,
        from: touch(l.from.connector, l.from.pin, "E"),
        to: touch(l.to.connector, l.to.pin, "W"),
        ...base,
        tag: tag(c),
      });
      continue;
    }
    const key = String(l.wire);
    if (l.from) wires.push({ id: `w${i}a`, from: touch(l.from.connector, l.from.pin, "E"), to: touch(c.id, key, "W"), ...base });
    if (l.to) wires.push({ id: `w${i}b`, from: touch(c.id, key, "E"), to: touch(l.to.connector, l.to.pin, "W"), ...base });
  }

  const cards: Card[] = [];
  for (const c of h.connectors) cards.push(connectorCard(c, used.get(c.id) ?? new Map()));
  for (const c of h.cables) if (c.wires.length > 1) cards.push(cableCard(c, used.get(c.id) ?? new Map()));
  return { title: h.title, cards, wires };
}

function tag(c: Cable): Tag | undefined {
  const text = cableSpec(c);
  if (!text) return undefined;
  return { text, w: tagWidth(text), h: STYLE.tagH };
}

/** Width of a pill-shaped tag holding `text`. */
export function tagWidth(text: string): number {
  return Math.ceil(textWidth(text, STYLE.tagSize, 500) + 16);
}

/** Size and length, such as `50 mm² · 1.5 m`, leaving out whichever the YAML doesn't give. */
function cableSpec(c: Cable): string {
  return [c.gauge == null ? "" : `${fmt(c.gauge)} mm²`, c.length].filter(Boolean).join(" · ");
}

function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

function connectorCard(c: Connector, used: Map<string, Set<Side>>): Card {
  const sub = [c.type, c.subtype].filter(Boolean).join(" · ");
  if (c.simple) {
    const w = width([textWidth(c.id, STYLE.titleSize, 600) + 40, textWidth(sub, STYLE.subSize) + 24]);
    const card = base(c.id, "simple", c.id, sub, c.accent, w, [], []);
    card.h = STYLE.simpleH;
    card.ports = ports(used, card, () => STYLE.simpleH / 2);
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
    const row = { key: p.num, num: p.num, label: p.label || p.num };
    if (used.has(p.num)) {
      flush();
      rows.push(row);
    } else run.push(row);
  }
  flush();
  return finish(base(c.id, "connector", c.id, sub, c.accent, 0, rows, c.notes), used);
}

function cableCard(c: Cable, used: Map<string, Set<Side>>): Card {
  const title = c.id.startsWith("__") ? c.template : c.id;
  const sub = [c.type, cableSpec(c)].filter(Boolean).join(" · ");
  const rows = c.wires.map((w) => ({ key: String(w.index), num: String(w.index), label: w.label }));
  return finish(base(c.id, "cable", title, sub, c.accent, 0, rows, c.notes), used);
}

function base(id: string, kind: Card["kind"], title: string, sub: string, accent: string, w: number, rows: Row[], notes: string[]): Card {
  return { id, kind, title, sub, accent, w, h: 0, rowTop: STYLE.headH, rowH: STYLE.rowH, rows, notes, ports: [] };
}

function finish(card: Card, used: Map<string, Set<Side>>): Card {
  const s = STYLE;
  card.w = width([
    textWidth(card.title, s.titleSize, 600) + 28 + s.pad,
    textWidth(card.sub, s.subSize) + 2 * s.pad,
    ...card.rows.map((r) => (r.fold ? textWidth(r.fold, s.rowSize - 1) + 2 * s.pad : s.numW + 8 + textWidth(r.label, s.rowSize) + 34)),
  ]);
  card.notes = wrap(card.notes, card.w - 2 * s.pad);
  card.h = s.headH + card.rows.length * s.rowH + (card.notes.length ? 10 + card.notes.length * s.noteLh : 0);
  card.ports = ports(used, card, (key) => {
    const i = card.rows.findIndex((r) => r.key === key);
    return card.rowTop + i * card.rowH + card.rowH / 2;
  });
  return card;
}

function ports(used: Map<string, Set<Side>>, card: Card, y: (key: string) => number): Port[] {
  const keys = [...used.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return keys.flatMap((key) =>
    (["W", "E"] as const).filter((s) => used.get(key)!.has(s)).map((side) => ({ id: `${key}:${side}`, side, x: side === "W" ? 0 : card.w, y: y(key) })),
  );
}

function width(candidates: number[]): number {
  const w = Math.max(STYLE.minW, ...candidates);
  return Math.min(STYLE.maxW, Math.ceil(w / 2) * 2);
}

function wrap(notes: string[], max: number): string[] {
  const out: string[] = [];
  for (const note of notes) {
    let line = "";
    for (const word of note.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, STYLE.noteSize) > max) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
