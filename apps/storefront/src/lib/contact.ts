import type { WhatsappPlacement } from '@da/contracts';

/**
 * The store's real contact channels, in one place.
 *
 * The same number and address were typed into the header, the footer, the
 * product page and the floating button, and the Organization markup needs them
 * too. Five copies of a phone number are five places for it to go stale.
 */
/** Digits only: `wa.me` takes no groups or plus sign. */
export const WHATSAPP_DIAL = '966534255367';
export const WHATSAPP_SHOWN = '+966 53 425 5367';
/** E.164, which is what `ContactPoint.telephone` expects. */
export const SUPPORT_PHONE = '+966534255367';
export const SUPPORT_EMAIL = 'help@digital-activation.com';

/** The `wa.me` address itself, optionally with the first message written. */
export function whatsappDirect(text?: string): string {
  const base = `https://wa.me/${WHATSAPP_DIAL}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * A WhatsApp link, optionally with the first message already written.
 *
 * Prefilled from a product page so the conversation starts with which product
 * it is about — otherwise the first reply is always "which one?".
 *
 * Same-site: `/go/whatsapp` records the click (TASK-0096) and redirects to
 * `wa.me`. No script and no new origin, so the CSP is unchanged; the anchor
 * must not carry `noreferrer`, since the page it was clicked on is read from
 * the Referer, and the redirect itself sends no referrer on to WhatsApp.
 */
export function whatsappLink(text?: string, placement?: WhatsappPlacement): string {
  const query = new URLSearchParams();
  if (placement) query.set('p', placement);
  if (text) query.set('text', text);
  const search = query.toString();
  return search ? `${WHATSAPP_GO}?${search}` : WHATSAPP_GO;
}

export const WHATSAPP_GO = '/go/whatsapp';
