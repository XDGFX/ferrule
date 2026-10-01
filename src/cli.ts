#!/usr/bin/env node
// Render WireViz looms and pipeviz plans in the Instrument style. Takes the same arguments as the
// WireViz fork's CLI where the two overlap, so a project can switch by changing the command name.
//
//   ferrule [--prepend FILE]... [--format svg,png,md] [--output-dir DIR] LOOM.yml...
//
// Each file is read as pipeviz if it has a top-level `components` or `pipes` key, else as WireViz.
// Writes <loom>.svg, which follows the viewer's light or dark mode, and <loom>.png, rendered dark.
// `md` adds <loom>.md, a cut list and a pinout for each connector, and is only written on request.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import { layoutElk } from "./layout/elk.ts";
import { writeFonts } from "./measure.ts";
import { flatten, render } from "./render.ts";
import { buildSheet } from "./sheet.ts";
import { tables } from "./tables.ts";
import { isPipeviz, readPipeviz } from "./pipeviz.ts";
import { readWireviz } from "./wireviz.ts";

const FORMATS = ["svg", "png", "md"] as const;
type Format = (typeof FORMATS)[number];

/** PNGs are for phones, where the dark theme reads best and where they get zoomed. */
const PNG_THEME = "dark";
const PNG_ZOOM = 2;

const USAGE = "usage: ferrule [--prepend FILE]... [--format svg,png,md] [--output-dir DIR] LOOM.yml...";

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      prepend: { type: "string", short: "p", multiple: true, default: [] },
      format: { type: "string", short: "f", default: "svg,png" },
      "output-dir": { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !positionals.length) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  const formats = values.format.split(",").map((f) => f.trim()).filter(Boolean);
  const unknown = formats.filter((f) => !(FORMATS as readonly string[]).includes(f));
  if (unknown.length) {
    console.error(`ferrule: unknown format ${unknown.join(", ")}; choose from ${FORMATS.join(", ")}`);
    return 2;
  }

  const prepended = values.prepend.map((p) => readFileSync(p, "utf8"));
  let fontDir: string | null = null;
  try {
    for (const loom of positionals) {
      const name = basename(loom).replace(/\.ya?ml$/, "");
      const out = values["output-dir"] ?? dirname(loom);
      mkdirSync(out, { recursive: true });

      const plan = readFileSync(loom, "utf8");
      const harness = (isPipeviz(plan) ? readPipeviz : readWireviz)([...prepended, plan], name);
      if (formats.includes("md" satisfies Format)) writeFileSync(join(out, `${name}.md`), tables(harness));
      if (!formats.some((f) => f !== "md")) {
        console.log(`${loom} → ${join(out, `${name}.md`)}`);
        continue;
      }
      const sheet = buildSheet(harness);
      const svg = await render(sheet, await layoutElk(sheet));
      if (formats.includes("svg" satisfies Format)) writeFileSync(join(out, `${name}.svg`), svg + "\n");
      if (formats.includes("png" satisfies Format)) {
        // resvg reads fonts only from disk, and can't apply the SVG's embedded @font-face.
        fontDir ??= mkdtempSync(join(tmpdir(), "ferrule-fonts-"));
        const png = new Resvg(flatten(svg, PNG_THEME), {
          fitTo: { mode: "zoom", value: PNG_ZOOM },
          font: { loadSystemFonts: false, fontFiles: writeFonts(fontDir), defaultFontFamily: "Inter" },
        })
          .render()
          .asPng();
        writeFileSync(join(out, `${name}.png`), png);
      }
      console.log(`${loom} → ${formats.map((f) => join(out, `${name}.${f}`)).join(", ")}`);
    }
  } finally {
    if (fontDir) rmSync(fontDir, { recursive: true, force: true });
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (err: Error) => {
    console.error(`ferrule: ${err.message}`);
    process.exitCode = 1;
  },
);
