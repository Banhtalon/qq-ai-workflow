import { runRedacted } from "./lib/workflow.mjs";

const separator = process.argv.indexOf("--");
const argv = separator >= 0 ? process.argv.slice(separator + 1) : process.argv.slice(2);
if (!argv.length) {
  console.error("Usage: node scripts/run-redacted.mjs -- <executable> [args...]");
  process.exit(64);
}

const result = await runRedacted(argv);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
