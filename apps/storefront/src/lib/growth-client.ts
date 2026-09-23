'use client';

/**
 * Business quotes, the welcome window and referrals, from the browser.
 *
 * Browser-side for the same reason as the cart: the referral cookie and the
 * customer session are httpOnly cookies on the API's domain, and the rate
 * limits should count each visitor rather than the storefront's server.
 */
import {
  type MyReferral,
  type PublicMarketing,
  myReferralSchema,
  publicMarketingSchema,
} from '@da/contracts';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function post(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(new URL(`/v1${path}`, API), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

let marketing: Promise<PublicMarketing | null> | null = null;

/** Read once per page load and shared by every component that asks. */
export function publicMarketing(): Promise<PublicMarketing | null> {
  marketing ??= (async () => {
    try {
      const response = await fetch(new URL('/v1/marketing/public', API), { cache: 'no-store' });
      if (!response.ok) return null;
      const parsed = publicMarketingSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  })();
  return marketing;
}

export class ReferralAuthError extends Error {}

export const growthApi = {
  businessQuote: async (input: {
    company: string;
    name: string;
    email: string;
    phone?: string;
    vatNumber?: string;
    productSlug?: string;
    seats: number;
    message?: string;
    locale: 'ar' | 'en';
    website?: string;
  }): Promise<boolean> => (await post('/business-quotes', input))?.ok ?? false,

  welcomeSubscribe: async (input: { email: string; locale: 'ar' | 'en' }): Promise<boolean> =>
    (await post('/newsletter', { ...input, source: 'welcome' }))?.ok ?? false,

  visitReferral: async (code: string): Promise<{ ok: boolean; attached: boolean }> => {
    const response = await post('/referrals/visit', { code });
    if (!response?.ok) return { ok: false, attached: false };
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      attached?: unknown;
    } | null;
    return { ok: body?.ok === true, attached: body?.attached === true };
  },

  myReferral: async (): Promise<MyReferral> => {
    const response = await fetch(new URL('/v1/referrals/me', API), {
      credentials: 'include',
      cache: 'no-store',
    });
    if (response.status === 401) throw new ReferralAuthError('signed out');
    if (!response.ok) throw new Error(`status ${String(response.status)}`);
    return myReferralSchema.parse(await response.json());
  },
};

// --- per-browser memory ------------------------------------------------------

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
