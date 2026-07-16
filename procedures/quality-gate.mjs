#!/usr/bin/env node
// Generic quality-gate procedure for Ouro.
//
// Reads the Ouro input document (OURO_INPUT_PATH) and runs each declared
// command in the workspace, stopping at the first failure. The workspace is
// the process working directory — Ouro sets it from the run request.
//
// Input shape:
//   { "commands": [["npx", "tsc"], ["npm", "test"]] }
//
// Exit code 0 only when every command exits 0, so a single exit_code gate
// decides the Run. A JSON summary goes to stdout for the Run artifact.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(process.env.OURO_INPUT_PATH, "utf8"));
const commands = Array.isArray(input.commands) ? input.commands : [];
if (commands.length === 0) {
  console.error("quality-gate: no commands declared in inputs.commands");
  process.exit(2);
}

const results = [];
let failed = false;
for (const command of commands) {
  if (!Array.isArray(command) || command.length === 0) {
    console.error(`quality-gate: malformed command entry: ${JSON.stringify(command)}`);
    process.exit(2);
  }
  const started = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const entry = {
    command,
    exitCode: run.status,
    durationMs: Date.now() - started,
    stderrTail: (run.stderr ?? "").split("\n").slice(-5).join("\n").trim(),
  };
  results.push(entry);
  if (run.status !== 0) {
    failed = true;
    break;
  }
}

console.log(JSON.stringify({ ok: !failed, results }, null, 2));
process.exit(failed ? 1 : 0);
