/**
 * @hasna/knowledge — diffing two states of a knowledge entry.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * A knowledge entry is more than its body: a version-worthy edit can move the
 * title, the url, the tag set, the metadata, or the archived flag without
 * touching a single line of content. A body-only diff would render such an edit
 * as "no changes" — a confident, wrong answer of exactly the kind this whole
 * feature exists to stop. So the diff reports both: which FIELDS moved, and a
 * line-level diff of the body.
 *
 * The line diff is a plain LCS. There is no diff dependency in this package and
 * pulling one in for a CLI read command is not worth the supply-chain surface;
 * entry bodies are prose-sized, where LCS is unremarkable.
 */

import type { SafetyPolicy } from './safety';
import { redactSecrets, redactValueTree } from './safety';

export type DiffOp = 'context' | 'add' | 'remove';

export interface DiffLine {
  op: DiffOp;
  /** 1-based line number in the "from" side; null for added lines. */
  from_line: number | null;
  /** 1-based line number in the "to" side; null for removed lines. */
  to_line: number | null;
  text: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** The two sides of a comparison, as far as diffing cares. */
export interface EntrySnapshot {
  title?: string;
  content?: string | null;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export interface EntryDiff {
  /** True when nothing at all moved between the two sides. */
  identical: boolean;
  /** Non-body fields that changed. Empty when only the body moved. */
  fields: FieldChange[];
  /** Line-level body diff, context included. */
  content: DiffLine[];
  /** Counts, so a caller can report "+3 -1" without walking the lines. */
  added: number;
  removed: number;
}

function splitLines(value: string | null | undefined): string[] {
  const text = value ?? '';
  if (text === '') return [];
  // A trailing newline is a terminator, not an empty final line.
  return text.replace(/\n$/, '').split('\n');
}

/**
 * Longest common subsequence table over two line arrays.
 *
 * O(n*m) in time and memory. Bodies here are entries a human wrote, so this is
 * fine; a caller diffing megabyte artifacts should not be using this function,
 * and the guard below says so rather than quietly grinding.
 */
const MAX_DIFF_LINES = 5000;

export function diffLines(fromText: string | null | undefined, toText: string | null | undefined): DiffLine[] {
  const a = splitLines(fromText);
  const b = splitLines(toText);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    throw new Error(
      `Refusing to line-diff ${Math.max(a.length, b.length)} lines (limit ${MAX_DIFF_LINES}). `
        + 'Fetch the two versions and diff them with a dedicated tool.',
    );
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'context', from_line: i + 1, to_line: j + 1, text: a[i]! });
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: 'remove', from_line: i + 1, to_line: null, text: a[i]! });
      i += 1;
    } else {
      out.push({ op: 'add', from_line: null, to_line: j + 1, text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ op: 'remove', from_line: i + 1, to_line: null, text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    out.push({ op: 'add', from_line: null, to_line: j + 1, text: b[j]! });
    j += 1;
  }
  return out;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Compare two entry states, body and fields together. */
export function diffEntries(from: EntrySnapshot, to: EntrySnapshot): EntryDiff {
  const fields: FieldChange[] = [];
  const compare = (field: keyof EntrySnapshot) => {
    if (!sameJson(from[field], to[field])) {
      fields.push({ field, from: from[field] ?? null, to: to[field] ?? null });
    }
  };
  compare('title');
  compare('url');
  compare('tags');
  compare('metadata');
  compare('archived');

  const content = diffLines(from.content, to.content);
  const added = content.filter((line) => line.op === 'add').length;
  const removed = content.filter((line) => line.op === 'remove').length;
  return { identical: fields.length === 0 && added === 0 && removed === 0, fields, content, added, removed };
}

/** Render a diff as unified-style text for a terminal. */
export function formatEntryDiff(diff: EntryDiff, fromLabel: string, toLabel: string): string {
  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  if (diff.identical) {
    lines.push('(no changes)');
    return lines.join('\n');
  }
  for (const change of diff.fields) {
    lines.push(`~ ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
  }
  if (diff.added === 0 && diff.removed === 0) {
    if (diff.fields.length > 0) lines.push('(content unchanged)');
  } else {
    lines.push(`@@ content +${diff.added} -${diff.removed} @@`);
    for (const line of diff.content) {
      const marker = line.op === 'add' ? '+' : line.op === 'remove' ? '-' : ' ';
      lines.push(`${marker}${line.text}`);
    }
  }
  return lines.join('\n');
}

/**
 * Render-time redaction for a retained-version diff.
 *
 * A diff between a retained snapshot and another state renders the retained
 * body line by line. A credential-shaped value that survives in history (the
 * 2026-08 redaction residual, incident 731221) would re-enter a transcript
 * through exactly that rendering, so the diff's body lines pass through the
 * redaction path before they are output. The comparison itself still runs on
 * the true bodies — the counts and line structure are the real ones; only the
 * rendered text is masked. The store's copy is never touched.
 */
export function redactEntryDiff(diff: EntryDiff, policy?: Pick<SafetyPolicy, 'redaction'>): EntryDiff {
  return {
    ...diff,
    fields: diff.fields.map((change) => ({
      field: change.field,
      from: redactValueTree(change.from, policy),
      to: redactValueTree(change.to, policy),
    })),
    content: diff.content.map((line) => ({ ...line, text: redactSecrets(line.text, policy).text })),
  };
}
