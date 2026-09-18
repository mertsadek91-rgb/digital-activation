import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The language the *reader* of a message wants.
 *
 * Not the same thing as the locale a request operates on, and the difference
 * is the whole reason this exists. `/admin/products/:slug/readiness?locale=en`
 * asks "is the English copy publishable"; the answer is read by whoever is
 * signed in, who may be working in Arabic. Before this, `readiness.ts` wrote
 * its refusals in the locale being assessed, so an English-speaking staff
 * member auditing the Arabic catalog got a list of blockers in Arabic — a
 * refusal nobody can read is a refusal nobody acts on.
 *
 * Carried in `Accept-Language` rather than a header of our own: it is on the
 * CORS safelist, so the admin can send it without the preflight having to be
 * taught a new header name, and it is what the header is for.
 */
export type PanelLocale = 'ar' | 'en';

export const DEFAULT_PANEL_LOCALE: PanelLocale = 'ar';

const storage = new AsyncLocalStorage<PanelLocale>();

/**
 * Deliberately crude: the first tag wins and anything that is not English is
 * Arabic. A full RFC 4647 negotiation would buy nothing — there are two
 * languages, and the admin always sends exactly one of them.
 */
export function parsePanelLocale(header: string | string[] | undefined): PanelLocale {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return DEFAULT_PANEL_LOCALE;
  return /^\s*en\b/i.test(raw) ? 'en' : DEFAULT_PANEL_LOCALE;
}

export function runWithPanelLocale<T>(locale: PanelLocale, run: () => T): T {
  return storage.run(locale, run);
}

/**
 * The smallest shape of a Fastify instance this needs, so the hook can be
 * registered against a bare server in a test without dragging Nest in.
 */
export interface PanelLocaleHookTarget {
  addHook(
    event: 'onRequest',
    handler: (
      request: { headers: Record<string, string | string[] | undefined> },
      reply: unknown,
      done: () => void,
    ) => void,
  ): unknown;
}

/**
 * Opens the scope for the rest of the request.
 *
 * `onRequest` rather than anything later, and a Fastify hook rather than Nest
 * middleware, because the messages that most need translating are thrown by
 * guards — a stale TOTP challenge, a role that may not write — and a guard
 * runs before middleware would have opened the scope.
 *
 * Calling `done()` *inside* `storage.run` is what makes this work: Fastify
 * continues the hook chain, and eventually the route handler, within that
 * call, so the store is still there several awaits later when a service
 * finally writes a message.
 */
export function registerPanelLocale(app: PanelLocaleHookTarget): void {
  app.addHook('onRequest', (request, _reply, done) => {
    runWithPanelLocale(parsePanelLocale(request.headers['accept-language']), done);
  });
}

/**
 * Arabic outside a request, which is where the scheduled jobs and the tests
 * live. Nothing there has a reader to ask.
 */
export function panelLocale(): PanelLocale {
  return storage.getStore() ?? DEFAULT_PANEL_LOCALE;
}

/**
 * One message, written twice.
 *
 * A key-and-catalog arrangement would put every one of these in a file away
 * from the branch that decides to throw it, and most of them are one-offs
 * carrying an id or a count. Both readings sit at the call site instead, the
 * way `readiness.ts` has always written its reasons.
 */
export function say(ar: string, en: string): string {
  return panelLocale() === 'en' ? en : ar;
}
