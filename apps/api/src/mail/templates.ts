/**
 * Transactional email templates.
 *
 * Written as plain functions returning subject, HTML and text rather than
 * pulled through a template engine. There are three of them, they change
 * rarely, and a rendering step between the data and the message is one more
 * place a licence key could end up somewhere it should not.
 *
 * Every template is built for an inbox, not a browser: tables for layout,
 * inline styles, no external CSS and no images that must load. Arabic mail is
 * `dir="rtl"` on the body — Outlook ignores a stylesheet and honours the
 * attribute.
 *
 * And every one of them carries a plain-text alternative. A licence key in an
 * HTML-only email is a key some clients will mangle and some will hide.
 */

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const BRAND_AR = 'متجر التفعيل الرقمي';
const BRAND_EN = 'Digital Activation';

const TEAL = '#148576';
const INK = '#1c2422';
const MUTED = '#6b7472';
const BORDER = '#e2e5e4';

function shell(input: {
  locale: 'ar' | 'en';
  title: string;
  body: string;
  footerNote?: string;
}): string {
  const ar = input.locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const brand = ar ? BRAND_AR : BRAND_EN;
  const align = ar ? 'right' : 'left';

  return `<!doctype html>
<html lang="${input.locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(input.title)}</title>
</head>
<body dir="${dir}" style="margin:0;padding:0;background:#f6f6f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;">
      <tr><td style="padding:20px 24px;border-bottom:1px solid ${BORDER};">
        <span style="font:700 18px/1.3 'Segoe UI',Tahoma,Arial,sans-serif;color:${TEAL};">${escape(brand)}</span>
      </td></tr>
      <tr><td dir="${dir}" align="${align}" style="padding:24px;font:400 15px/1.7 'Segoe UI',Tahoma,Arial,sans-serif;color:${INK};">
${input.body}
      </td></tr>
      <tr><td dir="${dir}" align="${align}" style="padding:16px 24px;border-top:1px solid ${BORDER};font:400 13px/1.6 'Segoe UI',Tahoma,Arial,sans-serif;color:${MUTED};">
        ${escape(input.footerNote ?? (ar ? 'هذه رسالة تلقائية تتعلّق بطلبك.' : 'This is an automated message about your order.'))}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Everything interpolated goes through this. An order number is user data. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="background:${TEAL};border-radius:5px;">
    <a href="${escape(href)}" style="display:inline-block;padding:12px 24px;font:700 15px/1 'Segoe UI',Tahoma,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escape(label)}</a>
  </td></tr></table>`;
}

export interface OrderLineView {
  productName: string;
  sku: string;
  qty: number;
  /** Already formatted with its currency symbol. */
  lineTotal: string;
  /** How this line is supplied, in the customer's words. */
  supplyNote: string;
}

/**
 * Payment received.
 *
 * The one job of this email is to set the expectation, because for most of
 * this catalog the key does not arrive with it. A customer who is told "we are
 * ordering it from the supplier, here within six hours, and here is why that
 * protects your licence term" does not write in after twenty minutes.
 */
