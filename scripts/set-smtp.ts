/**
 * Writes SMTP_URL into .env from a password file, and deletes the file.
 *
 *   1. put the mailbox password, alone, in .env.smtp-password
 *   2. pnpm smtp:set noreply@digital-activation.com smtp.office365.com 587
 *   3. the file is shredded and .env now holds the URL
 *
 * This exists for one reason: SMTP_URL is a URL, and a password is not.
 *
 * `nodemailer.createTransport` takes a connection string, so the mailbox and
 * its password are the userinfo half of a URI — and a URI parser reads `@`,
 * `:`, `/`, `?`, `#` and `%` as structure. The username is always an email
 * address, so it always contains an `@`, and a password containing one of a
 * dozen ordinary punctuation marks silently produces a different host, a
 * different port, or a truncated password and an authentication failure that
 * reads like wrong credentials. Encoding it by hand is a trap; encoding it
 * here is four characters of code.
 *
 * The password never reaches a terminal, a log, or this program's output. It
 * is read from a file, encoded, written into .env, and the file is overwritten
 * with random bytes before being removed — because a deleted file is not a
 * gone file, and this one held a mailbox that can send as the shop.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const PASSWORD_FILE = path.join(ROOT, '.env.smtp-password');

function usage(): never {
  console.error(
    [
      'usage: pnpm smtp:set <mailbox> [host] [port]',
      '',
      '  mailbox   the address that authenticates, e.g. noreply@digital-activation.com',
      '  host      default smtp.office365.com',
      '  port      default 587 (STARTTLS). 465 is treated as implicit TLS.',
      '',
      `Put the password alone in ${path.relative(ROOT, PASSWORD_FILE)} first.`,
      'That file is covered by the .env.* rule in .gitignore, and this script',
      'shreds it once the URL is written.',
    ].join('\n'),
  );
  process.exit(1);
}

function shred(file: string): void {
  const size = fs.statSync(file).size;
  fs.writeFileSync(file, crypto.randomBytes(Math.max(size, 64)));
  fs.rmSync(file);
}

function main(): void {
  const [mailbox, host = 'smtp.office365.com', port = '587'] = process.argv.slice(2);
  if (!mailbox || !mailbox.includes('@')) usage();

  if (!fs.existsSync(PASSWORD_FILE)) {
    console.error(`No password file at ${path.relative(ROOT, PASSWORD_FILE)}.`);
    usage();
  }
  if (!fs.existsSync(ENV)) {
    console.error('No .env to write into. Copy .env.example first.');
    process.exit(1);
  }

  // Trimmed, because a text editor adds a trailing newline and a newline is
  // not part of anybody's password. Nothing else is touched: a password may
  // legitimately begin or end with a space, so only line endings go.
  const password = fs.readFileSync(PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
  if (password.length === 0) {
    console.error('The password file is empty.');
    process.exit(1);
  }

  // 465 is implicit TLS from the first byte; 587 opens in the clear and
  // upgrades with STARTTLS. nodemailer reads that from the scheme, not the
  // port, so the scheme has to agree with the port or the handshake hangs.
  const scheme = port === '465' ? 'smtps' : 'smtp';
  const url = `${scheme}://${encodeURIComponent(mailbox)}:${encodeURIComponent(password)}@${host}:${port}`;

  const before = fs.readFileSync(ENV, 'utf8');
  const line = `SMTP_URL="${url}"`;
  const after = /^SMTP_URL=.*$/m.test(before)
    ? before.replace(/^SMTP_URL=.*$/m, line)
    : `${before.replace(/\s*$/, '')}\n${line}\n`;

  fs.writeFileSync(ENV, after);
  shred(PASSWORD_FILE);

  console.log(`SMTP_URL written: ${scheme}://${mailbox}:<password>@${host}:${port}`);
  console.log(`${path.relative(ROOT, PASSWORD_FILE)} shredded.`);
  console.log('\nRestart the API, then open حالة المتجر — it dials the server and reports what it finds.');
}

main();
