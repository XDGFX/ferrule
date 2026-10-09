import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSheet, STYLE, titleX, weight } from "../src/sheet.ts";
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

const more: Harness = {
  ...harness,
  connectors: [
    conn("A", 12),
    conn("P", 4),
    { ...conn("Q", 4), pins: pins(4).map((p, i) => ({ ...p, colours: i === 1 ? ["GN", "YE"] : [] })), loops: [["2", "3"]] },
    conn("R", 2),
  ],
  cables: [{ ...harness.cables[0], id: "FEED", template: "FEED" }],
  links: [
    { cable: "FEED", wire: 1, from: { connector: "A", pin: "1" }, to: null },
    { cable: "FEED", wire: 1, from: null, to: { connector: "R", pin: "1" } },
    { cable: "FEED", wire: 1, from: null, to: { connector: "R", pin: "2" } },
  ],
  mates: [{ from: "P", to: "Q" }],
};
const sheet2 = buildSheet(more);
const card2 = (id: string) => sheet2.cards.find((c) => c.id === id)!;

test("a single core that splits or ends open is a card, not a tag", () => {
  assert.equal(card2("FEED").kind, "cable");
  assert.deepEqual(sheet2.wires.filter((w) => w.from.card === "FEED").map((w) => w.to), [
    { card: "R", port: "1:W" },
    { card: "R", port: "2:W" },
  ]);
});

test("a mate joins two connectors at their title bars", () => {
  const m = sheet2.wires.find((w) => w.kind === "mate")!;
  assert.deepEqual([m.from, m.to], [{ card: "P", port: "mate:E" }, { card: "Q", port: "mate:W" }]);
  const port = card2("P").ports.find((p) => p.id === "mate:E")!;
  assert.equal(port.y, card2("P").rowTop / 2);
});

test("looped pins stay unfolded and the loop is kept on the card", () => {
  assert.deepEqual(card2("Q").rows.map((r) => r.fold ?? r.label), ["P1", "P2", "P3", "P4"]);
  assert.deepEqual(card2("Q").loops, [["2", "3"]]);
});

test("pin colours reach the rows", () => {
  assert.deepEqual(card2("Q").rows.map((r) => r.colours), [undefined, ["GN", "YE"], undefined, undefined]);
});

test("a repeated autogenerated part is titled by its template and number", () => {
  const rename: Record<string, string> = { B: "__LAMP_2", ISO: "__LAMP_1" };
  const id = (x: string) => rename[x] ?? x;
  const h: Harness = { ...harness, connectors: harness.connectors.map((c) => (rename[c.id] ? { ...c, id: id(c.id), template: "LAMP" } : c)),
    links: harness.links.map((l) => ({ ...l, to: l.to && { ...l.to, connector: id(l.to.connector) } })) };
  assert.equal(buildSheet(h).cards.find((c) => c.id === "__LAMP_2")!.title, "LAMP · 2");
});

test("a long subtitle wraps inside the card and pushes the rows down", () => {
  const sub = "Gigabit Ethernet Switch with eight ports and passive PoE passthrough on every port";
  const h: Harness = { ...harness, connectors: harness.connectors.map((c) => (c.id === "B" ? { ...c, type: sub } : c)) };
  const b = buildSheet(h).cards.find((c) => c.id === "B")!;
  assert.ok(b.subLines.length > 1);
  assert.equal(b.subLines.join(" "), sub);
  assert.ok(b.rowTop > card("B").rowTop);
});

test("notes keep their bullets as paragraphs and rejoin wrapped source lines", () => {
  const notes = ["- First point that the author", "wrapped by hand", "- Second point"];
  const h: Harness = { ...harness, connectors: harness.connectors.map((c) => (c.id === "B" ? { ...c, notes } : c)) };
  const b = buildSheet(h).cards.find((c) => c.id === "B")!;
  assert.deepEqual(b.notes, ["- First point that the author wrapped by hand", "- Second point"]);
});

