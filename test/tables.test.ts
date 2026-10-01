import { test } from "node:test";
import assert from "node:assert/strict";
import { tables } from "../src/tables.ts";
import type { Harness } from "../src/model.ts";

const pin = (num: string, label = "") => ({ num, label, colours: [] });
const conn = (id: string, pins: ReturnType<typeof pin>[], extra = {}) => ({
  id, template: id, type: "Deutsch DT", subtype: "", pins, simple: false, loops: [], accent: "#888888", notes: [], ...extra,
});

const harness: Harness = {
  title: "test_loom",
  connectors: [
    conn("PANEL", [pin("1", "PUMP"), pin("2", "GND")]),
    conn("PLUG", [pin("1", "PUMP"), pin("2", "GND"), pin("3", "SPARE")], { loops: [["2", "3"]] }),
    { ...conn("__WAGO_1", [pin("1")], { simple: true }), template: "WAGO" },
    conn("SOCKET", [pin("1")]),
  ],
  cables: [
    { id: "LOOM", template: "LOOM", type: "Multi-core", gauge: 1.5, length: "2 m", accent: "#888888", notes: [],
      wires: [{ index: 1, label: "PUMP", code: "RD", colours: ["RD"] }, { index: 2, label: "GND", code: "GNYE", colours: ["GN", "YE"] }] },
    { id: "__RUN_1", template: "RUN", type: "", gauge: null, length: "", accent: "#888888", notes: [],
      wires: [{ index: 1, label: "", code: "BK", colours: ["BK"] }] },
    { id: "__RUN_2", template: "RUN", type: "", gauge: null, length: "", accent: "#888888", notes: [],
      wires: [{ index: 1, label: "", code: "BK", colours: ["BK"] }] },
  ],
  links: [
    // One core, described by two connection sets: the far end is joined up across them.
    { cable: "LOOM", wire: 1, from: null, to: { connector: "PLUG", pin: "1" } },
    { cable: "LOOM", wire: 1, from: { connector: "PANEL", pin: "1" }, to: null },
    { cable: "LOOM", wire: 2, from: { connector: "PANEL", pin: "2" }, to: { connector: "__WAGO_1", pin: "1" } },
    { cable: "__RUN_1", wire: 1, from: { connector: "__WAGO_1", pin: "1" }, to: { connector: "PLUG", pin: "2" } },
    { cable: "__RUN_2", wire: 1, from: { connector: "__WAGO_1", pin: "1" }, to: null },
  ],
  mates: [{ from: "PLUG", to: "SOCKET" }],
};

const md = tables(harness);
const section = (heading: string) => {
  const start = md.indexOf(heading);
  assert.ok(start >= 0, `no ${heading}`);
  const next = md.indexOf("\n#", start + heading.length);
  return md.slice(start, next < 0 ? undefined : next);
};
const rows = (text: string) => text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| ---")).slice(1);

test("the cut list has one row per core, with both ends joined across connection sets", () => {
  const cut = rows(section("## Cut list"));
  assert.deepEqual(cut, [
    "| LOOM | 1 PUMP | RD | 1.5 mm² | 2 m | PANEL 1 · PUMP | PLUG 1 · PUMP |",
    "| LOOM | 2 GND | GNYE | 1.5 mm² | 2 m | PANEL 2 · GND | WAGO |",
    "| RUN · 1 | 1 | BK | – | – | WAGO | PLUG 2 · GND |",
    "| RUN · 2 | 1 | BK | – | – | WAGO | – |",
  ]);
});

test("a connector's pinout lists every pin, the wire on it and where that wire goes", () => {
  const plug = section("### PLUG");
  assert.match(plug, /Deutsch DT · mates with SOCKET/);
  assert.deepEqual(rows(plug), [
    "| 1 | PUMP | LOOM 1 · RD | PANEL 1 · PUMP |",
    "| 2 | GND | RUN · 1 · BK | WAGO |",
    "| | | looped to 3 | |",
    "| 3 | SPARE | looped to 2 | |",
  ]);
});

test("a pin with several wires gets a row for each", () => {
  assert.deepEqual(rows(section("### WAGO")), [
    "| – | | LOOM 2 · GNYE | PANEL 2 · GND |",
    "| | | RUN · 1 · BK | PLUG 2 · GND |",
    "| | | RUN · 2 · BK | – |",
  ]);
});

test("an unused pin is listed with no wire", () => {
  assert.deepEqual(rows(section("### SOCKET")), ["| 1 | | – | |"]);
});

test("a pipe in a label can't break the table", () => {
  const h: Harness = { ...harness, connectors: [conn("X", [pin("1", "A|B")])], cables: [], links: [], mates: [] };
  assert.match(tables(h), /\| 1 \| A\\\|B \|/);
});
