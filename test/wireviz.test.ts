import { test } from "node:test";
import assert from "node:assert/strict";
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

test("an unknown pin is an error, not a silent gap", () => {
  const bad = loom.replace("SHUNT: [LOAD-]", "SHUNT: [NOPE]");
  assert.throws(() => readWireviz([shared, bad], "x"), /SHUNT.*NOPE/);
});

test("cable notes are read", () => {
  const withNotes = loom.replace('    wirelabels: ["24V", "GND"]\n', '    wirelabels: ["24V", "GND"]\n    notes: |\n      Verify gauge\n');
  assert.deepEqual(readWireviz([shared, withNotes], "x").cables.find((c) => c.id === "TWIN")!.notes, ["Verify gauge"]);
});
