'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import AuthForm from './auth-form';
import GroupManagement from './group-management';
import {
  calculateBalances,
  calculateShares,
  CATEGORIES,
  formatINR,
  loadExpenseDetails,
  loadPeople,
  localDateValue,
  makeExpenseUuid,
  makeId,
  mapDatabaseExpense,
  saveExpenseDetails,
  savePeople,
  suggestSettlements,
} from './expense-utils';

const NAV_ITEMS = [
  { id: 'dashboard', icon: '▦', label: 'Dashboard' },
  { id: 'expenses', icon: '↗', label: 'Expenses' },
  { id: 'groups', icon: '◉', label: 'Groups' },
  { id: 'people', icon: '♧', label: 'People' },
  { id: 'settlements', icon: '⇄', label: 'Settlements' },
];
const EMPTY_FORM = { description: '', amount: '', payerId: '', participantIds: [], splitMethod: 'equal', splitValues: {}, category: 'Other', date: localDateValue() };

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function makeForm(people) {
  const me = people.find((person) => person.isMe) || people[0];
  return { ...EMPTY_FORM, date: localDateValue(), payerId: me?.id || '', participantIds: me ? [me.id] : [] };
}

export default function Home() {
  const router = useRouter();
  const [expenses, setExpenses] = useState([]);
  const [people, setPeople] = useState([]);
  const [authUser, setAuthUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [authStatus, setAuthStatus] = useState('loading');
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [databaseError, setDatabaseError] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState(false);
  const expenseRequestLock = useRef(false);
  const deleteRequestLock = useRef(false);
  const [view, setView] = useState('dashboard');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [formError, setFormError] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All categories');
  const [sortBy, setSortBy] = useState('date-newest');
  const [detail, setDetail] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [personName, setPersonName] = useState('');
  const [editingPersonId, setEditingPersonId] = useState('');
  const [personDeleteTarget, setPersonDeleteTarget] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const initialPeople = loadPeople();
    setPeople(initialPeople);
    let active = true;

    async function loadExpenses() {
      setLoadingExpenses(true);
      setDatabaseError('');
      let authResult;
      try {
        authResult = await supabase.auth.getUser();
      } catch (error) {
        if (!active) return;
        setAuthStatus('error');
        setDatabaseError(`Could not verify your Supabase session: ${error.message || 'Network error.'}`);
        setLoadingExpenses(false);
        setLoaded(true);
        return;
      }
      const { data: { user }, error: authError } = authResult;
      if (!active) return;
      if (authError) {
        setAuthStatus('error');
        setDatabaseError(`Could not verify your Supabase session: ${authError.message}`);
        setLoadingExpenses(false);
        setLoaded(true);
        return;
      }
      if (!user) {
        setAuthStatus('unauthenticated');
        setExpenses([]);
        setDatabaseError('No authenticated Supabase session. Sign in through the app’s Supabase auth flow before using the expenses table.');
        setToast('Supabase sign-in is required to load expenses. No user ID was guessed.');
        setLoadingExpenses(false);
        setLoaded(true);
        return;
      }

      setAuthStatus('authenticated');
      setAuthUser(user);
      let queryResult;
      try {
        queryResult = await supabase
          .from('expenses')
          .select('id, user_id, group_id, name, emoji, paid_by, amount, created_at')
          .eq('user_id', user.id)
          .is('group_id', null)
          .order('created_at', { ascending: false });
      } catch (error) {
        if (!active) return;
        const message = `Could not load expenses: ${error.message || 'Network error.'}`;
        setDatabaseError(message);
        setToast(message);
        setExpenses([]);
        setLoadingExpenses(false);
        setLoaded(true);
        return;
      }
      const { data, error } = queryResult;
      if (!active) return;
      if (error) {
        const message = `Could not load expenses: ${error.message}`;
        setDatabaseError(message);
        setToast(message);
        setExpenses([]);
      } else {
        const details = loadExpenseDetails();
        const mapped = (data || []).map((row) => mapDatabaseExpense(row, initialPeople, details));
        const payerPeople = mapped
          .filter((expense) => !initialPeople.some((person) => person.name.toLowerCase() === expense.paidBy.toLowerCase()))
          .map((expense) => ({ id: expense.payerId, name: expense.paidBy, isMe: false, isSample: false }));
        const mergedPeople = [...initialPeople, ...payerPeople.filter((person, index) => payerPeople.findIndex((candidate) => candidate.id === person.id) === index)];
        setPeople(mergedPeople);
        setExpenses(mapped.map((expense) => ({
          ...expense,
          payerId: mergedPeople.find((person) => person.name.toLowerCase() === expense.paidBy.toLowerCase())?.id || expense.payerId,
        })));
      }
      setLoadingExpenses(false);
      setLoaded(true);
    }

    loadExpenses();
    return () => { active = false; };
  }, [reloadToken]);

  useEffect(() => {
    if (loaded && !savePeople(people)) setToast('Could not save participants on this device.');
  }, [people, loaded]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (view === 'groups') router.push('/groups');
  }, [view, router]);

  const balances = useMemo(() => calculateBalances(expenses, people), [expenses, people]);
  const settlements = useMemo(() => suggestSettlements(balances), [balances]);
  const me = people.find((person) => person.isMe) || people[0];
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expensesWithoutSplitDetails = expenses.filter((expense) => expense.splitsAvailable === false).length;
  const paidByMe = expenses.filter((expense) => expense.payerId === me?.id).reduce((sum, expense) => sum + expense.amount, 0);
  const myShare = expenses.reduce((sum, expense) => sum + (expense.shares.find((share) => share.personId === me?.id)?.amount || 0), 0);
  const myBalance = me ? balances[me.id] || 0 : 0;
  const owe = Math.max(0, -myBalance);
  const owedToMe = Math.max(0, myBalance);
  const nameOf = (id) => people.find((person) => person.id === id)?.name || 'Unknown';

  function openNewExpense() {
    setForm(makeForm(people));
    setEditingId('');
    setFormError('');
    setFormOpen(true);
  }

  function openEditExpense(expense) {
    setForm({ ...makeForm(people), ...expense, splitValues: Object.fromEntries(expense.shares.map((share) => [share.personId, share.amount.toFixed(2)])) });
    setEditingId(expense.id);
    setFormError('');
    setDetail(null);
    setFormOpen(true);
  }

  function toggleParticipant(id) {
    setForm((current) => {
      const participantIds = current.participantIds.includes(id) ? current.participantIds.filter((personId) => personId !== id) : [...current.participantIds, id];
      const splitValues = { ...current.splitValues };
      if (current.splitMethod === 'custom' && participantIds.length && Number(current.amount) > 0) {
        const evenAmount = (Number(current.amount) / participantIds.length).toFixed(2);
        participantIds.forEach((personId) => { if (splitValues[personId] === undefined) splitValues[personId] = evenAmount; });
      }
      return { ...current, participantIds, splitValues };
    });
  }

  async function submitExpense(event) {
    event.preventDefault();
    if (expenseRequestLock.current) return;
    setFormError('');
    if (!form.description.trim()) return setFormError('Enter an expense description.');
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) return setFormError('Amount must be greater than zero.');
    if (!form.payerId) return setFormError('Choose who paid for this expense.');
    let shares;
    try {
      shares = calculateShares(form.amount, form.participantIds, form.splitMethod, form.splitValues);
    } catch (error) {
      return setFormError(error.message);
    }
    const expense = {
      id: editingId || '',
      description: form.description.trim(),
      amount: Math.round(Number(form.amount) * 100) / 100,
      payerId: form.payerId,
      participantIds: [...form.participantIds],
      shares,
      splitMethod: form.splitMethod,
      category: form.category,
      date: form.date || localDateValue(),
    };
    expenseRequestLock.current = true;
    setSavingExpense(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setFormError(authError?.message || 'Sign in to Supabase before saving expenses.');
        setAuthStatus(authError ? 'error' : 'unauthenticated');
        return;
      }

      const record = {
        name: expense.description,
        emoji: '🧾',
        paid_by: nameOf(expense.payerId),
        amount: expense.amount,
        created_at: new Date(`${expense.date}T12:00:00`).toISOString(),
      };
      const result = editingId
        ? await supabase.from('expenses').update(record).eq('id', editingId).eq('user_id', user.id).is('group_id', null).select('id, user_id, group_id, name, emoji, paid_by, amount, created_at').single()
        : await supabase.from('expenses').insert({ ...record, id: makeExpenseUuid(), user_id: user.id }).select('id, user_id, group_id, name, emoji, paid_by, amount, created_at').single();

      if (result.error) {
        setFormError(`Could not ${editingId ? 'update' : 'save'} this expense: ${result.error.message}`);
        return;
      }

      const savedExpense = { ...mapDatabaseExpense(result.data, people, {}), ...expense, id: result.data.id, splitsAvailable: true };
      const allDetails = loadExpenseDetails();
      const nextDetails = {
        ...allDetails,
        [result.data.id]: { participantIds: expense.participantIds, shares: expense.shares, splitMethod: expense.splitMethod, category: expense.category },
      };
      if (!saveExpenseDetails(nextDetails)) setToast('Expense saved, but split details could not be saved in this browser.');
      setExpenses((current) => editingId ? current.map((item) => item.id === editingId ? savedExpense : item) : [savedExpense, ...current]);
      setFormOpen(false);
      setEditingId('');
      setDatabaseError('');
      if (authStatus !== 'authenticated') setAuthStatus('authenticated');
      setToast(editingId ? 'Expense updated.' : 'Expense added.');
    } catch (error) {
      setFormError(`Could not save this expense: ${error.message || 'Unexpected database error.'}`);
    } finally {
      expenseRequestLock.current = false;
      setSavingExpense(false);
    }
  }

  async function confirmDeleteExpense() {
    if (!deleteTarget || deleteRequestLock.current) return;
    deleteRequestLock.current = true;
    setDeletingExpense(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        const message = authError?.message || 'Sign in to Supabase before deleting expenses.';
        setDatabaseError(message);
        setToast(message);
        setAuthStatus(authError ? 'error' : 'unauthenticated');
        return;
      }
      const { data, error } = await supabase.from('expenses').delete().eq('id', deleteTarget.id).eq('user_id', user.id).is('group_id', null).select('id').maybeSingle();
      if (error) {
        const message = `Could not delete expense: ${error.message}`;
        setDatabaseError(message);
        setToast(message);
        return;
      }
      if (!data) {
        const message = 'No matching expense was deleted. It may not belong to the signed-in user or may already be removed.';
        setDatabaseError(message);
        setToast(message);
        return;
      }
      setExpenses((current) => current.filter((expense) => expense.id !== deleteTarget.id));
      const allDetails = loadExpenseDetails();
      delete allDetails[deleteTarget.id];
      saveExpenseDetails(allDetails);
      setDeleteTarget(null);
      setDetail(null);
      setDatabaseError('');
      setToast('Expense deleted.');
    } catch (error) {
      setDatabaseError(`Could not delete expense: ${error.message || 'Unexpected database error.'}`);
    } finally {
      deleteRequestLock.current = false;
      setDeletingExpense(false);
    }
  }

  function savePerson(event) {
    event.preventDefault();
    const name = personName.trim();
    if (!name) return;
    const duplicate = people.some((person) => person.name.toLowerCase() === name.toLowerCase() && person.id !== editingPersonId);
    if (duplicate) return setToast('A participant with that name already exists.');
    if (editingPersonId) {
      setPeople((current) => current.map((person) => person.id === editingPersonId ? { ...person, name } : person));
      setEditingPersonId('');
    } else {
      setPeople((current) => [...current, { id: makeId(), name, isMe: false, isSample: false }]);
    }
    setPersonName('');
  }

  function editPerson(person) {
    setEditingPersonId(person.id);
    setPersonName(person.name);
  }

  function deletePerson() {
    if (!personDeleteTarget) return;
    setPeople((current) => current.filter((person) => person.id !== personDeleteTarget.id));
    setPersonDeleteTarget(null);
    setToast('Participant removed.');
  }

  function resetSamplePeople() {
    const samples = [
      { id: 'person-rahul', name: 'Rahul', isMe: false, isSample: true },
      { id: 'person-priya', name: 'Priya', isMe: false, isSample: true },
      { id: 'person-aisha', name: 'Aisha', isMe: false, isSample: true },
    ];
    setPeople((current) => {
      const retained = current.filter((person) => !person.isSample);
      return [...retained, ...samples.filter((sample) => !retained.some((person) => person.name.toLowerCase() === sample.name.toLowerCase()))];
    });
    setToast('Sample participants restored.');
  }

  function removeSamplePeople() {
    const used = new Set(expenses.flatMap((expense) => [expense.payerId, ...expense.participantIds]));
    const protectedSamples = people.filter((person) => person.isSample && used.has(person.id));
    if (protectedSamples.length) {
      setToast(`Sample participants in saved expenses cannot be removed: ${protectedSamples.map((person) => person.name).join(', ')}. Edit those expenses first.`);
      return;
    }
    setPeople((current) => current.filter((person) => !person.isSample));
    setToast('Unused sample participants removed.');
  }

  const filteredExpenses = expenses.filter((expense) => {
    const matchesQuery = expense.description.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (categoryFilter === 'All categories' || expense.category === categoryFilter);
  }).sort((first, second) => sortBy === 'amount-high' ? second.amount - first.amount : sortBy === 'amount-low' ? first.amount - second.amount : sortBy === 'date-oldest' ? new Date(first.date) - new Date(second.date) : new Date(second.date) - new Date(first.date));

  function expenseRows(items) {
    if (!items.length) return <div className="empty-state"><span className="empty-symbol">↗</span><h3>No expenses yet</h3><p>Add your first shared expense to get started.</p><button className="button button-primary" onClick={openNewExpense}>Add expense</button></div>;
    return <div className="expense-list">{items.map((expense) => <article className="expense-row" key={expense.id}><button className="expense-summary" onClick={() => setDetail(expense)}><span className={`category-mark category-${expense.category.toLowerCase()}`}>{expense.category === 'Food' || expense.category === 'Groceries' ? '✳' : expense.category === 'Travel' ? '↗' : expense.category === 'Bills' ? '▤' : '◇'}</span><span className="expense-description"><strong>{expense.description}</strong><small>{new Date(`${expense.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {expense.category}</small></span></button><div className="expense-parties"><small>Paid by {nameOf(expense.payerId)}</small><span>{expense.participantIds.map(nameOf).join(', ')}</span></div><strong className="expense-amount">{formatINR(expense.amount)}</strong><div className="expense-actions"><button className="icon-button" aria-label={`View ${expense.description}`} title="View details" onClick={() => setDetail(expense)}>⌕</button><button className="icon-button" aria-label={`Edit ${expense.description}`} title="Edit expense" onClick={() => openEditExpense(expense)}>✎</button></div></article>)}</div>;
  }

  function dashboard() {
    const recent = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    return <><div className="page-heading"><div><span className="eyebrow">YOUR SHARED EXPENSES</span><h1>Dashboard</h1><p>A clear view of what your group has spent.</p></div><button className="button button-primary" onClick={openNewExpense}><span>＋</span> Add Expense</button></div><section className="summary-grid"><article className="summary-card summary-feature"><span className="summary-caption">TOTAL EXPENSES</span><strong>{formatINR(total)}</strong><small>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} recorded</small><span className="feature-mark">₹</span></article><article className="summary-card"><span className="summary-icon green">↑</span><span className="summary-caption">YOU PAID</span><strong>{formatINR(paidByMe)}</strong><small>Total paid by you</small></article><article className="summary-card"><span className="summary-icon gold">◷</span><span className="summary-caption">YOUR SHARE</span><strong>{formatINR(myShare)}</strong><small>Your share of expenses</small></article><article className="summary-card"><span className={`summary-icon ${myBalance < -0.005 ? 'red' : 'green'}`}>{myBalance < -0.005 ? '↓' : '↑'}</span><span className="summary-caption">{myBalance < -0.005 ? 'YOU OWE' : 'OWED TO YOU'}</span><strong>{formatINR(myBalance < -0.005 ? owe : owedToMe)}</strong><small>Net balance with everyone</small></article></section><div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">LATEST ACTIVITY</span><h2>Recent expenses</h2></div><button className="text-button" onClick={() => setView('expenses')}>All expenses <span>→</span></button></div>{expenseRows(recent)}</section><section className="panel balance-panel"><div className="panel-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>Settlement</h2></div><button className="text-button" onClick={() => setView('settlements')}>Details →</button></div>{settlements.length ? <div className="settlement-list">{settlements.slice(0, 4).map((item, index) => <div className="settlement-row" key={`${item.from}-${item.to}-${index}`}><span className="avatar">{initials(nameOf(item.from))}</span><div><strong>{item.from === me?.id ? 'You' : nameOf(item.from)} <span>owes</span> {item.to === me?.id ? 'you' : nameOf(item.to)}</strong><small>Suggested settlement</small></div><b>{formatINR(item.amount)}</b></div>)}</div> : <div className="settled-message"><span>✓</span><strong>You are settled up.</strong><small>No payments are due right now.</small></div>}</section></div></>;
  }

  function expensesView() {
    return <><div className="page-heading"><div><span className="eyebrow">ALL TRANSACTIONS</span><h1>Expenses</h1><p>Find, review, and update shared costs.</p></div><button className="button button-primary" onClick={openNewExpense}><span>＋</span> Add Expense</button></div><section className="panel expense-browser"><div className="filter-bar"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by description" aria-label="Search expenses" /></label><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option>All categories</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort expenses"><option value="date-newest">Newest first</option><option value="date-oldest">Oldest first</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option></select></div>{expenseRows(filteredExpenses)}</section></>;
  }

  function peopleView() {
    return <><div className="page-heading"><div><span className="eyebrow">YOUR CIRCLE</span><h1>People</h1><p>Manage people in your shared expenses.</p></div></div><section className="panel people-panel"><div className="panel-heading"><div><span className="eyebrow">PARTICIPANTS</span><h2>Your people</h2></div><span className="count-pill">{people.length} people</span></div><form className="inline-form" onSubmit={savePerson}><label className="sr-only" htmlFor="participant-name">Participant name</label><input id="participant-name" value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="Add a participant" required /><button className="button button-primary">{editingPersonId ? 'Save changes' : 'Add person'}</button>{editingPersonId && <button type="button" className="button button-secondary" onClick={() => { setEditingPersonId(''); setPersonName(''); }}>Cancel</button>}</form><div className="person-list">{people.map((person) => { const used = expenses.some((expense) => expense.payerId === person.id || expense.participantIds.includes(person.id)); return <article className="person-row" key={person.id}><span className="avatar">{initials(person.name)}</span><div className="person-copy"><strong>{person.name}{person.isMe && <span className="you-label">You</span>}{person.isSample && <span className="sample-label">Sample</span>}</strong><small>Net balance <b className={(balances[person.id] || 0) >= 0 ? 'positive' : 'negative'}>{formatINR(balances[person.id] || 0)}</b></small></div>{!person.isMe && <div className="person-actions"><button className="button button-secondary" onClick={() => editPerson(person)}>Edit</button><button className="icon-button danger-icon" aria-label={`Remove ${person.name}`} title="Remove participant" onClick={() => used ? setToast(`${person.name} is in saved expenses. Edit those expenses before removing this participant.`) : setPersonDeleteTarget(person)}>×</button></div>}</article>; })}</div><div className="sample-tools"><div><strong>Demo participants</strong><p>Rahul, Priya, and Aisha are optional sample people.</p></div><div><button className="button button-secondary" onClick={resetSamplePeople}>Reset samples</button><button className="button button-quiet" onClick={removeSamplePeople}>Remove unused samples</button></div></div></section></>;
  }

  function settlementsView() {
    return <><div className="page-heading"><div><span className="eyebrow">SIMPLE AND FAIR</span><h1>Settlements</h1><p>Net balances and a shorter path to settle up.</p></div></div><section className="panel settlement-panel"><div className="panel-heading"><div><span className="eyebrow">SUGGESTED TRANSFERS</span><h2>Settle with fewer payments</h2></div><span className="count-pill">{settlements.length} transfers</span></div>{settlements.length ? <div className="settlement-list settlement-large">{settlements.map((item, index) => <div className="settlement-row" key={`${item.from}-${item.to}-${index}`}><span className="avatar">{initials(nameOf(item.from))}</span><div><strong>{item.from === me?.id ? 'You' : nameOf(item.from)} <span>pays</span> {item.to === me?.id ? 'you' : nameOf(item.to)}</strong><small>Suggested transfer from net balances</small></div><b>{formatINR(item.amount)}</b></div>)}</div> : <div className="settled-message"><span>✓</span><strong>You are settled up.</strong><small>Everyone’s net balance is even.</small></div>}</section><section className="panel balance-panel"><div className="panel-heading"><div><span className="eyebrow">PARTICIPANT TOTALS</span><h2>Net balances</h2></div></div><div className="net-balance-list">{people.map((person) => { const balance = balances[person.id] || 0; return <div className="net-balance-row" key={person.id}><span className="avatar">{initials(person.name)}</span><strong>{person.name}{person.isMe ? ' (you)' : ''}</strong><span className={balance > 0.005 ? 'positive' : balance < -0.005 ? 'negative' : 'neutral'}>{balance > 0.005 ? `Gets back ${formatINR(balance)}` : balance < -0.005 ? `Owes ${formatINR(-balance)}` : 'Settled'}</span></div>; })}</div></section></>;
  }

  function expenseForm() {
    if (!formOpen) return null;
    return <div className="modal-shade" onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title"><div className="modal-header"><div><span className="eyebrow">{editingId ? 'UPDATE EXPENSE' : 'NEW EXPENSE'}</span><h2 id="expense-modal-title">{editingId ? 'Edit expense' : 'Add an expense'}</h2></div><button className="icon-button close-button" aria-label="Close" onClick={() => setFormOpen(false)}>×</button></div><form onSubmit={submitExpense}><div className="form-grid"><label className="field field-wide">Description<input autoFocus value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="e.g. Dinner" required /></label><label className="field">Total amount<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="₹ 0.00" required /></label><label className="field">Category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label className="field">Paid by<select value={form.payerId} onChange={(event) => setForm((current) => ({ ...current, payerId: event.target.value }))} required>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.isMe ? ' (you)' : ''}</option>)}</select></label><label className="field">Date<input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} required /></label></div><fieldset className="participant-set"><legend>Participants sharing this expense</legend><div className="participant-grid">{people.map((person) => <label className={`participant-choice ${form.participantIds.includes(person.id) ? 'chosen' : ''}`} key={person.id}><input type="checkbox" checked={form.participantIds.includes(person.id)} onChange={() => toggleParticipant(person.id)} /><span className="avatar avatar-small">{initials(person.name)}</span><span>{person.name}{person.isMe ? ' (you)' : ''}</span></label>)}</div></fieldset><fieldset className="split-set"><legend>Split method</legend><div className="split-toggle"><button type="button" className={form.splitMethod === 'equal' ? 'selected' : ''} onClick={() => setForm((current) => ({ ...current, splitMethod: 'equal' }))}>Split equally</button><button type="button" className={form.splitMethod === 'custom' ? 'selected' : ''} onClick={() => setForm((current) => ({ ...current, splitMethod: 'custom' }))}>Custom amounts</button></div>{form.splitMethod === 'custom' && <div className="custom-split-list">{form.participantIds.map((id) => <label className="custom-split-row" key={id}><span>{nameOf(id)}</span><div><span>₹</span><input type="number" min="0" step="0.01" value={form.splitValues?.[id] ?? ''} onChange={(event) => setForm((current) => ({ ...current, splitValues: { ...current.splitValues, [id]: event.target.value } }))} aria-label={`${nameOf(id)} share in rupees`} /></div></label>)}</div>}{form.splitMethod === 'equal' && form.participantIds.length && Number(form.amount) > 0 ? <p className="split-preview">{form.participantIds.map((id) => `${nameOf(id)}: ${formatINR(Number(form.amount) / form.participantIds.length)}`).join(' · ')}. Any paise remainder is distributed fairly.</p> : null}</fieldset>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="modal-footer"><button type="button" className="button button-quiet" onClick={() => setFormOpen(false)}>Cancel</button><button className="button button-primary">{editingId ? 'Save changes' : 'Save expense'}</button></div></form></section></div>;
  }

  if (!loaded || loadingExpenses) return <main className="loading-screen"><span className="brand-mark">S</span><span>Checking your Supabase session and loading expenses…</span></main>;
  if (authStatus !== 'authenticated') return <AuthForm mode="login" />;

  return <main className="app-shell"><aside className="sidebar"><button className="brand-lockup" onClick={() => setView('dashboard')}><span className="brand-mark">S</span><span className="brand-type">split<span>smart</span><small>SHARED, SIMPLIFIED</small></span></button><span className="nav-caption">YOUR SPACE</span><nav className="side-nav" aria-label="Main navigation">{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === 'settlements' && settlements.length > 0 && <span className="nav-count">{settlements.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="saved-indicator"><span /> Saved in this browser</div><div className="account-chip"><span className="avatar">{initials(me?.name || 'Me')}</span><div><strong>{me?.name || 'Me'}</strong><small>Personal account</small></div></div></div></aside><section className="main-area"><header className="topbar"><div><span>Workspace</span><b>/</b><strong>{NAV_ITEMS.find((item) => item.id === view)?.label}</strong></div><span className="local-badge"><i /> Supabase</span></header><div className="page-content">{databaseError && <div className="database-notice" role="alert"><span>{databaseError}</span><button className="button button-secondary" onClick={() => { setLoaded(false); setLoadingExpenses(true); setReloadToken((current) => current + 1); }}>Retry</button></div>}{expensesWithoutSplitDetails > 0 && <div className="database-notice split-notice" role="status"><span>{expensesWithoutSplitDetails} expense(s) have no split details in the supplied database schema. Their totals are shown, but they are excluded from settlement calculations. Split details are kept only in this browser.</span></div>}{view === 'dashboard' && dashboard()}{view === 'expenses' && expensesView()}{view === 'people' && peopleView()}{view === 'settlements' && settlementsView()}</div><footer className="page-footer">SplitSmart <span>·</span> Shared, simplified.</footer></section><nav className="mobile-nav" aria-label="Mobile navigation">{NAV_ITEMS.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
    {expenseForm()}{detail && <div className="modal-shade" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="modal-header"><div><span className="eyebrow">EXPENSE DETAILS</span><h2 id="detail-title">{detail.description}</h2></div><button className="icon-button close-button" aria-label="Close" onClick={() => setDetail(null)}>×</button></div><div className="detail-total">{formatINR(detail.amount)}<span>{detail.category}</span></div><div className="detail-facts"><div><small>Paid by</small><strong>{nameOf(detail.payerId)}</strong></div><div><small>Date</small><strong>{new Date(`${detail.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div><div><small>Split</small><strong>{detail.splitMethod === 'custom' ? 'Custom amounts' : 'Equal'}</strong></div></div><h3 className="share-title">Individual shares</h3><div className="detail-share-list">{detail.shares.map((share) => <div key={share.personId}><span className="avatar avatar-small">{initials(nameOf(share.personId))}</span><span>{nameOf(share.personId)}</span><strong>{formatINR(share.amount)}</strong></div>)}</div><div className="modal-footer spread"><button className="button button-danger" onClick={() => setDeleteTarget(detail)}>Delete</button><div><button className="button button-quiet" onClick={() => setDetail(null)}>Close</button><button className="button button-primary" onClick={() => openEditExpense(detail)}>Edit expense</button></div></div></section></div>}{deleteTarget && <div className="modal-shade"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-expense-title"><div className="confirm-mark">!</div><h2 id="delete-expense-title">Delete this expense?</h2><p><strong>{deleteTarget.description}</strong> will be removed and all balances will be recalculated.</p><div className="modal-footer"><button className="button button-quiet" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="button button-danger" onClick={confirmDeleteExpense}>Delete expense</button></div></section></div>}{personDeleteTarget && <div className="modal-shade"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-person-title"><div className="confirm-mark">!</div><h2 id="delete-person-title">Remove {personDeleteTarget.name}?</h2><p>This participant has no saved expenses. They will be removed from your people list.</p><div className="modal-footer"><button className="button button-quiet" onClick={() => setPersonDeleteTarget(null)}>Cancel</button><button className="button button-danger" onClick={deletePerson}>Remove participant</button></div></section></div>}{toast && <div className="toast" role="status"><span>✓</span>{toast}<button aria-label="Dismiss" onClick={() => setToast('')}>×</button></div>}</main>;
}
