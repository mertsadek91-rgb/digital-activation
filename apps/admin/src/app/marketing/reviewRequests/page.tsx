'use client';

import type { ReviewRequestStats } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { NumberField, SaveBar, SignalsFrame, inRange, useFeatureSettings } from '../signals-shared';

/**
 * طلبات التقييم — when a review is asked for after delivery.
 *
 * Two emails at most, by design: the invite sweep sends a first request and an
 * optional reminder, and each order is asked each stage once. The numbers
 * below the fields are the invitations that actually went out, so a change
 * here can be judged against what it did.
 */
export default function ReviewRequestsPage() {
  const t = useT('marketingReviewRequests');
  const { me, allowed, draft, setDraft, dirty, save, saving, error, note } =
    useFeatureSettings('reviewRequests');
  const [stats, setStats] = useState<ReviewRequestStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
    if (!me || !allowed) return;
    void api
      .reviewRequestStats()
      .then(setStats)
      .catch(() => setStatsFailed(true));
  }, [me, allowed]);

  let invalid: string | null = null;
  if (draft) {
    if (!inRange(draft.firstAfterDays, 1, 30)) invalid = t('firstInvalid');
    else if (!inRange(draft.secondAfterDays, 0, 60)) invalid = t('secondInvalid');
    else if (draft.secondAfterDays !== 0 && draft.secondAfterDays <= draft.firstAfterDays)
      invalid = t('secondNotAfter');
  }

  const stage = (n: number) => stats?.byStage.find((row) => row.stage === n)?.sent ?? 0;

  return (
    <SignalsFrame
      me={me}
      allowed={allowed}
      title={t('title')}
      lede={t('lede')}
      error={error}
      note={note}
      saveBar={
        draft ? (
          <SaveBar dirty={dirty} saving={saving} invalid={invalid} onSave={() => void save()} />
        ) : null
      }
    >
      {draft ? (
        <section className="vault-section">
          <div className="signals-fields">
            <NumberField
              label={t('firstAfterDays')}
              hint={t('firstHint')}
              value={draft.firstAfterDays}
              min={1}
              max={30}
              onChange={(firstAfterDays) => setDraft({ ...draft, firstAfterDays })}
            />
            <NumberField
              label={t('secondAfterDays')}
              hint={t('secondHint')}
              value={draft.secondAfterDays}
              min={0}
              max={60}
              onChange={(secondAfterDays) => setDraft({ ...draft, secondAfterDays })}
            />
          </div>
          <p className="lede-sm">{t('windowNote')}</p>
        </section>
      ) : null}

      <section className="vault-section">
        <h2>{t('statsHeading')}</h2>
        {stats ? (
          <>
            <p>{t('statsSent', { sent: stats.sent, days: stats.days })}</p>
            <ul className="signals-stats">
              <li>{t('statsFirst', { count: stage(1) })}</li>
              <li>{t('statsSecond', { count: stage(2) })}</li>
              <li>{t('statsResponded', { count: stats.responded })}</li>
            </ul>
          </>
        ) : statsFailed ? (
          <p className="notice">{t('statsFailed')}</p>
        ) : (
          <p className="meta">…</p>
        )}
      </section>
    </SignalsFrame>
  );
}
