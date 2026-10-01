// Neither package ships types. Only the calls ferrule makes are declared.

declare module "fontverter" {
  const fontverter: {
    convert(font: Buffer, to: "truetype" | "woff" | "woff2" | "sfnt"): Promise<Buffer>;
  };
  export default fontverter;
}

declare module "subset-font" {
  export default function subsetFont(font: Buffer, text: string, options?: { targetFormat?: "sfnt" | "truetype" | "woff" | "woff2" }): Promise<Buffer>;
}
