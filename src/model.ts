// The harness model both layouts and the renderer work from. Readers produce it; nothing
// downstream knows which YAML dialect it came from.

export interface Pin {
  num: string;
  label: string;
  /** Colour codes for a pin's marking, one per stripe, as on a cable's wires. Empty when unmarked. */
  colours: string[];
}

export interface Connector {
  id: string;
  template: string;
  type: string;
  subtype: string;
  pins: Pin[];
  /** A `style: simple` connector has no pin table: wires attach to the card itself. */
  simple: boolean;
  /** Pins bridged on the connector itself, as pairs of pin numbers. */
  loops: [string, string][];
  accent: string;
  notes: string[];
}

export interface CableWire {
  index: number;
  label: string;
  /** The colour code as written, such as "GNYE". A connection can name a wire by it. */
  code: string;
  /** Colour codes, one per stripe: ["GN", "YE"] for a green wire with a yellow tracer. */
  colours: string[];
}

export interface Cable {
  id: string;
  template: string;
  type: string;
  /** Conductor size in mm², when the YAML gives one. */
  gauge: number | null;
  length: string;
  wires: CableWire[];
  accent: string;
  notes: string[];
}

export interface End {
  connector: string;
  pin: string;
}

/** One conductor of one cable, with whatever it lands on at each end. */
export interface Link {
  cable: string;
  wire: number;
  from: End | null;
  to: End | null;
}

export interface Harness {
  title: string;
  connectors: Connector[];
  cables: Cable[];
  links: Link[];
  /** Connectors mated as a whole, such as the two halves of an inline plug. */
  mates: Mate[];
}

export interface Mate {
  from: string;
  to: string;
}
