import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type OrderMessageResult, ROUTES, type SendOrderMessage } from '@da/contracts';
import { Locale, OrderStatus, Prisma, PromotionScope, PromotionType } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { licenceExpiry, termOf } from '../common/licence-term.js';
import { orderLink } from '../common/order-link.js';
import { say } from '../common/panel-locale.js';
import { MailService } from '../mail/mail.service.js';
import { offerEmail, paymentReceived, storeMessage } from '../mail/templates.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatDate, storefrontUrl, unsubscribeLinks } from '../retention/links.js';
import { hasMarketingConsent, mintCode, storeTimeZone } from '../retention/rules.js';
import { renewalReminder } from '../retention/templates.js';
import { ReviewsService } from '../reviews/reviews.service.js';

import { chargedAmount } from './orders.service.js';

/** Statuses on which "your payment arrived, we are preparing it" would be a lie. */
const RECEIPT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
]);

/**
 * Messages a member of staff sends to a customer from the order page.
 *
 * Every one of them is a sentence the store already says on its own — the
 * receipt, the review invitation, the renewal reminder, a discount code —
 * sent now, by a person, because the automatic moment passed or never came.
 * The address is never a parameter: it is the order's, so this cannot be
 * used to send one customer's details to another.
 *
 * Marketing and service are kept apart the way the sweeps keep them apart. A
 * payment receipt or a reminder about a licence the customer owns is a
 * service message and goes to anybody; an offer is marketing, is refused
 * without recorded consent, and carries the one-click way out.
 *
 * Every attempt lands in `NotificationLog` with the order number in its
 * payload, which is how the order page's "messages" tab lists it beside the
 * automatic ones — and in the audit log, against the member of staff.
 */
