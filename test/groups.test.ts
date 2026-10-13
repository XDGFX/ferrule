import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import type { Box } from "../src/layout/types.ts";
import { textWidth } from "../src/measure.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { render } from "../src/render.ts";
import { buildSheet, STYLE } from "../src/sheet.ts";

const parts = `
components:
  tank:
    label: TANK
    ports: [HIGH, LOW]
  pump:
    label: PUMP
    ports: [IN, OUT]
  adapter:
    label: ADAPTER
    simple: true
pipes:
  hose:
    label: 40MM HOSE
    size: 40mm
`;

const chain = `
connections:
  - [tank.a:LOW, hose, pump:IN]
  - [pump:OUT, adapter., hose, tank.b:HIGH]
  - [tank.b:LOW, hose, tank.c:HIGH]
`;

const box = (members: string, label = "    label: WATER BOX\n") => `groups:\n  box:\n${label}    members: [${members}]\n`;
const read = (groups: string, connections = chain, prepend: string[] = []) => readPipeviz([...prepend, parts + groups + connections], "plan");

test("reads a group's label and the members a chain draws, named as the chain names them", () => {
  assert.equal(read("").groups, undefined);
  assert.deepEqual(read(box("pump, tank.b")).groups, [{ id: "box", label: "WATER BOX", members: ["pump", "tank.b"] }]);
  assert.deepEqual(read(box("pump", "")).groups, [{ id: "box", label: "", members: ["pump"] }]);
  // `tank.z` is a tank no chain names, as in a group shared by plans that each draw part of it.
  assert.deepEqual(read(box("pump, tank.z")).groups![0].members, ["pump"]);
});

test("takes groups from a prepended file, under the plan's own", () => {
  const shared = "groups:\n  box:\n    label: SHARED\n    members: [pump]\n  other:\n    members: [tank.c]\n";
  assert.deepEqual(read(box("tank.a"), chain, [shared]).groups, [
    { id: "box", label: "WATER BOX", members: ["tank.a"] },
    { id: "other", label: "", members: ["tank.c"] },
  ]);
});

test("rejects a group that names what it can't frame", () => {
  assert.throws(() => read(box("pump, boiler")), /groups\.box: no component is defined as boiler/);
  assert.throws(() => read(box("pump, hose")), /groups\.box: hose is a pipe/);
  assert.throws(() => read(box("pump, adapter.")), /groups\.box: adapter\. is a fresh instance/);
  assert.throws(() => read(box("'pump:IN'")), /groups\.box: pump:IN should name a part/);
  assert.throws(() => read(box("tank.z")), /groups\.box: none of its members is drawn/);
  assert.throws(() => read(box("pump, pump")), /groups\.box: pump is already in this group/);
  assert.throws(() => read(box("pump") + "  other:\n    members: [tank.a, pump]\n"), /groups\.other: pump is already in group box/);
  assert.throws(() => read(box("")), /groups\.box: members should be a list of parts/);
  assert.throws(() => read("groups:\n  box: [pump]\n"), /groups\.box: .* should be a map/);
  assert.throws(() => read(box("pump") + "    colour: red\n"), /groups\.box: unknown key colour; only label and members are read/);
});

const lay = async (groups: string, connections = chain, prepend: string[] = []) => {
  const sheet = buildSheet(read(groups, connections, prepend));
  const place = await layoutElk(sheet);
  const rect = (id: string): Box => {
    const c = sheet.cards.find((k) => k.id === id)!;
    return { ...place.cards.get(id)!, w: c.w, h: c.h };
  };
  return { sheet, place, rect };
};

const inside = (f: Box, r: Box, pad = 0) => r.x >= f.x + pad && r.y >= f.y + pad && r.x + r.w <= f.x + f.w - pad && r.y + r.h <= f.y + f.h - pad;
const apart = (f: Box, r: Box) => r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y;

test("a frame encloses its members, under a band for its title, and no other card", async () => {
  const { sheet, place, rect } = await lay(box("pump, tank.b"));
  const f = place.frames!.get("box")!;
  for (const c of sheet.cards) {
    const member = ["pump", "tank.b"].includes(c.id);
    assert.ok(member ? inside(f, rect(c.id), STYLE.framePad) : apart(f, rect(c.id)), c.id);
  }
  assert.ok(rect("pump").y - f.y >= STYLE.framePad + STYLE.frameTitleH);
  // The adapter between the two members is not one, so it sits outside and the pipes go round to it.
  assert.equal(sheet.cards.length, 5);
  assert.equal(place.routes.size, sheet.wires.length);

  const untitled = await lay(box("pump, tank.b", ""));
  assert.equal(untitled.rect("pump").y - untitled.place.frames!.get("box")!.y, STYLE.framePad);
  assert.equal((await lay("")).place.frames, undefined);
});

