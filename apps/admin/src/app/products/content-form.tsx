'use client';

import type { ContentBlock, ProductContent, ProductWarning } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { api } from '../../lib/api';
import { BlockDocumentEditor } from './block-editor';

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

export function ContentForm({
  slug,
  /**
   * The page's content language, not the form's own.
   *
   * One switch on the editor page moves the SEO copy, this description, the
   * activation steps and the publish checks together — a menu here as well
   * would be a second place to be reading English under Arabic blockers.
   */
  locale,
  canWrite,
  onSaved,
  onError,
}: {
  slug: string;
  locale: 'ar' | 'en';
  canWrite: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const t = useT('products');
  const c = useT('common');
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
        <p className={`word-count${words < server.bodyMinWords ? ' is-short' : ''}`}>
          {t('wordCount', { count: words, min: server.bodyMinWords })}
        </p>
      </div>

      <BlockDocumentEditor blocks={blocks} canWrite={canWrite} onChange={setBlocks} />

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
