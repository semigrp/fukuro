#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb, dbPath, type EventRow } from './db.ts';
import { deriveContext, deriveSession, suggestedKinds } from './derive.ts';

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
  // Exploration units (ADR 0007): concept / hypothesis / procedure.
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
  fukuro lint [--json]                     Check the whole event log for lifecycle anomalies
                                           (orphan closes, unbalanced loops, ambiguous ids);
                                           exits 1 when anything warn-level is found
  fukuro import [--file <path>]            Ingest fukuro.telemetry-event/v1 NDJSON (stdin by
                                           default) from an external producer. Events keep the
                                           source-stamped occurredAt as ts, derive loop_id as
                                           <source>:<subject.id>, and are idempotent on
                                           (source, sourceEventId) — re-imports skip. The
                                           contract lives in contracts/telemetry-event.v1
  fukuro help

Ontology (opt-in):
  $FUKURO_ONTOLOGY  Path to a markdown entity directory (loop/, hypothesis/, stop-line/;
                    one <slug>.md per entity). When set, lint and log-event warn about
                    references to entities that don't exist. Unset: no checks, no change.

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
  --pr <n|none>    Pull request number. "none" acknowledges a deliberately
                   unattributed event (recorded as data.attribution=explicit_none)
  --session <id>   Session id (default: $FUKURO_SESSION, else a harness session id)
  --data <json>    JSON payload
  --id <id>        Sugar for data.id (unit id, e.g. H-1)
  --claim <text>   Sugar for data.claim (hypothesis claim)
  --evidence <t>   Sugar for data.evidence (closing evidence)
  --closes-when <t> Sugar for data.closes_when (closing condition)
                   Sugar flags merge into --data and win on key conflicts
  --at <ts>        Record the event at a historical instant (ISO 8601 or unix
                   epoch seconds/ms; future instants are refused). Unless the
                   payload already declares an amendment (backfill, supersedes
                   or re_record), data.backfill=true is added automatically so
                   ledger and lint treat the row as a declared correction

Canonical kinds:
  ${[...CANONICAL_KINDS].join(' ')}
