'use client';

import type { SupplierLog } from '@da/contracts';
import { useEffect, useState } from 'react';

import { useAdminLocale, useT } from '../../i18n/provider';
import { supplierApi } from '../../lib/supplier-api';

import { formatWhen, shown } from './format';
import { statusPill } from './settings-tab';

/**
 * Every read of the sheet, every change it brought, and every action taken
 * in the store because of it (links, prices applied, availability switched).
 * The last list comes from the hash-chained audit log.
 */
export function LogTab() {
  const t = useT('supplier');
  const c = useT('common');
  const locale = useAdminLocale();
  const [log, setLog] = useState<SupplierLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supplierApi
      .log()
      .then(setLog)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : t('loadFailed')),
      );
  }, [t]);

  if (error) return <p className="error">{error}</p>;
  if (!log) return <p className="meta">{c('loading')}</p>;

  const yes = t('struckYes');
  const no = t('struckNo');
  const actionLabel = (action: string): string => {
    const key = `action_${action}` as Parameters<typeof t>[0];
    return t(key);
  };

  return (
    <div className="supplier-log">
      <section className="vault-section">
        <h2>{t('syncsHeading')}</h2>
        <div className="table-scroll">
          <table className="admin-table supplier-table">
            <thead>
              <tr>
                <th>{t('colWhen')}</th>
                <th>{t('colStatus')}</th>
                <th className="num">{t('colRows')}</th>
                <th className="num">{t('colDiff')}</th>
                <th className="num">{t('colSwitched')}</th>
                <th>{t('colTrigger')}</th>
              </tr>
            </thead>
            <tbody>
              {log.snapshots.map((row) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.fetchedAt, locale)}</td>
                  <td>
                    <span className={`pill ${statusPill(row.status)}`}>
                      {t(`status${row.status}` as 'statusOK')}
                    </span>
                    {row.error ? <div className="meta">{row.error}</div> : null}
                  </td>
                  <td className="num">{row.rowCount}</td>
                  <td className="num" dir="ltr">
                    {row.added} / {row.changed} / {row.removed}
                  </td>
                  <td className="num">{row.stockSwitched}</td>
                  <td>{row.manual ? t('manual') : t('scheduled')}</td>
                </tr>
              ))}
              {log.snapshots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="meta">
                    {t('logEmpty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="vault-section">
        <h2>{t('actionsHeading')}</h2>
        <div className="table-scroll">
          <table className="admin-table supplier-table">
            <thead>
              <tr>
                <th>{t('colWhen')}</th>
                <th>{t('colKind')}</th>
                <th>{t('colWho')}</th>
                <th>{t('colBefore')}</th>
                <th>{t('colAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {log.actions.map((row) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.createdAt, locale)}</td>
                  <td>{actionLabel(row.action)}</td>
                  <td>{row.actor ?? t('system')}</td>
                  <td className="supplier-json" dir="ltr">
                    {shown(row.before, yes, no)}
                  </td>
                  <td className="supplier-json" dir="ltr">
                    {shown(row.after, yes, no)}
                  </td>
                </tr>
              ))}
              {log.actions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="meta">
                    {t('logEmpty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="vault-section">
        <h2>{t('changesHeading')}</h2>
        <div className="table-scroll">
          <table className="admin-table supplier-table">
            <thead>
              <tr>
                <th>{t('colWhen')}</th>
                <th>{t('colName')}</th>
                <th>{t('colKind')}</th>
                <th>{t('colBefore')}</th>
                <th>{t('colAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {log.changes.map((row) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.createdAt, locale)}</td>
                  <td dir="ltr">{row.itemName}</td>
                  <td>{t(`kind_${row.kind}`)}</td>
                  <td dir="ltr">{shown(row.before, yes, no)}</td>
                  <td dir="ltr">{shown(row.after, yes, no)}</td>
                </tr>
              ))}
              {log.changes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="meta">
                    {t('logEmpty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
