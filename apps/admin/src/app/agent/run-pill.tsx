'use client';

import type { AgentItemStatus } from '@da/contracts';

import { useAdminLocale, useT } from '../../i18n/provider';

/** The pill colour for an item's state. */
export function itemPill(status: AgentItemStatus): string {
  switch (status) {
    case 'DONE':
      return 'pill-success';
    case 'FAILED':
      return 'pill-danger';
    case 'RUNNING':
      return 'pill-info';
    case 'QUEUED':
    case 'SKIPPED':
      return 'pill-warning';
    default:
      return 'pill-neutral';
  }
}

/** The last time the agent worked on a product or a line, or a dash. */
export function RunPill({ run }: { run: { status: AgentItemStatus; at: string } | null }) {
  const t = useT('agent');
  const locale = useAdminLocale();
  if (!run) return <span className="meta">{t('none')}</span>;
  return (
    <span className="agent-run">
      <span className={`pill ${itemPill(run.status)}`}>{t(`item${run.status}`)}</span>
      <span className="meta">
        {new Date(run.at).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
          numberingSystem: 'latn',
          day: 'numeric',
          month: 'short',
        })}
      </span>
    </span>
  );
}