test("a frame is at least as wide as its title", async () => {
  const title = "A VERY LONG TITLE FOR A BOX HOLDING ONE SMALL PUMP";
  const { place, rect } = await lay(box("pump", `    label: ${title}\n`));
  const f = place.frames!.get("box")!;
  assert.ok(f.w > rect("pump").w + 2 * STYLE.framePad);
  assert.ok(f.w >= textWidth(title, STYLE.frameTitleSize, 600) + title.length * STYLE.frameTitleSpacing + 2 * STYLE.framePad);
});

const loops = `
connections:
  - [tank.a:LOW, hose^, tank.b:LOW]
  - [tank.b:HIGH, hose^, tank.c:HIGH]
  - [tank.c:LOW, hose^, tank.d:LOW]
`;
const two = "groups:\n  ab:\n    label: AB\n    members: [tank.a, tank.b]\n  c:\n    label: C\n    members: [tank.c]\n";

test("a turn stays inside a frame when both its ends do, and outside every frame otherwise", async () => {
  const { sheet, place, rect } = await lay(two, loops);
  const [ab, c] = [place.frames!.get("ab")!, place.frames!.get("c")!];
  assert.ok(apart(ab, c));
  assert.ok(inside(ab, rect("tank.a")) && inside(ab, rect("tank.b")) && inside(c, rect("tank.c")) && apart(ab, rect("tank.d")) && apart(c, rect("tank.d")));
  const route = (from: string, to: string) => place.routes.get(sheet.wires.find((w) => w.from.card === from && w.to.card === to)!.id)!;
  const within = (f: Box, p: { x: number; y: number }) => inside(f, { ...p, w: 0, h: 0 });

  const kept = route("tank.a", "tank.b");
  assert.ok(kept.points.every((p) => within(ab, p)));
  assert.ok(within(ab, { x: kept.tag!.x + sheet.wires[0].tag!.w, y: kept.tag!.y }));
  // Between two frames, or a frame and a bare card, the turn is in neither frame.
  for (const [from, to] of [["tank.b", "tank.c"], ["tank.c", "tank.d"]]) {
    const r = route(from, to);
    assert.ok(!within(ab, r.tag!) && !within(c, r.tag!), `${from} to ${to}`);
    assert.ok(within(rect(from), { x: r.points[0].x - 1, y: r.points[0].y }) && within(rect(to), { x: r.points.at(-1)!.x - 1, y: r.points.at(-1)!.y }));
  }
});

test("a sheet with frames still wraps into rows, each frame kept whole", async () => {
  const long = `connections:\n  - [${Array.from({ length: 16 }, (_, i) => `tank.t${i}:LOW`).join(", hose, ")}]\n`;
  const groups = "groups:\n  box:\n    label: BOX\n    members: [tank.t3, tank.t4, tank.t5]\n";
  const flat = await lay(groups, long);
  const rows = await lay(groups, long, ["diagram:\n  wrap: true\n"]);
  assert.ok(rows.place.width < flat.place.width / 2);
  const f = rows.place.frames!.get("box")!;
  for (const c of rows.sheet.cards) {
    assert.ok(["tank.t3", "tank.t4", "tank.t5"].includes(c.id) ? inside(f, rows.rect(c.id)) : apart(f, rows.rect(c.id)), c.id);
  }
  assert.equal(rows.place.routes.size, rows.sheet.wires.length);
});

test("a frame is drawn first, beneath cards and pipes, and only a sheet with groups carries its style", async () => {
  const { sheet, place } = await lay(box("pump, tank.b"));
  const svg = await render(sheet, place);
  const frame = svg.indexOf('<rect class="frame"');
  assert.ok(frame > 0 && frame < svg.indexOf('<rect class="card"') && frame < svg.indexOf('class="core"'));
  assert.match(svg, /stroke-dasharray:[^}]*\}/);
  assert.match(svg, />WATER BOX</);

  const bare = await lay("");
  const plain = await render(bare.sheet, bare.place);
  assert.doesNotMatch(plain, /frame/);
});
