import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { render } from "../src/render.ts";
import { buildSheet } from "../src/sheet.ts";

const parts = `
components:
  heater:
    label: HEATER
    ports: [OUT, IN]
  tee:
    label: TEE
    ports: [A, B, C]
  adapter:
    label: ADAPTER
    simple: true
pipes:
  hose:
    label: 19MM HOSE
    size: 19mm
`;

const read = (connections: string) => readPipeviz([parts + "connections:\n" + connections], "plan");

test("a chain written as a map reads like the list it names, and without flow or accent its links carry neither", () => {
  const list = read("  - [heater:OUT, hose, tee:A]\n");
  const map = read("  - chain: [heater:OUT, hose, tee:A]\n");
  assert.deepEqual(map, list);
  assert.equal("flow" in map.links[0], false);
  assert.equal("accent" in map.links[0], false);
});

test("flow follows the chain as written, or runs against it, on every link the chain makes", () => {
  const forward = read("  - chain: [heater:OUT, hose, adapter., tee:A]\n    flow: forward\n");
  assert.deepEqual(forward.links.map((l) => l.flow), ["forward", "forward"]);
  const reverse = read("  - chain: [heater:OUT, hose, tee:A]\n    flow: reverse\n");
  assert.deepEqual(reverse.links.map((l) => l.flow), ["reverse"]);
  const none = read("  - chain: [heater:OUT, hose, tee:A]\n    flow: none\n");
  assert.equal("flow" in none.links[0], false);
});

test("past a turn the links run back towards it, so their flow is turned round with them", () => {
  const h = read("  - chain: [heater:OUT, hose, tee.a:A, hose^, tee.b:A, hose, heater:IN]\n    flow: forward\n");
  // Links: heater→a, the turn a→b, then the rest read backwards: heater:IN→b.
  assert.deepEqual(h.links.map((l) => [l.from?.connector, l.to?.connector, l.flow]), [
    ["heater", "tee.a", "forward"],
    ["tee.a", "tee.b", "forward"],
    ["heater", "tee.b", "reverse"],
  ]);
});

test("an accent marks every link of its chain, on both sides unless it names one, turned round with the links", () => {
  const both = read("  - chain: [heater:OUT, hose, adapter., tee:A]\n    accent: RD\n");
  assert.deepEqual(both.links.map((l) => l.accent), [
    { colour: "#e23b3b", side: "both" },
    { colour: "#e23b3b", side: "both" },
  ]);
  const left = read("  - chain: [heater:OUT, hose, tee.a:A, hose^, tee.b:A, hose, heater:IN]\n    accent: '#0072b2'\n    accent_side: left\n");
  assert.deepEqual(left.links.map((l) => l.accent?.side), ["left", "left", "right"]);
  assert.equal(left.links[0].accent?.colour, "#0072b2");
});

test("rejects a chain map it can't read", () => {
  assert.throws(() => read("  - chain: [heater:OUT, hose, tee:A]\n    flow: upstream\n"), /connections\[0\].*flow "upstream" should be forward, reverse or none/);
  assert.throws(() => read("  - chain: [heater:OUT, hose, tee:A]\n    accent_side: top\n"), /accent_side "top" should be both, left or right/);
  assert.throws(() => read("  - chain: [heater:OUT, hose, tee:A]\n    accent_side: left\n"), /accent_side needs an accent/);
  assert.throws(() => read("  - chain: [heater:OUT, hose, tee:A]\n    colour: RD\n"), /unknown key colour; only chain, flow, accent and accent_side are read/);
  assert.throws(() => read("  - flow: forward\n"), /a chain needs at least two tokens/);
});

const draw = async (connections: string) => {
  const sheet = buildSheet(read(connections));
  const place = await layoutElk(sheet);
  return { sheet, place, svg: await render(sheet, place) };
};

