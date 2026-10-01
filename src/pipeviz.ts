// Reads pipeviz YAML, the plumbing dialect, into the harness model.
//
// A component is a card and its ports are pins. Each use of a pipe in a chain is a fresh run of
// one core, drawn as a single tagged wire; two parts that mate directly get an untagged one. A
// reversed pipe, `pipe^`, turns the chain round, so what follows it is laid out heading back.
//
// Prepended files are parsed one by one and deep-merged, as pipeviz does: their `diagram`,
// `templates` and `components` sit under the plan's own. Pipes and connections come only from the
// plan. The rules come from pipeviz's validate_diagram() and the plumbing schema it implements.

import { parse } from "yaml";
import { hex, stripes } from "./colours.ts";
import type { Cable, Connector, End, Harness, Link } from "./model.ts";

type Yaml = Record<string, any>;

/** Pipe colours by service, as wire colour codes. A pipe's own `colour` wins over its service. */
export const SERVICE: Record<string, string> = { potable: "BU", hot: "RD", waste: "BN", vent: "OL" };

/** True when a plan is pipeviz rather than WireViz: only pipeviz has these top-level keys. */
export function isPipeviz(plan: string): boolean {
  return /^(components|pipes):/m.test(plan);
}

export function readPipeviz(sources: string[], name: string): Harness {
  const docs: Yaml[] = sources.map((s) => parse(s, { merge: true, maxAliasCount: -1 }) ?? {});
  const plan = docs[docs.length - 1];
  const merged = (key: string): Yaml => docs.reduce((acc, d) => merge(acc, d[key] ?? {}), {});
  const diagram = merged("diagram");
  const templates = merged("templates");
  const library = merged("components");
  const pipeDefs: Yaml = plan.pipes ?? {};

  const defs = new Map<string, Yaml>();
  for (const key of Object.keys(library)) defs.set(key, check(key, resolve(key, library, templates, [])));

  const connectors = new Map<string, Connector>();
  const cables: Cable[] = [];
  const links: Link[] = [];
  const fresh = new Map<string, number>();
  let runs = 0;

  function part(token: Token): Connector {
    const def = defs.get(token.base)!;
    let id = token.base;
    if (token.instance === "") {
      const n = (fresh.get(token.base) ?? 0) + 1;
      fresh.set(token.base, n);
      id = `__${token.base}_${n}`;
    } else if (token.instance != null) id = `${token.base}.${token.instance}`;
    if (!connectors.has(id)) {
      const label = String(def.label) + (token.instance ? ` · ${token.instance}` : "");
      connectors.set(id, component(id, token.base, label, def));
    }
    return connectors.get(id)!;
  }

  function run(template: string, def: Yaml): Cable {
    const id = template ? `__${template}_${++runs}` : `=${++runs}`;
    const colour = def.colour ?? def.color;
    const colours = colour ? (String(colour).startsWith("#") ? [String(colour)] : stripes(String(colour).toUpperCase())) : SERVICE[def.service_rating] ? [SERVICE[def.service_rating]] : [];
    const cable: Cable = {
      id,
      template,
      type: String(def.material ?? ""),
      gauge: null,
      bore: bore(def.size),
      label: def.label == null ? "" : String(def.label),
      length: def.length == null ? "" : String(def.length),
      wires: [{ index: 1, label: "", code: "", colours }],
      accent: hex(colour ?? SERVICE[def.service_rating]),
      notes: lines(def.description),
    };
    cables.push(cable);
    return cable;
  }

  for (const [i, chain] of ((plan.connections ?? []) as unknown[][]).entries()) {
    const where = `connections[${i}]`;
    try {
      if (!Array.isArray(chain) || chain.length < 2) throw new Error("a chain needs at least two tokens");
      const tokens = chain.map((t) => token(String(t), defs, pipeDefs));
      tokens.forEach((t, j) => {
        if (t.pipe && tokens[j + 1]?.pipe) throw new Error(`${t.base} → ${tokens[j + 1].base}: pipe to pipe is not a connection`);
      });
      const turns = tokens.filter((t) => t.reversed);
      if (turns.length > 1) throw new Error("a chain can turn round only once");
      if (turns.length && !turns[0].pipe) throw new Error(`${turns[0].base}^: only a pipe can turn a chain round`);

      const steps = tokens.map((t) => ({ t, end: t.pipe ? null : end(part(t), t) }));
      const link = (pipe: Token | null, from: End | null, to: End | null, returns = false) => {
        const cable = pipe ? run(pipe.base, pipeDefs[pipe.base] ?? {}) : run("", {});
        links.push({ cable: cable.id, wire: 1, from, to, ...(returns && { returns }) });
      };
      // Each pipe joins its neighbours; two parts side by side mate directly.
      const walk = (seq: typeof steps) =>
        seq.forEach((s, j) => {
          const next = seq[j + 1];
          if (s.t.pipe) link(s.t, seq[j - 1]?.end ?? null, next?.end ?? null);
          else if (next && !next.t.pipe) link(null, s.end, next.end);
        });
      // After a turn the chain is read backwards, so it runs towards the turn and meets it there.
      const turn = tokens.findIndex((t) => t.reversed);
      if (turn < 0) walk(steps);
      else {
        walk(steps.slice(0, turn));
        link(tokens[turn], steps[turn - 1]?.end ?? null, steps[turn + 1]?.end ?? null, true);
        walk(steps.slice(turn + 1).reverse());
      }
    } catch (err) {
      throw new Error(`${where} ${JSON.stringify(chain)}: ${(err as Error).message}`);
    }
  }

  // A fresh instance carries a number only when its part is used fresh more than once.
  for (const c of connectors.values()) {
    const m = /^__.+_(\d+)$/.exec(c.id);
    if (m && (fresh.get(c.template) ?? 0) > 1) c.label += ` · ${m[1]}`;
  }

  return {
    title: diagram.title == null ? titleCase(name) : String(diagram.title),
    connectors: [...connectors.values()],
    cables,
    links,
    mates: [],
  };
}

