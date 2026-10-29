import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus, StatusCounts } from './types.js';

/** One good line of the log, after parsing at the edge. */
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

function isStatus(v: unknown): v is RunStatus {
  return v === 'ok' || v === 'retry' || v === 'fail';
}

/** Parses one log line. Returns `null` for anything that is not a well-formed run line. */
export function parseLine(line: string): RunLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const { at, job, status, owner, error } = o;
  if (typeof at !== 'string' || at === '' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (!('owner' in o) || (owner !== null && typeof owner !== 'string')) return null;
  if (error !== undefined && error !== null && typeof error !== 'string') return null;
  return { at, job, status, owner: owner ?? null, error: typeof error === 'string' ? error : null };
}

function zero(): StatusCounts {
  return { ok: 0, retry: 0, fail: 0 };
}

/** Folds the text of one night's log into rows. Pure; never throws on bad lines. */
export function digestText(night: string, text: string): DigestNight {
  const byJob = new Map<string, DigestRow>();
  const counts = zero();
  let badLines = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (!run) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const row = byJob.get(run.job) ?? {
      job: run.job,
      owner: run.owner,
      runs: 0,
      retries: 0,
      counts: zero(),
      lastStatus: run.status,
      lastError: null,
      firstAt: run.at,
      lastAt: run.at,
    };
    row.runs++;
    row.counts[run.status]++;
    row.retries = row.counts.retry;
    row.owner = run.owner;
    row.lastStatus = run.status;
    row.lastError = run.error;
    row.lastAt = run.at;
    byJob.set(run.job, row);
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    throw e;
  }
  return digestText(night, text);
};
