'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LocaleSwitcher } from '../i18n/locale-switcher';
import { useT } from '../i18n/provider';
import { api } from '../lib/api';
import { Icon, initials, type IconName } from './icons';
import { useAdminTheme } from './theme-provider';

/**
 * The app shell: sidebar, topbar, page, footer.
 *
 * The sidebar carries a live count of the work waiting in the supplier queue,
 * the inbox and the moderation screen, because those are the numbers a person
 * running this shop needs in front of them: every one of them is a customer
 * who has paid, or written, and is waiting. They are loaded here rather than
 * passed in so every screen shows them without threading them through.
 *
 * Grouped the way the work is grouped — what is happening now, what is sold,
 * how it is sold, what the public reads — rather than as one long list, so a
 * screen is found by what it is for.
 */

type NavKey =
  | 'dashboard'
  | 'launch'
  | 'products'
  | 'categories'
  | 'orders'
  | 'customers'
  | 'queue'
  | 'vault'
  | 'reviews'
  | 'messages'
  | 'payments'
  | 'promotions'
  | 'marketing'
  | 'redirects'
  | 'contentPages'
  | 'contentBlog'
  | 'contentBrands';

type NavItem = {
  key: NavKey;
  label: string;
  icon: IconName;
  path: string;
  count?: number | null;
  overdue?: number;
};

const SIDEBAR_KEY = 'da-admin-sidebar';

