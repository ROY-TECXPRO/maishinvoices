import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DocumentEditor } from '../components/DocumentEditor';
import { MockRepository, createMemoryStore } from '../data/mockRepository';
import { RepositoryProvider } from '../data/RepositoryContext';
import type { DocumentType } from '../domain/types';

async function setup(type: DocumentType = 'quotation') {
  const repo = new MockRepository(createMemoryStore());
  render(
    <RepositoryProvider repo={repo}>
      <MemoryRouter>
        <DocumentEditor record={null} initialType={type} />
      </MemoryRouter>
    </RepositoryProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText('Document number')).not.toHaveValue(''));
  return { repo, user: userEvent.setup() };
}

describe('DocumentEditor', () => {
  it('prepopulates the next number and calculates line amounts live', async () => {
    const { user } = await setup();
    expect((screen.getByLabelText('Document number') as HTMLInputElement).value).toMatch(/^QT-\d{4}-3999$/);
    await user.type(screen.getByLabelText('Quantity row 1'), '10');
    await user.type(screen.getByLabelText('Unit price row 1'), '1200');
    expect(screen.getByLabelText('Amount row 1')).toHaveTextContent('KSh 12,000.00');
    await user.clear(screen.getByLabelText('Quantity row 1'));
    await user.type(screen.getByLabelText('Quantity row 1'), '12');
    expect(screen.getByLabelText('Amount row 1')).toHaveTextContent('KSh 14,400.00');
  });

  it('quotation editor shows no totals panel; invoice editor shows the total', async () => {
    await setup('quotation');
    expect(screen.queryByTestId('totals-panel')).toBeNull();
    expect(screen.queryByLabelText('Invoice total')).toBeNull();
  });

  it('invoice total reflects quantity x price and optional tax', async () => {
    const { user } = await setup('invoice');
    await user.type(screen.getByLabelText('Quantity row 1'), '2');
    await user.type(screen.getByLabelText('Unit price row 1'), '500');
    expect(screen.getByLabelText('Invoice total')).toHaveTextContent('KSh 1,000.00');
    await user.click(screen.getByLabelText('Apply tax to this invoice'));
    await user.type(screen.getByLabelText('Tax rate %'), '16');
    expect(screen.getByLabelText('Invoice total')).toHaveTextContent('KSh 1,160.00');
  });

  it('adds, reorders and removes rows', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: /add heading/i }));
    await user.type(screen.getByLabelText('Description row 2'), 'FLEECE');
    await user.click(screen.getByRole('button', { name: 'Move row 2 up' }));
    expect(screen.getByLabelText('Description row 1')).toHaveValue('FLEECE');
    await user.click(screen.getByRole('button', { name: 'Remove row 1' }));
    expect(screen.queryByDisplayValue('FLEECE')).toBeNull();
  });

  it('blocks saving an incomplete document and lists what to fix', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/customer name is required/i)).toBeInTheDocument();
  });

  it('saves, then enables PDF download/print; editing disables them until saved again', async () => {
    const { user, repo } = await setup();
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/customer \/ business name/i), 'Olkupelia');
    await user.type(screen.getByLabelText('Description row 1'), 'POLO T-SHIRTS');
    await user.type(screen.getByLabelText('Quantity row 1'), '25');
    await user.type(screen.getByLabelText('Unit price row 1'), '1200');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/^Saved QT-\d{4}-3999/)).toBeInTheDocument();
    expect((await repo.listDocuments()).length).toBe(1);
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
    await user.type(screen.getByLabelText('Order number (optional)'), 'X1');
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeDisabled();
  });

  it('reports a duplicate number instead of overwriting', async () => {
    const { user, repo } = await setup();
    await repo.saveDocument({
      draft: { type: 'quotation', number: 'QT-2026-4100', issueDate: '2026-10-07', orderNumber: '', customerId: null, customerName: 'X', customerPhone: '', customerEmail: '', customerAddress: '', items: [{ id: 'a', kind: 'item', description: 'A', quantity: 1, unitPriceCents: 100 }], discount: null, tax: null, paymentTerms: '', notes: '' },
    });
    await user.type(screen.getByLabelText(/customer \/ business name/i), 'Y');
    await user.type(screen.getByLabelText('Description row 1'), 'B');
    await user.type(screen.getByLabelText('Quantity row 1'), '1');
    await user.type(screen.getByLabelText('Unit price row 1'), '5');
    await user.clear(screen.getByLabelText('Document number'));
    await user.type(screen.getByLabelText('Document number'), 'QT-2026-4100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/already allocated/i)).toBeInTheDocument();
  });
});
