/**
 * Derives the application database URLs from the owner URL.
 *
 *   pnpm db:urls
 *
 * The three connection strings describe one database reached by three roles.
 * Writing them by hand means repeating a host, a port and a database name three
 * times and changing only the credentials — and getting one wrong fails in a
 * way that reads like a password problem rather than a typo.
 *
 * So `DATABASE_URL_MIGRATE` is the single source of truth for where the
 * database is, and this builds the other two from it plus the role passwords
 * already in .env. Nothing is printed but the host and the role names.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, '.env');

function readValue(lines: string[], key: string): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    if (trimmed.slice(0, trimmed.indexOf('=')).trim() !== key) continue;

    let value = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
    const hash = value.indexOf('#');
    if (hash !== -1) value = value.slice(0, hash).trim();
    return value;
  }
  return null;
}

function setValue(lines: string[], key: string, value: string): void {
  const quoted = `${key}="${value}"`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    if (trimmed.slice(0, trimmed.indexOf('=')).trim() !== key) continue;

    const afterEq = line.slice(line.indexOf('=') + 1);
    const commentAt = afterEq.indexOf('#');
    const comment = commentAt === -1 ? '' : ` ${afterEq.slice(commentAt).trim()}`;
    lines[i] = `${quoted}${comment}`;
    return;
  }
  lines.push(quoted);
}

interface Derived {
  key: 'DATABASE_URL' | 'DATABASE_URL_VAULT';
  role: string;
  passwordKey: 'DA_APP_PASSWORD' | 'DA_VAULT_PASSWORD';
  schema: string;
}

const DERIVED: Derived[] = [
  { key: 'DATABASE_URL', role: 'da_app', passwordKey: 'DA_APP_PASSWORD', schema: 'public' },
  {
    key: 'DATABASE_URL_VAULT',
    role: 'da_vault',
    passwordKey: 'DA_VAULT_PASSWORD',
    schema: 'vault',
  },
];

function main(): void {
  if (!fs.existsSync(ENV_FILE)) {
    console.error('No .env at the repo root.');
    process.exitCode = 1;
    return;
  }

  const lines = fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/);
  const owner = readValue(lines, 'DATABASE_URL_MIGRATE');

  if (!owner) {
    console.error('DATABASE_URL_MIGRATE is not set. It is the source of truth for the host.');
    process.exitCode = 1;
    return;
  }

  let base: URL;
  try {
    base = new URL(owner);
  } catch {
    console.error('DATABASE_URL_MIGRATE will not parse as a URL.');
    process.exitCode = 1;
    return;
  }

  const database = base.pathname.replace(/^\//, '');
  console.log(
    `owner URL: ${base.protocol}//${base.hostname}:${base.port || '5432'}/${database} as ${base.username}`,
  );

  for (const spec of DERIVED) {
    const password = readValue(lines, spec.passwordKey);
    if (!password) {
      console.error(`${spec.passwordKey} is not set. Run \`pnpm secrets:generate\` first.`);
      process.exitCode = 1;
      return;
    }

    const url = new URL(base.toString());
    url.username = spec.role;
    url.password = password;
    url.search = '';
    // The role passwords are generated in the base64url alphabet, so no
    // percent-encoding is needed and none is applied. Anything the URL class
    // would escape would already have broken the owner URL.
    url.searchParams.set('schema', spec.schema);

    // Carry over sslmode if the owner URL uses it: whatever the transport
    // requires for one role, it requires for all three.
    const sslmode = base.searchParams.get('sslmode');
    if (sslmode) url.searchParams.set('sslmode', sslmode);

    setValue(lines, spec.key, url.toString());
    console.log(
      `${spec.key.padEnd(20)} -> ${spec.role} on ${database}, schema=${spec.schema}${
        sslmode ? `, sslmode=${sslmode}` : ''
      }`,
    );
  }

  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
  console.log('');
  console.log('Written. Next:  pnpm db:doctor');
}

main();
