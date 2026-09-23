'use client';

import type { PublicMarketing } from '@da/contracts';
import { createContext, type ReactNode, useContext } from 'react';

/**
 * The marketing settings, handed from a server layout to a client page.
 *
 * The checkout is a client component and cannot fetch with the server's
 * revalidating cache; its layout can. Passing the settings down this way costs
 * the visitor no extra request and keeps one source for them per render.
 */
const MarketingContext = createContext<PublicMarketing | null>(null);

export function MarketingProvider({
  value,
  children,
}: {
  value: PublicMarketing | null;
  children: ReactNode;
}) {
  return <MarketingContext.Provider value={value}>{children}</MarketingContext.Provider>;
}

/** Null when the settings could not be read, or outside a provider. */
export function useMarketing(): PublicMarketing | null {
  return useContext(MarketingContext);
}
