<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img alt="ferrule: wiring and plumbing diagrams from YAML" src="docs/assets/banner-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <b>A diagram renderer for looms and pipe runs.</b><br>
  Describe connectors, cables and pipe runs in YAML. ferrule lays them out and draws them.
</p>

<p align="center">
  <img alt="status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-d9622b">
  <img alt="layout: elkjs" src="https://img.shields.io/badge/layout-elkjs-5e6670">
  <img alt="output: SVG and PNG" src="https://img.shields.io/badge/output-SVG%20%2B%20PNG-5e6670">
</p>

---

ferrule takes one YAML format for both wiring and plumbing and turns it into diagrams. It does
its own layout and drawing, so the output looks the same everywhere and works in dark mode.

Coming from WireViz? The format will feel familiar, and ferrule keeps compatibility where it can.

> [!NOTE]
> Pre-alpha. Wiring works: ferrule reads the WireViz subset one real project uses and draws all
> ten of its looms. Plumbing is not started.

## Use

```bash
npm install github:XDGFX/ferrule#v0.1.0
npx ferrule --prepend shared.yml --output-dir diagrams src/*.yml
```

The arguments match WireViz's CLI where the two overlap. Each loom gives `<name>.svg`, which
follows the viewer's light or dark mode, and `<name>.png`, rendered dark. `--format svg` or
`--format png` writes one of the two.

**WireViz syntax read:** prepended files with cross-file anchors and `<<` merges; `pinlabels`,
`pincount`, `pincolors`, `loops` and `style: simple` on connectors; `colors`, `wirelabels`,
`wirecount`, `gauge` (mm² or AWG), `length` and `notes` on cables; `X.Y` and `X.` instances; pin
ranges such as `1-4`; connection sets that start or end with a cable; and `==` mates. Anything
else is ignored, or is an error if it changes what connects to what.

**Parity check:** `npm run parity -- --dir <project> --python <python with WireViz>` reads every
loom with ferrule and with WireViz and fails if they disagree on any connector, connection, mate
or loop.

## Why

- **One look, controlled here.** ferrule doesn't hand drawing to Graphviz, which has no CSS and
  no per-corner radii. Graphviz can't outline a black wire on a dark ground, draw a tracer on a
  two-colour wire, or route filleted orthogonal wires out of table ports.
- **The same bytes on every machine.** Graphviz-based tools measure text with whatever fonts
  happen to be installed, so the same YAML renders differently on a laptop and a CI runner.
  ferrule bundles its font and measures text itself, so CI can diff SVGs byte for byte.
- **Real dark mode.** SVGs carry CSS variables and `prefers-color-scheme`. PNGs are rendered
  dark, because the viewer that needs them, the GitHub mobile app, shows PNGs but not SVGs.
- **Wiring and plumbing match.** One format and one renderer cover both.

## What it looks like

The style is called *Instrument*. Below is a heating loom, mocked up by hand before any layout
engine existed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/heating_systems-a-dark.svg">
  <img alt="Heating loom: fuse panel, relay and three controller inputs wired through a 7-core cable to a Deutsch DT connector" src="docs/assets/heating_systems-a-light.svg" width="100%">
</picture>

<details>
<summary>Battery, BMS and negative bus, where line weight follows gauge</summary>
<br>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/main_electrical-a-dark.svg">
  <img alt="Battery, isolator, BMS, shunt and negative bus bar, with 50 and 25 mm² runs drawn heavier than the CAN cable" src="docs/assets/main_electrical-a-light.svg" width="100%">
</picture>
</details>

## The drawing rules

| | Rule |
|---|---|
| **Cards** | One card per component. A colour chip identifies it, and the card lists its pins. Runs of unused pins fold into one row, such as `6–24 · 19 unused`. |
| **Wires** | Orthogonal with filleted corners. Every core has a hairline casing. Black and white cores get their own casing colour in each theme, so they never disappear. |
| **Two-colour wires** | The base colour, with a dashed tracer in the second colour that follows the wire round each bend. |
| **Gauge** | Line weight follows conductor size, so a 50 mm² run looks like one. |
| **Single-core runs** | A tag on the wire, such as `50 mm² · 1.5 m`, not a separate box. |
| **Multi-core cables** | A dashed card that the cores pass straight through, each labelled on its wire. |
| **Junctions** | A single core that splits, or ends open, gets a dashed card like a multi-core. A core that goes nowhere ends in a short cap. |
| **Mates and loops** | Two connectors plugged together are joined by a chain of dots between their title bars. Two pins bridged on one connector loop off its side. |
| **Pin colours** | A small chip before the pin's label, split for a two-colour mark. |
| **Off-sheet ends** | Planned: an arrow naming the other end, such as `→ MPPT_150_45`, instead of a wire that just stops. |
| **Type** | Inter, bundled and measured in-process. |

## How it fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pipeline-dark.svg">
  <img alt="Wiring and plumbing are described in one YAML format, read into one shared model, laid out with elkjs and drawn as SVG, which is flattened per theme and rasterised to PNG." src="docs/assets/pipeline-light.svg" width="100%">
</picture>

Wiring and plumbing share one format and one model, so both come out of the same layout and
drawing code. PNGs go through a flattened copy of the SVG with literal colours, one per theme,
because resvg can't resolve CSS variables. The CLI writes the dark one.

**Fallback:** if ELK's layouts turn out worse than Graphviz's, ferrule keeps `dot -Tjson` for
layout only and still draws everything itself. That keeps the look and dark mode, but output would
no longer be identical across machines.

## Roadmap

- [x] **Look.** Three style directions were built by hand and checked on a phone, and *Instrument* was chosen.
- [x] **Layout spike.** Lay out a large, dense loom with elkjs and compare it with `dot -Tjson`. This is the go/no-go point.
- [x] **Parity.** Render a full set of real looms until every one is correct, then compare them byte for byte in CI.
- [ ] **New outputs.** Pinout tables per connector in Markdown, a cut list, and gauge checks against terminal and fuse limits.
- [ ] **Plumbing.** Pipe runs, fittings and tanks on the same core.

## Not planned

- Physical layout or formboard views
- Net highlighting, because it needs JavaScript and GitHub won't run it
- Export to `.harness` or any other editor format

## Origin

ferrule started on a campervan build that documents its 24 V system and plumbing in YAML. That
project needed diagrams that read well on a phone in the van, a dark mode, and a CI check that the
committed diagrams still match their YAML. Graphviz couldn't give it any of those.

<sub>`docs/assets/` is generated. `scripts/make_readme_art.py` draws the banner and the pipeline.
The example diagrams are hand-built mock-ups made before the layout engine existed.</sub>
