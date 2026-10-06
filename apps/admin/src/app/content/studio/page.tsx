'use client';

import type { ArticleIdea, StudioArticleResult, StudioView } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { ApiError } from '../../../lib/api';
import { studioApi, waitForStudioJob } from '../../../lib/studio-api';
import { useStaff } from '../../../lib/use-staff';
import { Nav } from '../../nav';
import './studio.css';

/**
 * The article studio (CR-0006).
 *
 * Ideas come from what the site already has — every product and article —
 * and from a conversation with the model; each one can be written into a full
 * draft article (1,500–2,000 words, ~50-word summary first, headings, FAQ,
 * internal links only to pages that exist, SEO fields). The draft opens in
 * the blog editor, where the owner adds the image from the prompt the studio
 * wrote, reviews and publishes.
 */
export default function StudioPage() {
  const router = useRouter();
  const t = useT('studio');
  const c = useT('common');
  const me = useStaff();
  const [view, setView] = useState<StudioView | null>(null);
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudioArticleResult | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [custom, setCustom] = useState({ title: '', keyword: '', instructions: '' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setView(await studioApi.view());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [router, t]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  async function run(label: string, start: () => Promise<{ id: string }>): Promise<void> {
    setBusy(label);
    setError(null);
    setElapsed(0);
    try {
      const job = await start();
      const done = await waitForStudioJob(job.id, {
        onElapsed: setElapsed,
        isActive: () => mounted.current,
        timedOut: t('timedOut'),
      });
      if (done.status === 'FAILED') throw new Error(done.error ?? c('actionFailed'));
      if (done.kind === 'article' && done.result && 'slug' in done.result) setResult(done.result);
      await load();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  if (!me) return <div className="admin-layout">{c('loading')}</div>;

  const ideas = (view?.ideas ?? []).filter((idea) =>
    showDismissed ? idea.status === 'DISMISSED' : idea.status !== 'DISMISSED',
  );
  const busyLabel = (label: string, idle: string) =>
    busy === label ? t('working', { seconds: elapsed }) : idle;

  return (
    <Nav me={me} current="contentStudio">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {view && !view.aiReady ? <p className="notice">{t('aiMissing')}</p> : null}

      {view ? (
        <p className="meta studio-inventory">
          {t('inventory', {
            products: view.inventory.products,
            articles: view.inventory.articles,
            published: view.inventory.publishedArticles,
          })}{' '}
          {t('noSearchData')}
        </p>
      ) : null}

      {result ? <ArticleResult result={result} onClose={() => setResult(null)} /> : null}

      <div className="studio-layout">
        <section className="card studio-chat" aria-label={t('chatHeading')}>
          <div className="studio-head">
            <h2>{t('chatHeading')}</h2>
            <div className="locale-switch" role="group" aria-label={t('language')}>
              {(['ar', 'en'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`chip${locale === code ? ' is-active' : ''}`}
                  aria-pressed={locale === code}
                  onClick={() => setLocale(code)}
                >
                  {code === 'ar' ? t('arabic') : t('english')}
                </button>
              ))}
            </div>
          </div>
          <p className="lede-sm">{t('chatLede')}</p>
          <ol className="studio-thread">
            {(view?.thread ?? []).map((entry, index) => (
              <li key={index} className={`studio-message is-${entry.role}`} dir="auto">
                <strong>{entry.role === 'user' ? t('you') : t('assistant')}</strong>
                <p>{entry.text}</p>
              </li>
            ))}
            {view && view.thread.length === 0 ? <li className="meta">{t('threadEmpty')}</li> : null}
          </ol>
          <label className="field">
            <span>{t('messageLabel')}</span>
            <textarea
              rows={3}
              dir="auto"
              value={message}
              placeholder={t('messageHint')}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <div className="studio-actions">
            <button
              type="button"
              disabled={busy !== null || !view?.aiReady}
              onClick={() =>
                void run('chat', async () => {
                  const job = await studioApi.chat({ message: message.trim(), locale });
                  setMessage('');
                  return job;
                })
              }
            >
              {busyLabel('chat', message.trim() ? t('send') : t('suggest'))}
            </button>
            {view && view.thread.length > 0 ? (
              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                onClick={() =>
                  void studioApi
                    .clearChat()
                    .then(setView)
                    .catch((caught: unknown) =>
                      setError(caught instanceof Error ? caught.message : String(caught)),
                    )
                }
              >
                {t('newConversation')}
              </button>
            ) : null}
          </div>
        </section>

        <section className="card studio-custom" aria-label={t('customHeading')}>
          <h2>{t('customHeading')}</h2>
          <p className="lede-sm">{t('customLede')}</p>
          <label className="field">
            <span>{t('customTitle')}</span>
            <input
              dir="auto"
              value={custom.title}
              onChange={(event) => setCustom({ ...custom, title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t('customKeyword')}</span>
            <input
              dir="auto"
              value={custom.keyword}
              onChange={(event) => setCustom({ ...custom, keyword: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t('instructions')}</span>
            <textarea
              rows={2}
              dir="auto"
              value={custom.instructions}
              placeholder={t('instructionsHint')}
              onChange={(event) => setCustom({ ...custom, instructions: event.target.value })}
            />
          </label>
          <div className="studio-actions">
            <button
              type="button"
              disabled={busy !== null || !view?.aiReady || custom.title.trim().length < 5}
              onClick={() =>
                void run('custom', () =>
                  studioApi.write({
                    title: custom.title.trim(),
                    primaryKeyword: custom.keyword.trim(),
                    locale,
                    instructions: custom.instructions,
                  }),
                )
              }
            >
              {busyLabel('custom', t('writeArticle'))}
            </button>
          </div>
        </section>
      </div>

      <section className="studio-ideas" aria-label={t('ideasHeading')}>
        <div className="studio-head">
          <h2>{t('ideasHeading')}</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(event) => setShowDismissed(event.target.checked)}
            />
            <span>{t('showDismissed')}</span>
          </label>
        </div>
        {ideas.length === 0 ? <p className="notice">{t('ideasEmpty')}</p> : null}
        <div className="studio-idea-list">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              busy={busy}
              busyLabel={busyLabel}
              aiReady={Boolean(view?.aiReady)}
              onWrite={(instructions) =>
                void run(`idea-${idea.id}`, () =>
                  studioApi.write({ ideaId: idea.id, locale: idea.locale, instructions }),
                )
              }
              onStatus={(status) =>
                void studioApi
                  .setIdea(idea.id, status)
                  .then(setView)
                  .catch((caught: unknown) =>
                    setError(caught instanceof Error ? caught.message : String(caught)),
                  )
              }
            />
          ))}
        </div>
      </section>
    </Nav>
  );
}

function IdeaCard({
  idea,
  busy,
  busyLabel,
  aiReady,
  onWrite,
  onStatus,
}: {
  idea: ArticleIdea;
  busy: string | null;
  busyLabel: (label: string, idle: string) => string;
  aiReady: boolean;
  onWrite: (instructions: string) => void;
  onStatus: (status: 'NEW' | 'DISMISSED') => void;
}) {
  const t = useT('studio');
  const [instructions, setInstructions] = useState('');
  return (
    <article className={`card studio-idea is-${idea.status.toLowerCase()}`} dir="auto">
      <h3>{idea.title}</h3>
      <p className="studio-tags">
        <span className="pill pill-info">{idea.primaryKeyword}</span>
        <span className="pill pill-neutral">{t(`intent_${idea.intent}`)}</span>
        {idea.status === 'DRAFTED' ? (
          <span className="pill pill-success">{t('drafted')}</span>
        ) : null}
      </p>
      {idea.rationale ? <p className="meta">{idea.rationale}</p> : null}
      {idea.secondaryKeywords.length > 0 ? (
        <p className="meta">
          {t('secondary')}: {idea.secondaryKeywords.join('، ')}
        </p>
      ) : null}
      {idea.outline.length > 0 ? (
        <details>
          <summary>{t('outline')}</summary>
          <ol>
            {idea.outline.map((heading) => (
              <li key={heading}>{heading}</li>
            ))}
          </ol>
        </details>
      ) : null}
      {idea.relatedProductSlugs.length + idea.relatedArticleSlugs.length > 0 ? (
        <p className="meta studio-links" dir="ltr">
          {[...idea.relatedProductSlugs, ...idea.relatedArticleSlugs].join(' · ')}
        </p>
      ) : null}
      {idea.status === 'DRAFTED' && idea.articleSlug ? (
        <div className="studio-actions">
          <Link
            className="as-button"
            href={`/content/blog/${encodeURIComponent(idea.articleSlug)}`}
          >
            {t('openDraft')}
          </Link>
          {idea.imagePrompt ? <CopyPrompt prompt={idea.imagePrompt} /> : null}
        </div>
      ) : idea.status === 'DISMISSED' ? (
        <div className="studio-actions">
          <button type="button" className="ghost btn-sm" onClick={() => onStatus('NEW')}>
            {t('restore')}
          </button>
        </div>
      ) : (
        <>
          <input
            dir="auto"
            aria-label={t('instructions')}
            placeholder={t('instructionsHint')}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
          <div className="studio-actions">
            <button
              type="button"
              disabled={busy !== null || !aiReady}
              onClick={() => onWrite(instructions)}
            >
              {busyLabel(`idea-${idea.id}`, t('writeArticle'))}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy !== null}
              onClick={() => onStatus('DISMISSED')}
            >
              {t('dismiss')}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function ArticleResult({ result, onClose }: { result: StudioArticleResult; onClose: () => void }) {
  const t = useT('studio');
  const c = useT('common');
  return (
    <section className="card studio-result" role="status" aria-label={t('resultHeading')}>
      <div className="studio-head">
        <h2>{t('resultHeading')}</h2>
        <button type="button" className="ghost btn-sm" aria-label={c('cancel')} onClick={onClose}>
          ✕
        </button>
      </div>
      <p dir="auto">
        <strong>{result.title}</strong>
      </p>
      <ul className="studio-facts">
        <li>{t('resultWords', { count: result.wordCount })}</li>
        <li>{t('resultSummary', { count: result.summaryWords })}</li>
        <li>{t('resultLinks', { count: result.internalLinks.length })}</li>
        <li>{t('resultProducts', { count: result.relatedProducts.length })}</li>
      </ul>
      {result.notes.length > 0 ? (
        <ul className="notice studio-notes">
          {result.notes.map((note) => (
            <li key={note} dir="auto">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <h3>{t('imagePromptHeading')}</h3>
      <p className="lede-sm">{t('imagePromptLede')}</p>
      <pre className="studio-prompt" dir="ltr">
        {result.imagePrompt}
      </pre>
      {result.imageAlt ? (
        <p className="meta" dir="auto">
          {t('imageAlt')}: {result.imageAlt}
        </p>
      ) : null}
      <div className="studio-actions">
        <CopyPrompt prompt={result.imagePrompt} />
        <Link className="as-button" href={`/content/blog/${encodeURIComponent(result.slug)}`}>
          {t('openDraft')}
        </Link>
      </div>
    </section>
  );
}

function CopyPrompt({ prompt }: { prompt: string }) {
  const t = useT('studio');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      onClick={() =>
        void navigator.clipboard.writeText(prompt).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
    >
      {copied ? t('copied') : t('copyPrompt')}
    </button>
  );
}
