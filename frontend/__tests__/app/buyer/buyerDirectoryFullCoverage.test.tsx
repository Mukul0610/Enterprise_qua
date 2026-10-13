import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import VendorSummary from '@/app/buyer/vendor-summary';
import VendorEvaluationSummary from '@/app/buyer/vendor-evaluation-summary';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import { extractLineItemsFromDocument, classifyLineItems, uploadRFQAttachment, createRFQ } from '@/lib/rfqClient';
import { useApp, AppProvider } from '@/lib/store';

jest.mock('@/lib/rfqClient', () => ({
  ...jest.requireActual('@/lib/rfqClient'),
  extractLineItemsFromDocument: jest.fn(),
  // buildExtractionRequest stages any binary upload (e.g. the .eml fixture
  // below) via this before calling extractLineItemsFromDocument — mocked so
  // that real step never hits the network in this suite.
  stageDocumentForExtraction: jest.fn().mockResolvedValue({ success: true, key: 'staged-test-key' }),
  classifyLineItems: jest.fn(),
  uploadRFQAttachment: jest.fn(),
  createRFQ: jest.fn(),
}));

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
  AppProvider: ({ children }: any) => <div>{children}</div>,
}));

// A hardcoded literal here ('2026-09-30') is a time bomb: the ingestion
// wizard's own client-side validation rejects a target date earlier than
// today before ever calling createRFQ, so a fixed past-looking date starts
// silently blocking submission the instant the real calendar date passes it.
// Computed once per test run instead, always valid.
const A_FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('Buyer Directory & Ingestion Full Coverage Suite', () => {
  const mockOnViewEvaluation = jest.fn();
  const mockOnNavigateToWizard = jest.fn();
  const mockShowToast = jest.fn();
  const mockAddBuyerVendor = jest.fn();
  const mockUpdateBuyerVendor = jest.fn();
  const mockDeleteBuyerVendor = jest.fn();
  const mockReviseVendorRating = jest.fn();
  const mockOpenRatingRevisionEmailModal = jest.fn();

  const mockBuyerVendors: any[] = [
    {
      id: 'v-1',
      name: 'Apex Supplies Ltd.',
      brandName: 'Apex',
      contactPerson: 'Rajesh Nair',
      contactDesignation: 'Director',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      location: 'Pune, Maharashtra',
      city: 'Pune',
      state: 'Maharashtra',
      country: 'India',
      pincode: '411001',
      gst: '27AABCA1234F1Z5',
      pan: 'AABCA1234F',
      msme: 'UDYAM-MH-01-0012345',
      annualTurnover: '₹50 Cr',
      rating: 4.8,
      score: 96,
      source: 'buyer_manual',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      evaluated: true,
      majorCategory: 'Mechanical',
      minorCategories: ['Valves', 'Pumps'],
    },
    {
      id: 'v-2',
      name: 'Global Valves Ltd',
      contactPerson: 'Suresh Rao',
      email: 'suresh@globalvalves.in',
      phone: '+91 98201 55443',
      location: 'Vadodara, Gujarat',
      rating: 4.2,
      score: 84,
      source: 'historical_purchase_dump',
      status: 'CONDITIONAL / UNDER REVIEW',
      evaluated: false,
      majorCategory: 'Mechanical',
      minorCategories: ['Industrial Gate Valves'],
    },
    {
      id: 'net-3',
      name: 'TechnoForce Electricals Ltd',
      contactPerson: 'Pooja Verma',
      email: 'pooja@technoforce.com',
      phone: '+91 98000 22222',
      location: 'Bengaluru, KA',
      rating: 4.0,
      score: 80,
      source: 'procucev_network',
      status: 'REGISTERED',
      evaluated: false,
      majorCategory: 'Electrical',
      overlap: true,
    },
  ];

  const mockEvaluationRecords: any[] = [
    {
      id: 'eval-v-1',
      vendorId: 'v-1',
      vendorName: 'Apex Supplies Ltd.',
      contactPerson: 'Rajesh Nair',
      email: 'rajesh@apex.in',
      phone: '+91 98201 44820',
      category: 'Mechanical',
      submissionDate: '2026-02-28',
      overallScore: 96,
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      systemAction: 'Auto Direct Dispatch Authorized',
      moduleScores: {
        commercial: { score: 4.8, maxScore: 5, weight: 25, weightedScore: 24, remarks: 'Good' },
        technical: { score: 4.5, maxScore: 5, weight: 15, weightedScore: 13.5, remarks: 'Good' },
        quality: { score: 4.6, maxScore: 5, weight: 20, weightedScore: 18.4, remarks: 'Good' },
        delivery: { score: 4.4, maxScore: 5, weight: 20, weightedScore: 17.6, remarks: 'Good' },
        financial: { score: 4.0, maxScore: 5, weight: 10, weightedScore: 8.0, remarks: 'Good' },
        governance: { score: 4.7, maxScore: 5, weight: 10, weightedScore: 9.4, remarks: 'Good' },
      },
      questionBreakdown: [
        { id: 'q1', pillar: 'commercial', question: 'Payment Terms', answer: 'Net 60 Days', score: 5, maxScore: 5, weightedScore: 5, remarks: 'Verified payment terms', attachmentName: 'Terms.pdf', ocrEvidence: 'Verified' },
      ],
      documents: [
        { id: 'doc1', name: 'ISO9001.pdf', type: 'Certificate', uploadDate: '2026-01-01', verified: true },
      ],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      vendorEvaluations: mockEvaluationRecords,
      currentMode: 'mode_3',
      rfqs: [],
      showToast: mockShowToast,
      buyerVendors: mockBuyerVendors,
      addBuyerVendor: mockAddBuyerVendor,
      updateBuyerVendor: mockUpdateBuyerVendor,
      deleteBuyerVendor: mockDeleteBuyerVendor,
      categoryTaxonomy: [
        { majorCategory: 'Mechanical', minorCategories: ['Valves', 'Pumps'] },
        { majorCategory: 'Electrical', minorCategories: ['Cables', 'Transformers'] },
      ],
      reviseVendorRating: mockReviseVendorRating,
      openRatingRevisionEmailModal: mockOpenRatingRevisionEmailModal,
      setCurrentMode: jest.fn(),
      adoptCreatedRFQ: jest.fn(),
    });
    (extractLineItemsFromDocument as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        title: 'Centrifugal Pump Package',
        category: 'Engineering Spares - Mechanical',
        targetDeliveryDate: A_FUTURE_DATE,
        estimatedBudget: 850000,
        extractedEntities: [
          {
            id: 'ent-1',
            itemName: 'Centrifugal Pump 500 GPM',
            quantity: 5,
            unit: 'Sets',
            targetDate: A_FUTURE_DATE,
            technicalSpecs: 'SS316 Impeller',
            confidence: 95,
            category: 'Pumps & Accessories',
            majorCategory: 'Engineering Spares - Mechanical',
            minorCategory: 'Pumps & Accessories',
          },
        ],
        source: 'web_portal',
      },
    });

    (classifyLineItems as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        extractedEntities: [
          {
            id: 'ent-1',
            itemName: 'Centrifugal Pump',
            majorCategory: 'Engineering Spares - Mechanical',
            minorCategory: 'Pumps & Accessories',
          },
        ],
      },
    });

    (uploadRFQAttachment as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        id: 'att-1',
        fileName: 'BOQ.xlsx',
        fileSize: 1024,
        contentType: 'application/vnd.ms-excel',
        storagePath: 'attachments/boq.xlsx',
        uploadedAt: new Date().toISOString(),
      },
    });

    (createRFQ as jest.Mock).mockResolvedValue({
      success: true,
      rfq: {
        id: 'rfq-test-1',
        rfqNumber: 'RFQ-2026-00999',
        title: 'Centrifugal Pump Package',
        status: 'Quotes Pending',
        sourcingMode: 'mode_2',
        quotesCount: 0,
        targetDeliveryDate: A_FUTURE_DATE,
        budget: 850000,
        deliveryLocation: 'Hazira Complex',
        deliveryPincode: '394270',
        attachments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        extractedEntities: [],
        quotes: [],
        chasingActive: false,
      },
    });
  });

  it('exercises all VendorSummary tabs, status filters, search filters, and modals', async () => {
    render(
      <AppProvider>
        <VendorSummary
          onViewEvaluation={mockOnViewEvaluation}
          onNavigateToWizard={mockOnNavigateToWizard}
        />
      </AppProvider>
    );

    // Filter by Status & Category dropdowns
    const comboboxes = screen.getAllByRole('combobox');
    const categorySelect = comboboxes[0];
    const statusSelect = comboboxes[1];

    if (categorySelect) {
      fireEvent.change(categorySelect, { target: { value: 'ALL' } });
    }

    if (statusSelect) {
      fireEvent.change(statusSelect, { target: { value: 'EVALUATED' } });
      fireEvent.change(statusSelect, { target: { value: 'NOT_EVALUATED' } });
      fireEvent.change(statusSelect, { target: { value: 'PREFERRED' } });
      fireEvent.change(statusSelect, { target: { value: 'CONDITIONAL' } });
      fireEvent.change(statusSelect, { target: { value: 'ALL' } });
    }


    // Click Edit button on a vendor
    const editBtns = screen.getAllByRole('button', { name: /Edit/i });
    if (editBtns.length > 0) {
      fireEvent.click(editBtns[0]);
      expect(screen.getByText('Edit Vendor Profile')).toBeInTheDocument();

      // Add a minor category tag
      const minorInput = screen.getByPlaceholderText(/Type category and press Add Tag/i);
      fireEvent.change(minorInput, { target: { value: 'Control Valves' } });
      fireEvent.keyDown(minorInput, { key: 'Enter', code: 'Enter' });

      // Click Add Tag button
      fireEvent.change(minorInput, { target: { value: 'Gate Valves' } });
      const addTagBtn = screen.getByRole('button', { name: /Add Tag/i });
      fireEvent.click(addTagBtn);

      // Save Changes
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      fireEvent.click(saveBtn);
    }

    // View Profile
    const viewProfileBtns = screen.getAllByRole('button', { name: /View Profile/i });
    if (viewProfileBtns.length > 0) {
      fireEvent.click(viewProfileBtns[0]);
      const closeBtn = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeBtn);
    }

    // Delete Modal
    const deleteBtns = screen.getAllByRole('button', { name: /Delete/i });
    if (deleteBtns.length > 0) {
      fireEvent.click(deleteBtns[0]);
      const confirmDeleteBtn = screen.getByRole('button', { name: /Delete Vendor/i });
      fireEvent.click(confirmDeleteBtn);
    }

    // View 360 Evaluation
    const view360Btns = screen.getAllByRole('button', { name: /View 360° Evaluation/i });
    if (view360Btns.length > 0) {
      fireEvent.click(view360Btns[0]);
      expect(mockOnViewEvaluation).toHaveBeenCalled();
    }

    // Trigger Evaluation
    const triggerBtns = screen.getAllByRole('button', { name: /Trigger Evaluation/i });
    if (triggerBtns.length > 0) {
      fireEvent.click(triggerBtns[0]);
    }

    // Upload Vendor button
    const uploadBtn = screen.getByRole('button', { name: /Upload Vendor/i });
    fireEvent.click(uploadBtn);
    expect(mockOnNavigateToWizard).toHaveBeenCalled();
  });

  it('exercises IngestionWizard line item mutations, auto categorization, and resets', async () => {
    const onComplete = jest.fn();
    const onCancel = jest.fn();

    render(
      <AppProvider>
        <IngestionWizard
          onComplete={onComplete}
          onCancel={onCancel}
          forceSubscription="version_3"
        />
      </AppProvider>
    );

    // Add line item — the button now also appears below the last line item,
    // so with one already present there are two matches; either works.
    const addBtn = screen.getAllByRole('button', { name: /Add Line Item/i })[0];
    fireEvent.click(addBtn);

    const itemInputs = screen.getAllByPlaceholderText(/e\.g\. Centrifugal water pump/i);
    fireEvent.change(itemInputs[0], { target: { value: 'Industrial Control Valve' } });

    // Auto categorize
    const autoCatBtn = screen.getByRole('button', { name: /Auto-Categorize All \(AI\)/i });
    fireEvent.click(autoCatBtn);
    await waitFor(() => expect(classifyLineItems).toHaveBeenCalled());

    // Clear form
    const clearBtn = screen.getAllByRole('button', { name: /Clear Form/i })[0];
    fireEvent.click(clearBtn);
  });

  it('exercises IngestionWizard with various subscription tiers and actions', async () => {
    const onComplete = jest.fn();
    const onCancel = jest.fn();

    const { rerender } = render(
      <AppProvider>
        <IngestionWizard
          onComplete={onComplete}
          onCancel={onCancel}
          forceSubscription="version_1"
        />
      </AppProvider>
    );

    // Rerender with version_2
    rerender(
      <AppProvider>
        <IngestionWizard
          onComplete={onComplete}
          onCancel={onCancel}
          forceSubscription="version_2"
        />
      </AppProvider>
    );

    // Rerender with free_trial
    rerender(
      <AppProvider>
        <IngestionWizard
          onComplete={onComplete}
          onCancel={onCancel}
          forceSubscription="free_trial"
        />
      </AppProvider>
    );

    // Rerender with version_3
    rerender(
      <AppProvider>
        <IngestionWizard
          onComplete={onComplete}
          onCancel={onCancel}
          forceSubscription="version_3"
        />
      </AppProvider>
    );

    // Select file & extract
    const file = new File(['content'], 'requisition.eml', { type: 'message/rfc822' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    const extractBtn = screen.getByRole('button', { name: /Extract Line Items with AI/i });
    fireEvent.click(extractBtn);
    await waitFor(() => expect(extractLineItemsFromDocument).toHaveBeenCalled());

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Create & Dispatch RFQ/i });
    fireEvent.change(screen.getByPlaceholderText(/Plant, warehouse or site address/i), {
      target: { value: 'Hazira Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 400701/i), {
      target: { value: '394270' },
    });

    fireEvent.click(submitBtn);
    await waitFor(() => expect(createRFQ).toHaveBeenCalled());
  });

  it('exercises VendorEvaluationSummary pillars and export actions', () => {
    const onBack = jest.fn();
    render(
      <AppProvider>
        <VendorEvaluationSummary
          vendorEvaluation={mockEvaluationRecords[0]}
          onBack={onBack}
        />
      </AppProvider>
    );

    // Click tabs: Commercial, Technical, Quality, Delivery, Financial, Governance, OCR Evidence
    const tabs = ['Commercial', 'Technical', 'Quality', 'Delivery', 'Financial', 'Governance', 'OCR Evidence'];
    tabs.forEach((tab) => {
      const tabBtn = screen.queryByRole('button', { name: new RegExp(tab, 'i') });
      if (tabBtn) fireEvent.click(tabBtn);
    });

    // Click back button
    const backBtn = screen.queryByRole('button', { name: /Back/i });
    if (backBtn) fireEvent.click(backBtn);
  });
});
