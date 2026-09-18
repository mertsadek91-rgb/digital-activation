'use client';

import type {
  CredentialKind,
  OrderKeysRow,
  RevealResult,
  StaffMe,
  VaultStockRow,
} from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The vault.
 *
 * Two jobs, and they are different enough to be separate halves of the screen.
 *
 * Stocking: for the nine variants held in hand, paste the block a supplier
 * sent and the vault takes in what is new and reports what it refused. That
 * report matters more than the success count — a supplier resending a block is
 * routine, and a duplicate stored twice is a licence sold twice.
 *
 * Answering a complaint: a customer writes in with an order number, and the
 * person answering needs to know whether a key went out, when, and — only if
 * they must — what it says. So reading a key is deliberate: a reason is
 * required, the TOTP challenge has to be fresh, and it is shown once without
 * being kept in any state that survives leaving the page.
 */
export default function VaultPage() {
  const router = useRouter();
  const t = useT('vault');
  const c = useT('common');
  const [me, setMe] = useState<StaffMe | null>(null);
  const [stock, setStock] = useState<VaultStockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStock(await api.vaultStock());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [router, t]);

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

  const canStock = ['OWNER', 'ADMIN', 'FULFILLMENT'].includes(me.role);
  // Not FULFILLMENT: changing the shape changes how every future key for the
  // line is stored and labelled, which is a catalog decision, not a queue one.
  const canEditKind = ['OWNER', 'ADMIN', 'CATALOG'].includes(me.role);
  const canReveal = ['OWNER', 'ADMIN'].includes(me.role);
  const stocked = (stock ?? []).filter((row) => row.mode === 'FROM_STOCK');
  const others = (stock ?? []).filter((row) => row.mode !== 'FROM_STOCK');

  return (
    <Nav me={me} current="vault">
      <h1>{t('title')}</h1>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}

      <section className="vault-section">
        <h2>{t('stockHeading')}</h2>
        <p className="lede-sm"> {t('stockLede')}</p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('colVariant')}</th>
                <th>{t('colDeliveredAs')}</th>
                <th className="num">{t('colAvailable')}</th>
                <th className="num">{t('colAssigned')}</th>
                <th className="num">{t('colDelivered')}</th>
                <th className="num">{t('colRevoked')}</th>
                <th className="num">{t('colExpired')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stocked.map((row) => (
                <StockRow
                  key={row.variantId}
                  row={row}
                  canStock={canStock}
                  canEditKind={canEditKind}
                  onKindSaved={() => void load()}
                  onNote={setNote}
                  onImported={(result) => {
                    setError(null);
                    setNote(
                      t('imported', {
                        sku: row.sku,
                        imported: result.imported,
                        duplicates: result.duplicatesSkipped,
                        invalid: result.invalidSkipped,
                      }),
                    );
                    void load();
                  }}
                  onError={setError}
                />
              ))}
              {stocked.length === 0 && stock ? (
                <tr>
                  <td colSpan={8} className="meta">
                    {' '}
                    {t('noStockedVariants')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Listed, not hidden. The owner may decide to start holding stock of
            one of these, and a screen that omits them cannot be used to make
            that decision. */}
        {others.length > 0 ? (
          <details className="vault-others">
            <summary>{t('othersSummary', { count: others.length })}</summary>
            <ul className="vault-other-list">
              {others.map((row) => (
                <li key={row.variantId}>
                  <span className="slug" dir="ltr">
                    {row.sku}
                  </span>
                  <span className="meta">
                    {' '}
                    {row.mode === 'ON_DEMAND' ? t('modeOnDemand') : t('modeManual')}
                  </span>
                  {/* Editable here too. These 92 never hold stock, but the
                      supplier still sends back either a key or an account, and
                      that is what the paste box has to ask for. */}
                  <KindPicker
                    row={row}
                    canEdit={canEditKind}
                    onSaved={() => void load()}
                    onError={setError}
                    onNote={setNote}
                  />
                  {Object.keys(row.counts).length > 0 ? (
                    <span className="meta">
                      {t('contains', {
                        counts: Object.entries(row.counts)
                          .map(([k, v]) => `${k}:${String(v)}`)
                          .join(' '),
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="vault-section">
        <h2>{t('lookupHeading')}</h2>
        <p className="lede-sm"> {t('lookupLede')}</p>
        <OrderLookup canReveal={canReveal} onError={setError} onNote={setNote} />
      </section>
    </Nav>
  );
}

/**
 * The delivery-shape picker.
 *
 * Saves on change rather than behind a save button: it is one field with two
 * values, and a form around it would be three clicks for a decision that is
 * one. The server refuses the change while the vault still holds keys under
 * the other shape, and that refusal is the message shown — flipping the field
 * alone would leave stored rows describing themselves one way and the variant
 * claiming another, and the email would then label a password as a key.
 */
function KindPicker({
  row,
  canEdit,
  onSaved,
  onError,
  onNote,
}: {
  row: VaultStockRow;
  canEdit: boolean;
  onSaved: () => void;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const t = useT('vault');
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <span
        className={`pill ${row.credentialKind === 'ACCOUNT_CREDENTIALS' ? 'pill-ready' : 'pill-published'}`}
      >
        {kindLabel(row.credentialKind, t)}
      </span>
    );
  }

  return (
    <select
      className="kind-picker"
      value={row.credentialKind}
      disabled={busy}
      aria-label={t('kindPickerLabel', { sku: row.sku })}
      onChange={(event) => {
        const next = event.target.value as CredentialKind;
        if (next === row.credentialKind) return;
        setBusy(true);
        onError(null);
        void api
          .setCredentialKind(row.sku, next)
          .then(() => {
            onNote(t('kindChanged', { sku: row.sku, kind: kindLabel(next, t) }));
            onSaved();
          })
          .catch((caught: unknown) => {
            onError(caught instanceof Error ? caught.message : t('kindChangeFailed'));
          })
          .finally(() => setBusy(false));
      }}
    >
      <option value="ACTIVATION_KEY">{t('kindActivationKey')}</option>
      <option value="ACCOUNT_CREDENTIALS">{t('kindAccountCredentials')}</option>
    </select>
  );
}

function StockRow({
  row,
  canStock,
  canEditKind,
  onImported,
  onKindSaved,
  onError,
  onNote,
}: {
  row: VaultStockRow;
  canStock: boolean;
  canEditKind: boolean;
  onImported: (result: {
    imported: number;
    duplicatesSkipped: number;
    invalidSkipped: number;
  }) => void;
  onKindSaved: () => void;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const t = useT('vault');
  const c = useT('common');
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState('');
  const [cost, setCost] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);

  const available = row.counts.AVAILABLE ?? 0;
  const isAccount = row.credentialKind === 'ACCOUNT_CREDENTIALS';
  const lines = codes.split(/\r?\n/).filter((line) => line.trim().length > 0).length;

  return (
    <>
      <tr>
        <td>
          <span className="name">{row.productName}</span>
          <span className="slug" dir="ltr">
            {row.sku}
          </span>
        </td>
        <td>
          <KindPicker
            row={row}
            canEdit={canEditKind}
            onSaved={onKindSaved}
            onError={onError}
            onNote={onNote}
          />
        </td>
        {/* Zero available on a stocked variant is a product that will sell and
            then sit in the manual queue, so it reads as a problem. */}
        <td className={`num${available === 0 ? ' is-zero' : ''}`}>{available}</td>
        <td className="num">{row.counts.ASSIGNED ?? 0}</td>
        <td className="num">{row.counts.DELIVERED ?? 0}</td>
        <td className="num">{row.counts.REVOKED ?? 0}</td>
        <td className="num">{row.counts.EXPIRED ?? 0}</td>
        <td className="actions">
          {canStock ? (
            <button type="button" className="ghost" onClick={() => setOpen(!open)}>
              {open ? c('cancel') : isAccount ? t('enterAccounts') : t('enterKeys')}
            </button>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="drawer">
          <td colSpan={8}>
            <form
              className="paste-form"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void api
                  .importKeys(
                    row.variantId,
                    codes,
                    cost.trim() || undefined,
                    expires ? new Date(expires).toISOString() : undefined,
                  )
                  .then((result) => {
                    onImported(result);
                    setCodes('');
                    setCost('');
                    setExpires('');
                    setOpen(false);
                  })
                  .catch((caught: unknown) => {
                    onError(caught instanceof Error ? caught.message : t('importFailed'));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label className="grow">
                {' '}
                {isAccount ? t('accountsLabel') : t('keysLabel')}
                <textarea
                  value={codes}
                  onChange={(event) => setCodes(event.target.value)}
                  rows={6}
                  dir="ltr"
                  required
                  minLength={4}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    isAccount
                      ? 'user1@example.com:password\nuser2@example.com:password'
                      : 'AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH'
                  }
                />
                <small>
                  {' '}
                  {lines > 0 ? t('lineCount', { count: lines }) : ''}
                  {/* The split rule, stated where it is used. A password with a
                      colon in it is normal, and "first separator wins" is the
                      only reading that survives one. */}{' '}
                  {isAccount ? t('accountSplitHint') : ''}
                  {t('duplicateHint')}
                </small>
              </label>
              <label>
                {t('unitCost')}
                <input
                  type="text"
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  placeholder="12.50"
                  dir="ltr"
                  pattern="\d+(\.\d{1,2})?"
                />
              </label>
              <label>
                {t('expiresAt')}
                <input
                  type="date"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                  dir="ltr"
                />
                <small>{t('expiresHint')}</small>
              </label>
              <button type="submit" disabled={busy || lines === 0}>
                {busy ? c('busy') : t('importSubmit')}
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Looking up an order, and reading a key when there is no other way.
 *
 * The reveal keeps the plaintext in component state only, and clearing it is
 * one click. It is not written anywhere, and leaving the page loses it — which
 * is the right default for something that cannot be un-shown.
 */
function OrderLookup({
  canReveal,
  onError,
  onNote,
}: {
  canReveal: boolean;
  onError: (message: string | null) => void;
  onNote: (message: string) => void;
}) {
  const t = useT('vault');
  const c = useT('common');
  const [number, setNumber] = useState('');
  const [lines, setLines] = useState<OrderKeysRow[] | null>(null);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState<{ id: string; secret: RevealResult } | null>(null);
  const [stepUp, setStepUp] = useState<{ keyId: string } | null>(null);
  const [totp, setTotp] = useState('');
  const [history, setHistory] = useState<{
    id: string;
    rows: { action: string; actorId: string | null; createdAt: string }[];
  } | null>(null);

  async function lookup(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    // A banner from the previous attempt outlives its subject: a refusal left
    // on screen beside a key that has just been revealed reads as a failure.
    onError(null);
    setShown(null);
    setLines(null);
    try {
      setLines(await api.orderKeys(number.trim()));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('lookupFailed'));
    }
  }

  async function reveal(keyId: string): Promise<void> {
    if (reason.trim().length < 3) {
      onError(t('reasonFirst'));
      return;
    }
    try {
      const result = await api.revealKey(keyId, reason.trim());
      onError(null);
      setShown({ id: keyId, secret: result });
      setStepUp(null);
      setTotp('');
    } catch (caught) {
      // A stale challenge is the expected refusal, not a failure: ask for a
      // code and try again rather than sending the person back to the login.
      if (caught instanceof ApiError && caught.status === 403) {
        setStepUp({ keyId });
        return;
      }
      onError(caught instanceof Error ? caught.message : t('revealFailed'));
    }
  }

  return (
    <>
      <form className="lookup-form" onSubmit={(event) => void lookup(event)}>
        <label>
          {t('orderNumber')}
          <input
            type="text"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="DA-2026-00001"
            dir="ltr"
            required
          />
        </label>
        <button type="submit">{c('search')}</button>
      </form>

      {lines && lines.length === 0 ? <p className="notice">{t('noLines')}</p> : null}

      {(lines ?? []).map((line) => (
        <div key={line.orderItemId} className="key-line">
          <p className="queue-product">{line.productName}</p>
          <p className="slug" dir="ltr">
            {line.sku} · {line.state}{' '}
            {line.deliveredAt
              ? t('deliveredAt', { at: line.deliveredAt.slice(0, 16).replace('T', ' ') })
              : ''}
          </p>

          {line.keys.length === 0 ? (
            <p className="meta">{t('noKeyForLine')}</p>
          ) : (
            <ul className="key-list">
              {line.keys.map((key) => (
                <li key={key.licenseKeyId}>
                  <span className="slug" dir="ltr">
                    {key.licenseKeyId}
                  </span>
                  <span className="pill pill-draft">{key.state}</span>

                  {canReveal ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void reveal(key.licenseKeyId)}
                      >
                        {t('readKey')}
                      </button>
                      <button
                        type="button"
                        className="linky"
                        onClick={() => {
                          void api
                            .keyHistory(key.licenseKeyId)
                            .then((rows) => setHistory({ id: key.licenseKeyId, rows }))
                            .catch(() => onError(t('historyFailed')));
                        }}
                      >
                        {t('history')}
                      </button>
                    </>
                  ) : null}

                  {shown?.id === key.licenseKeyId ? (
                    <div className="revealed">
                      {/* Labelled, not run together. Reading a password back to
                          a customer off a screen that does not say which half
                          is which is how the wrong half gets read out. */}
                      <div className="revealed-parts">
                        {shown.secret.kind === 'ACCOUNT_CREDENTIALS' ? (
                          <>
                            <p>
                              <span>{t('revealUsername')}</span>
                              <strong dir="ltr">{shown.secret.username}</strong>
                            </p>
                            <p>
                              <span>{t('revealPassword')}</span>
                              <strong dir="ltr">{shown.secret.password}</strong>
                            </p>
                          </>
                        ) : (
                          <p>
                            <span>{t('revealKey')}</span>
                            <strong dir="ltr">{shown.secret.key}</strong>
                          </p>
                        )}
                      </div>
                      <button type="button" className="linky" onClick={() => setShown(null)}>
                        {c('hide')}
                      </button>
                    </div>
                  ) : null}

                  {history?.id === key.licenseKeyId ? (
                    <ul className="key-history">
                      {history.rows.map((entry, index) => (
                        <li key={`${entry.createdAt}-${String(index)}`}>
                          {entry.action} · {entry.createdAt.slice(0, 16).replace('T', ' ')}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {canReveal && lines && lines.length > 0 ? (
        <label className="reason-field">
          {t('reasonLabel')}
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('reasonPlaceholder')}
          />
        </label>
      ) : null}

      {stepUp ? (
        <form
          className="paste-form stepup"
          onSubmit={(event) => {
            event.preventDefault();
            void api
              .stepUp(totp)
              .then(() => reveal(stepUp.keyId))
              .catch((caught: unknown) => {
                onError(caught instanceof Error ? caught.message : t('stepUpBadCode'));
              });
          }}
        >
          <label>
            {t('stepUpLabel')}
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totp}
              onChange={(event) => setTotp(event.target.value.replace(/\D/g, ''))}
              className="code-input"
              dir="ltr"
              autoFocus
              required
            />{' '}
            <small>{t('stepUpHint')}</small>
          </label>
          <button type="submit" disabled={totp.length !== 6}>
            {t('stepUpSubmit')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setStepUp(null);
              setTotp('');
              onNote(t('revealCancelled'));
            }}
          >
            {c('cancel')}
          </button>
        </form>
      ) : null}
    </>
  );
}

/** What the customer will receive, in two words. */
function kindLabel(kind: CredentialKind, t: ReturnType<typeof useT<'vault'>>): string {
  return kind === 'ACCOUNT_CREDENTIALS' ? t('kindShortAccount') : t('kindShortKey');
}
