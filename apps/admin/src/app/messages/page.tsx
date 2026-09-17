'use client';

import type { ContactList, ContactMessageRow, StaffMe } from '@da/contracts';
import { CONTACT_REPLY_HOURS } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import { Nav } from '../nav';

/**
 * The inbox.
 *
 * Messages were being stored and emailed to the support address, which meant
 * the panel could not answer the two questions a shared inbox has to answer:
 * how many people are waiting, and who has already taken one. A mailbox alone
 * answers neither, and two people replying to the same customer is what that
 * costs.
 *
 * So the list is unanswered-first and oldest-first within that, the whole
 * message is on the row rather than a preview, and marking one answered
 * records the name that did it. Nothing here sends a reply: the notification
 * email carries a reply-to that goes straight back to the customer, and a
 * second half-built mail client in the panel would only be somewhere replies
 * get lost. This screen is for knowing what is waiting.
 *
 * The 24-hour promise on the contact page is the one the colour follows: a
 * message past it is late, and late is the only thing on this screen that is
 * allowed to be loud.
 */
const TOPIC_LABELS: Record<ContactMessageRow['topic'], string> = {
  ORDER: 'استفسار عن طلب',
  ACTIVATION: 'مشكلة تفعيل',
  PRESALE: 'سؤال قبل الشراء',
  BUSINESS: 'مبيعات الشركات',
  OTHER: 'أخرى',
};

/** Activation problems first among equals: those are keys somebody paid for. */
const TOPIC_TONE: Record<ContactMessageRow['topic'], string> = {
  ACTIVATION: 'pill-blocked',
  ORDER: 'pill-ready',
  BUSINESS: 'pill-published',
  PRESALE: 'pill-draft',
  OTHER: 'pill-draft',
};

