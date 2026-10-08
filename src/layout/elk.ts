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

/** The gap between the two halves of a mated pair. */
const MATE_GAP = 48;

/** How far a returning wire's two legs stay apart where it turns round. */
const TURN_GAP = 16;

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
  const turns = returning.map((w) => ({
    id: `turn:${w.id}`,
    width: w.tag?.w ?? TURN_GAP,
    height: (w.tag?.h ?? 0) + 2 * TURN_GAP,
    layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
    ports: ["a", "b"].map((leg) => ({ id: `turn:${w.id}/${leg}`, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } })),
  }));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...ELK_OPTIONS, ...(sheet.wrap ? wrapOptions(sheet.wrap) : {}), ...options },
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
      ...turns,
    ],
    edges: [
      ...returning.flatMap((w) => [
        { id: `${w.id}/a`, sources: [`${w.from.card}/${w.from.port}`], targets: [`turn:${w.id}/a`] },
        { id: `${w.id}/b`, sources: [`${w.to.card}/${w.to.port}`], targets: [`turn:${w.id}/b`] },
      ]),
      ...sheet.wires.filter((w) => !w.returns && !paired.some((p) => p.mate === w.id)).map((w) => ({
      id: w.id,
      sources: [`${w.from.card}/${w.from.port}`],
      targets: [`${w.to.card}/${w.to.port}`],
      labels: w.tag ? [{ text: w.tag.text, width: w.tag.w, height: w.tag.h }] : [],
      })),
    ],
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
  const edges = new Map((out.edges as ElkExtendedEdge[]).map((e) => [e.id, e]));
  const points = (e: ElkExtendedEdge) => {
    const s = e.sections![0];
    return [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(({ x, y }) => ({ x, y }));
  };
  const legs = new Set(returning.flatMap((w) => [`${w.id}/a`, `${w.id}/b`]));
  for (const e of edges.values()) {
    if (legs.has(e.id)) continue;
    const label = e.labels?.[0];
    routes.set(e.id, {
      kind: "poly",
      points: points(e),
      tag: label ? { x: label.x! + label.width! / 2, y: label.y! + label.height! / 2 } : undefined,
    });
  }
  // A returning wire runs out along one leg, down the middle of its turn, and back along the other.
  for (const w of returning) {
    const turn = cards.get(`turn:${w.id}`)!;
    cards.delete(`turn:${w.id}`);
    const a = points(edges.get(`${w.id}/a`)!), b = points(edges.get(`${w.id}/b`)!).reverse();
    const x = turn.x + (w.tag?.w ?? TURN_GAP) / 2;
    const [ya, yb] = [a[a.length - 1].y, b[0].y];
    routes.set(w.id, { kind: "poly", points: [...a, { x, y: ya }, { x, y: yb }, ...b], tag: { x, y: (ya + yb) / 2 } });
  }
  return { engine: "elk", width: out.width!, height: out.height!, cards, routes };
}
