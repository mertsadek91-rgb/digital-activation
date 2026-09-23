'use client';

/**
 * The customer's own area, from the browser.
 *
 * Same reasoning as the cart client: the session is an httpOnly cookie the API
 * sets, so the request has to come from the browser that holds it. Nothing
 * here is cached — a licence list read from a cache is a list that lies about
 * what has been delivered.
 *
 * No schema parsing on the reveal response beyond its shape. The values are
 * the product itself; they go into component state, are rendered once, and are
 * never written to storage.
 */
import {
  type AccountOrderList,
  type CustomerMe,
  type CustomerSecret,
  type EditReview,
  type LicenceList,
  type OwnReview,
  type ForYou,
  type ReviewableList,
  type SubmitReview,
  accountOrderListSchema,
  customerMeSchema,
  customerSecretsSchema,
  exchangeResultSchema,
  forYouSchema,
  licenceListSchema,
  loginLinkResultSchema,
  ownReviewSchema,
  resendResultSchema,
  reviewableListSchema,
} from '@da/contracts';
import type { z } from 'zod';

import { serviceErrorMessage } from './service-errors';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(`/v1${path}`, API), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    throw new AccountError(
      typeof record.message === 'string' ? record.message : serviceErrorMessage('unreachable'),
      response.status,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new AccountError(serviceErrorMessage('unexpected'), 500);
  return parsed.data;
}

export const accountApi = {
  requestLink: (email: string, locale: 'ar' | 'en') =>
    request('/account/link', loginLinkResultSchema, {
      method: 'POST',
      body: JSON.stringify({ email, locale }),
    }),

  exchange: (token: string): Promise<CustomerMe> =>
    request('/account/session', exchangeResultSchema, {
      method: 'POST',
      body: JSON.stringify({ token }),
    }).then((result) => result.customer),

  me: (): Promise<CustomerMe> => request('/account/me', customerMeSchema),

  licences: (): Promise<LicenceList> => request('/account/licences', licenceListSchema),

  orders: (): Promise<AccountOrderList> => request('/account/orders', accountOrderListSchema),

  /** Renewals due and products from brands this customer already buys. */
  forYou: (locale: 'ar' | 'en'): Promise<ForYou> =>
    request(`/account/for-you?locale=${locale}`, forYouSchema),

  reveal: (orderItemId: string): Promise<CustomerSecret[]> =>
    request(`/account/licences/${encodeURIComponent(orderItemId)}/reveal`, customerSecretsSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }).then((result) => result.secrets),

  resend: (orderItemId: string): Promise<{ to: string }> =>
    request(`/account/licences/${encodeURIComponent(orderItemId)}/resend`, resendResultSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  /**
   * The delivered lines this customer may review.
   *
   * No product id and no customer id in the request. The session decides both,
   * which is the only reason a review on this store means anything.
   */
  reviewable: (): Promise<ReviewableList> => request('/account/reviews', reviewableListSchema),

  submitReview: (orderItemId: string, review: SubmitReview): Promise<OwnReview> =>
    request(`/account/reviews/${encodeURIComponent(orderItemId)}`, ownReviewSchema, {
      method: 'POST',
      body: JSON.stringify(review),
    }),

  editReview: (orderItemId: string, patch: EditReview): Promise<OwnReview> =>
    request(`/account/reviews/${encodeURIComponent(orderItemId)}`, ownReviewSchema, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  signOut: () =>
    fetch(new URL('/v1/account/sign-out', API), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
};
