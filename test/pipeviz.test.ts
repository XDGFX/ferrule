import { test } from "node:test";
import assert from "node:assert/strict";
import { hex } from "../src/colours.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import type { Harness } from "../src/model.ts";

const shared = `
templates:
  fitting:
    color: "#64748b"
  tank:
    color: "#2563eb"
components:
  tee:
    template: fitting
    label: 25MM BARB TEE
    ports:
      - name: A
        connection_size: 25MM BARB
        gender: M
      - name: B
      - name: C
  adapter:
    template: fitting
    label: 25MM BARB ADAPTER
    simple: true
`;

const plan = `
components:
  tank:
    template: tank
    label: 95L FRESH WATER TANK
    manufacturer: Camec
    description: >
      95L slimline tank.
    ports: [HIGH, LOW]
  manifold:
    label: MANIFOLD
    portcount: 3
pipes:
  hose:
    label: 25MM FILL HOSE
    size: 25mm
    service_rating: potable
  loop:
    label: UNDERFLOOR LOOP
    size: 3/4"
    color: "#f97316"
connections:
  - - tee:A
    - hose
    - adapter.
    - tank.a:HIGH
  - - tee:B
    - hose
    - tank.b
  - - manifold:2
    - tee:C
`;

const read = (loom: string, prepend = [shared]): Harness => readPipeviz([...prepend, loom], "fresh_tanks");
const h = read(plan);
const conn = (id: string) => h.connectors.find((c) => c.id === id)!;

test("titles a sheet from its file name unless the diagram names it", () => {
  assert.equal(h.title, "Fresh Tanks");
  assert.equal(read(`diagram:\n  title: Fill\n${plan}`).title, "Fill");
});

test("merges prepended templates and components under the plan's own", () => {
  assert.equal(conn("tee").label, "25MM BARB TEE");
  assert.equal(conn("tee").accent, "#64748b");
  assert.equal(conn("tank.a").accent, "#2563eb");
});

test("reads ports as pins, numbered from 1, with their size and gender", () => {
  assert.deepEqual(conn("tee").pins, [
    { num: "1", label: "A", colours: [], detail: "25MM BARB · M" },
    { num: "2", label: "B", colours: [] },
    { num: "3", label: "C", colours: [] },
  ]);
  assert.deepEqual(conn("manifold").pins.map((p) => p.label), ["1", "2", "3"]);
});

test("carries manufacturer and description onto the card", () => {
  assert.equal(conn("tank.a").type, "Camec");
  assert.deepEqual(conn("tank.a").notes, ["95L slimline tank."]);
});

test("names instances on the card: a named one by its name, fresh ones only by number when repeated", () => {
  assert.equal(conn("tank.a").label, "95L FRESH WATER TANK · a");
  const fresh = h.connectors.filter((c) => c.template === "adapter");
  assert.deepEqual(fresh.map((c) => [c.id, c.label, c.simple]), [["__adapter_1", "25MM BARB ADAPTER", true]]);
  const twice = read(`${plan}  - - adapter.\n    - tee:C\n`);
  assert.deepEqual(twice.connectors.filter((c) => c.template === "adapter").map((c) => c.label), [
    "25MM BARB ADAPTER · 1",
    "25MM BARB ADAPTER · 2",
  ]);
});

test("makes each pipe usage its own run, coloured by service and weighted by bore", () => {
  const hoses = h.cables.filter((c) => c.template === "hose");
  assert.equal(hoses.length, 2);
  assert.deepEqual(
    { label: hoses[0].label, bore: hoses[0].bore, colours: hoses[0].wires[0].colours },
    { label: "25MM FILL HOSE", bore: 25, colours: ["BU"] },
  );
  const loop = read(`${plan}  - - tank.a:LOW\n    - loop\n    - tank.b:LOW\n`).cables.find((c) => c.template === "loop")!;
  assert.deepEqual([loop.bore, loop.wires[0].colours], [19.05, ["#f97316"]]);
  const lower = read(plan.replace('color: "#f97316"', "color: og") + "  - - tank.a:LOW\n    - loop\n    - tank.b:LOW\n").cables.find((c) => c.template === "loop")!;
  assert.deepEqual([lower.wires[0].colours, lower.accent], [["OG"], hex("OG")]);
});

