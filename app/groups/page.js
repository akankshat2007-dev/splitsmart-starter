'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GroupManagement from '../group-management';
import { supabase } from '../../lib/supabaseClient';

export default function GroupsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.user) {
        setStatus('unauthenticated');
        router.replace('/login');
        return;
      }
      setUser(data.user);
      setStatus('ready');
    }).catch(() => {
      if (!active) return;
      setStatus('unauthenticated');
      router.replace('/login');
    });
    return () => { active = false; };
  }, [router]);

  if (status !== 'ready') return <main className="loading-screen"><span className="brand-mark">S</span><span>{status === 'loading' ? 'Checking your session…' : 'Sign in to continue.'}</span></main>;
  return <main className="group-route-shell"><header className="group-route-topbar"><button className="brand-lockup" onClick={() => router.push('/')}><span className="brand-mark">S</span><span className="brand-type">split<span>smart</span><small>SHARED, SIMPLIFIED</small></span></button><button className="button button-secondary" onClick={() => router.push('/')}>Expense dashboard</button></header><GroupManagement key={user.id} user={user} /><footer className="page-footer">SplitSmart <span>·</span> Shared, simplified.</footer></main>;
}
