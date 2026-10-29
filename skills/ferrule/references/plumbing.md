# Plumbing: the pipeviz syntax ferrule reads

A plan has `components`, `pipes` and `connections`. Each prepended file is parsed on its own and
deep-merged under the plan: its `diagram`, `templates`, `components` and `groups` sit beneath the
plan's own. `pipes` and `connections` come from the plan alone, so declare every pipe in the plan that
uses it. The sheet is titled by `diagram.title`, or else the file name in title case.

## Templates and components

```yaml
templates:
  fitting:
    color: "#64748b"              # the card's outline and faint tint
    display: pill                 # card (default), pill, exit or end
  pump:
    color: "#c2410c"
    glyph: pump                   # a symbol before the title; none by default

components:
  tank:
    template: tank                # merges the template under the component's own keys
    label: 95L FRESH WATER TANK   # required; the card's title
    manufacturer: Camec           # subtitle, with `model`
    description: >                # under the ports, wrapped
      Slimline polyethylene tank.
    ports:                        # names, or objects with a name
      - name: HIGH_BSP40_F
        connection_size: '1-1/2" BSP'   # with gender, muted at the row's end
        gender: F
      - LOW_BSP20_F
  manifold:
    label: MANIFOLD
    portcount: 4                  # ports named 1 to 4
  adapter_19mm_to_1_2_bsp:
    template: fitting
    label: '19MM BARB → 1/2" BSP MALE ADAPTER'
    simple: true                  # no ports; pipes attach to the card itself
  kitchen_tap:
    ref: tap_mixer                # copies another component, then applies these keys
    label: KITCHEN TAP
```

- Every component needs a `label`, and either `ports` or `portcount`, or `simple: true`. A
  simple component has neither.
- With both `ports` and `portcount`, the two must agree.
- `ref` and `template` chains may nest. A cycle is an error.
- A component no chain names is not drawn.
- `display` and `glyph` are opt-in, usually set on a template; a component may override them.
  Any other value is an error.

| `display` | Drawn as |
|---|---|
| `card` | The full card: title, subtitle, ports and description. The default. |
| `pill` | A minor part, such as an adapter or tee: a borderless muted line, no subtitle or description. A simple pill is one line; one with ports keeps them as tight rows. |
| `exit` | Where a run leaves the sheet, such as `FROM OTHER SYSTEM`: a tag with an arrow on its east end, every port on its centre line. Joined straight to one port, with no pipe between, it sits a short stub from that port, inside the port's frame if it has one. |
| `end` | Where a run stops for good, such as `TO GROUND`. No box: the pipe stops at a short bar across its end, in the pipe's own colour and weight, the label in muted text just beyond. Give it one port, reached by a pipe. |

Use `exit` when the run carries on in another diagram, and `end` when nothing follows it
anywhere, such as water let out of the vehicle.

`glyph` is one of `valve`, `pump`, `filter`, `heater`, `tank`, `trap`, `vent` or `fixture`: a
small P&ID-style symbol in the template colour before a full card's title. Pills, exits and ends
draw none. Leave it off a template with no clear symbol.

## Pipes

```yaml
pipes:
  hose_25mm:
    label: 25MM FILL HOSE         # the run's label, drawn over the line in its colour
    size: 25mm                    # bore: 25mm, 3/4", 1-1/2" or 1.5in; sets line weight
    service_rating: potable       # potable blue, hot red, waste brown, vent olive
    colour: OG                    # or color; a colour code or hex, which beats the service
    material: PVC
    length: 1.2 m                 # joins the label
    coil: true                    # draw each run as a coil; off by default
```

Any other `service_rating` draws grey; give the pipe a `colour` instead.

`coil: true` is for a pipe that is really one long looped length, such as an underfloor heating
loop. Each of its runs is drawn as six passes back and forth in the pipe's own colour and weight,
with the label above the coil. On `pipe^` the coil takes the place of the turn; on a straight run
it is let into the middle of the line, which is drawn plain if ELK leaves no level stretch long
enough to hold it. A run with an open end is a card, not a line, and never coils. Any `coil`
value other than `true` or `false` is an error.

## Connections

Each entry is a **chain** of tokens, read hop by hop.

| Token | Meaning |
|---|---|
| `part` | The part itself, at its first port |
| `part:PORT` | A port by name, else by number (`part:3`) |
| `part.name` | A named instance, shared by every chain that names it; titled `LABEL · name` |
| `part.` | A fresh instance, new on every use; numbered on the sheet when there are several |
| `pipe` | A fresh run of that pipe. Every use is its own run, so a pipe takes no instance |
| `pipe^` | A run that turns the chain round (see below) |

