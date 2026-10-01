// The bundled Inter: measured with HarfBuzz, so a card is the same width on every machine, and
// subset into each SVG, so every viewer draws the text with the font it was measured in.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import fontverter from "fontverter";
import * as hb from "harfbuzzjs";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);

/**
 * The faces the Instrument style draws with, by their file in inter-ui. Fold rows are the one
 * italic. These are the full faces, not a Latin subset, so Ω and → are there to draw.
 */
export const FACES = [
  { weight: 400, style: "normal", file: "Inter-Regular" },
  { weight: 500, style: "normal", file: "Inter-Medium" },
  { weight: 600, style: "normal", file: "Inter-SemiBold" },
  { weight: 400, style: "italic", file: "Inter-Italic" },
] as const;

type Face = (typeof FACES)[number];
const key = (weight: number, style: string) => `${weight}-${style}`;

interface Loaded {
  woff2: Buffer;
  ttf: Buffer;
  font: hb.Font;
  upem: number;
}

// Converted once at load: HarfBuzz and resvg both need TrueType, and inter-ui ships WOFF2.
const loaded = new Map<string, Loaded>();
for (const f of FACES) {
  const woff2 = readFileSync(require.resolve(`inter-ui/web/${f.file}.woff2`));
  const ttf: Buffer = await fontverter.convert(woff2, "truetype");
  const face = new hb.Face(new hb.Blob(ttf));
  loaded.set(key(f.weight, f.style), { woff2, ttf, font: new hb.Font(face), upem: face.upem });
}

function get(weight: number, italic: boolean): Loaded {
  const l = loaded.get(key(weight, italic ? "italic" : "normal"));
  if (!l) throw new Error(`Inter ${weight}${italic ? " italic" : ""} is not bundled`);
  return l;
}

/** Advance width of `text` in px, shaped with kerning, rounded to a hundredth so output is stable. */
export function textWidth(text: string, size: number, weight = 400, italic = false): number {
  if (!text) return 0;
  const { font, upem } = get(weight, italic);
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const units = buf.getGlyphInfosAndPositions().reduce((sum, g) => sum + (g.xAdvance ?? 0), 0);
  return Math.round((units / upem) * size * 100) / 100;
}

/** `@font-face` rules carrying each face subset to the characters it draws, as WOFF2 data URLs. */
export async function fontFaces(used: Map<Face, string>): Promise<string> {
  const rules: string[] = [];
  for (const f of FACES) {
    const chars = used.get(f);
    if (!chars) continue;
    const data = await subsetFont(get(f.weight, f.style === "italic").woff2, chars, { targetFormat: "woff2" });
    rules.push(
      `@font-face{font-family:Inter;font-weight:${f.weight};font-style:${f.style};` +
        `src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2")}`,
    );
  }
  return rules.join("");
}

/** Write the faces as TrueType files, for a rasteriser that only loads fonts from disk. */
export function writeFonts(dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  return FACES.map((f) => {
    const path = join(dir, `inter-${key(f.weight, f.style)}.ttf`);
    writeFileSync(path, get(f.weight, f.style === "italic").ttf);
    return path;
  });
}

export type { Face };
