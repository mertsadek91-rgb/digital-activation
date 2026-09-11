'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '../lib/api';

/**
 * Admin navigation.
 *
 * Carries a live count of the work waiting in the supplier queue, because that
 * is the number a person running this shop needs in front of them: every one
 * of those is a customer who has paid and is waiting. It is loaded here rather
 * than passed in so every screen shows it without threading it through.
 */
export function Nav({
  me,
  current,
  /**
   * The queue page already has these numbers and they change as it is worked,
   * so it passes them down. Without that the badge is a snapshot from page
   * load: deliver a line and it still claims the old count, which is the same
   * stale-sibling problem the storefront header had.
   *
   * Omitted elsewhere, where the nav fetches them itself.
   */
  waiting: given,
  overdue: givenOverdue,
  /**
   * The same arrangement for the inbox, and for the same reason: the messages
   * screen changes this number by marking one answered, and a badge that
   * fetched on mount goes on claiming the old count beside a page that has
   * already updated.
   */
  messagesWaiting: givenMessages,
  messagesOverdue: givenMessagesOverdue,
  /** Same arrangement again, for the reviews the moderation screen is working. */
  reviewsPending: givenReviews,
}: {
  me: StaffMe;
  current:
    'products' | 'orders' | 'queue' | 'vault' | 'reviews' | 'messages' | 'payments' | 'redirects';
  waiting?: number;
  overdue?: number;
  messagesWaiting?: number;
  messagesOverdue?: number;
  reviewsPending?: number;
}) {
  const router = useRouter();
  const [fetched, setFetched] = useState<{ waiting: number; overdue: number } | null>(null);
  /**
   * Unanswered messages, always fetched here rather than passed in.
   *
   * Unlike the queue count, no screen owns this number: a message can arrive
   * while somebody is working the vault, and the tab is the only place that
   * would say so.
   */
  const [messages, setMessages] = useState<{ waiting: number; overdue: number } | null>(null);
  /**
   * Reviews waiting to be read.
   *
   * Unpublished until somebody looks at them, so a badge nobody sees is a
   * customer who wrote something the store never printed — which is the one
   * failure mode of moderating by default.
   */
  const [reviews, setReviews] = useState<number | null>(null);

  useEffect(() => {
    if (given !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const queue = await api.queue(false);
        if (cancelled) return;
        setFetched({
          waiting: queue.waiting,
          overdue: queue.rows.filter((row) => row.overdue).length,
        });
      } catch {
        // A badge that cannot load shows nothing. Nothing here depends on it,
        // and a role without access to the queue is a normal case.
        if (!cancelled) setFetched(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, given]);

  useEffect(() => {
    if (givenMessages !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const inbox = await api.messages(false);
        if (!cancelled) setMessages({ waiting: inbox.waiting, overdue: inbox.overdue });
      } catch {
        if (!cancelled) setMessages(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, givenMessages]);

  useEffect(() => {
    if (givenReviews !== undefined) return;

    let cancelled = false;
    void (async () => {
      try {
        const list = await api.reviews('PENDING');
        if (!cancelled) setReviews(list.counts.pending);
      } catch {
        if (!cancelled) setReviews(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, givenReviews]);

  const reviewsPending = givenReviews ?? reviews ?? null;
  const inboxWaiting = givenMessages ?? messages?.waiting ?? null;
  const inboxOverdue = givenMessagesOverdue ?? messages?.overdue ?? 0;
  const waiting = given ?? fetched?.waiting ?? null;
  const overdue = givenOverdue ?? fetched?.overdue ?? 0;

  return (
    <header className="bar">
      <nav className="admin-nav">
        <button
          type="button"
          className={`tab${current === 'products' ? ' is-active' : ''}`}
          onClick={() => router.push('/products')}
        >
          المنتجات
        </button>
        <button
          type="button"
          className={`tab${current === 'orders' ? ' is-active' : ''}`}
          onClick={() => router.push('/orders')}
        >
          الطلبات
        </button>
        <button
          type="button"
          className={`tab${current === 'vault' ? ' is-active' : ''}`}
          onClick={() => router.push('/vault')}
        >
          الخزنة
        </button>
        <button
          type="button"
          className={`tab${current === 'payments' ? ' is-active' : ''}`}
          onClick={() => router.push('/payments')}
        >
          طرق الدفع
        </button>
        <button
          type="button"
          className={`tab${current === 'redirects' ? ' is-active' : ''}`}
          onClick={() => router.push('/redirects')}
        >
          التوجيهات
        </button>
        <button
          type="button"
          className={`tab${current === 'messages' ? ' is-active' : ''}`}
          onClick={() => router.push('/messages')}
        >
          الرسائل
          {inboxWaiting !== null && inboxWaiting > 0 ? (
            <span className={`tab-count${inboxOverdue > 0 ? ' is-late' : ''}`}>{inboxWaiting}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`tab${current === 'reviews' ? ' is-active' : ''}`}
          onClick={() => router.push('/reviews')}
        >
          التقييمات
          {reviewsPending !== null && reviewsPending > 0 ? (
            <span className="tab-count">{reviewsPending}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`tab${current === 'queue' ? ' is-active' : ''}`}
          onClick={() => router.push('/queue')}
        >
          الطابور
          {waiting !== null && waiting > 0 ? (
            <span className={`tab-count${overdue > 0 ? ' is-late' : ''}`}>{waiting}</span>
          ) : null}
        </button>
      </nav>

      <div className="actions">
        <span className="who">
          {me.name} · {me.role}
        </span>
        <button type="button" className="ghost" onClick={() => router.push('/password')}>
          كلمة المرور
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void api.logout().then(() => router.push('/login'));
          }}
        >
          خروج
        </button>
      </div>
    </header>
  );
}
