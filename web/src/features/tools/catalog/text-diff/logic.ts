// Myers O(ND) minimum-edit-script diff with Patience unique-line anchoring, Unified / Split view builders,
// collapsible context hunks, trailing-whitespace normalization, and binary NUL-byte + SHA-256 inspection (zero `innerHTML`)

import { digestUniversal } from '../../../../lib/digest';

export type DiffOpKind = 'equal' | 'delete' | 'insert';

export interface InlineSegment {
  kind: DiffOpKind;
  text: string;
}

export interface DiffLine {
  kind: DiffOpKind;
  oldLineNo?: number;
  newLineNo?: number;
  text: string;
  inline?: InlineSegment[];
}

export interface DiffOptions {
  ignoreTrailingWhitespace?: boolean;
}

export interface TextDiffSummary {
  added: number;
  removed: number;
  lines: DiffLine[];
  approximated?: boolean;
}

export type UnifiedDisplayRow =
  | { type: 'line'; line: DiffLine }
  | { type: 'collapsed'; hiddenCount: number };

export type SplitDisplayRow =
  | { type: 'pair'; left?: DiffLine; right?: DiffLine }
  | { type: 'collapsed'; hiddenCount: number };

export interface InspectedDiffFile {
  fileName: string;
  byteLength: number;
  isBinary: boolean;
  sha256Hex: string;
  text: string;
}

const MAX_MYERS_MATRIX_SPAN = 2400;
const MAX_BOUNDED_MYERS_SPAN = 20000;
const MAX_MYERS_EDIT_DISTANCE = 800;

interface AnchorPair {
  aIdx: number;
  bIdx: number;
}

function findUniqueAnchors<T>(a: readonly T[], b: readonly T[]): AnchorPair[] {
  const mapA = new Map<T, number>();
  for (let i = 0; i < a.length; i += 1) {
    const item = a[i];
    mapA.set(item, mapA.has(item) ? -1 : i);
  }

  const mapB = new Map<T, number>();
  for (let j = 0; j < b.length; j += 1) {
    const item = b[j];
    if (!mapA.has(item) || mapA.get(item) === -1) continue;
    mapB.set(item, mapB.has(item) ? -1 : j);
  }

  const candidates: AnchorPair[] = [];
  for (let i = 0; i < a.length; i += 1) {
    const aPos = mapA.get(a[i]);
    if (aPos === undefined || aPos < 0) continue;
    const bPos = mapB.get(a[i]);
    if (bPos !== undefined && bPos >= 0) {
      candidates.push({ aIdx: aPos, bIdx: bPos });
    }
  }

  if (candidates.length === 0) return [];

  const tails: number[] = [];
  const prevIdx = new Int32Array(candidates.length).fill(-1);

  for (let i = 0; i < candidates.length; i += 1) {
    const targetB = candidates[i].bIdx;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (candidates[tails[mid]].bIdx < targetB) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prevIdx[i] = tails[lo - 1];
    }
    tails[lo] = i;
  }

  const lis: AnchorPair[] = [];
  let cur = tails[tails.length - 1];
  while (cur >= 0) {
    lis.push(candidates[cur]);
    cur = prevIdx[cur];
  }
  lis.reverse();
  return lis;
}

function hasAnySharedItem<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set<T>(a);
  for (let j = 0; j < b.length; j += 1) {
    if (setA.has(b[j])) return true;
  }
  return false;
}

function runBoundedMyers<T>(
  midA: readonly T[],
  midB: readonly T[],
  maxD: number
): Array<{ kind: DiffOpKind; item: T }> | null {
  const n = midA.length;
  const m = midB.length;
  const max = n + m;
  const offset = max + 2;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  let reached = false;

  outer: for (let d = 0; d <= maxD; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + offset;
      let x: number;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && midA[x] === midB[y]) {
        x += 1;
        y += 1;
      }
      v[kIdx] = x;
      if (x >= n && y >= m) {
        reached = true;
        break outer;
      }
    }
  }

  if (!reached) {
    return null;
  }

  const steps: Array<{ kind: DiffOpKind; item: T }> = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const vd = trace[d];
    const localOff = d + 1;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[k - 1 + localOff] < vd[k + 1 + localOff])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vd[prevK + localOff];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      steps.push({ kind: 'equal', item: midA[x] });
    }

    if (d > 0) {
      if (x === prevX) {
        y -= 1;
        steps.push({ kind: 'insert', item: midB[y] });
      } else {
        x -= 1;
        steps.push({ kind: 'delete', item: midA[x] });
      }
    }
  }

  steps.reverse();
  return steps;
}

