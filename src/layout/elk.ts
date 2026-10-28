// Layout with elkjs: layered, left to right, ports fixed at their rows, orthogonal wires.
// elkjs is pure JavaScript with a fixed seed, so the same sheet lays out the same everywhere.

import elkModule from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";

// elkjs is CommonJS: at runtime the default import is the constructor, but its types describe
// the module, whose `default` is the constructor.
const ELK = elkModule as unknown as typeof elkModule.default;
import { textWidth } from "../measure.ts";
import type { Group } from "../model.ts";
import { accentReach, STYLE, type Card, type Sheet, type Wire } from "../sheet.ts";
import type { Box, Placement, Pt, Route } from "./types.ts";

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  "elk.spacing.nodeNode": "36",
  // Parallel wires need room to be told apart, especially black ones on the dark theme.
  "elk.spacing.edgeEdge": "20",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
  "elk.edgeLabels.inline": "true",
  "elk.edgeLabels.placement": "CENTER",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.layered.thoroughness": "40",
};

/** The gap between the two halves of a mated pair. */
const MATE_GAP = 48;

/** How far a returning wire's two legs stay apart where it turns round. */
const TURN_GAP = 16;

/** A coiled run is drawn as this many passes back and forth. */
export const COIL_PASSES = 6;

/** The shortest a coil's passes are drawn where it turns round, when its label is shorter or absent. */
const COIL_MIN_W = 96;

/** The distance between a coil's passes: its line and a gap that still reads on a phone. */
export const coilPitch = (w: Wire) => Math.ceil(w.weight) + 10;

/** How far a coil on a straight run reaches either side of the line it interrupts. */
const coilReach = (w: Wire) => 2 * coilPitch(w);

/** How far apart a coil's first and last passes are where it turns round. */
const coilSpan = (w: Wire) => (COIL_PASSES - 1) * coilPitch(w);

/**
 * The node a returning wire turns round in. A plain turn needs room for its tag; a coil needs
 * room for its passes, with its label above the first.
 */
function turnNode(w: Wire): ElkNode & { width: number } {
  const id = `turn:${w.id}`;
  const ports = ["a", "b"].map((leg) => ({ id: `${id}/${leg}`, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } }));
  if (!w.coil) {
    return { id, width: w.tag?.w ?? TURN_GAP, height: (w.tag?.h ?? 0) + 2 * TURN_GAP, layoutOptions: { "elk.portConstraints": "FIXED_SIDE" }, ports };
  }
  return {
    id,
    width: Math.max(w.tag?.w ?? 0, COIL_MIN_W),
    height: (w.tag?.h ?? TURN_GAP) + coilSpan(w),
    // The two legs enter one coil span apart, centred, so the passes between them are evenly spaced.
    layoutOptions: {
      "elk.portConstraints": "FIXED_SIDE",
      "elk.portAlignment.default": "CENTER",
      "elk.spacing.individual": `elk.spacing.portPort:${coilSpan(w)}`,
    },
    ports,
  };
}

/**
 * A coil where a wire turns round: passes from `x0` out to `x1` and back, the first at `ya` and
 * the last at `yb`. An even count leaves the last pass heading back the way the first came.
 */
function coilTurn(x0: number, x1: number, ya: number, yb: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < COIL_PASSES; i++) {
    const y = ya + ((yb - ya) * i) / (COIL_PASSES - 1);
    out.push({ x: i % 2 ? x1 : x0, y }, { x: i % 2 ? x0 : x1, y });
  }
  return out;
}

/**
 * A straight run with a coil let into it, centred on its label slot: the line steps up, runs
 * down and up across itself, and steps back. Undefined when no horizontal stretch through the
 * slot is long enough to hold it, and the run is then drawn plain.
 */
