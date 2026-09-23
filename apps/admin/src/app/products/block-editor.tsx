'use client';

import type { ContentBlock } from '@da/contracts';

import { useT } from '../../i18n/provider';

/**
 * A block document, edited in place.
 *
 * Lifted out of the product description form so the page, blog and brand
 * editors use this one rather than a second editor that drifts from it: the
 * same six block types, the same row lists, and the same rule that a block it
 * cannot draw is listed and left alone rather than dropped.
 *
 * Controlled — the caller owns the document, the save and the dirty check,
 * because each of those screens saves more than the body in one request.
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

export function BlockDocumentEditor({
  blocks,
  canWrite,
  onChange,
}: {
  blocks: ContentBlock[];
  canWrite: boolean;
  onChange: (next: ContentBlock[]) => void;
}) {
  const t = useT('products');
  const c = useT('common');

  const patch = (index: number, next: ContentBlock): void =>
    onChange(blocks.map((block, at) => (at === index ? next : block)));

  const move = (index: number, by: -1 | 1): void => {
    const next = [...blocks];
    const target = index + by;
    const moved = next[index];
    const displaced = next[target];
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    onChange(next);
  };

  return (
    <>
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
                    onClick={() => onChange(blocks.filter((_, at) => at !== index))}
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
              onClick={() => onChange([...blocks, blankBlock(type)])}
            >
              {t(`block_${type}`)}
            </button>
          ))}
        </div>
      ) : null}
    </>
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
          onRows={(rows) =>
            onChange({ ...block, steps: rows.map(([text]) => ({ text: text ?? '' })) })
          }
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

  const emit = (next: string[][]): void => onRows(next.map((row) => [row[0] ?? '', row[1] ?? '']));

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