test("links each hop, defaulting an omitted port to the first and joining parts that mate directly", () => {
  const ends = h.links.map((l) => [l.from && `${l.from.connector}:${l.from.pin}`, l.to && `${l.to.connector}:${l.to.pin}`]);
  assert.deepEqual(ends, [
    ["tee:1", "__adapter_1:1"],
    ["__adapter_1:1", "tank.a:1"],
    ["tee:2", "tank.b:1"],
    ["manifold:2", "tee:3"],
  ]);
  const direct = h.cables.find((c) => c.id === h.links[1].cable)!;
  assert.deepEqual([direct.label, direct.bore, direct.wires[0].colours], ["", null, []]);
});

test("turns a chain round at a reversed pipe: the rest of it runs back towards the start", () => {
  const u = read(`${plan}  - - tank.a:LOW\n    - adapter.\n    - loop^\n    - adapter.\n    - tank.b:LOW\n`);
  const tail = u.links.slice(-3).map((l) => [`${l.from!.connector}:${l.from!.pin}`, `${l.to!.connector}:${l.to!.pin}`, !!l.returns]);
  assert.deepEqual(tail, [
    ["tank.a:2", "__adapter_2:1", false],
    ["__adapter_2:1", "__adapter_3:1", true],
    ["tank.b:2", "__adapter_3:1", false],
  ]);
});

test("rejects what pipeviz rejects", () => {
  const bad = (connections: string, extra = "") => () => read(`${extra}${plan.replace(/connections:[\s\S]*/, `connections:\n${connections}`)}`);
  assert.throws(bad("  - [tee:A]\n"), /at least two/);
  assert.throws(bad("  - [tee:A, hose, hose, tank]\n"), /pipe to pipe/);
  assert.throws(bad("  - [tee:A, nothing]\n"), /nothing/);
  assert.throws(bad("  - [tee:D, tank]\n"), /no port D/);
  assert.throws(bad("  - [manifold:4, tank]\n"), /no port 4/);
  assert.throws(bad("  - [adapter.:A, tank]\n"), /simple/);
  assert.throws(bad("  - ['tee:[A,B]', tank]\n"), /one port/);
  assert.throws(bad("  - [tee:A, loop^, tank.a, loop^, tank.b]\n"), /once/);
  assert.throws(bad("  - [tee:A, hose.x, tank]\n"), /no instance/);
  assert.throws(() => read(`components:\n  x:\n    ports: [A]\nconnections:\n  - [x, x.b]\n`, []), /label/);
  assert.throws(() => read(`components:\n  x:\n    label: X\nconnections:\n  - [x, x.b]\n`, []), /ports or portcount/);
  assert.throws(() => read(`components:\n  x:\n    label: X\n    ports: [A]\n    portcount: 2\nconnections:\n  - [x, x.b]\n`, []), /portcount/);
  assert.throws(() => read(`components:\n  x:\n    label: X\n    simple: true\n    display: chip\nconnections:\n  - [x, x.b]\n`, []), /display "chip" should be one of card, pill, exit/);
  assert.throws(() => read(`components:\n  x:\n    label: X\n    simple: true\n    glyph: boiler\nconnections:\n  - [x, x.b]\n`, []), /glyph "boiler" should be one of valve/);
});

test("reads display and glyph from a template, and leaves them unset where none is given", () => {
  const h = read(`
templates:
  fitting:
    display: pill
  pump:
    glyph: pump
components:
  adapter:
    template: fitting
    label: ADAPTER
    simple: true
  pump:
    template: pump
    label: PUMP
    ports: [IN, OUT]
  out:
    label: TO OTHER SYSTEM
    display: exit
    ports: [OUT]
  tank:
    label: TANK
    ports: [OUT]
connections:
  - [tank, adapter., pump:IN]
  - [pump:OUT, out]
`, []);
  const c = (id: string) => h.connectors.find((k) => k.template === id)!;
  assert.equal(c("adapter").display, "pill");
  assert.equal(c("pump").glyph, "pump");
  assert.equal(c("out").display, "exit");
  assert.equal(c("tank").display, undefined);
  assert.equal(c("tank").glyph, undefined);
});
