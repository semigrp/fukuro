-- fukuro telemetry: a single append-only event log.
-- Aggregations are views over this table; never mutate rows.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  session TEXT,             -- harness session id, if any
  loop_id TEXT,             -- logical loop name (e.g. parent issue slug)
  issue   INTEGER,          -- issue number, if applicable
  pr      INTEGER,          -- pull request number, if applicable
  kind    TEXT NOT NULL,    -- canonical kinds: see spec/05-telemetry.md
  data    TEXT              -- JSON payload (validated at write time)
);

CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events (kind, ts);
CREATE INDEX IF NOT EXISTS idx_events_pr ON events (pr);
CREATE INDEX IF NOT EXISTS idx_events_loop ON events (loop_id);
