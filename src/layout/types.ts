export interface Pt {
  x: number;
  y: number;
}

export interface Route {
  /** `poly` is an orthogonal polyline; `bezier` is a cubic spline, start point then three per segment. */
  kind: "poly" | "bezier";
  points: Pt[];
  /** Centre of the wire's tag, when it has one. */
  tag?: Pt;
}

/** Where a layout engine put everything. Coordinates are px, origin top left. */
export interface Placement {
  engine: string;
  width: number;
  height: number;
  cards: Map<string, Pt>;
  routes: Map<string, Route>;
}
