// Zero-dependency HEX / RGB / HSL / OKLCH color space converter (Björn Ottosson Oklab matrices)

export interface RgbColor {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
}

export interface ConvertedColor {
  hex: string;
  rgb: string;
  hsl: string;
  oklch: string;
  rgbRaw: RgbColor;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp(c, 0, 1) * 255);
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl({ r, g, b }: RgbColor): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) {
    return { h: 0, s: 0, l: Math.round(l * 1000) / 10 };
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;

  return {
    h: Math.round(h * 10) / 10,
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
  };
}

export function hslToRgb(h: number, sPct: number, lPct: number): RgbColor {
  const hn = (((h % 360) + 360) % 360) / 360;
  const s = clamp(sPct / 100, 0, 1);
  const l = clamp(lPct / 100, 0, 1);

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, tVal: number) => {
    let t = tVal;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

export function rgbToOklch({ r, g, b }: RgbColor): { l: number; c: number; h: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const lmsL = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const lmsM = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const lmsS = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * lmsL + 0.793617785 * lmsM - 0.0040720468 * lmsS;
  const okA = 1.9779984951 * lmsL - 2.428592205 * lmsM + 0.4505937099 * lmsS;
  const okB = 0.0259040371 * lmsL + 0.7827717662 * lmsM - 0.808675766 * lmsS;

  const c = Math.sqrt(okA * okA + okB * okB);
  const h = c < 1e-4 ? 0 : ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;

  return {
    l: Math.round(okL * 1000) / 1000,
    c: Math.round(c * 1000) / 1000,
    h: Math.round(h * 10) / 10,
  };
}

export function oklchToRgb(l: number, c: number, hDeg: number): RgbColor {
  const hRad = (hDeg * Math.PI) / 180;
  const okA = c * Math.cos(hRad);
  const okB = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

export function parseColorString(raw: string): ConvertedColor | null {
  const s = raw.trim();
  if (!s) return null;

  let rgb: RgbColor | null = null;

  const hex3 = s.match(/^#?([0-9a-f]{3})$/i);
  const hex6 = s.match(/^#?([0-9a-f]{6})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((ch) => parseInt(ch + ch, 16));
    rgb = { r, g, b };
  } else if (hex6) {
    rgb = {
      r: parseInt(hex6[1].slice(0, 2), 16),
      g: parseInt(hex6[1].slice(2, 4), 16),
      b: parseInt(hex6[1].slice(4, 6), 16),
    };
  } else {
    const rgbMatch = s.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i);
    if (rgbMatch) {
      const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
      if (r <= 255 && g <= 255 && b <= 255) {
        rgb = { r, g, b };
      }
    }
  }

  if (!rgb) {
    const hslMatch = s.match(
      /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?\s*[,\s]\s*(\d+(?:\.\d+)?)%\s*[,\s]\s*(\d+(?:\.\d+)?)%/i
    );
    if (hslMatch) {
      rgb = hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
    }
  }

  if (!rgb) {
    const oklchMatch = s.match(
      /^oklch\(\s*(\d+(?:\.\d+)?%?)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:deg)?\s*\)$/i
    );
    if (oklchMatch) {
      const lRaw = oklchMatch[1];
      const lVal = lRaw.endsWith('%') ? Number(lRaw.slice(0, -1)) / 100 : Number(lRaw);
      if (lVal >= 0 && lVal <= 1) {
        rgb = oklchToRgb(lVal, Number(oklchMatch[2]), Number(oklchMatch[3]));
      }
    }
  }

  if (!rgb) return null;

  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);
  const oklch = rgbToOklch(rgb);

  return {
    hex,
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    oklch: `oklch(${oklch.l} ${oklch.c} ${oklch.h})`,
    rgbRaw: rgb,
  };
}
