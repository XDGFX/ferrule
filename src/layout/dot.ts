// The fallback: Graphviz dot for layout only, read back through -Tjson and drawn by us.
//
// Every card becomes an HTML table of fixed-size empty cells, with a port cell at each end of
// each row, so dot sees the same geometry ELK does and never measures any text itself.

import { execFileSync } from "node:child_process";
import type { Card, Sheet } from "../sheet.ts";
import type { Placement, Pt, Route } from "./types.ts";

export const DOT_GRAPH = 'rankdir=LR, splines=true, nodesep=0.45, ranksep=0.9, pad=0.33';

export function toDot(sheet: Sheet): string {
  const portName = new Map<string, string>();
  const lines = [`digraph G {`, `  graph [${DOT_GRAPH}];`, `  node [shape=plain];`, `  edge [arrowhead=none];`];
  for (const c of sheet.cards) lines.push(`  "${c.id}" [label=<${table(c, portName)}>];`);
  for (const w of sheet.wires) {
    const a = portName.get(`${w.from.card}/${w.from.port}`);
    const b = portName.get(`${w.to.card}/${w.to.port}`);
    const label = w.tag ? `, label=<${box(w.tag.w, w.tag.h)}>` : "";
    lines.push(`  "${w.from.card}":${a}:e -> "${w.to.card}":${b}:w [id="${w.id}"${label}];`);
  }
  lines.push("}");
  return lines.join("\n");
}

function box(w: number, h: number): string {
  return `<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0"><TR>${cell(w, h)}</TR></TABLE>`;
}

function cell(w: number, h: number, port = "", span = 1): string {
  const p = port ? ` PORT="${port}"` : "";
  const s = span > 1 ? ` COLSPAN="${span}"` : "";
  return `<TD${p}${s} WIDTH="${w}" HEIGHT="${h}" FIXEDSIZE="TRUE"></TD>`;
}

function table(c: Card, portName: Map<string, string>): string {
  const name = (key: string, side: string) => {
    const id = `${key}:${side}`;
    if (!c.ports.some((p) => p.id === id)) return "";
    const n = `p${portName.size}`;
    portName.set(`${c.id}/${id}`, n);
    return n;
  };
  const row = (key: string, h: number) =>
    `<TR>${cell(1, h, name(key, "W"))}${cell(c.w - 2, h)}${cell(1, h, name(key, "E"))}</TR>`;
  const rows: string[] = [];
  if (c.kind === "simple") rows.push(row("1", c.h));
  else {
    rows.push(`<TR>${cell(c.w, c.rowTop, "", 3)}</TR>`);
    for (const r of c.rows) rows.push(row(r.key, c.rowH));
    const rest = c.h - c.rowTop - c.rows.length * c.rowH;
    if (rest > 0) rows.push(`<TR>${cell(c.w, rest, "", 3)}</TR>`);
  }
  return `<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0">${rows.join("")}</TABLE>`;
}

interface DotJson {
  bb: string;
  objects: { name: string; pos: string; width: string; height: string }[];
  edges?: { id: string; lp?: string; _draw_: { op: string; points?: [number, number][] }[] }[];
}

export function layoutDot(sheet: Sheet): Placement {
  const json: DotJson = JSON.parse(execFileSync("dot", ["-Tjson"], { input: toDot(sheet), encoding: "utf8" }));
  const [, , W, H] = json.bb.split(",").map(Number);
  const flip = ([x, y]: number[]): Pt => ({ x, y: H - y });
  const cards = new Map<string, Pt>();
  for (const o of json.objects) {
    const c = flip(o.pos.split(",").map(Number));
    const card = sheet.cards.find((k) => k.id === o.name)!;
    cards.set(o.name, { x: c.x - card.w / 2, y: c.y - card.h / 2 });
  }
  const routes = new Map<string, Route>();
  for (const e of json.edges ?? []) {
    const b = e._draw_.find((d) => d.op === "b")!;
    routes.set(e.id, {
      kind: "bezier",
      points: b.points!.map(flip),
      tag: e.lp ? flip(e.lp.split(",").map(Number)) : undefined,
    });
  }
  return { engine: "dot", width: W, height: H, cards, routes };
}
