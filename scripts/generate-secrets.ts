/**
 * Secret generator.
 *
 *   pnpm secrets:generate           fill empty secrets in .env, in place
 *   pnpm secrets:generate --print   print a fresh set instead, for Coolify
 *   pnpm secrets:generate --force   also replace secrets that are already set
 *
 * Why a script rather than a shell one-liner: `openssl` is not on the PATH in
 * PowerShell, and the PowerShell recipes people reach for use `Get-Random`,
 * which is not a cryptographic generator. This uses node:crypto, which is,
 * and behaves identically on every machine.
 *
 * Two deliberate choices:
 *
 *   - Database passwords use the base64url alphabet (A-Za-z0-9-_). Every one of
 *     those characters is safe inside a URL, so the percent-encoding trap that
 *     Coolify-generated passwords walk into cannot happen here at all.
 *   - The default mode writes into .env and reports only which keys it filled.
 *     Values printed to a terminal end up in scrollback, in screenshots and in
 *     shell history, none of which is a secret store. `--print` exists for the
 *     one case that needs it — pasting into Coolify — and says so.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env');

type Encoding = 'base64url' | 'base64';

interface SecretSpec {
  key: string;
  bytes: number;
  encoding: Encoding;
  note: string;
}

const SPECS: SecretSpec[] = [
  {
    key: 'DA_APP_PASSWORD',
    bytes: 32,
    encoding: 'base64url',
    note: 'Postgres role da_app — URL-safe so it needs no escaping in a connection string',
  },
  {
    key: 'DA_VAULT_PASSWORD',
    bytes: 32,
    encoding: 'base64url',
    note: 'Postgres role da_vault — same',
  },
  {
    key: 'JWT_ACCESS_SECRET',
    bytes: 48,
    encoding: 'base64url',
    note: 'signs short-lived access tokens',
  },
  {
    key: 'JWT_REFRESH_SECRET',
    bytes: 48,
    encoding: 'base64url',
    note: 'signs refresh tokens — must differ from the access secret',
  },
  {
    key: 'MEILI_MASTER_KEY',
    bytes: 32,
    encoding: 'base64url',
    note: 'full read/write on the search index',
  },
  {
    key: 'KEK_LOCAL_BASE64',
    bytes: 32,
    // Standard base64: this one is decoded back to 32 raw bytes as an AES key,
    // so the padding matters and base64url would be wrong.
    encoding: 'base64',
    note: 'LOCAL DEV ONLY — production uses AWS KMS and refuses to boot without it',
  },
];

/** Values in .env.example that mean "not filled in". */
const PLACEHOLDERS = new Set([
  '',
  'change_me_min_32_chars_______________',
  'da_local_dev',
  'da_local_dev_master_key',
]);

function generate(spec: SecretSpec): string {
  return crypto.randomBytes(spec.bytes).toString(spec.encoding);
}

function readEnvValue(lines: string[], key: string): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    if (trimmed.slice(0, trimmed.indexOf('=')).trim() !== key) continue;

    let value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
    // dotenv cuts an unquoted value at its FIRST '#'. `KEY=   # note` is
    // therefore an empty value, not the note — which is what this has to agree
    // with, or a key that looks set is actually blank at runtime.
    const hash = value.indexOf('#');
    if (hash !== -1) value = value.slice(0, hash).trim();
    return value;
  }
  return null;
}

/** Replaces the value in place, preserving position, quoting and comments. */
function setEnvValue(lines: string[], key: string, value: string): boolean {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    if (trimmed.slice(0, trimmed.indexOf('=')).trim() !== key) continue;

    // Keep any trailing comment; it usually explains the variable.
    const afterEq = line.slice(line.indexOf('=') + 1);
    const commentAt = afterEq.indexOf('#');
    const comment = commentAt === -1 ? '' : ` ${afterEq.slice(commentAt).trim()}`;
    lines[i] = `${key}="${value}"${comment}`;
    return true;
  }
  return false;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const printOnly = args.has('--print');
  const force = args.has('--force');

  if (printOnly) {
    console.warn('');
    console.warn('A fresh set of secrets. Nothing was written to .env.');
    console.warn('These are for pasting into Coolify. Clear your scrollback afterwards —');
    console.warn('a terminal buffer is not a secret store.');
    console.warn('');
    for (const spec of SPECS) {
      console.log(`${spec.key}=${generate(spec)}`);
    }
    console.warn('');
    console.warn('KEK_LOCAL_BASE64 is for local development only. Production must use');
    console.warn('KEK_PROVIDER=aws-kms; the API refuses to start otherwise.');
    return;
  }

  if (!fs.existsSync(ENV_FILE)) {
    console.error('No .env at the repo root. Start with:  cp .env.example .env');
    process.exitCode = 1;
    return;
  }

  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  const filled: string[] = [];
  const kept: string[] = [];
  const absent: string[] = [];

  for (const spec of SPECS) {
    const current = readEnvValue(lines, spec.key);

    if (current === null) {
      absent.push(spec.key);
      continue;
    }
    if (!force && !PLACEHOLDERS.has(current)) {
      kept.push(spec.key);
      continue;
    }
    if (setEnvValue(lines, spec.key, generate(spec))) filled.push(spec.key);
  }

  if (filled.length > 0) {
    fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
  }

  console.log('');
  for (const spec of SPECS) {
    const status = filled.includes(spec.key)
      ? 'generated'
      : kept.includes(spec.key)
        ? 'kept     '
        : absent.includes(spec.key)
          ? 'NO KEY   '
          : '         ';
    console.log(`[${status}] ${spec.key.padEnd(20)}  ${spec.note}`);
  }

  console.log('');
  console.log(`${filled.length} generated, ${kept.length} already set, ${absent.length} missing`);

  if (kept.length > 0 && !force) {
    console.log('Already-set values were left alone. Pass --force to replace them.');
  }
  if (absent.length > 0) {
    console.log('');
    console.error(
      `Not present in .env: ${absent.join(', ')}. Copy the keys across from .env.example.`,
    );
    process.exitCode = 1;
  }
  if (filled.length > 0) {
    console.log('');
    console.log('Next:  pnpm env:check');
  }
}

main();
