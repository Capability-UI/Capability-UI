#!/usr/bin/env node
import { runCupCli } from '../cli.js';

const result = await runCupCli({ argv: process.argv.slice(2) });
process.exit(result.exitCode);
