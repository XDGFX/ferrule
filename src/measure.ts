// Text measurement against the bundled Inter, so a card is the same width on every machine.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);
const fonts = new Map<number, opentype.Font>();

function font(weight: number): opentype.Font {
  let f = fonts.get(weight);
  if (!f) {
    const path = require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`);
    const buf = readFileSync(path);
    f = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fonts.set(weight, f);
  }
  return f;
}

// Glyph by glyph rather than getAdvanceWidth, because opentype.js cannot apply some of Inter's
// substitution lookups and throws. Inter kerns through GPOS, which getKerningValue does not read,
// so widths come out a touch wide. Cards have padding to spare; step 4 should shape with HarfBuzz.
/** Advance width of `text` in px, rounded to a hundredth so output is stable. */
export function textWidth(text: string, size: number, weight = 400): number {
  const f = font(weight);
  const glyphs = [...text].map((ch) => f.charToGlyph(ch));
  let units = 0;
  glyphs.forEach((g, i) => {
    units += g.advanceWidth ?? 0;
    if (i) units += f.getKerningValue(glyphs[i - 1], g);
  });
  return Math.round((units / f.unitsPerEm) * size * 100) / 100;
}
