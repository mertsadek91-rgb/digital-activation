import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PANEL_LOCALE,
  panelLocale,
  parsePanelLocale,
  registerPanelLocale,
  runWithPanelLocale,
  say,
} from './panel-locale.js';

describe('parsePanelLocale', () => {
  it('reads the plain tags the admin sends', () => {
    expect(parsePanelLocale('en')).toBe('en');
    expect(parsePanelLocale('ar')).toBe('ar');
  });

  it('reads a regional tag and a quality list, because a browser may send either', () => {
    expect(parsePanelLocale('en-GB,en;q=0.9,ar;q=0.8')).toBe('en');
    expect(parsePanelLocale('ar-AE,ar;q=0.9')).toBe('ar');
  });

  it('is not fooled by a language that merely starts with the letters', () => {
    // `eng` is not English here, but more to the point neither is `enigma`:
    // the tag has to end at a boundary or every string beginning "en" wins.
    expect(parsePanelLocale('enigma')).toBe('ar');
  });

  it('falls back rather than throwing on anything it does not recognise', () => {
    expect(parsePanelLocale(undefined)).toBe(DEFAULT_PANEL_LOCALE);
    expect(parsePanelLocale('')).toBe(DEFAULT_PANEL_LOCALE);
    expect(parsePanelLocale('fr')).toBe(DEFAULT_PANEL_LOCALE);
    // Fastify hands back an array when a header arrives twice.
    expect(parsePanelLocale(['en', 'ar'])).toBe('en');
  });
});

describe('panelLocale', () => {
  it('is Arabic outside a request, where there is no reader to ask', () => {
    expect(panelLocale()).toBe('ar');
    expect(say('عربي', 'English')).toBe('عربي');
  });

  it('follows the scope it is run inside', () => {
    expect(runWithPanelLocale('en', () => say('عربي', 'English'))).toBe('English');
    expect(runWithPanelLocale('ar', () => say('عربي', 'English'))).toBe('عربي');
  });

  it('survives an await, which is where every real call site reads it', () => {
    // The whole point of the storage: the message is written after the
    // database has answered, several ticks after the header was parsed.
    return runWithPanelLocale('en', async () => {
      await Promise.resolve();
      expect(panelLocale()).toBe('en');
      return undefined;
    });
  });

  it('does not leak out of its scope', async () => {
    await runWithPanelLocale('en', async () => {
      await Promise.resolve();
    });
    expect(panelLocale()).toBe('ar');
  });
});

describe('registerPanelLocale', () => {
  /**
   * The one part of this that cannot be reasoned about from the types.
   *
   * `storage.run(locale, done)` only works because Fastify continues the hook
   * chain, and then the route handler, inside that `done()` call. If it ever
   * deferred instead, every message would silently fall back to Arabic and no
   * unit test of `say()` would notice. So this boots a real server.
   */
  async function serverSaying(header: string | undefined): Promise<string> {
    const { default: Fastify } = await import('fastify');
    const app = Fastify();
    registerPanelLocale(app);

    app.get('/say', async () => {
      // Several ticks after the header was read, which is where a service
      // actually writes its message.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { said: say('عربي', 'English'), locale: panelLocale() };
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/say',
        ...(header === undefined ? {} : { headers: { 'accept-language': header } }),
      });
      return (JSON.parse(response.body) as { said: string }).said;
    } finally {
      await app.close();
    }
  }

  it('carries the header into the route handler, across an await', async () => {
    expect(await serverSaying('en')).toBe('English');
    expect(await serverSaying('en-GB,en;q=0.9')).toBe('English');
  });

  it('stays Arabic for an Arabic reader and for a request that says nothing', async () => {
    expect(await serverSaying('ar')).toBe('عربي');
    expect(await serverSaying(undefined)).toBe('عربي');
  });

  it('keeps two overlapping requests apart', async () => {
    // One scope per request, not one per process: an English admin and an
    // Arabic one are usually both mid-request.
    const [english, arabic] = await Promise.all([serverSaying('en'), serverSaying('ar')]);
    expect(english).toBe('English');
    expect(arabic).toBe('عربي');
  });
});
