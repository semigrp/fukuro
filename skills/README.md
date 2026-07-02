# skills/ — meta-skills: generators, not procedures

Concrete procedural skills are context-bound *by design* — a good one names its own reviewers,
gates, and conventions. Shipping one team's procedures would hand every cloner a copy of someone
else's context. So fukuro ships the layer above: **meta-skills that generate your instance skills
from your environment.** Derive-don't-store, applied to procedures.

Clone → `npm i -g fukuro` → point your agent at a meta-skill → your own tree grows locally.
Generated instance files live in **your** workspace, never in this repository.

| meta-skill | status | what it does |
|---|---|---|
| [bootstrap](bootstrap.md) | ✅ | scan the repo, grill the human for the underivable, generate the local router / loop definition / conventions, verify with one tiny end-to-end loop |
| decompose | planned | generic decomposition rules (parent=plan, child=one verifiable unit, size budget, approval gate) applied to a runtime goal |
| converge | planned | generic tick discipline parameterized by bootstrap-discovered facts |
| return-path | planned | evaluate → improve → revert-on-regression, adjudicated by `fukuro report` |

Each file is plain markdown with frontmatter: usable directly as a Claude Code `SKILL.md`
(copy/symlink into `.claude/skills/<name>/SKILL.md`) or referenced from an `AGENTS.md`. One
source, any agent.
