import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { RepositoryProvider } from '../data/RepositoryContext';
import { DashboardPage } from '../pages/DashboardPage';
import { DocumentsPage } from '../pages/DocumentsPage';
import { TrashPage } from '../pages/TrashPage';
import { AuthProvider } from '../auth/AuthContext';
import { FiguresProvider } from '../auth/FiguresContext';
import { SettingsProvider } from '../config/SettingsContext';
import { newEditorState, stateToDraft } from '../domain/editorModel';
import { makeDraft } from './fixtures';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const seed = async () => {
  const repo = new MockRepository(createMemoryStore());
  const inv = await repo.saveDocument({ draft: makeDraft({ type: 'invoice', number: '', issueDate: today, customerName: 'Olkupelia' }) }).catch(async () => {
    const number = await repo.getNextNumber('invoice', today);
    return repo.saveDocument({ draft: makeDraft({ type: 'invoice', number, issueDate: today, customerName: 'Olkupelia' }) });
  });
  const qn = await repo.getNextNumber('quotation', today);
  const qt = await repo.saveDocument({ draft: makeDraft({ type: 'quotation', number: qn, issueDate: today, customerName: 'Other Co' }) });
  return { repo, inv, qt };
};
const wrap = (repo: MockRepository, ui: JSX.Element) => (
  <MemoryRouter><AuthProvider mode="mock"><RepositoryProvider repo={repo}><SettingsProvider><FiguresProvider>{ui}</FiguresProvider></SettingsProvider></RepositoryProvider></AuthProvider></MemoryRouter>
);

describe('dashboard figures are protected', () => {
  it('shows no money or counts until the right passcode is entered', async () => {
    const { repo } = await seed();
    const user = userEvent.setup();
    const { container } = render(wrap(repo, <DashboardPage />));
    await waitFor(() => expect(screen.queryByText('Loading summary...')).not.toBeInTheDocument());
    expect(container.textContent).not.toMatch(/KSh/);
    expect(container.textContent).not.toMatch(/\d+ invoices?/);
    expect(container.textContent).not.toMatch(/\d+ inv \/ \d+ qt/);

    await user.click(screen.getByRole('button', { name: 'Show figures' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/contact the administrator/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Passcode'), '111111');
    await user.click(within(dialog).getByRole('button', { name: 'Show figures' }));
    expect(await within(dialog).findByText('Incorrect passcode.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/KSh/);

    await user.type(within(dialog).getByLabelText('Passcode'), '987456321');
    await user.click(within(dialog).getByRole('button', { name: 'Show figures' }));
    await waitFor(() => expect(container.textContent).toMatch(/KSh/));
    // a quotation never shows a grand total, even when figures are revealed
    expect(screen.getAllByText('Quotation').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Hide figures' }));
    expect(container.textContent).not.toMatch(/KSh/);
  });

  it('lets an administrator change the passcode', async () => {
    const { repo } = await seed();
    await repo.setFiguresPasscode('newcode123');
    expect(await repo.verifyFiguresPasscode('987456321')).toBe(false);
    expect(await repo.verifyFiguresPasscode('newcode123')).toBe(true);
    await expect(repo.setFiguresPasscode('123')).rejects.toThrow();
  });
});

describe('delete moves documents to the trash', () => {
  it('Delete key and the button trash the selected quotation and invoice, and Trash lists them', async () => {
    const { repo, inv, qt } = await seed();
    const user = userEvent.setup();
    render(wrap(repo, <DocumentsPage />));
    await screen.findByText(inv.number);

    await user.click(screen.getByLabelText(`Select ${qt.number}`));
    await user.click(screen.getByLabelText(`Select ${inv.number}`));
    await user.keyboard('{Delete}');
    const confirm = await screen.findByRole('dialog', { name: 'Confirm delete' });
    expect(within(confirm).getByText(/Move 2 documents to trash/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Move to trash' }));

    expect(await screen.findByText(/2 documents have been moved to the Trash/)).toBeInTheDocument();
    expect((await repo.listDocuments()).length).toBe(0);
    expect((await repo.listDocuments({ status: 'trashed' })).map((d) => d.number).sort()).toEqual([inv.number, qt.number].sort());
  });

  it('the row trash button works for a single document and Trash restores it', async () => {
    const { repo, inv } = await seed();
    const user = userEvent.setup();
    const first = render(wrap(repo, <DocumentsPage />));
    await user.click(await screen.findByLabelText(`Move ${inv.number} to trash`));
    await user.click(within(await screen.findByRole('dialog', { name: 'Confirm delete' })).getByRole('button', { name: 'Move to trash' }));
    await waitFor(async () => expect((await repo.listDocuments({ status: 'trashed' })).length).toBe(1));
    first.unmount();

    render(wrap(repo, <TrashPage />));
    await user.click(await screen.findByLabelText(`Restore ${inv.number}`));
    await waitFor(async () => expect((await repo.listDocuments({ status: 'trashed' })).length).toBe(0));
  });
});

describe('users, customers, phone and order number', () => {
  it('a new user is active immediately and must have a password', async () => {
    const { repo } = await seed();
    await expect(repo.addUser({ fullName: 'Jane', email: 'jane@x.com', password: 'short', role: 'employee' })).rejects.toThrow(/8 characters/);
    const p = await repo.addUser({ fullName: 'Jane', email: 'jane@x.com', password: 'longenough1', role: 'employee' });
    expect(p.isActive).toBe(true);
    expect(p.role).toBe('employee');
    await expect(repo.addUser({ fullName: 'Jane 2', email: 'JANE@x.com', password: 'longenough1', role: 'employee' })).rejects.toThrow(/already exists/);
    await repo.deleteProfile(p.id);
    expect((await repo.listProfiles()).some((x) => x.id === p.id)).toBe(false);
  });

  it('deleted customers go to the trash and can be restored', async () => {
    const { repo } = await seed();
    const c = await repo.saveCustomer({ name: 'Acme', phone: '', email: '', address: '' });
    await repo.deleteCustomer(c.id);
    expect((await repo.listCustomers()).some((x) => x.id === c.id)).toBe(false);
    expect((await repo.listDeletedCustomers()).some((x) => x.id === c.id)).toBe(true);
    await repo.restoreCustomer(c.id);
    expect((await repo.listCustomers()).some((x) => x.id === c.id)).toBe(true);
  });

  it('phone is optional and order number defaults to the document number', async () => {
    const { repo } = await seed();
    const s = newEditorState('quotation', 'QT-2026-5000', today);
    s.customerName = 'No Phone Ltd';
    s.lines[0] = { ...s.lines[0], description: 'Item', qty: '1', price: '100' };
    const { draft, problems } = stateToDraft({ ...s, orderNumber: '' });
    expect(problems).toEqual([]);
    expect(draft.customerPhone).toBe('');
    expect(draft.orderNumber).toBe('QT-2026-5000');
    const saved = await repo.saveDocument({ draft });
    expect(saved.customerPhone).toBe('');
  });
});
