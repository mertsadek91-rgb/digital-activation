import type { ReactNode } from 'react';

/**
 * The store's icons, drawn rather than downloaded.
 *
 * The site this replaces shipped 226 requests and took 17.4 seconds to finish
 * loading, and a good share of that was image files doing the work of a shape.
 * These are inline SVG: they cost no request, they scale to any density, they
 * take their colour from the text around them, and they are diffable text in
 * the repository rather than binaries somebody has to open an editor to change.
 *
 * Two rules hold throughout. Every icon is `aria-hidden` and carries no title,
 * because each one sits beside a real label — an icon that announces itself
 * next to the word it illustrates reads the word twice to a screen reader. And
 * every stroke is `currentColor`, so one icon works on the utility bar, in the
 * menu and on a dark ground without a second copy.
 */
function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MenuIcon() {
  return (
    <Svg size={18}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function CartIcon() {
  return (
    <Svg>
      <path d="M3 4h2l2.2 10.4a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L20 8H6" />
      <circle cx="9.5" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </Svg>
  );
}

export function UserIcon() {
  return (
    <Svg size={17}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </Svg>
  );
}

/** A headset, not a handset: the old site's own mark for "somebody answers". */
export function SupportIcon() {
  return (
    <Svg size={17}>
      <path d="M5 13v-1a7 7 0 0 1 14 0v1" />
      <rect x="3" y="13" width="3.5" height="5.5" rx="1.4" />
      <rect x="17.5" y="13" width="3.5" height="5.5" rx="1.4" />
      <path d="M19 18.5v.6a2.4 2.4 0 0 1-2.4 2.4H13" />
    </Svg>
  );
}

/** A paper plane, which is what the old site puts beside its address. */
export function MailIcon() {
  return (
    <Svg size={17}>
      <path d="M21 4 3 10.6l7 2.8 2.8 7z" />
      <path d="M21 4 10 13.4" />
    </Svg>
  );
}

export function ChevronIcon() {
  return (
    <Svg size={14}>
      <path d="M7 10l5 5 5-5" />
    </Svg>
  );
}

/**
 * WhatsApp.
 *
 * Filled rather than stroked, because it is the one mark here that has to be
 * recognised at a glance with no label beside it — the floating button is a
 * circle and a glyph and nothing else.
 */
export function WhatsAppIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2m0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3 .8.8-3-.2-.3A8.2 8.2 0 0 1 12 3.8"
      />
      <path
        fill="currentColor"
        d="M9.1 7.3c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.8.4s-1 1-1 2.4 1 2.8 1.2 3 2 3.2 4.9 4.3c2.4 1 2.9.8 3.4.7s1.6-.6 1.8-1.3.2-1.2.2-1.3l-.6-.4-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-2-1.2 7.4 7.4 0 0 1-1.4-1.7c-.1-.3 0-.4.1-.5l.4-.5.3-.4v-.5z"
      />
    </svg>
  );
}

/* --- category marks -------------------------------------------------------- */

/**
 * One mark per product family, on its own ground.
 *
 * The old store used the real vendor logos, which are trademarks and would be
 * eight more image requests. These are plain geometry in each family's
 * recognisable colour — enough for somebody scanning a menu to find Windows
 * without reading, which is the whole job of an icon in a category list.
 */
const MARKS: Record<string, { fill: string; path: ReactNode }> = {
  windows: {
    fill: '#0f7ec8',
    path: (
      <>
        <rect x="4" y="4.5" width="6.6" height="6.6" rx="0.6" />
        <rect x="13.4" y="4.5" width="6.6" height="6.6" rx="0.6" />
        <rect x="4" y="13.9" width="6.6" height="6.6" rx="0.6" />
        <rect x="13.4" y="13.9" width="6.6" height="6.6" rx="0.6" />
      </>
    ),
  },
  office: {
    fill: '#d8481f',
    path: (
      <>
        <path d="M13.5 3.2 5.5 6v12l8 2.8 5-2V5.2z" opacity="0.35" />
        <path d="M13.5 3.2v17.6l-8-2.8V6z" />
      </>
    ),
  },
  adobe: {
    fill: '#d81c26',
    path: (
      <>
        <path d="M9.6 3.5 3 20.5h4l1.3-3.6h4.2L9.6 3.5z" />
        <path d="M14.4 3.5 21 20.5h-4.2l-3.6-9.6z" opacity="0.55" />
      </>
    ),
  },
  autodesk: {
    fill: '#1a1a1a',
    path: (
      <>
        <path d="M3.5 17.5 12 5.5l3.4 4.8-4.6 7.2z" />
        <path d="M13.6 12.6 17 17.5h-6.8z" opacity="0.5" />
      </>
    ),
  },
  antivirus: {
    fill: '#1f9d55',
    path: (
      <>
        <path d="M12 3 5 5.8v6c0 4 3 7.3 7 9.2 4-1.9 7-5.2 7-9.2v-6z" opacity="0.35" />
        <path d="m8.6 12.2 2.4 2.4 4.4-4.6" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
  },
  subscriptions: {
    fill: '#e0a21a',
    path: <path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z" />,
  },
  wordpress: {
    fill: '#3f5b70',
    path: (
      <>
        <circle cx="12" cy="12" r="9" opacity="0.3" />
        <path d="m6.5 8.5 2.8 8 1.8-5.2-1-2.8zm6.4 0 2.8 8 2-8h-2l-1.2 5z" />
      </>
    ),
  },
  seo: {
    fill: '#0f8f86',
    path: (
      <>
        <path d="M4 19.5h16" opacity="0.4" />
        <path d="m4.5 16 4.3-4.8 3.2 2.6 6.4-7" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M15 6.5h3.8v3.8" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
  },
  code: {
    fill: '#6b4fc4',
    path: (
      <path
        d="m8.6 7.5-4.4 4.6 4.4 4.6M15.4 7.5l4.4 4.6-4.4 4.6"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
      />
    ),
  },
};

/**
 * Which mark a category gets.
 *
 * By family rather than one per slug: six of the sixteen categories are
 * Windows editions and licences, and six identical Windows marks in a row is
 * exactly right — they are the same product family, and a menu that gave each
 * its own invented glyph would be inventing a distinction the catalog does not
 * make.
 */
function markFor(slug: string): keyof typeof MARKS {
  if (slug.startsWith('windows')) return 'windows';
  if (slug === 'office') return 'office';
  if (slug === 'adobe') return 'adobe';
  if (slug === 'autodesk') return 'autodesk';
  if (slug === 'antivirus') return 'antivirus';
  if (slug === 'subscriptions') return 'subscriptions';
  if (slug === 'wordpress') return 'wordpress';
  if (slug === 'seo-tools') return 'seo';
  return 'code';
}

export function CategoryMark({ slug, size = 26 }: { slug: string; size?: number }) {
  const mark = MARKS[markFor(slug)];
  if (!mark) return null;

  return (
    <span className="cat-mark" style={{ color: mark.fill }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
        <g fill="currentColor">{mark.path}</g>
      </svg>
    </span>
  );
}
