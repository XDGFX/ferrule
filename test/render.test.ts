import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { flatten, nearest, render } from "../src/render.ts";
import { buildSheet } from "../src/sheet.ts";
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

test("a mated pair is laid out side by side, so a wrap can't separate them", async () => {
  const src = `connectors:\n  P:\n    pinlabels: ["A", "B"]\n  S:\n    pinlabels: ["A", "B"]\n  X:\n    pinlabels: ["A", "B"]\n  Y:\n    pinlabels: ["A", "B"]\ncables:\n  C:\n    wirecount: 2\nconnections:\n  -\n    - X: [A, B]\n    - C.: [1, 2]\n    - P: [A, B]\n  -\n    - P\n    - [==]\n    - S\n  -\n    - S: [A, B]\n    - C.: [1, 2]\n    - Y: [A, B]\n`;
  const sheet = buildSheet(readWireviz([src], "x"));
  const place = await layoutElk(sheet);
  const p = place.cards.get("P")!, s = place.cards.get("S")!;
  const pw = sheet.cards.find((c) => c.id === "P")!.w;
  assert.equal(p.y, s.y);
  assert.ok(s.x > p.x + pw && s.x - (p.x + pw) < 80);
});