`;

interface CliValues {
  loop?: string;
  issue?: string;
  pr?: string;
  session?: string;
  data?: string;
  id?: string;
  claim?: string;
  evidence?: string;
  'closes-when'?: string;
  at?: string;
  file?: string;
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
  ticks: number;
}

function main(): void {
  const argv = process.argv.slice(2);
  // Conventional help flags, handled before parseArgs (strict mode would
  // otherwise throw ERR_PARSE_ARGS_UNKNOWN_OPTION with a raw stack trace).
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const parseArgsConfig = {
    args: argv,
    allowPositionals: true,
    options: {
      loop: { type: 'string' },
      issue: { type: 'string' },
      pr: { type: 'string' },
      session: { type: 'string' },
      data: { type: 'string' },
      id: { type: 'string' },
      claim: { type: 'string' },
      evidence: { type: 'string' },
      'closes-when': { type: 'string' },
      at: { type: 'string' },
      file: { type: 'string' },
      days: { type: 'string', default: '7' },
      limit: { type: 'string', default: '20' },
      json: { type: 'boolean', default: false },
      format: { type: 'string', default: 'text' },
      out: { type: 'string' },
      profile: { type: 'string', default: 'private' },
    },
  } as const;
  let parsed: ReturnType<typeof parseArgs<typeof parseArgsConfig>>;
  try {
    parsed = parseArgs(parseArgsConfig);
  } catch (error) {
    // Unknown flags etc.: fail with one friendly line, not a stack trace.
    console.error(`fukuro: ${error instanceof Error ? error.message : String(error)} (run: fukuro help)`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
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
    case 'import':
      return importEvents(cli);
    case 'report':
      return report(cli);
    case 'lint':
      return lint(cli);
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

/**
 * Ingests fukuro.telemetry-event/v1 NDJSON from an external producer (#39).
 * The receiver owns the contract (contracts/telemetry-event.v1.schema.json);
 * producers vendor snapshots and export deterministically, so import must be
 * idempotent: (source, sourceEventId) is the identity, re-imports skip.
 * occurredAt is source-stamped history and becomes ts directly — this is a
 * first recording, not a correction, so no amendment marker is added. Each
 * producer subject becomes its own loop (`<source>:<subject.id>`), which
 * makes a producer run's loop_start/tick/loop_end pair in ledgers and KPIs
 * like any native loop. Refs are not stored: the producer keeps its own log,
 * fukuro only needs the analysis columns (github issue/pull refs with a
 * numeric tail fill issue/pr).
 */
function importEvents(values: CliValues): void {
  let raw: string;
  try {
    raw = readFileSync(values.file !== undefined ? values.file : 0, 'utf8');
  } catch (error) {
    console.error(
      `import: cannot read ${values.file ?? 'stdin'}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const db = openDb();
  const exists = db.prepare(
    `SELECT 1 FROM events
     WHERE json_extract(data,'$.source') = ? AND json_extract(data,'$.sourceEventId') = ?
     LIMIT 1`,
  );
  const insert = db.prepare(
    `INSERT INTO events (ts, session, loop_id, issue, pr, kind, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const session = values.session ?? deriveSession();
  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  for (const line of lines) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      rejected += 1;
      continue;
    }
    const e = ev as Record<string, unknown>;
    const valid =
      typeof ev === 'object' &&
      ev !== null &&
      e.schema === 'fukuro.telemetry-event/v1' &&
      typeof e.source === 'string' &&
      e.source.length > 0 &&
      typeof e.sourceEventId === 'string' &&
      e.sourceEventId.length > 0 &&
      typeof e.kind === 'string' &&
      e.kind.length > 0 &&
      typeof e.occurredAt === 'string';
    const at = valid ? normalizeAt(e.occurredAt as string) : null;
    if (!valid || at === null || Date.parse(at) > Date.now()) {
      rejected += 1;
      continue;
    }
    if (exists.get(e.source as string, e.sourceEventId as string) !== undefined) {
      skipped += 1;
      continue;
    }
    const subject = e.subject as Record<string, unknown> | undefined;
    const subjectId = typeof subject?.id === 'string' ? subject.id : null;
    const loop = subjectId !== null ? `${e.source}:${subjectId}` : null;
    let issue: number | null = null;
    let pr: number | null = null;
    for (const ref of Array.isArray(e.refs) ? (e.refs as Record<string, unknown>[]) : []) {
      if (ref?.system !== 'github' || typeof ref.id !== 'string') continue;
      const tail = ref.id.match(/#(\d+)$/);
      if (tail === null) continue;
      if (ref.type === 'issue' && issue === null) issue = Number(tail[1]);
      if ((ref.type === 'pull_request' || ref.type === 'pr') && pr === null) pr = Number(tail[1]);
    }
    const payload =
      typeof e.data === 'object' && e.data !== null && !Array.isArray(e.data)
        ? (e.data as Record<string, unknown>)
        : {};
    const data = JSON.stringify({
      ...payload,
      source: e.source,
      sourceEventId: e.sourceEventId,
      ...(subject !== undefined ? { subject } : {}),
    });
    insert.run(at, session, loop, issue, pr, e.kind as string, data);
    imported += 1;
  }
  db.close();
  console.log(`import: ${imported} imported, ${skipped} skipped (already present), ${rejected} rejected`);
  if (rejected > 0) process.exitCode = 1;
}

/**
 * Parses --at into the schema's canonical UTC format (`YYYY-MM-DDTHH:MM:SS.sssZ`,
 * the shape strftime('%Y-%m-%dT%H:%M:%fZ') writes). Accepts ISO 8601 (date or
 * datetime, any offset) and unix epoch in seconds or milliseconds. Returns null
 * when the input is not a recognizable instant.
 */
function normalizeAt(input: string): string | null {
  const trimmed = input.trim();
  let ms: number;
  if (/^\d{10}$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else if (/^\d{13}$/.test(trimmed)) ms = Number(trimmed);
  else {
    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) return null;
    ms = parsed;
  }
  return new Date(ms).toISOString();
}

function logEvent(kind: string | undefined, values: CliValues): void {
  if (!kind) {
    console.error('log-event requires a <kind> argument');
    process.exit(1);
  }
  // --at: fix history by *declared* amendment, never by editing rows (#32).
  // The instant must be in the past — --at documents what already happened,
  // it does not schedule. The amendment marker (added below, after the data
  // payload is assembled) keeps backfilled rows self-declaring, so ledger and
  // lint pair them by event time instead of insertion order.
  let at: string | null = null;
  if (values.at !== undefined) {
    at = normalizeAt(values.at);
    if (at === null) {
      console.error(
        `--at is not a recognizable instant: ${values.at} (ISO 8601 or unix epoch seconds/ms)`,
      );
      process.exit(1);
    }
    if (Date.parse(at) > Date.now()) {
      console.error(`--at must be in the past (got ${at}) — backfills document history, not plans`);
      process.exit(1);
    }
  }
  if (!CANONICAL_KINDS.has(kind)) {
    console.warn(`warning: "${kind}" is not a canonical kind (accepted anyway)`);
  }
  let parsed: unknown;
  if (values.data !== undefined) {
    try {
      parsed = JSON.parse(values.data);
    } catch {
      console.error(`--data is not valid JSON: ${values.data}`);
      process.exit(1);
    }
  }
  // Sugar flags merge into the payload (and win on key conflicts) so that
  // quote-fragile hand-written JSON is never required for the common unit fields.
  const sugar: Record<string, unknown> = {};
  if (values.id !== undefined) sugar.id = values.id;
  if (values.claim !== undefined) sugar.claim = values.claim;
  if (values.evidence !== undefined) sugar.evidence = values.evidence;
  if (values['closes-when'] !== undefined) sugar.closes_when = values['closes-when'];
  // `--pr none` is an explicit acknowledgment, not silence. It must live on the
  // event itself, and the pr column (INTEGER) cannot carry the sentinel.
  if (values.pr === 'none') sugar.attribution = 'explicit_none';
  let data: string | null = null;
  if (Object.keys(sugar).length > 0) {
    if (
      parsed !== undefined &&
      (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    ) {
      console.error('--data must be a JSON object when combined with sugar flags');
      process.exit(1);
    }
    data = JSON.stringify({ ...((parsed as Record<string, unknown>) ?? {}), ...sugar });
  } else if (parsed !== undefined) {
    data = JSON.stringify(parsed);
  }
  // A historical write must be self-declaring: unless the payload already
  // carries an amendment key (backfill / supersedes / re_record), mark it.
  if (at !== null) {
    const obj: unknown = data !== null ? JSON.parse(data) : {};
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      console.error('--data must be a JSON object when combined with --at');
      process.exit(1);
    }
    const payload = obj as Record<string, unknown>;
    if (
      payload.backfill === undefined &&
      payload.supersedes === undefined &&
      payload.re_record === undefined
    ) {
      payload.backfill = true;
      console.error('note: --at auto-marked data.backfill=true (declared amendment)');
    }
    data = JSON.stringify(payload);
  }
  const db = openDb();

  // Missing fields are filled from the derived context (explicit flags always win),
  // with coherence guards against cross-context misattribution — autofilled
  // fields must all come from one coherent derived context:
  // - loop_start never autofills: an open previous loop (or the branch's issue/pr)
  //   must not be grafted onto the loop being started.
  // - an explicit --loop that differs from the derived loop opts out of issue/pr
  //   autofill too — those fields belong to the derived loop's context, not this one.
  // - an explicit --issue that differs from the branch-derived issue blocks pr
  //   autofill (the derived pr belongs to the branch's issue, not the stated one),
  //   and an explicit --pr that differs from the derived pr blocks issue autofill.
  //   Scar: one multi-PR day produced six events (issue closes, a finding) stamped
  //   with a foreign branch's PR because only the loop guard existed.
  const needsDerivation =
    values.loop === undefined ||
    values.issue === undefined ||
    values.pr === undefined;
  const derived =
    needsDerivation && kind !== 'loop_start' ? deriveContext(db) : null;
  const foreignLoop =
    values.loop !== undefined &&
    derived?.loop != null &&
    values.loop !== derived.loop;
  const explicitIssue = toInt('issue', values.issue);
  const prNone = values.pr === 'none';
  const explicitPr = prNone ? null : toInt('pr', values.pr);
  const foreignIssue =
    explicitIssue !== null &&
    derived?.issue != null &&
    explicitIssue !== derived.issue;
  const foreignPr =
    explicitPr !== null && derived?.pr != null && explicitPr !== derived.pr;
  const loop = values.loop ?? derived?.loop ?? null;
  const issue =
    explicitIssue ??
    (foreignLoop || foreignPr ? null : (derived?.issue ?? null));
  const pr = prNone
    ? null
    : (explicitPr ??
      (foreignLoop || foreignIssue ? null : (derived?.pr ?? null)));

  const filled: string[] = [];
  if (values.loop === undefined && loop !== null) filled.push(`loop=${loop}`);
  if (values.issue === undefined && issue !== null) filled.push(`issue=#${issue}`);
  if (values.pr === undefined && pr !== null) filled.push(`pr=#${pr}`);

  // Attribution contract, preflight (hoot): a PR-scoped event with no pr is
  // invisible to per-PR aggregation, and only the writer can still disambiguate.
  // Refuse while the candidate set is small enough to enumerate; degrade to a
  // one-line warning above the cap; stay silent when nothing is derivable
  // (read-time coverage remains the net). This assumes the writer reads command
  // output and can retry — scripted writers should always pass explicit flags.
  if (PR_SCOPED_KINDS.includes(kind) && pr === null && !prNone) {
    const candidates = (
      db
        .prepare(
          `SELECT DISTINCT pr FROM events e
           WHERE kind = 'pr_opened' AND pr IS NOT NULL AND loop_id IS ?
             AND NOT EXISTS (SELECT 1 FROM events m
                             WHERE m.kind = 'merged' AND m.pr = e.pr AND m.loop_id IS e.loop_id)`,
        )
        .all(loop) as unknown as { pr: number }[]
    ).map((row) => row.pr);
    if (candidates.length > 0 && candidates.length <= HOOT_CANDIDATE_CAP) {
      db.close();
      console.error(
        `hoot: ${candidates.length} PR(s) open in this loop (${candidates
          .map((p) => `#${p}`)
          .join(' ')}) — "${kind}" is unattributed. Pass --pr <n>, or --pr none to acknowledge.`,
      );
      process.exit(2);
    }
    if (candidates.length > HOOT_CANDIDATE_CAP) {
      console.warn(
        `hoot: ${candidates.length} PRs open in this loop; "${kind}" logged without pr`,
      );
    }
  }

  const result =
    at !== null
      ? db
          .prepare(
            `INSERT INTO events (ts, session, loop_id, issue, pr, kind, data)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(at, values.session ?? deriveSession(), loop, issue, pr, kind, data)
      : db
          .prepare(
            `INSERT INTO events (session, loop_id, issue, pr, kind, data)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(values.session ?? deriveSession(), loop, issue, pr, kind, data);
  // Write-time nudge on the hoot channel: starting a loop is the natural
  // moment to notice siblings that were never closed. The loop just started
  // has fresh activity, so it can never appear in its own nudge.
  const staleLoops =
    kind === 'loop_start' ? deriveLedger(db).filter((e) => e.pair === 'loop' && e.stale) : [];
  db.close();
  const derivedNote = filled.length > 0 ? `  (derived: ${filled.join(' ')})` : '';
  console.log(`logged #${result.lastInsertRowid} ${kind}${derivedNote}`);
  // Ontology references, accept-then-warn (#26): the event just written is
  // checked inline (one event, cheap), but the write is never refused — an
  // unknown reference is the natural moment to create the entity, so the
  // warning suggests the slug instead of blocking a running loop.
  const ontology = loadOntology();
  if (ontology) {
    const payload = data === null ? null : (JSON.parse(data) as Record<string, unknown>);
    for (const f of referenceFindings(ontology, kind, loop, payload)) {
      console.warn(`ontology: ${f.message}`);
    }
  }
  if (staleLoops.length > 0) {
    console.warn(
      `hoot: ${staleLoops.length} stale open loop(s): ${staleLoops
        .map((e) => `${e.scope} (${e.silent_days}d)`)
        .join(', ')} — close with loop_end or log to revive`,
    );
  }
}

function showCtx(values: CliValues): void {
  const db = openDb();
  const context = deriveContext(db);
  const ledger = deriveLedger(db);
  db.close();
  const kinds = suggestedKinds(context);
  if (values.json) {
    console.log(
      JSON.stringify({ ...context, suggested_kinds: kinds, open_ledger: ledger }, null, 2),
    );
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
  // ctx stays lean: only obligations that look forgotten, not everything open.
  const staleEntries = ledger.filter((e) => e.stale);
  if (staleEntries.length > 0) {
    console.log('');
    console.log('stale obligations:');
    for (const e of staleEntries) {
      console.log(`  [${e.pair}] ${e.scope} — silent ${e.silent_days}d`);
    }
  }
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

// Attribution expectations, read-time only: an event of these kinds logged
// without pr/issue is invisible to the per-PR/per-issue aggregations, so the
// report measures its own measurement quality instead of silently under-reporting.
const PR_SCOPED_KINDS = ['tick', 'pr_opened', 'review_round', 'merged'];
const ISSUE_SCOPED_KINDS = ['loop_start', 'issue_closed'];
// Above this many open-PR candidates, hoot stops enumerating and only warns.
const HOOT_CANDIDATE_CAP = 5;

// Open-ledger pair rules (derive, don't store): an opening kind creates an
// obligation that only its closing kinds discharge. Rules are data — adding a
// pair needs no new query code. Staleness is measured from the scope's last
// activity of ANY kind, which separates "open and active" from "probably
// forgotten"; the ledger only surfaces, it never closes anything.
const PAIR_RULES = [
  { pair: 'loop', opened: 'loop_start', closedBy: ['loop_end'], scopeExpr: 'loop_id', staleAfterDays: 5 },
  { pair: 'pr', opened: 'pr_opened', closedBy: ['merged'], scopeExpr: 'pr', staleAfterDays: 3 },
  {
    pair: 'hypothesis',
    opened: 'hypothesis_opened',
    closedBy: ['hypothesis_confirmed', 'hypothesis_refuted'],
    scopeExpr: "json_extract(data,'$.id')",
    staleAfterDays: 14,
  },
];

interface LedgerEntry {
  pair: string;
  scope: string;
  opened_at: string;
  last_activity: string;
  silent_days: number;
  stale: boolean;
}

function deriveLedger(db: ReturnType<typeof openDb>): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const rule of PAIR_RULES) {
    const rows = db
      .prepare(
        // A scope is open when its latest opening event is more recent than its
        // latest closing event (so a reopened scope counts as open again).
        `SELECT scope,
                MIN(CASE WHEN kind = ? THEN ts END) AS opened_at,
                MAX(ts) AS last_activity
         FROM (SELECT ${rule.scopeExpr} AS scope, kind, ts, id FROM events
               WHERE ${rule.scopeExpr} IS NOT NULL)
         GROUP BY scope
         HAVING MAX(CASE WHEN kind = ? THEN id END)
                > COALESCE(MAX(CASE WHEN kind IN (${rule.closedBy.map(() => '?').join(',')}) THEN id END), 0)`,
      )
      .all(rule.opened, rule.opened, ...rule.closedBy) as unknown as {
      scope: string | number;
      opened_at: string;
      last_activity: string;
    }[];
    for (const row of rows) {
      const silentDays =
        Math.round(((Date.now() - Date.parse(row.last_activity)) / 86400e3) * 10) / 10;
      entries.push({
        pair: rule.pair,
        scope: String(row.scope),
        opened_at: row.opened_at,
        last_activity: row.last_activity,
        silent_days: silentDays,
        stale: silentDays >= rule.staleAfterDays,
      });
    }
  }
  return entries;
}

// Ontology reference checks (#26): $FUKURO_ONTOLOGY points at a plain-markdown
// entity directory the user owns — one <slug>.md per entity, one subdirectory
// per type (loop/, hypothesis/, stop-line/). fukuro validates references into
// it and nothing more: no schema beyond directory/slug.md (that belongs to the
// ontology owner), no writes. Unset → every check is skipped (fully opt-in).
interface Ontology {
  dir: string;
  loops: Set<string>;
  hypothesisSlugs: Set<string>;
  hypothesisIds: Set<string>; // frontmatter `id:` values, for slug-independent resolution
  stopLines: Set<string>; // frontmatter `line:` values and `lines:` list entries
}

function readMdEntities(dir: string): { slug: string; text: string }[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ slug: f.slice(0, -3), text: readFileSync(join(dir, f), 'utf8') }));
  } catch {
    return []; // a missing type directory just means no entities of that type
  }
}

