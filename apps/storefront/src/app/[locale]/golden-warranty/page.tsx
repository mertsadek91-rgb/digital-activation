import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { Block } from '@da/contracts';
import { ROUTES } from '@da/contracts';
import { alternates, buildGraph, canonical, jsonld } from '@da/seo';

import { Blocks } from '../../../components/blocks';
import { MotionFadeIn } from '../../../components/motion-wrapper';
import { isArabic } from '../../../i18n/locale';
import { getPage } from '../../../lib/api';
import { notFoundMetadata, pageTitle, robotsMeta } from '../../../lib/seo';

/**
 * /golden-warranty — the warranty the shop actually offers.
 *
 * Its own route rather than the editorial catch-all, because this page earns a
 * frame: it is the page a hesitant buyer opens before typing a card number, and
 * it is linked from the header, the footer and every product that carries the
 * warranty.
 *
 * Every word of the policy comes from the `Page` row, not from this file. That
 * is not a style preference — the first version of this route fetched the row
 * into a variable and then rendered a warranty of its own invention beside it.
 * The two did not agree. The stored policy, which the owner can edit, says a
 * key that does not work is replaced free within seven days of purchase and
 * that cover then runs for the product's term; the hardcoded version promised
 * lifetime cover with a one-year minimum, free remote support over AnyDesk, and
 * named a single exclusion. None of that was ever written by the shop, and all
 * of it was being fed to Google as FAQ structured data.
 *
 * So: the frame is code and the promises are data. A warranty is a commitment,
 * and a commitment belongs where the person who has to honour it can change it.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://digital-activation.com';
const WHATSAPP_DIAL = '966534255367';

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const page = await getPage('golden-warranty', { locale });
  if (!page) return notFoundMetadata(locale);

  const links = alternates(SITE_URL, ROUTES.goldenWarranty);

  return {
    title: pageTitle(page.seo.title ?? page.title),
    description: page.seo.description ?? summaryOf(page.blocks),
    robots: robotsMeta(process.env.NEXT_PUBLIC_SITE_URL),
    alternates: {
      canonical: canonical(SITE_URL, ROUTES.goldenWarranty, isArabic(locale) ? 'ar' : 'en'),
      languages: Object.fromEntries(links.map((link) => [link.hrefLang, link.href])),
    },
  };
}

/**
 * The answer-first block, which is the policy in one paragraph.
 *
 * Narrowed on the union rather than read off a loose shape: `trust` blocks also
 * carry `items`, and a structural type wide enough to reach `faq.items` reaches
 * theirs too — which typechecks and then hands the FAQ builder a list of
 * strings.
 */
function summaryOf(blocks: Block[]): string | null {
  for (const block of blocks) {
    if (block.type === 'answerFirst') return block.text;
  }
  return null;
}

/** The page's own questions, so the markup cannot answer one the page does not. */
function faqOf(blocks: Block[]): { q: string; a: string }[] | null {
  for (const block of blocks) {
    if (block.type === 'faq') return block.items;
  }
  return null;
}

export default async function GoldenWarrantyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('warranty');
  const tc = await getTranslations('common');
  const prefix = isArabic(locale) ? '' : `/${locale}`;

  const page = await getPage('golden-warranty', { locale });
  // No invented fallback. If the policy has not been written, this page has
  // nothing to say, and saying it anyway is how the last version went wrong.
  if (!page) notFound();

  const pageUrl = new URL(`${prefix}${ROUTES.goldenWarranty}`, SITE_URL).toString();
  const lede = summaryOf(page.blocks);
  const faq = faqOf(page.blocks);

  const graph = buildGraph([
    jsonld.breadcrumbs([
      { name: tc('home'), url: new URL(`${prefix}/`, SITE_URL).toString() },
      { name: page.title, url: pageUrl },
    ]),
    // Only the questions the page actually renders, and only when it has any.
    faq ? jsonld.faqPage(faq) : null,
  ]);

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />

      <section className="warranty-hero" aria-labelledby="hero-heading">
        <MotionFadeIn>
          <div className="warranty-hero-inner">
            <span className="warranty-emblem-badge" aria-hidden="true">
              <span>🛡️</span>
              {/* The name of the thing, not a certification. "معتمد 100%" read
                  as an accreditation the shop does not hold and nobody issues. */}
              <span>{page.title}</span>
            </span>

            <h1 id="hero-heading">{page.title}</h1>

            {/* The policy's own opening paragraph. It is written to be quoted —
                it is the block the answer engines lift — so it is also the only
                summary this page gives. */}
            {lede ? <p className="warranty-hero-lede">{lede}</p> : null}
          </div>
        </MotionFadeIn>
      </section>

      {/* The policy itself: the two kinds of cover, how to claim it, what it
          covers, the questions and the closing call. All of it rows the owner
          edits in the panel. */}
      <section className="warranty-section">
        <MotionFadeIn>
          <div className="shell prose warranty-body">
            <Blocks blocks={page.blocks.filter((block) => block.type !== 'answerFirst')} />
          </div>
        </MotionFadeIn>
      </section>

      <section className="warranty-section warranty-contact">
        <div className="shell">
          <h2>{t('questionTitle')}</h2>
          <p>{t('questionBody')}</p>
          <div className="warranty-contact-actions">
            <a
              className="btn btn-accent"
              href={`https://wa.me/${WHATSAPP_DIAL}`}
              rel="noopener noreferrer"
            >
              {t('whatsapp')}
            </a>
            <Link className="btn btn-ghost" href={`${prefix}${ROUTES.contact}`}>
              {t('contactForm')}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
