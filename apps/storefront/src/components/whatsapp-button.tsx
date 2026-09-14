import { WhatsAppIcon } from './icons';

/**
 * The floating WhatsApp button.
 *
 * On the store this replaces it is the most-used contact route by a distance —
 * this is a Gulf storefront, and WhatsApp is where people ask "is this key
 * genuine" before they buy and "where is my key" after. Carrying it over is
 * not decoration: it is the support channel.
 *
 * A plain anchor, server-rendered, with no widget and no script. The vendor
 * chat embeds that usually sit behind a button like this are third-party
 * JavaScript on every page, and the performance budget in `@da/ui` allows
 * exactly zero of those before interaction.
 *
 * Pinned to the physical right in both languages rather than to the inline
 * end. A floating action button is furniture, not text: it sits where the
 * thumb is, and on the old site — which is what a returning customer
 * remembers — that is the bottom right.
 */
const WHATSAPP_DIAL = '966534255367';

export function WhatsAppButton({ locale }: { locale: string }) {
  const ar = locale !== 'en';
  const label = ar ? 'تواصل معنا على واتساب' : 'Message us on WhatsApp';

  return (
    <a
      className="whatsapp-fab"
      href={`https://wa.me/${WHATSAPP_DIAL}`}
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      <WhatsAppIcon />
    </a>
  );
}
