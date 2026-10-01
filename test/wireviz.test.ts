import { test } from "node:test";
import assert from "node:assert/strict";
import { stripes } from "../src/colours.ts";
import { readWireviz } from "../src/wireviz.ts";

const shared = `
templates:
  - &victron
    bgcolor: "#36b7ff"
    manufacturer: "Victron Energy"
  - &SHARED_CONNECTORS
    UNUSED_SHARED:
      pinlabels: ["A"]
`;

const loom = `
connectors:
  <<: *SHARED_CONNECTORS
  BAT:
    type: "Battery"
    pinlabels: ["BAT+", "BAT-"]
    bgcolor: "BU"
  SHUNT:
    <<: *victron
    type: "SmartShunt"
    pinlabels: ["BATT-", "LOAD-"]
  ISO:
    style: simple
    type: "Isolator"
  BLOCK:
    type: "Fuse block"
    pinlabels: ["FEED", "OUT1"]
  BUS:
    type: "Bus bar"
    pincount: 3
cables:
  RUN:
    gauge: "50 mm2"
    length: 1.5 m
    wirecount: 1
    colors: ["RD"]
    wirelabels: ["24V"]
  TWIN:
    wirecount: 2
    colors: ["RD", "GNYE"]
    wirelabels: ["24V", "GND"]
connections:
  -
    - BAT: [BAT+]
    - RUN.: [24V]
    - ISO
  -
    - ISO
    - RUN.: [24V]
    - BLOCK.BLOCK_A: [FEED]
  -
    - BLOCK.BLOCK_A: [OUT1]
    - TWIN: [24V]
    - SHUNT: [LOAD-]
  -
    - BUS: [3]
    - TWIN: [2]
    - SHUNT: [BATT-]
`;

const read = () => readWireviz([shared, loom], "Test loom");

test("prepended anchors and merge keys resolve", () => {
  const h = read();
  const shunt = h.connectors.find((c) => c.id === "SHUNT")!;
  assert.equal(shunt.accent, "#36b7ff");
  assert.equal(shunt.type, "SmartShunt");
});

test("only connectors a connection uses are drawn", () => {
  const ids = read().connectors.map((c) => c.id);
  assert.deepEqual(ids, ["BAT", "ISO", "BLOCK_A", "SHUNT", "BUS"]);
});

test("a named instance takes its template's pins", () => {
  const block = read().connectors.find((c) => c.id === "BLOCK_A")!;
  assert.equal(block.template, "BLOCK");
  assert.deepEqual(block.pins.map((p) => p.label), ["FEED", "OUT1"]);
});

test("a trailing dot makes a fresh cable instance on every use", () => {
  const runs = read().cables.filter((c) => c.template === "RUN");
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].id, runs[1].id);
  assert.equal(runs[0].gauge, 50);
  assert.equal(runs[0].length, "1.5 m");
});

test("pincount without labels numbers the pins", () => {
  const bus = read().connectors.find((c) => c.id === "BUS")!;
  assert.deepEqual(bus.pins.map((p) => p.num), ["1", "2", "3"]);
});

test("simple connectors attach as one pin", () => {
  const iso = read().connectors.find((c) => c.id === "ISO")!;
  assert.equal(iso.simple, true);
  assert.equal(iso.pins.length, 1);
});

test("links resolve pins by label or number and wires by label or number", () => {
  const h = read();
  const twin = h.links.filter((l) => l.cable === "TWIN");
  assert.deepEqual(twin, [
    { cable: "TWIN", wire: 1, from: { connector: "BLOCK_A", pin: "2" }, to: { connector: "SHUNT", pin: "2" } },
    { cable: "TWIN", wire: 2, from: { connector: "BUS", pin: "3" }, to: { connector: "SHUNT", pin: "1" } },
  ]);
});

test("two-colour codes split into stripes", () => {
  const twin = read().cables.find((c) => c.id === "TWIN")!;
  assert.deepEqual(twin.wires.map((w) => w.colours), [["RD"], ["GN", "YE"]]);
});

test("a hex colour is one stripe, not split like a code", () => {
  assert.deepEqual(stripes("#d2b48c"), ["#d2b48c"]);
});

test("an unknown pin is an error, not a silent gap", () => {
  const bad = loom.replace("SHUNT: [LOAD-]", "SHUNT: [NOPE]");
  assert.throws(() => readWireviz([shared, bad], "x"), /SHUNT.*NOPE/);
});

test("cable notes are read", () => {
  const withNotes = loom.replace('    wirelabels: ["24V", "GND"]\n', '    wirelabels: ["24V", "GND"]\n    notes: |\n      Verify gauge\n');
  assert.deepEqual(readWireviz([shared, withNotes], "x").cables.find((c) => c.id === "TWIN")!.notes, ["Verify gauge"]);
});

