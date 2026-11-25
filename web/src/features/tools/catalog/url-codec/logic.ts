export type UrlCodecMode = 'component' | 'uri';

export interface UrlCodecResult {
  ok: boolean;
  output: string;
}

export function encodeUrlText(input: string, mode: UrlCodecMode = 'component'): UrlCodecResult {
  try {
    return {
      ok: true,
      output: mode === 'component' ? encodeURIComponent(input) : encodeURI(input),
    };
  } catch {
    return { ok: false, output: '' };
  }
}

export function decodeUrlText(input: string, mode: UrlCodecMode = 'component'): UrlCodecResult {
  try {
    // Decode `+` as space in `component` mode for `application/x-www-form-urlencoded` query compatibility
    const prepared = mode === 'component' ? input.replace(/\+/g, '%20') : input;
    return {
      ok: true,
      output: mode === 'component' ? decodeURIComponent(prepared) : decodeURI(prepared),
    };
  } catch {
    return { ok: false, output: '' };
  }
}
