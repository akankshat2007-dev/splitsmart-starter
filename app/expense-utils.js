export const STORAGE_KEYS = {
  expenses: 'splitsmart.expenses',
  people: 'splitsmart.people',
  expenseDetails: 'splitsmart.expense-details',
};

export const CATEGORIES = ['Food', 'Travel', 'Shopping', 'Bills', 'Groceries', 'Other'];

export const formatINR = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

export const makeId = () => `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function localDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function readArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadPeople() {
  const savedPeople = readArray(STORAGE_KEYS.people);
  const people = (savedPeople || [
    { id: 'person-me', name: 'Me', isMe: true, isSample: false },
    { id: 'person-rahul', name: 'Rahul', isMe: false, isSample: true },
    { id: 'person-priya', name: 'Priya', isMe: false, isSample: true },
    { id: 'person-aisha', name: 'Aisha', isMe: false, isSample: true },
  ]).filter((person) => person && typeof person.id === 'string' && typeof person.name === 'string');
  if (!people.some((person) => person.isMe)) people.unshift({ id: 'person-me', name: 'Me', isMe: true, isSample: false });
  return people;
}

export function savePeople(people) {
  try {
    localStorage.setItem(STORAGE_KEYS.people, JSON.stringify(people));
    return true;
  } catch {
    return false;
  }
}

export function loadExpenseDetails() {
  try {
    const details = JSON.parse(localStorage.getItem(STORAGE_KEYS.expenseDetails) || '{}');
    return details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  } catch {
    return {};
  }
}

export function saveExpenseDetails(details) {
  try {
    localStorage.setItem(STORAGE_KEYS.expenseDetails, JSON.stringify(details));
    return true;
  } catch {
    return false;
  }
}

export function mapDatabaseExpense(row, people, details = {}) {
  const candidate = details[row.id];
  const detail = candidate && Array.isArray(candidate.participantIds) && Array.isArray(candidate.shares) ? candidate : null;
  const paidBy = String(row.paid_by || 'Unknown');
  const payer = people.find((person) => person.name.toLowerCase() === paidBy.toLowerCase());
  const createdAt = new Date(row.created_at);
  const isValidDate = Number.isFinite(createdAt.getTime());
  return {
    id: row.id,
    description: row.name,
    emoji: row.emoji || '🧾',
    paidBy,
    payerId: payer?.id || `remote-${paidBy.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    amount: Number(row.amount),
    participantIds: detail?.participantIds || [],
    shares: detail?.shares || [],
    splitMethod: detail?.splitMethod || 'equal',
    category: detail?.category || 'Other',
    date: isValidDate ? localDateValue(createdAt) : localDateValue(),
    splitsAvailable: Boolean(detail),
  };
}

export function makeExpenseUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function calculateShares(amountValue, participantIds, method, values = {}) {
  const totalCents = Math.round(Number(amountValue) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) throw new Error('Enter an amount greater than zero.');
  if (!participantIds.length) throw new Error('Choose at least one participant.');
  let sharesInCents;

  if (method === 'custom') {
    sharesInCents = participantIds.map((id) => Math.round(Number(values[id] || 0) * 100));
    if (sharesInCents.some((share) => share < 0) || sharesInCents.reduce((sum, share) => sum + share, 0) !== totalCents) {
      throw new Error('Custom shares must add up to the total expense exactly.');
    }
  } else {
    const base = Math.floor(totalCents / participantIds.length);
    let remaining = totalCents - base * participantIds.length;
    sharesInCents = participantIds.map(() => base + (remaining-- > 0 ? 1 : 0));
  }

  return participantIds.map((personId, index) => ({ personId, amount: sharesInCents[index] / 100 }));
}

export function calculateBalances(expenses, people) {
  const centsByPerson = Object.fromEntries(people.map((person) => [person.id, 0]));
  expenses.forEach((expense) => {
    if (expense.splitsAvailable === false) return;
    centsByPerson[expense.payerId] = (centsByPerson[expense.payerId] || 0) + Math.round(expense.amount * 100);
    (expense.shares || []).forEach((share) => {
      centsByPerson[share.personId] = (centsByPerson[share.personId] || 0) - Math.round(share.amount * 100);
    });
  });
  return Object.fromEntries(Object.entries(centsByPerson).map(([id, cents]) => [id, cents / 100]));
}

export function suggestSettlements(balances) {
  const creditors = Object.entries(balances).filter(([, balance]) => balance > 0.005).map(([id, balance]) => ({ id, cents: Math.round(balance * 100) }));
  const debtors = Object.entries(balances).filter(([, balance]) => balance < -0.005).map(([id, balance]) => ({ id, cents: Math.round(-balance * 100) }));
  const suggestions = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const cents = Math.min(debtors[debtorIndex].cents, creditors[creditorIndex].cents);
    if (cents > 0) suggestions.push({ from: debtors[debtorIndex].id, to: creditors[creditorIndex].id, amount: cents / 100 });
    debtors[debtorIndex].cents -= cents;
    creditors[creditorIndex].cents -= cents;
    if (!debtors[debtorIndex].cents) debtorIndex += 1;
    if (!creditors[creditorIndex].cents) creditorIndex += 1;
  }
  return suggestions;
}
