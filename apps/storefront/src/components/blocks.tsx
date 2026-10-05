import type { Block } from '@da/contracts';

import { ArrowIcon, PlusIcon } from './icons';

/**
 * Renders the block document a product or collection body is stored as.
 *
 * `richText` currently carries the legacy WooCommerce HTML verbatim, which is
 * why it is rendered rather than converted: turning two years of Elementor
 * markup into structured blocks is an editorial pass, and guessing at it during
 * an import would lose content silently.
 *
 * `specTable` exists as its own block for a specific reason — tables are what
 * answer engines quote, and the legacy store buried its best product copy
 * inside a single PNG where nothing could read it.
 *
 * Drawn after the kit (TASK-0108): steps as numbered rows, the FAQ as the
 * kit's accordion (`faqrow`, the same rows as the home page), tables with the
 * mint header, and a CTA as the kit's mint promo card.
 */
export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </>
  );
}

function normalizeRichHtml(html: string): string {
  if (!html) return '';
  // Prevent legacy inline width="100%" on icons from stretching them across the screen
  return html
    .replace(/<img\b([^>]*?)\bwidth=["']100%["']([^>]*?)>/gi, '<img$1$2>')
    .replace(/<img\b([^>]*?)\bstyle=["'][^"']*width:\s*100%[^"']*["']([^>]*?)>/gi, '<img$1$2>');
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${String(block.level)}` as 'h2' | 'h3' | 'h4';
      return <Tag id={block.id}>{block.text}</Tag>;
    }
    case 'richText':
      return (
        <div className="rich" dangerouslySetInnerHTML={{ __html: normalizeRichHtml(block.html) }} />
      );
    case 'answerFirst':
      return <p className="answer-first">{block.text}</p>;
    case 'steps':
      return (
        <section className="steps">
          {block.title ? <h2>{block.title}</h2> : null}
          <ol className="steps-list">
            {block.steps.map((step, index) => (
              <li key={index}>
                <span className="stepnum" dir="ltr">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'faq':
      return (
        <section className="faq">
          {block.title ? <h2>{block.title}</h2> : null}
          <div className="faq-list">
            {block.items.map((item, index) => (
              <details key={index} className="faqrow">
                <summary>
                  <span>{item.q}</span>
                  <span className="faq-toggle" aria-hidden="true">
                    <PlusIcon />
                  </span>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case 'specTable':
      return (
        <section className="spec">
          {block.title ? <h2>{block.title}</h2> : null}
          <div className="table-scroll">
            <table>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case 'comparison':
      // A real table, because a table is what a skimming reader takes in and
      // what an answer engine quotes. The first column is the row label, which
      // makes it a header cell rather than a styling decision.
      return (
        <section className="compare">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <td />
                  {block.columns.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.label}</th>
                    {row.cells.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    case 'cta':
      return (
        <aside className={`cta cta-${block.tone}`}>
          <div>
            <h2>{block.heading}</h2>
            {block.body ? <p>{block.body}</p> : null}
          </div>
          {/* A plain anchor: the href comes from content and may be external,
              and next/link on an external URL is a runtime error waiting for
              the first editor who pastes one. */}
          <a className="btn btn-primary" href={block.buttonHref}>
            {block.buttonLabel}
            <ArrowIcon size={18} />
          </a>
        </aside>
      );
    default:
      // Blocks the storefront does not render yet are skipped rather than
      // crashing the page. The admin will not offer them until they do.
      return null;
  }
}
