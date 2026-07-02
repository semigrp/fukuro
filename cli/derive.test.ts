import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveContext, suggestedKinds } from './derive.ts';

const schema = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
  'utf8',
);

const makeDb = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return db;
};

const insert = (
  db: DatabaseSync,
  row: { kind: string; loop?: string | null; issue?: number | null; pr?: number | null },
): void => {
  db.prepare('INSERT INTO events (loop_id, issue, pr, kind) VALUES (?, ?, ?, ?)').run(
    row.loop ?? null,
    row.issue ?? null,
    row.pr ?? null,
    row.kind,
  );
};

/** Creates a throwaway git repo with one empty commit on the given branch. */
const makeRepo = (branch: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'fukuro-derive-'));
  const git = (args: string) =>
    execSync(`git -c user.email=t@example.com -c user.name=t ${args}`, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  git('init -q');
  git('remote add origin git@github.com:acme/demo.git');
  git('commit --allow-empty -q -m init');
  git(`checkout -q -b ${branch}`);
  return dir;
};

const inRepo = (branch: string, fn: () => void): void => {
  const previous = process.cwd();
  process.chdir(makeRepo(branch));
  try {
    fn();
  } finally {
    process.chdir(previous);
  }
};

test('derives issue from branch name, pr and loop from the event log', () => {
  inRepo('123-test-feature', () => {
    const db = makeDb();
    insert(db, { kind: 'loop_start', loop: 'demo-loop' });
    insert(db, { kind: 'pr_opened', loop: 'demo-loop', issue: 123, pr: 456 });
    const context = deriveContext(db);
    assert.equal(context.project, 'acme/demo');
    assert.equal(context.branch, '123-test-feature');
    assert.equal(context.issue, 123);
    assert.equal(context.pr, 456);
    assert.equal(context.loop, 'demo-loop');
  });
});

test('refuses to guess among multiple open loops', () => {
  inRepo('no-issue-branch', () => {
    const db = makeDb();
    insert(db, { kind: 'loop_start', loop: 'loop-a' });
    insert(db, { kind: 'loop_start', loop: 'loop-b' });
    const context = deriveContext(db);
    assert.equal(context.issue, null);
    assert.equal(context.loop, null);
    assert.deepEqual(new Set(context.openLoops), new Set(['loop-a', 'loop-b']));
  });
});

test('a single open loop is derived; closed loops are excluded', () => {
  inRepo('no-issue-branch', () => {
    const db = makeDb();
    insert(db, { kind: 'loop_start', loop: 'closed-loop' });
    insert(db, { kind: 'loop_end', loop: 'closed-loop' });
    insert(db, { kind: 'loop_start', loop: 'open-loop' });
    const context = deriveContext(db);
    assert.equal(context.loop, 'open-loop');
    assert.deepEqual(context.openLoops, ['open-loop']);
  });
});

test('a reopened loop (start after end) counts as open', () => {
  inRepo('no-issue-branch', () => {
    const db = makeDb();
    insert(db, { kind: 'loop_start', loop: 'again' });
    insert(db, { kind: 'loop_end', loop: 'again' });
    insert(db, { kind: 'loop_start', loop: 'again' });
    const context = deriveContext(db);
    assert.equal(context.loop, 'again');
  });
});

test('suggestedKinds discloses the vocabulary of the current node type', () => {
  const base = {
    project: null,
    branch: null,
    issue: null,
    pr: null,
    loop: null,
    openLoops: [],
    session: null,
  };
  assert.ok(suggestedKinds({ ...base, pr: 1 }).includes('review_round'));
  assert.ok(suggestedKinds({ ...base, issue: 1 }).includes('pr_opened'));
  assert.ok(suggestedKinds({ ...base, loop: 'x' }).includes('loop_end'));
  assert.ok(suggestedKinds(base).includes('loop_start'));
});
