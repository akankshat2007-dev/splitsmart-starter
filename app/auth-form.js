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
  const [activeMode, setActiveMode] = useState(mode);
  const authMode = mode === 'login' || mode === 'signup' ? activeMode : mode;
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recoveryReady, setRecoveryReady] = useState(mode !== 'reset');

  useEffect(() => {
    if (authMode !== 'reset') return undefined;
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
  }, [authMode]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    if (authMode !== 'reset' && !EMAIL_PATTERN.test(normalizedEmail)) return setError('Enter a valid email address.');
    if (authMode === 'signup' && fullName.trim().length < 2) return setError('Enter your full name.');
    if ((authMode === 'signup' || authMode === 'reset') && password !== confirmPassword) return setError('The passwords do not match.');
    if ((authMode === 'signup' || authMode === 'reset') && password.length < 8) return setError('Choose a password with at least 8 characters.');

    setBusy(true);
    try {
      if (authMode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (authError) throw authError;
        window.location.assign('/');
      } else if (authMode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/` },
        });
        if (authError) throw authError;
        if (data.session) {
          window.location.assign('/');
        } else {
          setMessage('Account created. Check your email to confirm your address, then sign in.');
        }
      } else if (authMode === 'forgot') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (authError) throw authError;
        setMessage('If an account exists for this email, a password-reset link has been sent.');
      } else if (authMode === 'reset') {
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
  }[authMode];

  return <main className="auth-page"><div className="auth-decoration" aria-hidden="true"><span>₹</span><i /><i /><i /></div><section className="auth-card"><Link href="/login" className="auth-brand"><span className="brand-mark">S</span><span className="brand-type">split<span>smart</span><small>SHARED, SIMPLIFIED</small></span></Link><span className="eyebrow">YOUR SHARED EXPENSES</span>{(mode === 'login' || mode === 'signup') && <div className="auth-tabs" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'active' : ''} onClick={() => { setActiveMode('login'); setError(''); setMessage(''); }}>Login</button><button type="button" role="tab" aria-selected={authMode === 'signup'} className={authMode === 'signup' ? 'active' : ''} onClick={() => { setActiveMode('signup'); setError(''); setMessage(''); }}>Sign Up</button></div>}<h1>{heading[0]}</h1><p className="auth-intro">{heading[1]}</p><form onSubmit={submit} className="auth-form">
    {authMode === 'signup' && <label className="auth-field">Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={2} /></label>}
    {(authMode !== 'reset') && <label className="auth-field">Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>}
    {(authMode === 'login' || authMode === 'signup' || authMode === 'reset') && <PasswordInput label={authMode === 'reset' ? 'New password' : 'Password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} />}
    {(authMode === 'signup' || authMode === 'reset') && <PasswordInput label="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />}
    {authMode === 'login' && <div className="auth-inline-link"><Link href="/forgot-password">Forgot password?</Link></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
    <button className="button button-primary auth-submit" disabled={busy || (authMode === 'reset' && !recoveryReady)}>{busy ? 'Please wait…' : { login: 'Sign in', signup: 'Create account', forgot: 'Send reset link', reset: 'Update password' }[authMode]}</button>
  </form><div className="auth-switch">{authMode === 'login' && <>New to SplitSmart? <button type="button" onClick={() => { setActiveMode('signup'); setError(''); }}>Sign up</button></>}{authMode === 'signup' && <>Already registered? <button type="button" onClick={() => { setActiveMode('login'); setError(''); }}>Sign in</button></>}{authMode === 'forgot' && <>Remembered your password? <Link href="/login">Back to sign in</Link></>}{authMode === 'reset' && <>Return to <Link href="/login">sign in</Link></>}</div><p className="auth-local-note">Your account is secured by Supabase authentication.</p></section></main>;
}
