'use client';

import type { SocialProofPreview } from '@da/contracts';
import { useCallback, useEffect, useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import {
  NumberField,
  SaveBar,
  SignalsFrame,
  Toggle,
  inRange,
  useFeatureSettings,
} from '../signals-shared';

/**
 * إشعارات الشراء — "bought 7 times in the last 3 days".
 *
 * The preview table is the point of this screen: it lists the products with
 * paid orders in the saved window and which of them clear the minimum, so the
 * threshold can be set by looking at the catalogue rather than by guessing.
 * It reads the saved settings, and is refreshed after each save.
 */
export default function SocialProofPage() {
  const t = useT('marketingSocialProof');
  const s = useT('marketingSignals');
  const { me, allowed, draft, setDraft, dirty, save, saving, error, note } =
    useFeatureSettings('socialProof');
  const [preview, setPreview] = useState<SocialProofPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await api.socialProofPreview());
      setPreviewFailed(false);
    } catch {
      setPreviewFailed(true);
    }
  }, []);

  useEffect(() => {
    if (me && allowed) void loadPreview();
  }, [me, allowed, loadPreview]);

  let invalid: string | null = null;
  if (draft) {
    if (!inRange(draft.windowHours, 1, 720)) invalid = t('windowInvalid');
    else if (!inRange(draft.minOrders, 1, 100)) invalid = t('minInvalid');
    else if (!inRange(draft.intervalSeconds, 0, 600)) invalid = t('intervalInvalid');
    else if (!inRange(draft.maxPerPage, 0, 10)) invalid = t('maxInvalid');
  }

  const shown = preview?.rows.filter((row) => row.shown).length ?? 0;

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
          <SaveBar
            dirty={dirty}
            saving={saving}
            invalid={invalid}
            onSave={() => void save().then((ok) => (ok ? loadPreview() : undefined))}
          />
        ) : null
      }
    >
      {draft ? (
        <section className="vault-section">
          <Toggle
            label={s('enabled')}
            hint={t('enabledHint')}
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
          <div className="signals-fields">
            <NumberField
              label={t('windowHours')}
              hint={t('windowHint')}
              value={draft.windowHours}
              min={1}
              max={720}
              onChange={(windowHours) => setDraft({ ...draft, windowHours })}
            />
            <NumberField
              label={t('minOrders')}
              hint={t('minHint')}
              value={draft.minOrders}
              min={1}
              max={100}
              onChange={(minOrders) => setDraft({ ...draft, minOrders })}
            />
            <NumberField
              label={t('intervalSeconds')}
              hint={t('intervalHint')}
              value={draft.intervalSeconds}
              min={0}
              max={600}
              onChange={(intervalSeconds) => setDraft({ ...draft, intervalSeconds })}
            />
            <NumberField
              label={t('maxPerPage')}
              hint={t('maxHint')}
              value={draft.maxPerPage}
              min={0}
              max={10}
              onChange={(maxPerPage) => setDraft({ ...draft, maxPerPage })}
            />
          </div>
          <Toggle
            label={t('showCountry')}
            hint={t('showCountryHint')}
            checked={draft.showCountry}
            onChange={(showCountry) => setDraft({ ...draft, showCountry })}
          />
          <p className="lede-sm">{t('rules')}</p>
        </section>
      ) : null}

      <section className="vault-section">
        <h2>{t('previewHeading')}</h2>
        {preview ? (
          <>
            <p className="lede-sm">
              {t('previewSummary', {
                shown,
                total: preview.rows.length,
                hours: preview.windowHours,
                min: preview.minOrders,
              })}
            </p>
            {!preview.enabled ? <p className="notice">{t('previewOff')}</p> : null}
            {dirty ? <p className="meta meta-warn">{t('previewSaved')}</p> : null}
            {preview.rows.length === 0 ? (
              <p className="notice">{t('previewEmpty')}</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>{t('colProduct')}</th>
                    <th>{t('colOrders')}</th>
                    <th>{t('colShown')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.productId}>
                      <td>
                        {row.name}{' '}
                        <span className="meta" dir="ltr">
                          {row.slug}
                        </span>
                      </td>
                      <td dir="ltr">{row.count}</td>
                      <td>
                        <span className={`pill ${row.shown ? 'pill-published' : 'pill-draft'}`}>
                          {row.shown
                            ? t('shownYes')
                            : t('shownNo', { missing: preview.minOrders - row.count })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : previewFailed ? (
          <p className="notice">{t('previewFailed')}</p>
        ) : (
          <p className="meta">…</p>
        )}
      </section>
    </SignalsFrame>
  );
}
