import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENV_KEYS } from './env.js';

/**
 * BUG-0020. ConfigModule copies into process.env only the keys validateEnv
 * returns, so a key the code reads but the schema does not declare works on
 * Coolify (injected directly) and is silently ignored from the env file.
 * This fails the moment a new `process.env.X` appears without a schema entry.
 */
const EXEMPT: Record<string, string> = {
  // Integration-suite switches, read by the test harness only.
  TEST_DATABASE_URL: 'test harness',
  ALLOW_REMOTE_TEST_DATABASE: 'test harness',
  // Changing where this comes from changes every fingerprint: owner decision TASK-0011.
  VAULT_FINGERPRINT_SALT: 'TASK-0011',
  // Legacy alias of VAULT_KEY_VERSION, honoured only for hosts that set it
  // directly (vault/kek.ts `version`). Deliberately not accepted from the file.
  KEK_VERSION: 'legacy host-only alias',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'integration' ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe('env schema coverage', () => {
  it('declares every process.env key the API reads', () => {
    const root = join(__dirname, '..');
    const read = new Set<string>();
    for (const file of sources(root)) {
      const text = readFileSync(file, 'latin1');
      for (const match of text.matchAll(
        /process\.env(?:\.([A-Z0-9_]+)|\[['"]([A-Z0-9_]+)['"]\])/g,
      )) {
        const key = match[1] ?? match[2];
        if (key) read.add(key);
      }
    }
    // A broken path or filter would scan nothing and pass; the API reads dozens.
    expect(read.size).toBeGreaterThan(20);
    const known = new Set(ENV_KEYS);
    const missing = [...read].filter((key) => !known.has(key) && !(key in EXEMPT)).sort();
    expect(missing).toEqual([]);
  });
});
