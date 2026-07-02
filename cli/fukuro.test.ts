import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, 'fukuro.ts');
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');

/** Runs the real CLI as a subprocess against an isolated DB and cwd. */
const makeCli = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fukuro-cli-'));
  const dbFile = join(dir, 'test.db');
  const run = (...args: string[]): string =>
    execFileSync(process.execPath, [bin, ...args], {
      cwd: dir, // not a git repo: derivation yields no project/issue/pr
      env: { ...process.env, FUKURO_DB: dbFile, FUKURO_SESSION: '' },
    }).toString();
  const db = () => {
    const handle = new DatabaseSync(dbFile);
    return handle;
  };
  return { dir, dbFile, run, db };
};

test('init creates the database file', () => {
  const cli = makeCli();
  cli.run('init');
  assert.ok(existsSync(cli.dbFile));
});

test('sugar flags merge into --data and win on key conflicts', () => {
  const cli = makeCli();
  cli.run(
    'log-event',
    'hypothesis_opened',
    '--id',
    'H-1',
    '--claim',
    'claim wins',
    '--closes-when',
    'audit done',
    '--data',
    '{"note":"kept","claim":"overridden"}',
  );
  const row = cli
    .db()
    .prepare('SELECT data FROM events ORDER BY id DESC LIMIT 1')
    .get() as { data: string };
  const data = JSON.parse(row.data) as Record<string, unknown>;
  assert.equal(data.id, 'H-1');
  assert.equal(data.claim, 'claim wins');
  assert.equal(data.closes_when, 'audit done');
  assert.equal(data.note, 'kept');
});

test('a single open loop is auto-filled; loop_start is exempt', () => {
  const cli = makeCli();
  cli.run('log-event', 'loop_start', '--loop', 'L1');
  cli.run('log-event', 'tick');
  const tick = cli
    .db()
    .prepare("SELECT loop_id FROM events WHERE kind = 'tick'")
    .get() as { loop_id: string | null };
  assert.equal(tick.loop_id, 'L1');

  // starting a new loop must not inherit the previously open one
  cli.run('log-event', 'loop_start');
  const start = cli
    .db()
    .prepare("SELECT loop_id FROM events WHERE kind = 'loop_start' ORDER BY id DESC LIMIT 1")
    .get() as { loop_id: string | null };
  assert.equal(start.loop_id, null);
});

/** Seeds a merged-PR lifecycle with controlled timestamps for KPI assertions. */
const seedMergedPr = (dbFile: string): void => {
  const db = new DatabaseSync(dbFile);
  db.exec(schema);
  const insert = db.prepare(
    'INSERT INTO events (ts, loop_id, issue, pr, kind, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const at = (minutesAgo: number): string =>
    new Date(Date.now() - minutesAgo * 60_000).toISOString();
  insert.run(at(300), 'demo-loop', null, null, 'loop_start', null);
  insert.run(at(240), 'demo-loop', 7, 9, 'pr_opened', null);
  insert.run(at(200), 'demo-loop', null, 9, 'tick', null);
  insert.run(at(180), 'demo-loop', null, 9, 'review_round', null);
  insert.run(at(150), 'demo-loop', null, 9, 'tick', null);
  insert.run(at(140), 'demo-loop', null, 9, 'review_round', null);
  insert.run(at(120), 'demo-loop', 7, 9, 'merged', null);
  insert.run(at(100), 'demo-loop', null, null, 'tick', null); // loop-level tick
  insert.run(
    at(90),
    'demo-loop',
    null,
    null,
    'stop_line_hit',
    JSON.stringify({ line: 'SECRET-LINE' }),
  );
  insert.run(
    at(80),
    'demo-loop',
    null,
    null,
    'hypothesis_opened',
    JSON.stringify({ id: 'H-9', claim: 'SECRET-CLAIM' }),
  );
  db.close();
};

test('report aggregates KPIs: rounds, lead time, per-PR ticks, window ticks', () => {
  const cli = makeCli();
  seedMergedPr(cli.dbFile);
  const summary = JSON.parse(cli.run('report', '--days', '7', '--format', 'json')) as {
    merged_prs: number;
    review_rounds_per_merged_pr: number;
    median_lead_hours: number;
    ticks_per_merged_pr_median: number;
    window_ticks: number;
    hypotheses: { open_count: number };
    prs: { pr: number; ticks: number }[];
  };
  assert.equal(summary.merged_prs, 1);
  assert.equal(summary.review_rounds_per_merged_pr, 2);
  assert.equal(summary.median_lead_hours, 2); // opened −240min → merged −120min
  assert.equal(summary.ticks_per_merged_pr_median, 2);
  assert.equal(summary.window_ticks, 3); // 2 attributed + 1 loop-level
  assert.equal(summary.prs[0]?.ticks, 2);
  assert.equal(summary.hypotheses.open_count, 1);
});

test('--profile public leaks no identifiers or free text in any format', () => {
  const cli = makeCli();
  seedMergedPr(cli.dbFile);
  const outputs = [
    cli.run('report', '--days', '7', '--format', 'json', '--profile', 'public'),
    cli.run('report', '--days', '7', '--format', 'md', '--profile', 'public'),
    cli.run('events', '--limit', '30', '--profile', 'public'),
  ].join('\n');
  assert.ok(!outputs.includes('SECRET'), 'free text must be redacted');
  assert.ok(!outputs.includes('demo-loop'), 'loop ids must be redacted');
  assert.ok(!/#9\b/.test(outputs), 'PR numbers must be redacted');
  // counts survive redaction
  const summary = JSON.parse(
    cli.run('report', '--days', '7', '--format', 'json', '--profile', 'public'),
  ) as { merged_prs: number; hypotheses: { open_count: number; open: unknown[] } };
  assert.equal(summary.merged_prs, 1);
  assert.equal(summary.hypotheses.open_count, 1);
  assert.equal(summary.hypotheses.open.length, 0);
});

test('events --loop filters to one loop', () => {
  const cli = makeCli();
  cli.run('log-event', 'loop_start', '--loop', 'A');
  cli.run('log-event', 'loop_end', '--loop', 'A');
  cli.run('log-event', 'loop_start', '--loop', 'B');
  const output = cli.run('events', '--loop', 'A', '--json');
  const rows = JSON.parse(output) as { loop_id: string }[];
  assert.ok(rows.length === 2 && rows.every((row) => row.loop_id === 'A'));
});
