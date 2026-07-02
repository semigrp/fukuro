# skills/ — generic skill templates (WIP)

Structural templates for the routing tree (spec/01) and convergence loops (spec/03), stripped of
any host-specific context. Planned:

- `orchestrator.md` — L1 root launcher template (trigger table + branch links only)
- `goal.md` — decomposition entry: goal → parent plan + child units + dependency graph
- `implement.md` — convergence loop definition: tick logic, gates, stop lines, pacing
- `evaluate.md` — rubric template with a parameterized *host-context binding* axis
- `meta-improve.md` — return-path cycle: collect → select one → apply → verify baseline

Each template will ship in two generated flavors from one source: `SKILL.md` (Claude Code) and
`AGENTS.md` (Codex), so the same tree runs on either agent.
