import { Injectable } from '@nestjs/common';

import type { LaunchCheck, LaunchReadiness } from '@da/contracts';
import { PublishStatus } from '@da/db';

import { PaymentSettingsService } from '../checkout/payment-settings.service.js';
import { MailService } from '../mail/mail.service.js';
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
    private readonly payments: PaymentSettingsService,
    private readonly vault: VaultService,
    private readonly mailer: MailService,
  ) {}

  async readiness(): Promise<LaunchReadiness> {
    const checks = [
      await this.payment(),
      await this.catalog(),
      await this.policies(),
      await this.keys(),
      await this.mail(),
      await this.redirects(),
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
        title: 'طرق الدفع',
        detail: `${String(offered.length)} طريقة معروضة: ${offered.map((m) => m.provider).join('، ')}.`,
        fix: '/payments',
      };
    }

    return {
      key: 'payment',
      severity: 'blocker',
      title: 'لا توجد طريقة دفع',
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
        title: 'لا منتج منشور',
        detail: `${String(total)} منتجاً في الكتالوج، ولا واحد منشور. لا شيء يمكن شراؤه.`,
        fix: '/products',
      };
    }

    if (published < 5) {
      return {
        key: 'catalog',
        severity: 'warning',
        title: 'الكتالوج رقيق',
        detail: `${String(published)} من ${String(total)} منشور. الباقي محجوب ببوّابة النشر — العنوان والوصف وSEO.`,
        fix: '/products',
      };
    }

    return {
      key: 'catalog',
      severity: 'ready',
      title: 'الكتالوج',
      detail: `${String(published)} من ${String(total)} منشور.`,
      fix: '/products',
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
        title: 'صفحات السياسات',
        detail: 'الاسترجاع والشروط والخصوصية منشورة.',
        fix: null,
      };
    }

    return {
      key: 'policies',
      severity: 'warning',
      title: 'صفحات السياسات',
      detail: `غير منشورة: ${missing.join('، ')}. مزوّد الدفع يقرأها قبل أن يعتمد المتجر.`,
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
        title: 'الخزنة لا تستجيب',
        detail: 'لا يمكن ختم مفتاح ولا فتحه، فلا تسليم. راجِع DATABASE_URL_VAULT.',
        fix: '/vault',
      };
    }

    if ((process.env.KEK_PROVIDER ?? 'local') !== 'aws-kms') {
      return {
        key: 'vault',
        severity: 'warning',
        title: 'مفتاح الخزنة الرئيسي محلّي',
        detail:
          'KEK_PROVIDER=local يضع المفتاح الذي يفكّ كل التراخيص في متغيّر بيئة على نفس الخادم. الإنتاج يرفضه ولن يُقلِع.',
        fix: null,
      };
    }

    return {
      key: 'vault',
      severity: 'ready',
      title: 'الخزنة',
      detail: 'تستجيب، والمفتاح على KMS.',
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
      ? { key: 'mail', severity: 'ready', title: 'البريد', detail, fix: null }
      : {
          key: 'mail',
          severity: 'blocker',
          title: 'البريد لا يُرسَل',
          // The transport is named beside the reason because the fix differs:
          // a dead SMTP host and a refused Resend key are not the same job.
          detail: `${detail} (MAIL_TRANSPORT=${transport}) — والمنتج نفسه يصل بالبريد.`,
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
  private async redirects(): Promise<LaunchCheck> {
    const [active, unresolved] = await Promise.all([
      this.prisma.client.redirect.count({ where: { isActive: true } }),
      this.prisma.client.notFoundLog.count({ where: { resolvedAt: null } }),
    ]);

    if (unresolved > 0) {
      return {
        key: 'redirects',
        severity: 'warning',
        title: 'التوجيهات',
        detail: `${String(active)} توجيهاً فعّالاً · ${String(unresolved)} مسار طُلب ولم يُوجد.`,
        fix: '/redirects',
      };
    }

    return {
      key: 'redirects',
      severity: 'ready',
      title: 'التوجيهات',
      detail: `${String(active)} توجيهاً فعّالاً، ولا مسار بلا جواب.`,
      fix: '/redirects',
    };
  }
}
