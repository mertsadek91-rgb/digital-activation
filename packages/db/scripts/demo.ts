/**
 * Demonstration data for the three panel screens that have never had any.
 *
 *   pnpm db:demo            report only, writes nothing
 *   pnpm db:demo --apply    write
 *   pnpm db:demo --drop     remove every row it wrote
 *
 * The fulfilment queue, the messages inbox and the review moderation screen are
 * all empty on this store, which means their layouts have never been seen with
 * anything in them. A table designed against an empty list is a table designed
 * against a guess.
 *
 * This writes to the real database, so every row it creates is marked twice
 * over: the addresses are `@example.invalid`, a domain reserved by RFC 2606
 * that can never receive mail, and every visible name starts with "تجريبي".
 * `--drop` finds them by those markers and removes them. Nothing here is
 * subtle: demonstration data that could be mistaken for a customer is worse
 * than no demonstration data.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env'), quiet: true });

import { prisma } from '../src/index.js';

/** The one string every row this script writes can be found by. */
const MARK = 'zz-demo-';
const DOMAIN = '@example.invalid';

const PEOPLE = [
  { first: 'تجريبي سارة', last: 'العتيبي', email: `${MARK}sara${DOMAIN}` },
  { first: 'تجريبي خالد', last: 'الدوسري', email: `${MARK}khaled${DOMAIN}` },
  { first: 'تجريبي نورة', last: 'القحطاني', email: `${MARK}noura${DOMAIN}` },
  { first: 'تجريبي عبدالله', last: 'الشمري', email: `${MARK}abdullah${DOMAIN}` },
];

/** The name as anything outside `Customer` writes it. */
const fullName = (person: (typeof PEOPLE)[number]): string => `${person.first} ${person.last}`;

const MESSAGES = [
  {
    topic: 'ACTIVATION' as const,
    person: 0,
    hoursAgo: 31,
    orderNumber: true,
    message:
      'حاولت تفعيل المفتاح على جهازين، الأول قبِله والثاني يقول إن المفتاح مستخدم. هل أحتاج ترخيصاً ثانياً أم أن هناك خطأ؟',
  },
  {
    topic: 'PRESALE' as const,
    person: 1,
    hoursAgo: 26,
    orderNumber: false,
    message:
      'أريد أوفيس لجهاز ماك وجهاز ويندوز في البيت. أي نسخة تغطّي الاثنين، وهل الترخيص ينتقل لو غيّرت الجهاز لاحقاً؟',
  },
  {
    topic: 'ORDER' as const,
    person: 2,
    hoursAgo: 5,
    orderNumber: true,
    message: 'حوّلت المبلغ من ساعتين وأرسلت الإيصال على واتساب. متى يصلني المفتاح؟',
  },
  {
    topic: 'BUSINESS' as const,
    person: 3,
    hoursAgo: 2,
    orderNumber: false,
    message:
      'نحتاج 25 ترخيص ويندوز 11 برو لشركة، مع فاتورة ضريبية باسم المنشأة. هل يوجد سعر للكميات؟',
  },
  {
    topic: 'OTHER' as const,
    person: 0,
    hoursAgo: 1,
    orderNumber: false,
    message: 'هل تبيعون تراخيص أدوبي للطلاب بسعر مخفّض؟',
  },
];

const REVIEWS = [
  {
    person: 0,
    rating: 5,
    title: 'وصل خلال دقائق',
    body: 'طلبت الساعة الواحدة ليلاً ووصلني المفتاح قبل أن أُغلق اللابتوب. تفعيل من أول محاولة.',
  },
  {
    person: 1,
    rating: 4,
    title: 'ممتاز مع ملاحظة',
    body: 'المفتاح أصلي والتفعيل تمّ بلا مشاكل. تأخّر التسليم نحو ساعة عمّا هو مكتوب، وهذا كل مأخذي.',
  },
  {
    person: 2,
    rating: 5,
    title: null,
    body: 'اشتريت منهم للمرة الثالثة. الدعم يردّ بالعربية ويفهم المشكلة من أول رسالة.',
  },
  {
    person: 3,
    rating: 2,
    title: 'المفتاح لم يعمل أول مرة',
    body: 'المفتاح الأول رفض التفعيل واضطررت لمراسلة الدعم. استبدلوه خلال ساعتين والثاني عمل، لكن التجربة كان يمكن أن تكون أفضل.',
  },
];

