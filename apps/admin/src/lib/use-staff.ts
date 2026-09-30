'use client';

import type { StaffMe } from '@da/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from './api';

export function useStaff(): StaffMe | null {
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
        setMe(staff);
      } catch {
        router.push('/login');
      }
    })();
  }, [router]);

  return me;
}
