'use client';

import { useT } from '../i18n/provider';

/** The mark above the sign-in and password forms: the panel's name, in its own language. */
export function AuthBrand() {
  const t = useT('nav');
  return (
    <div className="auth-brand">
      <span className="auth-brand-mark" aria-hidden="true">
        DA
      </span>
      <span>{t('panelTitle')}</span>
    </div>
  );
}
