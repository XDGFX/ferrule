# Plumbing: the pipeviz syntax ferrule reads

A plan has `components`, `pipes` and `connections`. Each prepended file is parsed on its own and
deep-merged under the plan: its `diagram`, `templates` and `components` sit beneath the plan's
own. `pipes` and `connections` come from the plan alone, so declare every pipe in the plan that
uses it. The sheet is titled by `diagram.title`, or else the file name in title case.

## Templates and components

```yaml
templates:
  fitting:
    color: "#64748b"              # the card's colour chip; nothing else in a template is drawn

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

## Pipes

```yaml
pipes:
  hose_25mm:
    label: 25MM FILL HOSE         # the run's tag
    size: 25mm                    # bore: 25mm, 3/4", 1-1/2" or 1.5in; sets line weight
    service_rating: potable       # potable blue, hot red, waste brown, vent olive
    colour: OG                    # or color; a colour code or hex, which beats the service
    material: PVC
    length: 1.2 m                 # joins the tag
```

Any other `service_rating` draws grey; give the pipe a `colour` instead.

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
  - - filler:BARB_25MM            # part → pipe → part: one tagged run
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

- **`pipe^`** leaves both its ends heading east and turns round past them, with its tag at the
  turn. Everything after it in the chain is laid out heading back, so `tank.b` sits beside
  `tank.a` instead of a sheet-width away. Use it when a run joins two parts that sit side by
  side, such as a crosslink or a loop out and back.
- Two parts side by side, with no pipe between them, are joined directly by a short untagged
  line.

Rules, each enforced:

- A chain has at least two tokens.
- A pipe never sits next to a pipe.
- A token names one port at most: `part:[A,B]` and `part:1-2` are errors.
- A simple part takes no port: `adapter.:A` is an error.
- Every port named must exist.
- A chain turns round once at most, and only a pipe carries `^`.
- Every name must be declared in `components` or `pipes`.

## Not read

Legacy `edges`, pipeviz's `--combined` sheet, and the Graphviz keys (`shape`, `style`,
`fillcolor`, `rankdir`, `nodesep`, `fontname`, `bgcolor`). A port's own `service_rating` is
ignored.
