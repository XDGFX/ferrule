// Reads a subset of WireViz YAML into the harness model.
//
// Supported: prepended files (the text is concatenated, so anchors cross files), `<<` merge keys,
// `pinlabels`/`pincount`/`pincolors`, `loops`, `style: simple`, `X.Y` named instances, `X.` fresh
// instances, pin ranges such as `1-4`, and connection sets that alternate connector and cable,
// may start or end with a cable, and may mate two connectors with an `==` arrow. Where the fork
// and this reader could disagree, this follows the fork: see wireviz.py's parse() and connect().

import { parse } from "yaml";
import { hex, stripes } from "./colours.ts";
import { readWrap, type Cable, type Connector, type End, type Harness, type Link, type Mate } from "./model.ts";

type Yaml = Record<string, any>;

export function readWireviz(sources: string[], title: string): Harness {
  // uniqueKeys off: the fork loads with PyYAML, which keeps the last of a duplicated key.
  const doc: Yaml = parse(sources.join("\n"), { merge: true, maxAliasCount: -1, uniqueKeys: false }) ?? {};
  const connectorDefs: Yaml = doc.connectors ?? {};
  const cableDefs: Yaml = doc.cables ?? {};

  const connectors = new Map<string, Connector>();
  const cables = new Map<string, Cable>();
  const fresh = new Map<string, number>();
  const links: Link[] = [];

  function instance(designator: string): { kind: "connector" | "cable"; id: string } {
    const dot = designator.indexOf(".");
    const template = dot < 0 ? designator : designator.slice(0, dot);
    let id = dot < 0 ? designator : designator.slice(dot + 1);
    if (dot >= 0 && id === "") {
      const n = (fresh.get(template) ?? 0) + 1;
      fresh.set(template, n);
      id = `__${template}_${n}`;
    }
    if (template in connectorDefs) {
      if (!connectors.has(id)) connectors.set(id, connector(id, template, connectorDefs[template] ?? {}));
      return { kind: "connector", id };
    }
    if (template in cableDefs) {
      if (!cables.has(id)) cables.set(id, cable(id, template, cableDefs[template] ?? {}));
      return { kind: "cable", id };
    }
    throw new Error(`${designator}: no connector or cable is defined as ${template}`);
  }

  const mates: Mate[] = [];

  // Follows the fork's parse(): every entry becomes one column of `count` items, a string is
  // repeated down its column and connects pin 1, and the columns are then read row by row.
  for (const set of doc.connections ?? []) {
    const entries = set as unknown[];
    const lengths = entries.flatMap((e) =>
      Array.isArray(e) ? [e.length] : e && typeof e === "object" ? [expand(Object.values(e)[0]).length] : [],
    );
    const count = lengths[0] ?? 1;
    if (lengths.some((n) => n !== count)) {
      throw new Error(`${names(entries)}: every item in a connection set must reference the same number of connections`);
    }
    const columns: Item[][] = entries.map((e) => {
      if (typeof e === "string") return Array.from({ length: count }, () => item(e, 1));
      if (Array.isArray(e)) return e.map((d) => item(String(d), 1));
      // One instance for the whole entry: `TWIN.: [1, 2]` is both cores of one new cable.
      const [designator, refs] = Object.entries(e as Yaml)[0];
      const one = item(designator, 0);
      return expand(refs).map((ref) => ({ ...one, ref }));
    });
    columns.forEach((col, i) => {
      if (i && (col[0].kind === "connector") === (columns[i - 1][0].kind === "connector")) {
        throw new Error(`${names(entries)}: a connection set must alternate connector and cable`);
      }
    });

    for (let k = 0; k < count; k++) {
      const row = columns.map((col) => col[k]);
      const end = (it: Item | undefined): End | null => {
        if (!it) return null;
        const conn = connectors.get(it.id)!;
        return { connector: conn.id, pin: pinNum(conn, it.ref) };
      };
      row.forEach((it, i) => {
        if (it.kind === "cable") {
          const c = cables.get(it.id)!;
          links.push({ cable: c.id, wire: wireIndex(c, it.ref), from: end(row[i - 1]), to: end(row[i + 1]) });
        } else if (it.kind === "arrow") {
          const from = row[i - 1], to = row[i + 1];
          if (!from || !to) throw new Error(`${names(entries)}: an arrow needs a connector on each side`);
          // Only a whole-component mate is supported; the fork draws it once, from the first row.
          if (!it.id.includes("=")) throw new Error(`${names(entries)}: pin-by-pin mates (${it.id}) are not supported`);
          if (k === 0) mates.push({ from: from.id, to: to.id });
        }
      });
    }
  }

  function item(designator: string, ref: string | number): Item {
    if (ARROW.test(designator)) return { kind: "arrow", id: designator.trim(), ref };
    return { ...instance(designator), ref };
  }

  const wrap = readWrap(doc.diagram?.wrap);
  return { title, connectors: [...connectors.values()], cables: [...cables.values()], links, mates, ...(wrap ? { wrap } : {}) };
}

