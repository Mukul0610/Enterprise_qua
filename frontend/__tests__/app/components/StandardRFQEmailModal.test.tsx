import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import StandardRFQEmailModal from '@/app/components/StandardRFQEmailModal';
import * as storeModule from '@/lib/store';
import { StandardRFQEmailPayload } from '@/lib/types';

jest.mock('@/lib/store');

describe('StandardRFQEmailModal', () => {
  const mockSetEmailModalOpen = jest.fn();
  const mockShowToast = jest.fn();

  const sampleEmailPayload: StandardRFQEmailPayload = {
    emailId: 'email-1',
    rfqNumber: 'RFQ-2026-001',
    rfqTitle: 'Heavy Duty Industrial Centrifugal Pumps',
    sourcingMode: 'mode_1',
    sourcingModeName: 'Client Roster Sourcing Plan',
    sourcingModeCode: 'Version 1',
    buyerCompany: 'Tata Motors Commercial Vehicles Ltd.',
    buyerContactName: 'Vikram Malhotra',
    buyerContactEmail: 'sourcing.commercial@tatamotors.com',
    buyerContactPhone: '+91 98201 55431',
    recipientVendorName: 'Apex Industrial Dynamics Pvt Ltd',
    recipientContactPerson: 'Rajesh Nair',
    recipientEmail: 'rajesh@apexindustrial.in',
    subject: '[RFQ-2026-001] Heavy Duty Industrial Centrifugal Pumps - Tata Motors',
    matchedMajorCategory: 'Engineering Spares - Mechanical',
    matchedMinorCategories: ['Pumps & Accessories', 'Compressors & Accessories'],
    requisitionDate: '2026-08-29',
    submissionDeadline: '2026-09-05',
    targetDeliveryDate: '2026-09-20',
    deliveryLocation: 'Navi Mumbai Plant Hub',
    paymentTerms: '30 Days Net from Delivery & QC',
    lineItems: [
      {
        itemNumber: 1,
        itemName: 'Centrifugal Slurry Pump 75kW',
        technicalSpecs: 'Flow: 350 m3/hr, Head: 45m, Cast Iron Impeller',
        quantity: 4,
        unit: 'Units',
        minorCategory: 'Pumps & Accessories',
        targetDate: '2026-09-20',
      },
    ],
    specialInstructions: 'Standard empanelled vendor directives apply.',
    complianceChecklist: ['ISO 9001:2015 Certificate', 'Mill Test Certificate (MTC)'],
    replyInstructions: 'Reply directly to this email.',
    replyToEmail: 'sourcing.commercial@tatamotors.com',
    shaSignature: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    dispatchedAt: '2026-08-29 10:00 UTC',
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when closed or email is null', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedEmailForModal: null,
      emailModalOpen: false,
      setEmailModalOpen: mockSetEmailModalOpen,
      showToast: mockShowToast,
    });

    const { container } = render(<StandardRFQEmailModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders standard RFQ email details when open and allows closing from header X and done button', () => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedEmailForModal: sampleEmailPayload,
      emailModalOpen: true,
      setEmailModalOpen: mockSetEmailModalOpen,
      showToast: mockShowToast,
    });

    render(<StandardRFQEmailModal />);

    expect(screen.getByText('Standard RFQ Procurement Email')).toBeInTheDocument();
    expect(screen.getAllByText(sampleEmailPayload.subject)[0]).toBeInTheDocument();
    expect(screen.getByText('Centrifugal Slurry Pump 75kW')).toBeInTheDocument();
    expect(screen.getByText('Navi Mumbai CIF')).toBeInTheDocument();
    expect(screen.getByText('30 Days Net from Delivery & QC')).toBeInTheDocument();

    // Top X Close button
    const closeXBtn = screen.getAllByRole('button')[0];
    fireEvent.click(closeXBtn);
    expect(mockSetEmailModalOpen).toHaveBeenCalledWith(false);

    // Done Close button
    const doneBtn = screen.getByText('Done / Close Preview');
    fireEvent.click(doneBtn);
    expect(mockSetEmailModalOpen).toHaveBeenCalledWith(false);
  });

  it('handles copy email text to clipboard with timer reset', () => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedEmailForModal: sampleEmailPayload,
      emailModalOpen: true,
      setEmailModalOpen: mockSetEmailModalOpen,
      showToast: mockShowToast,
    });

    render(<StandardRFQEmailModal />);

    const copyBtn = screen.getByText(/Copy Email Text/);
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Copied to Clipboard', expect.any(String), 'success');

    act(() => {
      jest.advanceTimersByTime(2600);
    });
    jest.useRealTimers();
  });

  it('directs RFQs with more than ten items to the portal and Excel upload only', () => {
    const complexEmailPayload: StandardRFQEmailPayload = {
      ...sampleEmailPayload,
      lineItems: Array.from({ length: 11 }, (_, index) => ({
        ...sampleEmailPayload.lineItems[0],
        itemNumber: index + 1,
        itemName: `Pump component ${index + 1}`,
      })),
    };
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedEmailForModal: complexEmailPayload,
      emailModalOpen: true,
      setEmailModalOpen: mockSetEmailModalOpen,
      showToast: mockShowToast,
    });

    render(<StandardRFQEmailModal />);

    expect(screen.getByText('Portal Submission Only')).toBeInTheDocument();
    expect(screen.getByText(/Email bids are not accepted/i)).toBeInTheDocument();
    expect(screen.getByText(/download the RFQ Excel file/i)).toBeInTheDocument();
    expect(screen.queryByText(/MANDATORY: SUBMIT QUOTATION BY DIRECT EMAIL REPLY/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/Copy Email Text/i));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('Email bids are not accepted for RFQs with more than 10 items'),
    );
  });

  it('handles print action with iframe and fallback', () => {
    jest.useFakeTimers();
    (storeModule.useApp as jest.Mock).mockReturnValue({
      selectedEmailForModal: sampleEmailPayload,
      emailModalOpen: true,
      setEmailModalOpen: mockSetEmailModalOpen,
      showToast: mockShowToast,
    });

    window.print = jest.fn();

    render(<StandardRFQEmailModal />);

    const printBtn = screen.getByText(/Print/);
    fireEvent.click(printBtn);
    expect(window.print).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
