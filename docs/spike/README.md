# Layout spike

The go/no-go check for elkjs. The hardest loom available, a battery, BMS and distribution sheet
with 21 cards and 37 wires, was laid out twice from the same sized cards and fixed ports:

- **elkjs**: layered, left to right, ports fixed at their rows, orthogonal routing.
- **`dot -Tjson`**: the fallback. dot places cards and routes splines, and ferrule draws the result.

Both are drawn by the same Instrument renderer, so any difference between them comes from layout
alone. [RESULTS.md](RESULTS.md) has the numbers. `main_electrical-elk.svg` and
`main_electrical-dot.svg` are the drawings.

## Verdict: go

elkjs is good enough to build on. On this sheet it has 12 crossings to dot's 14, and neither
engine puts a wire through a card or a tag over anything. Two runs of ELK produce byte-identical
SVGs. A layout takes 100 to 250 ms.

| | elkjs | dot |
|---|---|---|
| Orthogonal, filleted wires | yes | no: splines, and `splines=ortho` ignores ports |
| Same bytes across runs | yes, checked | yes |
| Same bytes across machines | expected: pure JavaScript, fixed seed, bundled font metrics. Not yet checked on a second platform | only with the same Graphviz build everywhere |
| Crossings | 12 | 14 |
| Canvas | 2839 × 1489 | 2397 × 1500 |
| Total wire length | 9858 px | 7874 px |

**What ELK costs.** The canvas is about 18% wider and the wires are about 25% longer. Inline
tags take a slot of their own between layers, which widens each gap. Two wires converging on one
port, such as both BMS P terminals to the shunt's BATT-, meet with a small jog rather than merging
cleanly. Neither problem gets in the way of reading the sheet.

**How far to trust the crossing count.** It counts proper intersections only. Wires that run
along each other, or share a channel, are not counted. Orthogonal routing produces more of those
than splines do, so the count flatters ELK somewhat.

**Variants.** `node spike/variants.ts` runs the other option sets against the same sheet:
Brandes–Köpf and linear-segments node placement, longest-path and Coffman–Graham layering,
ignoring model order, and tighter spacing. None beats the defaults in `src/layout/elk.ts`
(network-simplex placement, model order respected) on length and crossings together. Tighter
spacing is 4% narrower at no cost in crossings, so it is worth tuning during parity.

## Carried into parity

- The reader covers only the syntax this sheet uses. Five other looms fail on syntax it lacks:
  numeric keys, pin ranges such as `1-4`, connectors used without a pin list, and duplicate map
  keys, which WireViz's YAML loader tolerates.
- Text is measured glyph by glyph with opentype.js, which skips Inter's GPOS kerning, so widths
  come out slightly wide. Shaping with HarfBuzz would fix this.
- The SVG loads Inter from Google Fonts with `@import`. A viewer that blocks the import, such as
  resvg or an `<img>` tag, falls back to Helvetica or Arial, and card widths are measured for
  Inter. Embed the font as a subset `@font-face` instead.
- resvg needs Inter as a TTF to render PNGs in Inter, and `@fontsource` ships only WOFF.
- Long notes make tall cards, which stretch their layer. The Cerbo card is 15 lines. Cap the
  notes, or move them into a footnote.
- The light theme's black and white casings are the same grey as every other casing, carried over
  unchanged from the approved mock-up. This sheet has no two-colour wire, so the tracer went
  unexercised. Both need checking on a loom that has them.

Regenerate with `npm run spike -- --dir <wireviz project> --png out`.
