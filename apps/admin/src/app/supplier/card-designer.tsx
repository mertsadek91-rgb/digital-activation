'use client';

import { CARD_ICONS, type CardDefaults, type CardSpecInput } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useT } from '../../i18n/provider';
import { supplierCardApi } from '../../lib/supplier-api';

type Icon = (typeof CARD_ICONS)[number];

/**
 * The product card picture in the store's legacy template: logo, corner
 * ribbon, wave, name, two chips. A person sets the words (or asks the model
 * for them), previews, and saves it into the product's images.
 */
export function CardDesigner({ slug, aiReady }: { slug: string; aiReady: boolean }) {
  const t = useT('supplier');
  const c = useT('common');
  const [defaults, setDefaults] = useState<CardDefaults | null>(null);
  const [spec, setSpec] = useState<CardSpecInput | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [isHero, setIsHero] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setDefaults(null);
    setSpec(null);
    setPreview(null);
    supplierCardApi
      .defaults(slug)
      .then((result) => {
        setDefaults(result);
        setSpec(result.spec);
        setIsHero(!result.hasImages);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [slug]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  if (!slug) return null;
  if (!spec || !defaults)
    return error ? (
      <p className="error" role="alert" dir="auto">
        {error}
      </p>
    ) : (
      <p className="meta">{c('loading')}</p>
    );

  const setChip = (index: 0 | 1, patch: Partial<CardSpecInput['chips'][0]>) =>
    setSpec((current) => {
      if (!current) return current;
      const chips: CardSpecInput['chips'] = [current.chips[0], current.chips[1]];
      chips[index] = { ...chips[index], ...patch };
      return { ...current, chips };
    });

  return (
    <section className="card">
      <h2>{t('cardHeading')}</h2>
      <p className="lede-sm">{t('cardLede')}</p>
      {!defaults.fontsAvailable ? <p className="notice">{t('cardNoFonts')}</p> : null}

      <div className="card-designer">
        <div className="supplier-form">
          <label className="field">
            <span>{t('cardTitle')}</span>
            <input
              dir="auto"
              value={spec.title}
              maxLength={80}
              onChange={(event) => setSpec({ ...spec, title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t('cardRibbon')}</span>
            <input
              dir="auto"
              value={spec.ribbon.join(' / ')}
              placeholder="مدى / الحياة"
              onChange={(event) =>
                setSpec({
                  ...spec,
                  ribbon: event.target.value
                    .split('/')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .slice(0, 3),
                })
              }
            />
            <small className="meta">{t('cardRibbonHint')}</small>
          </label>
          {([0, 1] as const).map((index) => (
            <div key={index} className="supplier-form-row">
              <label className="field">
                <span>{t('cardChip', { n: index + 1 })}</span>
                <input
                  dir="auto"
                  value={spec.chips[index].label}
                  maxLength={24}
                  onChange={(event) => setChip(index, { label: event.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('cardIconOf', { n: index + 1 })}</span>
                <select
                  value={spec.chips[index].icon}
                  onChange={(event) => setChip(index, { icon: event.target.value as Icon })}
                >
                  {CARD_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {t(`cardIcon_${icon}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <div className="supplier-form-row">
            <label className="field">
              <span>{t('cardColor')}</span>
              <input
                type="color"
                value={spec.color}
                onChange={(event) => setSpec({ ...spec, color: event.target.value })}
              />
            </label>
            <label className="check supplier-check">
              <input
                type="checkbox"
                checked={spec.useLogo}
                disabled={!defaults.hasLogo}
                onChange={(event) => setSpec({ ...spec, useLogo: event.target.checked })}
              />
              <span>
                {defaults.hasLogo
                  ? t('cardUseLogo')
                  : t('cardNoLogo', { brand: defaults.brandName ?? '—' })}
              </span>
            </label>
          </div>
          <div className="supplier-actions card-logo-upload">
            {/* A label styled as the panel's button: the file input inside it is
                hidden, so the label is what is seen and clicked. */}
            <label className="button ghost card-upload-button">
              {spec.logoDataUrl ? t('cardReplaceLogo') : t('cardUploadLogo')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void run('logo', async () => {
                    const dataUrl = await shrinkLogo(file);
                    const { color } = await supplierCardApi.logoColor(dataUrl);
                    const next = {
                      ...spec,
                      logoDataUrl: dataUrl,
                      useLogo: true,
                      color: color ?? spec.color,
                    };
                    setSpec(next);
                    const result = await supplierCardApi.preview(slug, next);
                    setPreview(result.dataUrl);
                    setNotes(result.notes);
                  });
                }}
              />
            </label>
            {spec.logoDataUrl ? (
              <>
                <img
                  className="card-logo-thumb"
                  src={spec.logoDataUrl}
                  alt={t('cardUploadedLogo')}
                />
                <button
                  type="button"
                  className="ghost btn-sm"
                  onClick={() => {
                    const { logoDataUrl: _removed, ...rest } = spec;
                    setSpec({ ...rest, useLogo: defaults.hasLogo });
                  }}
                >
                  {t('cardRemoveLogo')}
                </button>
              </>
            ) : null}
            <small className="meta">{t('cardLogoHint')}</small>
          </div>
          <div className="supplier-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy !== null || !aiReady}
              onClick={() =>
                void run('suggest', async () => {
                  setSpec(await supplierCardApi.suggest(slug, spec));
                })
              }
            >
              {busy === 'suggest' ? t('aiGenerating') : t('cardSuggest')}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy !== null}
              onClick={() =>
                void run('preview', async () => {
                  const result = await supplierCardApi.preview(slug, spec);
                  setPreview(result.dataUrl);
                  setNotes(result.notes);
                })
              }
            >
              {busy === 'preview' ? t('syncing') : t('cardPreview')}
            </button>
            <label className="check supplier-check">
              <input
                type="checkbox"
                checked={isHero}
                onChange={(event) => setIsHero(event.target.checked)}
              />
              <span>{t('cardHero')}</span>
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run('save', async () => {
                  await supplierCardApi.save(slug, { ...spec, isHero });
                  setNote(t('cardSaved'));
                })
              }
            >
              {t('cardSave')}
            </button>
          </div>
        </div>
        <div className="card-preview">
          {preview ? (
            <img src={preview} alt={spec.title} width={600} height={600} />
          ) : (
            <p className="meta">{t('cardNoPreview')}</p>
          )}
          {notes.map((line) => (
            <p key={line} className="notice" role="status" dir="auto">
              {line}
            </p>
          ))}
        </div>
      </div>
      {error ? (
        <p className="error" role="alert" dir="auto">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="ok-note" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A logo file shrunk in the browser to a PNG no wider or taller than 800 px,
 * keeping transparency, so it fits the request size limit; the server reads
 * it again before drawing.
 */
async function shrinkLogo(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas unavailable');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}
