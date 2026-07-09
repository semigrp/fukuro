import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
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
  const run = (...args: string[]): string => runEnv({}, ...args);
  const runEnv = (extraEnv: Record<string, string>, ...args: string[]): string =>
    execFileSync(process.execPath, [bin, ...args], {
      cwd: dir, // not a git repo: derivation yields no project/issue/pr
      // Session vars blanked so runs are hermetic even inside an agent harness.
      env: {
        ...process.env,
        FUKURO_DB: dbFile,
        FUKURO_SESSION: '',
        CLAUDE_CODE_SESSION_ID: '',
        ...extraEnv,
      },
    }).toString();
  const db = () => {
    const handle = new DatabaseSync(dbFile);
    return handle;
  };
  return { dir, dbFile, run, runEnv, db };
};

test('session derives: FUKURO_SESSION wins, harness id fills in, empty means unset', () => {
  const cli = makeCli();
  cli.runEnv({ FUKURO_SESSION: 'explicit' , CLAUDE_CODE_SESSION_ID: 'harness-1' }, 'log-event', 'tick');
  cli.runEnv({ CLAUDE_CODE_SESSION_ID: 'harness-1' }, 'log-event', 'tick');
  cli.runEnv({}, 'log-event', 'tick');
  const rows = cli
    .db()
    .prepare('SELECT session FROM events ORDER BY id')
    .all() as { session: string | null }[];
  assert.deepEqual(rows.map((r) => r.session), ['explicit', 'harness-1', null]);
});

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

test('an explicit foreign --loop opts out of issue/pr autofill', () => {
  const cli = makeCli();
  // make the cwd a git repo on an issue branch so derivation has issue/pr context
  const git = (args: string) =>
    execSync(`git -c user.email=t@example.com -c user.name=t ${args}`, {
      cwd: cli.dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  git('init -q');
  git('commit --allow-empty -q -m init');
  git('checkout -q -b 7-feature');
  cli.run('log-event', 'loop_start', '--loop', 'A');
  cli.run('log-event', 'pr_opened', '--loop', 'A', '--issue', '7', '--pr', '9');

  // positive control: without flags, the derived context attaches fully
  cli.run('log-event', 'tick');
  const inherited = cli
    .db()
    .prepare("SELECT loop_id, issue, pr FROM events WHERE kind = 'tick' ORDER BY id DESC LIMIT 1")
    .get() as { loop_id: string; issue: number | null; pr: number | null };
  assert.deepEqual({ ...inherited }, { loop_id: 'A', issue: 7, pr: 9 });

  // logging against a different loop must not graft A's issue/pr onto it
  cli.run('log-event', 'tick', '--loop', 'B');
  const foreign = cli
    .db()
    .prepare("SELECT loop_id, issue, pr FROM events WHERE kind = 'tick' ORDER BY id DESC LIMIT 1")
    .get() as { loop_id: string; issue: number | null; pr: number | null };
  assert.deepEqual({ ...foreign }, { loop_id: 'B', issue: null, pr: null });
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

type Coverage = {
  session: number | null;
  loop_id: number | null;
  pr_scoped_pr: number | null;
  issue_scoped_issue: number | null;
};
type CoverageSummary = { unattributed_ticks: number; attribution_coverage: Coverage };

test('report: coverage ratios and warning when most ticks lack pr', () => {
  const cli = makeCli();
  const db = new DatabaseSync(cli.dbFile);
  db.exec(schema);
  const insert = db.prepare(
    'INSERT INTO events (session, loop_id, issue, pr, kind, data) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insert.run('s1', 'L', 7, null, 'loop_start', null);
  insert.run('s1', 'L', null, 9, 'tick', null);
  insert.run(null, null, null, null, 'tick', null);
  insert.run(null, 'L', null, null, 'tick', null);
  insert.run('s1', 'L', 7, 9, 'merged', null);
  db.close();

  const summary = JSON.parse(cli.run('report', '--format', 'json')) as CoverageSummary;
  assert.equal(summary.unattributed_ticks, 2);
  assert.deepEqual(summary.attribution_coverage, {
    session: 0.6, // 3 of 5 events
    loop_id: 0.8, // 4 of 5 events
    pr_scoped_pr: 0.5, // 3 ticks + merged, pr on 2
    issue_scoped_issue: 1, // loop_start carries issue
  });
  const text = cli.run('report');
  assert.ok(text.includes('warn: 2 of 3 ticks in this window have no pr'));
  assert.ok(text.includes('attribution coverage:'));
  assert.ok(cli.run('report', '--format', 'md').includes('## Attribution coverage'));
});

test('report: fully attributed window has full coverage and no warning', () => {
  const cli = makeCli();
  cli.runEnv({ FUKURO_SESSION: 's' }, 'log-event', 'loop_start', '--loop', 'L', '--issue', '1');
  cli.runEnv({ FUKURO_SESSION: 's' }, 'log-event', 'tick', '--loop', 'L', '--pr', '2');
  const summary = JSON.parse(cli.run('report', '--format', 'json')) as CoverageSummary;
  assert.equal(summary.unattributed_ticks, 0);
  assert.deepEqual(summary.attribution_coverage, {
    session: 1,
    loop_id: 1,
    pr_scoped_pr: 1,
    issue_scoped_issue: 1,
  });
  assert.ok(!cli.run('report').includes('warn:'));
});

test('report: coverage is null when there are no relevant events', () => {
  const cli = makeCli();
  cli.run('init');
  const summary = JSON.parse(cli.run('report', '--format', 'json')) as CoverageSummary;
  assert.equal(summary.unattributed_ticks, 0);
  assert.deepEqual(summary.attribution_coverage, {
    session: null,
    loop_id: null,
    pr_scoped_pr: null,
    issue_scoped_issue: null,
  });
});

test('report: public profile keeps coverage aggregates', () => {
  const cli = makeCli();
  seedMergedPr(cli.dbFile);
  const summary = JSON.parse(
    cli.run('report', '--format', 'json', '--profile', 'public'),
  ) as CoverageSummary;
  assert.equal(typeof summary.unattributed_ticks, 'number');
  assert.equal(typeof summary.attribution_coverage.session, 'number');
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

test('--help / -h print help; unknown flags fail with one line, not a stack trace', () => {
  const cli = makeCli();
  assert.ok(cli.run('--help').includes('fukuro — telemetry for agentic loops'));
  assert.ok(cli.run('-h').includes('Usage:'));
  try {
    cli.run('--no-such-flag');
    assert.fail('expected a non-zero exit for an unknown flag');
  } catch (error) {
    const e = error as { status?: number; stderr?: Buffer };
    assert.equal(e.status, 2);
    const stderr = e.stderr?.toString() ?? '';
    assert.ok(stderr.startsWith('fukuro:'), `stderr should be a friendly one-liner, got: ${stderr}`);
    assert.ok(!/\n\s+at /.test(stderr), 'stderr must not contain a stack trace');
  }
});
