import { execSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Stateless context derivation (ADR 0004: derive, don't store).
 * The current position in the decomposition tree is recomputed on every call
 * from facts that already exist — git state and the append-only event log.
 * Nothing here is cached or persisted, so it cannot drift.
 */
export interface DerivedContext {
  /** owner/repo of the cwd's git remote, if any */
  project: string | null;
  branch: string | null;
  /** issue number encoded at the head of the branch name (`123-slug`) */
  issue: number | null;
  /** latest pr_opened event for the derived issue */
  pr: number | null;
  /** unambiguously open loop (from loop_start without loop_end), or the loop of the derived PR */
  loop: string | null;
  /** when multiple loops are open and none matches the issue, they are listed here instead */
  openLoops: string[];
  session: string | null;
}

const git = (args: string): string | null => {
  try {
    const out = execSync(`git ${args}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
};

export function deriveContext(db: DatabaseSync): DerivedContext {
  const remote = git('remote get-url origin');
  const project =
    remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null;
  const branch = git('rev-parse --abbrev-ref HEAD');
  const issueMatch = branch?.match(/^(\d+)-/);
  const issue = issueMatch ? Number(issueMatch[1]) : null;

  let pr: number | null = null;
  let loop: string | null = null;
  if (issue !== null) {
    const row = db
      .prepare(
        `SELECT pr, loop_id FROM events
         WHERE kind = 'pr_opened' AND issue = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(issue) as { pr: number | null; loop_id: string | null } | undefined;
    if (row !== undefined) {
      pr = row.pr;
      loop = row.loop_id;
    }
  }

  const openLoops = (
    db
      .prepare(
        `SELECT s.loop_id FROM events s
         WHERE s.kind = 'loop_start' AND s.loop_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM events e
             WHERE e.kind = 'loop_end' AND e.loop_id = s.loop_id AND e.id > s.id
           )
         GROUP BY s.loop_id
         ORDER BY MAX(s.id) DESC`,
      )
      .all() as unknown as { loop_id: string }[]
  ).map((row) => row.loop_id);

  // Fill the loop only when it is unambiguous — derivation never guesses.
  if (loop === null && openLoops.length === 1) {
    loop = openLoops[0];
  }

  return {
    project,
    branch,
    issue,
    pr,
    loop,
    openLoops,
    session: deriveSession(),
  };
}

/** Harness-injected per-session ids, consulted when FUKURO_SESSION is unset. */
const HARNESS_SESSION_VARS = ['CLAUDE_CODE_SESSION_ID'];

/**
 * Session id, derived at write time (never stored): explicit FUKURO_SESSION wins,
 * then any known harness-provided id. Empty strings count as unset.
 */
export function deriveSession(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.FUKURO_SESSION) return env.FUKURO_SESSION;
  for (const name of HARNESS_SESSION_VARS) {
    const value = env[name];
    if (value) return value;
  }
  return null;
}

/** Event kinds that make sense at the derived node type (progressive disclosure). */
export function suggestedKinds(context: DerivedContext): string[] {
  if (context.pr !== null) {
    return ['tick', 'review_round', 'merged', 'issue_closed', 'stop_line_hit', 'human_intervention'];
  }
  if (context.issue !== null) {
    return ['tick', 'pr_opened', 'stop_line_hit', 'human_intervention'];
  }
  if (context.loop !== null) {
    return ['tick', 'finding', 'hypothesis_opened', 'concept_captured', 'procedure_defined', 'loop_end'];
  }
  return ['loop_start', 'hypothesis_opened', 'concept_captured'];
}
