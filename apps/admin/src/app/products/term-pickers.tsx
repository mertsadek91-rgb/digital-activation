'use client';

import type { VariantTerms } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../i18n/provider';

/**
 * The licence term and the device count as choices, not free boxes
 * (TASK-0134).
 *
 * Typed by hand they came out a different way on every product, and the
 * supplier linking could not tell "3 years · 2 devices" from "2 years · 3
 * devices". The common terms are one pick each; "unlimited" and "not
 * specified" are choices of their own (a game key or an account states
 * neither); anything else is "another…", which opens the number boxes.
 */

type Unit = VariantTerms['licensePeriodUnit'];

const PERIODS = [
  { key: 'period_1y', unit: 'YEAR', value: 1 },
  { key: 'period_2y', unit: 'YEAR', value: 2 },
  { key: 'period_3y', unit: 'YEAR', value: 3 },
  { key: 'period_5y', unit: 'YEAR', value: 5 },
  { key: 'period_1m', unit: 'MONTH', value: 1 },
  { key: 'period_3m', unit: 'MONTH', value: 3 },
  { key: 'period_6m', unit: 'MONTH', value: 6 },
  { key: 'period_lifetime', unit: 'LIFETIME', value: null },
  { key: 'period_unspecified', unit: 'UNSPECIFIED', value: null },
] as const;

const DEVICES = [
  { key: 'devices_1', value: 1 },
  { key: 'devices_2', value: 2 },
  { key: 'devices_3', value: 3 },
  { key: 'devices_4', value: 4 },
  { key: 'devices_5', value: 5 },
  { key: 'devices_10', value: 10 },
  { key: 'devices_unlimited', value: 0 },
  { key: 'devices_unspecified', value: null },
] as const;

const CUSTOM = 'custom';
const CUSTOM_UNITS = ['YEAR', 'MONTH', 'DAY'] as const;

function presetOf(unit: Unit, value: number | null): string {
  const found = PERIODS.find(
    (entry) => entry.unit === unit && (entry.value === null || entry.value === (value ?? 1)),
  );
  return found?.key ?? CUSTOM;
}

export function PeriodPicker({
  id,
  unit,
  value,
  disabled,
  labelClassName,
  onChange,
}: {
  id: string;
  unit: Unit;
  value: number | null;
  disabled?: boolean;
  /** The label class of the form it sits in. */
  labelClassName?: string;
  onChange: (unit: Unit, value: number | null) => void;
}) {
  const t = useT('products');
  // "Another…" stays open while a custom term is typed, even when it happens
  // to equal a preset for a moment.
  const [custom, setCustom] = useState(() => presetOf(unit, value) === CUSTOM);
  const selected = custom ? CUSTOM : presetOf(unit, value);

  return (
    <>
      <label className={labelClassName}>
        <span>{t('termPeriod')}</span>
        <select
          id={id}
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            const key = event.target.value;
            if (key === CUSTOM) {
              setCustom(true);
              if (unit === 'LIFETIME' || unit === 'UNSPECIFIED') onChange('YEAR', 1);
              return;
            }
            setCustom(false);
            const preset = PERIODS.find((entry) => entry.key === key);
            if (preset) onChange(preset.unit, preset.value);
          }}
        >
          {PERIODS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {t(entry.key)}
            </option>
          ))}
          <option value={CUSTOM}>{t('period_custom')}</option>
        </select>
      </label>
      {selected === CUSTOM ? (
        <div className="term-custom">
          <label className={labelClassName}>
            <span>{t('periodCustomValue')}</span>
            <input
              id={`${id}-value`}
              type="number"
              min={1}
              max={120}
              dir="ltr"
              value={value ?? 1}
              disabled={disabled}
              onChange={(event) => onChange(unit, Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <label className={labelClassName}>
            <span>{t('periodCustomUnit')}</span>
            <select
              id={`${id}-unit`}
              value={unit}
              disabled={disabled}
              onChange={(event) => onChange(event.target.value as Unit, value ?? 1)}
            >
              {CUSTOM_UNITS.map((entry) => (
                <option key={entry} value={entry}>
                  {t(`unit_${entry}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </>
  );
}

export function DevicesPicker({
  id,
  value,
  disabled,
  labelClassName,
  onChange,
}: {
  id: string;
  /** 0 means unlimited; null means not specified. */
  value: number | null;
  disabled?: boolean;
  /** The label class of the form it sits in. */
  labelClassName?: string;
  onChange: (value: number | null) => void;
}) {
  const t = useT('products');
  const preset = DEVICES.find((entry) => entry.value === value)?.key ?? CUSTOM;
  const [custom, setCustom] = useState(preset === CUSTOM);
  const selected = custom ? CUSTOM : preset;

  return (
    <>
      <label className={labelClassName}>
        <span>{t('termDevices')}</span>
        <select
          id={id}
          value={selected}
          disabled={disabled}
          onChange={(event) => {
            const key = event.target.value;
            if (key === CUSTOM) {
              setCustom(true);
              if (value === null || value === 0) onChange(6);
              return;
            }
            setCustom(false);
            const entry = DEVICES.find((option) => option.key === key);
            if (entry) onChange(entry.value);
          }}
        >
          {DEVICES.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {t(entry.key)}
            </option>
          ))}
          <option value={CUSTOM}>{t('devices_custom')}</option>
        </select>
      </label>
      {selected === CUSTOM ? (
        <label className={labelClassName}>
          <span>{t('devicesCustomCount')}</span>
          <input
            id={`${id}-count`}
            type="number"
            min={1}
            max={10000}
            dir="ltr"
            value={value ?? 1}
            disabled={disabled}
            onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
      ) : null}
    </>
  );
}
