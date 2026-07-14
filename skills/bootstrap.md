---
name: fukuro-bootstrap
description: Grow YOUR decision tree, decomposition rules, and convergence loop from YOUR environment. Scans the repo for what is derivable, grills the human only for what is not, then GENERATES local instance skills bound to your context. Run once per workspace; re-run to repair. Generated files live in your workspace — never in fukuro.
---

# bootstrap — grow your own tree (meta-skill)

You are about to set up a loop-engineering harness for this workspace. **Do not copy anyone's
procedures — derive them.** This skill produces *instance* skills (a router, a loop definition,
conventions) that name this workspace's own reviewers, gates, and rules. A good instance skill is
context-bound by design; that is why fukuro ships this generator instead of finished procedures.

The one principle that governs every step: **instance knowledge is derived at bootstrap, not
bundled** (the same derive-don't-store rule the `fukuro ctx` command applies to position).

## Phase 1 — derive what the environment already knows

Scan before asking. Record every fact with its evidence (file path or command output):

1. **Host & scope**: git remotes, org, the repos in play.
2. **Quality gates**: package scripts (typecheck / lint / test / build or equivalents), and what
   CI actually enforces — read the workflow files, not the README. Note gates that validate
   PR titles, commit formats, or diff contents.
3. **Review machinery**: which bots review (inline reviewers, merge-risk reviewers), how many
   human approvals are required, whether an auto-merge actor exists and what its quiet rules are.
   Read repository settings and workflow configs. **Never assume the merge mechanism.**
4. **Conventions**: default branch, deploy branch, branch naming (is an issue number encoded? if
   not, propose `<issue>-<slug>` — `fukuro ctx` derivation depends on it), commit message style.
5. **Existing telemetry**: is there a fukuro DB? Existing sessions/loops worth continuing?

## Phase 2 — grill the human for what cannot be derived

Ask **only** what the scan could not answer, one question at a time. Record answers as fukuro
events (`concept_captured` for definitions, `hypothesis_opened` for unverified claims with a
`--closes-when`):

- **Merge authority**: who or what may merge? (N human approvals / a bot's decision / you)
- **Stop lines**: which actions are irreversible or forbidden without approval in *this* context?
  Elicit theirs (deploys, force-push, data deletion, privacy boundaries…) — do not just offer a
  generic list.
- **Unit size**: diff budget per PR (suggest ~100 lines target, ~200 ceiling, generated files
  excluded, if they have no opinion).
- **Approval gates**: what must a human sign off before fan-out? (decomposition plans, outward
  actions)
- **Canon location**: where does the human-readable knowledge base live (wiki, docs repo)?
  fukuro records lifecycles only; content stays in the canon.

If the human does not know an answer, do not guess: record it as an open hypothesis and pick the
conservative default (manual merge, smaller units, ask-before-acting).

## Phase 3 — generate the instance files (into the USER's workspace)

Write these into the workspace (e.g. `.claude/skills/` for Claude Code, or an `AGENTS.md` section
for other agents — same content, both derivable from what you learned). Show every file to the
human before finalizing.

1. **Router skill (the tree root)**: a thin launcher — a trigger table mapping their work types to
   branches, using their names and their destinations. Keep it small enough to load at session
   start; details belong in child skills opened on demand (progressive disclosure).
2. **Loop definition**: the tick discipline (one action per tick; re-derive state from the source
   of truth; quality gates from Phase 1; review-response procedure; pacing rules), parameterized
   with the *discovered* reviewer bots and merge mechanism.
3. **Conventions**: branch naming, loop naming (loop id = parent issue slug), which fukuro kinds
   fire at which moments (see [ADR 0006](../docs/adr/0006-use-an-append-only-local-telemetry-store.md)
   and [ADR 0007](../docs/adr/0007-model-exploration-with-typed-units.md)),
   `FUKURO_SESSION` setup, hook recipes from `docs/hooks.md`.
4. **Telemetry wiring**: `fukuro init`; confirm `fukuro ctx` derives correctly on a real branch.

## Phase 4 — verify by running one small loop

Bootstrap is not done when the files exist; it is done when **one tiny unit has traveled the whole
harness**: pick a trivial real change → decompose it (one child) → converge it through the
generated loop definition → confirm `fukuro report` shows the lifecycle (pr_opened → review_round →
merged). Whatever breaks, repair the generated files — failures are seeds (`stop_line_hit` /
`finding` events), not embarrassments.

## Stop lines for this skill itself

- **Never write instance files into the fukuro repository or clone** — they belong to the user's
  workspace.
- **Never invent review/merge machinery.** Underivable + unknown ⇒ open hypothesis + conservative
  default.
- **Regenerate ≠ overwrite.** When instance files already exist, show a diff and let the human
  decide.
- Do not put workspace-identifying content into anything that will be published; exports use
  `fukuro report --profile public`.
