'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';

import { LocaleSwitcher } from '../i18n/locale-switcher';
import { useT } from '../i18n/provider';
import { api } from '../lib/api';

/**
 * Admin navigation.
 *
 * Carries a live count of the work waiting in the supplier queue, because that
 * is the number a person running this shop needs in front of them: every one
 * of those is a customer who has paid and is waiting. It is loaded here rather
 * than passed in so every screen shows it without threading it through.
 */
export function Nav({
  me,
  current,
  /**
   * The queue page already has these numbers and they change as it is worked,
   * so it passes them down. Without that the badge is a snapshot from page
   * load: deliver a line and it still claims the old count, which is the same
   * stale-sibling problem the storefront header had.
   *
   * Omitted elsewhere, where the nav fetches them itself.
   */
  waiting: given,
  overdue: givenOverdue,
  /**
   * The same arrangement for the inbox, and for the same reason: the messages
   * screen changes this number by marking one answered, and a badge that
   * fetched on mount goes on claiming the old count beside a page that has
   * already updated.
   */
  messagesWaiting: givenMessages,
  messagesOverdue: givenMessagesOverdue,
  /** Same arrangement again, for the reviews the moderation screen is working. */
  reviewsPending: givenReviews,
  children,
}: {
  me: StaffMe;
  children: React.ReactNode;
  current:
    | 'dashboard'
    | 'launch'
    | 'products'
    | 'categories'
    | 'orders'
    | 'queue'
    | 'vault'
    | 'reviews'
    | 'messages'
    | 'payments'
    | 'promotions'
    | 'redirects'
    | 'contentPages'
    | 'contentBlog'
    | 'contentBrands';
  waiting?: number;
  overdue?: number;
  messagesWaiting?: number;
  messagesOverdue?: number;
  reviewsPending?: number;
}) {
  const router = useRouter();
  const t = useT('nav');
  const [fetched, setFetched] = useState<{ waiting: number; overdue: number } | null>(null);
  /**
   * Unanswered messages, always fetched here rather than passed in.
   *
   * Unlike the queue count, no screen owns this number: a message can arrive
   * while somebody is working the vault, and the tab is the only place that
   * would say so.
   */
  const [messages, setMessages] = useState<{ waiting: number; overdue: number } | null>(null);
  /**
   * Reviews waiting to be read.
   *
   * Unpublished until somebody looks at them, so a badge nobody sees is a
   * customer who wrote something the store never printed — which is the one
   * failure mode of moderating by default.
   */
  const [reviews, setReviews] = useState<number | null>(null);

  useEffect(() => {
    if (given !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const queue = await api.queue(false);
        if (cancelled) return;
        setFetched({
          waiting: queue.waiting,
          overdue: queue.rows.filter((row) => row.overdue).length,
        });
      } catch {
        // A badge that cannot load shows nothing. Nothing here depends on it,
        // and a role without access to the queue is a normal case.
        if (!cancelled) setFetched(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, given]);

  useEffect(() => {
    if (givenMessages !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const inbox = await api.messages(false);
        if (!cancelled) setMessages({ waiting: inbox.waiting, overdue: inbox.overdue });
      } catch {
        if (!cancelled) setMessages(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, givenMessages]);

  useEffect(() => {
    if (givenReviews !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const list = await api.reviews('PENDING');
        if (!cancelled) setReviews(list.counts.pending);
      } catch {
        if (!cancelled) setReviews(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, givenReviews]);

  const reviewsPending = givenReviews ?? reviews ?? null;
  const inboxWaiting = givenMessages ?? messages?.waiting ?? null;
  const inboxOverdue = givenMessagesOverdue ?? messages?.overdue ?? 0;
  const waiting = given ?? fetched?.waiting ?? null;
  const overdue = givenOverdue ?? fetched?.overdue ?? 0;

  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on escape
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const navItems = [
    // First, and without a badge. It is the screen that explains the badges on
    // the ones below it, so a count on it would be counting them twice.
    { key: 'dashboard', label: t('dashboard') },
    { key: 'queue', label: t('queue'), count: waiting, overdue },
    { key: 'orders', label: t('orders') },
    { key: 'products', label: t('products') },
    { key: 'categories', label: t('categories') },
    { key: 'messages', label: t('messages'), count: inboxWaiting, overdue: inboxOverdue },
    { key: 'reviews', label: t('reviews'), count: reviewsPending },
    { key: 'vault', label: t('vault') },
    { key: 'payments', label: t('payments') },
    { key: 'promotions', label: t('promotions') },
    { key: 'launch', label: t('launch') },
    { key: 'redirects', label: t('redirects') },
    // The copy on public pages, grouped under one heading because to the
    // person using them they are one job: the words and what a search result
    // says about them. Last, so the heading reads as the start of its own
    // section rather than a divider in the middle of the list. Paths rather
    // than keys, since the three share a prefix.
    { key: 'contentPages', label: t('contentPages'), path: 'content/pages', group: true },
    { key: 'contentBlog', label: t('contentBlog'), path: 'content/blog', group: true },
    { key: 'contentBrands', label: t('contentBrands'), path: 'content/brands', group: true },
  ] as const;

  function navigate(path: string) {
    setDrawerOpen(false);
    router.push(`/${path}`);
  }

  return (
    <div className="admin-layout">
      {/* Desktop Sidebar */}
      <aside className="admin-sidebar" aria-label={t('sidebarLabel')}>
        <div className="admin-sidebar-header">
          <span className="admin-title">{t('panelTitle')}</span>
        </div>

        <div className="admin-sidebar-user">
          <span className="admin-user-name">{me.name}</span>
          <span className="role-tag">{me.role}</span>
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map((item, index) => (
            <Fragment key={item.key}>
              {'group' in item && !('group' in (navItems[index - 1] ?? {})) ? (
                <span className="admin-nav-group">{t('contentGroup')}</span>
              ) : null}
              <button
                type="button"
                className={`admin-sidebar-tab${current === item.key ? ' is-active' : ''}`}
                onClick={() => navigate('path' in item ? item.path : item.key)}
              >
                <span>{item.label}</span>
                {'count' in item &&
                item.count !== null &&
                item.count !== undefined &&
                item.count > 0 ? (
                  <span
                    className={`tab-count${'overdue' in item && item.overdue && item.overdue > 0 ? ' is-late' : ''}`}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            </Fragment>
          ))}
        </nav>

        <LocaleSwitcher />

        <div className="admin-sidebar-footer">
          <button type="button" className="ghost" onClick={() => navigate('password')}>
            {t('changePassword')}
          </button>
          <button
            type="button"
            className="ghost btn-danger-soft"
            onClick={() => {
              void api.logout().then(() => router.push('/login'));
            }}
          >
            {t('logout')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="admin-main">
        <header className="admin-header">
          <div className="bar-brand">
            <button
              type="button"
              className="admin-mobile-toggle"
              aria-label={t('openMenu')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span
              className="admin-title"
              style={{
                display: 'none' /* Only show on mobile if needed, desktop has sidebar title */,
              }}
            >
              {t('panelTitleShort')}
            </span>
          </div>

          <div className="admin-header-actions">
            <button type="button" className="ghost btn-sm" onClick={() => router.push('/password')}>
              {t('passwordShort')}
            </button>
            <button
              type="button"
              className="ghost btn-sm btn-logout"
              onClick={() => {
                void api.logout().then(() => router.push('/login'));
              }}
            >
              {t('logoutShort')}
            </button>
          </div>
        </header>

        <main className="admin-content">{children}</main>

        <footer className="admin-footer">
          <p>{t('copyright', { year: new Date().getFullYear() })}</p>
        </footer>
      </div>

      {/* Admin Mobile Navigation Drawer */}
      <div
        className={`admin-drawer-overlay${drawerOpen ? ' is-open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`admin-drawer-panel${drawerOpen ? ' is-open' : ''}`}
        aria-label={t('mobileMenuLabel')}
      >
        <div className="admin-drawer-head">
          <span className="admin-title">{t('storeAdminTitle')}</span>
          <button
            type="button"
            className="admin-drawer-close"
            aria-label={t('closeMenu')}
            onClick={() => setDrawerOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className="admin-drawer-user">
          <span className="admin-user-name">{me.name}</span>
          <span className="role-tag">{me.role}</span>
        </div>

        <nav className="admin-drawer-links">
          {navItems.map((item, index) => (
            <Fragment key={item.key}>
              {'group' in item && !('group' in (navItems[index - 1] ?? {})) ? (
                <span className="admin-nav-group">{t('contentGroup')}</span>
              ) : null}
              <button
                type="button"
                className={`admin-drawer-tab${current === item.key ? ' is-active' : ''}`}
                onClick={() => navigate('path' in item ? item.path : item.key)}
              >
                <span>{item.label}</span>
                {'count' in item &&
                item.count !== null &&
                item.count !== undefined &&
                item.count > 0 ? (
                  <span
                    className={`tab-count${'overdue' in item && item.overdue && item.overdue > 0 ? ' is-late' : ''}`}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            </Fragment>
          ))}
        </nav>

        <LocaleSwitcher />

        <div className="admin-drawer-foot">
          <button type="button" className="ghost" onClick={() => navigate('password')}>
            {t('changePassword')}
          </button>
          <button
            type="button"
            className="ghost btn-danger-soft"
            onClick={() => {
              void api.logout().then(() => router.push('/login'));
            }}
          >
            {t('logout')}
          </button>
        </div>
      </aside>
    </div>
  );
}
