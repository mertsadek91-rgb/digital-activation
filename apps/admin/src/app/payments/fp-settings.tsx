'use client';

import type {
  AdminFpConnectResult,
  AdminFpEventList,
  AdminFpMethod,
  AdminFpOverview,
  FpHiddenReason,
  FpWebhookResult,
  UpdateFpMethod,
} from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * Final Processor in the panel (B.2–B.5): what is configured, whether the keys
 * work, how each method appears at the checkout, and what the processor has
 * told the shop.
 *
 * Rendered only for OWNER and ADMIN — the API refuses everybody else, reading
 * included, because which methods take money is a decision about where
 * customer money goes.
 *
 * "Test connection" is a button and never an effect. It registers the webhook
 * address with the processor and is written to the audit log, so running it
 * on every visit to this page would be a write nobody asked for.
 */

type Translator = ReturnType<typeof useT<'finalProcessor'>>;

const ERROR_KEYS = {
  invalid_signature: 'err_invalid_signature',
  invalid_webhook_url: 'err_invalid_webhook_url',
  stale_timestamp: 'err_stale_timestamp',
  not_configured: 'err_not_configured',
  webhook_url_unknown: 'err_webhook_url_unknown',
  unknown_site: 'err_unknown_site',
  network_error: 'err_network_error',
  replayed_request: 'err_replayed_request',
  invalid_return_url: 'err_invalid_return_url',
} as const;

const REASON_KEYS = {
  disabled_here: 'reason_disabled_here',
  currency_not_offered: 'reason_currency_not_offered',
  not_returned_by_processor: 'reason_not_returned_by_processor',
  connection_failing: 'reason_connection_failing',
} as const satisfies Record<FpHiddenReason, string>;

const RESULT_KEYS = {
  applied: 'result_applied',
  duplicate: 'result_duplicate',
  mismatch: 'result_mismatch',
  error: 'result_error',
} as const satisfies Record<FpWebhookResult, string>;

const RESULT_PILLS = {
  applied: 'pill-published',
  duplicate: 'pill-draft',
  mismatch: 'pill-blocked',
  error: 'pill-blocked',
} as const satisfies Record<FpWebhookResult, string>;

const REFUND_KEYS = {
  none: 'refundsNone',
  full: 'refundsFull',
  partial: 'refundsPartial',
} as const;

/** What a processor error code means, in the panel's language; the API's own text otherwise. */
export function fpErrorText(t: Translator, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(ERROR_KEYS, code) ? t(ERROR_KEYS[code as keyof typeof ERROR_KEYS]) : null;
}

/** The same test the API applies to an icon: an https URL or a path on this site. */
function validIcon(value: string): boolean {
  return /^https:\/\/[^\s]+$/.test(value) || /^\/[^\s/][^\s]*$/.test(value);
}

function stamp(value: string): string {
  return value.slice(0, 16).replace('T', ' ');
}

export function FinalProcessorSettings() {
  const t = useT('finalProcessor');
  const [view, setView] = useState<AdminFpOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setRefreshing(refresh);
      try {
        setView(await api.fpOverview(refresh));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('loadFailed'));
      } finally {
        setRefreshing(false);
      }
    },
    [t],
  );

  // A read, cached for five minutes by the API. Never the connect POST.
  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <section className="vault-section fp-section" aria-labelledby="fp-heading">
      <h2 id="fp-heading">{t('heading')}</h2>
      <p className="lede-sm">{t('lede')}</p>

      {view?.testMode ? (
        <div className="fp-test-banner" role="status">
          <strong>{t('testModeBanner')}</strong>
          <span>{t('testModeHint')}</span>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {!view && !error ? <p className="meta loading-box">{t('refreshing')}</p> : null}

      {view ? (
        <>
          <ConfigPanel view={view} />
          <ConnectionPanel view={view} onConnected={() => void load(true)} />
          <MethodsPanel
            view={view}
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            onSaved={setView}
          />
        </>
      ) : null}

      <EventLog />
    </section>
  );
}

