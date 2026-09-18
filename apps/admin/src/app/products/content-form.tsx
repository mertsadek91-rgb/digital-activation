'use client';

import type { ContentBlock, ProductContent, ProductWarning } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';

/**
 * The description, the FAQ, the warnings and the download link.
 *
 * The old copy box could edit a body only while it was one `richText` block,
 * and refused anything richer rather than flatten it. That refusal was right
 * and then it became total: once real descriptions were written, 77 of the 146
 * translations held a heading, an opening answer, a table, the steps and an
 * FAQ — so the editor worked on exactly the products with nothing in them.
 *
 * This edits the blocks. A block type it does not draw is listed and left
 * alone rather than dropped, because a save that discards what the form cannot
 * render is a silent deletion of somebody's work.
 */

/**
 * The label for a block type.
 *
 * `t` types its keys against the catalogue, and a key built at runtime is not
 * one of them — which is the right strictness everywhere else in this panel.
 * An unknown block carried through from elsewhere shows its raw type, which is
 * the only honest thing to call something this app has no word for.
 */
function blockLabel(t: (key: never) => string, type: string): string {
  const known = ['heading', 'richText', 'answerFirst', 'specTable', 'steps', 'faq'];
  return known.includes(type) ? t(`block_${type}` as never) : type;
}

/** What the "add" menu offers, in the order a page is usually built. */
const ADDABLE = ['heading', 'richText', 'answerFirst', 'specTable', 'steps', 'faq'] as const;

function blankBlock(type: (typeof ADDABLE)[number]): ContentBlock {
  switch (type) {
    case 'heading':
      return { type: 'heading', level: 2, text: '' };
    case 'richText':
      return { type: 'richText', html: '' };
    case 'answerFirst':
      return { type: 'answerFirst', text: '' };
    case 'specTable':
      return { type: 'specTable', rows: [{ label: '', value: '' }] };
    case 'steps':
      return { type: 'steps', steps: [{ text: '' }] };
    case 'faq':
      return { type: 'faq', items: [{ q: '', a: '' }] };
  }
}

