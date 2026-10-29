'use client';

import type { ProductDeletion } from '@da/contracts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

type Status = 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Taking a product off the shop, retiring it, or removing it (TASK-0151).
 *
 * Three actions with three different costs, so three different confirmations:
 *
 * - Unpublish sends a published product back to draft. Its page answers 404,
 *   it leaves the sitemap and search, and publishing again brings it back.
 * - Archive retires it: the same, plus it leaves every chip but its own. The
 *   way out for a product that sold and cannot be deleted.
 * - Delete removes it for good, and only when it has no history. Typed slug.
 *
 * The API enforces all of it — the roles here only decide what is offered.
 * CATALOG may unpublish and archive; deleting is OWNER and ADMIN (owner,
 * 2026-10-29).
 */
export function ProductActions({
  slug,
  name,
  status,
  role,
  locale,
  onChanged,
  onDeleted,
  onError,
  hideUnpublish = false,
}: {
  slug: string;
  name: string;
  status: Status;
  role: string;
  locale: 'ar' | 'en';
  onChanged: (note: string) => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
  onError: (message: string) => void;
  /** The edit page has its own publish switch beside the menu. */
  hideUnpublish?: boolean;
}) {
  const t = useT('products');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [place, setPlace] = useState<{
    top?: number;
    bottom?: number;
    insetInlineEnd: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const canStatus = ['OWNER', 'ADMIN', 'CATALOG'].includes(role);
  const canDelete = ['OWNER', 'ADMIN'].includes(role);

  /*
   * Fixed, not absolute: the list sits in a horizontally scrolling table, and
   * an absolute menu on the last rows is clipped by it. Placed from the
   * trigger's box, at its inline end in either direction.
   */
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const below = window.innerHeight - box.bottom > 220;
    // `clientWidth`, not `innerWidth`: the latter counts the scrollbar, which
    // put the menu 15px off its trigger in English on Windows.
    const width = document.documentElement.clientWidth;
    setPlace({
      // Opening upwards anchors the menu's bottom edge, so its height is
      // whatever the items make it rather than a guess.
      ...(below ? { top: box.bottom + 6 } : { bottom: window.innerHeight - box.top + 6 }),
      insetInlineEnd: rtl ? box.left : width - box.right,
    });
  }, [open]);

  /*
   * Kept on screen. The trigger's edge is the right anchor in a table cell, but
   * on the edit page at phone width the trigger sits near the far edge and a
   * 220px menu anchored there ran off the screen. Measured once it exists,
   * and moved only when it is actually out, so this settles in one pass.
   */
  useLayoutEffect(() => {
    if (!open || !place || !menu.current) return;
    const box = menu.current.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const gutter = 8;
    const rtl = document.documentElement.dir === 'rtl';
    // Positive: how far the menu must move towards the inline end edge.
    const shift =
      box.left < gutter
        ? gutter - box.left
        : box.right > width - gutter
          ? width - gutter - box.right
          : 0;
    if (shift === 0) return;
    setPlace({ ...place, insetInlineEnd: place.insetInlineEnd + (rtl ? shift : -shift) });
  }, [open, place]);

  // Once the menu exists: the first item takes focus, as a menu's should.
  useEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function away(event: MouseEvent) {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      // Arrow keys move between the items, as `role="menu"` promises.
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      if (buttons.length === 0) return;
      event.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    }
    function close() {
      setOpen(false);
    }
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  async function move(next: 'DRAFT' | 'ARCHIVED', question: string, note: string) {
    setOpen(false);
    if (!window.confirm(question)) return;
    setBusy(true);
    try {
      await api.setStatus(slug, next, locale);
      await onChanged(note);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : t('actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (!canStatus) return null;

  const items: { key: string; label: string; danger?: boolean; run: () => void }[] = [];
  if (status === 'PUBLISHED' && !hideUnpublish)
    items.push({
      key: 'unpublish',
      label: t('actionUnpublish'),
      run: () =>
        void move('DRAFT', t('confirmUnpublish', { name }), t('unpublishedRowNote', { name })),
    });
  if (status === 'ARCHIVED')
    items.push({
      key: 'restore',
      label: t('actionRestore'),
      run: () => void move('DRAFT', t('confirmRestore', { name }), t('restoredNote', { name })),
    });
  else
    items.push({
      key: 'archive',
      label: t('actionArchive'),
      run: () => void move('ARCHIVED', t('confirmArchive', { name }), t('archivedNote', { name })),
    });
  if (canDelete)
    items.push({
      key: 'delete',
      label: t('actionDelete'),
      danger: true,
      run: () => {
        setOpen(false);
        setDeleting(true);
      },
    });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="ghost row-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('moreActions', { name })}
        title={t('moreActions', { name })}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
          <circle cx="4" cy="10" r="1.8" />
          <circle cx="10" cy="10" r="1.8" />
          <circle cx="16" cy="10" r="1.8" />
        </svg>
      </button>
      {open && place ? (
        <div
          ref={menu}
          className="menu row-menu"
          role="menu"
          style={{ position: 'fixed', ...place }}
        >
          {items.map((item, index) => (
            <span key={item.key} className="row-menu__entry">
              {item.danger && index > 0 ? <span className="menu__divider" /> : null}
              <button
                type="button"
                role="menuitem"
                className={`menu__item${item.danger ? ' is-danger' : ''}`}
                onClick={item.run}
              >
                {item.label}
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {deleting ? (
        <DeleteProductDialog
          slug={slug}
          name={name}
          status={status}
          locale={locale}
          onClose={() => {
            setDeleting(false);
            trigger.current?.focus();
          }}
          onArchived={async () => {
            setDeleting(false);
            await onChanged(t('archivedNote', { name }));
          }}
          onDeleted={async () => {
            setDeleting(false);
            await onDeleted();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The delete confirmation.
 *
 * Asks the API first what would go and what would stop it, so the dialog
 * never offers a delete the server will refuse — and when it would, it says
 * why and offers the archive in the same place.
 */
function DeleteProductDialog({
  slug,
  name,
  status,
  locale,
  onClose,
  onArchived,
  onDeleted,
}: {
  slug: string;
  name: string;
  status: Status;
  locale: 'ar' | 'en';
  onClose: () => void;
  onArchived: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const t = useT('products');
  const c = useT('common');
  const dialog = useRef<HTMLDialogElement>(null);
  const [check, setCheck] = useState<ProductDeletion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    api
      .productDeletion(slug)
      .then((result) => {
        if (live) setCheck(result);
      })
      .catch((caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : t('actionFailed'));
      });
    return () => {
      live = false;
    };
  }, [slug, t]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteProduct(slug, typed);
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('actionFailed'));
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api.setStatus(slug, 'ARCHIVED', locale);
      await onArchived();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('actionFailed'));
      setBusy(false);
    }
  }

  const history = check
    ? [
        [t('historyOrders'), check.history.orderLines],
        [t('historyKeys'), check.history.licenseKeys + check.history.keyImports],
        [t('historyReviews'), check.history.reviews],
      ].filter(([, count]) => Number(count) > 0)
    : [];
  const removes = check
    ? [
        [t('removesVariants'), check.removes.variants],
        [t('removesCartLines'), check.removes.cartLines],
        [t('removesStockAlerts'), check.removes.stockAlerts],
        [t('removesSupplierLinks'), check.removes.supplierLinks],
      ].filter(([, count]) => Number(count) > 0)
    : [];

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby="delete-product-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="delete-product-title">{t('deleteTitle', { name })}</h2>

      {!check && !error ? <p className="meta">{c('loading')}</p> : null}

      {check && !check.deletable ? (
        <>
          <p>{t('deleteRefused')}</p>
          <ul className="confirm-dialog__facts">
            {history.map(([label, count]) => (
              <li key={String(label)}>
                <span>{label}</span>
                <strong className="num">{count}</strong>
              </li>
            ))}
          </ul>
          <p className="meta">{t('deleteRefusedArchive')}</p>
        </>
      ) : null}

      {check?.deletable ? (
        <>
          <p>{t('deleteLede')}</p>
          {removes.length > 0 ? (
            <ul className="confirm-dialog__facts">
              {removes.map(([label, count]) => (
                <li key={String(label)}>
                  <span>{label}</span>
                  <strong className="num">{count}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="confirm-dialog__type">
            <span>{t('deleteTypeSlug')}</span>
            <code dir="ltr">{slug}</code>
            <input
              dir="ltr"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
        </>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="confirm-dialog__actions">
        <button type="button" className="ghost" disabled={busy} onClick={onClose}>
          {c('cancel')}
        </button>
        {check && !check.deletable && status !== 'ARCHIVED' ? (
          <button type="button" disabled={busy} onClick={() => void archive()}>
            {busy ? c('busy') : t('archiveInstead')}
          </button>
        ) : null}
        {check?.deletable ? (
          <button
            type="button"
            className="danger-solid"
            disabled={busy || typed !== slug}
            onClick={() => void remove()}
          >
            {busy ? c('busy') : t('deleteForever')}
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
