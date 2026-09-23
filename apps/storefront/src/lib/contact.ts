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

/**
 * A WhatsApp link, optionally with the first message already written.
 *
 * Prefilled from a product page so the conversation starts with which product
 * it is about — otherwise the first reply is always "which one?".
 */
export function whatsappLink(text?: string): string {
  const base = `https://wa.me/${WHATSAPP_DIAL}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
