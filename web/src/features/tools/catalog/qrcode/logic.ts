import { encode } from 'uqr';

export type QrEccLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrGenerated {
  version: number;
  size: number;
  utf8Bytes: number;
  modules: boolean[][];
  svgPath: string;
  svgDocument: string;
}

export type QrResult =
  | { ok: true; data: QrGenerated }
  | { ok: false; empty: boolean; error?: string };

export function buildQrCode(
  text: string,
  ecc: QrEccLevel = 'M',
  border = 2
): QrResult {
  if (text.length === 0) {
    return { ok: false, empty: true };
  }

  const bytes = Array.from(new TextEncoder().encode(text));

  try {
    const qr = encode(bytes, { ecc, border });
    const chunks: string[] = [];
    for (let y = 0; y < qr.size; y++) {
      const row = qr.data[y];
      for (let x = 0; x < qr.size; x++) {
        if (row[x]) {
          chunks.push(`M${x} ${y}h1v1h-1z`);
        }
      }
    }

    const svgPath = chunks.join('');
    const px = qr.size * 12;
    const svgDocument = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" width="${px}" height="${px}" shape-rendering="crispEdges">`,
      `<rect width="${qr.size}" height="${qr.size}" fill="#ffffff"/>`,
      `<path d="${svgPath}" fill="#090b0d"/>`,
      `</svg>`,
    ].join('');

    return {
      ok: true,
      data: {
        version: qr.version,
        size: qr.size,
        utf8Bytes: bytes.length,
        modules: qr.data,
        svgPath,
        svgDocument,
      },
    };
  } catch (err) {
    return {
      ok: false,
      empty: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
