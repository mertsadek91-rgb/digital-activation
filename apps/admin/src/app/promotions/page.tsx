'use client';

import type { AdminPromotion, AdminPromotionList, StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * Coupons.
 *
 * The buying side of this has worked since the cart was built — a code is
 * validated, its rules are enforced, the discount is computed against the
 * eligible lines and capped, the redemption is recorded. What never existed is
 * anywhere to make one, so the store could honour codes nobody could issue.
 *
 * Two things decide the shape of this screen.
 *
 * The number beside a code is not its value. A live coupon raises exactly one
 * question — is it working, and what is it costing — so every row carries what
 * it has actually given away against the revenue it sat on. A 20% code with
 * nine redemptions and $1,800 behind it is a different object from the same
 * code with four hundred redemptions and $900.
 *
 * And "off" is the loudest control here, which is why it is one click on the
 * row rather than something inside an edit form. The reason somebody opens
 * this screen in a hurry is that a code is being shared where it should not
 * be, and every second of that is money.
 */
const STATE_KEYS = {
  LIVE: 'stateLive',
  SCHEDULED: 'stateScheduled',
  EXPIRED: 'stateExpired',
  EXHAUSTED: 'stateExhausted',
  OFF: 'stateOff',
} as const satisfies Record<AdminPromotion['state'], string>;

const STATE_PILL: Record<AdminPromotion['state'], string> = {
  LIVE: 'pill-published',
  SCHEDULED: 'pill-draft',
  EXPIRED: 'pill-draft',
  EXHAUSTED: 'pill-draft',
  OFF: 'pill-blocked',
};

const TYPE_KEYS = {
  PERCENT: 'typePercent',
  FIXED: 'typeFixed',
  FREE_ITEM: 'typeFreeItem',
  BUNDLE_DISCOUNT: 'typeBundleDiscount',
} as const satisfies Record<AdminPromotion['type'], string>;

const FILTERS = [
  { key: 'live', label: 'filterLive' },
  { key: 'scheduled', label: 'filterScheduled' },
  { key: 'finished', label: 'filterFinished' },
  { key: 'off', label: 'filterOff' },
  { key: 'all', label: 'filterAll' },
] as const;

export default function PromotionsPage() {
  const router = useRouter();
  const t = useT('promotions');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [data, setData] = useState<AdminPromotionList | null>(null);
  const [filter, setFilter] = useState('live');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.promotions(filter));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [filter, router, t]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  // The API refuses a write from anything else, so the buttons are hidden
  // rather than offered and then refused.
  const canWrite = ['OWNER', 'ADMIN'].includes(me.role);

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setError(null);
    setNote(null);
    try {
      await run();
      setNote(label);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }

  return (
    <Nav me={me} current="promotions">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">
          {' '}
          {data
            ? t('summary', {
                live: data.counts.live,
                scheduled: data.counts.scheduled,
                all: data.counts.all,
              })
            : c('loading')}
        </p>
      </div>

      <div className="store-bar">
        <nav className="sorts" aria-label={c('filter')}>
          {FILTERS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`tab${filter === entry.key ? ' is-active' : ''}`}
              onClick={() => setFilter(entry.key)}
            >
              {t(entry.label)}
            </button>
          ))}
        </nav>

        {canWrite ? (
          <button type="button" className="ghost" onClick={() => setCreating(!creating)}>
            {creating ? c('cancel') : t('newCode')}
          </button>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWrite ? <p className="notice"> {t('roleReadonly', { role: me.role })}</p> : null}

      {creating ? (
        <NewPromotion
          onCancel={() => setCreating(false)}
          onCreated={(code) => {
            setCreating(false);
            void act(t('created', { code }), () => Promise.resolve());
          }}
          onError={setError}
        />
      ) : null}

      {data && data.rows.length === 0 ? <p className="notice">{t('empty')}</p> : null}

      <ul className="queue-list">
        {(data?.rows ?? []).map((row) => (
          <PromotionCard
            key={row.id}
            row={row}
            canWrite={canWrite}
            onToggle={() =>
              void act(
                row.isActive
                  ? t('turnedOff', { code: row.code ?? row.name })
                  : t('turnedOn', { code: row.code ?? row.name }),
                () => api.updatePromotion(row.id, { isActive: !row.isActive }),
              )
            }
            onLimit={(usageLimit) =>
              void act(t('limitChanged', { code: row.code ?? row.name }), () =>
                api.updatePromotion(row.id, { usageLimit }),
              )
            }
          />
        ))}
      </ul>
    </Nav>
  );
}

