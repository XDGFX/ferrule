# Layout spike

The go/no-go check for elkjs. The hardest loom available, a battery, BMS and distribution sheet
with 21 cards and 37 wires, was laid out twice from the same sized cards and fixed ports:

- **elkjs**: layered, left to right, ports fixed at their rows, orthogonal routing.
- **`dot -Tjson`**: the fallback. dot places cards and routes splines, and ferrule draws the result.

Both are drawn by the same Instrument renderer, so any difference between them comes from layout
alone. [RESULTS.md](RESULTS.md) has the numbers. `main_electrical-elk.svg` and
`main_electrical-dot.svg` are the drawings.

## Verdict: go

elkjs is good enough to build on. On this sheet it matches dot on crossings (12 each). Neither
engine puts a wire through a card or a tag over anything. ELK's output is byte-identical between
runs. It lays out in about 120 ms.

| | elkjs | dot |
|---|---|---|
| Orthogonal, filleted wires | yes | no: splines, and `splines=ortho` ignores ports |
| Same bytes on every machine | yes: pure JavaScript, fixed seed, bundled font metrics | only if every machine has the same Graphviz build |
| Crossings | 12 | 12 |
| Canvas | 2825 × 1489 | 2397 × 1439 |
| Total wire length | 9690 px | 7874 px |

**What ELK costs.** The canvas is about 18% wider and the wires are about 23% longer. Inline
tags take a slot of their own between layers, which widens each gap. Two wires converging on one
port, such as both BMS P terminals to the shunt's BATT-, meet with a small jog rather than merging
cleanly. Neither problem gets in the way of reading the sheet.

**Tried and rejected.** Brandes–Köpf and linear-segments node placement, longest-path and
Coffman–Graham layering, ignoring model order, and tighter spacing. The defaults in
`src/layout/elk.ts` (network-simplex placement, model order respected) scored best overall.
Tighter spacing saves 4% of width but adds two crossings.

## Carried into parity

- The reader covers only the syntax this sheet uses. Five other looms fail on syntax it lacks:
  numeric keys, pin ranges such as `1-4`, connectors used without a pin list, and duplicate map
  keys, which WireViz's YAML loader tolerates.
- Text is measured glyph by glyph with opentype.js, which skips Inter's GPOS kerning, so widths
  come out slightly wide. Shaping with HarfBuzz would fix this.
- Long notes make tall cards, which stretch their layer. The Cerbo card is 15 lines. Cap the
  notes, or move them into a footnote.
- PNGs are rendered with resvg from a flattened SVG for each theme. resvg falls back to a system
  font unless Inter is passed to it as a TTF, and `@fontsource` ships only WOFF.

Regenerate with `npm run spike -- --dir <wireviz project> --png out`.
