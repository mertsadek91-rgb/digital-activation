'use client';

/**
 * Admin API client.
 *
 * `credentials: 'include'` because the session lives in httpOnly cookies rather
 * than in a token this code could hold. That costs a little convenience and
 * removes an entire class of attack: an injected script here cannot read the
 * session, only ride it, and SameSite=strict stops it doing that from anywhere
 * else.
 */
import type {
  AdminOrderDetail,
  AdminOrderList,
  AdminProductList,
  AdminPromotion,
  AdminPromotionList,
  AdminReviewList,
  ContactList,
  CreatePromotion,
  CredentialKind,
  ImportResult,
  LaunchReadiness,
  OrderKeysRow,
  PaymentSettings,
  PaymentSettingsView,
  ProductCopy,
  Queue,
  Readiness,
  RedirectsView,
  UpdatePromotion,
  RevealResult,
  SecretInput,
  StaffLoginResult,
  StaffMe,
  VaultStockRow,
} from '@da/contracts';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Publish blockers, when the failure was the readiness gate. */
    readonly blockers: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * One refresh in flight at a time.
 *
 * Without this a screen that loads four things at once answers four 401s with
 * four refreshes, and the session rotates under three of them — each rotation
 * invalidating the token the next was about to use, so a page that was one
 * expired minute old logs the staff member out.
 */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API}/v1/auth/staff/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        // An empty body, not no body. Fastify refuses a POST that declares
        // `application/json` and sends nothing — "Body cannot be empty when
        // content-type is set to 'application/json'" — so the refresh answered
        // 400, the retry never happened, and the fix looked like it worked
        // until it was pointed at a real expired session.
        body: '{}',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so the callers awaiting this one all see the
      // same answer, and the one after them starts a new attempt.
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

/**
 * Every call, with one silent refresh when the access token has expired.
 *
 * An access token lasts fifteen minutes and nothing here was renewing it, so
 * the panel quietly stopped accepting writes a quarter of an hour after login.
 * The failure was invisible in the worst way: the screen still rendered, the
 * form still accepted typing, and only the save reported anything — as
 * "Unauthorized", next to a form whose contents were then lost on reload. Three
 * separate attempts to enter a bank account were swallowed that way.
 *
 * The retry runs once. A 401 that survives a successful refresh is a real
 * refusal — a role that may not write — and retrying it forever would turn one
 * permission error into a loop.
 */
