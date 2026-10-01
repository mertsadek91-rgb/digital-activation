/**
 * An email address with a break opportunity after its `@`.
 *
 * Addresses are one unbreakable token, and a table column that holds two of
 * them either grows past its box or breaks them mid-word. A zero-width space
 * after the `@` lets a narrow cell wrap `name@` / `domain` instead — it is
 * invisible, is not copied by the copy buttons (they read the raw value), and
 * is harmless to screen readers.
 */
export function softBreakEmail(email: string): string {
  return email.replace('@', '@\u200B');
}