function diffInternal<T>(
  a: readonly T[],
  b: readonly T[],
  state: { approximated: boolean }
): Array<{ kind: DiffOpKind; item: T }> {
  const fullN = a.length;
  const fullM = b.length;
  if (fullN + fullM === 0) return [];
  if (fullN === 0) return b.map((item) => ({ kind: 'insert', item }));
  if (fullM === 0) return a.map((item) => ({ kind: 'delete', item }));

  let prefix = 0;
  while (prefix < fullN && prefix < fullM && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < fullN - prefix &&
    suffix < fullM - prefix &&
    a[fullN - 1 - suffix] === b[fullM - 1 - suffix]
  ) {
    suffix += 1;
  }

  const out: Array<{ kind: DiffOpKind; item: T }> = [];
  for (let i = 0; i < prefix; i += 1) {
    out.push({ kind: 'equal', item: a[i] });
  }

  const midA = a.slice(prefix, fullN - suffix);
  const midB = b.slice(prefix, fullM - suffix);
  const n = midA.length;
  const m = midB.length;
  const max = n + m;

  if (max > 0) {
    if (n === 0) {
      for (const item of midB) out.push({ kind: 'insert', item });
    } else if (m === 0) {
      for (const item of midA) out.push({ kind: 'delete', item });
    } else if (!hasAnySharedItem(midA, midB)) {
      for (const item of midA) out.push({ kind: 'delete', item });
      for (const item of midB) out.push({ kind: 'insert', item });
    } else if (max <= MAX_MYERS_MATRIX_SPAN) {
      const exact = runBoundedMyers(midA, midB, max);
      if (exact) {
        for (const step of exact) out.push(step);
      }
    } else {
      const anchors = findUniqueAnchors(midA, midB);
      if (anchors.length > 0) {
        let curA = 0;
        let curB = 0;
        for (const anchor of anchors) {
          const gapSteps = diffInternal(
            midA.slice(curA, anchor.aIdx),
            midB.slice(curB, anchor.bIdx),
            state
          );
          for (const step of gapSteps) out.push(step);
          out.push({ kind: 'equal', item: midA[anchor.aIdx] });
          curA = anchor.aIdx + 1;
          curB = anchor.bIdx + 1;
        }
        const tailGap = diffInternal(midA.slice(curA), midB.slice(curB), state);
        for (const step of tailGap) out.push(step);
      } else {
        const bounded =
          max <= MAX_BOUNDED_MYERS_SPAN
            ? runBoundedMyers(midA, midB, Math.min(max, MAX_MYERS_EDIT_DISTANCE))
            : null;
        if (bounded) {
          for (const step of bounded) out.push(step);
        } else {
          state.approximated = true;
          for (const item of midA) out.push({ kind: 'delete', item });
          for (const item of midB) out.push({ kind: 'insert', item });
        }
      }
    }
  }

  for (let i = fullN - suffix; i < fullN; i += 1) {
    out.push({ kind: 'equal', item: a[i] });
  }
  return out;
}

export function myersDiff<T>(a: readonly T[], b: readonly T[]): Array<{ kind: DiffOpKind; item: T }> {
  return diffInternal(a, b, { approximated: false });
}

function computeInlinePair(
  oldStr: string,
  newStr: string
): { oldSegs: InlineSegment[]; newSegs: InlineSegment[] } {
  if (oldStr.length + newStr.length > 600) {
    return {
      oldSegs: [{ kind: 'delete', text: oldStr }],
      newSegs: [{ kind: 'insert', text: newStr }],
    };
  }
  const ops = myersDiff(Array.from(oldStr), Array.from(newStr));
  const oldSegs: InlineSegment[] = [];
  const newSegs: InlineSegment[] = [];

  const pushSeg = (target: InlineSegment[], kind: DiffOpKind, ch: string) => {
    const last = target[target.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else target.push({ kind, text: ch });
  };

  for (const op of ops) {
    if (op.kind === 'equal') {
      pushSeg(oldSegs, 'equal', op.item);
      pushSeg(newSegs, 'equal', op.item);
    } else if (op.kind === 'delete') {
      pushSeg(oldSegs, 'delete', op.item);
    } else {
      pushSeg(newSegs, 'insert', op.item);
    }
  }

  return { oldSegs, newSegs };
}

export function diffTexts(left: string, right: string, options?: DiffOptions): TextDiffSummary {
  const rawA = left === '' ? [] : left.split(/\r?\n/);
  const rawB = right === '' ? [] : right.split(/\r?\n/);
  const trimRight = Boolean(options?.ignoreTrailingWhitespace);

  const aKeys = trimRight ? rawA.map((s) => s.replace(/[ \t]+$/, '')) : rawA;
  const bKeys = trimRight ? rawB.map((s) => s.replace(/[ \t]+$/, '')) : rawB;

  const state = { approximated: false };
  const ops = diffInternal(aKeys, bKeys, state);

  let oldNo = 1;
  let newNo = 1;
  let added = 0;
  let removed = 0;
  const lines: DiffLine[] = [];

  for (const op of ops) {
    if (op.kind === 'equal') {
      lines.push({
        kind: 'equal',
        oldLineNo: oldNo,
        newLineNo: newNo,
        text: rawB[newNo - 1] ?? op.item,
      });
      oldNo += 1;
      newNo += 1;
    } else if (op.kind === 'delete') {
      lines.push({
        kind: 'delete',
        oldLineNo: oldNo,
        text: rawA[oldNo - 1] ?? op.item,
      });
      oldNo += 1;
      removed += 1;
    } else {
      lines.push({
        kind: 'insert',
        newLineNo: newNo,
        text: rawB[newNo - 1] ?? op.item,
      });
      newNo += 1;
      added += 1;
    }
  }

  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (lines[i].kind === 'delete' && lines[i + 1].kind === 'insert') {
      const { oldSegs, newSegs } = computeInlinePair(lines[i].text, lines[i + 1].text);
      lines[i].inline = oldSegs;
      lines[i + 1].inline = newSegs;
      i += 1;
    }
  }

  return {
    added,
    removed,
    lines,
    ...(state.approximated ? { approximated: true } : {}),
  };
}