function ConfigPanel({ view }: { view: AdminFpOverview }) {
  const t = useT('finalProcessor');
  const envNames = [
    ['baseUrl', 'FP_BASE_URL'],
    ['siteId', 'FP_SITE_ID'],
    ['secret', 'FP_SECRET'],
    ['siteUrl', 'SITE_URL'],
  ] as const;

  return (
    <div className="detail-section">
      <h3 className="detail-heading">{t('configHeading')}</h3>
      <p className="meta">{t('envNote')}</p>
      <ul className="fp-env-list">
        {envNames.map(([key, name]) => (
          <li key={key}>
            <code dir="ltr">{name}</code>
            <span className={`pill ${view.env[key] ? 'pill-ready' : 'pill-blocked'}`}>
              {view.env[key] ? t('envPresent') : t('envMissing')}
            </span>
          </li>
        ))}
      </ul>
      {!view.env.configured ? <p className="notice">{t('envIncomplete')}</p> : null}
      <dl className="customer-facts fp-facts">
        <dt>{t('baseUrl')}</dt>
        <dd dir="ltr">{view.baseUrl ?? <span className="meta">{t('notSet')}</span>}</dd>
        <dt>{t('siteId')}</dt>
        <dd dir="ltr">{view.siteId ?? <span className="meta">{t('notSet')}</span>}</dd>
        <dt>{t('siteUrl')}</dt>
        <dd dir="ltr">{view.siteUrl ?? <span className="meta">{t('notSet')}</span>}</dd>
        <dt>{t('webhookUrl')}</dt>
        <dd dir="ltr">{view.webhookUrl ?? <span className="meta">{t('notSet')}</span>}</dd>
      </dl>
    </div>
  );
}