/** Each flow chevron's position and heading, in degrees clockwise from east. */
const chevrons = (svg: string) =>
  [...svg.matchAll(/<path class="flow" transform="translate\(([-\d.]+),([-\d.]+)\) rotate\(([-\d.]+)\)"/g)].map((m) => ({ x: +m[1], y: +m[2], a: +m[3] }));

test("a run with flow carries a chevron on its line, pointing the way it flows, clear of its label", async () => {
  const fwd = await draw("  - chain: [heater:OUT, hose, tee:A]\n    flow: forward\n");
  const route = fwd.place.routes.get(fwd.sheet.wires[0].id)!.points.map((p) => ({ x: p.x, y: p.y + 76 }));
  const marks = chevrons(fwd.svg);
  assert.equal(marks.length, 1);
  const [m] = marks;
  assert.equal(m.a, 0);
  assert.equal(m.y, route[0].y);
  assert.ok(route[0].x < m.x && m.x < route.at(-1)!.x);
  // The label is centred over the run; the chevron sits beside it, not under it.
  const tag = fwd.sheet.wires[0].tag!;
  const mid = (route[0].x + route.at(-1)!.x) / 2;
  assert.ok(Math.abs(m.x - mid) > tag.w / 2);

  const rev = await draw("  - chain: [heater:OUT, hose, tee:A]\n    flow: reverse\n");
  assert.deepEqual(chevrons(rev.svg).map((c) => c.a), [180]);
});

test("a sheet without flow draws no chevron and carries no style for one", async () => {
  const plain = await draw("  - [heater:OUT, hose, tee:A]\n");
  const none = await draw("  - chain: [heater:OUT, hose, tee:A]\n    flow: none\n");
  assert.equal(none.svg, plain.svg);
  assert.doesNotMatch(plain.svg, /flow/);
});

/** Each accent line's start point and the colour it is drawn in. */
const accents = (svg: string) =>
  [...svg.matchAll(/<path class="accent" d="M([-\d.]+),([-\d.]+)[^"]*" style="stroke:([^"]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], colour: m[3] }));

test("an accent runs beside its run, on the sides it names, and leaves the run's own colour alone", async () => {
  const plain = await draw("  - [heater:OUT, hose, tee:A]\n");
  const both = await draw("  - chain: [heater:OUT, hose, tee:A]\n    accent: RD\n");
  const y = both.place.routes.get(both.sheet.wires[0].id)!.points[0].y + 76;
  const lines = accents(both.svg);
  assert.equal(lines.length, 2);
  // One line above the run and one below, the same distance out, clear of the hose's casing.
  const [above, below] = [...lines].sort((p, q) => p.y - q.y);
  assert.ok(Math.abs(y - above.y - (below.y - y)) <= 0.2);
  assert.ok(y - above.y > both.sheet.wires[0].weight / 2 + 1);
  assert.equal(above.colour, below.colour);
  assert.match(above.colour, /^var\(--acc-e23b3b\)$/);
  // The run's label stands clear above the accent, not on it.
  const baseline = +both.svg.match(/<text class="label[^>]* y="([\d.]+)"/)![1];
  assert.ok(baseline < above.y - 2, `label at ${baseline}, accent at ${above.y}`);
  const core = (svg: string) => svg.match(/<path class="core"[^>]*>/g);
  assert.deepEqual(core(both.svg), core(plain.svg));

  // Left, looking along the chain from the heater to the tee: the run heads east, so above it.
  const left = accents((await draw("  - chain: [heater:OUT, hose, tee:A]\n    accent: RD\n    accent_side: left\n")).svg);
  assert.deepEqual(left.map((l) => l.y), [above.y]);
  const right = accents((await draw("  - chain: [heater:OUT, hose, tee:A]\n    accent: RD\n    accent_side: right\n")).svg);
  assert.deepEqual(right.map((l) => l.y), [below.y]);
  assert.doesNotMatch(plain.svg, /accent/);
});
