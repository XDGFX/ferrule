// The ELK option sets tried against the defaults in src/layout/elk.ts, with the same metrics.
//
//   node spike/variants.ts --dir <wireviz project> [loom]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { layoutElk } from "../src/layout/elk.ts";
import { measure } from "../src/metrics.ts";
import { buildSheet } from "../src/sheet.ts";
import { readWireviz } from "../src/wireviz.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { dir: { type: "string", default: "." } } });
const loom = positionals[0] ?? "main_electrical";
const read = (f: string) => readFileSync(`${values.dir}/${f}`, "utf8");
const sheet = buildSheet(readWireviz([read("shared.yml"), read(`src/${loom}.yml`)], loom));

const VARIANTS: Record<string, Record<string, string>> = {
  defaults: {},
  "Brandes–Köpf placement": { "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF" },
  "Brandes–Köpf, balanced": { "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF", "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED" },
  "linear segments placement": { "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS" },
  "ignore model order": { "elk.layered.considerModelOrder.strategy": "NONE" },
  "tighter spacing": { "elk.layered.spacing.nodeNodeBetweenLayers": "40", "elk.spacing.nodeNode": "24" },
  "longest-path layering": { "elk.layered.layering.strategy": "LONGEST_PATH" },
  "Coffman–Graham layering": { "elk.layered.layering.strategy": "COFFMAN_GRAHAM", "elk.layered.layering.coffmanGraham.layerBound": "6" },
};

console.log("| Variant | Canvas | Length | Bends | Crossings | Through cards | Tag overlaps |\n|---|---|---|---|---|---|---|");
for (const [name, options] of Object.entries(VARIANTS)) {
  const p = await layoutElk(sheet, options);
  const m = measure(sheet, p);
  console.log(`| ${name} | ${Math.round(p.width)} × ${Math.round(p.height)} | ${m.length} | ${m.bends} | ${m.crossings} | ${m.throughCards} | ${m.tagOverlaps} |`);
}
