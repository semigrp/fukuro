#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openDb, dbPath, type EventRow } from './db.ts';

// Canonical kinds. Unknown kinds are accepted (extensible) but warned about,
// so typos surface without blocking a running loop.
const CANONICAL_KINDS = new Set([
  'loop_start',
  'tick',
  'pr_opened',
  'review_round',
  'stop_line_hit',
  'human_intervention',
  'merged',
  'issue_closed',
  'loop_end',
  'improve_applied',
  'improve_reverted',
  'tokens',
]);

const HELP = `fukuro — telemetry for agentic loops (db: ${dbPath()})

Usage:
  fukuro init                              Create the database
  fukuro log-event <kind> [options]        Append one event
  fukuro events [--limit N] [--json]       Show recent events
  fukuro report [--days N] [--json]        KPI summary
  fukuro help

log-event options:
  --loop <id>      Logical loop name (e.g. parent issue slug)
  --issue <n>      Issue number
  --pr <n>         Pull request number
  --session <id>   Session id (default: $FUKURO_SESSION)
  --data <json>    JSON payload

Canonical kinds:
  ${[...CANONICAL_KINDS].join(' ')}
`;

interface CliValues {
  loop?: string;
  issue?: string;
  pr?: string;
  session?: string;
  data?: string;
  days: string;
  limit: string;
  json: boolean;
}

interface MergedPr {
  pr: number;
  opened: string | null;
  merged_ts: string;
  review_rounds: number;
  lead_hours: number | null;
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      loop: { type: 'string' },
      issue: { type: 'string' },
      pr: { type: 'string' },
      session: { type: 'string' },
      data: { type: 'string' },
      days: { type: 'string', default: '7' },
      limit: { type: 'string', default: '20' },
      json: { type: 'boolean', default: false },
    },
  });
  const cli = values as CliValues;

  const command = positionals[0] ?? 'help';
  switch (command) {
    case 'init':
      return init();
    case 'log-event':
    case 'log':
      return logEvent(positionals[1], cli);
    case 'events':
      return listEvents(cli);
    case 'report':
      return report(cli);
    case 'help':
      console.log(HELP);
      return;
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

function init(): void {
  openDb().close();
  console.log(`initialized ${dbPath()}`);
}

function toInt(name: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) {
    console.error(`--${name} must be an integer, got: ${value}`);
    process.exit(1);
  }
  return n;
}

function logEvent(kind: string | undefined, values: CliValues): void {
  if (!kind) {
    console.error('log-event requires a <kind> argument');
    process.exit(1);
  }
  if (!CANONICAL_KINDS.has(kind)) {
    console.warn(`warning: "${kind}" is not a canonical kind (accepted anyway)`);
  }
  let data: string | null = null;
  if (values.data !== undefined) {
    try {
      data = JSON.stringify(JSON.parse(values.data));
    } catch {
      console.error(`--data is not valid JSON: ${values.data}`);
      process.exit(1);
    }
  }
  const db = openDb();
  const result = db
    .prepare(
      `INSERT INTO events (session, loop_id, issue, pr, kind, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.session ?? process.env.FUKURO_SESSION ?? null,
      values.loop ?? null,
      toInt('issue', values.issue),
      toInt('pr', values.pr),
      kind,
      data,
    );
  db.close();
  console.log(`logged #${result.lastInsertRowid} ${kind}`);
}

function listEvents(values: CliValues): void {
  const db = openDb();
  const rows = db
    .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
    .all(toInt('limit', values.limit) ?? 20) as unknown as EventRow[];
  db.close();
  if (values.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows.reverse()) {
    const scope = [
      r.loop_id && `loop=${r.loop_id}`,
      r.issue != null && `issue=#${r.issue}`,
      r.pr != null && `pr=#${r.pr}`,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`${r.ts}  ${r.kind.padEnd(18)} ${scope}${r.data ? '  ' + r.data : ''}`);
  }
}

function report(values: CliValues): void {
  const days = toInt('days', values.days) ?? 7;
  const since = `-${days} days`;
  const db = openDb();

  const byKind = db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM events
       WHERE ts >= datetime('now', ?) GROUP BY kind ORDER BY n DESC`,
    )
    .all(since) as unknown as { kind: string; n: number }[];

  // Per merged PR: review rounds and open→merge lead time.
  const mergedPrs: MergedPr[] = (
    db
      .prepare(
        `SELECT pr,
                MIN(CASE WHEN kind = 'pr_opened' THEN ts END) AS opened,
                MIN(CASE WHEN kind = 'merged' THEN ts END) AS merged_ts,
                SUM(kind = 'review_round') AS review_rounds
         FROM events
         WHERE pr IS NOT NULL
         GROUP BY pr
         HAVING merged_ts IS NOT NULL AND merged_ts >= datetime('now', ?)`,
      )
      .all(since) as unknown as Omit<MergedPr, 'lead_hours'>[]
  ).map((r) => ({
    ...r,
    lead_hours:
      r.opened && r.merged_ts
        ? Math.round(((Date.parse(r.merged_ts) - Date.parse(r.opened)) / 36e5) * 10) / 10
        : null,
  }));

  const count = (kind: string): number => byKind.find((r) => r.kind === kind)?.n ?? 0;
  const merges = mergedPrs.length;
  const summary = {
    window_days: days,
    events_by_kind: Object.fromEntries(byKind.map((r) => [r.kind, r.n])),
    merged_prs: merges,
    review_rounds_per_merged_pr: merges
      ? Math.round((mergedPrs.reduce((a, r) => a + r.review_rounds, 0) / merges) * 100) / 100
      : null,
    median_lead_hours: median(
      mergedPrs.map((r) => r.lead_hours).filter((v): v is number => v != null),
    ),
    ticks_per_merge: merges ? Math.round((count('tick') / merges) * 100) / 100 : null,
    stop_line_hits: count('stop_line_hit'),
    human_interventions: count('human_intervention'),
    prs: mergedPrs,
  };
  db.close();

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`fukuro report — last ${days} day(s)\n`);
  console.log('events by kind:');
  for (const r of byKind) console.log(`  ${r.kind.padEnd(20)} ${r.n}`);
  if (byKind.length === 0) console.log('  (no events)');
  console.log('');
  console.log(`merged PRs:                ${summary.merged_prs}`);
  console.log(`review rounds / merged PR: ${summary.review_rounds_per_merged_pr ?? '-'}`);
  console.log(`median lead time (hours):  ${summary.median_lead_hours ?? '-'}`);
  console.log(`ticks / merge:             ${summary.ticks_per_merge ?? '-'}`);
  console.log(`stop-line hits:            ${summary.stop_line_hits}`);
  console.log(`human interventions:       ${summary.human_interventions}`);
}

function median(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

main();