export function orderReceived(input: {
  locale: 'ar' | 'en';
  orderNumber: string;
  total: string;
  lines: OrderLineView[];
  orderUrl: string;
  activationEmail: string | null;
}): Rendered {
  const ar = input.locale === 'ar';

  const rows = input.lines
    .map(
      (line) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BORDER};">
          <strong style="color:${INK};">${escape(line.productName)}</strong><br>
          <span style="color:${MUTED};font-size:13px;">${escape(line.sku)} × ${String(line.qty)}</span><br>
          <span style="color:${TEAL};font-size:13px;">${escape(line.supplyNote)}</span>
        </td>
        <td align="${ar ? 'left' : 'right'}" style="padding:10px 0;border-bottom:1px solid ${BORDER};white-space:nowrap;">${escape(line.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const activation = input.activationEmail
    ? ar
      ? `<p style="background:#fdf1dc;padding:12px;border-radius:5px;">سيُفعَّل الترخيص على: <strong dir="ltr">${escape(input.activationEmail)}</strong><br>إن كان هذا غير صحيح، راسِلنا قبل أن نطلبه من المورّد.</p>`
      : `<p style="background:#fdf1dc;padding:12px;border-radius:5px;">The licence will be activated on: <strong dir="ltr">${escape(input.activationEmail)}</strong><br>If that is wrong, reply before we place the supplier order.</p>`
    : '';

  const body = ar
    ? `<h1 style="margin:0 0 8px;font-size:20px;">وصلنا مبلغ طلبك</h1>
<p style="margin:0 0 16px;color:${MUTED};">رقم الطلب <strong dir="ltr">${escape(input.orderNumber)}</strong></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:16px 0 0;font-size:17px;"><strong>الإجمالي: ${escape(input.total)}</strong></p>
${activation}
<p>معظم منتجاتنا تُطلَب من المورّد بعد الدفع، حتى لا تبدأ مدّة ترخيصك قبل أن تستخدمه. المدّة المذكورة أمام كل سطر هي المدّة التي نعمل بها.</p>
${button(input.orderUrl, 'تابع حالة الطلب')}`
    : `<h1 style="margin:0 0 8px;font-size:20px;">We have your payment</h1>
<p style="margin:0 0 16px;color:${MUTED};">Order <strong dir="ltr">${escape(input.orderNumber)}</strong></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
<p style="margin:16px 0 0;font-size:17px;"><strong>Total: ${escape(input.total)}</strong></p>
${activation}
<p>Most of our products are ordered from the supplier after payment, so your licence term does not start before you use it. The window shown next to each line is the one we work to.</p>
${button(input.orderUrl, 'Track your order')}`;

  const text = ar
    ? [
        `وصلنا مبلغ طلبك ${input.orderNumber}.`,
        '',
        ...input.lines.map(
          (l) =>
            `- ${l.productName} (${l.sku} × ${String(l.qty)}) — ${l.lineTotal}\n  ${l.supplyNote}`,
        ),
        '',
        `الإجمالي: ${input.total}`,
        input.activationEmail ? `سيُفعَّل الترخيص على: ${input.activationEmail}` : '',
        '',
        'معظم منتجاتنا تُطلَب من المورّد بعد الدفع، حتى لا تبدأ مدّة ترخيصك قبل أن تستخدمه.',
        input.orderUrl,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `We have your payment for order ${input.orderNumber}.`,
        '',
        ...input.lines.map(
          (l) =>
            `- ${l.productName} (${l.sku} x ${String(l.qty)}) — ${l.lineTotal}\n  ${l.supplyNote}`,
        ),
        '',
        `Total: ${input.total}`,
        input.activationEmail ? `The licence will be activated on: ${input.activationEmail}` : '',
        '',
        'Most of our products are ordered from the supplier after payment, so your licence term does not start before you use it.',
        input.orderUrl,
      ]
        .filter(Boolean)
        .join('\n');

  return {
    subject: ar
      ? `تأكيد الدفع — طلب ${input.orderNumber}`
      : `Payment received — order ${input.orderNumber}`,
    html: shell({ locale: input.locale, title: 'Order received', body }),
    text,
  };
}

/**
 * One delivered secret, in the shape the vault hands over.
 *
 * Mirrors the vault's own parsed form rather than re-deriving it: the one place
 * that knows how an account payload is laid out is the vault, and a template
 * that splits a string on a guessed separator is a template that eventually
 * prints half a password.
 */
export type DeliveredSecret =
  | { kind: 'ACTIVATION_KEY'; key: string | null }
  | { kind: 'ACCOUNT_CREDENTIALS'; username: string | null; password: string | null };

/**
 * A secret as a block in the message body.
 *
 * An account is two labelled lines, not one string. A customer who is sent
 * `user@example.com` and `hunter2` run together has to guess where one ends,
 * and guessing wrong on a subscription account locks it after a few tries.
 *
 * No anchor wraps any of this: a link-tracking proxy rewrites hrefs, and a
 * rewritten key is a key that does not work.
 */
function secretBlock(secret: DeliveredSecret, ar: boolean): string {
  const frame = (inner: string): string =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;background:#f6f6f6;border:1px dashed ${TEAL};border-radius:5px;"><tr><td style="padding:14px;">${inner}</td></tr></table>`;

  const mono = (value: string): string =>
    `<span dir="ltr" style="font:700 16px/1.6 'Courier New',Consolas,monospace;color:${INK};word-break:break-all;">${escape(value)}</span>`;

  const label = (text: string): string =>
    `<span style="display:inline-block;min-width:110px;font-size:13px;color:${MUTED};">${escape(text)}</span>`;

  if (secret.kind === 'ACCOUNT_CREDENTIALS') {
    return frame(
      `<div style="margin:0 0 6px;">${label(ar ? 'اسم المستخدم' : 'Username')}${mono(secret.username ?? '')}</div>` +
        `<div>${label(ar ? 'كلمة المرور' : 'Password')}${mono(secret.password ?? '')}</div>`,
    );
  }
  return frame(
    `<div>${label(ar ? 'مفتاح التفعيل' : 'Activation key')}${mono(secret.key ?? '')}</div>`,
  );
}

/** The same thing for the plain-text alternative, which some clients show. */
function secretLines(secret: DeliveredSecret, ar: boolean): string[] {
  if (secret.kind === 'ACCOUNT_CREDENTIALS') {
    return [
      `${ar ? 'اسم المستخدم' : 'Username'}: ${secret.username ?? ''}`,
      `${ar ? 'كلمة المرور' : 'Password'}: ${secret.password ?? ''}`,
    ];
  }
  return [`${ar ? 'مفتاح التفعيل' : 'Activation key'}: ${secret.key ?? ''}`];
}

/**
 * The licence itself.
 *
 * This is the only message that carries the product. Two consequences run all
 * the way through the mail module: the key is never written to a log, a
 * NotificationLog payload or an order note, and this email is sent before the
 * line is marked delivered — never after, because "delivered" has to mean the
 * message left.
 *
 * The key is presented as selectable text in a monospace block with no link
 * wrapped around it. A key inside an anchor gets rewritten by link-tracking
 * proxies, and a rewritten key is a key that does not work.
 */
export function licenceDelivered(input: {
  locale: 'ar' | 'en';
  orderNumber: string;
  productName: string;
  secrets: DeliveredSecret[];
  activationSteps: string[];
  activationEmail: string | null;
  orderUrl: string;
  supportEmail: string;
  warrantyNote: string;
}): Rendered {
  const ar = input.locale === 'ar';

  const keyBlocks = input.secrets.map((secret) => secretBlock(secret, ar)).join('');

  const steps =
    input.activationSteps.length > 0
      ? `<ol style="padding-${ar ? 'right' : 'left'}:20px;">${input.activationSteps
          .map((step) => `<li style="margin:6px 0;">${escape(step)}</li>`)
          .join('')}</ol>`
      : '';

  const activation = input.activationEmail
    ? ar
      ? `<p style="color:${MUTED};">مُفعَّل على: <strong dir="ltr">${escape(input.activationEmail)}</strong></p>`
      : `<p style="color:${MUTED};">Activated on: <strong dir="ltr">${escape(input.activationEmail)}</strong></p>`
    : '';

  const body = ar
    ? `<h1 style="margin:0 0 8px;font-size:20px;">ترخيصك جاهز</h1>
<p style="margin:0 0 16px;color:${MUTED};">${escape(input.productName)} — طلب <span dir="ltr">${escape(input.orderNumber)}</span></p>
${keyBlocks}
${activation}
<p><strong>احفظ هذه الرسالة.</strong> هذه هي النسخة التي تُسلَّم إليك؛ خطوات التفعيل موجودة أيضاً في صفحة طلبك.</p>
${steps}
<p style="color:${MUTED};">${escape(input.warrantyNote)}</p>
<p>إن لم يعمل الكود، راسِلنا على <a href="mailto:${escape(input.supportEmail)}" style="color:${TEAL};">${escape(input.supportEmail)}</a> ولا تحاول تفعيله مراراً.</p>
${button(input.orderUrl, 'صفحة الطلب')}`
    : `<h1 style="margin:0 0 8px;font-size:20px;">Your licence is ready</h1>
<p style="margin:0 0 16px;color:${MUTED};">${escape(input.productName)} — order <span dir="ltr">${escape(input.orderNumber)}</span></p>
${keyBlocks}
${activation}
<p><strong>Keep this email.</strong> This is the copy that is delivered to you; the activation steps are also on your order page.</p>
${steps}
<p style="color:${MUTED};">${escape(input.warrantyNote)}</p>
<p>If the code does not work, write to <a href="mailto:${escape(input.supportEmail)}" style="color:${TEAL};">${escape(input.supportEmail)}</a> rather than retrying the activation.</p>
${button(input.orderUrl, 'Your order')}`;

  const text = ar
    ? [
        `ترخيصك جاهز — ${input.productName}`,
        `طلب ${input.orderNumber}`,
        '',
        ...input.secrets.flatMap((secret) => secretLines(secret, true)),
        '',
        input.activationEmail ? `مُفعَّل على: ${input.activationEmail}` : '',
        ...input.activationSteps.map((step, index) => `${String(index + 1)}. ${step}`),
        '',
        input.warrantyNote,
        `الدعم: ${input.supportEmail}`,
        input.orderUrl,
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `Your licence is ready — ${input.productName}`,
        `Order ${input.orderNumber}`,
        '',
        ...input.secrets.flatMap((secret) => secretLines(secret, false)),
        '',
        input.activationEmail ? `Activated on: ${input.activationEmail}` : '',
        ...input.activationSteps.map((step, index) => `${String(index + 1)}. ${step}`),
        '',
        input.warrantyNote,
        `Support: ${input.supportEmail}`,
        input.orderUrl,
      ]
        .filter(Boolean)
        .join('\n');

  return {
    subject: ar ? `ترخيصك — ${input.productName}` : `Your licence — ${input.productName}`,
    html: shell({
      locale: input.locale,
      title: 'Your licence',
      body,
      footerNote: ar
        ? 'لا تشارك هذا الكود مع أحد. لا يمكن استبداله إن استُخدم من طرف آخر.'
        : 'Do not share this code. It cannot be replaced if somebody else uses it.',
    }),
    text,
  };
}

/**
 * The sign-in link for the customer's own licences.
 *
 * Deliberately dull, and it says three things: what it opens, how long it
 * lasts, and that ignoring it is safe. An email that arrives unasked and reads
 * urgently is the shape of a phishing message, and the customers of a store
 * that sells activation keys are exactly the people who should be suspicious
 * of one.
 *
 * The link is also printed as text beside the button. Some clients strip the
 * button, and a sign-in email whose only affordance did not render is a
 * support ticket.
 */
export function accountLink(input: {
  locale: 'ar' | 'en';
  url: string;
  minutes: number;
  supportEmail: string;
}): Rendered {
  const ar = input.locale === 'ar';

  const body = ar
    ? `<h1 style="margin:0 0 8px;font-size:20px;">رابط الدخول إلى تراخيصك</h1>
<p>اضغط الزر لعرض المفاتيح والحسابات التي اشتريتها، وخطوات تفعيل كل واحد منها.</p>
${button(input.url, 'اعرض تراخيصي')}
<p style="color:${MUTED};font-size:13px;">الرابط يعمل لمرّة واحدة ولمدّة ${String(input.minutes)} دقيقة. إن لم تطلبه أنت، تجاهل هذه الرسالة — لن يتغيّر شيء في حسابك.</p>
<p style="color:${MUTED};font-size:13px;word-break:break-all;" dir="ltr">${escape(input.url)}</p>`
    : `<h1 style="margin:0 0 8px;font-size:20px;">Your sign-in link</h1>
<p>Open your licences to see the keys and accounts you bought, and how to activate each one.</p>
${button(input.url, 'View my licences')}
<p style="color:${MUTED};font-size:13px;">The link works once and for ${String(input.minutes)} minutes. If you did not ask for it, ignore this email — nothing about your account changes.</p>
<p style="color:${MUTED};font-size:13px;word-break:break-all;" dir="ltr">${escape(input.url)}</p>`;

  const text = ar
    ? [
        'رابط الدخول إلى تراخيصك:',
        input.url,
        '',
        `يعمل لمرّة واحدة ولمدّة ${String(input.minutes)} دقيقة.`,
        'إن لم تطلبه أنت، تجاهل هذه الرسالة.',
        `الدعم: ${input.supportEmail}`,
      ].join('\n')
    : [
        'Your sign-in link:',
        input.url,
        '',
        `It works once and for ${String(input.minutes)} minutes.`,
        'If you did not ask for it, ignore this email.',
        `Support: ${input.supportEmail}`,
      ].join('\n');

  return {
    subject: ar ? 'رابط الدخول إلى تراخيصك' : 'Your sign-in link',
    html: shell({
      locale: input.locale,
      title: 'Sign-in link',
      body,
      footerNote: ar
        ? 'لا نطلب منك كلمة مرور أبداً. الدخول يكون برابط يُرسَل إلى بريدك فقط.'
        : 'We never ask you for a password. Signing in is always a link sent to your email.',
    }),
    text,
  };
}

/**
 * Something went wrong with one line, and the customer is told before they ask.
 *
 * Sent when a line is marked failed. It names what failed and what happens
 * next; a silent failure is how a paying customer ends up chasing a store.
 */
export function fulfilmentFailed(input: {
  locale: 'ar' | 'en';
  orderNumber: string;
  productName: string;
  supportEmail: string;
  orderUrl: string;
}): Rendered {
  const ar = input.locale === 'ar';

  const body = ar
    ? `<h1 style="margin:0 0 8px;font-size:20px;">تعذّر تجهيز أحد بنود طلبك</h1>
<p>${escape(input.productName)} — طلب <span dir="ltr">${escape(input.orderNumber)}</span></p>
<p>لم نتمكّن من توفير هذا البند، ولم نأخذ منك شيئاً مقابله دون أن نعلمك. فريقنا يتابع الأمر وسيتواصل معك: إمّا ببديل أو باسترداد قيمة البند.</p>
<p>للاستفسار: <a href="mailto:${escape(input.supportEmail)}" style="color:${TEAL};">${escape(input.supportEmail)}</a></p>
${button(input.orderUrl, 'صفحة الطلب')}`
    : `<h1 style="margin:0 0 8px;font-size:20px;">We could not fulfil one item</h1>
<p>${escape(input.productName)} — order <span dir="ltr">${escape(input.orderNumber)}</span></p>
<p>We were not able to supply this item. Our team is on it and will come back to you with either a replacement or a refund for that line.</p>
<p>Questions: <a href="mailto:${escape(input.supportEmail)}" style="color:${TEAL};">${escape(input.supportEmail)}</a></p>
${button(input.orderUrl, 'Your order')}`;

  return {
    subject: ar ? `بخصوص طلب ${input.orderNumber}` : `About order ${input.orderNumber}`,
    html: shell({ locale: input.locale, title: 'Fulfilment problem', body }),
    text: ar
      ? `تعذّر تجهيز ${input.productName} في طلب ${input.orderNumber}. فريقنا يتابع وسيتواصل معك ببديل أو استرداد.\nالدعم: ${input.supportEmail}\n${input.orderUrl}`
      : `We could not fulfil ${input.productName} in order ${input.orderNumber}. Our team will come back with a replacement or a refund.\nSupport: ${input.supportEmail}\n${input.orderUrl}`,
  };
}