const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, '$2');

function loadOntology(): Ontology | null {
  const dir = process.env.FUKURO_ONTOLOGY;
  if (!dir) return null;
  const hypotheses = readMdEntities(join(dir, 'hypothesis'));
  const hypothesisIds = new Set<string>();
  // Frontmatter is grepped naively (`id: X` / `line:` / `lines:` at line start) —
  // deliberately no YAML parser; anything fancier belongs to the ontology owner.
  for (const h of hypotheses) {
    for (const m of h.text.matchAll(/^id:[ \t]*(.+)$/gm)) hypothesisIds.add(unquote(m[1]));
  }
  const stopLines = new Set<string>();
  for (const s of readMdEntities(join(dir, 'stop-line'))) {
    const single = s.text.match(/^line:[ \t]*(.+)$/m);
    if (single) stopLines.add(unquote(single[1]));
    const block = s.text.match(/^lines:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
    if (block) for (const m of block[1].matchAll(/-[ \t]*(.+)/g)) stopLines.add(unquote(m[1]));
  }
  return {
    dir,
    loops: new Set(readMdEntities(join(dir, 'loop')).map((e) => e.slug)),
    hypothesisSlugs: new Set(hypotheses.map((e) => e.slug)),
    hypothesisIds,
    stopLines,
  };
}

const HYPOTHESIS_KINDS = ['hypothesis_opened', 'hypothesis_confirmed', 'hypothesis_refuted'];
const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';

/**
 * Reference checks for one event; shared by lint (whole db, distinct refs) and
 * log-event (the row just written). A hypothesis id resolves via (a) its
 * lowercased slug, (b) a loop-scoped `<loop>-<id>` slug (existing data where
 * ids collide across loops), or (c) a frontmatter `id:` in any entity.
 * Unknown references warn and suggest the slug to create — never an error:
 * the write path for the noun side is exactly this moment.
 */
function referenceFindings(
  ont: Ontology,
  kind: string,
  loop: string | null,
  data: Record<string, unknown> | null,
): LintFinding[] {
  const findings: LintFinding[] = [];
  const warn = (check: string, message: string): number =>
    findings.push({ check, severity: 'warn', message });
  if (loop !== null && !ont.loops.has(loop)) {
    warn('ontology-loop', `loop "${loop}" has no entity — create loop/${loop}.md in $FUKURO_ONTOLOGY`);
  }
  const id = HYPOTHESIS_KINDS.includes(kind) && typeof data?.id === 'string' ? data.id : null;
  if (id !== null) {
    const lower = id.toLowerCase();
    const resolved =
      ont.hypothesisSlugs.has(lower) ||
      (loop !== null && ont.hypothesisSlugs.has(`${loop}-${lower}`)) ||
      ont.hypothesisIds.has(id);
    if (!resolved) {
      warn(
        'ontology-hypothesis',
        `hypothesis id "${id}"${loop === null ? '' : ` (loop ${loop})`} resolves to no entity — create ` +
          `hypothesis/${loop === null ? '' : `${loop}-`}${lower}.md, or add "id: ${id}" to an existing entity's frontmatter`,
      );
    }
  }
  const line = kind === 'stop_line_hit' && typeof data?.line === 'string' ? data.line : null;
  if (line !== null && !ont.stopLines.has(line)) {
    warn(
      'ontology-stop-line',
      `stop line "${line}" matches no entity — create stop-line/${slugify(line)}.md with frontmatter line: "${line}"`,
    );
  }
  return findings;
}

interface LintFinding {
  check: string;
  severity: 'warn' | 'info';
  message: string;
}

type LintCheck = (db: ReturnType<typeof openDb>) => LintFinding[];

/**
 * Lint checks are data: each inspects the whole event log and returns findings.
 * New checks (e.g. ontology references, #26) are appended here — the runner,
 * severity accounting, and exit-code policy need no changes.
 */
const LINT_CHECKS: LintCheck[] = [
  // orphan-lifecycle: a hypothesis close whose (loop_id, data.id) was never
  // opened earlier. The claim text only lives in the opened payload, so the
  // close is evidence for a claim the db never recorded. "Earlier" is event
  // time (ts, id as tiebreak), not row id: in an append-only log a backfilled
  // opened necessarily has id order ≠ time order (#29). An opened that declares
  // data.backfill satisfies the close regardless of either order. NULL-safe
  // loop match (IS) keeps loop-less events comparable; a close without data.id
  // can never match an opened and is flagged too.
  function orphanLifecycle(db) {
    const rows = db
      .prepare(
        `SELECT e.id, e.kind, e.loop_id, json_extract(e.data,'$.id') AS hid
         FROM events e
         WHERE e.kind IN ('hypothesis_confirmed','hypothesis_refuted')
           AND NOT EXISTS (
             SELECT 1 FROM events o
             WHERE o.kind = 'hypothesis_opened'
               AND o.loop_id IS e.loop_id
               AND json_extract(o.data,'$.id') = json_extract(e.data,'$.id')
               AND (o.ts < e.ts OR (o.ts = e.ts AND o.id < e.id)
                    OR json_extract(o.data,'$.backfill'))
           )
         ORDER BY e.id`,
      )
      .all() as unknown as { id: number; kind: string; loop_id: string | null; hid: string | null }[];
    return rows.map((r) => ({
      check: 'orphan-lifecycle',
      severity: 'warn' as const,
      message:
        `event #${r.id} ${r.kind} (id=${r.hid ?? 'missing'}, loop=${r.loop_id ?? '-'}) has no prior hypothesis_opened — ` +
        `backfill: fukuro log-event hypothesis_opened --loop ${r.loop_id ?? '<loop>'} --id ${r.hid ?? '<id>'} --claim "..." --at <when it was opened> (auto-marks data.backfill)`,
    }));
  },
  // unbalanced-loop: more ends than starts for one loop_id — a double-close,
  // or an end logged against a loop that was never started. An end that
  // declares itself a correction (data.supersedes: <event id> or
  // data.re_record: true, #29) is excluded from the count: re-recording a
  // mis-timed close with new rows is the append-only way to fix history.
  function unbalancedLoop(db) {
    const rows = db
      .prepare(
        `SELECT loop_id, SUM(kind = 'loop_start') AS starts,
                SUM(kind = 'loop_end'
                    AND json_extract(data,'$.supersedes') IS NULL
                    AND NOT COALESCE(json_extract(data,'$.re_record'), 0)) AS ends
         FROM events
         WHERE loop_id IS NOT NULL AND kind IN ('loop_start','loop_end')
         GROUP BY loop_id HAVING ends > starts ORDER BY loop_id`,
      )
      .all() as unknown as { loop_id: string; starts: number; ends: number }[];
    return rows.map((r) => ({
      check: 'unbalanced-loop',
      severity: 'warn' as const,
      message:
        `loop ${r.loop_id} has ${r.ends} loop_end but only ${r.starts} loop_start — double-close or missing loop_start ` +
        `(a deliberate re-record should declare data.supersedes or data.re_record)`,
    }));
  },
  // ambiguous-hypothesis-id: the same id opened in more than one loop. Existing
  // data stays disambiguated by loop scope; new ids should be globally unique.
  function ambiguousHypothesisId(db) {
    const rows = db
      .prepare(
        `SELECT hid, COUNT(DISTINCT loop) AS n, GROUP_CONCAT(DISTINCT loop) AS loops
         FROM (SELECT json_extract(data,'$.id') AS hid, COALESCE(loop_id,'-') AS loop
               FROM events WHERE kind = 'hypothesis_opened')
         WHERE hid IS NOT NULL
         GROUP BY hid HAVING n > 1 ORDER BY hid`,
      )
      .all() as unknown as { hid: string; n: number; loops: string }[];
    return rows.map((r) => ({
      check: 'ambiguous-hypothesis-id',
      severity: 'info' as const,
      message: `hypothesis id ${r.hid} opened in ${r.n} loops (${r.loops}) — prefer globally unique ids going forward`,
    }));
  },
  // ontology-*: every reference in the log must resolve in $FUKURO_ONTOLOGY
  // (skipped when unset). Distinct references only, deduped by message, so an
  // unknown loop warns once however many events carry it — this is the
  // backfill direction: entities created later reconcile against old events.
  function ontologyReferences(db) {
    const ont = loadOntology();
    if (!ont) return [];
    const findings: LintFinding[] = [];
    const seen = new Set<string>();
    const push = (fs: LintFinding[]): void => {
      for (const f of fs) if (!seen.has(f.message)) { seen.add(f.message); findings.push(f); }
    };
    const loops = db
      .prepare(`SELECT DISTINCT loop_id FROM events WHERE loop_id IS NOT NULL ORDER BY loop_id`)
      .all() as unknown as { loop_id: string }[];
    for (const r of loops) push(referenceFindings(ont, 'tick', r.loop_id, null));
    const hyps = db
      .prepare(
        `SELECT DISTINCT loop_id, json_extract(data,'$.id') AS hid FROM events
         WHERE kind IN (${HYPOTHESIS_KINDS.map(() => '?').join(',')})
           AND json_extract(data,'$.id') IS NOT NULL ORDER BY hid`,
      )
      .all(...HYPOTHESIS_KINDS) as unknown as { loop_id: string | null; hid: string }[];
    for (const r of hyps) push(referenceFindings(ont, 'hypothesis_opened', r.loop_id, { id: r.hid }));
    const lines = db
      .prepare(
        `SELECT DISTINCT json_extract(data,'$.line') AS line FROM events
         WHERE kind = 'stop_line_hit' AND json_extract(data,'$.line') IS NOT NULL ORDER BY line`,
      )
      .all() as unknown as { line: string }[];
    for (const r of lines) push(referenceFindings(ont, 'stop_line_hit', null, { line: r.line }));
    return findings;
  },
];

function lint(values: CliValues): void {
  const db = openDb();
  const findings = LINT_CHECKS.flatMap((check) => check(db));
  db.close();
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const infos = findings.length - warns;
  if (values.json) {
    console.log(JSON.stringify({ findings, warnings: warns, infos }, null, 2));
  } else {
    for (const f of findings) console.log(`${f.severity} [${f.check}] ${f.message}`);
    console.log(
      findings.length === 0
        ? 'lint: no findings'
        : `lint: ${warns} warning(s), ${infos} info in ${findings.length} finding(s)`,
    );
  }
  // info alone is advisory; anything warn-level makes the run fail.
  if (warns > 0) process.exitCode = 1;
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
  const mergedPrsBase = (
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
      .all(...loopParams, since) as unknown as Omit<MergedPr, 'lead_hours' | 'ticks'>[]
  ).map((r) => ({
    ...r,
    lead_hours:
      r.opened && r.merged_ts
        ? Math.round(((Date.parse(r.merged_ts) - Date.parse(r.opened)) / 36e5) * 10) / 10
        : null,
  }));

  // Ticks are attributed per PR (all-time for that PR: its lifecycle may span
  // windows, but a PR merged in this window owns all of its ticks).
  const ticksByPr = new Map(
    (
      db
        .prepare(
          `SELECT pr, COUNT(*) AS n FROM events
           WHERE kind = 'tick' AND pr IS NOT NULL GROUP BY pr`,
        )
        .all() as unknown as { pr: number; n: number }[]
    ).map((row) => [row.pr, row.n]),
  );
  const mergedPrs: MergedPr[] = mergedPrsBase.map((r) => ({
    ...r,
    ticks: ticksByPr.get(r.pr) ?? 0,
  }));

  // Attribution coverage over the window. SUM(...) over zero rows is NULL,
  // hence the ratio() null handling.
  const ratio = (part: number | null, total: number): number | null =>
    total === 0 ? null : Math.round(((part ?? 0) / total) * 100) / 100;
  const windowTotals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(session IS NOT NULL) AS with_session,
              SUM(loop_id IS NOT NULL) AS with_loop
       FROM events WHERE ts >= datetime('now', ?)${loopClause}`,
    )
    .get(since, ...loopParams) as unknown as {
    total: number;
    with_session: number | null;
    with_loop: number | null;
  };
  // `--pr none` acknowledgments count as attributed: deliberate non-attribution
  // is the writer's answer, not a measurement gap.
  const ackExpr = `COALESCE(json_extract(data,'$.attribution'),'') = 'explicit_none'`;
  const scoped = (kinds: string[], column: 'pr' | 'issue') =>
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(${column} IS NOT NULL${column === 'pr' ? ` OR ${ackExpr}` : ''}) AS with_field
         FROM events
         WHERE kind IN (${kinds.map(() => '?').join(',')})
           AND ts >= datetime('now', ?)${loopClause}`,
      )
      .get(...kinds, since, ...loopParams) as unknown as {
      total: number;
      with_field: number | null;
    };
  const prScoped = scoped(PR_SCOPED_KINDS, 'pr');
  const issueScoped = scoped(ISSUE_SCOPED_KINDS, 'issue');
  // Anti-slop KPI: an applied improvement should trace back to a recorded
  // signal. Measurement only — write-time enforcement is deliberately deferred.
  const signalCoverage = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(json_extract(data,'$.signal') IS NOT NULL
                  AND json_extract(data,'$.signal') <> '') AS with_field
       FROM events
       WHERE kind = 'improve_applied' AND ts >= datetime('now', ?)${loopClause}`,
    )
    .get(since, ...loopParams) as unknown as { total: number; with_field: number | null };
  const unattributedTicks = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE kind = 'tick' AND pr IS NULL AND NOT (${ackExpr})
           AND ts >= datetime('now', ?)${loopClause}`,
      )
      .get(since, ...loopParams) as unknown as { n: number }
  ).n;

  // Unit-size KPI (principle 3: small verifiable units, ~100 changed lines per
  // child PR). Sizes come from data.additions/deletions on pr_opened/merged —
  // the hook recipe attaches them (docs/hooks.md). The latest sized event per
  // PR wins: a PR's size legitimately changes between open and merge. Coverage
  // is reported alongside, like attribution: the KPI measures its own
  // measurement quality instead of silently under-reporting.
  const sizeRows = db
    .prepare(
      `SELECT pr,
              json_extract(data,'$.additions') AS additions,
              json_extract(data,'$.deletions') AS deletions
       FROM events
       WHERE kind IN ('pr_opened','merged') AND pr IS NOT NULL
         AND ts >= datetime('now', ?)${loopClause}
       ORDER BY ts, id`,
    )
    .all(since, ...loopParams) as unknown as {
    pr: number;
    additions: number | null;
    deletions: number | null;
  }[];
  const linesByPr = new Map<number, number>();
  for (const r of sizeRows) {
    if (r.additions != null && r.deletions != null) {
      linesByPr.set(r.pr, Number(r.additions) + Number(r.deletions));
    }
  }
  const sizes = [...linesByPr.values()];
  const windowPrCount = new Set(sizeRows.map((r) => r.pr)).size;
  const unitSize: UnitSizeStats = {
    prs_total: windowPrCount,
    prs_with_size: linesByPr.size,
    size_coverage: ratio(linesByPr.size, windowPrCount),
    median_lines: median(sizes),
    max_lines: sizes.length > 0 ? Math.max(...sizes) : null,
    compliance_rate: ratio(sizes.filter((n) => n <= UNIT_SIZE_TARGET).length, sizes.length),
    oversized: [...linesByPr.entries()]
      .filter(([, lines]) => lines > UNIT_SIZE_CAP)
      .map(([pr, lines]) => ({ pr, lines }))
      .sort((a, b) => b.lines - a.lines),
  };

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
    ticks_per_merged_pr_median: median(mergedPrs.map((r) => r.ticks)),
    window_ticks: count('tick'),
    unattributed_ticks: unattributedTicks,
    stop_line_hits: count('stop_line_hit'),
    stop_lines: stopLines,
    human_interventions: count('human_intervention'),
    attribution_coverage: {
      session: ratio(windowTotals.with_session, windowTotals.total),
      loop_id: ratio(windowTotals.with_loop, windowTotals.total),
      pr_scoped_pr: ratio(prScoped.with_field, prScoped.total),
      issue_scoped_issue: ratio(issueScoped.with_field, issueScoped.total),
      improve_applied_signal: ratio(signalCoverage.with_field, signalCoverage.total),
    },
    unit_size: unitSize,
    // The ledger is all-time, like open hypotheses: an obligation opened last
    // month and never discharged is exactly what the report must surface.
    open_ledger: deriveLedger(db),
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
          unit_size: { ...fullSummary.unit_size, oversized: [] },
          stop_lines: [],
          hypotheses: { ...fullSummary.hypotheses, open: [] },
          open_ledger: fullSummary.open_ledger.map((e) => ({ ...e, scope: '(redacted)' })),
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

