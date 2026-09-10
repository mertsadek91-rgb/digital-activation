import type { Block } from '@da/contracts';

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

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${String(block.level)}` as 'h2' | 'h3' | 'h4';
      return <Tag id={block.id}>{block.text}</Tag>;
    }
    case 'richText':
      return <div className="rich" dangerouslySetInnerHTML={{ __html: block.html }} />;
    case 'answerFirst':
      return <p className="answer-first">{block.text}</p>;
    case 'steps':
      return (
        <section className="steps">
          {block.title ? <h2>{block.title}</h2> : null}
          <ol>
            {block.steps.map((step, index) => (
              <li key={index}>{step.text}</li>
            ))}
          </ol>
        </section>
      );
    case 'faq':
      return (
        <section className="faq">
          {block.title ? <h2>{block.title}</h2> : null}
          <dl>
            {block.items.map((item, index) => (
              <div key={index}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
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
    default:
      // Blocks the storefront does not render yet are skipped rather than
      // crashing the page. The admin will not offer them until they do.
      return null;
  }
}