function ConnectionPanel({
  view,
  onConnected,
}: {
  view: AdminFpOverview;
  onConnected: () => void;
}) {
  const t = useT('finalProcessor');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AdminFpConnectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test(): Promise<void> {
    setTesting(true);
    setError(null);
    try {
      const answer = await api.fpConnect();
      setResult(answer);
      // The methods table reads the same processor; ask it again now the keys
      // are known to work, rather than showing a five-minute-old list.
      if (answer.connected) onConnected();
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : t('err_unknown'));
    } finally {
      setTesting(false);
    }
  }

  const last = view.connection;

  return (
    <div className="detail-section">
      <h3 className="detail-heading">{t('connectionHeading')}</h3>
      <p className="meta">
        {last.checkedAt
          ? t(last.ok ? 'lastCheckOk' : 'lastCheckFailed', { at: stamp(last.checkedAt) })
          : t('neverChecked')}
      </p>
      {!last.ok && last.errorCode && !result ? (
        <ConnectError t={t} code={last.errorCode} message={last.message} />
      ) : null}

      <div className="fp-connect">
        <button type="button" onClick={() => void test()} disabled={testing}>
          {testing ? t('testing') : t('testConnection')}
        </button>
        <span className="meta">{t('testHint')}</span>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {result?.connected ? (
        <div className="fp-result is-ok" role="status">
          <p>
            <span className="pill pill-ready">{t('connectedTo', { name: result.site.name })}</span>{' '}
            <span className="meta" dir="ltr">
              {t('connectedSite', { id: result.site.siteId })}
            </span>
          </p>
          <dl className="customer-facts fp-facts">
            <dt>{t('connectedWebhook')}</dt>
            <dd dir="ltr">{result.webhookUrl}</dd>
            <dt>{t('connectedCurrencies')}</dt>
            <dd dir="ltr">{result.currencies.join(', ')}</dd>
          </dl>
          <h4 className="fp-subhead">{t('connectedMethods')}</h4>
          {result.methods.length === 0 ? (
            <p className="notice">{t('connectedNoMethods')}</p>
          ) : (
            <ul className="fp-connected-methods">
              {result.methods.map((method) => (
                <li key={method.id}>
                  <strong>{method.label}</strong> <code dir="ltr">{method.id}</code>{' '}
                  <span className="meta" dir="ltr">
                    {method.currencies.join(', ')}
                  </span>{' '}
                  <span className={`pill ${method.testMode ? 'pill-draft' : 'pill-ready'}`}>
                    {method.testMode ? t('testBadge') : t('liveBadge')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {result && !result.connected ? (
        <div className="fp-result is-bad" role="alert">
          <p>
            <span className="pill pill-blocked">{t('notConnected')}</span>
          </p>
          <ConnectError t={t} code={result.errorCode} message={result.message} />
        </div>
      ) : null}
    </div>
  );
}

function ConnectError({
  t,
  code,
  message,
}: {
  t: Translator;
  code: string;
  message: string | null;
}) {
  const mapped = fpErrorText(t, code);
  return (
    <div className="fp-error">
      <p className="error">{mapped ?? message ?? t('err_unknown')}</p>
      {/* The API explains the code too, in the reader's language; shown when
          it adds to the mapped line rather than repeating it. */}
      {mapped && message && message !== mapped ? <p className="meta">{message}</p> : null}
      <p className="meta" dir="ltr">
        {t('errCode', { code })}
      </p>
    </div>
  );
}

function MethodsPanel({
  view,
  refreshing,
  onRefresh,
  onSaved,
}: {
  view: AdminFpOverview;
  refreshing: boolean;
  onRefresh: () => void;
  onSaved: (next: AdminFpOverview) => void;
}) {
  const t = useT('finalProcessor');
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="detail-section">
      <div className="fp-head">
        <h3 className="detail-heading">{t('methodsHeading')}</h3>
        <button type="button" className="ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      <p className="meta">{t('methodsLede')}</p>
      {note ? <p className="ok-note">{note}</p> : null}

      {view.methods.length === 0 ? (
        <p className="notice">{t('noMethods')}</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-table fp-methods-table">
            <thead>
              <tr>
                <th>{t('colMethod')}</th>
                <th>{t('colEnabled')}</th>
                <th>{t('colName')}</th>
                <th>{t('colIcon')}</th>
                <th>{t('colDescription')}</th>
                <th className="num">{t('colOrder')}</th>
                <th>{t('colVisibility')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {view.methods.map((method) => (
                <MethodRow
                  // Remounted when the stored customisation changes, so a save
                  // (or a refresh) resets the row's draft to what is stored.
                  key={`${method.id}:${JSON.stringify(method.config)}`}
                  method={method}
                  siteUrl={view.siteUrl}
                  onSaved={(next, name) => {
                    onSaved(next);
                    setNote(t('saved', { name }));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Draft {
  enabled: boolean;
  displayName: string;
  iconUrl: string;
  shortDescription: string;
  displayOrder: string;
}

function toDraft(method: AdminFpMethod): Draft {
  return {
    enabled: method.config.enabled,
    displayName: method.config.displayName ?? '',
    iconUrl: method.config.iconUrl ?? '',
    shortDescription: method.config.shortDescription ?? '',
    displayOrder: String(method.config.displayOrder),
  };
}

function MethodRow({
  method,
  siteUrl,
  onSaved,
}: {
  method: AdminFpMethod;
  siteUrl: string | null;
  onSaved: (next: AdminFpOverview, name: string) => void;
}) {
  const t = useT('finalProcessor');
  const [draft, setDraft] = useState<Draft>(() => toDraft(method));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = toDraft(method);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const icon = draft.iconUrl.trim();
  const iconOk = icon === '' || validIcon(icon);
  const order = Number(draft.displayOrder);
  const orderOk =
    /^\d{1,5}$/.test(draft.displayOrder.trim()) && Number.isInteger(order) && order <= 10_000;
  const processorLabel = method.processor?.label ?? method.id;
  const name = draft.displayName.trim() || processorLabel;

  // A site path is a path on the storefront, not on this panel.
  const previewSource = iconOk
    ? icon === ''
      ? (method.processor?.iconUrl ?? null)
      : icon.startsWith('/') && siteUrl
        ? `${siteUrl.replace(/\/$/, '')}${icon}`
        : icon
    : null;

  async function save(): Promise<void> {
    if (!iconOk || !orderOk) return;
    setSaving(true);
    setError(null);
    const body: UpdateFpMethod = {
      enabled: draft.enabled,
      displayName: draft.displayName.trim() || null,
      iconUrl: icon || null,
      shortDescription: draft.shortDescription.trim() || null,
      displayOrder: order,
    };
    try {
      onSaved(await api.saveFpMethod(method.id, body), name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <tr className={method.visible ? undefined : 'fp-row-hidden'}>
      <td>
        <strong>{processorLabel}</strong>
        <div className="fp-method-meta">
          <code dir="ltr">{method.id}</code>
          {method.processor ? (
            <>
              <span className={`pill ${method.processor.testMode ? 'pill-draft' : 'pill-ready'}`}>
                {method.processor.testMode ? t('testBadge') : t('liveBadge')}
              </span>
              <span className="meta">{t(REFUND_KEYS[method.processor.refunds])}</span>
              <span className="meta" dir="ltr">
                {method.processor.currencies.join(', ')}
              </span>
            </>
          ) : null}
        </div>
      </td>
      <td>
        <input
          type="checkbox"
          checked={draft.enabled}
          aria-label={t('enabledLabel', { name })}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
      </td>
      <td>
        <input
          type="text"
          value={draft.displayName}
          maxLength={80}
          placeholder={t('namePlaceholder', { label: processorLabel })}
          aria-label={t('colName')}
          onChange={(event) => set({ displayName: event.target.value })}
        />
      </td>
      <td>
        <div className="fp-icon-cell">
          <span className="fp-icon-preview">
            {previewSource ? (
              <img src={previewSource} alt={t('iconPreviewAlt', { name })} />
            ) : (
              <span className="meta">{t('noIcon')}</span>
            )}
          </span>
          <input
            type="text"
            dir="ltr"
            value={draft.iconUrl}
            maxLength={500}
            placeholder={t('iconPlaceholder')}
            aria-label={t('colIcon')}
            aria-invalid={!iconOk}
            onChange={(event) => set({ iconUrl: event.target.value })}
          />
        </div>
        {!iconOk ? <small className="warn">{t('iconInvalid')}</small> : null}
      </td>
      <td>
        <input
          type="text"
          value={draft.shortDescription}
          maxLength={200}
          aria-label={t('colDescription')}
          onChange={(event) => set({ shortDescription: event.target.value })}
        />
      </td>
      <td className="num">
        <input
          type="number"
          className="fp-order-input"
          dir="ltr"
          min={0}
          max={10_000}
          step={1}
          value={draft.displayOrder}
          aria-label={t('colOrder')}
          aria-invalid={!orderOk}
          onChange={(event) => set({ displayOrder: event.target.value })}
        />
        {!orderOk ? <small className="warn">{t('orderInvalid')}</small> : null}
      </td>
      <td>
        <span className={`pill ${method.visible ? 'pill-ready' : 'pill-blocked'}`}>
          {method.visible ? t('shown') : t('hidden')}
        </span>
        {method.hiddenReasons.length > 0 ? (
          <ul className="fp-reasons">
            {method.hiddenReasons.map((reason) => (
              <li key={reason}>{t(REASON_KEYS[reason])}</li>
            ))}
          </ul>
        ) : null}
      </td>
      <td className="actions">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || !iconOk || !orderOk}
        >
          {saving ? t('saving') : t('save')}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </td>
    </tr>
  );
}

/**
 * The notification log (B.5): the webhooks the processor sent and what this
 * shop did with each. Paged like the orders list — older and newer, with the
 * page number between.
 */
function EventLog() {
  const t = useT('finalProcessor');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminFpEventList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const loaded = await api.fpEvents(page);
        if (!live) return;
        setData(loaded);
        setError(null);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : t('eventsFailed'));
      }
    })();
    return () => {
      live = false;
    };
  }, [page, t]);

  return (
    <div className="detail-section">
      <h3 className="detail-heading">{t('eventsHeading')}</h3>
      <p className="meta">{t('eventsLede')}</p>
      {error ? <p className="error">{error}</p> : null}
      {data && data.rows.length === 0 ? <p className="notice">{t('eventsEmpty')}</p> : null}

      {data && data.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table fp-events-table">
            <thead>
              <tr>
                <th>{t('colTime')}</th>
                <th>{t('colType')}</th>
                <th>{t('colOrderRef')}</th>
                <th>{t('colResult')}</th>
                <th>{t('colEventId')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td dir="ltr">{stamp(row.createdAt)}</td>
                  <td>
                    <code dir="ltr">{row.type}</code>
                  </td>
                  <td dir="ltr">
                    {row.orderNumber ?? row.orderRef ?? (
                      <span className="meta">{t('unknownOrder')}</span>
                    )}
                  </td>
                  <td>
                    <span className={`pill ${RESULT_PILLS[row.result]}`}>
                      {t(RESULT_KEYS[row.result])}
                    </span>
                  </td>
                  <td>
                    <code dir="ltr" className="fp-event-id">
                      {row.eventId}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && (data.page > 1 || data.hasMore) ? (
        <nav className="pager" aria-label={t('pagerLabel')}>
          <button
            type="button"
            className="ghost"
            disabled={data.page <= 1}
            onClick={() => setPage(data.page - 1)}
          >
            {t('pagePrev')}
          </button>
          <span>{t('pageNumber', { page: data.page })}</span>
          <button
            type="button"
            className="ghost"
            disabled={!data.hasMore}
            onClick={() => setPage(data.page + 1)}
          >
            {t('pageNext')}
          </button>
        </nav>
      ) : null}
    </div>
  );
}
