export const STORAGE_KEYS = {
  expenses: 'splitsmart.expenses',
  people: 'splitsmart.people',
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

export function loadAppData() {
  const savedExpenses = readArray(STORAGE_KEYS.expenses);
  const savedPeople = readArray(STORAGE_KEYS.people);
  const people = (savedPeople || [
    { id: 'person-me', name: 'Me', isMe: true, isSample: false },
    { id: 'person-rahul', name: 'Rahul', isMe: false, isSample: true },
    { id: 'person-priya', name: 'Priya', isMe: false, isSample: true },
    { id: 'person-aisha', name: 'Aisha', isMe: false, isSample: true },
  ]).filter((person) => person && typeof person.id === 'string' && typeof person.name === 'string');
  if (!people.some((person) => person.isMe)) people.unshift({ id: 'person-me', name: 'Me', isMe: true, isSample: false });

  const legacyPayers = (savedExpenses || []).map((expense) => expense?.paidBy).filter((name) => typeof name === 'string');
  legacyPayers.forEach((name) => {
    if (!people.some((person) => person.name.toLowerCase() === name.toLowerCase())) {
      people.push({ id: `legacy-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, isMe: false, isSample: false });
    }
  });

  const expenses = (savedExpenses || []).filter((expense) => expense && typeof expense === 'object' && Number.isFinite(Number(expense.amount)) && Number(expense.amount) > 0).map((expense) => {
    const amount = Math.round(Number(expense.amount) * 100) / 100;
    const matchedPayer = people.find((person) => person.name.toLowerCase() === String(expense.paidBy || '').toLowerCase());
    const payerId = expense.payerId || matchedPayer?.id || people.find((person) => person.isMe)?.id;
    const participantIds = Array.isArray(expense.participantIds) && expense.participantIds.length ? expense.participantIds.filter((id) => people.some((person) => person.id === id)) : [payerId];
    const shares = Array.isArray(expense.shares) ? expense.shares.filter((share) => share && people.some((person) => person.id === share.personId) && Number.isFinite(Number(share.amount))).map((share) => ({ personId: share.personId, amount: Math.round(Number(share.amount) * 100) / 100 })) : [{ personId: payerId, amount }];
    return {
      id: typeof expense.id === 'string' ? expense.id : `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: String(expense.description || expense.name || 'Expense'),
      amount,
      payerId,
      participantIds: participantIds.length ? participantIds : [payerId],
      shares: shares.length ? shares : [{ personId: payerId, amount }],
      splitMethod: expense.splitMethod === 'custom' ? 'custom' : 'equal',
      category: CATEGORIES.includes(expense.category) ? expense.category : 'Other',
      date: /^\d{4}-\d{2}-\d{2}$/.test(expense.date || '') ? expense.date : localDateValue(),
    };
  });

  return { people, expenses };
}

export function saveAppData({ people, expenses }) {
  try {
    localStorage.setItem(STORAGE_KEYS.people, JSON.stringify(people));
    localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
    return true;
  } catch {
    return false;
  }
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