function coilInline(pts: Pt[], slot: Pt, w: Wire): { points: Pt[]; tag: Pt } | undefined {
  const pitch = coilPitch(w), reach = coilReach(w);
  const half = ((COIL_PASSES - 1) * pitch) / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    // ELK centres an inline slot on its line only to within the line's own nominal thickness.
    if (Math.abs(a.y - b.y) > 0.5 || Math.abs(a.y - slot.y) > 2) continue;
    if (Math.min(a.x, b.x) > slot.x - half - pitch || Math.max(a.x, b.x) < slot.x + half + pitch) continue;
    const dir = Math.sign(b.x - a.x);
    const coil: Pt[] = [];
    let y = a.y;
    for (let k = 0; k < COIL_PASSES; k++) {
      const x = slot.x + dir * (k * pitch - half);
      coil.push({ x, y });
      y = k === COIL_PASSES - 1 ? a.y : k % 2 ? a.y + reach : a.y - reach;
      coil.push({ x, y });
    }
    return { points: [...pts.slice(0, i), ...coil, ...pts.slice(i)], tag: { x: slot.x, y: a.y - reach } };
  }
  return undefined;
}

interface Pair {
  id: string;
  a: Card;
  b: Card;
  mate: string;
}

/**
 * Mated connectors that can sit side by side as one node: the plug takes wires only from the
 * west and the socket only to the east, so nothing has to pass between them. Laid out as one, a
 * pair always sits side by side and its mate is drawn as the short link it is.
 */
function pairs(sheet: Sheet): Pair[] {
  const cards = new Map(sheet.cards.map((c) => [c.id, c]));
  const taken = new Set<string>();
  const out: Pair[] = [];
  for (const w of sheet.wires) {
    if (w.kind !== "mate") continue;
    const a = cards.get(w.from.card)!, b = cards.get(w.to.card)!;
    if (taken.has(a.id) || taken.has(b.id)) continue;
    if (a.ports.some((p) => p.side === "E" && p.id !== "mate:E")) continue;
    if (b.ports.some((p) => p.side === "W" && p.id !== "mate:W")) continue;
    taken.add(a.id).add(b.id);
    out.push({ id: `pair:${a.id}+${b.id}`, a, b, mate: w.id });
  }
  return out;
}

/** The short line between a docked tag and the port it joins. */
export const DOCK_STUB = 24;

interface Dock {
  wire: Wire;
  tag: Card;
  host: Card;
  /** The side of the host the tag sits on, which is its port's side. */
  side: "W" | "E";
  /** The port's height on the host. */
  y: number;
}

/**
 * Off-sheet tags joined straight to one port, with no pipe between, that sit beside that port as
 * part of its card. Laid out as nodes of their own they are sources or sinks, which ELK puts at
 * either end of their level: outside a frame their part is in, a sheet-width from it.
 */
function docks(sheet: Sheet, paired: Set<string>): Dock[] {
  const cards = new Map(sheet.cards.map((c) => [c.id, c]));
  const wires = sheet.wires.filter((w) => w.kind !== "mate");
  const ends = new Map<string, number>();
  for (const w of wires) for (const e of [w.from, w.to]) {
    ends.set(e.card, (ends.get(e.card) ?? 0) + 1);
    ends.set(`${e.card}/${e.port}`, (ends.get(`${e.card}/${e.port}`) ?? 0) + 1);
  }
  const out: Dock[] = [];
  for (const w of wires) {
    if (w.tag || w.returns || w.coil) continue;
    for (const [mine, theirs] of [[w.from, w.to], [w.to, w.from]] as const) {
      const tag = cards.get(mine.card)!, host = cards.get(theirs.card)!;
      if (tag.display !== "exit" || ends.get(tag.id) !== 1) continue;
      if (host.display === "exit" || host.kind === "cable" || paired.has(host.id)) continue;
      if (ends.get(`${theirs.card}/${theirs.port}`) !== 1) continue;
      const port = host.ports.find((p) => p.id === theirs.port)!;
      out.push({ wire: w, tag, host, side: port.side, y: port.y });
    }
  }
  return out;
}

/**
 * Options that wrap a long sheet into rows, aiming for `aspect` as width over height. Applied only
 * when the sheet's YAML sets `diagram.wrap`.
 *
 * MULTI_EDGE lets a cut fall anywhere, where SINGLE_EDGE throws when no layer boundary is crossed
 * by exactly one edge, as in any plan with a tee. Then ELK moves each cut to the boundary crossed
 * by the fewest wires: a distance penalty below 1 lets it travel as far as it must to find one,
 * where ELK's default of 2 leaves it cutting through a fan of four or five pipes. A wrapped wire
 * gets the same clearance from its neighbours as any other.
 */
