// Filled SVG outlines from the official DevDay 2026 recap (10 October 2026).
// Ported from Motion Studio character-glyphs.js / characters.js. A 100-unit
// circle and the original 55-unit wrappers preserve the source optical offsets.
// Motion timings are community-authored; the captured glyph geometry is unchanged.
export type DevDayGlyph = "^" | "o" | "+" | ">" | "<" | "-" | "*";
export type DevDayVariant = "purple" | "blue" | "green" | "orange" | "charcoal" | "grey";

export const DEVDAY_GLYPHS = {
  "^": {
    "width": 28.4086,
    "offsetX": 1.3542999999999985,
    "opticalY": -6.850000000000001,
    "path": "M 2.5 31.025 L 7.2 31.025 L 13.75 14.925 L 20.3 31.025 L 25.2 31.025 L 16.4 10.275 L 11.25 10.275"
  },
  "o": {
    "width": 29.0994,
    "offsetX": 1.1996999999999982,
    "opticalY": 5.274999999999999,
    "path": "M 14.4 45.775 C 21.35 45.775 26.6 40.275 26.6 32.775 C 26.6 25.225 21.35 19.775 14.4 19.775 C 7.4 19.775 2.15 25.225 2.15 32.775 C 2.15 40.275 7.4 45.775 14.4 45.775 M 14.5 41.725 L 14.2 41.725 C 10.0 41.725 6.95 38.175 6.95 32.775 C 6.95 27.375 10.0 23.825 14.2 23.825 L 14.5 23.825 C 18.7 23.825 21.8 27.375 21.8 32.775 C 21.8 38.175 18.7 41.725 14.5 41.725"
  },
  "+": {
    "width": 29.7902,
    "offsetX": 1.120099999999999,
    "opticalY": 4.899999999999999,
    "path": "M 12.35 44.525 L 17.2 44.525 L 17.2 34.525 L 27.1 34.525 L 27.1 30.275 L 17.2 30.275 L 17.2 20.275 L 12.35 20.275 L 12.35 30.275 L 2.45 30.275 L 2.45 34.525 L 12.35 34.525"
  },
  ">": {
    "width": 27.7178,
    "offsetX": 1.1838999999999995,
    "opticalY": 4.975000000000001,
    "path": "M 3.45 43.275 L 24.7 34.525 L 24.7 30.375 L 3.45 21.675 L 3.45 26.825 L 18.4 32.525 L 3.45 38.375"
  },
  "<": {
    "width": 27.7178,
    "offsetX": 1.1838999999999995,
    "opticalY": 4.924999999999997,
    "path": "M 23.85 43.225 L 23.85 38.075 L 8.95 32.375 L 23.85 26.525 L 23.85 21.625 L 2.6 30.375 L 2.6 34.525"
  },
  "-": {
    "width": 28.4086,
    "offsetX": 1.1542999999999992,
    "opticalY": 2.6499999999999986,
    "path": "M 2.8 32.175 L 25.25 32.175 L 25.25 28.125 L 2.8 28.125"
  },
  "*": {
    "width": 20.8098,
    "offsetX": 1.0798999999999985,
    "opticalY": -11.425,
    "path": "M 7.45 24.225 L 10.35 19.325 L 13.2 24.225 L 16.05 22.625 L 13.2 17.675 L 18.8 17.675 L 18.8 14.475 L 13.2 14.475 L 16.05 9.525 L 13.25 7.925 L 10.35 12.825 L 7.5 7.925 L 4.6 9.525 L 7.5 14.475 L 1.9 14.475 L 1.9 17.675 L 7.5 17.675 L 4.6 22.625"
  }
} as const satisfies Record<DevDayGlyph, {
  width: number;
  offsetX: number;
  opticalY: number;
  path: string;
}>;

export const DEVDAY_CHARACTERS = {
  purple: { color: "#924FF7", ink: "#000000", eyes: ["o", "o"] },
  blue: { color: "#006AFF", ink: "#000000", eyes: [">", "<"] },
  green: { color: "#00AB44", ink: "#000000", eyes: ["+", "+"] },
  orange: { color: "#F26D00", ink: "#000000", eyes: ["-", "-"] },
  charcoal: { color: "#262626", ink: "#FFFFFF", eyes: ["^", "^"] },
  grey: { color: "#DFDFDF", ink: "#000000", eyes: ["*", "*"] },
} as const satisfies Record<DevDayVariant, {
  color: string;
  ink: string;
  eyes: readonly [DevDayGlyph, DevDayGlyph];
}>;

// Eye centres in a 100-unit body; do not optically re-centre the glyph paths.
export const DEVDAY_EYE_OFFSET = 50 * 0.500855;
export const DEVDAY_GAZE_LIMIT = 12;