interface Token {
  base: string;
  /** `null` for the part itself, `""` for a fresh instance, else the instance's name. */
  instance: string | null;
  port: string | null;
  reversed: boolean;
  pipe: boolean;
}

function token(text: string, defs: Map<string, Yaml>, pipes: Yaml): Token {
  const colon = text.indexOf(":");
  let head = colon < 0 ? text : text.slice(0, colon);
  const port = colon < 0 ? null : text.slice(colon + 1);
  if (port != null && (port.startsWith("[") || port.includes(",") || /^\d+-\d+$/.test(port))) {
    throw new Error(`${text}: a token names at most one port`);
  }
  const reversed = head.endsWith("^");
  if (reversed) head = head.slice(0, -1);
  const dot = head.indexOf(".");
  const base = dot < 0 ? head : head.slice(0, dot);
  const instance = dot < 0 ? null : head.slice(dot + 1);
  if (defs.has(base)) return { base, instance, port, reversed, pipe: false };
  if (base in pipes) return { base, instance: null, port, reversed, pipe: true };
  throw new Error(`${text}: no component or pipe is defined as ${base}`);
}

/** The pin a token lands on: its port by name, then by number, or the first when it names none. */
function end(c: Connector, t: Token): End {
  if (c.simple) {
    if (t.port != null) throw new Error(`${c.id}: a simple component has no ports to name`);
    return { connector: c.id, pin: "1" };
  }
  if (t.port == null) return { connector: c.id, pin: "1" };
  const byName = c.pins.find((p) => p.label === t.port);
  if (byName) return { connector: c.id, pin: byName.num };
  if (/^\d+$/.test(t.port) && Number(t.port) >= 1 && Number(t.port) <= c.pins.length) return { connector: c.id, pin: t.port };
  throw new Error(`${t.base}: no port ${t.port}`);
}

