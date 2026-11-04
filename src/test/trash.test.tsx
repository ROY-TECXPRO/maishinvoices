import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { RepositoryProvider } from '../data/RepositoryContext';
import { AuthProvider } from '../auth/AuthContext';
import { FiguresProvider } from '../auth/FiguresContext';
import { SettingsProvider } from '../config/SettingsContext';
import { CustomersPage } from '../pages/CustomersPage';
import { HistoryPage } from '../pages/HistoryPage';
import { TrashPage } from '../pages/TrashPage';
import { UsersPage } from '../pages/UsersPage';
import { DataTable, type Column } from '../components/DataTable';
import { validateAiAction } from '../ai/validate';
import { makeDraft } from './fixtures';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const wrap = (repo: MockRepository, ui: JSX.Element) => (
  <MemoryRouter><AuthProvider mode="mock"><RepositoryProvider repo={repo}><SettingsProvider><FiguresProvider>{ui}</FiguresProvider></SettingsProvider></RepositoryProvider></AuthProvider></MemoryRouter>
);
async function seed() {
  const repo = new MockRepository(createMemoryStore());
  const number = await repo.getNextNumber('invoice', today);
  const doc = await repo.saveDocument({ draft: makeDraft({ type: 'invoice', number, issueDate: today, customerName: 'Olkupelia' }) });
  return { repo, doc };
}

