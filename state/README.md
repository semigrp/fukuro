# state/ — state backend adapters (WIP)

The convergence loop re-derives its state every tick from a *source of truth* (spec/03). This
directory will define the adapter contract and reference implementations:

- `github` — issues, PRs, review threads, CI status (the default; zero extra infrastructure)
- `markdown` — plain files in-repo, for tracker-less projects
- `notion` — wiki-as-canonical setups (via API token, so headless loops work)
- `sqlite` — the telemetry store itself as a queryable state view

Contract sketch: `deriveState(loopId) → { units, openPrs, feedback, blocked }` — read-only,
idempotent, no caching across ticks.
