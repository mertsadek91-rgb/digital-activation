import { promotionRulesSchema } from '@da/contracts';
import type { Prisma } from '@da/db';

import { isFirstOrder, isSelfReferral } from '../growth/rules.js';
import type { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient | PrismaService['client'];

/** Why this buyer may not use a code that is otherwise valid on the cart. */
export type CustomerCouponRefusal = 'NOT_YOURS' | 'NOT_FIRST_ORDER' | 'SELF_REFERRAL';

/**
 * The half of coupon eligibility that depends on who is paying.
 *
 * `couponRefusal` answers for the cart and can run before an email exists.
 * This answers for the buyer, so it runs where the email is known — at
 * checkout, and again in `markPaid`, because two tabs can race past the first
 * check. Three rules:
 *
 *  - a code issued to one customer (a welcome code, a referral reward) is
 *    theirs alone; `singleUse` stops it being used twice, this stops it being
 *    forwarded and used once by somebody else;
 *  - `firstOrderOnly` means no earlier paid order, by customer or by email;
 *  - a referral friend code is refused to the referrer themselves.
 */
export async function customerCouponRefusal(
  db: Db,
  promotion: { id: string; issuedToId: string | null; rules: Prisma.JsonValue },
  buyer: { customerId: string | null; email: string; excludeOrderId?: string | undefined },
): Promise<CustomerCouponRefusal | null> {
  if (promotion.issuedToId && promotion.issuedToId !== buyer.customerId) return 'NOT_YOURS';

  const rules = promotionRulesSchema.safeParse(promotion.rules ?? {});
  if (rules.success && rules.data.firstOrderOnly) {
    const prior = await db.order.count({
      where: {
        paidAt: { not: null },
        ...(buyer.excludeOrderId ? { id: { not: buyer.excludeOrderId } } : {}),
        OR: [
          ...(buyer.customerId ? [{ customerId: buyer.customerId }] : []),
          { email: buyer.email },
        ],
      },
    });
    if (!isFirstOrder(prior)) return 'NOT_FIRST_ORDER';
  }

  const redemption = await db.referralRedemption.findUnique({
    where: { promotionId: promotion.id },
    select: { referral: { select: { customerId: true, customer: { select: { email: true } } } } },
  });
  if (
    redemption &&
    isSelfReferral(
      {
        customerId: redemption.referral.customerId,
        email: redemption.referral.customer.email,
      },
      { customerId: buyer.customerId, email: buyer.email },
    )
  ) {
    return 'SELF_REFERRAL';
  }
  return null;
}

/** What the shopper is told, in their language. */
export function customerCouponMessage(reason: CustomerCouponRefusal, locale: 'ar' | 'en'): string {
  const en = locale === 'en';
  switch (reason) {
    case 'NOT_YOURS':
      return en ? 'This code was issued to another customer.' : 'هذا الكود مخصّص لعميل آخر.';
    case 'NOT_FIRST_ORDER':
      return en ? 'This code is for a first order only.' : 'هذا الكود مخصّص للطلب الأول فقط.';
    case 'SELF_REFERRAL':
      return en
        ? 'A referral discount cannot be used on your own link.'
        : 'لا يمكن استخدام خصم الإحالة عبر رابطك أنت.';
  }
}
