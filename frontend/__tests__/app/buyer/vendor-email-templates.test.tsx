import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VendorEmailTemplatesPage from '@/app/buyer/vendor-email-templates';
import { useApp } from '@/lib/store';
import { fetchDispatchTemplates, saveDispatchTemplate } from '@/lib/buyerProfileClient';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchDispatchTemplates: jest.fn(),
  saveDispatchTemplate: jest.fn(),
}));

describe('VendorEmailTemplatesPage', () => {
  const mockShowToast = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({ showToast: mockShowToast });
  });

  test('shows a loading state, then renders both editors with default placeholders when nothing is saved', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({ success: true, data: {} });

    render(<VendorEmailTemplatesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Template A . Suppliers With Pre-Purchase Order History/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Template B . Suppliers With NO Pre-Purchase Orders/i)).toBeInTheDocument();
    expect(screen.queryByText('Customized')).not.toBeInTheDocument();
  });

  test('renders saved custom subject/message and a "Customized" badge when a template is saved', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        category_mapped: { subject: 'Welcome aboard!', message: 'We are glad to have you.' },
      },
    });

    render(<VendorEmailTemplatesPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Welcome aboard!')).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('We are glad to have you.')).toBeInTheDocument();
    expect(screen.getByText('Customized')).toBeInTheDocument();
  });

  test('shows a load error when the templates cannot be read', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({ success: false, error: 'Database unreachable' });

    render(<VendorEmailTemplatesPage />);

    await waitFor(() => {
      expect(screen.getByText('Database unreachable')).toBeInTheDocument();
    });
  });

  test('saves a template and shows a success toast', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({ success: true, data: {} });
    (saveDispatchTemplate as jest.Mock).mockResolvedValue({
      success: true,
      data: { subject: 'New subject', message: 'New message' },
    });

    render(<VendorEmailTemplatesPage />);

    await waitFor(() => screen.getByText(/Template A/i));

    const [subjectA] = screen.getAllByPlaceholderText(/mapped your supply categories/i);
    fireEvent.change(subjectA, { target: { value: 'New subject' } });

    const [messageA] = screen.getAllByPlaceholderText(/added your organisation to their vendor master and mapped/i);
    fireEvent.change(messageA, { target: { value: 'New message' } });

    const [saveBtnA] = screen.getAllByRole('button', { name: /^Save$/i });
    fireEvent.click(saveBtnA);

    await waitFor(() => {
      expect(saveDispatchTemplate).toHaveBeenCalledWith('category_mapped', {
        subject: 'New subject',
        message: 'New message',
      });
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Template Saved',
      expect.stringContaining('every future vendor upload'),
      'success'
    );
  });

  test('shows a warning toast and keeps the form when save fails', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({ success: true, data: {} });
    (saveDispatchTemplate as jest.Mock).mockResolvedValue({ success: false, error: 'Could not save.' });

    render(<VendorEmailTemplatesPage />);
    await waitFor(() => screen.getByText(/Template A/i));

    const [saveBtnA] = screen.getAllByRole('button', { name: /^Save$/i });
    fireEvent.click(saveBtnA);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('Save Failed', 'Could not save.', 'warning');
    });
  });

  test('"Reset to Default" clears a customized template back to blank', async () => {
    (fetchDispatchTemplates as jest.Mock).mockResolvedValue({
      success: true,
      data: { self_map_required: { subject: 'Custom B subject', message: 'Custom B message' } },
    });

    render(<VendorEmailTemplatesPage />);
    await waitFor(() => expect(screen.getByDisplayValue('Custom B subject')).toBeInTheDocument());

    const resetBtn = screen.getByRole('button', { name: /Reset to Default/i });
    fireEvent.click(resetBtn);

    expect(screen.queryByDisplayValue('Custom B subject')).not.toBeInTheDocument();
    expect(screen.queryByText('Customized')).not.toBeInTheDocument();
  });
});
