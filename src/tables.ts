// The harness as Markdown: a cut list and a pinout for every connector. GitHub renders the tables
// on a phone, where a wide diagram is hard to follow pin by pin.

import type { Cable, Connector, End, Harness } from "./model.ts";
import { displayName, fmt } from "./sheet.ts";

const NONE = "–";

/** One conductor with every end it lands on, gathered from all the connection sets that name it. */
interface Core {
  cable: Cable;
  wire: number;
  from: End[];
  to: End[];
}

export function tables(h: Harness): string {
  const connectors = new Map(h.connectors.map((c) => [c.id, c]));
  const cables = new Map(h.cables.map((c) => [c.id, c]));

  // Fresh instances of a template used more than once are numbered. Unlike the diagram, this
  // counts single-core runs too: they have no card there, but each is a row here to cut.
  const fresh = [...h.connectors, ...h.cables].filter((c) => c.id.startsWith("__"));
  const repeated = new Set(fresh.map((c) => c.template).filter((t, i, all) => all.indexOf(t) !== all.lastIndexOf(t)));
  const name = (c: Connector | Cable) => displayName(c.id, c.template, repeated);
  const end = (e: End) => {
    const c = connectors.get(e.connector)!;
    if (c.simple) return name(c);
    const label = c.pins.find((p) => p.num === e.pin)?.label;
    return `${name(c)} ${e.pin}${label ? ` · ${label}` : ""}`;
  };
  const ends = (list: End[]) => (list.length ? list.map(end).join(", ") : NONE);

  const cores = new Map<string, Core>();
  for (const l of h.links) {
    const key = `${l.cable}#${l.wire}`;
    if (!cores.has(key)) cores.set(key, { cable: cables.get(l.cable)!, wire: l.wire, from: [], to: [] });
    const core = cores.get(key)!;
    if (l.from && !core.from.some((e) => same(e, l.from!))) core.from.push(l.from);
    if (l.to && !core.to.some((e) => same(e, l.to!))) core.to.push(l.to);
  }
  const order = [...cores.values()].sort(
    (a, b) => h.cables.indexOf(a.cable) - h.cables.indexOf(b.cable) || a.wire - b.wire,
  );
  const colour = (core: Core) => core.cable.wires[core.wire - 1].code || NONE;

  const out = [`# ${h.title}`, ""];

  out.push("## Cut list", "");
  out.push(row(["Cable", "Core", "Colour", "Size", "Length", "From", "To"]), row(Array(7).fill("---")));
  for (const core of order) {
    const c = core.cable;
    const label = c.wires[core.wire - 1].label;
    out.push(row([
      name(c),
      label ? `${core.wire} ${label}` : String(core.wire),
      colour(core),
      c.gauge == null ? NONE : `${fmt(c.gauge)} mm²`,
      c.length || NONE,
      ends(core.from),
      ends(core.to),
    ]));
  }

  out.push("", "## Pinouts");
  for (const c of h.connectors) {
    const mates = h.mates.flatMap((m) => (m.from === c.id ? [m.to] : m.to === c.id ? [m.from] : []));
    const about = [
      [c.type, c.subtype].filter(Boolean).join(", "),
      ...mates.map((m) => `mates with ${name(connectors.get(m)!)}`),
    ].filter(Boolean);
    out.push("", `### ${name(c)}`, "");
    if (about.length) out.push(about.join(" · "), "");
    out.push(row(["Pin", "Label", "Wire", "Goes to"]), row(Array(4).fill("---")));
    for (const p of c.pins) {
      const here = { connector: c.id, pin: p.num };
      const lines: [string, string][] = [];
      for (const core of order) {
        // A single core is named by its cable alone; a number after a cable is always a core.
        const label = core.cable.wires.length === 1
          ? `${name(core.cable)} (${colour(core)})`
          : `${name(core.cable)} core ${core.wire} (${colour(core)})`;
        if (core.from.some((e) => same(e, here))) lines.push([label, ends(core.to)]);
        if (core.to.some((e) => same(e, here))) lines.push([label, ends(core.from)]);
      }
      for (const [a, b] of c.loops) {
        if (a === p.num) lines.push([`looped to ${b}`, ""]);
        if (b === p.num) lines.push([`looped to ${a}`, ""]);
      }
      if (!lines.length) lines.push([NONE, ""]);
      lines.forEach(([wire, to], i) => {
        out.push(row(i ? ["", "", wire, to] : [c.simple ? NONE : p.num, p.label, wire, to]));
      });
    }
  }
  return out.join("\n") + "\n";
}

function same(a: End, b: End): boolean {
  return a.connector === b.connector && a.pin === b.pin;
}

function row(cells: string[]): string {
  return `|${cells.map((c) => (c ? ` ${c.replaceAll("|", "\\|")} ` : " ")).join("|")}|`;
}
