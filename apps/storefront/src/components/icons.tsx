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

/* --- the three steps ------------------------------------------------------- */

/**
 * One drawing per step of buying something here.
 *
 * The old store illustrated its three steps with raster art. These say the
 * same thing in the same place at a fraction of the weight, and they say *our*
 * three steps rather than a stock set: choose a licence, pay, activate — which
 * is the sequence this shop actually puts somebody through, and the third one
 * is a key because that is literally what arrives.
 */
export function StepMark({ step }: { step: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="56"
      height="56"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {step === 1 ? (
        /* A list with one line picked out. */
        <>
          <rect x="10" y="12" width="44" height="40" rx="5" opacity="0.35" />
          <path d="M18 24h20M18 32h28M18 40h14" />
          <circle cx="46" cy="40" r="7" fill="currentColor" opacity="0.18" stroke="none" />
          <path d="m43 40 2.4 2.4L50 37.5" />
        </>
      ) : null}

      {step === 2 ? (
        /* A card, and the band across it that says it is one. */
        <>
          <rect x="8" y="16" width="48" height="32" rx="5" opacity="0.35" />
          <path d="M8 26h48" strokeWidth="3.2" />
          <path d="M17 38h10" />
        </>
      ) : null}

      {step === 3 ? (
        /* The key itself. */
        <>
          <circle cx="24" cy="40" r="9" />
          <path d="m30.6 33.4 16-16" />
          <path d="m39.5 24.5 4.6 4.6M44.5 19.5l4.6 4.6" />
        </>
      ) : null}
    </svg>
  );
}

/* --- what the shop promises ------------------------------------------------ */

/**
 * The four marks in the footer's promise strip.
 *
 * They were an empty tinted square each, which reads as a picture that failed
 * to load rather than as a design. Drawn in the same stroke weight as the rest
 * so the footer belongs to the same family as the header.
 */
export function PromiseMark({ kind }: { kind: 'warranty' | 'delivery' | 'price' | 'support' }) {
  return (
    <Svg size={19}>
      {kind === 'warranty' ? (
        <>
          <path d="M12 2.8 4.8 5.4v6.1c0 4.1 3 7.5 7.2 9.4 4.2-1.9 7.2-5.3 7.2-9.4V5.4z" />
          <path d="m9 11.9 2.2 2.2 4.1-4.3" />
        </>
      ) : null}
      {kind === 'delivery' ? (
        /* A bolt: the licence arrives by email, in minutes. */
        <path d="M13.4 2.5 5 13.2h5.4l-.8 8.3L18 10.8h-5.4z" />
      ) : null}
      {kind === 'price' ? (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M14.6 9.1a3 3 0 0 0-2.6-1.2c-1.6 0-2.7.8-2.7 2s1 1.7 2.7 2 2.9.9 2.9 2.1-1.2 2.1-2.9 2.1a3.1 3.1 0 0 1-2.7-1.3M12 6.2v11.6" />
        </>
      ) : null}
      {kind === 'support' ? (
        <>
          <path d="M5 13v-1a7 7 0 0 1 14 0v1" />
          <rect x="3.2" y="13" width="3.4" height="5.4" rx="1.4" />
          <rect x="17.4" y="13" width="3.4" height="5.4" rx="1.4" />
        </>
      ) : null}
    </Svg>
  );
}

/* --- the specification grid ------------------------------------------------ */

/**
 * A mark per row of the product's specification table.
 *
 * The store this replaces draws the same table with the same six-ish rows, and
 * it is the most useful block on its product page: somebody buying a licence is
 * deciding on the term, the device count and how it activates, and those three
 * answers are what the page exists to give. It drew them as image icons pulled
 * from a plugin; these are the same idea at no request cost.
 *
 * Keyed by what the row *means* rather than by position, so a product that has
 * no activation email to ask for simply has no `email` row and nothing shifts.
 */
export type SpecKind =
  'term' | 'devices' | 'activation' | 'delivery' | 'supply' | 'platform' | 'warranty' | 'email';

export function SpecMark({ kind }: { kind: SpecKind }) {
  return (
    <Svg size={20}>
      {kind === 'term' ? (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 7.2V12l3.2 1.9" />
        </>
      ) : null}
      {kind === 'devices' ? (
        <>
          <rect x="2.6" y="4.6" width="13.4" height="9.6" rx="1.4" />
          <path d="M6.4 18.4h6.2" />
          <rect x="17.2" y="9.4" width="4.2" height="9.4" rx="1.2" />
        </>
      ) : null}
      {kind === 'activation' ? (
        /* A key, which is literally what most of this catalog sells. */
        <>
          <circle cx="8" cy="15.6" r="3.4" />
          <path d="m10.6 13.2 8-8M16.4 7.4l2 2M14.2 9.6l2 2" />
        </>
      ) : null}
      {kind === 'delivery' ? (
        <>
          <rect x="2.8" y="5.4" width="18.4" height="13.2" rx="1.8" />
          <path d="m3.4 7 8.6 5.8L20.6 7" />
        </>
      ) : null}
      {kind === 'supply' ? (
        <>
          <path d="M3.4 8.4 12 3.6l8.6 4.8v7.2L12 20.4l-8.6-4.8z" />
          <path d="M3.4 8.4 12 13.2l8.6-4.8M12 13.2v7.2" />
        </>
      ) : null}
      {kind === 'platform' ? (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M3.4 12h17.2M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2" />
        </>
      ) : null}
      {kind === 'warranty' ? (
        <>
          <path d="M12 2.8 4.8 5.4v6.1c0 4.1 3 7.5 7.2 9.4 4.2-1.9 7.2-5.3 7.2-9.4V5.4z" />
          <path d="m9 11.9 2.2 2.2 4.1-4.3" />
        </>
      ) : null}
      {kind === 'email' ? (
        <>
          <path d="M12 3.4a8.6 8.6 0 1 0 4.6 15.9" />
          <circle cx="12" cy="12" r="3.4" />
          <path d="M15.4 12v1.9a2.6 2.6 0 0 0 5.2 0V12" />
        </>
      ) : null}
    </Svg>
  );
}

/* --- the quantity stepper -------------------------------------------------- */

/**
 * Plus and minus, at the stroke weight of everything else.
 *
 * A stepper rather than a dropdown because that is what the old page has and
 * because a select for "how many" opens a list of twenty identical numbers on
 * a phone to move from one to two.
 */
export function PlusIcon() {
  return (
    <Svg size={16}>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
    </Svg>
  );
}

export function MinusIcon() {
  return (
    <Svg size={16}>
      <path d="M5.4 12h13.2" />
    </Svg>
  );
}
