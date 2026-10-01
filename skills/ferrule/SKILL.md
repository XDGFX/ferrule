---
name: ferrule
description: >
    Write and change diagram YAML that ferrule renders: wiring looms in WireViz syntax and
    plumbing plans in pipeviz syntax. Use when adding or changing connectors, cables, pins,
    pipes, fittings, tanks or connections in a diagram .yml, or when a diagram fails to render.
---

# ferrule

ferrule renders two YAML dialects into SVG and PNG diagrams. The YAML is the contract, and
ferrule reads a **subset** of each dialect: a key outside the subset is ignored, or rejected if
it would change what connects to what. Write only what the subset holds. The dialect reference
lists exactly what that is.

## Steps

1. **Pick the dialect and read its reference.** A top-level `connectors` or `cables` key means
   wiring: read [`references/wiring.md`](references/wiring.md). A top-level `components` or
   `pipes` key means plumbing: read [`references/plumbing.md`](references/plumbing.md). For a
   new file, match its neighbours in the same directory.

2. **Read the plan, its prepend and the project's rules.** Read the whole file being changed,
   the file prepended to it (usually `shared.yml`), and the `CONTEXT.md` and ADRs for that
   subsystem. Project rules live there, not here: wire sizing, fuse limits, bungs on spare
   ports, naming. Done when every new part has a template, anchor or `ref` you will reuse, or
   a reason it needs a new one.

3. **Infer, then ask once.** Take gauge, pipe size, colour, template and port names from the
   neighbouring parts. Ask in one batch for what nothing in the files settles: lengths, which
   channel or port, whether a new part is reusable (prepend file) or a one-off (plan file).

4. **Edit the files.** Reuse anchors and `ref`s, and keep the file's indentation and naming.

5. **Render with the project's generator.** Find it in the subsystem directory (a
   `generate_all.py` or a package script). With none, run
   `npx ferrule --prepend shared.yml --output-dir out <file>.yml`. Done when it exits 0 and the
   project's own checks pass, such as pin validation and the diagram diff.

6. **Commit regenerated diagrams with the YAML.** Projects that commit diagrams usually diff
   them byte for byte in CI, so a YAML edit without its regenerated SVG and PNG fails.
   Regenerate into the committed directory (often `diagrams/`) and commit both together.

7. **Check the drawing.** Find each new part and connection in the SVG's text. A part that no
   connection names is not drawn at all.

## When a render fails

ferrule names the failing chain or connection set and the token in it, such as
`connections[3] ["tee:D","tank"]: tee: no port D`. Fix that token. The reference's rules section
says which rule it broke.