test("notes join only a lowercase continuation, so separate items stay separate", () => {
  const notes = ["Cable is self-terminated", "Pin 8: CAN-L", "via BMS LOAD-", "LOAD- terminal: shunt"];
  const h: Harness = { ...harness, connectors: harness.connectors.map((c) => (c.id === "B" ? { ...c, notes } : c)) };
  assert.deepEqual(buildSheet(h).cards.find((c) => c.id === "B")!.notes, ["Cable is self-terminated", "Pin 8: CAN-L via BMS LOAD-", "LOAD- terminal: shunt"]);
});

test("a part used once isn't numbered", () => {
  const h: Harness = { ...harness, connectors: harness.connectors.map((c) => (c.id === "B" ? { ...c, id: "__LAMP_1", template: "LAMP" } : c)),
    links: harness.links.map((l) => (l.to?.connector === "B" ? { ...l, to: { ...l.to, connector: "__LAMP_1" } } : l)) };
  const s = buildSheet(h);
  assert.equal(s.cards.find((c) => c.id === "__LAMP_1")!.title, "LAMP");
  assert.equal(s.cards.find((c) => c.id === "__RUN_1"), undefined);
});

test("a pipe's line weight grows with its bore", () => {
  assert.ok(weight(null, 40) > weight(null, 16));
  assert.ok(weight(null, 16) > weight(null));
});

test("plumbing parts are titled by their label, show port detail, and pipes are tagged by name", () => {
  const plumb: Harness = {
    title: "p",
    connectors: [
      { ...conn("TANK", 2), label: "95L FRESH WATER TANK · a", pins: [{ num: "1", label: "HIGH", colours: [], detail: '1-1/2" BSP · F' }, { num: "2", label: "LOW", colours: [] }] },
      { ...conn("__adapter_1", 1, true), template: "adapter", label: "ADAPTER" },
      { ...conn("__adapter_2", 1, true), template: "adapter", label: "ADAPTER" },
    ],
    cables: [
      { id: "__hose_1", template: "hose", type: "PVC", gauge: null, bore: 25, label: "25MM FILL HOSE", length: "", accent: "#888888", notes: [],
        wires: [{ index: 1, label: "", code: "", colours: ["#f97316"] }] },
      { id: "=2", template: "", type: "", gauge: null, bore: null, label: "", length: "", accent: "#888888", notes: [],
        wires: [{ index: 1, label: "", code: "", colours: [] }] },
    ],
    links: [
      { cable: "__hose_1", wire: 1, from: { connector: "__adapter_1", pin: "1" }, to: { connector: "__adapter_2", pin: "1" }, returns: true },
      { cable: "=2", wire: 1, from: { connector: "TANK", pin: "1" }, to: { connector: "__adapter_1", pin: "1" } },
    ],
    mates: [],
  };
  const s = buildSheet(plumb);
  const tank = s.cards.find((c) => c.id === "TANK")!;
  assert.equal(tank.title, "95L FRESH WATER TANK · a");
  assert.equal(tank.rows[0].detail, '1-1/2" BSP · F');
  assert.ok(tank.w >= buildSheet({ ...plumb, connectors: [{ ...plumb.connectors[0], pins: pins(2) }] }).cards[0].w);
  const [hose, direct] = s.wires;
  assert.equal(hose.tag?.text, "25MM FILL HOSE");
  assert.equal(hose.weight, weight(null, 25));
  assert.deepEqual([hose.from.port, hose.to.port, hose.returns], ["1:E", "1:E", true]);
  assert.equal(direct.tag, undefined);
});

