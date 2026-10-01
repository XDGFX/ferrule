// Reads a subset of WireViz YAML into the harness model.
//
// Supported: prepended files (the text is concatenated, so anchors cross files), `<<` merge keys,
// `pinlabels`/`pincount`, `style: simple`, `X.Y` named instances, `X.` fresh instances, and
// connection sets that alternate connector, cable, connector.

import { parse } from "yaml";
import { hex, stripes } from "./colours.ts";
import type { Cable, Connector, End, Harness, Link } from "./model.ts";

type Yaml = Record<string, any>;

interface Ref {
  kind: "connector" | "cable";
  id: string;
  refs: (string | number)[] | null;
}

export function readWireviz(sources: string[], title: string): Harness {
  const doc: Yaml = parse(sources.join("\n"), { merge: true, maxAliasCount: -1 }) ?? {};
  const connectorDefs: Yaml = doc.connectors ?? {};
  const cableDefs: Yaml = doc.cables ?? {};

  const connectors = new Map<string, Connector>();
  const cables = new Map<string, Cable>();
  const fresh = new Map<string, number>();
  const links: Link[] = [];

  function instance(designator: string): Omit<Ref, "refs"> {
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

  for (const set of doc.connections ?? []) {
    const items: Ref[] = (set as unknown[]).map((item) => {
      if (typeof item === "string") return { ...instance(item), refs: null };
      const [designator, refs] = Object.entries(item as Yaml)[0];
      return { ...instance(designator), refs: Array.isArray(refs) ? refs : [refs] };
    });
    for (let i = 1; i < items.length; i++) {
      if (items[i].kind === items[i - 1].kind) {
        throw new Error(`${items[i - 1].id} and ${items[i].id}: a connection must alternate connector and cable`);
      }
    }
    const count = Math.max(...items.map((it) => it.refs?.length ?? 1));
    for (let k = 0; k < count; k++) {
      items.forEach((it, i) => {
        if (it.kind !== "cable") return;
        const c = cables.get(it.id)!;
        const end = (j: number): End | null => {
          const other = items[j];
          if (!other) return null;
          const conn = connectors.get(other.id)!;
          return { connector: conn.id, pin: pinNum(conn, pick(other, k)) };
        };
        links.push({ cable: c.id, wire: wireIndex(c, pick(it, k)), from: end(i - 1), to: end(i + 1) });
      });
    }
  }

  return { title, connectors: [...connectors.values()], cables: [...cables.values()], links };
}

function pick(ref: Ref, k: number): string | number | null {
  if (!ref.refs) return null;
  return ref.refs.length === 1 ? ref.refs[0] : ref.refs[k];
}

function connector(id: string, template: string, def: Yaml): Connector {
  const simple = def.style === "simple";
  const labels: string[] = (def.pinlabels ?? []).map(String);
  const count = simple ? 1 : Math.max(labels.length, Number(def.pincount ?? 0));
  return {
    id,
    template,
    type: String(def.type ?? ""),
    subtype: String(def.subtype ?? ""),
    pins: Array.from({ length: count }, (_, i) => ({ num: String(i + 1), label: labels[i] ?? "" })),
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
      colours: colours[i] ? stripes(colours[i]) : [],
    })),
    accent: hex(def.bgcolor_title ?? def.bgcolor),
    notes: lines(def.notes),
  };
}

function pinNum(c: Connector, ref: string | number | null): string {
  if (c.simple) return "1";
  const byLabel = c.pins.find((p) => p.label !== "" && p.label === String(ref));
  if (byLabel) return byLabel.num;
  const byNum = c.pins.find((p) => p.num === String(ref));
  if (byNum) return byNum.num;
  throw new Error(`${c.id}: no pin ${ref}`);
}

function wireIndex(c: Cable, ref: string | number | null): number {
  if (ref == null && c.wires.length === 1) return 1;
  const byLabel = c.wires.find((w) => w.label !== "" && w.label === String(ref));
  if (byLabel) return byLabel.index;
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
