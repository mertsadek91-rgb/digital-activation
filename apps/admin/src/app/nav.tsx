'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
    | 'launch'
    | 'products'
    | 'orders'
    | 'queue'
    | 'vault'
    | 'reviews'
    | 'messages'
    | 'payments'
    | 'promotions'
    | 'redirects';
  waiting?: number;
  overdue?: number;
  messagesWaiting?: number;
  messagesOverdue?: number;
  reviewsPending?: number;
}) {
  const router = useRouter();
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
    { key: 'queue', label: 'الطابور', count: waiting, overdue },
    { key: 'orders', label: 'الطلبات' },
    { key: 'products', label: 'المنتجات' },
    { key: 'messages', label: 'الرسائل', count: inboxWaiting, overdue: inboxOverdue },
    { key: 'reviews', label: 'التقييمات', count: reviewsPending },
    { key: 'vault', label: 'الخزنة' },
    { key: 'payments', label: 'طرق الدفع' },
    { key: 'promotions', label: 'الأكواد' },
    { key: 'launch', label: 'حالة المتجر' },
    { key: 'redirects', label: 'التوجيهات' },
  ] as const;

  function navigate(path: string) {
    setDrawerOpen(false);
    router.push(`/${path}`);
  }

  return (
    <div className="admin-layout">
      {/* Desktop Sidebar */}
      <aside className="admin-sidebar" aria-label="القائمة الجانبية">
        <div className="admin-sidebar-header">
          <span className="admin-title">لوحة التفعيل الرقمي</span>
        </div>

        <div className="admin-sidebar-user">
          <span className="admin-user-name">{me.name}</span>
          <span className="role-tag">{me.role}</span>
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-sidebar-tab${current === item.key ? ' is-active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <span>{item.label}</span>
              {'count' in item && item.count !== null && item.count !== undefined && item.count > 0 ? (
                <span className={`tab-count${'overdue' in item && item.overdue && item.overdue > 0 ? ' is-late' : ''}`}>
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <button type="button" className="ghost" onClick={() => navigate('password')}>
            تغيير كلمة المرور
          </button>
          <button
            type="button"
            className="ghost btn-danger-soft"
            onClick={() => {
              void api.logout().then(() => router.push('/login'));
            }}
          >
            تسجيل الخروج
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
              aria-label="فتح قائمة الإدارة"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="admin-title" style={{ display: 'none' /* Only show on mobile if needed, desktop has sidebar title */ }}>
              لوحة التحكم
            </span>
          </div>

          <div className="admin-header-actions">
            <button type="button" className="ghost btn-sm" onClick={() => router.push('/password')}>
              كلمة المرور
            </button>
            <button
              type="button"
              className="ghost btn-sm btn-logout"
              onClick={() => {
                void api.logout().then(() => router.push('/login'));
              }}
            >
              خروج
            </button>
          </div>
        </header>

        <main className="admin-content">
          {children}
        </main>

        <footer className="admin-footer">
          <p>© {new Date().getFullYear()} التفعيل الرقمي. جميع الحقوق محفوظة.</p>
        </footer>
      </div>

      {/* Admin Mobile Navigation Drawer */}
      <div
        className={`admin-drawer-overlay${drawerOpen ? ' is-open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside className={`admin-drawer-panel${drawerOpen ? ' is-open' : ''}`} aria-label="قائمة الجوال">
        <div className="admin-drawer-head">
          <span className="admin-title">لوحة إدارة المتجر</span>
          <button
            type="button"
            className="admin-drawer-close"
            aria-label="إغلاق القائمة"
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
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-drawer-tab${current === item.key ? ' is-active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <span>{item.label}</span>
              {'count' in item && item.count !== null && item.count !== undefined && item.count > 0 ? (
                <span className={`tab-count${'overdue' in item && item.overdue && item.overdue > 0 ? ' is-late' : ''}`}>
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="admin-drawer-foot">
          <button type="button" className="ghost" onClick={() => navigate('password')}>
            تغيير كلمة المرور
          </button>
          <button
            type="button"
            className="ghost btn-danger-soft"
            onClick={() => {
              void api.logout().then(() => router.push('/login'));
            }}
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>
    </div>
  );
}
