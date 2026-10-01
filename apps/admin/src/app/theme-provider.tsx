'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  ADMIN_THEME_COOKIE,
  ADMIN_THEME_COOKIE_MAX_AGE,
  type AdminTheme,
  toAdminTheme,
} from './theme';

/**
 * The theme the server rendered, and the switch that changes it.
 *
 * The initial value comes from the layout, which read the cookie, so the
 * toggle shows the right icon on the first paint rather than guessing light
 * and correcting itself after hydration. Switching flips the attribute on
 * `<html>` at once — the stylesheet does the rest — and writes the cookie so
 * the next request starts the same way.
 */
const ThemeContext = createContext<{ theme: AdminTheme; toggle: () => void }>({
  theme: 'light',
  toggle: () => undefined,
});

export function AdminThemeProvider({
  theme: initial,
  children,
}: {
  theme: AdminTheme;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<AdminTheme>(initial);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: AdminTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.cookie = [
        `${ADMIN_THEME_COOKIE}=${next}`,
        'path=/',
        `max-age=${String(ADMIN_THEME_COOKIE_MAX_AGE)}`,
        'SameSite=Lax',
      ].join('; ');
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme: toAdminTheme(theme), toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAdminTheme() {
  return useContext(ThemeContext);
}