export function Nav({
  me,
  current,
  /**
   * The queue page already has these numbers and they change as it is worked,
   * so it passes them down. Without that the badge is a snapshot from page
   * load: deliver a line and it still claims the old count.
   *
   * Omitted elsewhere, where the nav fetches them itself.
   */
  waiting: given,
  overdue: givenOverdue,
  /** The same arrangement for the inbox, and for the same reason. */
  messagesWaiting: givenMessages,
  messagesOverdue: givenMessagesOverdue,
  /** Same arrangement again, for the reviews the moderation screen is working. */
  reviewsPending: givenReviews,
  children,
}: {
  me: StaffMe;
  children: React.ReactNode;
  current: NavKey;
  waiting?: number;
  overdue?: number;
  messagesWaiting?: number;
  messagesOverdue?: number;
  reviewsPending?: number;
}) {
  const router = useRouter();
  const t = useT('nav');
  const { theme, toggle: toggleTheme } = useAdminTheme();

  const [fetched, setFetched] = useState<{ waiting: number; overdue: number } | null>(null);
  const [messages, setMessages] = useState<{ waiting: number; overdue: number } | null>(null);
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

  /* --- shell state ------------------------------------------------------ */

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  // Under 992px the sidebar is a drawer; closed, it is off-canvas and must be
  // out of the tab order too, which `inert` does and a transform does not.
  const [narrow, setNarrow] = useState(false);

  // The collapsed rail is a preference and survives the session.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_KEY) === '1' && window.innerWidth >= 992) {
        setCollapsed(true);
      }
    } catch {
      // Storage unavailable: start expanded.
    }
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, value ? '0' : '1');
      } catch {
        // ignore
      }
      return !value;
    });
  }

  // Escape closes whatever is open; growing past the breakpoint closes the drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        setMenuOpen(false);
      }
    };
    const onResize = () => {
      const isNarrow = window.innerWidth < 992;
      setNarrow(isNarrow);
      if (!isNarrow) setMobileOpen(false);
    };
    onResize();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // The page behind an open drawer does not scroll.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // A click anywhere outside the user menu closes it; opening it moves focus in.
  useEffect(() => {
    if (!menuOpen) return;
    firstItemRef.current?.focus();
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [menuOpen]);

  function navigate(path: string): void {
    setMobileOpen(false);
    setMenuOpen(false);
    router.push(`/${path}`);
  }

  function logout(): void {
    setMenuOpen(false);
    void api.logout().then(() => router.push('/login'));
  }

  /* --- the menu --------------------------------------------------------- */

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t('groupOverview'),
      items: [
        // First, and without a badge: it is the screen that explains the
        // badges below it, so a count on it would be counting them twice.
        { key: 'dashboard', label: t('dashboard'), icon: 'dashboard', path: 'dashboard' },
        { key: 'launch', label: t('launch'), icon: 'launch', path: 'launch' },
      ],
    },
    {
      label: t('groupOperations'),
      items: [
        { key: 'queue', label: t('queue'), icon: 'queue', path: 'queue', count: waiting, overdue },
        { key: 'orders', label: t('orders'), icon: 'orders', path: 'orders' },
        { key: 'customers', label: t('customers'), icon: 'customers', path: 'customers' },
        {
          key: 'messages',
          label: t('messages'),
          icon: 'messages',
          path: 'messages',
          count: inboxWaiting,
          overdue: inboxOverdue,
        },
        {
          key: 'reviews',
          label: t('reviews'),
          icon: 'reviews',
          path: 'reviews',
          count: reviewsPending,
        },
      ],
    },
    {
      label: t('groupCatalog'),
      items: [
        { key: 'products', label: t('products'), icon: 'products', path: 'products' },
        { key: 'categories', label: t('categories'), icon: 'categories', path: 'categories' },
        { key: 'vault', label: t('vault'), icon: 'vault', path: 'vault' },
      ],
    },
    {
      label: t('groupSales'),
      items: [
        { key: 'payments', label: t('payments'), icon: 'payments', path: 'payments' },
        { key: 'promotions', label: t('promotions'), icon: 'promotions', path: 'promotions' },
        { key: 'marketing', label: t('marketing'), icon: 'marketing', path: 'marketing' },
      ],
    },
    {
      label: t('contentGroup'),
      items: [
        { key: 'contentPages', label: t('contentPages'), icon: 'pages', path: 'content/pages' },
        { key: 'contentBlog', label: t('contentBlog'), icon: 'blog', path: 'content/blog' },
        {
          key: 'contentBrands',
          label: t('contentBrands'),
          icon: 'brands',
          path: 'content/brands',
        },
      ],
    },
    {
      label: t('groupSystem'),
      items: [{ key: 'redirects', label: t('redirects'), icon: 'redirects', path: 'redirects' }],
    },
  ];

  const currentLabel = groups.flatMap((g) => g.items).find((item) => item.key === current)?.label;

  const shellClass = [
    'app-shell',
    'admin-layout',
    collapsed ? 'is-collapsed' : '',
    mobileOpen ? 'is-mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const roleLabel = t(`role${me.role}`);

  return (
    <div className={shellClass}>
      <a className="skip-link" href="#main">
        {t('skipToContent')}
      </a>
      <aside
        className="app-sidebar"
        aria-label={t('sidebarLabel')}
        inert={narrow && !mobileOpen ? true : undefined}
      >
        <button
          type="button"
          className="app-sidebar__brand"
          onClick={() => navigate('dashboard')}
          aria-label={t('goToDashboard')}
          title={t('panelTitle')}
        >
          <span className="app-sidebar__mark" aria-hidden="true">
            DA
          </span>
          <span className="app-sidebar__text">{t('panelTitleShort')}</span>
        </button>

        <nav className="app-sidebar__nav" aria-label={t('sidebarLabel')}>
          {groups.map((group) => (
            <div key={group.label}>
              <div className="app-nav__label">{group.label}</div>
              <ul className="app-nav__list">
                {group.items.map((item) => {
                  const active = current === item.key;
                  const count = item.count ?? 0;
                  const late = (item.overdue ?? 0) > 0;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={`app-nav__link${active ? ' is-active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        onClick={() => navigate(item.path)}
                      >
                        <span className="app-nav__icon">
                          <Icon name={item.icon} />
                        </span>
                        <span className="app-nav__text">{item.label}</span>
                        {count > 0 ? (
                          <span className={`app-nav__badge${late ? ' is-late' : ''}`}>{count}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="app-sidebar__foot">
          <div className="app-sidebar__locale">
            <LocaleSwitcher />
          </div>
          <div className="app-sidebar__user" title={me.email}>
            <span className="avatar" aria-hidden="true">
              {initials(me.name)}
            </span>
            <div className="app-sidebar__user-meta">
              <div className="name">{me.name}</div>
              <div className="role">{roleLabel}</div>
            </div>
          </div>
        </div>
      </aside>
      <button
        type="button"
        className="app-backdrop"
        aria-label={t('closeMenu')}
        tabIndex={-1}
        onClick={() => setMobileOpen(false)}
      />

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="icon-btn app-topbar__menu-toggle"
            aria-label={mobileOpen ? t('closeMenu') : t('openMenu')}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((value) => !value)}
          >
            <Icon name={mobileOpen ? 'close' : 'menu'} />
          </button>
          <button
            type="button"
            className="icon-btn app-topbar__collapse"
            aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
          >
            <Icon name="sidebar" />
          </button>

          <h2 className="app-topbar__title">{currentLabel ?? t('panelTitleShort')}</h2>

          <div className="app-topbar__actions">
            <LocaleSwitcher />
            <button
              type="button"
              className="icon-btn"
              aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
              title={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
              onClick={toggleTheme}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            <div className="app-user" ref={menuRef}>
              <button
                type="button"
                className="app-user__trigger"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t('userMenu')}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <span className="avatar" aria-hidden="true">
                  {initials(me.name)}
                </span>
                <span className="app-user__meta">
                  <span className="name">{me.name}</span>
                  <br />
                  <span className="role">{roleLabel}</span>
                </span>
                <Icon name="chevronDown" className="app-user__chevron" />
              </button>
              {menuOpen ? (
                <div className="menu" role="menu">
                  <div className="menu__head">
                    <span className="name">{me.name}</span>
                    <span className="email" dir="ltr">
                      {me.email}
                    </span>
                  </div>
                  <button
                    ref={firstItemRef}
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={() => navigate('password')}
                  >
                    <Icon name="key" />
                    {t('changePassword')}
                  </button>
                  <div className="menu__divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item is-danger"
                    onClick={logout}
                  >
                    <Icon name="logout" />
                    {t('logout')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="app-content" id="main" tabIndex={-1}>
          {children}
        </main>

        <footer className="app-footer">
          <p>{t('copyright', { year: new Date().getFullYear() })}</p>
          <p>{t('panelTitle')}</p>
        </footer>
      </div>
    </div>
  );
}
