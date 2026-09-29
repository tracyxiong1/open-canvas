#!/usr/bin/env node
import { loadEnvFile } from "node:process";
import { optionalFlag, parseArgs } from "./args.js";
import { runCommand } from "./commands.js";

try {
  const args = parseArgs(process.argv.slice(2));
  const envFile = optionalFlag(args, "env-file");
  if (envFile) loadEnvFile(envFile);
  const result = await runCommand(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
}
