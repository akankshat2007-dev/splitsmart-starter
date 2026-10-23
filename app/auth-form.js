'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasswordInput({ label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-field">{label}<span className="auth-password-wrap"><input type={visible ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} required minLength={8} /><button type="button" className="auth-reveal" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button></span><small>Use at least 8 characters.</small></label>;
}

export default function AuthForm({ mode }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(mode !== 'reset');

  useEffect(() => {
    if (mode !== 'reset') return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError || !data.session) setError('This password-reset link is invalid or expired. Request a new one to continue.');
      else setRecoveryReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setRecoveryReady(true);
        setError('');
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [mode]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    if (mode !== 'reset' && !EMAIL_PATTERN.test(normalizedEmail)) return setError('Enter a valid email address.');
    if (mode === 'signup' && fullName.trim().length < 2) return setError('Enter your full name.');
    if ((mode === 'signup' || mode === 'reset') && password !== confirmPassword) return setError('The passwords do not match.');
    if ((mode === 'signup' || mode === 'reset') && password.length < 8) return setError('Choose a password with at least 8 characters.');

    setBusy(true);
    try {
      if (mode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (authError) throw authError;
        router.replace('/');
        router.refresh();
      } else if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/` },
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace('/');
          router.refresh();
        } else {
          setMessage('Account created. Check your email to confirm your address, then sign in.');
        }
      } else if (mode === 'forgot') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (authError) throw authError;
        setMessage('If an account exists for this email, a password-reset link has been sent.');
      } else if (mode === 'reset') {
        if (!recoveryReady) throw new Error('Open a valid password-reset link before setting a new password.');
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        await supabase.auth.signOut();
        setMessage('Password updated. Sign in with your new password.');
        window.setTimeout(() => router.replace('/login'), 900);
      }
    } catch (authError) {
      setError(authError.message || 'Authentication could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const heading = {
    login: ['Welcome back', 'Sign in to your SplitSmart account.'],
    signup: ['Create your account', 'Start sharing expenses with your group.'],
    forgot: ['Reset your password', 'We’ll email you a secure reset link.'],
    reset: ['Choose a new password', 'Set a new password for your account.'],
  }[mode];

  return <main className="auth-page"><div className="auth-decoration" aria-hidden="true"><span>₹</span><i /><i /><i /></div><section className="auth-card"><Link href="/login" className="auth-brand"><span className="brand-mark">S</span><span className="brand-type">split<span>smart</span><small>SHARED, SIMPLIFIED</small></span></Link><span className="eyebrow">YOUR SHARED EXPENSES</span><h1>{heading[0]}</h1><p className="auth-intro">{heading[1]}</p><form onSubmit={submit} className="auth-form">
    {mode === 'signup' && <label className="auth-field">Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={2} /></label>}
    {(mode !== 'reset') && <label className="auth-field">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>}
    {(mode === 'login' || mode === 'signup' || mode === 'reset') && <PasswordInput label={mode === 'reset' ? 'New password' : 'Password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
    {(mode === 'signup' || mode === 'reset') && <PasswordInput label="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />}
    {mode === 'login' && <div className="auth-inline-link"><Link href="/forgot-password">Forgot password?</Link></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <button className="button button-primary auth-submit" disabled={busy || (mode === 'reset' && !recoveryReady)}>{busy ? 'Please wait…' : { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Update password' }[mode]}</button>
  </form><div className="auth-switch">{mode === 'login' && <>New to SplitSmart? <Link href="/signup">Create an account</Link></>}{mode === 'signup' && <>Already registered? <Link href="/login">Sign in</Link></>}{mode === 'forgot' && <>Remembered your password? <Link href="/login">Back to sign in</Link></>}{mode === 'reset' && <>Return to <Link href="/login">sign in</Link></>}</div><p className="auth-local-note">Your account is secured by Supabase authentication.</p></section></main>;
}