function component(id: string, template: string, label: string, def: Yaml): Connector {
  const ports = portList(def);
  return {
    id,
    template,
    label,
    type: String(def.manufacturer ?? ""),
    subtype: String(def.model ?? ""),
    pins: def.simple
      ? [{ num: "1", label: "", colours: [] }]
      : ports.map((p, i) => {
          const detail = [p.connection_size, p.gender].filter((v) => v != null && v !== "").join(" · ");
          return { num: String(i + 1), label: String(p.name), colours: [], ...(detail && { detail }) };
        }),
    simple: !!def.simple,
    loops: [],
    accent: hex(def.color ?? def.colour),
    notes: lines(def.description),
  };
}

/** Ports as objects, whether written as names or as objects; a bare `portcount` numbers them. */
function portList(def: Yaml): Yaml[] {
  if (Array.isArray(def.ports)) return def.ports.map((p: unknown) => (p && typeof p === "object" ? p : { name: String(p) }));
  return Array.from({ length: Number(def.portcount ?? 0) }, (_, i) => ({ name: String(i + 1) }));
}

function check(key: string, def: Yaml): Yaml {
  if (!def.label) throw new Error(`component ${key} needs a label`);
  const has = "ports" in def || "portcount" in def;
  if (def.simple && has) throw new Error(`component ${key} is simple, so it can't have ports or portcount`);
  if (!def.simple && !has) throw new Error(`component ${key} needs ports or portcount`);
  if (Array.isArray(def.ports) && "portcount" in def && Number(def.portcount) !== def.ports.length) {
    throw new Error(`component ${key}: portcount ${def.portcount} doesn't match its ${def.ports.length} ports`);
  }
  return def;
}

/** A component with its `ref` and `template` chains applied, its own keys on top. */
function resolve(key: string, library: Yaml, templates: Yaml, stack: string[]): Yaml {
  if (stack.includes(key)) throw new Error(`component cycle: ${[...stack, key].join(" → ")}`);
  let def: Yaml = { ...(library[key] ?? {}) };
  const ref = def.ref;
  delete def.ref;
  if (ref != null) {
    if (!(ref in library)) throw new Error(`${key}: no component ${ref} to ref`);
    def = merge(resolve(ref, library, templates, [...stack, key]), def);
  }
  const template = def.template;
  delete def.template;
  if (template != null) def = merge(templateChain(String(template), templates, []), def);
  return def;
}

function templateChain(name: string, templates: Yaml, stack: string[]): Yaml {
  if (stack.includes(name)) throw new Error(`template cycle: ${[...stack, name].join(" → ")}`);
  if (!(name in templates)) throw new Error(`no template ${name}`);
  const t: Yaml = { ...templates[name] };
  const parent = t.template;
  delete t.template;
  return parent == null ? t : merge(templateChain(String(parent), templates, [...stack, name]), t);
}

function merge(base: Yaml, over: Yaml): Yaml {
  const out: Yaml = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isMap(out[k]) && isMap(v) ? merge(out[k], v) : v;
  }
  return out;
}

const isMap = (v: unknown): v is Yaml => !!v && typeof v === "object" && !Array.isArray(v);

/** A pipe's bore in mm, from `25mm`, `3/4"`, `1-1/2"` or `1.5in`. */
export function bore(size: unknown): number | null {
  if (size == null) return null;
  const s = String(size).trim();
  const mm = /^([\d.]+)\s*mm$/i.exec(s);
  if (mm) return Number(mm[1]);
  const inch = /^(?:(\d+)[- ])?(?:(\d+)\/(\d+)|([\d.]+))\s*(?:"|in|inch|inches)$/i.exec(s);
  if (!inch) return null;
  const [, whole, num, den, dec] = inch;
  const n = (whole ? Number(whole) : 0) + (dec ? Number(dec) : Number(num) / Number(den));
  return Math.round(n * 25.4 * 100) / 100;
}

function lines(text: unknown): string[] {
  if (typeof text !== "string") return [];
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function titleCase(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
