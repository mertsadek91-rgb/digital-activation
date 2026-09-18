import { Injectable } from '@nestjs/common';

import type { LaunchCheck, LaunchReadiness } from '@da/contracts';
import { FulfillmentMode, Locale, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { PaymentSettingsService } from '../checkout/payment-settings.service.js';
import { MailService } from '../mail/mail.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultService } from '../vault/vault.service.js';

/**
 * Whether this store could take an order right now, and if not, what stops it.
 *
 * The panel had nine screens, each answering its own question, and no screen
 * answering the one the owner of a store that has not opened yet actually
 * asks. The default page redirects to the supplier queue — right reasoning for
 * a running shop, where everything in that queue is somebody who has paid, and
 * exactly nothing before the first sale, when the queue is empty by
 * definition and silent about why.
 *
 * Every signal here already existed and was readable from one screen each: the
 * payment methods know why they are not offered, the products know what blocks
 * publishing, the vault knows whether it can be reached. Gathering them is the
 * whole contribution — a person should not have to visit four screens and know
 * which four.
 *
 * The distinction it insists on is blocker against warning. A store with no
 * payment method cannot take money at all. A store with two published products
 * can, and is merely thin. A checklist that mixed those is a checklist nobody
 * finishes.
 */
@Injectable()
export class LaunchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentSettingsService,
    private readonly vault: VaultService,
    private readonly mailer: MailService,
  ) {}

  async readiness(): Promise<LaunchReadiness> {
    const checks = [
      await this.payment(),
      await this.catalog(),
      await this.sellable(),
      await this.policies(),
      await this.keys(),
      await this.mail(),
      await this.redirects(),
      await this.ledger(),
    ];

    return { canSell: checks.every((check) => check.severity !== 'blocker'), checks };
  }

  /**
   * The one that decides everything else.
   *
   * With no method offered the checkout has nothing to show, so no order can
   * be placed however good the catalog is. Each method already knows its own
   * reason, so they are quoted rather than summarised.
   */
  private async payment(): Promise<LaunchCheck> {
    const view = await this.payments.view();
    const offered = view.methods.filter((method) => method.isOffered);

    if (offered.length > 0) {
      return {
        key: 'payment',
        severity: 'ready',
        title: say('طرق الدفع', 'Payment methods'),
        detail: say(
          `${String(offered.length)} طريقة معروضة: ${offered.map((m) => m.provider).join('، ')}.`,
          `${String(offered.length)} offered: ${offered.map((m) => m.provider).join(', ')}.`,
        ),
        fix: '/payments',
      };
    }

    return {
      key: 'payment',
      severity: 'blocker',
      title: say('لا توجد طريقة دفع', 'No payment method'),
      // Every reason, not a count. "Four methods are off" sends somebody to
      // open four screens; the reasons say which one is closest to working.
      detail: view.methods
        .map((method) => `${method.provider}: ${method.blocker ?? ''}`)
        .join(' · '),
      fix: '/payments',
    };
  }

  /**
   * Something to sell.
   *
   * A blocker at zero and a warning below a handful. The number that matters
   * beside it is how many are held back by the publish gate, because that is
   * the difference between "nothing is written yet" and "everything is written
   * and nobody pressed publish".
   */
  private async catalog(): Promise<LaunchCheck> {
    const [published, total] = await Promise.all([
      this.prisma.client.product.count({ where: { status: PublishStatus.PUBLISHED } }),
      this.prisma.client.product.count(),
    ]);

    if (published === 0) {
      return {
        key: 'catalog',
        severity: 'blocker',
        title: say('لا منتج منشور', 'No published product'),
        detail: say(
          `${String(total)} منتجاً في الكتالوج، ولا واحد منشور. لا شيء يمكن شراؤه.`,
          `${String(total)} products in the catalog and not one published. There is nothing to buy.`,
        ),
        fix: '/products',
      };
    }

    if (published < 5) {
      return {
        key: 'catalog',
        severity: 'warning',
        title: say('الكتالوج رقيق', 'Thin catalog'),
        detail: say(
          `${String(published)} من ${String(total)} منشور. الباقي محجوب ببوّابة النشر — العنوان والوصف وSEO.`,
          `${String(published)} of ${String(total)} published. The rest are held by the publish gate — title, description and SEO.`,
        ),
        fix: '/products',
      };
    }

    return {
      key: 'catalog',
      severity: 'ready',
      title: say('الكتالوج', 'Catalog'),
      detail: say(
        `${String(published)} من ${String(total)} منشور.`,
        `${String(published)} of ${String(total)} published.`,
      ),
      fix: '/products',
    };
  }

  /**
   * Published, and actually buyable.
   *
   * These are not the same question, and the catalog check above only answers
   * the first. A variant supplied `FROM_STOCK` needs keys in the vault; with
   * none, the product page is complete, indexed, linked from the home page,
   * and the add-to-cart button answers «نفدت الكمية من هذا المتغيّر».
   *
   * It is a warning rather than a blocker because the rest of the catalog
   * still sells — and it is here at all because when this was written the
   * three variants concerned were Windows 11 Pro, Windows 10 Pro and Office
   * 2021 Pro Plus. The store could report "72 of 73 published" while the three
   * products it is best known for could not be put in a basket.
   *
   * `ON_DEMAND` and `MANUAL_SETUP` are ordered after the sale and have no
   * shelf to be empty, so they are not counted.
   */
  private async sellable(): Promise<LaunchCheck> {
    const stocked = await this.prisma.client.variant.findMany({
      where: {
        status: PublishStatus.PUBLISHED,
        product: { status: PublishStatus.PUBLISHED },
        fulfillmentMode: FulfillmentMode.FROM_STOCK,
      },
      select: {
        sku: true,
        inventory: { select: { onHand: true, reserved: true } },
        product: {
          select: { translations: { where: { locale: Locale.AR }, select: { name: true } } },
        },
      },
    });

    const empty = stocked.filter(
      (variant) => (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0) <= 0,
    );

    if (empty.length === 0) {
      return {
        key: 'sellable',
        severity: 'ready',
        title: say('المخزون', 'Stock'),
        detail:
          stocked.length === 0
            ? say(
                'لا متغيّر يُباع من المخزون — كل المنشور يُطلَب من المورّد بعد الشراء.',
                'No variant sells from stock — everything published is ordered from the supplier after the sale.',
              )
            : say(
                `${String(stocked.length)} متغيّراً يُباع من المخزون، وكلّها متوفّرة.`,
                `${String(stocked.length)} variants sell from stock, and all of them are in stock.`,
              ),
        fix: '/vault',
      };
    }

    // Named, not counted: "three variants" sends somebody to a list to work
    // out which three, and the names are the whole point of the warning.
    const names = empty
      .map((variant) => variant.product.translations[0]?.name ?? variant.sku)
      .slice(0, 4)
      .join(say('، ', ', '));

    return {
      key: 'sellable',
      severity: 'warning',
      title: say('منشور ولا يمكن شراؤه', 'Published and unbuyable'),
      detail: say(
        `${String(empty.length)} من ${String(stocked.length)} متغيّراً يُباع من المخزون نفد: ${names}. صفحاتها منشورة ومفهرسة، وزرّ الشراء يرفض.`,
        `${String(empty.length)} of ${String(stocked.length)} stocked variants have run out: ${names}. Their pages are published and indexed, and the buy button refuses.`,
      ),
      fix: '/vault',
    };
  }

  /**
   * The pages a store that takes money has to have published.
   *
   * A warning rather than a blocker because the checkout does not read them —
   * but a payment provider does, and so does anybody deciding whether to type
   * their card number in.
   */
  private async policies(): Promise<LaunchCheck> {
    // The slugs the pages are actually published under. An earlier version of
    // this check guessed `refund-policy` and `privacy-policy` and so reported
    // the privacy page as missing while it was live — a checklist that cries
    // wolf is one somebody stops reading.
    const required = ['refunds', 'terms', 'privacy'];
    const rows = await this.prisma.client.page.findMany({
      where: { slug: { in: required } },
      select: { slug: true, status: true },
    });

    const live = new Set(
      rows.filter((row) => row.status === PublishStatus.PUBLISHED).map((row) => row.slug),
    );
    const missing = required.filter((slug) => !live.has(slug));

    if (missing.length === 0) {
      return {
        key: 'policies',
        severity: 'ready',
        title: say('صفحات السياسات', 'Policy pages'),
        detail: say(
          'الاسترجاع والشروط والخصوصية منشورة.',
          'Refunds, terms and privacy are all published.',
        ),
        fix: null,
      };
    }

    return {
      key: 'policies',
      severity: 'warning',
      title: say('صفحات السياسات', 'Policy pages'),
      detail: say(
        `غير منشورة: ${missing.join('، ')}. مزوّد الدفع يقرأها قبل أن يعتمد المتجر.`,
        `Not published: ${missing.join(', ')}. A payment provider reads these before approving the store.`,
      ),
      fix: null,
    };
  }

  /**
   * Whether the vault answers, and whether its master key is the development one.
   *
   * `KEK_PROVIDER=local` is refused outright when NODE_ENV is production, so
   * this can never be news to a running store — which is exactly why it is
   * worth saying now, while there is still time to set up KMS.
   */
  private async keys(): Promise<LaunchCheck> {
    const { reachable } = await this.vault.selfTest();
    if (!reachable) {
      return {
        key: 'vault',
        severity: 'blocker',
        title: say('الخزنة لا تستجيب', 'The vault does not answer'),
        detail: say(
          'لا يمكن ختم مفتاح ولا فتحه، فلا تسليم. راجِع DATABASE_URL_VAULT.',
          'No key can be sealed or opened, so nothing can be delivered. Check DATABASE_URL_VAULT.',
        ),
        fix: '/vault',
      };
    }

    if ((process.env.KEK_PROVIDER ?? 'local') !== 'aws-kms') {
      return {
        key: 'vault',
        severity: 'warning',
        title: say('مفتاح الخزنة الرئيسي محلّي', 'The vault master key is local'),
        detail: say(
          'KEK_PROVIDER=local يضع المفتاح الذي يفكّ كل التراخيص في متغيّر بيئة على نفس الخادم. الإنتاج يرفضه ولن يُقلِع.',
          'KEK_PROVIDER=local puts the key that decrypts every licence in an environment variable on the same host. Production refuses it and will not boot.',
        ),
        fix: null,
      };
    }

    return {
      key: 'vault',
      severity: 'ready',
      title: say('الخزنة', 'Vault'),
      detail: say('تستجيب، والمفتاح على KMS.', 'It answers, and the key is on KMS.'),
      fix: '/vault',
    };
  }

  /**
   * Whether mail can actually leave, not how it is configured.
   *
   * The first version of this check printed the value of `MAIL_TRANSPORT` and
   * called that ready — which on the machine it was written on was false: the
   * transport said `smtp` and nothing was listening on the port. A store whose
   * product *is* an email and whose SMTP host refuses the connection is
   * configured perfectly and delivers nothing, and the symptom is an order
   * that looks fulfilled beside a customer who received nothing. So the check
   * opens the connection.
   *
   * A blocker either way, because there is no version of this store that works
   * without mail.
   */
  private async mail(): Promise<LaunchCheck> {
    const transport = this.mailer.transport;
    const { ok, detail } = await this.mailer.selfTest();

    return ok
      ? { key: 'mail', severity: 'ready', title: say('البريد', 'Email'), detail, fix: null }
      : {
          key: 'mail',
          severity: 'blocker',
          title: say('البريد لا يُرسَل', 'Email does not send'),
          // The transport is named beside the reason because the fix differs:
          // a dead SMTP host and a refused Resend key are not the same job.
          detail: say(
            `${detail} (MAIL_TRANSPORT=${transport}) — والمنتج نفسه يصل بالبريد.`,
            `${detail} (MAIL_TRANSPORT=${transport}) — and the product itself arrives by email.`,
          ),
          fix: null,
        };
  }

  /**
   * The cutover map.
   *
   * Never a blocker — the new store works perfectly without it. That is
   * precisely what makes it worth a line here: nothing breaks when it is
   * missing, and the old site's rankings simply evaporate.
   */
  /**
   * Whether the record of what was done to this store still holds together.
   *
   * `AuditLog` is hash-chained so that a row removed from the middle breaks
   * every hash after it. That detection was written, and then never called
   * from anywhere — which is why three rows from 11–12 September went missing
   * for a week without anyone being told. A tamper-evident log nobody reads is
   * a log, not a record.
   *
   * A warning, not a blocker: a store with a gap in its audit trail can still
   * take an order honestly, and refusing to open over a past event nobody can
   * now undo would be the wrong trade. It is on this screen because this is
   * the screen somebody actually looks at.
   */
  private async ledger(): Promise<LaunchCheck> {
    const chain = await this.audit.verifyChain();

    if (chain.ok) {
      return {
        key: 'ledger',
        severity: 'ready',
        title: say('سجلّ التدقيق', 'Audit trail'),
        detail: say(
          `${String(chain.rows)} سطراً، والسلسلة متّصلة بالكامل.`,
          `${String(chain.rows)} entries, and the chain is unbroken.`,
        ),
        fix: null,
      };
    }

    // Counted separately because they are different events, and the wording a
    // person needs differs with them: rows that are gone, against rows that
    // are merely out of order.
    const parts: string[] = [];
    if (chain.missing.length > 0) {
      parts.push(
        say(
          `${String(chain.missing.length)} سطراً يشير إلى سلف غير موجود — أي أن أسطراً كُتبت ثم حُذفت`,
          `${String(chain.missing.length)} entries point at a predecessor that is gone — rows were written and then removed`,
        ),
      );
    }
    if (chain.mismatched.length > 0) {
      parts.push(
        say(
          `${String(chain.mismatched.length)} سطراً ارتبط بالرأس نفسه ككاتب آخر`,
          `${String(chain.mismatched.length)} entries chained onto the same head as another writer`,
        ),
      );
    }

    return {
      key: 'ledger',
      severity: 'warning',
      title: say('سجلّ التدقيق', 'Audit trail'),
      detail: say(
        `${parts.join('، ')}. من أصل ${String(chain.rows)} سطراً.`,
        `${parts.join(', ')}. Out of ${String(chain.rows)} entries.`,
      ),
      fix: null,
    };
  }

  private async redirects(): Promise<LaunchCheck> {
    const [active, unresolved] = await Promise.all([
      this.prisma.client.redirect.count({ where: { isActive: true } }),
      this.prisma.client.notFoundLog.count({ where: { resolvedAt: null } }),
    ]);

    if (unresolved > 0) {
      return {
        key: 'redirects',
        severity: 'warning',
        title: say('التوجيهات', 'Redirects'),
        detail: say(
          `${String(active)} توجيهاً فعّالاً · ${String(unresolved)} مسار طُلب ولم يُوجد.`,
          `${String(active)} active redirects · ${String(unresolved)} paths asked for and not found.`,
        ),
        fix: '/redirects',
      };
    }

    return {
      key: 'redirects',
      severity: 'ready',
      title: say('التوجيهات', 'Redirects'),
      detail: say(
        `${String(active)} توجيهاً فعّالاً، ولا مسار بلا جواب.`,
        `${String(active)} active redirects, and no path without an answer.`,
      ),
      fix: '/redirects',
    };
  }
}
