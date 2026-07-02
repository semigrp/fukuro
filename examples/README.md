# examples/ — minimal end-to-end loop (WIP)

Planned: a GitHub-only walkthrough that exercises all four parts of the spec with nothing but a
repository and the `fukuro` CLI:

1. Route an intent to the implement branch (spec/01)
2. Decompose a small goal into a parent issue + 2–3 child issues (spec/02)
3. Run the convergence loop over the children with an agent of your choice, logging
   `tick` / `pr_opened` / `review_round` / `merged` events (spec/03)
4. Run one return-path cycle: read `fukuro report`, apply one skill improvement, verify the next
   window doesn't regress (spec/04–05)
