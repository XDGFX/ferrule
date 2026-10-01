<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
    <img alt="ferrule: wiring and plumbing diagrams from YAML" src="docs/assets/banner-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <b>A diagram renderer for looms and pipe runs.</b><br>
  It reads the YAML you already have, lays out the result itself, and draws it in a style it owns.
</p>

<p align="center">
  <img alt="status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-d9622b">
  <img alt="layout: elkjs" src="https://img.shields.io/badge/layout-elkjs-5e6670">
  <img alt="output: SVG and PNG" src="https://img.shields.io/badge/output-SVG%20%2B%20PNG-5e6670">
</p>

---

ferrule replaces the Graphviz rendering behind [WireViz](https://github.com/wireviz/WireViz) and
[pipeviz](https://github.com/XDGFX/pipeviz) for [Hailey](https://github.com/XDGFX/hailey), a
campervan build documented in YAML. The YAML stays the contract. ferrule takes over the drawing.

> [!NOTE]
> Nothing here runs yet. The look is settled and the layout spike is next. The plan, and every
> decision so far, lives in [hailey#155](https://github.com/XDGFX/hailey/issues/155).

## Why

- **One look, controlled here.** Graphviz has no CSS and no per-corner radii. It can't outline
  a black wire on a dark ground, draw a tracer on a two-colour wire, or route filleted orthogonal
  wires out of table ports.
- **The same bytes on every machine.** Graphviz measures text with whatever fonts happen to be
  installed, so the same YAML renders differently on a laptop and a CI runner. ferrule bundles
  its font and measures text itself, so CI can diff SVGs byte for byte.
- **Real dark mode.** SVGs carry CSS variables and `prefers-color-scheme`. PNGs come in light and
  dark, because the GitHub mobile app shows PNGs but not SVGs.
- **Wiring and plumbing match.** One core, two readers.

## What it looks like

The direction chosen in hailey#155 is called *Instrument*. Below is the heating loom, mocked up by
hand before any layout engine existed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/heating_systems-a-dark.svg">
  <img alt="Heating loom: fuse panel, relay and three Cerbo inputs wired through a 7-core cable to a Deutsch DT connector" src="docs/assets/heating_systems-a-light.svg" width="100%">
</picture>

<details>
<summary>Battery, BMS and negative bus, where line weight follows gauge</summary>
<br>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/main_electrical-a-dark.svg">
  <img alt="Battery, isolator, BMS, SmartShunt and negative bus bar, with 50 and 25 mm² runs drawn heavier than the CAN cable" src="docs/assets/main_electrical-a-light.svg" width="100%">
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
| **Off-sheet ends** | An arrow naming the other end, such as `→ MPPT_150_45`, instead of a wire that just stops. |
| **Type** | Inter, bundled and measured in-process. |

## How it fits together

```mermaid
flowchart LR
  W["WireViz YAML<br><i>the subset Hailey uses</i>"] --> R1[wiring reader]
  P["pipeviz YAML"] --> R2[plumbing reader]
  R1 --> M((model))
  R2 --> M
  M --> L["layout<br><i>elkjs, layered,<br>fixed port order</i>"]
  L --> S["SVG<br><i>CSS variables,<br>prefers-color-scheme</i>"]
  S --> F["flattened SVG<br><i>one per theme</i>"]
  F --> PNG["PNG<br><i>resvg</i>"]
```

PNGs go through a flattened SVG because resvg can't resolve CSS variables. Each theme gets an SVG
with literal colours, and that is what gets rasterised.

**Fallback:** if ELK's layouts turn out worse than dot's, ferrule keeps `dot -Tjson` for layout
only and still draws everything itself. That keeps the look and dark mode, but output would no
longer be identical across machines.

## Roadmap

The steps follow [hailey#155](https://github.com/XDGFX/hailey/issues/155).

- [x] **Bridge.** Freeze the WireViz fork at `hailey-v1`.
- [x] **Look.** Hand-built mock-ups in three directions. *Instrument* was chosen after checking them on a phone.
- [ ] **Layout spike.** Lay out Hailey's hardest diagram with elkjs and compare it with `dot -Tjson`. This is the go/no-go point.
- [ ] **Parity.** Render all ten Hailey diagrams beside the old generator. Hailey switches over only once every one is correct, and CI then does a strict SVG diff.
- [ ] **New outputs.** Pinout tables per connector in Markdown, a cut list, and gauge checks against terminal and fuse limits.
- [ ] **Plumbing.** Port pipeviz onto the same core.

## Not planned

- Physical layout or formboard views
- Net highlighting, because it needs JavaScript and GitHub won't run it
- Export to `.harness` or any other editor format

## Used by

[Hailey](https://github.com/XDGFX/hailey) pins ferrule by tag, as it does pipeviz. A ferrule
release changes Hailey's diagrams only when Hailey bumps the tag.

<sub>`docs/assets/` is generated. `scripts/make_readme_art.py` draws the banner, and the example
diagrams come from Hailey's `electrical/docs/renderer-mockups/make_mockups.py --static`.</sub>
