import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { clamp, flatten, nearest, render } from "../src/render.ts";
import { buildSheet } from "../src/sheet.ts";
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