function PromotionCard({
  row,
  canWrite,
  onToggle,
  onLimit,
}: {
  row: AdminPromotion;
  canWrite: boolean;
  onToggle: () => void;
  onLimit: (usageLimit: number | null) => void;
}) {
  const t = useT('promotions');
  const c = useT('common');
  const [limiting, setLimiting] = useState(false);
  const [limit, setLimit] = useState(String(row.usageLimit ?? ''));

  const money = row.type === 'FIXED';
  const headline = money ? `$${row.value}` : `${Number(row.value)}%`;

  return (
    <li className={`queue-card${row.state === 'LIVE' ? '' : ' is-muted'}`}>
      <div className="queue-card-main">
        <p className="queue-order">
          <span dir="ltr" className="coupon-code">
            {row.code ?? t('automatic')}
          </span>
          <span className={`pill ${STATE_PILL[row.state]}`}>{t(STATE_KEYS[row.state])}</span>
          <span className="meta">{t(TYPE_KEYS[row.type])}</span>
        </p>

        <p className="queue-product">
          {headline}
          <span className="meta"> · {row.name}</span>
        </p>

        <dl className="queue-meta">
          {/* What it has done, which is the only reason to look at a live code. */}
          <div>
            <dt>{t('redeemed')}</dt>{' '}
            <dd>
              {row.usageLimit === null
                ? t.tp('redeemedTimes', row.redeemed)
                : t('redeemedOfLimit', { count: row.redeemed, limit: row.usageLimit })}
            </dd>
          </div>
          <div>
            <dt>{t('discountGiven')}</dt>
            <dd dir="ltr">${row.discountedUsd}</dd>
          </div>
          <div>
            <dt>{t('revenueAlongside')}</dt>
            <dd dir="ltr">${row.revenueUsd}</dd>
          </div>
          {row.endsAt ? (
            <div>
              <dt>{t('endsAt')}</dt>
              <dd>{row.endsAt.slice(0, 10)}</dd>
            </div>
          ) : null}
          {row.rules.minTotalUsd !== undefined ? (
            <div>
              <dt>{t('minCart')}</dt>
              <dd dir="ltr">${row.rules.minTotalUsd}</dd>
            </div>
          ) : null}
          {row.rules.maxDiscountUsd !== undefined ? (
            <div>
              <dt>{t('maxDiscount')}</dt>
              <dd dir="ltr">${row.rules.maxDiscountUsd}</dd>
            </div>
          ) : null}
          {row.rules.firstOrderOnly ? (
            <div>
              <dt>{t('condition')}</dt>
              <dd>{t('firstOrderOnlyValue')}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {canWrite ? (
        <div className="actions">
          {/* The control somebody opens this screen in a hurry to use. */}
          <button type="button" onClick={onToggle}>
            {row.isActive ? t('turnOff') : t('turnOn')}
          </button>
          <button type="button" onClick={() => setLimiting(!limiting)}>
            {limiting ? c('cancel') : t('usageLimit')}
          </button>

          {limiting ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const parsed = Number.parseInt(limit, 10);
                onLimit(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                setLimiting(false);
              }}
            >
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                placeholder={t('noLimit')}
                aria-label={t('usageLimit')}
              />
              <button type="submit" className="ghost">
                {c('save')}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Minting one.
 *
 * Deliberately short. Everything `Promotion.rules` can express is not on this
 * form — a cart minimum and a discount cap are, because those two are what
 * protects margin on a percentage code and both are asked for every time. The
 * rest are product and category lists that need a picker this panel does not
 * have yet, and a half-built picker that silently saves the wrong ids would be
 * worse than none.
 */
function NewPromotion({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: (code: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT('promotions');
  const c = useT('common');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  const percent = type === 'PERCENT';
  const numeric = Number(value);
  const tooHigh = percent && Number.isFinite(numeric) && numeric > 100;

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api.createPromotion({
        code: code.trim() || undefined,
        name: name.trim(),
        type,
        scope: 'CART',
        value: Number(value).toFixed(2),
        // A date input gives a day, and a coupon ends at the end of that day
        // rather than at midnight starting it — otherwise "ends 31 December"
        // stops working on the 30th.
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : undefined,
        usageLimit: usageLimit ? Number.parseInt(usageLimit, 10) : undefined,
        perCustomerLimit: 1,
        isActive: true,
        rules: {
          ...(minTotal ? { minTotalUsd: Number(minTotal).toFixed(2) } : {}),
          ...(maxDiscount ? { maxDiscountUsd: Number(maxDiscount).toFixed(2) } : {}),
          firstOrderOnly,
          excludeDiscounted: false,
          stackable: false,
        },
      });
      onCreated(code.trim() || name.trim());
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="vault-section">
      <h2>{t('newHeading')}</h2>
      <p className="lede-sm"> {t('newLede')}</p>

      <form
        className="promo-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooHigh) void submit();
        }}
      >
        <label className="field">
          <span>{t('codeLabel')}</span>
          <input
            dir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="RAMADAN20"
            maxLength={40}
          />
          <small>{t('codeHint')}</small>
        </label>

        <label className="field">
          <span>{t('nameLabel')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('namePlaceholder')}
            required
            maxLength={120}
          />
        </label>

        <label className="field">
          <span>{t('typeLabel')}</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value === 'FIXED' ? 'FIXED' : 'PERCENT')}
          >
            <option value="PERCENT">{t('typePercent')}</option>
            <option value="FIXED">{t('typeFixedUsd')}</option>
          </select>
        </label>

        <label className="field">
          <span>{percent ? t('percentLabel') : t('amountLabel')}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
          {tooHigh ? <small className="bad">{t('percentTooHigh')}</small> : null}
        </label>

        <label className="field">
          <span>{t('endsAtLabel')}</span>
          <input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          <small>{t('endsAtHint')}</small>
        </label>

        <label className="field">
          <span>{t('usageCountLabel')}</span>
          <input
            type="number"
            min="1"
            dir="ltr"
            value={usageLimit}
            onChange={(event) => setUsageLimit(event.target.value)}
            placeholder={t('noLimit')}
          />
        </label>

        <label className="field">
          <span>{t('minCartLabel')}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            value={minTotal}
            onChange={(event) => setMinTotal(event.target.value)}
            placeholder={t('noLimit')}
          />
        </label>

        {/* The one field that stops a percentage code costing more than it
            earns on a large cart. */}
        <label className="field">
          <span>{t('maxDiscountLabel')}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            value={maxDiscount}
            onChange={(event) => setMaxDiscount(event.target.value)}
            placeholder={t('noCeiling')}
          />
          <small>{t('maxDiscountHint')}</small>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={firstOrderOnly}
            onChange={(event) => setFirstOrderOnly(event.target.checked)}
          />
          <span>{t('firstOrderOnly')}</span>
        </label>

        <div className="actions">
          <button type="submit" disabled={busy || tooHigh}>
            {busy ? c('loading') : t('create')}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            {c('cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}
