#!/usr/bin/env node
import { run } from '../src/cli';

run(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
