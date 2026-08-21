export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "-h") {
      flags.set("help", true);
      continue;
    }
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    if (name === "no-open" || name === "help") {
      flags.set(name, true);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`Missing value for --${name}`);
    flags.set(name, next);
    index += 1;
  }
  return { positionals, flags };
}

export function requiredFlag(args: ParsedArgs, name: string): string {
  const value = args.flags.get(name);
  if (typeof value !== "string" || value === "") throw new CliUsageError(`Missing --${name}`);
  return value;
}

export function optionalFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = optionalFlag(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliUsageError(`Invalid number for --${name}`);
  return parsed;
}
