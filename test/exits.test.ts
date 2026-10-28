import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutElk } from "../src/layout/elk.ts";
import { readPipeviz } from "../src/pipeviz.ts";
import { render } from "../src/render.ts";
import { buildSheet } from "../src/sheet.ts";

// The heating plan's shape: an exchanger deep inside a frame, its water side running off the sheet.
const plan = (water: string) => `
templates:
  offpage:
    display: exit
components:
  heater:
    label: HEATER
    ports: [OUT, IN]
  pump:
    label: PUMP
    ports: [IN, OUT]
  exchanger:
    label: EXCHANGER
    ports: [WATER_IN, WATER_OUT, COOLANT_IN, COOLANT_OUT]
  cold_in:
    template: offpage
    label: COLD IN, FROM FLOW SWITCH
    simple: true
  hot_out:
    template: offpage
    label: HOT OUT, TO TEMPERING VALVE
    simple: true
pipes:
  hose:
    label: 19MM HOSE
    size: 19mm
groups:
  box:
    label: WATER BOX
    members: [pump, exchanger]
connections:
  - [heater:OUT, hose, pump:IN]
  - [pump:OUT, hose, exchanger:COOLANT_IN]
  - [exchanger:COOLANT_OUT, hose, heater:IN]
${water}`;

const direct = "  - [cold_in, exchanger:WATER_IN]\n  - [exchanger:WATER_OUT, hot_out]\n";

const lay = async (yaml: string) => {
  const sheet = buildSheet(readPipeviz([yaml], "plan"));
  const place = await layoutElk(sheet);
  const card = (id: string) => ({ ...sheet.cards.find((c) => c.id === id)!, ...place.cards.get(id)! });
  const port = (id: string, key: string) => {
    const c = card(id), p = c.ports.find((q) => q.id.startsWith(key))!;
    return { x: c.x + p.x, y: c.y + p.y };
  };
  const route = (from: string) => place.routes.get(sheet.wires.find((w) => w.from.card === from || w.to.card === from)!.id)!.points;
  return { sheet, place, card, port, route };
};

test("a tag joined straight to one port sits beside it, its arrow towards the part or away from it", async () => {
  const { card, port, route } = await lay(plan(direct));
  const ex = card("exchanger");
  const inn = card("cold_in"), out = card("hot_out");
  const wIn = port("exchanger", "1:W"), wOut = port("exchanger", "2:E");
  // West of the port it feeds, on the port's line, a short stub away.
  assert.equal(inn.y + inn.h / 2, wIn.y);
  assert.ok(inn.x + inn.w < ex.x && ex.x - (inn.x + inn.w) <= 32);
  // East of the port it leaves from.
  assert.equal(out.y + out.h / 2, wOut.y);
  assert.ok(out.x > ex.x + ex.w && out.x - (ex.x + ex.w) <= 32);
  // The stub is one straight line between the tag and the port.
  assert.deepEqual(route("cold_in").map((p) => p.y), [wIn.y, wIn.y]);
  assert.deepEqual(route("cold_in").map((p) => p.x), [inn.x + inn.w, wIn.x]);
  assert.deepEqual(route("hot_out").map((p) => p.x), [wOut.x, out.x]);
});

test("a docked tag stays inside its part's frame, and the part's other wires still reach their ports", async () => {
  const { sheet, place, card, port } = await lay(plan(direct));
  const f = place.frames!.get("box")!;
  for (const id of ["cold_in", "hot_out"]) {
    const c = card(id);
    assert.ok(c.x >= f.x && c.x + c.w <= f.x + f.w, `${id} inside the frame`);
  }
  for (const w of sheet.wires.filter((w) => w.to.card === "exchanger" && w.from.card !== "cold_in")) {
    assert.deepEqual(place.routes.get(w.id)!.points.at(-1), port("exchanger", w.to.port));
  }
  for (const w of sheet.wires.filter((w) => w.from.card === "exchanger" && w.to.card !== "hot_out")) {
    assert.deepEqual(place.routes.get(w.id)!.points[0], port("exchanger", w.from.port));
  }
  assert.match(await render(sheet, place), />COLD IN, FROM FLOW SWITCH</);
});

test("a tag joined by a pipe is laid out as a part of its own, as before", async () => {
  const piped = await lay(plan("  - [cold_in, hose, exchanger:WATER_IN]\n"));
  const ex = piped.card("exchanger"), inn = piped.card("cold_in");
  assert.ok(ex.x - (inn.x + inn.w) > 32);
});
