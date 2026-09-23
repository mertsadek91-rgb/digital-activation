'use client';

/**
 * The two "tell me later" requests: back in stock, and the newsletter.
 *
 * Called from the browser, like the cart, so the API's per-visitor rate limits
 * count each shopper rather than the storefront's server.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(new URL(`/v1${path}`, API), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const subscriptionsApi = {
  stockAlert: (input: { email: string; variantId: string; locale: 'ar' | 'en' }) =>
    post('/stock-alerts', input),
  subscribe: (input: { email: string; locale: 'ar' | 'en' }) => post('/newsletter', input),
  confirm: (input: { token: string; locale: 'ar' | 'en' }) => post('/newsletter/confirm', input),
  unsubscribe: (input: { token: string }) => post('/newsletter/unsubscribe', input),
};
