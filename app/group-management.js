'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calculateBalances, calculateShares, formatINR, localDateValue, suggestSettlements } from './expense-utils';

function initials(value) {
  return String(value || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export default function GroupManagement({ user }) {
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupExpenses, setGroupExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const requestLock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ name: '', amount: '', payerId: user.id, participantIds: [user.id], method: 'equal', values: {}, date: localDateValue() });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError('');
    const [groupResult, memberResult] = await Promise.all([
      supabase.from('groups').select('id, name, code, creator_id, created_at').order('created_at', { ascending: false }),
      supabase.from('group_members').select('group_id, user_id, display_name, role, created_at'),
    ]);
    if (groupResult.error || memberResult.error) {
      setError(`Groups are not available yet. Apply the supplied group-management migration and confirm its RLS policies are installed. ${groupResult.error?.message || memberResult.error?.message}`);
      setGroups([]);
      setMembers([]);
    } else {
      setGroups(groupResult.data || []);
      setMembers(memberResult.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  async function openGroup(group) {
    setLoading(true);
    setError('');
    setSelectedGroup(group);
    const [memberResult, expenseResult] = await Promise.all([
      supabase.from('group_members').select('group_id, user_id, display_name, role, created_at').eq('group_id', group.id).order('created_at', { ascending: true }),
      supabase.from('expenses').select('id, user_id, group_id, name, emoji, paid_by, paid_by_user_id, amount, created_at, expense_date').eq('group_id', group.id).order('created_at', { ascending: false }),
    ]);
    if (memberResult.error || expenseResult.error) {
      setError(`Could not load this group's details: ${memberResult.error?.message || expenseResult.error?.message}`);
      setLoading(false);
      return;
    }
    const expenseRows = expenseResult.data || [];
    const shareResult = expenseRows.length
      ? await supabase.from('expense_shares').select('expense_id, user_id, amount').in('expense_id', expenseRows.map((expense) => expense.id))
      : { data: [], error: null };
    if (shareResult.error) {
      setError(`Could not load expense shares: ${shareResult.error.message}`);
      setLoading(false);
      return;
    }
    const sharesByExpense = (shareResult.data || []).reduce((result, share) => {
      result[share.expense_id] ||= [];
      result[share.expense_id].push({ personId: share.user_id, amount: Number(share.amount) });
      return result;
    }, {});
    const groupMembers = memberResult.data || [];
    const mappedExpenses = expenseRows.map((row) => {
      const payer = groupMembers.find((member) => member.user_id === row.paid_by_user_id);
      const shares = sharesByExpense[row.id] || [];
      return {
        id: row.id,
        description: row.name,
        emoji: row.emoji || '🧾',
        amount: Number(row.amount),
        payerId: row.paid_by_user_id,
        paidBy: payer?.display_name || row.paid_by || 'Unknown',
        participantIds: shares.map((share) => share.personId),
        shares,
        splitMethod: 'equal',
        category: 'Other',
        date: row.expense_date || localDateValue(new Date(row.created_at)),
        splitsAvailable: shares.length > 0,
        authorId: row.user_id,
      };
    });
    setMembers(groupMembers);
    setGroupExpenses(mappedExpenses);
    setLoading(false);
  }

  async function createGroup(event) {
    event.preventDefault();
    if (busy || requestLock.current) return;
    const name = groupName.trim();
    if (name.length < 2 || name.length > 80) return setError('Group names must be 2 to 80 characters.');
    requestLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('create_group', { p_name: name });
      if (rpcError) return setError(`Could not create group: ${rpcError.message}`);
      setGroupName('');
      setNotice('Group created. Share its four-digit code with your members.');
      await loadGroups();
      const created = Array.isArray(data) ? data[0] : data;
      if (created?.id) await openGroup(created);
    } catch (requestError) {
      setError(`Could not create group: ${requestError.message || 'Network error.'}`);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function joinGroup(event) {
    event.preventDefault();
    if (busy || requestLock.current) return;
    if (!/^\d{4}$/.test(joinCode)) return setError('Enter all four digits from the group code.');
    requestLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcError } = await supabase.rpc('join_group_by_code', { p_code: joinCode });
      if (rpcError) return setError(`Could not join group: ${rpcError.message}`);
      if (!data?.ok) return setError(data?.message || 'That code could not be used.');
      setJoinCode('');
      setNotice(`You joined ${data.name}.`);
      await loadGroups();
      const joined = groups.find((group) => group.id === data.group_id) || { id: data.group_id, name: data.name, code: data.code };
      await openGroup(joined);
    } catch (requestError) {
      setError(`Could not join group: ${requestError.message || 'Network error.'}`);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  function beginExpense() {
    const myMember = members.find((member) => member.user_id === user.id);
    setExpenseForm({ name: '', amount: '', payerId: myMember?.user_id || user.id, participantIds: myMember ? [myMember.user_id] : [], method: 'equal', values: {}, date: localDateValue() });
    setExpenseOpen(true);
  }

  function toggleMember(memberId) {
    setExpenseForm((current) => {
      const participantIds = current.participantIds.includes(memberId) ? current.participantIds.filter((id) => id !== memberId) : [...current.participantIds, memberId];
      const values = { ...current.values };
      if (current.method === 'custom' && participantIds.length && Number(current.amount) > 0) {
        const evenShare = (Number(current.amount) / participantIds.length).toFixed(2);
        participantIds.forEach((id) => { if (values[id] === undefined) values[id] = evenShare; });
      }
      return { ...current, participantIds, values };
    });
  }

  async function saveGroupExpense(event) {
    event.preventDefault();
    if (busy || requestLock.current || !selectedGroup) return;
    if (!expenseForm.name.trim()) return setError('Enter a description for this expense.');
    let shares;
    try {
      shares = calculateShares(expenseForm.amount, expenseForm.participantIds, expenseForm.method, expenseForm.values);
    } catch (splitError) {
      return setError(splitError.message);
    }
    requestLock.current = true;
    setBusy(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('create_group_expense', {
        p_group_id: selectedGroup.id,
        p_name: expenseForm.name.trim(),
        p_emoji: '🧾',
        p_amount: Number(expenseForm.amount),
        p_paid_by_user_id: expenseForm.payerId,
        p_expense_date: expenseForm.date,
        p_shares: shares.map((share) => ({ user_id: share.personId, amount: share.amount })),
      });
      if (rpcError) return setError(`Could not add group expense: ${rpcError.message}`);
      setExpenseOpen(false);
      setNotice('Group expense added. Balances are updated.');
      await openGroup(selectedGroup);
      return data;
    } catch (requestError) {
      setError(`Could not add group expense: ${requestError.message || 'Network error.'}`);
      return undefined;
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function deleteGroupExpense() {
    if (!deleteTarget || busy || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    try {
      const { data, error: deleteError } = await supabase.from('expenses').delete().eq('id', deleteTarget.id).select('id').maybeSingle();
      if (deleteError) return setError(`Could not delete expense: ${deleteError.message}`);
      if (!data) return setError('This expense could not be deleted. It may belong to another member or your role may not allow deletion.');
      setDeleteTarget(null);
      setNotice('Group expense deleted. Balances are updated.');
      await openGroup(selectedGroup);
    } catch (requestError) {
      setError(`Could not delete expense: ${requestError.message || 'Network error.'}`);
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setNotice('Group code copied.');
    } catch {
      setNotice(`Group code: ${code}. Select and copy it to share.`);
    }
  }

  async function shareGroup(group) {
    const shareData = { title: `Join ${group.name} on SplitSmart`, text: `Join my SplitSmart group with code ${group.code}.` };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (shareError) { if (shareError.name !== 'AbortError') setNotice(`Share this code: ${group.code}`); }
    } else {
      await copyCode(group.code);
    }
  }

  const groupBalances = useMemo(() => calculateBalances(groupExpenses, members.map((member) => ({ id: member.user_id, name: member.display_name, isMe: member.user_id === user.id }))), [groupExpenses, members, user.id]);
  const groupSettlements = useMemo(() => suggestSettlements(groupBalances), [groupBalances]);
  const memberName = (id) => members.find((member) => member.user_id === id)?.display_name || 'Unknown member';

  return <div className="group-management">
    <div className="page-heading"><div><span className="eyebrow">SHARE TOGETHER</span><h1>Groups</h1><p>Create a circle or join one with its four-digit code.</p></div>{selectedGroup && <button className="button button-secondary" onClick={() => { setSelectedGroup(null); setError(''); }}>All groups</button>}</div>
    {error && <div className="database-notice" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="group-success" role="status"><span>✓</span>{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {loading && <section className="panel group-loading">Loading groups…</section>}
    {!loading && !selectedGroup && <>
      <div className="group-actions-grid"><section className="panel group-action-panel"><span className="group-action-icon">＋</span><h2>Create a group</h2><p>Start a group and invite people with a private code.</p><form onSubmit={createGroup}><label className="field">Group name<input value={groupName} onChange={(event) => setGroupName(event.target.value)} minLength={2} maxLength={80} placeholder="e.g. Flatmates or Goa Trip" required /></label><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button></form></section><section className="panel group-action-panel"><span className="group-action-icon join-icon">↗</span><h2>Join a group</h2><p>Enter the four-digit code shared by a group member.</p><form onSubmit={joinGroup}><label className="field">Group code<input className="group-code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" required /></label><button className="button button-secondary" disabled={busy || joinCode.length !== 4}>{busy ? 'Joining…' : 'Join group'}</button></form></section></div>
      <section className="panel group-list-panel"><div className="panel-heading"><div><span className="eyebrow">YOUR CIRCLES</span><h2>Your groups</h2></div><span className="count-pill">{groups.length} groups</span></div>{groups.length ? <div className="group-card-grid">{groups.map((group) => { const count = members.filter((member) => member.group_id === group.id).length; return <button className="group-card" key={group.id} onClick={() => openGroup(group)}><span className="group-card-mark">◉</span><span className="group-card-copy"><strong>{group.name}</strong><small>{count} {count === 1 ? 'member' : 'members'} · Code {group.code}</small></span><span className="group-card-arrow">→</span></button>; })}</div> : <div className="empty-state"><span className="empty-symbol">◉</span><h3>No groups yet</h3><p>Create a group or join one using a code.</p></div>}</section>
    </>}
    {!loading && selectedGroup && <>
      <section className="panel group-detail-header"><div className="group-detail-title"><span className="group-action-icon">◉</span><div><span className="eyebrow">GROUP SPACE</span><h2>{selectedGroup.name}</h2><p>{members.length} members · created {new Date(selectedGroup.created_at || Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div></div><div className="group-code-share"><span><small>INVITE CODE</small><strong>{selectedGroup.code}</strong></span><button className="button button-secondary" onClick={() => copyCode(selectedGroup.code)}>Copy code</button><button className="icon-button" title="Share group" aria-label="Share group" onClick={() => shareGroup(selectedGroup)}>↗</button></div></section>
      <div className="group-detail-grid"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">MEMBERS</span><h2>In this group</h2></div><span className="count-pill">{members.length}</span></div><div className="group-member-list">{members.map((member) => <div className="group-member-row" key={member.user_id}><span className="avatar">{initials(member.display_name)}</span><div><strong>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</strong><small>{member.role}</small></div><span className={(groupBalances[member.user_id] || 0) > 0.005 ? 'positive' : (groupBalances[member.user_id] || 0) < -0.005 ? 'negative' : 'neutral'}>{formatINR(groupBalances[member.user_id] || 0)}</span></div>)}</div></section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">BALANCES</span><h2>Who owes whom</h2></div></div>{groupSettlements.length ? <div className="settlement-list">{groupSettlements.map((settlement, index) => <div className="settlement-row" key={`${settlement.from}-${settlement.to}-${index}`}><span className="avatar avatar-small">{initials(memberName(settlement.from))}</span><div><strong>{settlement.from === user.id ? 'You' : memberName(settlement.from)} <span>owes</span> {settlement.to === user.id ? 'you' : memberName(settlement.to)}</strong><small>Suggested settlement</small></div><b>{formatINR(settlement.amount)}</b></div>)}</div> : <div className="settled-message"><span>✓</span><strong>Everyone is settled up.</strong><small>Balances update when expenses are added.</small></div>}</section></div>
      <section className="panel group-expenses-panel"><div className="panel-heading"><div><span className="eyebrow">SHARED COSTS</span><h2>Group expenses</h2></div><button className="button button-primary" onClick={beginExpense}>＋ Add group expense</button></div>{groupExpenses.length ? <div className="expense-list">{groupExpenses.map((expense) => <article className="expense-row" key={expense.id}><div className="expense-summary"><span className="category-mark">{expense.emoji}</span><span className="expense-description"><strong>{expense.description}</strong><small>{new Date(`${expense.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span></div><div className="expense-parties"><small>Paid by {expense.paidBy}</small><span>{expense.shares.map((share) => `${memberName(share.personId)} · ${formatINR(share.amount)}`).join(', ') || 'Split details unavailable'}</span></div><strong className="expense-amount">{formatINR(expense.amount)}</strong><button className="icon-button danger-icon" title="Delete expense" aria-label={`Delete ${expense.description}`} onClick={() => setDeleteTarget(expense)}>×</button></article>)}</div> : <div className="empty-state"><span className="empty-symbol">↗</span><h3>No shared expenses yet</h3><p>Add the first expense for this group.</p><button className="button button-primary" onClick={beginExpense}>Add group expense</button></div>}</section>
    </>}
    {expenseOpen && <div className="modal-shade" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setExpenseOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="group-expense-title"><div className="modal-header"><div><span className="eyebrow">{selectedGroup?.name}</span><h2 id="group-expense-title">Add group expense</h2></div><button className="icon-button close-button" aria-label="Close" onClick={() => setExpenseOpen(false)}>×</button></div><form onSubmit={saveGroupExpense}><div className="form-grid"><label className="field field-wide">Description<input autoFocus value={expenseForm.name} onChange={(event) => setExpenseForm((current) => ({ ...current, name: event.target.value }))} required maxLength={120} /></label><label className="field">Amount<input type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} required /></label><label className="field">Date<input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm((current) => ({ ...current, date: event.target.value }))} required /></label><label className="field field-wide">Paid by<select value={expenseForm.payerId} onChange={(event) => setExpenseForm((current) => ({ ...current, payerId: event.target.value }))}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</option>)}</select></label></div><fieldset className="participant-set"><legend>Participants</legend><div className="participant-grid">{members.map((member) => <label className={`participant-choice ${expenseForm.participantIds.includes(member.user_id) ? 'chosen' : ''}`} key={member.user_id}><input type="checkbox" checked={expenseForm.participantIds.includes(member.user_id)} onChange={() => toggleMember(member.user_id)} /><span className="avatar avatar-small">{initials(member.display_name)}</span>{member.display_name}</label>)}</div></fieldset><fieldset className="split-set"><legend>Split method</legend><div className="split-toggle"><button type="button" className={expenseForm.method === 'equal' ? 'selected' : ''} onClick={() => setExpenseForm((current) => ({ ...current, method: 'equal' }))}>Split equally</button><button type="button" className={expenseForm.method === 'custom' ? 'selected' : ''} onClick={() => setExpenseForm((current) => ({ ...current, method: 'custom' }))}>Custom amounts</button></div>{expenseForm.method === 'custom' && expenseForm.participantIds.map((id) => <label className="custom-split-row" key={id}><span>{memberName(id)}</span><div><span>₹</span><input type="number" min="0" step="0.01" value={expenseForm.values[id] ?? ''} onChange={(event) => setExpenseForm((current) => ({ ...current, values: { ...current.values, [id]: event.target.value } }))} aria-label={`${memberName(id)} share`} /></div></label>)}</fieldset><div className="modal-footer"><button type="button" className="button button-quiet" onClick={() => setExpenseOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save group expense'}</button></div></form></section></div>}
    {deleteTarget && <div className="modal-shade"><section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="group-delete-title"><div className="confirm-mark">!</div><h2 id="group-delete-title">Delete group expense?</h2><p><strong>{deleteTarget.description}</strong> will be deleted if your membership role allows it.</p><div className="modal-footer"><button className="button button-quiet" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="button button-danger" onClick={deleteGroupExpense} disabled={busy}>{busy ? 'Deleting…' : 'Delete expense'}</button></div></section></div>}
  </div>;
}
