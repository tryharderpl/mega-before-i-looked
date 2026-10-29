// Plan morning-digest § 1: the run log reader's public shape. Section 2 (page, JSON, board
// link, route tests) builds against this file only. The implementation lives in ./read.ts.

/** Status of one run, as written in `runs/<night>.jsonl`. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** How many lines had each status. Per row, and summed over the night. */
export type StatusCounts = { ok: number; retry: number; fail: number };

/** One job's night, folded from all of its lines in the log. */
export type DigestRow = {
  job: string;
  /** Owner from the job's latest line. `null` stays `null` here; views show it as `—`. */
  owner: string | null;
  /** Number of lines for this job. */
  runs: number;
  /** Number of lines with status `retry` (same as `counts.retry`). */
  retries: number;
  /** Lines per status for this job; `ok + retry + fail === runs`. */
  counts: StatusCounts;
  /** Status of the job's latest line. */
  lastStatus: RunStatus;
  /** `error` of the job's latest line, `null` when that line has none (views show `—`). */
  lastError: string | null;
  /** `at` of the job's first line, verbatim from the log (offset kept, never converted). */
  firstAt: string;
  /** `at` of the job's latest line, verbatim from the log. */
  lastAt: string;
};

/** A night that has a file on disk. An empty file gives `rows: []` ("nothing ran"). */
export type DigestNight = {
  night: string;
  /** One row per job, sorted by job name. */
  rows: DigestRow[];
  /** Non-blank lines that were not valid JSON, missed a required field, or had an unknown status. */
  badLines: number;
  /** All good lines of the night by status (ok / retry / fail counts for the board). */
  counts: StatusCounts;
};

/**
 * Reads `<runsDir>/<night>.jsonl`.
 *
 * - Returns `null` when there is no file for that night, or when `night` is not `YYYY-MM-DD`
 *   (§ 2a answers 404 for both). An existing empty file returns a night with `rows: []`.
 * - Never throws on a bad line: it is counted in `badLines` and skipped. Blank lines are ignored.
 * - "Latest" and "first" follow line order in the file (the log is append-only).
 * - A missing `runsDir` also gives `null`. Other read errors (e.g. permissions) are thrown.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
