'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export default function SessionControl() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) return;
    router.replace('/login');
    router.refresh();
  }

  if (!session || ['/login', '/signup', '/forgot-password', '/reset-password'].includes(pathname)) return null;
  return <button className="session-signout" onClick={signOut} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>;
}