// Principle 3 thresholds: ~100 changed lines is the unit-size target for a
// child PR; past 200 the unit should have been split.
const UNIT_SIZE_TARGET = 100;
const UNIT_SIZE_CAP = 200;

interface UnitSizeStats {
  prs_total: number; // PRs seen in the window (pr_opened/merged)
  prs_with_size: number;
  size_coverage: number | null;
  median_lines: number | null;
  max_lines: number | null;
  compliance_rate: number | null; // share of sized PRs at ≤ UNIT_SIZE_TARGET lines
  oversized: { pr: number; lines: number }[]; // > UNIT_SIZE_CAP
}

type ReportSummary = {
  window_days: number;
  loop: string | null;
  merged_prs: number;
  review_rounds_per_merged_pr: number | null;
  median_lead_hours: number | null;
  ticks_per_merged_pr_median: number | null;
  window_ticks: number;
  unattributed_ticks: number;
  stop_line_hits: number;
  stop_lines: StopLineRow[];
  human_interventions: number;
  attribution_coverage: {
    session: number | null;
    loop_id: number | null;
    pr_scoped_pr: number | null;
    issue_scoped_issue: number | null;
    improve_applied_signal: number | null;
  };
  unit_size: UnitSizeStats;
  open_ledger: LedgerEntry[];
  hypotheses: {
    opened_in_window: number;
    confirmed_in_window: number;
    refuted_in_window: number;
    open_count: number;
    open: OpenHypothesis[];
  };
  prs: MergedPr[];
};