export function wrapOptions(aspect: number): Record<string, string> {
  return {
    "elk.layered.wrapping.strategy": "MULTI_EDGE",
    "elk.aspectRatio": String(aspect),
    "elk.layered.wrapping.multiEdge.distancePenalty": "0.5",
    "elk.layered.wrapping.additionalEdgeSpacing": ELK_OPTIONS["elk.spacing.edgeEdge"],
  };
}

// Wrapping into rows is opt-in, per diagram. A cut through a multi-core cable sends a ribbon of
// wires round the sheet's edge, and in a loom nearly every boundary crosses one, so a wide loom
// usually reads better as one row. A pipe run is one line, so most plumbing plans fold cleanly.
// elkjs can't take a hand-picked cut: it can't deserialise the list option.
export async function layoutElk(sheet: Sheet, options: Record<string, string> = {}): Promise<Placement> {
  const paired = pairs(sheet);
  const inPair = new Set(paired.flatMap((p) => [p.a.id, p.b.id]));
  // An accent widens its run on both sides, so a sheet with any keeps its lines further apart.
  const room = Math.ceil(2 * (accentReach(0) + STYLE.labelGap / 2));
  const spacing: Record<string, string> = sheet.wires.some((w) => w.accent)
    ? Object.fromEntries(["elk.spacing.edgeEdge", "elk.spacing.edgeNode", "elk.layered.spacing.edgeEdgeBetweenLayers", "elk.layered.spacing.edgeNodeBetweenLayers"].map((k) => [k, String(Number(ELK_OPTIONS[k]) + room)]))
    : {};
  // A docked tag's host is laid out wider by the tag and its stub, on the tag's side, and its
  // ports on that side move out to the new edge; their wires are drawn back in afterwards.
  const docked = docks(sheet, inPair);
  const dockedIds = new Set(docked.flatMap((d) => [d.tag.id, d.wire.id, `${d.host.id}/${d.wire.from.card === d.host.id ? d.wire.from.port : d.wire.to.port}`]));
  const grow = new Map<string, { W: number; E: number }>();
  for (const d of docked) {
    const g = grow.get(d.host.id) ?? { W: 0, E: 0 };
    g[d.side] = Math.max(g[d.side], d.tag.w + DOCK_STUB);
    grow.set(d.host.id, g);
  }
  const port = (card: Card, p: Card["ports"][number], dx = 0) => ({
    id: `${card.id}/${p.id}`,
    x: p.x + dx,
    y: p.y,
    width: 0,
    height: 0,
    layoutOptions: { "elk.port.side": p.side === "W" ? "WEST" : "EAST" },
  });
  // A wire that doubles back would drag its far end a layer further on. Instead both ends lead
  // into a node of their own, east of both, where the wire turns round and its tag sits.
  const returning = sheet.wires.filter((w) => w.returns);
  const turns = returning.map(turnNode);
  // A coil on a straight run takes the place of its label slot, which grows to hold it.
  const slot = (w: Wire) => {
    if (!w.coil) return w.tag ? [{ text: w.tag.text, width: w.tag.w, height: w.tag.h }] : [];
    const width = Math.max(w.tag?.w ?? 0, (COIL_PASSES + 1) * coilPitch(w));
    return [{ text: w.tag?.text ?? "coil", width, height: (w.tag?.h ?? 0) + 2 * coilReach(w), layoutOptions: { "elk.edgeLabels.inline": "true" } }];
  };
  const groups = sheet.groups ?? [];
  const groupOf = new Map(groups.flatMap((g) => g.members.map((m) => [m, g.id] as const)));
  // A turn sits inside a frame only when both its ends do, so the whole run stays inside.
  for (const w of returning) {
    const g = groupOf.get(w.from.card);
    if (!g || g !== groupOf.get(w.to.card)) continue;
    groupOf.set(`turn:${w.id}`, g);
    // A plain turn's label hangs east of its node, so inside a frame the node grows to hold it.
    const node = turns.find((t) => t.id === `turn:${w.id}`)!;
    if (!w.coil && w.tag) node.width += Math.ceil(w.tag.w / 2 + w.weight / 2 + STYLE.labelGap);
  }
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      ...ELK_OPTIONS,
      ...(sheet.wrap ? wrapOptions(sheet.wrap) : {}),
      ...spacing,
      ...(groups.length ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" } : {}),
      ...options,
    },
    children: [
      ...sheet.cards.filter((c) => !inPair.has(c.id) && !dockedIds.has(c.id)).map((c) => {
        const g = grow.get(c.id) ?? { W: 0, E: 0 };
        return {
          id: c.id,
          width: c.w + g.W + g.E,
          height: c.h,
          layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: c.ports.filter((p) => !dockedIds.has(`${c.id}/${p.id}`)).map((p) => port(c, p, p.side === "E" ? g.W + g.E : 0)),
        };
      }),
      ...paired.map(({ id, a, b }) => ({
        id,
        width: a.w + MATE_GAP + b.w,
        height: Math.max(a.h, b.h),
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: [
          ...a.ports.filter((p) => p.side === "W").map((p) => port(a, p)),
          ...b.ports.filter((p) => p.side === "E").map((p) => port(b, p, a.w + MATE_GAP)),
        ],
      })),
      ...turns,
    ],
    edges: [
      ...returning.flatMap((w) => [
        { id: `${w.id}/a`, sources: [`${w.from.card}/${w.from.port}`], targets: [`turn:${w.id}/a`] },
        { id: `${w.id}/b`, sources: [`${w.to.card}/${w.to.port}`], targets: [`turn:${w.id}/b`] },
      ]),
      ...sheet.wires.filter((w) => !w.returns && !dockedIds.has(w.id) && !paired.some((p) => p.mate === w.id)).map((w) => ({
      id: w.id,
      sources: [`${w.from.card}/${w.from.port}`],
      targets: [`${w.to.card}/${w.to.port}`],
      labels: slot(w),
      })),
    ],
  };

  if (groups.length) graph.children = framed(graph.children!, groups, groupOf, spacing);

  const out = await new ELK().layout(graph);
  // ELK places a frame's children, and any edge wholly inside it, relative to the frame.
  const frames = new Map<string, Box>();
  const origin = new Map<string, Pt>([["root", { x: 0, y: 0 }]]);
  const cards = new Map<string, Pt>();
  for (const n of out.children!) {
    if (!n.id.startsWith(FRAME)) {
      cards.set(n.id, { x: n.x!, y: n.y! });
      continue;
    }
    frames.set(n.id.slice(FRAME.length), { x: n.x!, y: n.y!, w: n.width!, h: n.height! });
    origin.set(n.id, { x: n.x!, y: n.y! });
    for (const c of n.children!) cards.set(c.id, { x: n.x! + c.x!, y: n.y! + c.y! });
  }
  const routes = new Map<string, Route>();
  for (const { id, a, b, mate } of paired) {
    const at = cards.get(id)!;
    cards.delete(id);
    cards.set(a.id, at);
    cards.set(b.id, { x: at.x + a.w + MATE_GAP, y: at.y });
    const ya = at.y + a.ports.find((p) => p.id === "mate:E")!.y;
    const yb = at.y + b.ports.find((p) => p.id === "mate:W")!.y;
    const x0 = at.x + a.w, x1 = x0 + MATE_GAP, mid = x0 + MATE_GAP / 2;
    const points = ya === yb ? [{ x: x0, y: ya }, { x: x1, y: yb }] : [{ x: x0, y: ya }, { x: mid, y: ya }, { x: mid, y: yb }, { x: x1, y: yb }];
    routes.set(mate, { kind: "poly", points });
  }
  const edges = new Map((out.edges as ElkExtendedEdge[]).map((e) => [e.id, e]));
  const from = (e: ElkExtendedEdge) => origin.get((e as { container?: string }).container ?? "root")!;
  const points = (e: ElkExtendedEdge) => {
    const s = e.sections![0], o = from(e);
    return [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(({ x, y }) => ({ x: x + o.x, y: y + o.y }));
  };
  const coils = new Map(sheet.wires.filter((w) => w.coil).map((w) => [w.id, w]));
  const legs = new Set(returning.flatMap((w) => [`${w.id}/a`, `${w.id}/b`]));
  for (const e of edges.values()) {
    if (legs.has(e.id)) continue;
    const label = e.labels?.[0];
    const tag = label ? { x: from(e).x + label.x! + label.width! / 2, y: from(e).y + label.y! + label.height! / 2 } : undefined;
    const coiled = tag && coils.has(e.id) ? coilInline(points(e), tag, coils.get(e.id)!) : undefined;
    routes.set(e.id, coiled ? { kind: "poly", ...coiled } : { kind: "poly", points: points(e), tag });
  }
  // A returning wire runs out along one leg, down the middle of its turn, and back along the other.
  for (const w of returning) {
    const turn = cards.get(`turn:${w.id}`)!;
    cards.delete(`turn:${w.id}`);
    const a = points(edges.get(`${w.id}/a`)!), b = points(edges.get(`${w.id}/b`)!).reverse();
    const [ya, yb] = [a[a.length - 1].y, b[0].y];
    if (w.coil) {
      // The legs already reach the first pass's start and the last pass's end.
      const x1 = turn.x + turnNode(w).width;
      const coil = coilTurn(turn.x, x1, ya, yb).slice(1, -1);
      routes.set(w.id, { kind: "poly", points: [...a, ...coil, ...b], tag: { x: (turn.x + x1) / 2, y: Math.min(ya, yb) } });
      continue;
    }
    const x = turn.x + (w.tag?.w ?? TURN_GAP) / 2;
    routes.set(w.id, { kind: "poly", points: [...a, { x, y: ya }, { x, y: yb }, ...b], tag: { x, y: (ya + yb) / 2 } });
  }
  // Each grown host moves back to where its card starts, and the wires ELK ended at its grown edge
  // run on, along the same line, to their ports.
  for (const [id, g] of grow) {
    const at = cards.get(id)!;
    cards.set(id, { x: at.x + g.W, y: at.y });
  }
  for (const w of sheet.wires) {
    const r = routes.get(w.id);
    if (!r) continue;
    const first = r.points[0], last = r.points[r.points.length - 1];
    const g = (card: string) => grow.get(card) ?? { W: 0, E: 0 };
    if (w.from.port.endsWith(":E")) first.x -= g(w.from.card).E;
    if (w.to.port.endsWith(":W")) last.x += g(w.to.card).W;
    else last.x -= g(w.to.card).E;
  }
  for (const d of docked) {
    const host = cards.get(d.host.id)!, y = host.y + d.y;
    const x = d.side === "W" ? host.x - DOCK_STUB - d.tag.w : host.x + d.host.w + DOCK_STUB;
    cards.set(d.tag.id, { x, y: y - d.tag.h / 2 });
    const edge = d.side === "W" ? host.x : host.x + d.host.w;
    const points = d.side === "W" ? [{ x: x + d.tag.w, y }, { x: edge, y }] : [{ x: edge, y }, { x, y }];
    routes.set(d.wire.id, { kind: "poly", points });
  }
  return { engine: "elk", width: out.width!, height: out.height!, cards, routes, ...(groups.length ? { frames } : {}) };
}

