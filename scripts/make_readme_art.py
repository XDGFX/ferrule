#!/usr/bin/env python3
"""Draw the README banner in light and dark, in the Instrument style (direction A of hailey#155).

GitHub serves README images through <img>, which ignores web fonts and gives us no say over
the page theme, so each theme is its own file with literal colours, picked by <picture>.
Usage: python3 scripts/make_readme_art.py
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs" / "assets"
FONT = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

THEMES = {
    "light": dict(bg="#eef0f3", card="#ffffff", line="#d5d9df", text="#1b1f24", muted="#5e6670",
                  faint="#9aa1aa", casing="#7f8792", case_bk="#7f8792", case_wh="#7f8792"),
    "dark": dict(bg="#121418", card="#1c1f25", line="#323741", text="#e8eaed", muted="#9aa1ab",
                 faint="#626a75", casing="#5d6570", case_bk="#9aa1ab", case_wh="#5d6570"),
}
WIRE = {"RD": "#e23b3b", "WH": "#f3f3f1", "GN": "#2f9f4f", "YE": "#f0c419", "VT": "#8a52d3",
        "BK": "#141518"}
COPPER, BRASS = "#c4773f", "#c9a35a"


def path(pts, r=16):
    d = [f"M{pts[0][0]},{pts[0][1]}"]
    for (ax, ay), (bx, by), (cx, cy) in zip(pts, pts[1:], pts[2:]):
        l1, l2 = abs(bx - ax) + abs(by - ay), abs(cx - bx) + abs(cy - by)
        rr = min(r, l1 / 2, l2 / 2)
        ux, uy = (bx - ax) / l1, (by - ay) / l1
        vx, vy = (cx - bx) / l2, (cy - by) / l2
        d.append(f"L{bx - ux * rr:.1f},{by - uy * rr:.1f} Q{bx},{by} {bx + vx * rr:.1f},{by + vy * rr:.1f}")
    d.append(f"L{pts[-1][0]},{pts[-1][1]}")
    return " ".join(d)


def banner(t):
    W, H = 1280, 420
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
         f'role="img" aria-label="ferrule: wiring and plumbing diagrams from YAML">',
         f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>']

    # Wordmark
    o.append(f'<text x="72" y="196" font-family="{FONT}" font-size="104" font-weight="600" '
             f'letter-spacing="-3" fill="{t["text"]}">ferrule</text>')
    o.append(f'<text x="76" y="246" font-family="{FONT}" font-size="25" fill="{t["muted"]}">'
             f'Wiring and plumbing diagrams from YAML.</text>')
    o.append(f'<text x="76" y="284" font-family="{FONT}" font-size="17" fill="{t["faint"]}">'
             f'One renderer · light and dark · the same bytes on every machine</text>')

    # Connector card the wires land on
    cx, cy, cw = 1010, 74, 214
    rows = [("1", "HEATER_EN"), ("2", "UNDERFLOOR_PUMP"), ("3", "HEATER_BULB"), ("7", "SIGNAL_GND"),
            ("8", "GND")]
    rh, hh = 30, 62
    ch = hh + len(rows) * rh + 8
    o.append(f'<rect x="{cx}" y="{cy}" width="{cw}" height="{ch}" rx="10" fill="{t["card"]}" '
             f'stroke="{t["line"]}"/>')
    o.append(f'<rect x="{cx + 14}" y="{cy + 15}" width="11" height="11" rx="3" fill="#ff8a1f"/>')
    o.append(f'<text x="{cx + 32}" y="{cy + 25}" font-family="{FONT}" font-size="15" font-weight="600" '
             f'fill="{t["text"]}">HEATING_CONN</text>')
    o.append(f'<text x="{cx + 14}" y="{cy + 45}" font-family="{FONT}" font-size="12" '
             f'fill="{t["muted"]}">Deutsch DT · 8-pin</text>')
    ports = []
    for i, (num, label) in enumerate(rows):
        y = cy + hh + i * rh + rh / 2
        ports.append(y)
        if i:
            o.append(f'<line x1="{cx + 12}" y1="{y - rh / 2}" x2="{cx + cw - 12}" y2="{y - rh / 2}" '
                     f'stroke="{t["line"]}" stroke-opacity=".6"/>')
        o.append(f'<text x="{cx + 32}" y="{y + 4.5}" text-anchor="end" font-family="{FONT}" font-size="12" '
                 f'fill="{t["muted"]}">{num}</text>')
        o.append(f'<text x="{cx + 44}" y="{y + 4.5}" font-family="{FONT}" font-size="13" '
                 f'fill="{t["text"]}">{label}</text>')

    # Wires: each comes in from the left, bends orthogonally and ends in a crimp ferrule.
    # (source y, jog lane, colours): lanes chosen so no two wires cross.
    wires = [(104, 900, "RD", None), (146, 850, "WH", None), (232, 780, "GN", "YE"),
             (296, 820, "YE", None), (338, 870, "BK", None)]
    fx = cx - 34  # where the ferrule sleeve starts
    for (sy, lane, c1, c2), py in zip(wires, ports):
        d = path([(640, sy), (lane, sy), (lane, py), (fx, py)])
        case = t["case_bk"] if c1 == "BK" else t["case_wh"] if c1 == "WH" else t["casing"]
        o.append(f'<path d="{d}" fill="none" stroke="{case}" stroke-width="7.4"/>')
        o.append(f'<path d="{d}" fill="none" stroke="{WIRE[c1]}" stroke-width="5"/>')
        if c2:
            o.append(f'<path d="{d}" fill="none" stroke="{WIRE[c2]}" stroke-width="2.6" '
                     f'stroke-dasharray="14 8"/>')
        # insulated collar, then the bare tinned sleeve that seats in the pin
        o.append(f'<path d="M{fx},{py - 7} l12,-2 v18 l-12,-2 Z" fill="{WIRE[c1]}" stroke="{case}"/>')
        o.append(f'<rect x="{fx + 12}" y="{py - 4}" width="20" height="8" rx="1.5" fill="#b9bfc7" '
                 f'stroke="{t["casing"]}"/>')
        o.append(f'<circle cx="{cx}" cy="{py}" r="3.6" fill="{t["card"]}" stroke="{t["muted"]}" '
                 f'stroke-width="1.3"/>')
        # fade the wire in from the wordmark side
    o.append(f'<defs><linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="{t["bg"]}"/>'
             f'<stop offset="1" stop-color="{t["bg"]}" stop-opacity="0"/></linearGradient></defs>')
    o.append(f'<rect x="636" y="90" width="90" height="260" fill="url(#fade)"/>')

    # Plumbing: a copper run with a compression fitting, ferrule (olive) visible at the nut.
    py = 372
    o.append(f'<path d="M700,{py} H1224" stroke="{t["casing"]}" stroke-width="14" stroke-linecap="round"/>')
    o.append(f'<path d="M700,{py} H1224" stroke="{COPPER}" stroke-width="11" stroke-linecap="round"/>')
    for x in (930, 1010):
        o.append(f'<rect x="{x}" y="{py - 15}" width="34" height="30" rx="3" fill="{BRASS}" '
                 f'stroke="{t["casing"]}"/>')
        for k in (9, 17, 25):
            o.append(f'<line x1="{x + k}" y1="{py - 15}" x2="{x + k}" y2="{py + 15}" stroke="{t["casing"]}" '
                     f'stroke-opacity=".55"/>')
    o.append(f'<rect x="964" y="{py - 11}" width="46" height="22" rx="2" fill="{BRASS}" stroke="{t["casing"]}"/>')
    o.append(f'<path d="M922,{py - 8} l8,-3 v22 l-8,-3 Z M1052,{py - 8} l-8,-3 v22 l8,-3 Z" fill="#e2c27a" '
             f'stroke="{t["casing"]}"/>')
    o.append(f'<rect x="700" y="{py - 12}" width="120" height="24" fill="url(#fade)"/>')
    o.append("</svg>")
    return "\n".join(o)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, t in THEMES.items():
        (OUT / f"banner-{name}.svg").write_text(banner(t) + "\n")


if __name__ == "__main__":
    main()