export default function MessagesPage() {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);
  const [inbox, setInbox] = useState<ContactList | null>(null);
  const [includeHandled, setIncludeHandled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInbox(await api.messages(includeHandled));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.push('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الرسائل.');
    }
  }, [includeHandled, router]);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  if (!me) return <div className="admin-layout">…</div>;

  const canWork = ['OWNER', 'ADMIN', 'SUPPORT'].includes(me.role);

  async function mark(row: ContactMessageRow, status: 'NEW' | 'HANDLED'): Promise<void> {
    setError(null);
    try {
      await api.setMessageStatus(row.id, status);
      setNote(
        status === 'HANDLED' ? `وُسمت رسالة ${row.name} كمُجابة` : `أُعيدت رسالة ${row.name}`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تحديث الرسالة.');
    }
  }

  return (
    <Nav
      me={me}
      current="messages"
      {...(inbox ? { messagesWaiting: inbox.waiting, messagesOverdue: inbox.overdue } : {})}
    >
      <div className="queue-head">
        <h1>الرسائل</h1>
        <p className="who">
          {inbox ? `${String(inbox.waiting)} رسالة تنتظر` : '…'}
          {inbox && inbox.overdue > 0 ? (
            <strong className="overdue-count">
              {' '}
              · {inbox.overdue} تجاوزت {CONTACT_REPLY_HOURS} ساعة
            </strong>
          ) : null}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={includeHandled}
            onChange={(event) => setIncludeHandled(event.target.checked)}
          />
          <span>اعرض المُجابة أيضاً</span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="ok-note">{note}</p> : null}
      {!canWork ? (
        <p className="notice">
          دورك <strong>{me.role}</strong> يسمح بالقراءة دون تعليم الرسائل.
        </p>
      ) : null}

      {inbox && inbox.rows.length === 0 ? (
        <p className="notice">
          {includeHandled ? 'لا رسائل بعد.' : 'لا رسائل تنتظر. كل ما وصل أُجيب عليه.'}
        </p>
      ) : null}

      {/* A row per message.
          The card carried the whole message text, so five messages were five
          screens and the oldest — the one that matters — was furthest from the
          eye. The wait is a column now; the message opens under the row that
          owns it. */}
      {inbox && inbox.rows.length > 0 ? (
        <div className="table-scroll">
          <table className="admin-table messages-table">
            <thead>
              <tr>
                <th>الموضوع</th>
                <th>المُرسِل</th>
                <th>البريد</th>
                <th>رقم الطلب</th>
                <th>الانتظار</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(inbox?.rows ?? []).map((row) => (
                <MessageRow
                  key={row.id}
                  row={row}
                  canWork={canWork}
                  onMark={(status) => void mark(row, status)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Nav>
  );
}

/** Columns the drawer spans. */
const COLUMNS = 6;

function MessageRow({
  row,
  canWork,
  onMark,
}: {
  row: ContactMessageRow;
  canWork: boolean;
  onMark: (status: 'NEW' | 'HANDLED') => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  /**
   * Whether the message itself is showing.
   *
   * Closed by default, which is the whole point of the row: the card carried
   * the entire message body, so five messages were five screens and the oldest
   * — the one that matters — was furthest from the eye.
   */
  const [open, setOpen] = useState(false);
  const handled = row.status === 'HANDLED';
  const overdue = !handled && row.waitingSeconds > CONTACT_REPLY_HOURS * 3600;

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // A blocked clipboard is not worth a banner; the value is selectable.
    }
  }

  return (
    <>
      <tr className={`message-row${overdue ? ' is-overdue' : ''}${handled ? ' is-settled' : ''}`}>
        <td>
          <span className={`pill ${TOPIC_TONE[row.topic]}`}>{TOPIC_LABELS[row.topic]}</span>
          {overdue ? <span className="pill pill-blocked">متأخّرة</span> : null}
        </td>

        <td className="message-sender">
          <strong>{row.name}</strong>
          {/* Who they are, without a search: a message from somebody with
              eleven orders behind them is not the same message. */}
          <span className="meta">
            {row.customer
              ? `عميل · ${String(row.customer.orderCount)} طلباً بقيمة $${row.customer.totalSpentUsd}`
              : 'لا حساب بهذا البريد'}
          </span>
        </td>

        <td className="queue-mail">
          <span dir="ltr">{row.email}</span>
          <button type="button" className="linky" onClick={() => void copy(row.email, 'البريد')}>
            نسخ
          </button>
          {row.phone ? (
            <span className="meta" dir="ltr">
              {row.phone}
            </span>
          ) : null}
        </td>

        <td className="order-number" dir="ltr">
          {row.orderNumber ?? <span className="meta">—</span>}
        </td>

        <td className={`queue-wait${overdue ? ' is-late' : ''}`}>
          <strong>{waitLabel(row.waitingSeconds)}</strong>
          <span className="meta" dir="ltr">
            {row.createdAt.slice(0, 16).replace('T', ' ')}
          </span>
        </td>

        <td className="actions">
          <button
            type="button"
            className={`ghost${open ? ' is-active' : ''}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'أخفِ' : 'اقرأ'}
          </button>
          {canWork ? (
            <>
              {/* Opens the reply in whatever mail client the person already
                  uses. The panel does not send mail: a half-built client here
                  is where a reply gets lost. */}
              <a
                className="ghost as-button"
                href={`mailto:${row.email}?subject=${encodeURIComponent(`بخصوص رسالتك — ${TOPIC_LABELS[row.topic]}`)}`}
              >
                ردّ
              </a>
              {handled ? (
                <button type="button" className="ghost" onClick={() => onMark('NEW')}>
                  أعِدها
                </button>
              ) : (
                <button type="button" onClick={() => onMark('HANDLED')}>
                  أُجيبت
                </button>
              )}
            </>
          ) : null}
        </td>
      </tr>

      {open ? (
        <tr className="message-drawer">
          <td colSpan={COLUMNS}>
            {/* The message, whole and unedited. A preview is a row somebody has
                to open to understand — so it opens, rather than being trimmed
                to a line that means nothing. */}
            <p className="message-body" dir={row.locale === 'en' ? 'ltr' : 'rtl'}>
              {row.message}
            </p>
            {handled && row.handledBy ? <p className="meta">أُجيبت — {row.handledBy}</p> : null}
            {copied ? <p className="ok-note">نُسخ {copied}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** A wait in the units a person reads, not seconds. */
function waitLabel(seconds: number): string {
  if (seconds < 60) return 'أقل من دقيقة';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} دقيقة`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return hours === 1 ? 'ساعة' : `${String(hours)} ساعات`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : `${String(days)} أيام`;
}
