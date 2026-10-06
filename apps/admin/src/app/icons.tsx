import type { SVGProps } from 'react';

/**
 * The panel's icons: one stroke family, drawn inline.
 *
 * Inline rather than an icon font because the admin's CSP allows fonts only
 * from itself and a 600 KB glyph set is a lot to self-host for twenty-five
 * shapes — and because an SVG takes `currentColor`, so an icon in a muted
 * link is muted and an icon in the active one is brand, with no extra rule.
 *
 * Every shape is a 24-unit grid, 1.75 stroke, round joins: the same weight
 * the template's Bootstrap Icons carry, so the family reads as one.
 */
export type IconName =
  | 'dashboard'
  | 'launch'
  | 'queue'
  | 'orders'
  | 'customers'
  | 'messages'
  | 'reviews'
  | 'products'
  | 'categories'
  | 'vault'
  | 'payments'
  | 'promotions'
  | 'marketing'
  | 'redirects'
  | 'supplier'
  | 'pages'
  | 'blog'
  | 'brands'
  | 'menu'
  | 'sidebar'
  | 'sun'
  | 'moon'
  | 'chevronDown'
  | 'key'
  | 'logout'
  | 'close'
  | 'arrowUp'
  | 'arrowDown'
  | 'refresh'
  | 'user'
  | 'money'
  | 'calendar'
  | 'undo'
  | 'check';

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  launch: 'M12 3a9 9 0 1 0 9 9M8.5 12.5l2.5 2.5 6-6M21 3l-3 3',
  queue: 'M4 5h16v14H4zM4 13h4l2 3h4l2-3h4',
  orders: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  customers:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M21 21v-2a4 4 0 0 0-3-3.9',
  messages: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5',
  reviews: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z',
  products:
    'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7l8.7 5 8.7-5M12 22V12',
  categories: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18',
  vault:
    'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4M12 15v3',
  payments:
    'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20M6 15h4',
  promotions: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  marketing:
    'M3 11v2a1 1 0 0 0 1 1h2l5 4V6l-5 4H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  redirects: 'M4 4v7a4 4 0 0 0 4 4h12M15 10l5 5-5 5',
  // A sheet with a refresh arrow: the supplier list, read on a schedule.
  supplier: 'M4 3h10l6 6v12H4zM14 3v6h6M8 13h8M8 17h5M17 15a3 3 0 1 1-1-2.2M17 12v2h-2',
  pages:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  brands: 'M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9 7 22l5-3 5 3-1.2-8.1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sidebar: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  chevronDown: 'M6 9l6 6 6-6',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 3m-3 3 2 2',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  close: 'M18 6 6 18M6 6l12 12',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  money: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 12h.01M17 12h.01',
  calendar:
    'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  undo: 'M3 10h11a5 5 0 0 1 0 10h-3M3 10l5-5M3 10l5 5',
  check: 'M20 6 9 17l-5-5',
};

export function Icon({
  name,
  className,
  ...rest
}: { name: IconName } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `ic ${className}` : 'ic'}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Two letters for the avatar: the first of each of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word.charAt(0));
  return (letters.join('') || '?').toUpperCase();
}