/** One cell of a connection set: a component, or an arrow, and what it references in this row. */
interface Item {
  kind: "connector" | "cable" | "arrow";
  id: string;
  ref: string | number;
}

/** WireViz arrows: a run of `-` or of `=`, optionally headed with `<` and `>`. */
const ARROW = /^\s*<?(-+|=+)>?\s*$/;

/** WireViz's expand: a scalar or a list, where `a-b` between two integers is an inclusive range. */
export function expand(value: unknown): (string | number)[] {
  const out: (string | number)[] = [];
  for (const raw of Array.isArray(value) ? value : [value]) {
    const e = String(raw);
    const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(e);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      const step = a <= b ? 1 : -1;
      for (let x = a; x !== b + step; x += step) out.push(x);
    } else out.push(/^-?\d+$/.test(e.trim()) ? Number(e) : e);
  }
  return out;
}

function names(entries: unknown[]): string {
  return entries.map((e) => (typeof e === "string" ? e : Array.isArray(e) ? `[${e.join(", ")}]` : Object.keys(e as Yaml)[0])).join(" → ");
}

function connector(id: string, template: string, def: Yaml): Connector {
  const simple = def.style === "simple";
  const labels: string[] = (def.pinlabels ?? []).map(String);
  const marks: string[] = (def.pincolors ?? []).map((c: unknown) => (c == null ? "" : String(c)));
  const count = simple ? 1 : Number(def.pincount ?? 0) || Math.max(labels.length, marks.length);
  if (labels.length > count) throw new Error(`${id}: ${labels.length} pin labels for ${count} pin(s)`);
  return {
    id,
    template,
    type: String(def.type ?? ""),
    subtype: String(def.subtype ?? ""),
    pins: Array.from({ length: count }, (_, i) => ({
      num: String(i + 1),
      label: labels[i] ?? "",
      colours: marks[i] ? stripes(marks[i]) : [],
    })),
    // The fork takes loop pins by number only, and rejects one the connector doesn't have.
    loops: (def.loops ?? []).map((pair: unknown[]) => {
      if (pair.length !== 2) throw new Error(`${id}: a loop joins exactly two pins`);
      const ends = pair.map(String) as [string, string];
      for (const end of ends) {
        if (!(Number(end) >= 1 && Number(end) <= count)) throw new Error(`${id}: no loop pin ${end}`);
      }
      return ends;
    }),
    simple,
    accent: hex(def.bgcolor_title ?? def.bgcolor),
    notes: lines(def.notes),
  };
}

function cable(id: string, template: string, def: Yaml): Cable {
  const colours: string[] = (def.colors ?? []).map(String);
  const labels: string[] = (def.wirelabels ?? []).map(String);
  const count = Math.max(Number(def.wirecount ?? 0), colours.length, labels.length);
  return {
    id,
    template,
    type: String(def.type ?? ""),
    gauge: gauge(def.gauge),
    length: def.length == null ? "" : String(def.length),
    wires: Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      label: labels[i] ?? "",
      code: colours[i] ?? "",
      colours: colours[i] ? stripes(colours[i]) : [],
    })),
    accent: hex(def.bgcolor_title ?? def.bgcolor),
    notes: lines(def.notes),
  };
}

function pinNum(c: Connector, ref: string | number): string {
  if (c.simple) return "1";
  const byLabel = c.pins.filter((p) => p.label !== "" && p.label === String(ref));
  if (byLabel.length > 1) throw new Error(`${c.id}: pin ${ref} is labelled more than once`);
  if (byLabel.length) return byLabel[0].num;
  const byNum = c.pins.find((p) => p.num === String(ref));
  if (byNum) return byNum.num;
  throw new Error(`${c.id}: no pin ${ref}`);
}

/** A wire by colour code, then label, then number: the order the fork's connect() tries them. */
function wireIndex(c: Cable, ref: string | number): number {
  for (const key of ["code", "label"] as const) {
    const hits = c.wires.filter((w) => w[key] !== "" && w[key] === String(ref));
    if (hits.length > 1) throw new Error(`${c.id}: ${ref} names more than one wire`);
    if (hits.length) return hits[0].index;
  }
  const n = Number(ref);
  if (Number.isInteger(n) && n >= 1 && n <= c.wires.length) return n;
  throw new Error(`${c.id}: no wire ${ref}`);
}

function lines(notes: unknown): string[] {
  if (typeof notes !== "string") return [];
  return notes.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Conductor size in mm². AWG sizes convert, so line weight means the same thing either way. */
export function gauge(value: unknown): number | null {
  if (value == null) return null;
  const m = /^\s*([\d.]+)\s*(mm2|mm²|awg)?/i.exec(String(value));
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2]?.toLowerCase() === "awg") {
    const d = 0.127 * 92 ** ((36 - n) / 39);
    return (Math.PI / 4) * d * d;
  }
  return n;
}
