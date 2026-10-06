'use client';

import { SEO_LENGTH_GUIDE, type EditableBlock, type GeneratedLocaleCopy } from '@da/contracts';
import type { ReactNode } from 'react';

import { useT } from '../../i18n/provider';

/**
 * One language of generated copy, shown before anything is saved: the SEO
 * fields with their length against the SERP guide, the keywords, and the body
 * blocks drawn plainly. Shared by the supplier AI tab and the product editor.
 */
export function CopyPreview({
  locale,
  copy,
  actions,
}: {
  locale: 'ar' | 'en';
  copy: GeneratedLocaleCopy;
  /** The buttons beside the language heading: save, apply, … */
  actions: ReactNode;
}) {
  const t = useT('supplier');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <section className="card ai-preview">
      <div className="supplier-sync">
        <h2>{t(`aiLocale_${locale}`)}</h2>
        <div className="supplier-actions">{actions}</div>
      </div>
      <dl className="ai-fields">
        <dt>
          {t('aiSeoTitle')} <Count value={copy.seoTitle} max={SEO_LENGTH_GUIDE.seoTitleMax} />
        </dt>
        <dd lang={locale} dir={dir}>
          {copy.seoTitle}
        </dd>
        <dt>
          {t('aiSeoDescription')}{' '}
          <Count value={copy.seoDescription} max={SEO_LENGTH_GUIDE.seoDescriptionMax} />
        </dt>
        <dd lang={locale} dir={dir}>
          {copy.seoDescription}
        </dd>
        <dt>{t('aiShortDesc')}</dt>
        <dd lang={locale} dir={dir}>
          {copy.shortDesc}
        </dd>
        <dt>{t('aiKeywordsOut')}</dt>
        <dd className="supplier-states" lang={locale} dir={dir}>
          {copy.keywords.map((keyword) => (
            <span key={keyword} className="pill pill-info">
              {keyword}
            </span>
          ))}
        </dd>
      </dl>
      <div className="ai-body" lang={locale} dir={dir}>
        {copy.blocks.map((block, index) => (
          <BlockPreview key={index} block={block} />
        ))}
      </div>
    </section>
  );
}

function Count({ value, max }: { value: string; max: number }) {
  return (
    <span className={`meta${value.length > max ? ' supplier-large' : ''}`} dir="ltr">
      ({value.length}/{max})
    </span>
  );
}

/** A plain rendering of each block. The storefront's own styles apply after saving. */
export function BlockPreview({ block }: { block: EditableBlock }) {
  switch (block.type) {
    case 'answerFirst':
      return <p className="ai-answer">{block.text}</p>;
    case 'heading':
      return block.level === 2 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
    case 'richText':
      // Shown as text, not injected: the server sanitises on save, and the
      // preview has no need to trust the model's markup.
      return (
        <p className="ai-rich">
          {block.html.replace(/<\/(p|li|h3)>/g, '\n').replace(/<[^>]+>/g, '')}
        </p>
      );
    case 'steps':
      return (
        <ol>
          {block.steps.map((step, index) => (
            <li key={index}>{step.text}</li>
          ))}
        </ol>
      );
    case 'specTable':
      return (
        <table className="admin-table">
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                <th>{row.label}</th>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'faq':
      return (
        <dl className="ai-faq">
          {block.items.map((item, index) => (
            <div key={index}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      );
  }
}
