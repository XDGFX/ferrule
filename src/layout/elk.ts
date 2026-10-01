// Layout with elkjs: layered, left to right, ports fixed at their rows, orthogonal wires.
// elkjs is pure JavaScript with a fixed seed, so the same sheet lays out the same everywhere.

import elkModule from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";

// elkjs is CommonJS: at runtime the default import is the constructor, but its types describe
// the module, whose `default` is the constructor.
const ELK = elkModule as unknown as typeof elkModule.default;
import type { Sheet } from "../sheet.ts";
import type { Placement, Route } from "./types.ts";

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.randomSeed": "1",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  "elk.spacing.nodeNode": "36",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
  "elk.edgeLabels.inline": "true",
  "elk.edgeLabels.placement": "CENTER",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
  "elk.layered.thoroughness": "40",
};

export async function layoutElk(sheet: Sheet, options: Record<string, string> = {}): Promise<Placement> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...ELK_OPTIONS, ...options },
    children: sheet.cards.map((c) => ({
      id: c.id,
      width: c.w,
      height: c.h,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: c.ports.map((p) => ({
        id: `${c.id}/${p.id}`,
        x: p.x,
        y: p.y,
        width: 0,
        height: 0,
        layoutOptions: { "elk.port.side": p.side === "W" ? "WEST" : "EAST" },
      })),
    })),
    edges: sheet.wires.map((w) => ({
      id: w.id,
      sources: [`${w.from.card}/${w.from.port}`],
      targets: [`${w.to.card}/${w.to.port}`],
      labels: w.tag ? [{ text: w.tag.text, width: w.tag.w, height: w.tag.h }] : [],
    })),
  };

  const out = await new ELK().layout(graph);
  const cards = new Map(out.children!.map((n) => [n.id, { x: n.x!, y: n.y! }]));
  const routes = new Map<string, Route>();
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
