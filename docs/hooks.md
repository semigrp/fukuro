# Hook recipes: capturing events without agent discipline

Manual logging degrades — sessions get dropped, flags drift (observed on day one of dogfooding).
The fix is structural: let the **harness** fire `fukuro log-event` at the moments that matter,
and let context derivation (`fukuro ctx`, the derive-don't-store rule from
[ADR 0004](adr/0004-run-convergence-as-stateless-gated-ticks.md)) fill in the fields.

Principles:

- fukuro ships **recipes, not integrations**. Hooks live in your harness config; fukuro just
  receives events. No API clients, no daemons.
- With derivation in place, a hook only decides **when** to fire — the **what** (loop, issue, PR)
  comes from the branch name and the event log.
- Observation hooks fail open. A telemetry or evaluator failure must not block the workload it
  was meant to observe.

## Session stamping

On recognized harnesses no setup is needed: when `FUKURO_SESSION` is unset, `log-event` falls back
to the harness's own per-session id (currently `CLAUDE_CODE_SESSION_ID`), so the `session` column
fills itself. This exists because the manual export below was documented on day one and still never
got wired up — an opt-in convention loses to defaults.

Elsewhere, set `FUKURO_SESSION` in the environment that launches your agent (shell profile, CI job,
harness launcher). Every `log-event` picks it up automatically; per-call `--session` is for
overrides only. Empty values count as unset.

```sh
export FUKURO_SESSION="$(date +%Y%m%d)-$$"
```

## Claude Code: auto-capture PR creation

`PostToolUse` hook on Bash calls that create a PR. The PR number is parsed from the tool output;
everything else is derived.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r 'select(.tool_input.command | test(\"gh pr create\")) | .tool_response.stdout // empty' | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' | head -1 | xargs -I{} fukuro log-event pr_opened --pr {}"
          }
        ]
      }
    ]
  }
}
```

### Variant: attach diff stats (unit-size KPI)

Principle 3 (small verifiable units, ~100 changed lines) is measured by `report` from
`data.additions`/`data.deletions` on `pr_opened`/`merged` events. `gh pr view <url> --json
additions,deletions` prints exactly the payload shape `--data` expects.

Pass the **full PR URL** to `gh pr view`, not the bare number: the hook process inherits the
session's working directory, which in a multi-repo parent dir is not the repo the PR belongs to —
`gh pr view <n>` fails there while the URL form works from anywhere (observed during dogfooding).

```json
{
  "type": "command",
  "command": "{ jq -r 'select(.tool_input.command|test(\"gh pr create\")) | .tool_response.stdout // empty' | grep -oE 'https://github.com/[^ ]+/pull/[0-9]+' | head -1 | { read -r url || exit 0; fukuro log-event pr_opened --pr \"${url##*/}\" --data \"$(gh pr view \"$url\" --json additions,deletions)\"; }; } 2>/dev/null || true"
}
```

The same works at merge time — the report uses the latest sized event per PR, so a unit that grew
during review is measured at its merged size. The merge command usually names the PR as an
argument rather than printing a URL, so extract it from `tool_input.command` (URL form, or
number + `--repo`):

```json
{
  "type": "command",
  "command": "{ c=$(jq -r 'select(.tool_input.command|test(\"gh pr merge\")) | .tool_input.command'); [ -n \"$c\" ] || exit 0; url=$(printf '%s' \"$c\" | grep -oE 'https://github.com/[^ ]+/pull/[0-9]+' | head -1); if [ -z \"$url\" ]; then n=$(printf '%s' \"$c\" | grep -oE 'merge +[0-9]+' | grep -oE '[0-9]+' | head -1); r=$(printf '%s' \"$c\" | grep -oE '(--repo|-R) +[^ ]+' | head -1 | awk '{print $2}'); if [ -n \"$n\" ] && [ -n \"$r\" ]; then url=\"https://github.com/$r/pull/$n\"; fi; fi; [ -n \"$url\" ] || exit 0; fukuro log-event merged --pr \"${url##*/}\" --data \"$(gh pr view \"$url\" --json additions,deletions)\"; } 2>/dev/null || true"
}
```

A bare `gh pr merge` on the current branch carries neither URL nor number; the hook exits quietly.
That gap is acceptable — the loop's own tick that observes `state: MERGED` still logs `merged`
(see below), just without size data.

Adapt the extraction to your harness's hook payload shape — the pattern is: *detect the moment,
extract the one fact derivation can't know yet, log.*

## Merge detection

Merges are best captured by the loop itself (the tick that observes `state: MERGED` logs
`merged`), or by CI on the default branch:

```yaml
# e.g. a workflow step on push to main
- run: fukuro log-event merged --pr "${{ github.event.pull_request.number }}"
```

## Async merge sync: when nobody was there to see it merge

The recipes above fire while a session or CI run is active. A bot that merges on its own schedule
(auto-merge after review, a scheduled release train) closes PRs with nobody watching, so the `pr`
ledger obligation (`pr_opened` with no `merged`) goes stale — not because instrumentation is
broken, but because there was no live process to log it at the moment it happened.

This is still a recipe, not a shipped integration: the script below is something you run from your
own cron/launchd, reading the ledger and writing through `fukuro import` (#39) — fukuro has no
opinion on how or when you invoke it, and ships no daemon of its own.

```sh
#!/bin/sh
# gh-merge-sync.sh — closes stale 'pr' ledger entries for PRs merged by a bot while no
# session was open to log them. Idempotent: sourceEventId keys on the merge commit, so
# re-running (e.g. hourly from cron) never double-imports. Usage: REPO=owner/name ./gh-merge-sync.sh
set -eu
: "${REPO:?set REPO=owner/name}"

