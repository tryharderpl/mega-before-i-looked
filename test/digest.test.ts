import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLine, readNight } from '../src/digest/read.js';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('gives 5 jobs sorted by job, and 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.badLines).toBe(1);
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('folds runs, retries, last status and error per job', () => {
    const rows = Object.fromEntries(night!.rows.map((r) => [r.job, r]));
    expect(rows['fixtures/refresh']).toMatchObject({
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(rows['lane/sync']).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', firstAt: '2026-10-28T23:00:06+01:00' });
    expect(rows['notes/backup']).toMatchObject({ owner: 'lane-07', runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(rows['digest/render']).toMatchObject({ owner: null, runs: 1, lastStatus: 'ok' });
  });

  it('keeps ok / retry / fail counts per row and per night', () => {
    for (const r of night!.rows) expect(r.counts.ok + r.counts.retry + r.counts.fail).toBe(r.runs);
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight edge cases', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null for a night with no file, a bad night name, or a missing dir', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
    expect(readNight(dir, '../etc/passwd')).toBeNull();
    expect(readNight(join(dir, 'nope'), '2026-01-01')).toBeNull();
  });

  it('returns an empty night for an empty file', () => {
    writeFileSync(join(dir, '2026-01-02.jsonl'), '');
    expect(readNight(dir, '2026-01-02')).toEqual({
      night: '2026-01-02',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps a row whose owner is null, and counts bad lines without throwing', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":null}',
      '',
      'not json',
      '{"at":"2026-01-03T01:00:00+01:00","job":"b","status":"maybe","owner":"x"}',
      '{"at":"2026-01-03T01:00:00+01:00","status":"ok","owner":"x"}',
      '[1,2]',
    ];
    writeFileSync(join(dir, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    const night = readNight(dir, '2026-01-03')!;
    expect(night.badLines).toBe(4);
    expect(night.rows).toHaveLength(1);
    expect(night.rows[0]).toMatchObject({ job: 'a', owner: null, runs: 1 });
  });
});

describe('parseLine', () => {
  it('rejects a missing owner key but accepts owner null', () => {
    expect(parseLine('{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok"}')).toBeNull();
    expect(parseLine('{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":null}')).not.toBeNull();
  });
});