```yaml
connections:
  - - filler:BARB_25MM            # part → pipe → part: one labelled run
    - hose_25mm
    - tee_25mm_barb:A
  - - tee_25mm_barb:B
    - hose_25mm
    - adapter_25mm_to_1_5_bsp.    # parts side by side screw straight together
    - tank.a:HIGH_BSP40_F
  - - tank.a:LOW_BSP40_M          # a U-turn between two tanks
    - adapter_dwv.
    - hose_40mm^
    - adapter_dwv.
    - tank.b:LOW_BSP40_M
```

- **`pipe^`** leaves both its ends heading east and turns round past them, with its label at the
  turn. Everything after it in the chain is laid out heading back, so `tank.b` sits beside
  `tank.a` instead of a sheet-width away. Use it when a run joins two parts that sit side by
  side, such as a crosslink or a loop out and back.
- Two parts side by side, with no pipe between them, are joined directly by a short unlabelled
  line.

### Flow and accents

A connection can also be a map that names its chain, so it can say what the chain carries.
Both keys are opt-in: a plan that uses neither draws as before.

```yaml
connections:
  - flow: forward                 # forward, reverse or none; read along the chain as written
    accent: "#d55e00"             # a colour code or #rrggbb: a tracing line beside every link
    accent_side: both             # both (default), left or right, looking along the chain
    chain:
      - heater:COOLANT_OUT
      - hose_19mm
      - tee.exchangers:A
```

- **`flow`** draws a small chevron cut into each run of the chain, pointing the way coolant
  moves: on the run's longest free stretch, clear of corners, ports, its label and any line
  crossing it. `reverse` is for a chain written against the flow; `none` draws nothing. Past a
  `pipe^` the chain still reads in the order written.
- **`accent`** draws a thin line in its colour on one or both sides of every run and fitting
  hop in the chain, following each bend, and leaves the hose's own colour and weight alone.
  Use it to trace a circuit (hot flow, return) across hoses of one type, instead of a new pipe
  with its own `colour`, since colour means hose type. Define each circuit's colour once with
  a YAML anchor. A sheet with any accent spaces its lines a little further apart.
- One chain carries one flow and one accent. Where a circuit changes partway, such as at a
  load, split the chain at a named instance (`part.name`) both halves share.
- Errors: a `flow` other than forward, reverse or none; an `accent` that is neither a colour
  code nor `#rrggbb`; an `accent_side` other than both, left or right, or without an `accent`;
  any key but `chain`, `flow`, `accent` and `accent_side`.

Rules, each enforced:

- A chain has at least two tokens.
- A pipe never sits next to a pipe.
- A token names one port at most: `part:[A,B]` and `part:1-2` are errors.
- A simple part takes no port: `adapter.:A` is an error.
- Every port named must exist.
- A chain turns round once at most, and only a pipe carries `^`.
- Every name must be declared in `components` or `pipes`.

## Groups

```yaml
groups:
  water_box:
    label: WATER BOX              # the frame's title; optional
    members: [pump, accumulator, tee.t1, adapter.tap_in]
```

A group draws a dashed frame, titled at its top left, round its members' cards and nothing else.
It sits beneath the cards and pipes, and a pipe crosses its border to reach a member. Opt-in: a
plan with no `groups` draws as before.

- A member is a part as a chain names it: `pump` or a named instance, `tee.t1`. No port, no `^`.
- A fresh instance (`adapter.`) has no name to list, so it can't be a member. A fitting between
  two members that is not one itself is drawn outside the frame, and the pipes to it go the long
  way round. Name it in the chain (`adapter.tap_in`) and list it.
- A member no chain names is left out, so a group in a prepended file can list parts that only
  some plans draw. A group with none of its members drawn is an error: keep a group out of a
  shared file if some plan draws nothing in it.
- A part is in one group at most, and groups do not nest.
- A run that turns round (`pipe^`) between two members of one group stays inside its frame.
- With `diagram.wrap`, a frame is kept whole on one row.
- Errors: a member that is not a declared component, a pipe, a fresh instance, a part listed
  twice or in two groups, a missing or empty `members`, and any key but `label` and `members`.

Parts inside a frame are ordered by ELK alone, not by where `connections` first names them, so
a plan may lay out differently once it has a group.

## Layout

A long chain renders as one wide row. `diagram: { wrap: true }` folds it into rows aiming for a
1.6:1 sheet; `diagram: { wrap: { aspect: 4 } }` names the ratio, and a higher one folds less. It
can sit in the plan or in a prepended file. Raise `aspect` if a fold leaves one part alone on the
last row. Any other `wrap` value is an error.

## Not read

Legacy `edges`, pipeviz's `--combined` sheet, and the Graphviz keys (`shape`, `style`,
`fillcolor`, `rankdir`, `nodesep`, `fontname`, `bgcolor`). A port's own `service_rating` is
ignored.
