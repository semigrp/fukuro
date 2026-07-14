# examples/ — minimal end-to-end loop (WIP)

Planned: a GitHub-only walkthrough that exercises all four architectural parts with nothing but a
repository and the `fukuro` CLI:

1. Route an intent to the implement branch ([ADR 0002](../docs/adr/0002-delegate-routing-to-native-skill-routing.md))
2. Decompose a small goal into a parent issue + 2–3 child issues ([ADR 0003](../docs/adr/0003-store-decomposition-dags-in-the-issue-tracker.md))
3. Run the convergence loop over the children with an agent of your choice, logging
   `tick` / `pr_opened` / `review_round` / `merged` events ([ADR 0004](../docs/adr/0004-run-convergence-as-stateless-gated-ticks.md))
4. Run one return-path cycle: read `fukuro report`, apply one skill improvement, verify the next
   window doesn't regress ([ADR 0005](../docs/adr/0005-own-a-measured-return-path.md) and
   [ADR 0006](../docs/adr/0006-use-an-append-only-local-telemetry-store.md))
