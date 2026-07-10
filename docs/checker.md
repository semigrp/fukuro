# Checker recipe: maker ≠ checker for direct-push repos

Design principle 2 says the model that wrote a change never grades it alone — a different
reviewer gates the merge. On a team, branch protection and a second pair of eyes enforce that
structurally. In a **solo repo that pushes straight to main**, nothing does: the same model
writes the change, runs the tests it thought of, declares the result good, and pushes. Tests
verify the maker's own expectations; they are not an independent judgment. The principle
degrades into discipline, and discipline degrades (the same failure mode that motivated
[`docs/hooks.md`](hooks.md)).

The fix is the same shape as everything else here: a **recipe, not an integration**. A
zero-dependency POSIX `pre-push` hook routes the outgoing diff to an independent reviewer you
configure — any second model or tool distinct from the maker — and only an explicit verdict
lets the push through.

Reference script: [`scripts/checker-pre-push`](../scripts/checker-pre-push).

## Install

Either copy it into the repo's hooks directory:

```sh
cp scripts/checker-pre-push .git/hooks/pre-push
```

or point `core.hooksPath` at a directory where the script is named `pre-push`:

```sh
mkdir -p .githooks && cp scripts/checker-pre-push .githooks/pre-push
git config core.hooksPath .githooks
```

Installing alone changes nothing — the gate is **opt-in** and inert until you configure a
reviewer (see next section). A repo that ships this recipe never bricks a contributor's push.

## Configure the reviewer

`FUKURO_CHECKER_CMD` is a shell command that receives the outgoing unified diff on **stdin**
and must end its output with a verdict line (contract below). Anything qualifies as long as it
is *not the maker*: a different model, a different harness, a linter wrapper with judgment, a
human-in-a-terminal. Example using a CLI model runner — pick a model different from the one
that wrote the change:

```sh
export FUKURO_CHECKER_CMD='claude -p --model claude-haiku-4-5 "You are an independent reviewer.
The stdin is a git diff about to be pushed to main. Review it for correctness, scope creep,
and secrets. End your reply with exactly one line: VERDICT: PASS or VERDICT: BLOCK"'
```

The recipe is tool-agnostic on purpose: the property being bought is **independence of the
grader**, not any particular vendor's review quality.

## The VERDICT contract

The reviewer's output is printed to the terminal, then the **last** line matching
`VERDICT: PASS` or `VERDICT: BLOCK` decides:

| Reviewer output ends with | Push |
|---|---|
| `VERDICT: PASS` | proceeds |
| `VERDICT: BLOCK` | stopped — the reasoning is on screen |
| no verdict line at all | stopped — a configured reviewer that breaks the contract fails closed |

If `FUKURO_CHECKER_CMD` is **unset**, the hook warns and lets the push through (fail open):
the unconfigured state must stay harmless or nobody installs the recipe.

## Bypass, with accountability

`FUKURO_CHECKER_SKIP=1 git push ...` skips the review. The gate is advisory in the end — you
own the repo. But the skip is **recorded before it works**: the hook fires

```sh
fukuro log-event human_intervention --data '{"reason":"checker bypassed","gate":"pre-push"}'
```

so every bypass exists as an event in the telemetry (principle 5: intervention counts don't
saturate). If the `fukuro` CLI is not on `PATH`, the hook warns loudly that the audit trail
has a gap and still lets you through — the gate never takes the repo hostage. You can override
the checker; you cannot do it invisibly.

## Known limits

- **The reviewer is advisory-grade.** A second model skimming a diff will miss things a
  domain-expert human would catch. The point of the gate is not review depth — it is that the
  maker no longer grades itself *alone*. Independence is the property; quality compounds later.
- **Client-side only.** A hook can be uninstalled or bypassed; this is accountability
  infrastructure, not access control. For hard enforcement you need server-side protection.
- **Same-model self-review is a null gate.** If `FUKURO_CHECKER_CMD` points at the same model
  and context that made the change, you have rebuilt the problem with extra steps. Keep the
  checker's model, prompt, and context disjoint from the maker's.
- **New-branch pushes** are reviewed against the merge base with `origin/main` (or the tip
  commit when no base exists); adjust the script if your default branch is named differently.
