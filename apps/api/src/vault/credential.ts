import { BadRequestException } from '@nestjs/common';

import type { CredentialKind, SecretInput } from '@da/contracts';

/**
 * The shape of a sealed payload, in one place.
 *
 * The vault stores one encrypted blob per row, and two kinds of thing go into
 * it: a single activation key, or an account's username and password. This
 * module is the only code that knows how the second one is laid out — a
 * username on the first line, the password on the second. Every other file
 * goes through `canonical` and `parse`.
 *
 * That is deliberate. The alternative — each caller splitting on whatever
 * separator it assumes — is how a password gets printed under the heading
 * "activation key", and a customer who is sent half a credential has to be
 * sent the other half by hand, which means somebody reading it out of the
 * vault again.
 *
 * Newline is the separator because nothing else is safe: passwords from
 * suppliers contain colons, pipes, spaces and commas, and a separator that can
 * appear inside the value is not a separator. A newline inside either part is
 * refused at the door rather than silently mangled.
 */
const NEWLINE = /[\r\n]/;

/** The string that gets encrypted. Never logged, never stored unsealed. */
export function canonical(secret: SecretInput): string {
  if (secret.kind === 'ACTIVATION_KEY') {
    const key = secret.key.trim();
    if (key.length < 4) throw new BadRequestException('الكود قصير جداً.');
    if (NEWLINE.test(key)) throw new BadRequestException('الكود يحتوي على سطر جديد.');
    return key;
  }

  const username = secret.username.trim();
  const password = secret.password.trim();
  if (NEWLINE.test(username) || NEWLINE.test(password)) {
    throw new BadRequestException('اسم المستخدم أو كلمة المرور يحتوي على سطر جديد.');
  }
  return `${username}\n${password}`;
}

/**
 * How many fields the payload holds, for the `fieldCount` column.
 *
 * The column predates this module and existed for exactly this case; it is
 * filled so a future reader can tell a two-field row from a one-field row
 * without decrypting it.
 */
export function fieldCount(kind: CredentialKind): number {
  return kind === 'ACCOUNT_CREDENTIALS' ? 2 : 1;
}

export interface ParsedSecret {
  kind: CredentialKind;
  /** Set for ACTIVATION_KEY, null for an account. */
  key: string | null;
  username: string | null;
  password: string | null;
}

/**
 * Reads a decrypted payload back into its parts.
 *
 * A row whose kind says account but whose payload has no second line is
 * returned as a key rather than as an account with an empty password: an
 * empty password field in a customer's inbox reads as "there is no password",
 * which is worse than showing the raw string and letting a person look at it.
 * That case can only exist for rows sealed before this column did.
 */
export function parse(kind: CredentialKind, plaintext: string): ParsedSecret {
  if (kind === 'ACCOUNT_CREDENTIALS') {
    const index = plaintext.indexOf('\n');
    if (index > 0 && index < plaintext.length - 1) {
      return {
        kind,
        key: null,
        username: plaintext.slice(0, index).trim(),
        password: plaintext.slice(index + 1).trim(),
      };
    }
  }
  return { kind: 'ACTIVATION_KEY', key: plaintext, username: null, password: null };
}

/**
 * Splits a pasted block into secrets, and counts what it could not use.
 *
 * For an account variant a line is `username<sep>password`, split on the first
 * separator so a password keeps every character after it — including the
 * colons and spaces that suppliers put in them. `user@example.com:pa:ss word`
 * is a username and the password `pa:ss word`, which is the only reading that
 * can be right: an email address cannot contain a colon, and a password can.
 *
 * A line with no separator is counted invalid, not stored. Storing it would
 * put a username in the vault with nothing to sign in with, and the import
 * would report a success that is not one.
 */
export function parseBlock(
  kind: CredentialKind,
  block: string,
): { secrets: SecretInput[]; invalid: number } {
  const lines = block.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const secrets: SecretInput[] = [];
  let invalid = 0;

  for (const line of lines) {
    const value = line.trim();

    if (kind === 'ACTIVATION_KEY') {
      if (value.length < 4) {
        invalid += 1;
        continue;
      }
      secrets.push({ kind, key: value });
      continue;
    }

    const match = /^(\S+?)\s*[\t|:,;]\s*(.+)$/.exec(value) ?? /^(\S+)\s+(.+)$/.exec(value);
    const username = match?.[1]?.trim() ?? '';
    const password = match?.[2]?.trim() ?? '';
    if (username.length < 3 || password.length < 4) {
      invalid += 1;
      continue;
    }
    secrets.push({ kind, username, password });
  }

  return { secrets, invalid };
}