describe('customer delete goes to the trash and every button works', () => {
  it('opens a popup whose buttons are clickable, trashes the customer, and Trash restores or deletes it', async () => {
    const { repo } = await seed();
    const c = await repo.saveCustomer({ name: 'Acme Traders', phone: '', email: '', address: '' });
    const other = await repo.saveCustomer({ name: 'Baraka Ltd', phone: '', email: '', address: '' });
    const user = userEvent.setup();
    const page = render(wrap(repo, <CustomersPage />));

    await user.click(await screen.findByRole('button', { name: 'Delete Acme Traders' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm delete customer' });
    // the popup must not leave the other delete buttons dimmed
    expect(screen.getByRole('button', { name: 'Delete Baraka Ltd' })).toBeEnabled();
    const confirm = within(dialog).getByRole('button', { name: 'Delete customer' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const remaining = (await repo.listCustomers()).map((x) => x.id);
    expect(remaining).toContain(other.id);
    expect(remaining).not.toContain(c.id);
    expect((await repo.listDeletedCustomers()).map((x) => x.id)).toEqual([c.id]);
    page.unmount();

    render(wrap(repo, <TrashPage />));
    await user.click(await screen.findByRole('button', { name: 'Permanently delete customer Acme Traders' })); // admin only button is there
    await user.click(within(await screen.findByRole('dialog', { name: 'Confirm permanent delete' })).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(async () => expect(await repo.listDeletedCustomers()).toEqual([]));
  });
});

describe('Delete all history moves history to the trash', () => {
  it('clears, shows a History batch in Trash, restores it, then deletes it permanently (admin)', async () => {
    const { repo } = await seed();
    const before = (await repo.listAudit()).length;
    expect(before).toBeGreaterThan(0);
    const user = userEvent.setup();

    const page = render(wrap(repo, <HistoryPage />));
    await user.click(await screen.findByRole('button', { name: /Delete all history/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm clear history' });
    await user.click(within(dialog).getByRole('button', { name: 'Move all history to trash' }));
    expect(await screen.findByText(/moved to the Trash/)).toBeInTheDocument();
    expect((await repo.listAudit()).map((a) => a.action)).toEqual(['history_cleared']);
    page.unmount();

    const trash = render(wrap(repo, <TrashPage />));
    expect(await screen.findByText(/History cleared on/)).toBeInTheDocument();
    expect(screen.getAllByText('History').length).toBeGreaterThan(1); // section tag + row tag
    await user.click(screen.getByRole('button', { name: /^Restore history of/ }));
    await waitFor(async () => expect(await repo.listTrashedHistory()).toEqual([]));
    expect((await repo.listAudit()).length).toBeGreaterThanOrEqual(before);
    trash.unmount();

    await repo.deleteHistory();
    render(wrap(repo, <TrashPage />));
    await user.click(await screen.findByRole('button', { name: /^Permanently delete history of/ }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Confirm permanent delete' })).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(async () => expect(await repo.listTrashedHistory()).toEqual([]));
  });
});

describe('administrator manages users', () => {
  it('adds an active user and removes another through the popup', async () => {
    const { repo } = await seed();
    const user = userEvent.setup();
    render(wrap(repo, <UsersPage />));
    await user.click(await screen.findByRole('button', { name: /Add user/ }));
    await user.type(screen.getByLabelText(/Full name/), 'Jane Wanjiru');
    await user.type(screen.getByLabelText(/^Email/), 'jane@maish.co.ke');
    await user.type(screen.getByLabelText(/^Password/), 'longenough1');
    await user.click((() => { const b = screen.getAllByRole('button', { name: 'Add user' }); return b[b.length - 1]; })());
    expect(await screen.findByText(/was added and can sign in now/)).toBeInTheDocument();
    expect((await repo.listProfiles()).find((p) => p.email === 'jane@maish.co.ke')?.isActive).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Remove Jane Wanjiru' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm delete user' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove employee' }));
    await waitFor(async () => expect((await repo.listProfiles()).some((p) => p.email === 'jane@maish.co.ke')).toBe(false));
  });
});

describe('advanced report table', () => {
  type R = { name: string; qty: number; cents: number };
  const rows: R[] = Array.from({ length: 23 }, (_, i) => ({ name: `Customer ${String(i + 1).padStart(2, '0')}`, qty: i + 1, cents: (i + 1) * 100000 }));
  const columns: Column<R>[] = [
    { key: 'name', label: 'Customer', kind: 'text', get: (r) => r.name },
    { key: 'qty', label: 'Invoices', kind: 'count', get: (r) => r.qty, total: (rs) => rs.reduce((s, r) => s + r.qty, 0) },
    { key: 'cents', label: 'Invoiced', kind: 'money', bar: true, get: (r) => r.cents, total: (rs) => rs.reduce((s, r) => s + r.cents, 0) },
  ];

  it('sorts, searches, pages and totals', async () => {
    const user = userEvent.setup();
    render(<DataTable label="t" columns={columns} rows={rows} rowKey={(r) => r.name} />);
    expect(screen.getByText('Showing 1-10 of 23')).toBeInTheDocument();
    expect(screen.getByText('Customer 01')).toBeInTheDocument();
    expect(screen.queryByText('Customer 11')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Showing 11-20 of 23')).toBeInTheDocument();
    expect(screen.getByText('Customer 11')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sort by Invoiced' }));
    await user.click(screen.getByRole('button', { name: 'Sort by Invoiced' })); // descending
    expect(screen.getByText('Showing 1-10 of 23')).toBeInTheDocument(); // sorting returns to page 1
    const firstRow = screen.getAllByRole('row')[1];
    expect(within(firstRow).getByText('Customer 23')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search report rows'), 'customer 07');
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument();
    // totals follow the filter: one row of KSh 7,000.00
    const allRows = screen.getAllByRole('row');
    const foot = allRows[allRows.length - 1];
    expect(within(foot).getByText('KSh 7,000.00')).toBeInTheDocument();
    expect(within(foot).getByText('Total')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search report rows'));
    await user.type(screen.getByLabelText('Search report rows'), 'nothing like this');
    expect(screen.getByText('No rows match your search.')).toBeInTheDocument();
  });
});

describe('Claude assistant action contract', () => {
  it('accepts the new customer, payment and outstanding actions and lookups by number', () => {
    expect(validateAiAction({ kind: 'record_payment', number: 'INV-2026-4001', amountCents: 500000, method: 'mpesa', note: 'QWE123' }))
      .toEqual({ kind: 'record_payment', number: 'INV-2026-4001', amountCents: 500000, method: 'mpesa', note: 'QWE123' });
    expect(validateAiAction({ kind: 'record_payment', number: 'INV-1', amountCents: -5 })).toBeNull();
    expect(validateAiAction({ kind: 'record_payment', amountCents: 5000 })).toBeNull(); // no target
    expect(validateAiAction({ kind: 'save_customer', name: ' Acme ', phone: '0722' })).toEqual({ kind: 'save_customer', name: 'Acme', phone: '0722' });
    expect(validateAiAction({ kind: 'trash_customer', name: 'Acme' })).toEqual({ kind: 'trash_customer', name: 'Acme' });
    expect(validateAiAction({ kind: 'trash_customer' })).toBeNull();
    expect(validateAiAction({ kind: 'get_outstanding' })).toEqual({ kind: 'get_outstanding' });
    expect(validateAiAction({ kind: 'trash_document', number: 'INV-2026-3999' })).toEqual({ kind: 'trash_document', number: 'INV-2026-3999' });
    expect(validateAiAction({ kind: 'convert_to_invoice', id: 'abc' })).toEqual({ kind: 'convert_to_invoice', id: 'abc' });
    expect(validateAiAction({ kind: 'drop_database' })).toBeNull();
  });
});
