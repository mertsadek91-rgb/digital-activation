import { MUTED, type Rendered, button, escape, shell } from '../mail/templates.js';

/**
 * The growth features' emails. Same shell as every other message, kept here so
 * the transactional templates file stays about orders.
 */

/** Shown beside any price reduction sent into Saudi Arabia, when one is set. */
function licenceLine(ar: boolean, licenceNumber: string): string {
  if (!licenceNumber) return '';
  return `<p style="color:${MUTED};font-size:12px;">${
    ar ? 'رقم ترخيص التخفيض' : 'Discount licence no.'
  } <span dir="ltr">${escape(licenceNumber)}</span></p>`;
}

/**
 * The welcome window's confirmation.
 *
 * Says a code follows the click when one is configured, and says it will not
 * come without the click — the consent is the click, not the typing.
 */
export function welcomeConfirm(input: {
  locale: 'ar' | 'en';
  confirmUrl: string;
  discountPercent: number;
}): Rendered {
  const ar = input.locale === 'ar';
  const percent = String(input.discountPercent);
  const promise =
    input.discountPercent > 0
      ? ar
        ? `<p>بعد التأكيد نرسل لك كود خصم ${percent}% لطلبك الأول، صالحاً لمرّة واحدة.</p>`
        : `<p>Once you confirm, we will send you a one-time ${percent}% code for your first order.</p>`
      : '';
  const body = ar
    ? `<h1 style="margin:0 0 8px;font-size:20px;">أكّد اشتراكك</h1>
<p>طلب أحدهم إضافة هذا البريد إلى نشرة العروض. إن كنت أنت، أكّد بالزر أدناه. إن لم تكن أنت، تجاهل هذه الرسالة ولن نراسلك.</p>
${promise}
${button(input.confirmUrl, 'أكّد الاشتراك')}`
    : `<h1 style="margin:0 0 8px;font-size:20px;">Confirm your subscription</h1>
<p>Someone asked to add this address to our deals newsletter. If it was you, confirm below. If not, ignore this email and you will not hear from us.</p>
${promise}
${button(input.confirmUrl, 'Confirm subscription')}`;
  return {
    subject: ar ? 'أكّد اشتراكك في النشرة' : 'Confirm your newsletter subscription',
    html: shell({
      locale: input.locale,
      title: 'Confirm subscription',
      body,
      footerNote: ar
        ? 'لن تصلك أي رسالة تسويقية قبل التأكيد.'
        : 'You will receive no marketing email until you confirm.',
    }),
    text: ar
      ? `أكّد اشتراكك في النشرة:\n${input.confirmUrl}`
      : `Confirm your newsletter subscription:\n${input.confirmUrl}`,
  };
}

