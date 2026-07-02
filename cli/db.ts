import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export interface EventRow {
  id: number;
  ts: string;
  session: string | null;
  loop_id: string | null;
  issue: number | null;
  pr: number | null;
  kind: string;
  data: string | null;
}

export function dbPath(): string {
  return process.env.FUKURO_DB ?? join(homedir(), '.fukuro', 'fukuro.db');
}

export function openDb(): DatabaseSync {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const schema = readFileSync(
    fileURLToPath(new URL('./schema.sql', import.meta.url)),
    'utf8',
  );
  db.exec(schema);
  return db;
}
