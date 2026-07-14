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
`data.additions`/`data.deletions` on `pr_opened`/`merged` events. `gh pr view <n> --json
additions,deletions` prints exactly the payload shape `--data` expects, so the same hook grows by
one call:

```json
{
  "type": "command",
  "command": "jq -r 'select(.tool_input.command | test(\"gh pr create\")) | .tool_response.stdout // empty' | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' | head -1 | xargs -I{} sh -c 'fukuro log-event pr_opened --pr {} --data \"$(gh pr view {} --json additions,deletions)\"'"
}
```

The same works at merge time: fetch the final stats and attach them to the `merged` event — the
report uses the latest sized event per PR, so a unit that grew during review is measured at its
merged size.

Adapt the extraction to your harness's hook payload shape — the pattern is: *detect the moment,
extract the one fact derivation can't know yet, log.*

## Merge detection

Merges are best captured by the loop itself (the tick that observes `state: MERGED` logs
`merged`), or by CI on the default branch:

```yaml
# e.g. a workflow step on push to main
- run: fukuro log-event merged --pr "${{ github.event.pull_request.number }}"
```

## What not to hook

- `tick` — the loop's own heartbeat is the loop's responsibility; hooking it would count
  unrelated tool calls as loop work.
- Exploration units (`hypothesis_*`, `concept_captured`) — these are judgments, not mechanical
  moments; auto-firing them would produce noise with no closing semantics.