// Syntax the other Hailey looms use, matched against how the WireViz fork reads it.
const more = `
connectors:
  DT:
    pinlabels: ["A", "B", "C", "D"]
    pincolors: ["RD", "BK", "GNYE", ""]
  PLUG:
    pincount: 1
    pinlabels: ["ETH"]
  LAMP:
    pinlabels: ["DI", "BI", "BO", "GND"]
    loops: [[2, 3]]
cables:
  QUAD:
    wirecount: 4
    colors: ["RD", "BK", "YE", "WH"]
    wirelabels: ["V1", "GND", "D1", "D2"]
  ETH:
    wirecount: 1
    colors: ["GY"]
connections:
  -
    - DT: [1-4]
    - QUAD: [1-4]
    - DT.DT_B: [1-4]
  -
    - PLUG
    - ETH.
    - LAMP: [DI]
  -
    - DT.DT_B
    - [==]
    - DT.DT_C
  -
    - QUAD.QUAD_B: [V1, BK]
    - LAMP: [BO, GND]
`;
const readMore = () => readWireviz([more], "More");

test("pin ranges expand, as WireViz's expand does", () => {
  const quad = readMore().links.filter((l) => l.cable === "QUAD");
  assert.deepEqual(quad.map((l) => [l.from!.pin, l.wire, l.to!.pin]), [["1", 1, "1"], ["2", 2, "2"], ["3", 3, "3"], ["4", 4, "4"]]);
});

test("a bare connector name connects its pin 1", () => {
  const eth = readMore().links.find((l) => l.cable.startsWith("__ETH"))!;
  assert.deepEqual(eth.from, { connector: "PLUG", pin: "1" });
  assert.deepEqual(eth.to, { connector: "LAMP", pin: "1" });
});

test("a set that starts with a cable leaves that end open", () => {
  const b = readMore().links.filter((l) => l.cable === "QUAD_B");
  assert.deepEqual(b.map((l) => [l.from, l.wire, l.to?.pin]), [[null, 1, "3"], [null, 2, "4"]]);
});

test("a wire can be named by its colour code", () => {
  const b = readMore().links.filter((l) => l.cable === "QUAD_B");
  assert.equal(b[1].wire, 2);
});

test("an == arrow mates two connectors as a whole", () => {
  assert.deepEqual(readMore().mates, [{ from: "DT_B", to: "DT_C" }]);
});

test("loops and pin colours are read", () => {
  const h = readMore();
  assert.deepEqual(h.connectors.find((c) => c.id === "LAMP")!.loops, [["2", "3"]]);
  assert.deepEqual(h.connectors.find((c) => c.id === "DT")!.pins.map((p) => p.colours), [["RD"], ["BK"], ["GN", "YE"], []]);
});

test("a duplicate key takes the last value, as PyYAML does", () => {
  const dup = `connectors:\n  X:\n    type: "one"\n    type: "two"\n    pinlabels: ["A"]\ncables:\n  W:\n    wirecount: 1\nconnections:\n  -\n    - X: [A]\n    - W: [1]\n`;
  assert.equal(readWireviz([dup], "x").connectors[0].type, "two");
});

test("a fresh instance is one per entry, however many wires the entry names", () => {
  const src = `connectors:\n  A:\n    pinlabels: ["X", "Y"]\ncables:\n  TWIN:\n    wirecount: 2\nconnections:\n  -\n    - A: [X, Y]\n    - TWIN.: [1, 2]\n  -\n    - A: [X]\n    - TWIN.: [1]\n`;
  const twins = readWireviz([src], "x").cables.map((c) => c.id);
  assert.deepEqual(twins, ["__TWIN_1", "__TWIN_2"]);
});

test("a bare fresh name repeated down a set is a new instance on every row, as in the fork", () => {
  const src = `connectors:\n  A:\n    pinlabels: ["X", "Y"]\n  B:\n    pincount: 1\ncables:\n  ONE:\n    wirecount: 1\nconnections:\n  -\n    - A: [X, Y]\n    - ONE.: [1, 1]\n    - B.\n`;
  assert.deepEqual(readWireviz([src], "x").connectors.map((c) => c.id), ["A", "__B_1", "__B_2"]);
});

test("a loop on a pin the connector doesn't have is an error, as in the fork", () => {
  const src = `connectors:\n  A:\n    pinlabels: ["X", "Y"]\n    loops: [[1, 3]]\ncables:\n  W:\n    wirecount: 1\nconnections:\n  -\n    - A: [X]\n    - W: [1]\n`;
  assert.throws(() => readWireviz([src], "x"), /A.*loop pin 3/);
});

test("more pin labels than pincount is an error, not dropped labels", () => {
  const src = `connectors:\n  A:\n    pincount: 1\n    pinlabels: ["X", "Y"]\ncables:\n  W:\n    wirecount: 1\nconnections:\n  -\n    - A: [X]\n    - W: [1]\n`;
  assert.throws(() => readWireviz([src], "x"), /A.*2 pin labels.*1 pin/);
});
