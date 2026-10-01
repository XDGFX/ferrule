import { test } from "node:test";
import assert from "node:assert/strict";
import { measure } from "../src/metrics.ts";
import type { Placement, Route } from "../src/layout/types.ts";
import type { Card, Sheet } from "../src/sheet.ts";

const card = (id: string, w: number, h: number): Card => ({
  id, kind: "connector", title: id, sub: "", accent: "#888888", w, h, rowTop: 0, rowH: 24, rows: [], loops: [], notes: [], ports: [],
});
const wire = (id: string, tag = false) => ({
  id, from: { card: "A", port: "1:E" }, to: { card: "B", port: "1:W" }, colours: ["RD"], weight: 3,
  tag: tag ? { text: "t", w: 20, h: 10 } : undefined,
});
const poly = (...xy: number[][]): Route => ({ kind: "poly", points: xy.map(([x, y]) => ({ x, y })) });

function placement(routes: Record<string, Route>): Placement {
  return {
    engine: "test", width: 400, height: 200,
    cards: new Map([["A", { x: 0, y: 0 }], ["B", { x: 300, y: 0 }], ["C", { x: 150, y: 120 }]]),
    routes: new Map(Object.entries(routes)),
  };
}

const sheet: Sheet = { title: "t", cards: [card("A", 100, 100), card("B", 100, 100), card("C", 50, 50)], wires: [wire("x"), wire("y", true)] };

test("an X between two wires is one crossing; a shared endpoint is not", () => {
  const m = measure(sheet, placement({
    x: poly([100, 20], [200, 20], [200, 80], [300, 80]),
    y: poly([100, 90], [150, 90], [150, 10], [300, 10]),
  }));
  assert.equal(m.crossings, 1);
  const shared = measure(sheet, placement({ x: poly([100, 50], [300, 20]), y: poly([100, 50], [300, 80]) }));
  assert.equal(shared.crossings, 0);
});

test("bends count the corners of orthogonal routes", () => {
  const m = measure(sheet, placement({ x: poly([100, 20], [200, 20], [200, 80], [300, 80]), y: poly([100, 50], [300, 50]) }));
  assert.equal(m.bends, 2);
  assert.equal(m.length, 100 + 60 + 100 + 200);
});

test("a wire through a card that is not its end is counted", () => {
  const m = measure(sheet, placement({ x: poly([100, 20], [300, 20]), y: poly([100, 80], [140, 80], [140, 145], [300, 145]) }));
  assert.equal(m.throughCards, 1);
});

test("a tag over a card is counted", () => {
  const routes = { x: poly([100, 20], [300, 20]), y: poly([100, 145], [300, 145]) };
  const p = placement(routes);
  p.routes.get("y")!.tag = { x: 175, y: 145 };
  assert.equal(measure(sheet, p).tagOverlaps, 1);
  p.routes.get("y")!.tag = { x: 260, y: 160 };
  assert.equal(measure(sheet, p).tagOverlaps, 0);
});

test("area is the canvas", () => {
  assert.equal(measure(sheet, placement({ x: poly([100, 20], [300, 20]), y: poly([100, 80], [300, 80]) })).area, 80000);
});
