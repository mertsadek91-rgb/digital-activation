'use client';

import {
  AI_PROTOCOLS,
  SEO_LENGTH_GUIDE,
  type AiProtocol,
  type EditableBlock,
  type GenerateCopy,
  type GeneratedCopy,
  type GeneratedLocaleCopy,
  type SupplierAiModels,
  type SupplierAiStatus,
} from '@da/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { supplierAiApi, supplierApi } from '../../lib/supplier-api';

import { CardDesigner } from './card-designer';

type Locale = 'ar' | 'en';

/**
 * AI product copy through the owner's OpenCode account.
 *
 * The top half chooses the model from the account's own list. The bottom
 * half generates copy for one product, shows it, and saves it — per language
 * — through the same copy and content endpoints the product editor uses, so
 * nothing the model writes reaches the store without a person pressing save
 * and the publish gate still applies.
 */
export function AiTab({ isAdmin, initialSlug }: { isAdmin: boolean; initialSlug: string | null }) {
  const t = useT('supplier');
  const c = useT('common');
  const [status, setStatus] = useState<SupplierAiStatus | null>(null);
  const [models, setModels] = useState<SupplierAiModels['models'] | null>(null);
  const [model, setModel] = useState('');
  const [protocol, setProtocol] = useState<AiProtocol>('auto');
  const [temperature, setTemperature] = useState('0.5');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [products, setProducts] = useState<{ slug: string; name: string }[]>([]);
  const [slug, setSlug] = useState(initialSlug ?? '');
  // The product the card designer shows. Set once the field names a real
  // product (or copy is generated), not on every keystroke: each change
  // reloads the card's defaults from the API.
  const [cardSlug, setCardSlug] = useState<string | null>(initialSlug);
  const [keywords, setKeywords] = useState('');
  const [locales, setLocales] = useState<Locale[]>(['ar', 'en']);
  const [copy, setCopy] = useState<GeneratedCopy | null>(null);
  // Seconds the current generation has been running, shown on its button.
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await supplierAiApi.status();
      setStatus(next);
      setModel(next.model ?? '');
      setProtocol(next.protocol);
      setTemperature(String(next.temperature));
      setInstructions(next.instructions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
    supplierApi
      .mapping('all')
      .then((mapping) => {
        const seen = new Map<string, string>();
        for (const row of mapping.rows)
          if (!seen.has(row.productSlug)) seen.set(row.productSlug, row.productName);
        setProducts([...seen].map(([value, name]) => ({ slug: value, name })));
      })
      .catch(() => setProducts([]));
  }, [load]);

  /**
   * Starts a background job and polls it every few seconds (BUG-0026): the
   * generation outlives the 100 s Cloudflare keeps a request open. Gives up
   * after 12 minutes, which is past anything a model takes; the server marks
   * a job that long dead anyway.
   */
  async function generate(input: GenerateCopy): Promise<GeneratedCopy> {
    const job = await supplierAiApi.copy(input);
    const started = Date.now();
    setElapsed(0);
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (!mounted.current) throw new Error(t('aiCancelled'));
      setElapsed(Math.round((Date.now() - started) / 1000));
      const current = await supplierAiApi.copyJob(job.id);
      if (current.status === 'DONE' && current.result) return current.result;
      if (current.status === 'FAILED') throw new Error(current.error ?? t('loadFailed'));
      if (Date.now() - started > 12 * 60 * 1000) throw new Error(t('aiTimedOut'));
    }
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (products.some((product) => product.slug === slug)) setCardSlug(slug);
  }, [slug, products]);

  const families = useMemo(() => {
    const groups = new Map<string, SupplierAiModels['models']>();
    for (const entry of models ?? [])
      groups.set(entry.family, [...(groups.get(entry.family) ?? []), entry]);
    return [...groups];
  }, [models]);

  if (!status)
    return error ? (
      <p className="error" role="alert" dir="auto">
        {error}
      </p>
    ) : (
      <p className="meta">{c('loading')}</p>
    );

  return (
    <div className="supplier-settings">
      <section className="card">
        <h2>{t('aiHeading')}</h2>
        {!status.configured ? <p className="notice">{t('aiMissingKey')}</p> : null}
        <p className="lede-sm">{t('aiLede')}</p>

        <div className="supplier-form">
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('aiModel')}</span>
              {models ? (
                <select
                  value={model}
                  disabled={!isAdmin}
                  onChange={(event) => setModel(event.target.value)}
                >
                  <option value="">{t('aiPickModel')}</option>
                  {families.map(([family, entries]) => (
                    <optgroup key={family} label={family}>
                      {entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.id}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <input value={model || t('aiNoModel')} readOnly dir="ltr" />
              )}
            </label>
            <label className="field">
              <span>{t('aiProtocol')}</span>
              <select
                value={protocol}
                disabled={!isAdmin}
                onChange={(event) => setProtocol(event.target.value as AiProtocol)}
              >
                {AI_PROTOCOLS.map((value) => (
                  <option key={value} value={value}>
                    {t(`aiProtocol_${value}`)}
                  </option>
                ))}
              </select>
              {status.resolvedProtocol && protocol === 'auto' ? (
                <small className="meta">
                  {t('aiResolved', { protocol: status.resolvedProtocol })}
                </small>
              ) : null}
            </label>
            <label className="field">
              <span>{t('aiTemperature')}</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.1"
                dir="ltr"
                value={temperature}
                disabled={!isAdmin}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>{t('aiInstructions')}</span>
            <textarea
              rows={3}
              value={instructions}
              disabled={!isAdmin}
              placeholder={t('aiInstructionsHint')}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <div className="supplier-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy !== null || !status.configured}
              onClick={() =>
                void run('models', async () => {
                  const result = await supplierAiApi.models();
                  setModels(result.models);
                  setNote(t('aiModelsLoaded', { count: result.models.length }));
                })
              }
            >
              {busy === 'models' ? t('syncing') : t('aiLoadModels')}
            </button>
            {isAdmin ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run('save', async () => {
                    setStatus(
                      await supplierAiApi.setSettings({
                        model: model || null,
                        protocol,
                        temperature: Number(temperature),
                        instructions,
                      }),
                    );
                    setNote(t('saved'));
                  })
                }
              >
                {t('saveSettings')}
              </button>
            ) : null}
            <button
              type="button"
              className="ghost"
              disabled={busy !== null || !status.configured || !status.model}
              onClick={() =>
                void run('test', async () => {
                  const result = await supplierAiApi.test();
                  setNote(
                    t('aiTestOk', { model: result.model, ms: result.ms, reply: result.reply }),
                  );
                })
              }
            >
              {busy === 'test' ? t('syncing') : t('aiTest')}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t('aiCopyHeading')}</h2>
        <p className="lede-sm">{t('aiCopyLede')}</p>
        <div className="supplier-form">
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('aiProduct')}</span>
              <input
                list="supplier-ai-products"
                dir="ltr"
                value={slug}
                placeholder="windows-11-pro"
                onChange={(event) => setSlug(event.target.value.trim())}
              />
              <datalist id="supplier-ai-products">
                {products.map((product) => (
                  <option key={product.slug} value={product.slug}>
                    {product.name}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>{t('aiKeywords')}</span>
              <input
                value={keywords}
                placeholder={t('aiKeywordsHint')}
                onChange={(event) => setKeywords(event.target.value)}
              />
            </label>
          </div>
          <div className="supplier-actions">
            {(['ar', 'en'] as const).map((locale) => (
              <label key={locale} className="check supplier-check">
                <input
                  type="checkbox"
                  checked={locales.includes(locale)}
                  onChange={(event) =>
                    setLocales((current) =>
                      event.target.checked
                        ? [...new Set([...current, locale])]
                        : current.filter((l) => l !== locale),
                    )
                  }
                />
                <span>{t(`aiLocale_${locale}`)}</span>
              </label>
            ))}
            <button
              type="button"
              disabled={
                busy !== null ||
                !slug ||
                locales.length === 0 ||
                !status.configured ||
                !status.model
              }
              onClick={() =>
                void run('copy', async () => {
                  setCopy(null);
                  setCardSlug(slug);
                  setCopy(await generate({ productSlug: slug, locales, focusKeywords: keywords }));
                })
              }
            >
              {busy === 'copy' ? t('aiGeneratingFor', { seconds: elapsed }) : t('aiGenerate')}
            </button>
            {slug ? (
              <Link className="as-button ghost" href={`/products/${encodeURIComponent(slug)}`}>
                {t('aiOpenProduct')}
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="ok-note" role="status">
          {note}
        </p>
      ) : null}

      {cardSlug ? (
        <CardDesigner slug={cardSlug} aiReady={status.configured && Boolean(status.model)} />
      ) : null}

      {copy ? (
        <>
          {copy.notes.length > 0 ? (
            <ul className="notice supplier-skips">
              {copy.notes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {(['ar', 'en'] as const).map((locale) =>
            copy[locale] ? (
              <CopyPreview
                key={locale}
                locale={locale}
                copy={copy[locale]}
                busy={busy !== null}
                onSave={() =>
                  void run(`save-${locale}`, async () => {
                    const draft = copy[locale];
                    if (!draft) return;
                    await api.setProductContent(slug, { locale, blocks: draft.blocks });
                    await api.setProductCopy(slug, {
                      locale,
                      seoTitle: draft.seoTitle,
                      seoDescription: draft.seoDescription,
                      shortDesc: draft.shortDesc,
                    });
                    setNote(t('aiSaved', { locale: t(`aiLocale_${locale}`) }));
                  })
                }
              />
            ) : null,
          )}
        </>
      ) : null}
    </div>
  );
}

function CopyPreview({
  locale,
  copy,
  busy,
  onSave,
}: {
  locale: Locale;
  copy: GeneratedLocaleCopy;
  busy: boolean;
  onSave: () => void;
}) {
  const t = useT('supplier');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <section className="card ai-preview">
      <div className="supplier-sync">
        <h2>{t(`aiLocale_${locale}`)}</h2>
        <button type="button" disabled={busy} onClick={onSave}>
          {t('aiSave')}
        </button>
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
function BlockPreview({ block }: { block: EditableBlock }) {
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