@Injectable()
export class OrderMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly reviews: ReviewsService,
    private readonly audit: AuditService,
    private readonly settings: MarketingSettingsService,
  ) {}

  async send(input: {
    number: string;
    body: SendOrderMessage;
    staffId: string;
    staffRole: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<OrderMessageResult> {
    // A code is money leaving the shop, and the roles that may move money on
    // an order are the ones that confirm a payment or refund it.
    if (input.body.kind === 'offer' && !['OWNER', 'ADMIN'].includes(input.staffRole)) {
      throw new ForbiddenException(
        say(
          'إصدار كود خصم متاح للمالك والمدير فقط.',
          'Only the owner or an admin can issue a discount code.',
        ),
      );
    }
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            marketingOptInAt: true,
            marketingOptOutAt: true,
          },
        },
        items: {
          include: {
            variant: { select: { licensePeriodUnit: true, licensePeriodValue: true } },
          },
        },
        payments: { select: { state: true, amountCharged: true, chargedCurrency: true } },
      },
    });
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${input.number}`, `No order numbered ${input.number}`),
      );

    const locale: 'ar' | 'en' = order.locale === Locale.EN ? 'en' : 'ar';
    const firstName = order.customer?.firstName ?? null;
    const customerId = order.customerId ?? undefined;
    const storefront =
      process.env.STOREFRONT_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const orderUrl = orderLink(
      storefront,
      `${locale === 'en' ? '/en' : ''}${ROUTES.order(encodeURIComponent(order.number))}`,
      order.number,
    );

    let result: OrderMessageResult;

    switch (input.body.kind) {
      case 'payment_received': {
        if (!order.paidAt || !RECEIPT_STATUSES.has(order.status)) {
          result = this.skipped(order.email, 'order.payment_received', 'not_paid');
          break;
        }
        // What was charged, from the payment row; the USD total only when no
        // row says otherwise (a payment confirmed by hand before rows existed).
        const charged = chargedAmount(order.payments);
        const total = charged
          ? `${charged.amount} ${charged.currency}`
          : `${order.totalUsd.toFixed(2)} USD`;
        const sent = await this.mail.send({
          to: order.email,
          template: 'order.payment_received',
          locale,
          customerId,
          rendered: paymentReceived({
            locale,
            firstName,
            orderNumber: order.number,
            total,
            lines: order.items.map((item) => ({
              productName: item.productNameSnapshot,
              qty: item.qty,
            })),
            orderUrl,
            supportEmail: this.mail.supportEmail,
          }),
          payload: { orderNumber: order.number, byStaff: true },
        });
        result = {
          sent: sent.ok,
          to: order.email,
          template: 'order.payment_received',
          code: null,
          skipped: null,
        };
        break;
      }

      case 'review_request': {
        if (!order.customerId) {
          result = this.skipped(order.email, 'review.invite', 'guest_order');
          break;
        }
        const delivered = order.items.some((item) => item.fulfillmentState === 'DELIVERED');
        if (!delivered) {
          result = this.skipped(order.email, 'review.invite', 'nothing_delivered');
          break;
        }
        // Stage 0 is the manual one; the sweep's ladder starts at 1. The
        // unique index on (order, stage) makes a second press a no-op, and
        // the two ways `invite` declines are told apart so the skip is named
        // for what happened.
        const asked = await this.prisma.client.reviewInvite.findUnique({
          where: { orderId_stage: { orderId: order.id, stage: 0 } },
          select: { id: true },
        });
        if (asked) {
          result = this.skipped(order.email, 'review.invite', 'already_invited');
          break;
        }
        const invited = await this.reviews.invite({ orderId: order.id, stage: 0 });
        result = {
          sent: invited.sent,
          to: order.email,
          template: 'review.invite',
          code: null,
          skipped: invited.sent ? null : 'already_reviewed',
        };
        break;
      }

      case 'renewal_reminder': {
        const candidates = order.items.filter(
          (item) =>
            item.deliveredAt !== null &&
            (input.body.orderItemId === undefined || item.id === input.body.orderItemId),
        );
        const line = candidates
          .map((item) => ({
            item,
            expiresAt: licenceExpiry(
              item.deliveredAt as Date,
              termOf(item.variantSpecSnapshot, {
                unit: item.variant.licensePeriodUnit,
                value: item.variant.licensePeriodValue,
              }),
            ),
          }))
          .find((entry) => entry.expiresAt !== null);
        if (!line?.expiresAt) {
          result = this.skipped(order.email, 'renewal.reminder', 'no_term');
          break;
        }
        const now = new Date();
        const offsetDays = Math.round((line.expiresAt.getTime() - now.getTime()) / 86_400_000);
        const renew = storefrontUrl('/cart', locale);
        renew.searchParams.set('add', line.item.variantId);
        if (line.item.qty > 1) renew.searchParams.set('qty', String(line.item.qty));

        const sent = await this.mail.send({
          to: order.email,
          template: 'renewal.reminder',
          locale,
          customerId,
          rendered: renewalReminder({
            locale,
            firstName,
            productName: line.item.productNameSnapshot,
            qty: line.item.qty,
            expiresOn: formatDate(line.expiresAt, locale, storeTimeZone()),
            offsetDays,
            renewUrl: renew.toString(),
            accountUrl: storefrontUrl('/account/for-you', locale).toString(),
            offer: null,
            unsubscribeUrl: null,
          }),
          payload: { orderNumber: order.number, offsetDays, byStaff: true },
        });
        result = {
          sent: sent.ok,
          to: order.email,
          template: 'renewal.reminder',
          code: null,
          skipped: null,
        };
        break;
      }

      case 'offer': {
        if (!hasMarketingConsent(order.customer)) {
          throw new BadRequestException(
            say(
              'هذا العميل لم يوافق على رسائل التسويق، فلا يمكن إرسال عرض له.',
              'This customer has not consented to marketing, so an offer cannot be sent.',
            ),
          );
        }
        const percent = input.body.percent ?? 10;
        const validDays = input.body.validDays ?? 14;
        const now = new Date();
        const endsAt = new Date(now.getTime() + validDays * 86_400_000);
        const promotion = await this.prisma.client.promotion.create({
          data: {
            code: mintCode('OFFER'),
            type: PromotionType.PERCENT,
            scope: PromotionScope.CART,
            value: new Prisma.Decimal(percent),
            name: `Offer for ${order.number}`,
            description: `Sent by staff from order ${order.number}`,
            startsAt: now,
            endsAt,
            usageLimit: 1,
            perCustomerLimit: 1,
            singleUse: true,
            issuedToId: order.customerId,
            createdById: input.staffId,
          },
          select: { id: true, code: true },
        });
        const renewals = await this.settings.get('renewals');
        const unsubscribe = unsubscribeLinks(order.email, locale);
        const sent = await this.mail.send({
          to: order.email,
          template: 'admin.offer',
          locale,
          kind: 'marketing',
          customerId,
          rendered: offerEmail({
            locale,
            firstName,
            code: promotion.code ?? '',
            percent,
            validUntil: formatDate(endsAt, locale, storeTimeZone()),
            licenceNumber: renewals.discountLicenceNumber,
            note: input.body.body ?? null,
            storeUrl: storefrontUrl('/', locale).toString(),
            unsubscribeUrl: unsubscribe.pageUrl,
          }),
          headers: unsubscribe.headers,
          payload: { orderNumber: order.number, percent, validDays, byStaff: true },
        });
        if (!sent.ok) {
          // A code minted for a message that never left is switched off
          // rather than left live.
          await this.prisma.client.promotion.update({
            where: { id: promotion.id },
            data: { isActive: false },
          });
        }
        result = {
          sent: sent.ok,
          to: order.email,
          template: 'admin.offer',
          code: sent.ok ? promotion.code : null,
          skipped: null,
        };
        break;
      }

      case 'custom': {
        const sent = await this.mail.send({
          to: order.email,
          template: 'admin.message',
          locale,
          customerId,
          rendered: storeMessage({
            locale,
            firstName,
            subject: input.body.subject ?? '',
            body: input.body.body ?? '',
            orderNumber: order.number,
            orderUrl,
            supportEmail: this.mail.supportEmail,
          }),
          // The subject, never the body: the body is the staff member's prose
          // and may quote what the customer wrote.
          payload: { orderNumber: order.number, subject: input.body.subject ?? '', byStaff: true },
        });
        result = {
          sent: sent.ok,
          to: order.email,
          template: 'admin.message',
          code: null,
          skipped: null,
        };
        break;
      }
    }

    await this.audit.record({
      actorId: input.staffId,
      entity: 'Order',
      entityId: order.id,
      action: 'order.message_sent',
      after: {
        number: order.number,
        kind: input.body.kind,
        template: result.template,
        sent: result.sent,
        skipped: result.skipped,
        status: order.status,
      },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    return result;
  }

  private skipped(
    to: string,
    template: string,
    reason: NonNullable<OrderMessageResult['skipped']>,
  ): OrderMessageResult {
    return { sent: false, to, template, code: null, skipped: reason };
  }
}