/**
 * Ticks legitimately precede pr_opened, so a minority without pr is normal.
 * Once half or more of the window's ticks carry no pr, the per-PR tick stats
 * are built on a minority sample — say so instead of quietly under-reporting.
 */
function tickWarning(summary: ReportSummary): string | null {
  const { unattributed_ticks: n, window_ticks: total } = summary;
  if (total === 0 || n / total < 0.5) return null;
  return `${n} of ${total} ticks in this window have no pr; per-PR tick stats are unreliable`;
}

function pct(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 100)}%`;
}

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
  lines.push(`ticks / merged PR (median): ${summary.ticks_per_merged_pr_median ?? '-'}`);
  lines.push(`total ticks (window):      ${summary.window_ticks}`);
  const warn = tickWarning(summary);
  if (warn) lines.push(`warn: ${warn}`);
  lines.push(`stop-line hits:            ${summary.stop_line_hits}`);
  for (const row of summary.stop_lines) {
    lines.push(`  ${row.n}× ${row.line ?? '(no line recorded)'}`);
  }
  lines.push(`human interventions:       ${summary.human_interventions}`);
  const c = summary.attribution_coverage;
  lines.push('');
  lines.push('attribution coverage:');
  lines.push(`  events with session:            ${pct(c.session)}`);
  lines.push(`  events with loop:               ${pct(c.loop_id)}`);
  lines.push(`  PR-scoped events with pr:       ${pct(c.pr_scoped_pr)}`);
  lines.push(`  issue-scoped events with issue: ${pct(c.issue_scoped_issue)}`);
  lines.push(`  improve_applied with signal:    ${pct(c.improve_applied_signal)}`);
  const u = summary.unit_size;
  if (u.prs_total > 0) {
    lines.push('');
    lines.push(`unit size (principle 3, target ≤${UNIT_SIZE_TARGET} lines):`);
    if (u.prs_with_size === 0) {
      lines.push(
        `  no size data on this window's ${u.prs_total} PR(s) — see docs/hooks.md to capture diff stats`,
      );
    } else {
      lines.push(`  PRs with size data:        ${u.prs_with_size}/${u.prs_total} (${pct(u.size_coverage)})`);
      lines.push(`  median / max lines per PR: ${u.median_lines} / ${u.max_lines}`);
      lines.push(`  ≤${UNIT_SIZE_TARGET}-line PRs (compliance):  ${pct(u.compliance_rate)}`);
      for (const o of u.oversized) {
        lines.push(`  warn: PR #${o.pr} is ${o.lines} changed lines — over the ${UNIT_SIZE_CAP}-line cap, split the unit`);
      }
    }
  }
  if (summary.open_ledger.length > 0) {
    const stale = summary.open_ledger.filter((e) => e.stale).length;
    lines.push('');
    lines.push(`open ledger:               ${summary.open_ledger.length} open / ${stale} stale`);
    for (const e of summary.open_ledger) {
      lines.push(
        `  [${e.pair}] ${e.scope} — opened ${e.opened_at.slice(0, 10)}, silent ${e.silent_days}d${e.stale ? ' (stale)' : ''}`,
      );
    }
  }
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
  lines.push(`| ticks / merged PR (median) | ${summary.ticks_per_merged_pr_median ?? '–'} |`);
  lines.push(`| total ticks (window) | ${summary.window_ticks} |`);
  lines.push(`| stop-line hits | ${summary.stop_line_hits} |`);
  lines.push(`| human interventions | ${summary.human_interventions} |`);
  lines.push('');
  const warn = tickWarning(summary);
  if (warn) lines.push(`> ⚠ ${warn}`, '');
  const c = summary.attribution_coverage;
  lines.push('## Attribution coverage', '');
  lines.push('| field | coverage |');
  lines.push('|---|---|');
  lines.push(`| events with session | ${pct(c.session)} |`);
  lines.push(`| events with loop | ${pct(c.loop_id)} |`);
  lines.push(`| PR-scoped events with pr | ${pct(c.pr_scoped_pr)} |`);
  lines.push(`| issue-scoped events with issue | ${pct(c.issue_scoped_issue)} |`);
  lines.push(`| improve_applied with signal | ${pct(c.improve_applied_signal)} |`);
  lines.push('');
  const u = summary.unit_size;
  if (u.prs_total > 0) {
    lines.push(`## Unit size (principle 3, target ≤${UNIT_SIZE_TARGET} lines)`, '');
    if (u.prs_with_size === 0) {
      lines.push(`_No size data on this window's ${u.prs_total} PR(s) — see \`docs/hooks.md\` to capture diff stats._`, '');
    } else {
      lines.push('| metric | value |');
      lines.push('|---|---|');
      lines.push(`| PRs with size data | ${u.prs_with_size}/${u.prs_total} (${pct(u.size_coverage)}) |`);
      lines.push(`| median lines / PR | ${u.median_lines} |`);
      lines.push(`| max lines / PR | ${u.max_lines} |`);
      lines.push(`| ≤${UNIT_SIZE_TARGET}-line PRs (compliance) | ${pct(u.compliance_rate)} |`);
      lines.push('');
      for (const o of u.oversized) {
        lines.push(`> ⚠ PR #${o.pr}: ${o.lines} changed lines — over the ${UNIT_SIZE_CAP}-line cap, split the unit`);
      }
      if (u.oversized.length > 0) lines.push('');
    }
  }
  if (summary.open_ledger.length > 0) {
    lines.push('## Open ledger', '');
    lines.push('| pair | scope | opened | silent (days) | stale |');
    lines.push('|---|---|---|---|---|');
    for (const e of summary.open_ledger) {
      lines.push(
        `| ${e.pair} | ${e.scope} | ${e.opened_at.slice(0, 10)} | ${e.silent_days} | ${e.stale ? '⚠' : ''} |`,
      );
    }
    lines.push('');
  }
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
    lines.push('| PR | review rounds | ticks | lead time (h) |');
    lines.push('|---|---|---|---|');
    for (const pr of summary.prs) {
      lines.push(`| #${pr.pr} | ${pr.review_rounds} | ${pr.ticks} | ${pr.lead_hours ?? '–'} |`);
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
