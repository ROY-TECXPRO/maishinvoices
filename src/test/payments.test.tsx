import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { RepositoryProvider } from '../data/RepositoryContext';
import { AuthProvider } from '../auth/AuthContext';
import { FiguresProvider } from '../auth/FiguresContext';
import { SettingsProvider } from '../config/SettingsContext';
import { DocumentsPage } from '../pages/DocumentsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { OutstandingPage } from '../pages/OutstandingPage';
import { PaymentsPanel } from '../components/PaymentsPanel';
import { daysBetween, outstandingInvoices, summarizePayment, whatsappLink, whatsappPhone } from '../domain/payments';
import { makeDraft } from './fixtures';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

async function seed() {
  const repo = new MockRepository(createMemoryStore());
  const mk = async (type: 'invoice' | 'quotation', issueDate: string, customerName: string) => {
    const number = await repo.getNextNumber(type, issueDate);
    return repo.saveDocument({ draft: makeDraft({ type, number, issueDate, customerName }) });
  };
  const fresh = await mk('invoice', today, 'Fresh Ltd');
  const old = await mk('invoice', daysAgo(45), 'Olkupelia');
  const quote = await mk('quotation', today, 'Quote Co');
  return { repo, fresh, old, quote };
}
const wrap = (repo: MockRepository, ui: JSX.Element) => (
  <MemoryRouter><AuthProvider mode="mock"><RepositoryProvider repo={repo}><SettingsProvider><FiguresProvider>{ui}</FiguresProvider></SettingsProvider></RepositoryProvider></AuthProvider></MemoryRouter>
);
async function unlock(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Show figures' })[0]);
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Passcode'), '987456321');
  await user.click(within(dialog).getByRole('button', { name: 'Show figures' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('payment rules', () => {
  it('summarises unpaid, part paid and paid', () => {
    expect(summarizePayment(10000, []).status).toBe('unpaid');
    expect(summarizePayment(10000, [{ amountCents: 4000 }])).toMatchObject({ paidCents: 4000, balanceCents: 6000, status: 'partial' });
    expect(summarizePayment(10000, [{ amountCents: 4000 }, { amountCents: 6000 }])).toMatchObject({ balanceCents: 0, status: 'paid' });
  });

  it('records payments, rejects bad ones and lets you remove one', async () => {
    const { repo, fresh, quote } = await seed();
    const total = fresh.items.reduce((s, i) => (i.kind === 'item' ? s + Math.round(i.quantity * i.unitPriceCents) : s), 0);
    await expect(repo.addPayment({ documentId: quote.id, amountCents: 100, paidOn: today, method: 'cash', note: '' })).rejects.toThrow(/only be recorded against invoices/);
    await expect(repo.addPayment({ documentId: fresh.id, amountCents: 0, paidOn: today, method: 'cash', note: '' })).rejects.toThrow(/greater than zero/);
    await expect(repo.addPayment({ documentId: fresh.id, amountCents: total + 1, paidOn: today, method: 'cash', note: '' })).rejects.toThrow(/more than the balance/);
    const p = await repo.addPayment({ documentId: fresh.id, amountCents: 1000, paidOn: today, method: 'mpesa', note: 'ABC123' });
    expect((await repo.listPayments()).map((x) => x.id)).toEqual([p.id]);
    await repo.deletePayment(p.id);
    expect(await repo.listPayments()).toEqual([]);
  });

  it('lists only invoices with a balance and flags overdue ones', async () => {
    const { repo, fresh, old } = await seed();
    const docs = await repo.listDocuments();
    const rows = outstandingInvoices(docs, [], today, 30);
    expect(rows.map((r) => r.doc.id)).toEqual([old.id, fresh.id]); // oldest first, quotation excluded
    expect(rows[0].overdue).toBe(true);
    expect(rows[1].overdue).toBe(false);
    expect(daysBetween(daysAgo(45), today)).toBe(45);
    const full = fresh.items.reduce((s, i) => (i.kind === 'item' ? s + Math.round(i.quantity * i.unitPriceCents) : s), 0);
    const paid = await repo.addPayment({ documentId: fresh.id, amountCents: full, paidOn: today, method: 'cash', note: '' });
    expect(outstandingInvoices(docs, [paid], today, 30).map((r) => r.doc.id)).toEqual([old.id]);
  });

  it('turns Kenyan phone numbers into WhatsApp links', () => {
    expect(whatsappPhone('0722 899 178')).toBe('254722899178');
    expect(whatsappPhone('+254722899178')).toBe('254722899178');
    expect(whatsappPhone('722899178')).toBe('254722899178');
    expect(whatsappPhone('')).toBeNull();
    expect(whatsappPhone('123')).toBeNull();
    expect(whatsappLink('254722899178', 'Hi there')).toBe('https://wa.me/254722899178?text=Hi%20there');
  });
});

describe('screens', () => {
  it('Documents hides amounts until unlocked and shows payment status', async () => {
    const { repo, fresh } = await seed();
    const user = userEvent.setup();
    const first = render(wrap(repo, <DocumentsPage />));
    await screen.findByText(fresh.number);
    expect(first.container.textContent).not.toMatch(/KSh/);
    expect(screen.getAllByText('Unpaid').length).toBe(2);
    await unlock(user);
    expect(first.container.textContent).toMatch(/KSh/);
    first.unmount();
    await repo.addPayment({ documentId: fresh.id, amountCents: 1000, paidOn: today, method: 'cash', note: '' });
    render(wrap(repo, <DocumentsPage />)); // the mock database has no live refresh; Supabase realtime does
    expect(await screen.findByText('Part paid')).toBeInTheDocument();
  });

  it('Reports is locked until the passcode is entered', async () => {
    const { repo } = await seed();
    const user = userEvent.setup();
    render(wrap(repo, <ReportsPage />));
    expect(screen.getByText(/This page shows figures/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Report type')).not.toBeInTheDocument();
    await unlock(user);
    expect(await screen.findByLabelText('Report type')).toBeInTheDocument();
  });

  it('Outstanding is locked, then lists balances with a WhatsApp reminder', async () => {
    const { repo, old } = await seed();
    await repo.saveCustomer({ name: 'Olkupelia', phone: '0722899178', email: '', address: '' });
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <OutstandingPage />));
    expect(screen.getByText(/This page shows figures/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/KSh/);
    await unlock(user);
    expect(await screen.findByText(old.number)).toBeInTheDocument();
    expect(container.textContent).toMatch(/KSh/);
    const link = screen.getByLabelText(`WhatsApp reminder for ${old.number}`);
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(screen.getAllByText(/overdue/i).length).toBeGreaterThan(0);
  });

  it('PaymentsPanel records a payment and updates the balance and status', async () => {
    const { repo, fresh } = await seed();
    const user = userEvent.setup();
    render(wrap(repo, <PaymentsPanel record={fresh} />));
    expect(screen.getByLabelText('Payment status')).toHaveTextContent('Unpaid');
    await user.type(screen.getByLabelText('Amount received (KSh)'), '10');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.getByLabelText('Payment status')).toHaveTextContent('Part paid'));
    expect(await repo.listPayments()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Full balance' }));
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.getByLabelText('Payment status')).toHaveTextContent('Paid'));
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});
