import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheet, weight } from "../src/sheet.ts";
import type { Harness } from "../src/model.ts";

const pins = (n: number) => Array.from({ length: n }, (_, i) => ({ num: String(i + 1), label: `P${i + 1}`, colours: [] }));
const conn = (id: string, n: number, simple = false) => ({
  id, template: id, type: "T", subtype: "", pins: simple ? pins(1) : pins(n), simple, loops: [], accent: "#888888", notes: [],
});

const harness: Harness = {
  title: "t",
  connectors: [conn("A", 12), conn("B", 2), conn("ISO", 1, true)],
  cables: [
    { id: "__RUN_1", template: "RUN", type: "", gauge: 50, length: "1.5 m", accent: "#888888", notes: [],
      wires: [{ index: 1, label: "24V", code: "RD", colours: ["RD"] }] },
    { id: "TWIN", template: "TWIN", type: "Twin", gauge: 16, length: "0.75 m", accent: "#888888", notes: [],
      wires: [{ index: 1, label: "24V", code: "RD", colours: ["RD"] }, { index: 2, label: "GND", code: "BK", colours: ["BK"] }] },
  ],
  links: [
    { cable: "__RUN_1", wire: 1, from: { connector: "A", pin: "1" }, to: { connector: "ISO", pin: "1" } },
    { cable: "TWIN", wire: 1, from: { connector: "A", pin: "2" }, to: { connector: "B", pin: "1" } },
    { cable: "TWIN", wire: 2, from: { connector: "A", pin: "7" }, to: { connector: "B", pin: "2" } },
  ],
  mates: [],
};

const sheet = buildSheet(harness);
const card = (id: string) => sheet.cards.find((c) => c.id === id)!;

test("a single-core run is a tagged wire, not a card", () => {
  assert.equal(sheet.cards.some((c) => c.id === "__RUN_1"), false);
  const w = sheet.wires.find((w) => w.from.card === "A" && w.to.card === "ISO")!;
  assert.equal(w.tag?.text, "50 mm² · 1.5 m");
});

test("a multi-core cable is a card each core passes through", () => {
  assert.equal(card("TWIN").kind, "cable");
  const through = sheet.wires.filter((w) => w.from.card === "TWIN" || w.to.card === "TWIN");
  assert.equal(through.length, 4);
});

test("a pin gets an east port where a run leaves and a west port where one arrives", () => {
  assert.deepEqual(card("A").ports.map((p) => p.id), ["1:E", "2:E", "7:E"]);
  assert.deepEqual(card("B").ports.map((p) => p.id), ["1:W", "2:W"]);
  const a = card("A");
  assert.equal(a.ports[0].x, a.w);
  assert.equal(card("B").ports[0].x, 0);
});

test("runs of three or more unused pins fold into one row", () => {
  const rows = card("A").rows.map((r) => r.fold ?? r.label);
  assert.deepEqual(rows, ["P1", "P2", "3–6 · 4 unused", "P7", "8–12 · 5 unused"]);
});

test("ports sit on their row's centre line", () => {
  const a = card("A");
  const rowOf7 = a.rows.findIndex((r) => r.key === "7");
  const p7 = a.ports.find((p) => p.id === "7:E")!;
  assert.equal(p7.y, a.rowTop + rowOf7 * a.rowH + a.rowH / 2);
});

test("line weight grows with conductor size", () => {
  assert.ok(weight(50) > weight(16));
  assert.ok(weight(16) > weight(0.75));
  assert.equal(weight(null), weight(0.75));
});

test("tag sizes drop trailing zeros and a bare decimal point", () => {
  const spec = (gauge: number) => {
    const h: Harness = { ...harness, cables: [{ ...harness.cables[0], gauge, length: "" }], links: [harness.links[0]] };
    return buildSheet(h).wires[0].tag?.text;
  };
  assert.equal(spec(1.5), "1.5 mm²");
  assert.equal(spec(2.001), "2 mm²");
  assert.equal(spec(0.823), "0.82 mm²");
});

test("a cable card carries its notes", () => {
  const h: Harness = { ...harness, cables: harness.cables.map((c) => (c.id === "TWIN" ? { ...c, notes: ["Verify gauge"] } : c)) };
  assert.deepEqual(buildSheet(h).cards.find((c) => c.id === "TWIN")!.notes, ["Verify gauge"]);
});
