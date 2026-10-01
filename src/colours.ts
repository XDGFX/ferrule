// Physical wire colours, by the two-letter codes WireViz uses. These are the colour of the
// insulation, so they do not change between themes; each wire's casing keeps black and white
// visible on either ground.
export const WIRE: Record<string, string> = {
  BK: "#141518", WH: "#f3f3f1", GY: "#8e939b", PK: "#f28cc0", RD: "#e23b3b", OG: "#f08a24",
  YE: "#f0c419", OL: "#9c9a2e", GN: "#2f9f4f", TQ: "#2ec4c4", LB: "#69c3f3", BU: "#2f6fd8",
  VT: "#8a52d3", BN: "#8b5a33", BG: "#d8c49a", IV: "#efe6c8", SL: "#b7bcc2", CU: "#c8774f",
  SN: "#a8adb3", GD: "#d4a73c", TN: "#d2b48c",
};

/** The accent for an unstyled component: quiet enough not to suggest a colour that means something. */
export const NEUTRAL = "#9aa1aa";

/** A YAML colour, either a WireViz code or a hex value, as a hex value. */
export function hex(value: unknown): string {
  if (typeof value !== "string" || !value) return NEUTRAL;
  if (value.startsWith("#")) return value;
  return WIRE[value] ?? NEUTRAL;
}

/** Split a WireViz colour code into stripes: "GNYE" is green with a yellow tracer. A hex value is one stripe. */
export function stripes(code: string): string[] {
  if (code.startsWith("#")) return [code];
  const out: string[] = [];
  for (let i = 0; i < code.length; i += 2) out.push(code.slice(i, i + 2));
  return out;
}
