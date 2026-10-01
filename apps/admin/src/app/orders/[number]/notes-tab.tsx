'use client';

import type { AdminOrderDetail, StaffMe } from '@da/contracts';
import { useState } from 'react';

import { useT } from '../../../i18n/provider';
import { api } from '../../../lib/api';
import { stamp } from '../order-shared';
import type { Notice } from './page';

/**
 * What was agreed about this order, and by whom.
 *
 * Notes are for what was agreed, never for what was delivered: the legacy
 * store used order notes as its delivery mechanism, which is why its backup
 * is a file full of customer licence keys. A note can be shown to the
 * customer on their order page; the default is internal.
 */
export function NotesTab({
  detail,
  me,
  onDone,
  onNotice,
}: {
  detail: AdminOrderDetail;
  me: StaffMe;
  onDone: () => Promise<void>;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useT('order');
  const c = useT('common');
  const canNote = ['OWNER', 'ADMIN', 'SUPPORT', 'FULFILLMENT'].includes(me.role);
  const [body, setBody] = useState('');
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit(): Promise<void> {
    setSending(true);
    onNotice(null);
    try {
      await api.addOrderNote(detail.number, body.trim(), visible);
      setBody('');
      setVisible(false);
      onNotice({ kind: 'ok', text: t('doneNoteAdded') });
      await onDone();
    } catch (caught) {
      onNotice({
        kind: 'error',
        text: caught instanceof Error ? caught.message : c('actionFailed'),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="notes">
      {canNote ? (
        <form
          className="paste-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim().length >= 2) void submit();
          }}
        >
          <h3 className="card__subtitle">{t('addNoteHeading')}</h3>
          <label className="grow">
            {t('noteBody')}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              required
              minLength={2}
              maxLength={2000}
              placeholder={t('notePlaceholder')}
            />
            <small>{t('noteHint')}</small>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => setVisible(event.target.checked)}
            />
            {t('noteVisibleToggle')}
          </label>
          <button type="submit" disabled={sending || body.trim().length < 2}>
            {t('addNote')}
          </button>
        </form>
      ) : null}

      <h3 className="card__subtitle">{t('notesHeading')}</h3>
      {detail.notes.length === 0 ? (
        <p className="meta">{t('noNotes')}</p>
      ) : (
        <ul className="order-notes-list">
          {detail.notes.map((note) => (
            <li key={note.id} className="order-note-item">
              <p className="note-text">{note.body}</p>
              <div className="note-meta-row">
                <span className="note-author">{note.author ?? t('unknownAuthor')}</span>
                <span>·</span>
                <span className="note-date" dir="ltr">
                  {stamp(note.createdAt)}
                </span>
                {note.isCustomerVisible ? (
                  <span className="pill pill-published">{t('noteCustomerVisible')}</span>
                ) : (
                  <span className="pill pill-draft">{t('noteInternal')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
