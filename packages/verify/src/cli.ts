#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Verifier } from './verifier.js';

const HELP = `evidence-verify — independently verify an EVIDENCE proof envelope

Usage:
  evidence-verify <envelope.json>           Verify a single envelope
  evidence-verify --chain <env1.json> ...   Verify a contiguous chain
  evidence-verify --help                    Show this help

Exit code: 0 on full verification, 1 on any failure.
`;

async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const v = new Verifier();

  if (argv[0] === '--chain') {
    const files = argv.slice(1);
    const envelopes = await Promise.all(
      files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))),
    );
    const chainResult = v.verifyChainOfEnvelopes(envelopes);
    process.stdout.write(JSON.stringify({ chain: chainResult }, null, 2) + '\n');
    return chainResult.ok ? 0 : 1;
  }

  const file = argv[0];
  const body = await readFile(file);
  const report = await v.verifyEnvelope(body);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.ok ? 0 : 1;
}

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
