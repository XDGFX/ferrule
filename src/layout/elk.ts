// Layout with elkjs: layered, left to right, ports fixed at their rows, orthogonal wires.
// elkjs is pure JavaScript with a fixed seed, so the same sheet lays out the same everywhere.

import elkModule from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";

// elkjs is CommonJS: at runtime the default import is the constructor, but its types describe
// the module, whose `default` is the constructor.
const ELK = elkModule as unknown as typeof elkModule.default;
import type { Card, Sheet } from "../sheet.ts";
import type { Placement, Route } from "./types.ts";

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

/**
 * Wider than this, a sheet is wrapped into rows: a long chain is unreadable on a phone. Wrapping
 * sends wires between rows round the sheet's edge, so it is kept for sheets that really need it.
 */
export const WRAP_ABOVE = 3;

/** The gap between the two halves of a mated pair. */
const MATE_GAP = 48;

interface Pair {
  id: string;
  a: Card;
  b: Card;
  mate: string;
}

/**
 * Mated connectors that can sit side by side as one node: the plug takes wires only from the
 * west and the socket only to the east, so nothing has to pass between them. Laid out as one,
 * a pair can't be split by a wrap, and its mate is drawn as the short link it is.
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

/** Wrapping options. Applied only past WRAP_ABOVE, because it adds crossings to a sheet that fits. */
export const WRAP_OPTIONS: Record<string, string> = {
  "elk.layered.wrapping.strategy": "MULTI_EDGE",
  "elk.aspectRatio": "1.6",
};

/** Lay out a sheet, wrapping it into rows if it comes out too wide to read on a phone. */
export async function layoutElk(sheet: Sheet, options: Record<string, string> = {}): Promise<Placement> {
  const flat = await layoutOnce(sheet, options);
  if (flat.width / flat.height <= WRAP_ABOVE) return flat;
  return layoutOnce(sheet, { ...WRAP_OPTIONS, ...options });
}

async function layoutOnce(sheet: Sheet, options: Record<string, string>): Promise<Placement> {
  const paired = pairs(sheet);
  const inPair = new Set(paired.flatMap((p) => [p.a.id, p.b.id]));
  const port = (card: Card, p: Card["ports"][number], dx = 0) => ({
    id: `${card.id}/${p.id}`,
    x: p.x + dx,
    y: p.y,
    width: 0,
    height: 0,
    layoutOptions: { "elk.port.side": p.side === "W" ? "WEST" : "EAST" },
  });
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...ELK_OPTIONS, ...options },
    children: [
      ...sheet.cards.filter((c) => !inPair.has(c.id)).map((c) => ({
        id: c.id,
        width: c.w,
        height: c.h,
        layoutOptions: { "elk.portConstraints": "FIXED_POS" },
        ports: c.ports.map((p) => port(c, p)),
      })),
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
    ],
    edges: sheet.wires.filter((w) => !paired.some((p) => p.mate === w.id)).map((w) => ({
      id: w.id,
      sources: [`${w.from.card}/${w.from.port}`],
      targets: [`${w.to.card}/${w.to.port}`],
      labels: w.tag ? [{ text: w.tag.text, width: w.tag.w, height: w.tag.h }] : [],
    })),
  };

  const out = await new ELK().layout(graph);
  const cards = new Map(out.children!.map((n) => [n.id, { x: n.x!, y: n.y! }]));
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
  for (const e of out.edges as ElkExtendedEdge[]) {
    const s = e.sections![0];
    const label = e.labels?.[0];
    routes.set(e.id, {
      kind: "poly",
      points: [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(({ x, y }) => ({ x, y })),
      tag: label ? { x: label.x! + label.width! / 2, y: label.y! + label.height! / 2 } : undefined,
    });
  }
  return { engine: "elk", width: out.width!, height: out.height!, cards, routes };
}
