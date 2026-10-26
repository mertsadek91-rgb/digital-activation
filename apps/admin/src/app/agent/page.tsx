'use client';

import type { AgentCandidates, AgentOverview } from '@da/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { agentApi } from '../../lib/agent-api';
import { ApiError } from '../../lib/api';
import { useStaff } from '../../lib/use-staff';
import { Nav } from '../nav';

import { Batches } from './batches';
import { Picker } from './picker';
import './agent.css';

/**
 * The product agent (CR-0007), on one screen in three tabs: published
 * products to rewrite, supplier lines to turn into products, and the batches
 * the worker is running or has run. The tab lives in the URL hash.
 */
const TABS = ['rewrite', 'create', 'batches'] as const;
type Tab = (typeof TABS)[number];

/** How often the screen re-reads a batch that is still running. */
const POLL_MS = 5000;

export default function AgentPage() {
  const router = useRouter();
  const t = useT('agent');
  const c = useT('common');
  const me = useStaff();
  const [tab, setTabState] = useState<Tab>('rewrite');
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [candidates, setCandidates] = useState<AgentCandidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const fromHash = window.location.hash.replace('#', '') as Tab;
      if (TABS.includes(fromHash)) setTabState(fromHash);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  const fail = useCallback(
    (caught: unknown) => {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('aiNotReady'));
    },
    [router, t],
  );

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await agentApi.overview());
      setError(null);
    } catch (caught) {
      fail(caught);
    }
  }, [fail]);

  const loadCandidates = useCallback(async () => {
    try {
      setCandidates(await agentApi.candidates());
    } catch (caught) {
      fail(caught);
    }
  }, [fail]);

  useEffect(() => {
    if (!me) return;
    void loadOverview();
    void loadCandidates();
  }, [me, loadOverview, loadCandidates]);

  const running = overview?.batches.filter((batch) => batch.status === 'RUNNING').length ?? 0;

  // A running batch changes under the screen; a finished one does not.
  useEffect(() => {
    if (running === 0) return;
    const timer = window.setInterval(() => void loadOverview(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, loadOverview]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const isAdmin = me.role === 'OWNER' || me.role === 'ADMIN';

  return (
    <Nav me={me} current="agent">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}

      {overview && !overview.aiReady ? (
        <p className="notice-warn agent-banner">
          {t('aiNotReady')} <Link href="/supplier#ai">{t('openAiSettings')}</Link>
        </p>
      ) : null}
      {overview && !overview.workerOn ? (
        <p className="notice-warn agent-banner">{t('workerOff')}</p>
      ) : null}
      {overview?.aiReady && overview.model ? (
        <p className="meta agent-model">
          <span dir="ltr">{t('aiModel', { model: overview.model })}</span>
        </p>
      ) : null}

      <div className="tabs-bar agent-tabs" role="tablist" aria-label={t('title')}>
        {TABS.map((key) => (
          <button
            key={key}
            id={`tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            aria-controls={`panel-${key}`}
            className={`tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              const index = TABS.indexOf(tab);
              const rtl = document.documentElement.dir === 'rtl';
              let target: Tab | undefined;
              if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight'))
                target = TABS[(index + 1) % TABS.length];
              else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft'))
                target = TABS[(index - 1 + TABS.length) % TABS.length];
              if (!target) return;
              event.preventDefault();
              setTab(target);
              document.getElementById(`tab-${target}`)?.focus();
            }}
          >
            {key === 'rewrite'
              ? t('tabRewrite')
              : key === 'create'
                ? t('tabCreate')
                : running > 0
                  ? t('tabBatchesRunning', { count: running })
                  : t('tabBatches')}
          </button>
        ))}
      </div>

      <div
        className="tab-panel is-active"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'batches' ? (
          overview ? (
            <Batches
              batches={overview.batches}
              open={openBatch}
              onOpen={setOpenBatch}
              onChanged={() => {
                void loadOverview();
                void loadCandidates();
              }}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="meta">{c('loading')}</p>
          )
        ) : candidates ? (
          <Picker
            key={tab}
            kind={tab === 'rewrite' ? 'REWRITE' : 'CREATE'}
            candidates={candidates}
            canStart={isAdmin && Boolean(overview?.aiReady)}
            isAdmin={isAdmin}
            onStarted={(batchId) => {
              setOpenBatch(batchId);
              setTab('batches');
              void loadOverview();
              void loadCandidates();
            }}
          />
        ) : (
          <p className="meta">{c('loading')}</p>
        )}
      </div>
    </Nav>
  );
}
