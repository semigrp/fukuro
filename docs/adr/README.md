# Architecture decision records

This directory is the authoritative record of Fukuro's architecture decisions. The records
replace the former numbered specification chapters while preserving their original decision date
and intent.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-separate-three-outbound-layers-and-a-return-path.md) | Accepted | Separate three outbound layers and a return path |
| [0002](0002-delegate-routing-to-native-skill-routing.md) | Accepted | Delegate routing to native skill routing |
| [0003](0003-store-decomposition-dags-in-the-issue-tracker.md) | Accepted | Store decomposition DAGs in the issue tracker |
| [0004](0004-run-convergence-as-stateless-gated-ticks.md) | Accepted | Run convergence as stateless, gated ticks |
| [0005](0005-own-a-measured-return-path.md) | Accepted | Make the measured return path Fukuro's responsibility |
| [0006](0006-use-an-append-only-local-telemetry-store.md) | Accepted | Use an append-only, local-first telemetry store |
| [0007](0007-model-exploration-with-typed-units.md) | Accepted | Model exploration with Concept, Hypothesis, and Procedure units |

## Change policy

Accepted ADRs are historical records. Clarifications that do not alter a decision may edit the
record in place. A material change is made by adding a new ADR that supersedes the old one; the
old record remains in this directory with its status changed to `Superseded` and a link to its
replacement.
