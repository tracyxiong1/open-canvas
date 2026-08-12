#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { runCommand } from "./commands.js";

try {
  const result = await runCommand(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
}
