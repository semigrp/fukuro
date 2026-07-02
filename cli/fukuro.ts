#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb, dbPath, type EventRow } from './db.ts';
import { deriveContext, suggestedKinds } from './derive.ts';

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
  // exploration units (spec/06): concept / hypothesis / procedure
  'concept_captured',
  'hypothesis_opened',
  'hypothesis_confirmed',
  'hypothesis_refuted',
  'procedure_defined',
  'finding',
]);

const HELP = `fukuro — telemetry for agentic loops (db: ${dbPath()})

Usage:
  fukuro init                              Create the database
  fukuro ctx [--json]                      Show the derived context (nothing is stored:
                                           position is recomputed from git + the event log)
  fukuro log-event <kind> [options]        Append one event (missing --loop/--issue/--pr
                                           are filled from the derived context)
  fukuro events [--limit N] [--loop <id>] [--profile private|public] [--json]
                                           Show recent events
  fukuro report [--days N] [--loop <id>] [--profile private|public]
                [--format text|json|md] [--out <path>]
                                           KPI summary (+ open hypotheses, stop-line breakdown)
  fukuro help

report options:
  --format <f>     text (default) / json / md — md is meant for export:
                   pipe or --out it into GitHub comments, Notion, an Obsidian vault
  --out <path>     Write the report to a file instead of stdout
  --profile <p>    private (default) shows everything. public redacts identifiers
                   and free text (loop ids, issue/PR numbers, claims, stop-line
                   names, payloads) — only counts, KPIs, and kind names remain.
                   Use public for anything leaving your machine.

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
  format: string;
  out?: string;
  profile: string;
}

interface OpenHypothesis {
  id: string;
  claim: string | null;
  loop_id: string | null;
  opened_at: string;
}

interface StopLineRow {
  line: string | null;
  n: number;
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
      format: { type: 'string', default: 'text' },
      out: { type: 'string' },
      profile: { type: 'string', default: 'private' },
    },
  });
  const cli = values as CliValues;
  if (cli.profile !== 'private' && cli.profile !== 'public') {
    console.error(`--profile must be "private" or "public", got: ${cli.profile}`);
    process.exit(1);
  }

  const command = positionals[0] ?? 'help';
  switch (command) {
    case 'init':
      return init();
    case 'ctx':
      return showCtx(cli);
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

  // Missing fields are filled from the derived context (explicit flags always win).
  // loop_start is exempt from loop derivation: an open previous loop must not be
  // mistaken for the loop being started.
  const needsDerivation =
    values.loop === undefined ||
    values.issue === undefined ||
    values.pr === undefined;
  const derived = needsDerivation ? deriveContext(db) : null;
  const loop =
    values.loop ?? (kind === 'loop_start' ? null : (derived?.loop ?? null));
  const issue = toInt('issue', values.issue) ?? derived?.issue ?? null;
  const pr = toInt('pr', values.pr) ?? derived?.pr ?? null;

  const filled: string[] = [];
  if (values.loop === undefined && loop !== null) filled.push(`loop=${loop}`);
  if (values.issue === undefined && issue !== null) filled.push(`issue=#${issue}`);
  if (values.pr === undefined && pr !== null) filled.push(`pr=#${pr}`);

  const result = db
    .prepare(
      `INSERT INTO events (session, loop_id, issue, pr, kind, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.session ?? process.env.FUKURO_SESSION ?? null,
      loop,
      issue,
      pr,
      kind,
      data,
    );
  db.close();
  const derivedNote = filled.length > 0 ? `  (derived: ${filled.join(' ')})` : '';
  console.log(`logged #${result.lastInsertRowid} ${kind}${derivedNote}`);
}