async function drop(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { email: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = orders.map((order) => order.id);

  // Reviews and payments first: both point at rows that are about to go.
  await prisma.review.deleteMany({ where: { customer: { email: { startsWith: MARK } } } });
  if (ids.length > 0) {
    await prisma.payment.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.notificationLog.deleteMany({ where: { toAddress: { startsWith: MARK } } });
  await prisma.contactMessage.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.customer.deleteMany({ where: { email: { startsWith: MARK } } });

  console.log(`removed ${String(ids.length)} demo order(s) and everything hanging off them`);
  console.log(`orders now: ${String(await prisma.order.count())}`);
  console.log(`customers now: ${String(await prisma.customer.count())}`);
  console.log(`messages now: ${String(await prisma.contactMessage.count())}`);
  console.log(`reviews now: ${String(await prisma.review.count())}`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--drop')) {
    await drop();
    await prisma.$disconnect();
    return;
  }

  const apply = process.argv.includes('--apply');

  // Real variants, so the queue rows describe products that exist and the
  // reviews attach to something a shopper can open.
  const variants = await prisma.variant.findMany({
    where: { status: 'PUBLISHED', product: { status: 'PUBLISHED' } },
    include: { product: { include: { translations: { where: { locale: 'AR' } } } } },
    orderBy: { sku: 'asc' },
    take: 6,
  });

  if (variants.length < 4) {
    console.log('Not enough published variants to build a believable queue.');
    await prisma.$disconnect();
    return;
  }

  console.log(`people   : ${String(PEOPLE.length)}  (all ${DOMAIN}, names prefixed "تجريبي")`);
  console.log(`messages : ${String(MESSAGES.length)}`);
  console.log(`reviews  : ${String(REVIEWS.length)}`);
  console.log(`queue    : ${String(variants.length)} paid lines awaiting supply`);
  for (const variant of variants) {
    console.log(`   ${variant.sku.padEnd(40)} ${variant.product.translations[0]?.name?.slice(0, 40) ?? ''}`);
  }

  if (!apply) {
    console.log('\nDry run. Pass --apply to write, --drop to remove it again.');
    await prisma.$disconnect();
    return;
  }

  await drop();
  console.log('');

  const customers = [];
  for (const person of PEOPLE) {
    customers.push(
      await prisma.customer.create({
        data: { email: person.email, firstName: person.first, lastName: person.last },
      }),
    );
  }

  // --- the queue: two paid orders whose lines are still waiting on somebody ---
  const now = Date.now();
  let made = 0;
  for (const [index, customer] of customers.slice(0, 2).entries()) {
    const lines = variants.slice(index * 3, index * 3 + 3);
    if (lines.length === 0) continue;

    const total = lines.reduce((sum, line) => sum + Number(line.priceUsd), 0);
    // Old enough that one of them is past its promised window, which is the
    // state the queue exists to make visible.
    const paidAt = new Date(now - (index === 0 ? 9 : 1) * 3600_000);

    const order = await prisma.order.create({
      data: {
        number: `DA-DEMO-${String(index + 1).padStart(5, '0')}`,
        email: customer.email,
        customerId: customer.id,
        status: 'PAID',
        paidAt,
        createdAt: paidAt,
        currency: 'USD',
        subtotalUsd: total.toFixed(2),
        totalUsd: total.toFixed(2),
        activationEmail: customer.email,
        items: {
          create: lines.map((line) => ({
            variantId: line.id,
            productNameSnapshot: line.product.translations[0]?.name ?? line.sku,
            skuSnapshot: line.sku,
            qty: 1,
            unitPriceUsd: line.priceUsd,
            lineTotalUsd: line.priceUsd,
            fulfillmentState: 'MANUAL_QUEUE',
          })),
        },
      },
      include: { items: true },
    });
    made += order.items.length;
  }

  // --- messages ---
  for (const entry of MESSAGES) {
    const person = PEOPLE[entry.person]!;
    const customer = customers[entry.person]!;
    const at = new Date(now - entry.hoursAgo * 3600_000);
    await prisma.contactMessage.create({
      data: {
        topic: entry.topic,
        status: 'NEW',
        name: fullName(person),
        email: person.email,
        orderNumber: entry.orderNumber ? 'DA-DEMO-00001' : null,
        message: entry.message,
        locale: 'AR',
        customerId: customer.id,
        createdAt: at,
      },
    });
  }

  // --- reviews: one per bought line, which is what the schema allows ---
  const delivered = await prisma.order.create({
    data: {
      number: 'DA-DEMO-00003',
      email: customers[0]!.email,
      customerId: customers[0]!.id,
      status: 'COMPLETED',
      paidAt: new Date(now - 14 * 24 * 3600_000),
      createdAt: new Date(now - 14 * 24 * 3600_000),
      currency: 'USD',
      subtotalUsd: '0.00',
      totalUsd: '0.00',
      items: {
        create: REVIEWS.map((_, index) => {
          const line = variants[index % variants.length]!;
          return {
            variantId: line.id,
            productNameSnapshot: line.product.translations[0]?.name ?? line.sku,
            skuSnapshot: line.sku,
            qty: 1,
            unitPriceUsd: line.priceUsd,
            lineTotalUsd: line.priceUsd,
            fulfillmentState: 'DELIVERED' as const,
            deliveredAt: new Date(now - 13 * 24 * 3600_000),
          };
        }),
      },
    },
    include: { items: true },
  });

  for (const [index, entry] of REVIEWS.entries()) {
    const item = delivered.items[index];
    if (!item) continue;
    await prisma.review.create({
      data: {
        productId: variants[index % variants.length]!.productId,
        orderItemId: item.id,
        customerId: customers[entry.person]!.id,
        rating: entry.rating,
        title: entry.title,
        body: entry.body,
        locale: 'AR',
        status: 'PENDING',
        createdAt: new Date(now - (index + 1) * 20 * 3600_000),
      },
    });
  }

  console.log(`wrote ${String(customers.length)} customers`);
  console.log(`wrote ${String(made)} queue lines across 2 paid orders`);
  console.log(`wrote ${String(MESSAGES.length)} messages`);
  console.log(`wrote ${String(REVIEWS.length)} reviews awaiting moderation`);
  console.log('\nRemove all of it with: pnpm db:demo -- --drop');

  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