test("a title too long for the widest card wraps and deepens the header", () => {
  const long = 'DWV ADAPTER 1-1/2" BSP FEMALE → 40MM BARB · 2';
  const s = buildSheet({ ...harness, connectors: [{ ...conn("ISO", 1, true), label: long }, { ...conn("A", 12), label: long }] });
  for (const c of s.cards.filter((k) => k.kind !== "cable")) {
    assert.ok(c.titleLines.length > 1, c.id);
    assert.equal(c.titleLines.join(" "), long);
    assert.ok(c.titleLines.at(-1)!.endsWith("BARB · 2"), c.titleLines.join(" / "));
  }
  const plain = buildSheet({ ...harness, connectors: [conn("ISO", 1, true), conn("A", 12)] });
  assert.ok(s.cards[0].h > plain.cards[0].h);
  assert.ok(s.cards[1].rowTop > plain.cards[1].rowTop);
  assert.deepEqual(plain.cards[1].titleLines, ["A"]);
});

test("a run's label reserves room above and below its line, so the text over it clears its neighbours", () => {
  const w = sheet.wires.find((x) => x.tag)!;
  assert.ok(w.tag!.h >= 2 * (w.weight / 2 + 10));
});

const minor: Harness = {
  title: "t",
  connectors: [
    { ...conn("PUMP", 2), glyph: "pump" },
    { ...conn("PLAIN", 2) },
    { ...conn("ADAPTER", 1, true), label: "A LONG ADAPTER LABEL", display: "pill", notes: ["Not drawn"] },
    { ...conn("TEE", 3), display: "pill", notes: ["Not drawn"] },
    { ...conn("OUT", 1), label: "TO OTHER SYSTEM", display: "exit" },
  ],
  cables: [],
  links: [],
  mates: [],
};

test("a pill is one short line, with no subtitle or notes", () => {
  const s = buildSheet(minor);
  const pill = s.cards.find((c) => c.id === "ADAPTER")!;
  assert.equal(pill.display, "pill");
  assert.ok(pill.h < STYLE.simpleH);
  assert.deepEqual([pill.subLines, pill.notes], [[], []]);
});

test("a pill with ports keeps its rows, tighter, and drops its subtitle and notes", () => {
  const tee = buildSheet({ ...minor, links: [{ cable: "X", wire: 1, from: { connector: "TEE", pin: "3" }, to: null }], cables: [
    { id: "X", template: "X", type: "", gauge: null, length: "", accent: "#888888", notes: [], wires: [{ index: 1, label: "", code: "", colours: [] }] },
  ] }).cards.find((c) => c.id === "TEE")!;
  assert.equal(tee.rows.length, 3);
  assert.equal(tee.rowH, STYLE.compactRowH);
  assert.deepEqual([tee.subLines, tee.notes], [[], []]);
  const port = tee.ports.find((p) => p.id === "3:E")!;
  assert.equal(port.y, tee.rowTop + 2.5 * tee.rowH);
});

test("an exit is a single-height tag with every port on its centre line", () => {
  const s = buildSheet({ ...minor, cables: [
    { id: "X", template: "X", type: "", gauge: null, length: "", accent: "#888888", notes: [], wires: [{ index: 1, label: "", code: "", colours: [] }] },
  ], links: [{ cable: "X", wire: 1, from: null, to: { connector: "OUT", pin: "1" } }] });
  const out = s.cards.find((c) => c.id === "OUT")!;
  assert.equal(out.display, "exit");
  assert.equal(out.h, STYLE.exitH);
  assert.deepEqual(out.ports.map((p) => p.y), [out.h / 2]);
});

test("a glyph moves the title along, and only a part that asks for one has it", () => {
  const s = buildSheet(minor);
  const pump = s.cards.find((c) => c.id === "PUMP")!, plain = s.cards.find((c) => c.id === "PLAIN")!;
  assert.equal(pump.glyph, "pump");
  assert.equal(plain.glyph, undefined);
  assert.equal(titleX(pump.glyph) - titleX(plain.glyph), STYLE.glyphTitleX - STYLE.titleX);
  assert.equal(plain.display, "card");
});