const FRAME = "frame:";

/**
 * The sheet's nodes with each group's members moved inside a node of their own, which ELK lays
 * out as a box round them and nothing else. The frame takes the place of its first member, so
 * the order parts were first named in still orders the sheet.
 */
function framed(nodes: ElkNode[], groups: Group[], groupOf: Map<string, string>, spacing: Record<string, string>): ElkNode[] {
  const s = STYLE;
  const frames = new Map<string, ElkNode>(groups.map((g) => {
    const top = s.framePad + (g.label ? s.frameTitleH : 0);
    const title = Math.ceil(textWidth(g.label, s.frameTitleSize, 600) + g.label.length * s.frameTitleSpacing) + 2 * s.framePad;
    return [g.id, {
      id: FRAME + g.id,
      layoutOptions: {
        ...ELK_OPTIONS,
        ...spacing,
        // elkjs throws when it orders a nested graph by model order, so a frame's inside goes without.
        "elk.layered.considerModelOrder.strategy": "NONE",
        "elk.padding": `[top=${top},left=${s.framePad},bottom=${s.framePad},right=${s.framePad}]`,
        // A frame is never narrower than its title.
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": `(${title},${top + s.framePad})`,
      },
      children: [],
    }];
  }));
  const out: ElkNode[] = [];
  for (const n of nodes) {
    const frame = frames.get(groupOf.get(n.id) ?? "");
    if (!frame) out.push(n);
    else if (frame.children!.push(n) === 1) out.push(frame);
  }
  return out;
}
