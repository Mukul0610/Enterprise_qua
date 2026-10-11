import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuoteAttachmentLink from '@/app/components/QuoteAttachmentLink';
import { downloadQuoteAttachment } from '@/lib/rfqClient';

jest.mock('@/lib/rfqClient', () => ({
  downloadQuoteAttachment: jest.fn(),
}));

const mockedDownload = jest.mocked(downloadQuoteAttachment);
const attachment = {
  id: 'attachment-1',
  fileName: 'vendor-quote.pdf',
  mimeType: 'application/pdf',
  size: 128,
  uploadedAt: '2026-10-10T00:00:00Z',
};

describe('QuoteAttachmentLink', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('downloads the attachment and revokes its object URL when unmounted', async () => {
    const revoke = jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    mockedDownload.mockResolvedValue({ success: true, url: 'blob:vendor-quote' });
    const { unmount } = render(<QuoteAttachmentLink rfqId="RFQ-1" attachment={attachment} />);

    fireEvent.click(screen.getByRole('button', { name: 'vendor-quote.pdf' }));

    const link = await screen.findByRole('link', { name: 'vendor-quote.pdf' });
    expect(link).toHaveAttribute('href', 'blob:vendor-quote');
    expect(link).toHaveAttribute('download', 'vendor-quote.pdf');
    expect(mockedDownload).toHaveBeenCalledWith('RFQ-1', attachment);

    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:vendor-quote');
  });

  it('shows the server error when the download cannot be prepared', async () => {
    mockedDownload.mockResolvedValue({ success: false, error: 'The quote has expired.' });
    render(<QuoteAttachmentLink rfqId="RFQ-2" attachment={attachment} />);

    fireEvent.click(screen.getByRole('button', { name: 'vendor-quote.pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The quote has expired.');
    expect(screen.getByRole('button', { name: 'vendor-quote.pdf' })).toBeEnabled();
  });

  it('disables the button while a download is in progress and uses the fallback error', async () => {
    let finishDownload!: (value: { success: boolean; error?: string }) => void;
    mockedDownload.mockReturnValue(new Promise((resolve) => {
      finishDownload = resolve;
    }));
    render(<QuoteAttachmentLink rfqId="RFQ-3" attachment={attachment} />);

    fireEvent.click(screen.getByRole('button', { name: 'vendor-quote.pdf' }));

    expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
    finishDownload({ success: false });
    await waitFor(() => expect(screen.getByRole('button', { name: 'vendor-quote.pdf' })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Download unavailable.');
  });
});
