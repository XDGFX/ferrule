# Wiring: the WireViz subset ferrule reads

A loom file has `connectors`, `cables` and `connections`. Prepended files are joined to the loom
as text before parsing, so an anchor defined in `shared.yml` can be used in the loom, and `<<:`
merges work across files. The sheet is titled by the file's name.

## Connectors

```yaml
connectors:
  FUSE_PANEL:
    type: Blade fuse panel        # first line under the title
    subtype: 6-way                # joins the type: "Blade fuse panel · 6-way"
    pinlabels: [CH1, CH2, CH3]    # sets the pin count; pins are numbered from 1
    pincount: 6                   # instead of, or beyond, pinlabels
    pincolors: [RD, BU, "#d2b48c"] # a mark per pin, drawn as a chip before its label
    loops: [[4, 5]]               # pins bridged on the connector, by number
    bgcolor: "#36b7ff"            # the card's colour chip; bgcolor_title wins if set
    notes: |                      # under the pins; each line a paragraph
      Fused at the panel.
  ISOLATOR:
    style: simple                 # no pin table; wires attach to the card itself
    type: Battery isolator
```

- `pinlabels` longer than `pincount` is an error. A label used on two pins can't be connected
  by label.
- Runs of three or more unused pins fold into one row (`6–24 · 19 unused`), so a connector
  can carry its full pin count without bloating the card.

## Cables

```yaml
cables:
  RUN_50:
    gauge: 50 mm2                 # mm² or AWG; line weight follows it
    length: 1.5 m
    wirecount: 1
    colors: [RD]
  TWIN:
    type: Twin core
    gauge: 16 mm2
    colors: [RD, BK]              # sets wirecount; GNYE is green with a yellow tracer
    wirelabels: [24V, GND]        # names the cores; connections may use them
    notes: Tie every 300 mm.
```

A single-core cable used once between two pins is drawn as a wire with a tag
(`50 mm² · 1.5 m`). A multi-core cable, or a single core that splits or ends open, is a dashed
card the cores pass through.

## Colours

`BK WH GY PK RD OG YE OL GN TQ LB BU VT BN BG IV SL CU SN GD TN`, or a quoted hex value such as
`"#d2b48c"`. Two codes run together are a two-colour wire: `GNYE`. Any other code draws grey.

## Connections

Each entry is one **connection set**: a list that alternates connector and cable, so the set reads
across, row by row.

```yaml
connections:
  - - FUSE_PANEL: [CH1, CH2]      # pins by label, then by number
    - TWIN: [24V, GND]            # wires by colour code, then label, then number
    - PUMP: [V+, GND]
  - - BMS: [1-4]                  # a range expands to 1, 2, 3, 4
    - CAN: [1-4]
    - CERBO: [1-4]
  - - RELAY: NO                   # a scalar is one row
    - RUN_50.                     # a trailing dot: a fresh instance of the cable
    - LOAD: V+
  - - PLUG                        # == mates two connectors as a whole
    - ==
    - PLUG.SOCKET                 # X.Y: a named instance Y of template X
```

Rules, each enforced:

- Every list in a set has the same length. A bare name or scalar is repeated down its column.
- Connector and cable alternate. Two connectors side by side are only valid with `==` between
  them, which mates them as whole connectors. Pin-by-pin arrows (`--`) are rejected.
- A set may start or end with a cable, which leaves those cores open at that end.
- Every pin and wire named must exist.
- `X.` makes a fresh instance each time it appears. A template with several fresh instances
  numbers them on the sheet: `TEMPLATE · 1`, `TEMPLATE · 2`.

## Layout

`diagram: { wrap: true }` or `diagram: { wrap: { aspect: 4 } }` folds a wide sheet into rows,
as for plumbing. It's read from a loom too, but folds usually cut through a multi-core cable,
so leave it off unless the render reads better.

## Not read

`metadata`, `options`, `tweak`, `additional_bom_items`, images, `pins` dicts, shields (wire
`s`), `color_code`, `category: bundle`, `show_name`, `hide_disconnected_pins` and `loop` in the
singular (`loops` is the key). A duplicated mapping key silently keeps its last value, as PyYAML
does.