function showCtx(values: CliValues): void {
  const db = openDb();
  const context = deriveContext(db);
  db.close();
  const kinds = suggestedKinds(context);
  if (values.json) {
    console.log(JSON.stringify({ ...context, suggested_kinds: kinds }, null, 2));
    return;
  }
  console.log(`project: ${context.project ?? '-'}`);
  console.log(`branch:  ${context.branch ?? '-'}`);
  console.log(`issue:   ${context.issue !== null ? `#${context.issue}` : '-'}`);
  console.log(`pr:      ${context.pr !== null ? `#${context.pr}` : '-'}`);
  if (context.loop !== null) {
    console.log(`loop:    ${context.loop}`);
  } else if (context.openLoops.length > 1) {
    console.log(`loop:    (ambiguous — open: ${context.openLoops.join(', ')})`);
  } else {
    console.log(`loop:    -`);
  }
  console.log(`session: ${context.session ?? '-'}`);
  console.log('');
  console.log(`suggested kinds here: ${kinds.join(' ')}`);
}

function listEvents(values: CliValues): void {
  const db = openDb();
  const rows = (
    values.loop !== undefined
      ? db
          .prepare('SELECT * FROM events WHERE loop_id = ? ORDER BY id DESC LIMIT ?')
          .all(values.loop, toInt('limit', values.limit) ?? 20)
      : db
          .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
          .all(toInt('limit', values.limit) ?? 20)
  ) as unknown as EventRow[];
  db.close();
  // public profile: timestamps and kinds only — no identifiers, no payloads
  if (values.profile === 'public') {
    const redacted = rows.map((r) => ({ ts: r.ts, kind: r.kind }));
    if (values.json) {
      console.log(JSON.stringify(redacted, null, 2));
      return;
    }
    for (const r of redacted.reverse()) console.log(`${r.ts}  ${r.kind}`);
    return;
  }
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
  const loop = values.loop ?? null;
  // Slice every aggregation by loop when --loop is given.
  const loopClause = loop === null ? '' : ' AND loop_id = ?';
  const loopParams = loop === null ? [] : [loop];
  const db = openDb();

  // Open hypotheses are computed across ALL time, not the window: a claim opened
  // last month and never closed is exactly what the report must surface.
  const openedRows = db
    .prepare(
      `SELECT json_extract(data,'$.id') AS id,
              json_extract(data,'$.claim') AS claim,
              loop_id,
              MIN(ts) AS opened_at
       FROM events
       WHERE kind = 'hypothesis_opened' AND json_extract(data,'$.id') IS NOT NULL${loopClause}
       GROUP BY json_extract(data,'$.id')`,
    )
    .all(...loopParams) as unknown as OpenHypothesis[];
  const closedIds = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT json_extract(data,'$.id') AS id FROM events
           WHERE kind IN ('hypothesis_confirmed','hypothesis_refuted')
             AND json_extract(data,'$.id') IS NOT NULL${loopClause}`,
        )
        .all(...loopParams) as unknown as { id: string }[]
    ).map((row) => row.id),
  );
  const openHypotheses = openedRows.filter((row) => !closedIds.has(row.id));

  // Which stop lines fire, not just how often: the return path repairs by name.
  const stopLines = db
    .prepare(
      `SELECT json_extract(data,'$.line') AS line, COUNT(*) AS n
       FROM events
       WHERE kind = 'stop_line_hit' AND ts >= datetime('now', ?)${loopClause}
       GROUP BY line ORDER BY n DESC`,
    )
    .all(since, ...loopParams) as unknown as StopLineRow[];

  const byKind = db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM events
       WHERE ts >= datetime('now', ?)${loopClause} GROUP BY kind ORDER BY n DESC`,
    )
    .all(since, ...loopParams) as unknown as { kind: string; n: number }[];

  // Per merged PR: review rounds and open→merge lead time.
  const mergedPrs: MergedPr[] = (
    db
      .prepare(
        `SELECT pr,
                MIN(CASE WHEN kind = 'pr_opened' THEN ts END) AS opened,
                MIN(CASE WHEN kind = 'merged' THEN ts END) AS merged_ts,
                SUM(kind = 'review_round') AS review_rounds
         FROM events
         WHERE pr IS NOT NULL${loopClause}
         GROUP BY pr
         HAVING merged_ts IS NOT NULL AND merged_ts >= datetime('now', ?)`,
      )
      .all(...loopParams, since) as unknown as Omit<MergedPr, 'lead_hours'>[]
  ).map((r) => ({
    ...r,
    lead_hours:
      r.opened && r.merged_ts
        ? Math.round(((Date.parse(r.merged_ts) - Date.parse(r.opened)) / 36e5) * 10) / 10
        : null,
  }));

  const count = (kind: string): number => byKind.find((r) => r.kind === kind)?.n ?? 0;
  const merges = mergedPrs.length;
  const fullSummary = {
    window_days: days,
    loop,
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
    stop_lines: stopLines,
    human_interventions: count('human_intervention'),
    hypotheses: {
      opened_in_window: count('hypothesis_opened'),
      confirmed_in_window: count('hypothesis_confirmed'),
      refuted_in_window: count('hypothesis_refuted'),
      open_count: openHypotheses.length,
      open: openHypotheses,
    },
    prs: mergedPrs,
  };
  db.close();

  // public profile: identifiers and free text are removed *structurally* —
  // counts and KPI names are the only things that survive serialization.
  const summary: ReportSummary =
    values.profile === 'public'
      ? {
          ...fullSummary,
          loop: fullSummary.loop === null ? null : '(redacted)',
          stop_lines: [],
          hypotheses: { ...fullSummary.hypotheses, open: [] },
          prs: [],
        }
      : fullSummary;

  const format = values.json ? 'json' : values.format;
  let output: string;
  if (format === 'json') {
    output = JSON.stringify(summary, null, 2);
  } else if (format === 'md') {
    output = renderMarkdown(summary, byKind);
  } else {
    output = renderText(summary, byKind);
  }

  if (values.out !== undefined) {
    writeFileSync(values.out, output + '\n');
    console.log(`wrote ${values.out}`);
  } else {
    console.log(output);
  }
}

type ReportSummary = {
  window_days: number;
  loop: string | null;
  merged_prs: number;
  review_rounds_per_merged_pr: number | null;
  median_lead_hours: number | null;
  ticks_per_merge: number | null;
  stop_line_hits: number;
  stop_lines: StopLineRow[];
  human_interventions: number;
  hypotheses: {
    opened_in_window: number;
    confirmed_in_window: number;
    refuted_in_window: number;
    open_count: number;
    open: OpenHypothesis[];
  };
  prs: MergedPr[];
};

function renderText(summary: ReportSummary, byKind: { kind: string; n: number }[]): string {
  const lines: string[] = [];
  const scope = summary.loop === null ? '' : ` — loop ${summary.loop}`;
  lines.push(`fukuro report — last ${summary.window_days} day(s)${scope}`, '');
  lines.push('events by kind:');
  for (const r of byKind) lines.push(`  ${r.kind.padEnd(20)} ${r.n}`);
  if (byKind.length === 0) lines.push('  (no events)');
  lines.push('');
  lines.push(`merged PRs:                ${summary.merged_prs}`);
  lines.push(`review rounds / merged PR: ${summary.review_rounds_per_merged_pr ?? '-'}`);
  lines.push(`median lead time (hours):  ${summary.median_lead_hours ?? '-'}`);
  lines.push(`ticks / merge:             ${summary.ticks_per_merge ?? '-'}`);
  lines.push(`stop-line hits:            ${summary.stop_line_hits}`);
  for (const row of summary.stop_lines) {
    lines.push(`  ${row.n}× ${row.line ?? '(no line recorded)'}`);
  }
  lines.push(`human interventions:       ${summary.human_interventions}`);
  const h = summary.hypotheses;
  lines.push('');
  lines.push(
    `hypotheses (window):       opened ${h.opened_in_window} / confirmed ${h.confirmed_in_window} / refuted ${h.refuted_in_window}`,
  );
  lines.push(`open hypotheses (all):     ${h.open_count}`);
  for (const item of h.open) {
    lines.push(`  ${item.id}  ${item.claim ?? '(no claim)'}  [${item.loop_id ?? '-'}]`);
  }
  return lines.join('\n');
}

/**
 * Markdown renderer, meant for export. fukuro deliberately ships no API clients —
 * deliver this through connectors instead: `--out` into an Obsidian vault,
 * `gh issue comment --body-file`, or an agent pasting it into Notion.
 */
function renderMarkdown(summary: ReportSummary, byKind: { kind: string; n: number }[]): string {
  const h = summary.hypotheses;
  const lines: string[] = [];
  const scope = summary.loop === null ? '' : ` — loop \`${summary.loop}\``;
  lines.push(`# fukuro report — last ${summary.window_days} day(s)${scope}`, '');
  lines.push(`_generated ${new Date().toISOString()}_`, '');
  lines.push('## KPIs', '');
  lines.push('| metric | value |');
  lines.push('|---|---|');
  lines.push(`| merged PRs | ${summary.merged_prs} |`);
  lines.push(`| review rounds / merged PR | ${summary.review_rounds_per_merged_pr ?? '–'} |`);
  lines.push(`| median lead time (hours) | ${summary.median_lead_hours ?? '–'} |`);
  lines.push(`| ticks / merge | ${summary.ticks_per_merge ?? '–'} |`);
  lines.push(`| stop-line hits | ${summary.stop_line_hits} |`);
  lines.push(`| human interventions | ${summary.human_interventions} |`);
  lines.push('');
  if (summary.stop_lines.length > 0) {
    lines.push('## Stop lines hit', '');
    for (const row of summary.stop_lines) {
      lines.push(`- ${row.n}× ${row.line ?? '(no line recorded)'}`);
    }
    lines.push('');
  }
  lines.push('## Hypotheses', '');
  lines.push(
    `Window: opened ${h.opened_in_window} · confirmed ${h.confirmed_in_window} · refuted ${h.refuted_in_window}`,
    '',
  );
  if (h.open_count === 0) {
    lines.push('No open hypotheses — the exploration loop has converged. 🦉');
  } else {
    lines.push(`### Still open (${h.open_count})`, '');
    if (h.open.length === 0) {
      lines.push('_Details redacted (public profile)._');
    }
    for (const item of h.open) {
      const loop = item.loop_id ? ` — loop \`${item.loop_id}\`` : '';
      lines.push(`- **${item.id}**: ${item.claim ?? '(no claim recorded)'}${loop} _(opened ${item.opened_at.slice(0, 10)})_`);
    }
  }
  lines.push('');
  if (summary.prs.length > 0) {
    lines.push('## Merged PRs', '');
    lines.push('| PR | review rounds | lead time (h) |');
    lines.push('|---|---|---|');
    for (const pr of summary.prs) {
      lines.push(`| #${pr.pr} | ${pr.review_rounds} | ${pr.lead_hours ?? '–'} |`);
    }
    lines.push('');
  }
  lines.push('## Events by kind', '');
  lines.push('| kind | count |');
  lines.push('|---|---|');
  for (const r of byKind) lines.push(`| ${r.kind} | ${r.n} |`);
  if (byKind.length === 0) lines.push('| _(no events)_ | |');
  return lines.join('\n');
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
