import { test } from "node:test";
import assert from "node:assert/strict";
import { COIL_PASSES, coilPitch, layoutElk } from "../src/layout/elk.ts";
import type { Pt } from "../src/layout/types.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { render } from "../src/render.ts";
import { buildSheet } from "../src/sheet.ts";

const plan = (coil: boolean, connections: string, label = "    label: UNDERFLOOR LOOP\n") => `
components:
  tank:
    label: TANK
    ports: [HIGH, LOW]
  adapter:
    label: ADAPTER
    simple: true
pipes:
  loop:
${label}    size: 16mm
    color: "#f97316"
    coil: ${coil}
connections:
  - ${connections}
`;

const lay = async (yaml: string) => {
  const sheet = buildSheet(readPipeviz([yaml], "coil"));
  const place = await layoutElk(sheet);
  const wire = sheet.wires.find((w) => w.tag?.text === "UNDERFLOOR LOOP" || w.coil)!;
  return { sheet, place, wire, route: place.routes.get(wire.id)! };
};

/** The route's horizontal and vertical stretches, in order. */
const stretches = (pts: Pt[]) => pts.slice(1).map((b, i) => ({ a: pts[i], b, flat: pts[i].y === b.y }));

const turn = "[tank.a:LOW, adapter., loop^, adapter., tank.b:LOW]";
const straight = "[tank.a:LOW, loop, tank.b:HIGH]";

test("a coiled turn runs out and back in evenly spaced passes, east of both its ends", async () => {
  const { sheet, place, wire, route } = await lay(plan(true, turn));
  const plain = await lay(plan(false, turn));
  assert.equal(wire.coil, true);
  assert.equal(plain.wire.coil, undefined);

  const ends = Math.max(route.points[0].x, route.points.at(-1)!.x);
  const far = Math.max(...route.points.map((p) => p.x));
  const passes = stretches(route.points).filter((s) => s.flat && Math.max(s.a.x, s.b.x) === far);
  assert.equal(passes.length, COIL_PASSES);
  passes.forEach((p) => assert.ok(Math.min(p.a.x, p.b.x) > ends));
  // Each pass heads back the way the last one came, one pitch further on.
  passes.forEach((p, i) => assert.equal(Math.sign(p.b.x - p.a.x), i % 2 ? -1 : 1));
  const step = passes[1].a.y - passes[0].a.y;
  assert.equal(Math.abs(step), coilPitch(wire));
  passes.slice(1).forEach((p, i) => assert.equal(p.a.y - passes[i].a.y, step));
  assert.equal(plain.route.points.length < route.points.length, true);

  // The label sits over the first pass, so no pass runs through it.
  const top = Math.min(...passes.map((p) => p.a.y));
  assert.equal(route.tag!.y, top);
  const xs = passes.flatMap((p) => [p.a.x, p.b.x]);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= wire.tag!.w);
  assert.match(await render(sheet, place), />UNDERFLOOR LOOP</);
});

test("a coiled straight run crosses its own line in passes, between ends that stay where they were", async () => {
  const { wire, route } = await lay(plan(true, straight));
  const y = route.points[0].y;
  assert.equal(route.points.at(-1)!.y, y);
  const passes = stretches(route.points).filter((s) => !s.flat);
  assert.equal(passes.length, COIL_PASSES);
  passes.slice(1).forEach((p, i) => assert.equal(Math.abs(p.a.x - passes[i].a.x), coilPitch(wire)));
  const ys = route.points.map((p) => p.y);
  assert.equal(y - Math.min(...ys), Math.max(...ys) - y);
  assert.ok(Math.min(...ys) < y);
  // The label sits over the top of the coil, not on the line the coil crosses.
  assert.equal(route.tag!.y, Math.min(...ys));

  const plain = await lay(plan(false, straight));
  assert.deepEqual(plain.route.points.map((p) => p.y), [plain.route.points[0].y, plain.route.points[0].y]);
});

test("a coiled pipe with no label still coils, and draws no label", async () => {
  for (const chain of [turn, straight]) {
    const { sheet, place, wire, route } = await lay(plan(true, chain, ""));
    assert.equal(wire.tag, undefined);
    assert.ok(route.points.length > 2 * COIL_PASSES);
    assert.doesNotMatch(await render(sheet, place), /class="label/);
  }
});
