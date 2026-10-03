'use client';

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { CloseIcon, FilterIcon } from './icons';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The filter panel, as the kit draws it: a button in the listing bar that
 * opens a sheet (`02_Components/*\/filter-sheet`) on every width — a panel
 * from the inline end on a wide screen, the full height on a phone. There is
 * no sidebar; nothing moves until "Show results", so the grid does not
 * reshuffle behind a sheet the shopper is still ticking.
 *
 * The form inside is server-rendered and works on its own — a GET form whose
 * every state is a URL — so this component only adds behaviour, never
 * content. Without JavaScript the "Filters" control is a plain link to
 * `#<id>` and the panel opens through `:target` in the stylesheet; with it,
 * the same link opens a real modal: `role="dialog"` and `aria-modal` while
 * open, focus moved in and trapped (Tab wraps), Escape and the backdrop close
 * it, and focus goes back to the control.
 */
export function FilterDrawer({
  id,
  buttonLabel,
  title,
  closeLabel,
  children,
}: {
  id: string;
  buttonLabel: string;
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLAnchorElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Drop a `#filters` a no-JS click or a shared link left behind, or the
    // `:target` rule would keep the panel open after this closes it.
    if (window.location.hash === `#${id}`) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    toggle.current?.focus();
  }, [id]);

  // Arriving on `…#filters` (the no-JS link, shared) opens the drawer properly.
  useEffect(() => {
    if (window.location.hash === `#${id}`) setOpen(true);
  }, [id]);

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      const head = items[0];
      const tail = items[items.length - 1];
      if (!head || !tail) return;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  return (
    <>
      <a
        ref={toggle}
        href={`#${id}`}
        className="btn btn-outline filter-toggle"
        aria-controls={id}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <FilterIcon />
        <span>{buttonLabel}</span>
      </a>

      {open ? <div className="filter-backdrop" aria-hidden="true" onClick={close} /> : null}

      <div
        ref={panel}
        id={id}
        className={`filter-panel${open ? ' is-open' : ''}`}
        {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId } : {})}
        onSubmit={() => {
          if (open) setOpen(false);
        }}
      >
        <div className="filter-panel-head">
          <h2 id={titleId}>{title}</h2>
          <a
            href="#"
            className="icon-button filter-close"
            aria-label={closeLabel}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
          >
            <CloseIcon />
          </a>
        </div>
        {children}
      </div>
    </>
  );
}