/** A single-use code, for the welcome sign-up or a referral reward. */
export function codeEmail(input: {
  locale: 'ar' | 'en';
  kind: 'welcome' | 'referral-reward';
  code: string;
  /** "10%" or "$5.00", already formatted. */
  amount: string;
  expiresAt: Date;
  licenceNumber: string;
  storeUrl: string;
  /** Marketing sends carry a one-click way out; the reward email is transactional. */
  unsubscribeUrl?: string;
}): Rendered {
  const ar = input.locale === 'ar';
  const date = input.expiresAt.toISOString().slice(0, 10);
  const heading =
    input.kind === 'welcome'
      ? ar
        ? 'أهلاً بك — هذا كود طلبك الأول'
        : 'Welcome — here is your first-order code'
      : ar
        ? 'شكراً على الإحالة'
        : 'Thank you for the referral';
  const lede =
    input.kind === 'welcome'
      ? ar
        ? `خصم ${input.amount} على طلبك الأول. الكود لك وحدك، لمرّة واحدة، وينتهي في ${date}.`
        : `${input.amount} off your first order. The code is yours alone, works once, and expires on ${date}.`
      : ar
        ? `اكتمل طلب صديقك، وهذا كود بقيمة ${input.amount} لطلبك القادم. لمرّة واحدة، وينتهي في ${date}.`
        : `Your friend's order has cleared, and here is ${input.amount} off your next order. It works once and expires on ${date}.`;

  const body = `<h1 style="margin:0 0 8px;font-size:20px;">${escape(heading)}</h1>
<p>${escape(lede)}</p>
<p style="margin:16px 0;font:700 22px/1.2 monospace;letter-spacing:2px;" dir="ltr">${escape(input.code)}</p>
${button(input.storeUrl, ar ? 'تسوّق الآن' : 'Shop now')}
${licenceLine(ar, input.licenceNumber)}
${unsubscribeLine(ar, input.unsubscribeUrl)}`;

  return {
    subject: heading,
    html: shell({
      locale: input.locale,
      title: heading,
      body,
      footerNote: ar
        ? 'وصلتك هذه الرسالة لأنك وافقت على رسائل العروض. يمكنك إلغاء الاشتراك في أي وقت.'
        : 'You are receiving this because you agreed to deal emails. You can unsubscribe at any time.',
    }),
    text: [
      heading,
      lede,
      '',
      input.code,
      '',
      input.storeUrl,
      ...(input.licenceNumber
        ? [`${ar ? 'رقم ترخيص التخفيض' : 'Discount licence no.'} ${input.licenceNumber}`]
        : []),
      ...(input.unsubscribeUrl
        ? ['', `${ar ? 'إلغاء الاشتراك' : 'Unsubscribe'}: ${input.unsubscribeUrl}`]
        : []),
    ].join('\n'),
  };
}

function unsubscribeLine(ar: boolean, url: string | undefined): string {
  if (!url) return '';
  return `<p style="color:${MUTED};font-size:12px;"><a href="${escape(url)}" style="color:${MUTED};">${
    ar ? 'إلغاء الاشتراك في رسائل العروض' : 'Unsubscribe from deal emails'
  }</a></p>`;
}

/**
 * The quote request, to the notify address.
 *
 * Built from the stored row rather than the request, and with the company and
 * seats first because they decide who picks it up.
 */
export function businessQuoteToStore(input: {
  company: string;
  name: string;
  email: string;
  phone: string | null;
  vatNumber: string | null;
  product: string | null;
  seats: number;
  message: string;
  id: string;
}): Rendered {
  const rows: [string, string][] = [
    ['الشركة', input.company],
    ['المقاعد', String(input.seats)],
    ...(input.product ? ([['المنتج', input.product]] as [string, string][]) : []),
    ['الاسم', input.name],
    ['البريد', input.email],
    ...(input.phone ? ([['الهاتف', input.phone]] as [string, string][]) : []),
    ...(input.vatNumber ? ([['الرقم الضريبي', input.vatNumber]] as [string, string][]) : []),
  ];
  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:${MUTED};white-space:nowrap;">${escape(label)}</td><td style="padding:6px 12px;"><strong dir="auto">${escape(value)}</strong></td></tr>`,
    )
    .join('');
  const body = `<h1 style="margin:0 0 12px;font-size:20px;">طلب عرض سعر للشركات</h1>
<table role="presentation" cellpadding="0" cellspacing="0">${table}</table>
${input.message ? `<div dir="auto" style="margin-top:12px;padding:14px;background:#f6f6f6;border-radius:6px;white-space:pre-wrap;">${escape(input.message)}</div>` : ''}
<p style="color:${MUTED};font-size:12px;">في صندوق الرسائل · المعرّف ${escape(input.id)}</p>`;
  return {
    subject: `[مبيعات الشركات] ${input.company} — ${String(input.seats)}`,
    html: shell({ locale: 'ar', title: 'Business quote', body }),
    text: [
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      input.message,
      '',
      `id ${input.id}`,
    ].join('\n'),
  };
}