function collapseRuns<T>(
  items: readonly T[],
  isEqual: (item: T) => boolean,
  makeCollapsed: (hiddenCount: number) => T,
  contextLines: number
): T[] {
  const hasChanges = items.some((item) => !isEqual(item));
  if (!hasChanges) {
    return items.length > contextLines * 2
      ? [makeCollapsed(items.length)]
      : [...items];
  }

  const keep = new Uint8Array(items.length);
  for (let i = 0; i < items.length; i += 1) {
    if (!isEqual(items[i])) {
      const lo = Math.max(0, i - contextLines);
      const hi = Math.min(items.length - 1, i + contextLines);
      for (let k = lo; k <= hi; k += 1) keep[k] = 1;
    }
  }

  const out: T[] = [];
  let idx = 0;
  while (idx < items.length) {
    if (keep[idx]) {
      out.push(items[idx]);
      idx += 1;
    } else {
      let end = idx;
      while (end < items.length && !keep[end]) end += 1;
      const hidden = end - idx;
      if (hidden === 1) {
        out.push(items[idx]);
      } else {
        out.push(makeCollapsed(hidden));
      }
      idx = end;
    }
  }
  return out;
}

export function buildUnifiedDisplayRows(
  lines: readonly DiffLine[],
  collapseUnchanged = false,
  contextLines = 3
): UnifiedDisplayRow[] {
  const base: UnifiedDisplayRow[] = lines.map((line) => ({ type: 'line', line }));
  if (!collapseUnchanged) return base;
  return collapseRuns(
    base,
    (row) => row.type === 'line' && row.line.kind === 'equal',
    (hiddenCount) => ({ type: 'collapsed', hiddenCount }),
    contextLines
  );
}

export function buildSplitDisplayRows(
  lines: readonly DiffLine[],
  collapseUnchanged = false,
  contextLines = 3
): SplitDisplayRow[] {
  const pairs: SplitDisplayRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const cur = lines[i];
    if (cur.kind === 'equal') {
      pairs.push({ type: 'pair', left: cur, right: cur });
      i += 1;
      continue;
    }

    const deletes: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'delete') {
      deletes.push(lines[i]);
      i += 1;
    }
    const inserts: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'insert') {
      inserts.push(lines[i]);
      i += 1;
    }

    const span = Math.max(deletes.length, inserts.length);
    for (let k = 0; k < span; k += 1) {
      const leftLine = deletes[k];
      const rightLine = inserts[k];
      if (leftLine && rightLine && !leftLine.inline && !rightLine.inline) {
        const { oldSegs, newSegs } = computeInlinePair(leftLine.text, rightLine.text);
        pairs.push({
          type: 'pair',
          left: { ...leftLine, inline: oldSegs },
          right: { ...rightLine, inline: newSegs },
        });
      } else {
        pairs.push({ type: 'pair', left: leftLine, right: rightLine });
      }
    }
  }

  if (!collapseUnchanged) return pairs;
  return collapseRuns(
    pairs,
    (row) =>
      row.type === 'pair' &&
      row.left?.kind === 'equal' &&
      row.right?.kind === 'equal',
    (hiddenCount) => ({ type: 'collapsed', hiddenCount }),
    contextLines
  );
}

export function containsNulByte(bytes: Uint8Array, maxScanBytes = 8 * 1024 * 1024): boolean {
  const end = Math.min(bytes.length, maxScanBytes);
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

export async function inspectDiffFileBytes(
  fileName: string,
  rawBuffer: ArrayBuffer
): Promise<InspectedDiffFile> {
  const bytes = new Uint8Array(rawBuffer);
  const digest = await digestUniversal('SHA-256', bytes);
  const sha256Hex = Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const isBinary = containsNulByte(bytes);
  const text = isBinary ? '' : new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  return {
    fileName,
    byteLength: bytes.byteLength,
    isBinary,
    sha256Hex,
    text,
  };
}
