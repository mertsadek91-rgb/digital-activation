/*
 * The growth layer's browser memory, without the growth client: the footer
 * newsletter and the welcome window read these on every page, and importing
 * them from `growth-client.ts` brought its schemas and zod along (TASK-0101).
 */

/**
 * localStorage, never trusted to exist. Private windows, blocked site data and
 * embedded previews all throw or come back empty, and a sign-up window that
 * crashes the page because it could not remember itself is worse than one
 * that shows twice.
 */
export const memory = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Nothing to do: the window may simply show again.
    }
  },
};

/** Set once this browser has asked for the newsletter, from any form. */
export const SUBSCRIBED_KEY = 'da_newsletter_requested';
/** When the welcome window last opened here, in ms. */
export const WELCOME_SEEN_KEY = 'da_welcome_seen_at';
