import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { clamp, flatten, MATE_PERIOD, mateDots, nearest, render } from "../src/render.ts";
import { buildSheet, endMark, STYLE } from "../src/sheet.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { readWireviz } from "../src/wireviz.ts";

const loom = `
connectors:
  A:
    type: "Sensor · 240–33 Ω"
    pinlabels: ["V+", "GND"]
  B:
    pinlabels: ["IN", "GND"]
cables:
  TWIN:
    wirecount: 2
    colors: ["RD", "BK"]
    wirelabels: ["V+", "GND"]
connections:
  -
    - A: [V+, GND]
    - TWIN: [V+, GND]
    - B: [IN, GND]
`;

const svg = async () => {
  const sheet = buildSheet(readWireviz([loom], "Sheet"));
  return render(sheet, await layoutElk(sheet));
};

test("a tag moves onto the nearest point of its wire", () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
  assert.deepEqual(nearest(route, { x: 40, y: 9 }), { x: 40, y: 0 });
  assert.deepEqual(nearest(route, { x: 112, y: 30 }), { x: 100, y: 30 });
});

test("the font travels inside the SVG, subset to what it draws", async () => {
  const s = await svg();
  assert.doesNotMatch(s, /@import|googleapis/);
  assert.match(s, /@font-face\{font-family:Inter;font-weight:600;font-style:normal;src:url\(data:font\/woff2;base64,/);
});

test("the same sheet renders to the same bytes", async () => {
  assert.equal(await svg(), await svg());
});

test("flattening leaves no CSS variable for a rasteriser to miss", async () => {
  for (const theme of ["light", "dark"] as const) {
    const flat = flatten(await svg(), theme);
    assert.doesNotMatch(flat, /var\(--/);
    assert.doesNotMatch(flat, /prefers-color-scheme/);
  }
});

test("a mated pair is laid out side by side, joined by a short mate", async () => {
  const src = `connectors:\n  P:\n    pinlabels: ["A", "B"]\n  S:\n    pinlabels: ["A", "B"]\n  X:\n    pinlabels: ["A", "B"]\n  Y:\n    pinlabels: ["A", "B"]\ncables:\n  C:\n    wirecount: 2\nconnections:\n  -\n    - X: [A, B]\n    - C.: [1, 2]\n    - P: [A, B]\n  -\n    - P\n    - [==]\n    - S\n  -\n    - S: [A, B]\n    - C.: [1, 2]\n    - Y: [A, B]\n`;
  const sheet = buildSheet(readWireviz([src], "x"));
  const place = await layoutElk(sheet);
  const p = place.cards.get("P")!, s = place.cards.get("S")!;
  const pw = sheet.cards.find((c) => c.id === "P")!.w;
  assert.equal(p.y, s.y);
  assert.ok(s.x > p.x + pw && s.x - (p.x + pw) < 80);
  const out = await render(sheet, place);
  const dots = out.match(/<g class="mate">(.*?)<\/g>/)![1].match(/<circle /g)!;
  assert.equal(dots.length, mateDots(place.routes.get(sheet.wires.find((w) => w.kind === "mate")!.id)!.points).length);
});

test("a mate's dots sit one period apart, centred, one period clear of each card", () => {
  const P = MATE_PERIOD;
  const xs = (route: { x: number; y: number }[]) => mateDots(route).map((d) => d.x);
  assert.deepEqual(xs([{ x: 0, y: 0 }, { x: 6 * P, y: 0 }]), [P, 2 * P, 3 * P, 4 * P, 5 * P]);
  assert.deepEqual(xs([{ x: 0, y: 0 }, { x: 6.5 * P, y: 0 }]), [1.25 * P, 2.25 * P, 3.25 * P, 4.25 * P, 5.25 * P]);
  assert.deepEqual(
    mateDots([{ x: 0, y: 0 }, { x: 3 * P, y: 0 }, { x: 3 * P, y: 3 * P }, { x: 6 * P, y: 3 * P }]),
    [1, 2, 3, 4, 5, 6, 7, 8].map((k) => (k <= 3 ? { x: k * P, y: 0 } : k <= 6 ? { x: 3 * P, y: (k - 3) * P } : { x: (k - 3) * P, y: 3 * P })),
  );
});

test("a mate too short for two clear dots draws one, at its middle", () => {
  assert.deepEqual(mateDots([{ x: 0, y: 0 }, { x: 1.5 * MATE_PERIOD, y: 0 }]), [{ x: 0.75 * MATE_PERIOD, y: 0 }]);
  assert.deepEqual(mateDots([{ x: 0, y: 0 }, { x: 0.5 * MATE_PERIOD, y: 0 }]), [{ x: 0.25 * MATE_PERIOD, y: 0 }]);
});

const crosslink = `
components:
  tank:
    label: TANK
    ports: [HIGH, LOW]
  adapter:
    label: ADAPTER
    simple: true
pipes:
  hose:
    label: 40MM HOSE
    size: 40mm
    color: "#f97316"
connections:
  - [tank.a:LOW, adapter., hose^, adapter., tank.b:LOW]
`;

test("a reversed pipe turns round east of both its ends, with its tag at the turn", async () => {
  const sheet = buildSheet(readPipeviz([crosslink], "crosslink"));
  const place = await layoutElk(sheet);
  const hose = sheet.wires.find((w) => w.returns)!;
  const route = place.routes.get(hose.id)!;
  const [first, last] = [route.points[0], route.points.at(-1)!];
  const rightEdge = (id: string) => place.cards.get(id)!.x + sheet.cards.find((c) => c.id === id)!.w;
  assert.equal(first.x, rightEdge(hose.from.card));
  assert.equal(last.x, rightEdge(hose.to.card));
  // Both adapters sit in the same layer, beside their tanks, rather than one a layer further on.
  assert.equal(place.cards.get(hose.from.card)!.x, place.cards.get(hose.to.card)!.x);
  assert.ok(route.tag!.x > Math.max(first.x, last.x));
  const out = await render(sheet, place);
  assert.match(out, /stroke:#f97316/);
  assert.match(out, />40MM HOSE</);
});

const plumbing = `
templates:
  pump:
    color: "#c2410c"
    glyph: pump
  fitting:
    display: pill
components:
  pump:
    template: pump
    label: PUMP
    ports: [IN, OUT]
  adapter:
    template: fitting
    label: ADAPTER
    simple: true
  out:
    label: TO OTHER SYSTEM
    display: exit
    ports: [IN]
  ground:
    label: TO GROUND
    display: end
    ports: [IN]
pipes:
  hot:
    label: HOT PIPE
    size: 16mm
    service_rating: hot
  plain:
    label: PLAIN PIPE
    size: 16mm
connections:
  - [pump:OUT, hot, adapter., plain, out]
  - [pump:IN, plain, ground]
`;

const plumbed = async () => {
  const sheet = buildSheet(readPipeviz([plumbing], "plan"));
  return render(sheet, await layoutElk(sheet));
};

test("a run's label is plain text in its run's colour, haloed, with no box behind it", async () => {
  const s = await plumbed();
  assert.match(s, /<text class="label" style="fill:var\(--acc-e23b3b\)"[^>]*>HOT PIPE</);
  // A grey run has no colour of its own to lend, so its label is muted.
  assert.match(s, /<text class="label muted"[^>]*>PLAIN PIPE</);
  assert.doesNotMatch(s, /class="tag"/);
  assert.match(s, /\.label\{paint-order:stroke;stroke:var\(--bg\)/);
});

test("a cable card still labels each core with a boxed tag, as part of its pin table", async () => {
  assert.match(await svg(), /<rect class="tag"/);
});

test("a card is outlined and tinted in its colour, and draws its glyph; pills and exits are their own shapes", async () => {
  const s = await plumbed();
  assert.match(s, /fill:var\(--acc-c2410c\);fill-opacity:var\(--tint\);stroke:var\(--acc-c2410c\)/);
  assert.match(s, /<g class="glyph"[^>]*style="stroke:var\(--acc-c2410c\)"><circle/);
  assert.match(s, /<rect class="pill"[^>]*\/>\n<text class="pill-text"[^>]*>ADAPTER</);
  assert.match(s, /<path class="exit"/);
  assert.doesNotMatch(s, /class="chip"/);
});

test("an end is no box: its run stops at a cap of plain linework, a little taller than the run, its label muted text beyond", async () => {
  const sheet = buildSheet(readPipeviz([plumbing], "plan"));
  const place = await layoutElk(sheet);
  const s = await render(sheet, place);
  const run = sheet.wires.find((w) => w.to.card === "ground")!;
  const ground = place.cards.get("ground")!;
  // The cap is linework, not pipe: the plan's only cap, and no vertical stroke of pipe.
  const caps = [...s.matchAll(/<line class="cap" x1="([\d.]+)" y1="([\d.]+)" x2="\1" y2="([\d.]+)"\/>/g)];
  assert.equal(caps.length, 1);
  const [, x, y1, y2] = caps[0].map(Number);
  assert.ok(Math.abs(x - (ground.x + STYLE.capW / 2)) < 0.1);
  assert.ok(Math.abs(y2 - y1 - 2 * endMark(run.weight).half) < 0.2);
  assert.ok(y2 - y1 > run.weight + 2 * STYLE.casing);
  assert.doesNotMatch(s, /<path class="core" d="M([\d.]+),[\d.]+ L\1,[\d.]+"/);
  assert.match(s, /<text class="label muted"[^>]*>TO GROUND</);
  assert.equal([...s.matchAll(/<path class="exit"/g)].length, 1);
  // The cap is the run's end, so the end has no port circle, which an exit in its place would.
  const asExit = buildSheet(readPipeviz([plumbing.replace("display: end", "display: exit")], "plan"));
  const circles = (svg: string) => new Set(svg.match(/<circle class="port"[^>]*>/g)).size;
  assert.equal(circles(await render(asExit, await layoutElk(asExit))) - circles(s), 1);
});

test("each theme clamps a colour's lightness so it reads on that ground", async () => {
  // Pale yellow darkens on the light ground; deep green lightens on the dark.
  assert.equal(clamp("#f0c419", 0, 0.4, 1), "#c09b0c");
  assert.equal(clamp("#166534", 0.63, 1, 0.55), "#6dd594");
  // A colour already within range is left alone.
  assert.equal(clamp("#0369a1", 0, 0.4, 1), "#0369a1");
  for (const theme of ["light", "dark"] as const) {
    const flat = flatten(await plumbed(), theme);
    assert.doesNotMatch(flat, /var\(--/);
  }
  assert.match(flatten(await plumbed(), "dark"), new RegExp(`fill:${clamp("#c2410c", 0.63, 1, 0.55)};fill-opacity:0.06`));
  assert.match(flatten(await plumbed(), "light"), new RegExp(`fill:${clamp("#c2410c", 0, 0.4, 1)};fill-opacity:0.05`));
});
