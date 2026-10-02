'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from './api';
import { canOpen, FALLBACK_SCREEN } from './roles';

/**
 * The signed-in staff member, or null while loading.
 *
 * Given a screen, a role that is not offered it (see `canOpen`) is sent to the
 * product list instead and this stays null, so the page never fires requests
 * the API would refuse. The API still enforces; this is presentation.
 */
export function useStaff(screen?: string): StaffMe | null {
  const router = useRouter();
  const [me, setMe] = useState<StaffMe | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const staff = await api.me();
        if (staff.mustChangePassword) {
          router.push('/password');
          return;
        }
        if (screen !== undefined && !canOpen(staff.role, screen)) {
          router.replace(FALLBACK_SCREEN);
          return;
        }
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router, screen]);

  return me;
}