async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const response = await fetch(`${API}/v1${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });

  // Never on the auth routes themselves: refreshing a failed login is a loop,
  // and a failed refresh must surface as a failed refresh.
  if (response.status === 401 && !retried && !path.startsWith('/auth/staff/')) {
    if (await refreshSession()) return request<T>(path, init, true);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const message =
      typeof record.message === 'string'
        ? record.message
        : `Request failed (${String(response.status)})`;
    const blockers = Array.isArray(record.blockers)
      ? record.blockers.filter((item): item is string => typeof item === 'string')
      : [];
    throw new ApiError(message, response.status, blockers);
  }

  return payload as T;
}

export const api = {
  login: (email: string, password: string, totp?: string) =>
    request<StaffLoginResult>('/auth/staff/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
    }),

  enroll: (email: string, password: string, totp: string) =>
    request<{ outcome: 'ok'; staff: StaffMe }>('/auth/staff/enroll', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),

  me: () => request<StaffMe>('/auth/staff/me'),

  logout: () => request<{ ok: true }>('/auth/staff/logout', { method: 'POST' }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ staff: StaffMe }>('/auth/staff/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  products: (params: {
    status?: string;
    q?: string;
    page?: number;
    perPage?: number;
    locale?: 'ar' | 'en';
  }) => {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.q) search.set('q', params.q);
    search.set('page', String(params.page ?? 1));
    search.set('perPage', String(params.perPage ?? 50));
    search.set('locale', params.locale ?? 'ar');
    return request<AdminProductList>(`/admin/products?${search.toString()}`);
  },

  /**
   * The gate, for one locale.
   *
   * Both of these used to send `ar` and nothing else, which made the English
   * gate unassessable from the panel: every English translation in the catalog
   * is missing both SEO fields, and the screen that exists to show you that
   * was reporting on the Arabic copy instead. Publishing follows the same
   * locale, because refusing on Arabic while showing English readings would be
   * a gate that disagrees with the screen it is drawn on.
   */
  readiness: (slug: string, locale: 'ar' | 'en' = 'ar') =>
    request<Readiness>(`/admin/products/${encodeURIComponent(slug)}/readiness?locale=${locale}`),

  setStatus: (
    slug: string,
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
    locale: 'ar' | 'en' = 'ar',
  ) =>
    request<{ status: string; readiness: Readiness }>(
      `/admin/products/${encodeURIComponent(slug)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, locale }),
      },
    ),

  /** The copy the publish gate reads, for the locale being assessed. */
  productCopy: (slug: string, locale: 'ar' | 'en') =>
    request<ProductCopy>(`/admin/products/${encodeURIComponent(slug)}/copy?locale=${locale}`),

  setProductCopy: (
    slug: string,
    patch: {
      locale: 'ar' | 'en';
      seoTitle: string;
      seoDescription: string;
      shortDesc: string;
      body?: string;
    },
  ) =>
    request<ProductCopy>(`/admin/products/${encodeURIComponent(slug)}/copy`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  activationSteps: (slug: string, locale: 'ar' | 'en') =>
    request<{ steps: string[] }>(
      `/admin/products/${encodeURIComponent(slug)}/activation-steps?locale=${locale}`,
    ),

  setCredentialKind: (sku: string, credentialKind: CredentialKind) =>
    request<{ sku: string; credentialKind: CredentialKind }>(
      `/admin/variants/${encodeURIComponent(sku)}/credential-kind`,
      { method: 'PATCH', body: JSON.stringify({ credentialKind }) },
    ),

  setActivationSteps: (slug: string, locale: 'ar' | 'en', steps: string[]) =>
    request<{ slug: string; locale: string; steps: string[] }>(
      `/admin/products/${encodeURIComponent(slug)}/activation-steps`,
      { method: 'PATCH', body: JSON.stringify({ locale, steps }) },
    ),

  setInventory: (sku: string, onHand: number, reason: string, note?: string) =>
    request<{ sku: string; onHand: number; reserved: number }>(`/admin/variants/${sku}/inventory`, {
      method: 'PATCH',
      body: JSON.stringify({ onHand, reason, ...(note ? { note } : {}) }),
    }),

  // --- orders ------------------------------------------------------------------

  orders: (status?: string, q?: string) => {
    const search = new URLSearchParams();
    if (status) search.set('status', status);
    if (q) search.set('q', q);
    const suffix = search.toString();
    return request<AdminOrderList>(`/admin/orders${suffix ? `?${suffix}` : ''}`);
  },

  /**
   * Confirms money that arrived outside the store.
   *
   * The one call in this client that releases a licence key against a payment
   * nothing here can verify, which is why the screen asks for a reference and
   * the API records who clicked it.
   */
  confirmPayment: (number: string, provider: 'BANK_TRANSFER' | 'CRYPTO', reference: string) =>
    request<{ status: string; alreadyApplied: boolean }>(
      `/admin/orders/${encodeURIComponent(number)}/confirm-payment`,
      { method: 'POST', body: JSON.stringify({ provider, reference }) },
    ),

  addOrderNote: (number: string, body: string) =>
    request<{ id: string }>(`/admin/orders/${encodeURIComponent(number)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body, isCustomerVisible: false }),
    }),

  // --- redirects ---------------------------------------------------------------

  redirects: () => request<RedirectsView>('/admin/redirects'),

  createRedirect: (from: string, to: string, code: 301 | 302) =>
    request<{ id: string }>('/admin/redirects', {
      method: 'POST',
      body: JSON.stringify({ from, to, code }),
    }),

  updateRedirect: (id: string, patch: { to?: string; code?: 301 | 302; isActive?: boolean }) =>
    request<{ id: string }>(`/admin/redirects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  resolveNotFound: (id: string) =>
    request<{ id: string }>(`/admin/redirects/not-found/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // --- payment methods ---------------------------------------------------------

  paymentMethods: () => request<PaymentSettingsView>('/admin/payment-methods'),

  /**
   * Replaces both manual methods at once.
   *
   * A whole-document write, matching the API: a patch could leave one line of
   * an old account behind beside the new one, and a half-updated bank account
   * is how a transfer reaches an account that was closed last month.
   */
  savePaymentMethods: (settings: PaymentSettings) =>
    request<PaymentSettingsView>('/admin/payment-methods', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // --- the inbox -------------------------------------------------------------

  messages: (includeHandled: boolean) =>
    request<ContactList>(`/admin/contact?includeHandled=${includeHandled ? 'true' : 'false'}`),

  setMessageStatus: (id: string, status: 'NEW' | 'HANDLED') =>
    request<{ id: string; status: string }>(`/admin/contact/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // --- reviews ---------------------------------------------------------------

  reviews: (status: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    request<AdminReviewList>(`/admin/reviews?status=${status}`),

  /**
   * Publishes a review, or refuses it.
   *
   * Both directions rewrite the product's cached rating on the server, which
   * is why the screen reloads the list afterwards rather than patching the row
   * it has: the counts in the header have changed too.
   */
  moderateReview: (id: string, status: 'APPROVED' | 'REJECTED') =>
    request<{ id: string; status: string; ratingCount: number; ratingAvg: string }>(
      `/admin/reviews/${encodeURIComponent(id)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    ),

  replyToReview: (id: string, body: string) =>
    request<{ id: string; storeReply: string; repliedAt: string }>(
      `/admin/reviews/${encodeURIComponent(id)}/reply`,
      { method: 'POST', body: JSON.stringify({ body }) },
    ),

  // --- fulfilment ----------------------------------------------------------

  queue: (includeDone: boolean) =>
    request<Queue>(`/admin/fulfillment/queue?includeDone=${includeDone ? 'true' : 'false'}`),

  /**
   * Sends the supplier code.
   *
   * The code is in this request body and in the email the server sends. It is
   * not put in a URL, a query string or anything that would end up in an
   * access log.
   */
  fulfil: (orderItemId: string, secret: SecretInput, costUsd?: string) =>
    request<{ state: string; deliveredAt: string }>(
      `/admin/fulfillment/queue/${encodeURIComponent(orderItemId)}/fulfil`,
      { method: 'POST', body: JSON.stringify({ secret, ...(costUsd ? { costUsd } : {}) }) },
    ),

  deliver: (orderItemId: string) =>
    request<{ state: string; keys: number }>(
      `/admin/fulfillment/queue/${encodeURIComponent(orderItemId)}/deliver`,
      // An explicit empty object: Fastify rejects a JSON content-type with no
      // body, and every request here carries that header.
      { method: 'POST', body: JSON.stringify({}) },
    ),

  failLine: (orderItemId: string, reason: string) =>
    request<{ state: string }>(`/admin/fulfillment/queue/${encodeURIComponent(orderItemId)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  importKeys: (variantId: string, codes: string, costUsd?: string, expiresAt?: string) =>
    request<ImportResult>('/admin/fulfillment/vault/import', {
      method: 'POST',
      body: JSON.stringify({
        variantId,
        codes,
        ...(costUsd ? { costUsd } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      }),
    }),

  // --- vault ----------------------------------------------------------------

  vaultStock: () => request<VaultStockRow[]>('/admin/fulfillment/vault/stock'),

  orderKeys: (orderNumber: string) =>
    request<OrderKeysRow[]>(`/admin/fulfillment/orders/${encodeURIComponent(orderNumber)}/keys`),

  /**
   * The one call that returns a licence in the clear.
   *
   * Refused with 403 when the session's TOTP challenge has gone stale, which
   * the caller is expected to answer by stepping up rather than by giving up.
   */
  revealKey: (licenseKeyId: string, reason: string) =>
    request<RevealResult>(
      `/admin/fulfillment/vault/keys/${encodeURIComponent(licenseKeyId)}/reveal`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  revokeKey: (licenseKeyId: string, reason: string) =>
    request<{ state: string }>(
      `/admin/fulfillment/vault/keys/${encodeURIComponent(licenseKeyId)}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),

  keyHistory: (licenseKeyId: string) =>
    request<{ action: string; actorId: string | null; ip: string | null; createdAt: string }[]>(
      `/admin/fulfillment/vault/keys/${encodeURIComponent(licenseKeyId)}/history`,
    ),

  /**
   * What stands between this store and its first order.
   *
   * Readable by every role including READONLY: it is six questions asked of
   * things that already know their own answers, and the only sensitive thing
   * on it is the shape of what is not configured yet.
   */
  launch: () => request<LaunchReadiness>('/admin/launch'),

  /**
   * One order, in full.
   *
   * The endpoint has existed since the orders screen was built and nothing
   * called it, which meant a note written from the panel could never be read
   * back from it.
   */
  order: (number: string) =>
    request<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(number)}`),

  /**
   * Sends a licence email again, to the address on the order.
   *
   * Not a parameter, that address — the API reads it from the order, so this
   * cannot be pointed anywhere else.
   */
  resendLicence: (number: string, orderItemId: string) =>
    request<{ to: string }>(
      `/admin/orders/${encodeURIComponent(number)}/lines/${encodeURIComponent(orderItemId)}/resend`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  /**
   * Coupons.
   *
   * Read by every role and written by ADMIN and OWNER only — the API refuses
   * the rest, so a CATALOG session sees the list with the buttons disabled
   * rather than a screen it cannot use.
   */
  promotions: (filter?: string) =>
    request<AdminPromotionList>(
      `/admin/promotions${filter && filter !== 'all' ? `?filter=${filter}` : ''}`,
    ),

  createPromotion: (body: CreatePromotion) =>
    request<AdminPromotion>('/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePromotion: (id: string, patch: UpdatePromotion) =>
    request<AdminPromotion>(`/admin/promotions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** Re-clears the TOTP challenge without signing out. */
  stepUp: (totp: string) =>
    request<{ staff: StaffMe }>('/auth/staff/step-up', {
      method: 'POST',
      body: JSON.stringify({ totp }),
    }),
};
