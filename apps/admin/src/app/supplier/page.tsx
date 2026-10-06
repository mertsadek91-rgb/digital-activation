'use client';

import type { SupplierSourceView } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { ApiError } from '../../lib/api';
import { supplierApi } from '../../lib/supplier-api';
import { useStaff } from '../../lib/use-staff';
import { Nav } from '../nav';

import { AiTab } from './ai-tab';
import { ItemsTab } from './items-tab';
import { LogTab } from './log-tab';
import { MappingTab } from './mapping-tab';
import { PricesTab } from './prices-tab';
import { SettingsTab } from './settings-tab';
import './supplier.css';

/**
 * The supplier price sheet (CR-0004), on one screen in five tabs: where the
 * sheet is and how it is priced, what was read from it, which of our variants
 * each line is, the price proposals, and the log of every change.
 *
 * The tab lives in the URL hash so a link can open the right one.
 */
const TABS = ['settings', 'items', 'mapping', 'prices', 'ai', 'log'] as const;
type Tab = (typeof TABS)[number];

const LABEL = {
  settings: 'tabSettings',
  items: 'tabItems',
  mapping: 'tabMapping',
  prices: 'tabPrices',
  ai: 'tabAi',
  log: 'tabLog',
} as const;

export default function SupplierPage() {
  const router = useRouter();
  const t = useT('supplier');
  const c = useT('common');
  const me = useStaff();
  const [tab, setTabState] = useState<Tab>('settings');
  const [source, setSource] = useState<SupplierSourceView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a sync, so the data tabs reload what changed.
  const [version, setVersion] = useState(0);
  // A product just created from a sheet line, handed to the AI tab.
  const [copySlug, setCopySlug] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '') as Tab;
    if (TABS.includes(fromHash)) setTabState(fromHash);
  }, []);

  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `#${next}`);
  };

  const loadSource = useCallback(async () => {
    try {
      setSource(await supplierApi.source());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : t('loadFailed'));
    }
  }, [router, t]);

  useEffect(() => {
    if (me) void loadSource();
  }, [me, loadSource]);

  if (!me) return <div className="admin-layout">{c('loading')}</div>;
  const isAdmin = me.role === 'OWNER' || me.role === 'ADMIN';

  return (
    <Nav me={me} current="supplier">
      <div className="queue-head">
        <h1>{t('title')}</h1>
        <p className="who">{t('lede')}</p>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="tabs-bar supplier-tabs" role="tablist" aria-label={t('title')}>
        {TABS.map((key) => (
          <button
            key={key}
            id={`tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            className={`tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {t(LABEL[key])}
          </button>
        ))}
      </div>

      <div
        className="tab-panel is-active"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {source === undefined ? (
          <p className="meta">{c('loading')}</p>
        ) : tab === 'settings' ? (
          <SettingsTab
            source={source}
            isAdmin={isAdmin}
            onSaved={(next) => setSource(next)}
            onSynced={() => {
              setVersion((value) => value + 1);
              void loadSource();
            }}
          />
        ) : tab === 'items' ? (
          <ItemsTab
            key={version}
            canCreate={isAdmin}
            onCreated={(slug) => {
              setCopySlug(slug);
              setTab('ai');
            }}
          />
        ) : tab === 'mapping' ? (
          <MappingTab key={version} />
        ) : tab === 'prices' ? (
          <PricesTab key={version} isAdmin={isAdmin} />
        ) : tab === 'ai' ? (
          <AiTab key={copySlug ?? 'ai'} isAdmin={isAdmin} initialSlug={copySlug} />
        ) : (
          <LogTab key={version} />
        )}
      </div>
    </Nav>
  );
}