export function ContentForm({
  slug,
  canWrite,
  onSaved,
  onError,
}: {
  slug: string;
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [server, setServer] = useState<ProductContent | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [warnings, setWarnings] = useState<ProductWarning[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const loaded = await api.productContent(slug, locale);
      setServer(loaded);
      setBlocks(loaded.blocks);
      setWarnings(loaded.warnings);
      setDownloadUrl(loaded.downloadUrl);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    }
  }, [slug, locale, onError, c]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!server) return <p className="meta">{c('loading')}</p>;

  const dirty =
    JSON.stringify(blocks) !== JSON.stringify(server.blocks) ||
    JSON.stringify(warnings) !== JSON.stringify(server.warnings) ||
    downloadUrl !== server.downloadUrl;

  /*
   * The live word count, measured the way the gate measures it.
   *
   * Only `richText`, `answerFirst` and an FAQ's questions and answers count —
   * not a heading, not a table row, not a step. That is not this editor's
   * opinion; it is what `bodyText` in the API does, and a counter that was
   * kinder than the check produced seventy-seven bodies that measured fine
   * here and were refused at publish.
   */
  const words = blocks.reduce((total: number, block: ContentBlock) => {
    const count = (text: string): number =>
      text.split(/\s+/).filter((word) => word.length > 1).length;
    // An opaque block carries its own shape and is not measured: the gate does
    // not count what it cannot flatten either.
    if ('raw' in block) return total;
    if (block.type === 'richText') return total + count(block.html.replace(/<[^>]+>/g, ' '));
    if (block.type === 'answerFirst') return total + count(block.text);
    if (block.type === 'faq')
      return total + block.items.reduce((sum, item) => sum + count(item.q) + count(item.a), 0);
    return total;
  }, 0);

  const patch = (index: number, next: ContentBlock): void =>
    setBlocks((current) => current.map((block, at) => (at === index ? next : block)));

  const move = (index: number, by: -1 | 1): void =>
    setBlocks((current) => {
      const next = [...current];
      const target = index + by;
      const moved = next[index];
      const displaced = next[target];
      if (!moved || !displaced) return current;
      next[index] = displaced;
      next[target] = moved;
      return next;
    });

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const saved = await api.setProductContent(slug, {
        locale,
        blocks,
        warnings,
        downloadUrl,
      });
      setServer(saved);
      setBlocks(saved.blocks);
      setWarnings(saved.warnings);
      setDownloadUrl(saved.downloadUrl);
      onSaved();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : c('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="content-form">
      <div className="content-head">
        <div>
          <h3>{t('contentHeading')}</h3>
          <p className="lede-sm">{t('contentLede')}</p>
        </div>
        <label className="content-locale">
          <span>{t('readinessLocaleLabel')}</span>
          <select
            id={`content-locale-${slug}`}
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'ar' | 'en')}
          >
            <option value="ar">{t('localeArabic')}</option>
            <option value="en">{t('localeEnglish')}</option>
          </select>
        </label>
        <p className={`word-count${words < server.bodyMinWords ? ' is-short' : ''}`}>
          {t('wordCount', { count: words, min: server.bodyMinWords })}
        </p>
      </div>

      <ol className="block-list">
        {blocks.map((block, index) => (
          <li key={`${block.type}-${String(index)}`} className="block-item">
            <header>
              <strong>{blockLabel(t, block.type)}</strong>
              {canWrite ? (
                <span className="block-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    {t('imageMoveUp')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === blocks.length - 1}
                  >
                    {t('imageMoveDown')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setBlocks(blocks.filter((_, at) => at !== index))}
                  >
                    {c('delete')}
                  </button>
                </span>
              ) : null}
            </header>
            <BlockEditor
              block={block}
              canWrite={canWrite}
              onChange={(next) => patch(index, next)}
            />
          </li>
        ))}
      </ol>

      {canWrite ? (
        <div className="block-add">
          <span className="meta">{t('addBlock')}</span>
          {ADDABLE.map((type) => (
            <button
              key={type}
              type="button"
              className="ghost"
              onClick={() => setBlocks([...blocks, blankBlock(type)])}
            >
              {t(`block_${type}`)}
            </button>
          ))}
        </div>
      ) : null}

      <Warnings
        warnings={warnings}
        canWrite={canWrite}
        onChange={setWarnings}
      />

      <label className="download-field">
        <span>{t('downloadUrl')}</span>
        <input
          id={`download-${slug}`}
          type="url"
          dir="ltr"
          value={downloadUrl}
          placeholder="https://"
          disabled={!canWrite}
          onChange={(event) => setDownloadUrl(event.target.value)}
        />
        <small>{t('downloadUrlHint')}</small>
      </label>

      {canWrite ? (
        <div className="terms-save">
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? c('loading') : c('save')}
          </button>
          {dirty ? (
            <>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setBlocks(server.blocks);
                  setWarnings(server.warnings);
                  setDownloadUrl(server.downloadUrl);
                }}
              >
                {c('cancel')}
              </button>
              <span className="meta-warn">{t('termsUnsaved')}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BlockEditor({
  block,
  canWrite,
  onChange,
}: {
  block: ContentBlock;
  canWrite: boolean;
  onChange: (next: ContentBlock) => void;
}) {
  const t = useT('products');

  if ('raw' in block) {
    // Known to exist, not known how to draw. Said plainly rather than hidden,
    // so nobody wonders why the page has something the editor does not.
    return <p className="notice">{t('blockUnknown', { type: block.type })}</p>;
  }

  switch (block.type) {
    case 'heading':
      return (
        <div className="block-fields">
          <label>
            <span>{t('blockHeadingLevel')}</span>
            <select
              value={block.level}
              disabled={!canWrite}
              onChange={(event) =>
                onChange({ ...block, level: Number(event.target.value) === 3 ? 3 : 2 })
              }
            >
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </label>
          <label className="grow">
            <span>{t('blockText')}</span>
            <input
              type="text"
              value={block.text}
              disabled={!canWrite}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </label>
        </div>
      );

    case 'richText':
      return (
        <textarea
          rows={8}
          value={block.html}
          disabled={!canWrite}
          onChange={(event) => onChange({ ...block, html: event.target.value })}
        />
      );

    case 'answerFirst':
      return (
        <>
          <textarea
            rows={3}
            value={block.text}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
          <small>{t('blockAnswerFirstHint')}</small>
        </>
      );

    case 'specTable':
      return (
        <RowList
          title={block.title ?? ''}
          canWrite={canWrite}
          onTitle={(title) => onChange({ ...block, title })}
          rows={block.rows.map((row) => [row.label, row.value])}
          labels={[t('blockSpecLabel'), t('blockSpecValue')]}
          onRows={(rows) =>
            onChange({ ...block, rows: rows.map(([label, value]) => ({ label, value })) })
          }
        />
      );

    case 'steps':
      return (
        <RowList
          title={block.title ?? ''}
          canWrite={canWrite}
          onTitle={(title) => onChange({ ...block, title })}
          rows={block.steps.map((step) => [step.text])}
          labels={[t('blockStepText')]}
          onRows={(rows) => onChange({ ...block, steps: rows.map(([text]) => ({ text: text ?? '' })) })}
        />
      );

    case 'faq':
      return (
        <RowList
          title={block.title ?? ''}
          canWrite={canWrite}
          onTitle={(title) => onChange({ ...block, title })}
          rows={block.items.map((item) => [item.q, item.a])}
          labels={[t('blockFaqQuestion'), t('blockFaqAnswer')]}
          multiline={[false, true]}
          onRows={(rows) => onChange({ ...block, items: rows.map(([q, a]) => ({ q, a })) })}
        />
      );
  }
}

/**
 * A repeated row of one or two fields, with add and remove.
 *
 * One component for the table, the steps and the FAQ because they are the same
 * interaction three times over — and three near-identical components is where
 * a fix lands in two of them.
 */
function RowList({
  title,
  rows,
  labels,
  multiline,
  canWrite,
  onTitle,
  onRows,
}: {
  title: string;
  rows: string[][];
  labels: string[];
  multiline?: boolean[];
  canWrite: boolean;
  onTitle: (title: string) => void;
  onRows: (rows: [string, string][]) => void;
}) {
  const t = useT('products');
  const c = useT('common');
  const width = labels.length;

  const emit = (next: string[][]): void =>
    onRows(next.map((row) => [row[0] ?? '', row[1] ?? '']));

  return (
    <div className="row-list">
      <label>
        <span>{t('blockTitle')}</span>
        <input
          type="text"
          value={title}
          disabled={!canWrite}
          onChange={(event) => onTitle(event.target.value)}
        />
      </label>

      {rows.map((row, index) => (
        <div key={index} className="row-list-row">
          {labels.map((label, column) => (
            <label key={label} className={column === width - 1 ? 'grow' : undefined}>
              <span>{label}</span>
              {multiline?.[column] ? (
                <textarea
                  rows={2}
                  value={row[column] ?? ''}
                  disabled={!canWrite}
                  onChange={(event) =>
                    emit(
                      rows.map((existing, at) =>
                        at === index
                          ? existing.map((cell, c2) => (c2 === column ? event.target.value : cell))
                          : existing,
                      ),
                    )
                  }
                />
              ) : (
                <input
                  type="text"
                  value={row[column] ?? ''}
                  disabled={!canWrite}
                  onChange={(event) =>
                    emit(
                      rows.map((existing, at) =>
                        at === index
                          ? existing.map((cell, c2) => (c2 === column ? event.target.value : cell))
                          : existing,
                      ),
                    )
                  }
                />
              )}
            </label>
          ))}
          {canWrite ? (
            <button
              type="button"
              className="ghost"
              onClick={() => emit(rows.filter((_, at) => at !== index))}
              disabled={rows.length === 1}
            >
              {c('delete')}
            </button>
          ) : null}
        </div>
      ))}

      {canWrite ? (
        <button
          type="button"
          className="ghost"
          onClick={() => emit([...rows, Array.from({ length: width }, () => '')])}
        >
          {t('addRow')}
        </button>
      ) : null}
    </div>
  );
}

function Warnings({
  warnings,
  canWrite,
  onChange,
}: {
  warnings: ProductWarning[];
  canWrite: boolean;
  onChange: (next: ProductWarning[]) => void;
}) {
  const t = useT('products');
  const c = useT('common');

  return (
    <fieldset className="warnings-field">
      <legend>{t('warningsHeading')}</legend>
      <p className="lede-sm">{t('warningsLede')}</p>

      {warnings.map((warning, index) => (
        <div key={index} className="row-list-row">
          <label>
            <span>{t('warningSeverity')}</span>
            <select
              value={warning.severity}
              disabled={!canWrite}
              onChange={(event) =>
                onChange(
                  warnings.map((existing, at) =>
                    at === index
                      ? { ...existing, severity: event.target.value === 'critical' ? 'critical' : 'note' }
                      : existing,
                  ),
                )
              }
            >
              <option value="note">{t('warningNote')}</option>
              <option value="critical">{t('warningCritical')}</option>
            </select>
          </label>
          <label className="grow">
            <span>{t('warningText')}</span>
            <input
              type="text"
              value={warning.text}
              disabled={!canWrite}
              onChange={(event) =>
                onChange(
                  warnings.map((existing, at) =>
                    at === index ? { ...existing, text: event.target.value } : existing,
                  ),
                )
              }
            />
          </label>
          {canWrite ? (
            <button
              type="button"
              className="ghost"
              onClick={() => onChange(warnings.filter((_, at) => at !== index))}
            >
              {c('delete')}
            </button>
          ) : null}
        </div>
      ))}

      {canWrite ? (
        <button
          type="button"
          className="ghost"
          onClick={() => onChange([...warnings, { text: '', severity: 'note' }])}
        >
          {t('addWarning')}
        </button>
      ) : null}
    </fieldset>
  );
}
