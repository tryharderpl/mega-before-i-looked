import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Fixtures live in a temp dir, so the read-only runs/ folder is never touched.
let runsDir: string;
let app: ReturnType<typeof createApp>;

const line = (at: string, job: string, status: string, owner: string | null, error?: string) =>
  JSON.stringify(error === undefined ? { at, job, status, owner } : { at, job, status, owner, error });

const jsonUrl = (night: string) => `/api/digest/${night}`;
const pageUrl = (night: string) => `/digest/${night}`;

// Order of job names in the HTML table body: the first <td> of each body row.
function jobsOnPage(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*><td>([^<]+)<\/td>/g)].map((m) => m[1]!);
}

const NORMAL = '2026-11-01';
const EMPTY = '2026-11-02';
const MISSING = '2026-11-03';
const BAD = '2026-11-04';

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));

  // Out of job order on purpose: the reader must sort rows by job name.
  writeFileSync(
    join(runsDir, `${NORMAL}.jsonl`),
    [
      line('2026-11-01T01:00:00+01:00', 'zeta/report', 'ok', 'rook'),
      line('2026-11-01T01:05:00+01:00', 'alpha/sync', 'retry', 'rook', 'lock held'),
      line('2026-11-01T01:06:00+01:00', 'alpha/sync', 'ok', 'rook'),
      line('2026-11-01T02:00:00+01:00', 'mid/backup', 'fail', 'lane-07', 'quota exceeded'),
      line('2026-11-01T03:00:00+01:00', 'zeta/report', 'ok', 'rook'),
    ].join('\n') + '\n',
  );

  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');

  // The truncated line sits between good lines, so the good ones must still count.
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      line('2026-11-04T01:00:00+01:00', 'alpha/sync', 'ok', 'rook'),
      '{"at":"2026-11-04T01:30:00+01:00","job":"alpha/sy',
      line('2026-11-04T02:00:00+01:00', 'beta/index', 'fail', 'lane-07', 'disk full'),
      line('2026-11-04T03:00:00+01:00', 'alpha/sync', 'ok', 'rook'),
    ].join('\n') + '\n',
  );

  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest routes: normal night', () => {
  it('JSON: 200, rows sorted by job, counts summed', async () => {
    const res = await app.request(jsonUrl(NORMAL));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.night).toBe(NORMAL);
    expect(body.badLines).toBe(0);
    expect(body.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['alpha/sync', 'mid/backup', 'zeta/report']);
    expect(body.rows[0]).toMatchObject({ job: 'alpha/sync', owner: 'rook', runs: 2, retries: 1, lastStatus: 'ok' });
    expect(body.rows[1]).toMatchObject({ job: 'mid/backup', runs: 1, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(body.rows[2]).toMatchObject({ job: 'zeta/report', runs: 2, retries: 0, lastStatus: 'ok' });
  });

  it('page: 200, shows the night and every job', async () => {
    const res = await app.request(pageUrl(NORMAL));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`digest ${NORMAL}`);
    for (const job of ['alpha/sync', 'mid/backup', 'zeta/report']) expect(html).toContain(job);
  });

  it('page and JSON list the same jobs in the same order', async () => {
    const body = await (await app.request(jsonUrl(NORMAL))).json();
    const html = await (await app.request(pageUrl(NORMAL))).text();
    expect(jobsOnPage(html)).toEqual(body.rows.map((r: { job: string }) => r.job));
  });
});

describe('digest routes: night with no file', () => {
  it('JSON: 404 with the error body', async () => {
    const res = await app.request(jsonUrl(MISSING));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });

  it('page: 404 with the no-log message', async () => {
    const res = await app.request(pageUrl(MISSING));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no run log for ${MISSING}`);
  });
});

describe('digest routes: empty night (file with zero bytes)', () => {
  it('JSON: 200 with zero rows and zero counts', async () => {
    const res = await app.request(jsonUrl(EMPTY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('page: 200 and says nothing ran', async () => {
    const res = await app.request(pageUrl(EMPTY));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(jobsOnPage(html)).toEqual([]);
  });
});

describe('digest routes: night with one bad line', () => {
  it('JSON: 200, badLines 1, good lines still counted', async () => {
    const res = await app.request(jsonUrl(BAD));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badLines).toBe(1);
    expect(body.counts).toEqual({ ok: 2, retry: 0, fail: 1 });
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['alpha/sync', 'beta/index']);
    expect(body.rows[0]).toMatchObject({ job: 'alpha/sync', runs: 2, lastStatus: 'ok' });
    expect(body.rows[1]).toMatchObject({ job: 'beta/index', runs: 1, lastStatus: 'fail', lastError: 'disk full' });
  });

  it('page: 200, shows the bad-line count and the good rows', async () => {
    const res = await app.request(pageUrl(BAD));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('1 line could not be read');
    expect(jobsOnPage(html)).toEqual(['alpha/sync', 'beta/index']);
  });
});
