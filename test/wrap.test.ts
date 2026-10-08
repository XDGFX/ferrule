import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { readWrap, WRAP_ASPECT } from "../src/model.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { buildSheet } from "../src/sheet.ts";
import { readWireviz } from "../src/wireviz.ts";

test("reads wrap as off, on at the default aspect, or on at a given aspect", () => {
  assert.equal(readWrap(undefined), undefined);
  assert.equal(readWrap(false), undefined);
  assert.equal(readWrap(true), WRAP_ASPECT);
  assert.equal(readWrap({}), WRAP_ASPECT);
  assert.equal(readWrap({ aspect: 3 }), 3);
  assert.throws(() => readWrap({ aspect: 0 }), /aspect/);
  assert.throws(() => readWrap({ aspect: "wide" }), /aspect/);
  assert.throws(() => readWrap({ ratio: 2 }), /unknown key ratio/);
  assert.throws(() => readWrap("yes"), /wrap/);
});

// Twenty parts in a line: a sheet many times wider than it is tall.
const chain = `
components:
  part:
    label: PART
    simple: true
pipes:
  hose:
    label: HOSE
connections:
  - [${Array.from({ length: 20 }, () => "part.").join(", hose, ")}]
`;

test("a plan wraps only when its diagram asks, and may take wrap from a prepended file", () => {
  assert.equal(readPipeviz([chain], "chain").wrap, undefined);
  assert.equal(readPipeviz(["diagram:\n  wrap: true\n", chain], "chain").wrap, WRAP_ASPECT);
  assert.equal(readPipeviz([`diagram:\n  wrap:\n    aspect: 2.5\n${chain}`], "chain").wrap, 2.5);
});

test("a loom wraps only when its diagram asks", () => {
  const loom = "connectors:\n  A:\n    pincount: 1\n  B:\n    pincount: 1\ncables:\n  W:\n    wirecount: 1\nconnections:\n  - [A, W, B]\n";
  assert.equal(readWireviz([loom], "x").wrap, undefined);
  assert.equal(readWireviz([loom + "diagram:\n  wrap:\n    aspect: 2\n"], "x").wrap, 2);
});

test("a wrapped chain lays out in rows, narrower and taller than one row", async () => {
  const flat = await layoutElk(buildSheet(readPipeviz([chain], "chain")));
  const rows = await layoutElk(buildSheet(readPipeviz(["diagram:\n  wrap: true\n", chain], "chain")));
  assert.ok(flat.width / flat.height > 8);
  assert.ok(rows.width < flat.width / 2);
  assert.ok(rows.height > flat.height * 2);
  // Every pipe still runs from end to end, including the ones carried round to the next row.
  assert.equal(rows.routes.size, flat.routes.size);
});