fukuro report --format json \
  | jq -r '.open_ledger[] | select(.pair == "pr") | .scope' \
  | while read -r pr; do
      json=$(gh pr view "$pr" --repo "$REPO" \
        --json state,mergedAt,mergeCommit,closingIssuesReferences 2>/dev/null) || continue
      printf '%s' "$json" | jq -c --arg pr "$pr" --arg repo "$REPO" '
        select(.state == "MERGED" and .mergeCommit != null) |
        (.mergeCommit.oid) as $oid | (.mergedAt) as $at |
        ([{schema:"fukuro.telemetry-event/v1", source:"github",
           sourceEventId:("merge:"+$repo+":"+$pr+":"+$oid), occurredAt:$at, kind:"merged",
           subject:{system:"github",type:"pull_request",id:($repo+"#"+$pr),version:$oid},
           refs:[{system:"github",type:"pull_request",id:($repo+"#"+$pr),version:$oid}],
           data:{}}]
         + [.closingIssuesReferences[]? |
            {schema:"fukuro.telemetry-event/v1", source:"github",
             sourceEventId:("close:"+$repo+":"+(.number|tostring)+":"+$oid),
             occurredAt:$at, kind:"issue_closed",
             subject:{system:"github",type:"issue",id:($repo+"#"+(.number|tostring)),version:$oid},
             refs:[{system:"github",type:"issue",id:($repo+"#"+(.number|tostring)),version:$oid}],
             data:{}}]
        )[]'
    done \
  | fukuro import
```

Each candidate comes from the ledger itself (`pair == "pr"`, i.e. `pr_opened` with no `merged`
yet), not from guessing a PR range, so the script only ever asks about obligations fukuro already
believes are open. A PR that is still open, or closed without merging, produces no event — this
recipe only ever fills in the one fact a live session couldn't have caught: that the merge already
happened. `loop_end` is deliberately not synced here: whether a loop's *goal* is done is a
judgment call for whoever owns the loop, not something a merge event can decide on its own.

The `.mergeCommit != null` guard matters: with `set -e`, letting jq bind a null `oid` into the
`sourceEventId` string would raise a type error and abort the whole run mid-loop, silently
dropping every PR after the one that tripped it. A merge whose commit info isn't (yet) available
from the API is skipped this run and picked up on the next one instead of taking the script down
with it.

## Codex: shadow routing observation

[ADR 0008](adr/0008-measure-native-skill-routing-before-introducing-a-gate.md) permits automatic
routing assessment only in shadow mode. After Fukuro publishes the receiver-owned assessment
contract, a Codex adapter may use task-submission and run-completion lifecycle hooks to capture
artifact references and enqueue an assessment. It should return immediately and perform the
evaluation outside the active tool path.

This is a design boundary, not an executable recipe yet. The current CLI has no routing-assessment
contract, and raw evaluator output must not be disguised as a generic `finding`. A recipe belongs
here only after it can preserve the task reference, immutable SkillIndex digest, evaluator version,
observed skill-use evidence, and outcome reference required by ADR 0008.

During the shadow phase, do not use pre-tool, permission, or context-injection hooks for routing.
The evaluator observes whether native routing omitted a required skill; it does not repair the
active run. Advisory behavior is a later phase, and blocking behavior requires another ADR.

## What not to hook

- `tick` — the loop's own heartbeat is the loop's responsibility; hooking it would count
  unrelated tool calls as loop work.
- Exploration units (`hypothesis_*`, `concept_captured`) — these are judgments, not mechanical
  moments; auto-firing them would produce noise with no closing semantics.
- LLM evaluation after every tool call — it adds cost and latency while coupling observation to
  the path being observed.
- Routing gates or automatic skill injection — shadow assessments have not earned control of the
  active run.
- Permission approval — telemetry and routing assessment never grant capabilities.
