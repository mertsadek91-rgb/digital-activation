/**
 * The database the integration suite may write to, or null.
 *
 * The suite creates products, customers and paid orders and moves stock, so
 * pointing it at a real database would be a very convincing way to corrupt
 * one. A URL is accepted only for a local host or a database whose name says
 * it is a test database; anything else needs ALLOW_REMOTE_TEST_DATABASE=1
 * said out loud.
 */
export function testDatabaseUrl(): string | null {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return null;

  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(url.hostname);
  const named = /test/i.test(url.pathname);
  if (!local && !named && process.env.ALLOW_REMOTE_TEST_DATABASE !== '1') {
    throw new Error(
      `TEST_DATABASE_URL points at ${url.hostname}${url.pathname}, which is neither local nor named as a test database. ` +
        'The integration suite writes orders and stock; set ALLOW_REMOTE_TEST_DATABASE=1 if this really is a throwaway database.',
    );
  }
  return raw;
}
