import {
  BORDER,
  INK,
  MUTED,
  TEAL,
  button,
  escape,
  shell,
  type Rendered,
} from '../mail/templates.js';

/**
 * The two retention emails.
 *
 * Both come in two strengths. The plain one is a service message — your
 * licence ends on this date, here is the way to renew; your cart is still here
 * — and carries no promotion. The discounted one goes only to customers who
 * agreed to marketing, and is the only one that mentions a code; it always
 * carries the discount licence number when the store has one, and an
 * unsubscribe link.
 */

export interface Offer {
  code: string;
  percent: number;
  /** Already formatted for the reader. */
  validUntil: string;
  licenceNumber: string;
}

function offerBlock(ar: boolean, offer: Offer): { html: string; text: string } {
  const licence = offer.licenceNumber
    ? ar
      ? `<br><span style="color:${MUTED};font-size:13px;">رقم ترخيص التخفيض: <span dir="ltr">${escape(offer.licenceNumber)}</span></span>`
      : `<br><span style="color:${MUTED};font-size:13px;">Discount licence no. <span dir="ltr">${escape(offer.licenceNumber)}</span></span>`
    : '';
  const html = ar
    ? `<p style="background:#e8f4f2;padding:12px;border-radius:5px;">خصم ${String(offer.percent)}٪ بالكود <strong dir="ltr" style="font-family:monospace;">${escape(offer.code)}</strong> — لمرّة واحدة، وصالح حتى ${escape(offer.validUntil)}.${licence}</p>`
    : `<p style="background:#e8f4f2;padding:12px;border-radius:5px;">${String(offer.percent)}% off with code <strong dir="ltr" style="font-family:monospace;">${escape(offer.code)}</strong> — single use, valid until ${escape(offer.validUntil)}.${licence}</p>`;
  const text = [
    ar
      ? `خصم ${String(offer.percent)}٪ بالكود ${offer.code} — لمرّة واحدة، حتى ${offer.validUntil}.`
      : `${String(offer.percent)}% off with code ${offer.code} — single use, until ${offer.validUntil}.`,
    offer.licenceNumber
      ? ar
        ? `رقم ترخيص التخفيض: ${offer.licenceNumber}`
        : `Discount licence no. ${offer.licenceNumber}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { html, text };
}

function unsubscribeHtml(ar: boolean, url: string): string {
  return ar
    ? `<p style="color:${MUTED};font-size:12px;">لا تريد رسائل العروض؟ <a href="${escape(url)}" style="color:${TEAL};">ألغِ الاشتراك</a>.</p>`
    : `<p style="color:${MUTED};font-size:12px;">Don’t want offers by email? <a href="${escape(url)}" style="color:${TEAL};">Unsubscribe</a>.</p>`;
}

/** A time-limited licence is about to end, or just has. */
export function renewalReminder(input: {
  locale: 'ar' | 'en';
  firstName: string | null;
  productName: string;
  qty: number;
  /** Already formatted for the reader, in the store's timezone. */
  expiresOn: string;
  /** Positive: days left. Negative: days since it ended. */
  offsetDays: number;
  renewUrl: string;
  accountUrl: string;
  offer: Offer | null;
  unsubscribeUrl: string | null;
}): Rendered {
  const ar = input.locale === 'ar';
  const greeting = input.firstName ? ` ${input.firstName}` : '';
  const after = input.offsetDays < 0;
  const count = input.qty > 1 ? ` × ${String(input.qty)}` : '';
  const offer = input.offer ? offerBlock(ar, input.offer) : null;

  const headline = ar
    ? after
      ? `انتهى ترخيص ${input.productName}`
      : `ترخيص ${input.productName} ينتهي قريباً`
    : after
      ? `Your ${input.productName} licence has ended`
      : `Your ${input.productName} licence ends soon`;

  const lead = ar
    ? after
      ? `مرحباً${escape(greeting)}، انتهت مدّة ترخيص <strong dir="auto">${escape(input.productName)}</strong>${escape(count)} في ${escape(input.expiresOn)}. إن كنت ما زلت تستخدمه، جدّده بزرّ واحد:`
      : `مرحباً${escape(greeting)}، ترخيص <strong dir="auto">${escape(input.productName)}</strong>${escape(count)} الذي اشتريته منّا ينتهي في ${escape(input.expiresOn)}. جدّده قبل ذلك حتى لا يتوقّف:`
    : after
      ? `Hello${escape(greeting)}, your <strong dir="auto">${escape(input.productName)}</strong>${escape(count)} licence ended on ${escape(input.expiresOn)}. If you still use it, renew in one click:`
      : `Hello${escape(greeting)}, the <strong dir="auto">${escape(input.productName)}</strong>${escape(count)} licence you bought from us ends on ${escape(input.expiresOn)}. Renew before then so it keeps working:`;

  const body = `<h1 style="margin:0 0 8px;font-size:20px;color:${INK};">${escape(headline)}</h1>
<p>${lead}</p>
${offer?.html ?? ''}
${button(input.renewUrl, ar ? 'جدّد الآن' : 'Renew now')}
<p style="color:${MUTED};font-size:13px;border-top:1px solid ${BORDER};padding-top:12px;">${
    ar
      ? `كل تراخيصك وتواريخ انتهائها في <a href="${escape(input.accountUrl)}" style="color:${TEAL};">حسابك</a>.`
      : `All your licences and their end dates are in <a href="${escape(input.accountUrl)}" style="color:${TEAL};">your account</a>.`
  }</p>
${input.unsubscribeUrl ? unsubscribeHtml(ar, input.unsubscribeUrl) : ''}`;

  const text = [
    headline,
    '',
    ar
      ? `${input.productName}${count} — ${after ? 'انتهى في' : 'ينتهي في'} ${input.expiresOn}`
      : `${input.productName}${count} — ${after ? 'ended on' : 'ends on'} ${input.expiresOn}`,
    offer?.text ?? '',
    '',
    `${ar ? 'جدّد' : 'Renew'}: ${input.renewUrl}`,
    `${ar ? 'حسابك' : 'Your account'}: ${input.accountUrl}`,
    input.unsubscribeUrl ? `${ar ? 'إلغاء الاشتراك' : 'Unsubscribe'}: ${input.unsubscribeUrl}` : '',
  ]
    .filter((line, index, all) => line !== '' || all[index - 1] !== '')
    .join('\n');

  return {
    subject: headline,
    html: shell({
      locale: input.locale,
      title: 'Renewal reminder',
      body,
      footerNote: ar
        ? 'وصلتك هذه الرسالة لأنك اشتريت ترخيصاً محدود المدّة من متجرنا.'
        : 'You are receiving this because you bought a time-limited licence from us.',
    }),
    text,
  };
}

export interface RecoveryLine {
  productName: string;
  qty: number;
  /** Already formatted with its currency. */
  lineTotal: string;
}

/** A cart with an email in it was left before paying. */
export function cartRecovery(input: {
  locale: 'ar' | 'en';
  /** Position on the ladder, 0-based; the first is the gentlest. */
  step: number;
  lines: RecoveryLine[];
  total: string;
  restoreUrl: string;
  offer: Offer | null;
  unsubscribeUrl: string;
}): Rendered {
  const ar = input.locale === 'ar';
  const offer = input.offer ? offerBlock(ar, input.offer) : null;

  const rows = input.lines
    .map(
      (line) => `<tr>
        <td dir="auto" style="padding:8px 0;border-bottom:1px solid ${BORDER};color:${INK};">${escape(line.productName)}${line.qty > 1 ? ` × ${String(line.qty)}` : ''}</td>
        <td align="${ar ? 'left' : 'right'}" style="padding:8px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${escape(line.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  // Plain words, no countdown and no "only 2 left": nothing in the cart is held
  // for anyone before payment, and saying otherwise would be invented urgency.
  const headline = ar
    ? input.step === 0
      ? 'سلّتك ما زالت هنا'
      : input.offer
        ? 'سلّتك ما زالت هنا — مع خصم'
        : 'تذكير بسلّتك'
    : input.step === 0
      ? 'Your cart is still here'
      : input.offer
        ? 'Your cart is still here — with a discount'
        : 'A reminder about your cart';

  const lead = ar
    ? 'توقّفت قبل الدفع. هذه المنتجات كما تركتها، ويمكنك المتابعة من أي جهاز بالزرّ أدناه:'
    : 'You stopped before paying. Here is what you left, and the button below opens it on any device:';

  const body = `<h1 style="margin:0 0 8px;font-size:20px;color:${INK};">${escape(headline)}</h1>
<p>${escape(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:12px 0 0;"><strong>${ar ? 'الإجمالي' : 'Total'}: ${escape(input.total)}</strong></p>
${offer?.html ?? ''}
${button(input.restoreUrl, ar ? 'أكمل الطلب' : 'Back to your cart')}
<p style="color:${MUTED};font-size:13px;">${
    ar
      ? 'إن كان لديك سؤال عن منتج قبل الشراء، ردّ على هذه الرسالة.'
      : 'If you had a question about a product before buying, reply to this email.'
  }</p>
${unsubscribeHtml(ar, input.unsubscribeUrl)}`;

  const text = [
    headline,
    '',
    ...input.lines.map(
      (line) =>
        `- ${line.productName}${line.qty > 1 ? ` x ${String(line.qty)}` : ''} — ${line.lineTotal}`,
    ),
    `${ar ? 'الإجمالي' : 'Total'}: ${input.total}`,
    offer ? `\n${offer.text}` : '',
    '',
    input.restoreUrl,
    '',
    `${ar ? 'إلغاء الاشتراك' : 'Unsubscribe'}: ${input.unsubscribeUrl}`,
  ].join('\n');

  return {
    subject: headline,
    html: shell({
      locale: input.locale,
      title: 'Your cart',
      body,
      footerNote: ar
        ? 'وصلتك هذه الرسالة لأنك أدخلت بريدك في صفحة الدفع ولم يكتمل الطلب.'
        : 'You are receiving this because you entered your email at checkout and the order was not completed.',
    }),
    text,
  };
}
