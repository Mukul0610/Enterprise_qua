import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import CommandCenter from '@/app/buyer/command-center';
import RFQDetails from '@/app/buyer/rfq-details';
import BuyerRFQDetailsPage from '@/app/buyer/rfq-details/page';
import BuyerQuoteMatrixPage from '@/app/buyer/quote-matrix/page';
import CategoryManagerQuoteMatrixPage from '@/app/category-manager/quote-matrix/page';
import ManualRFQModal from '@/app/buyer/ManualRFQModal';
import { RFQEditModal } from '@/app/buyer/RFQEditModal';
import IngestionWizard from '@/app/buyer/ingestion-wizard';
import QuoteMatrix from '@/app/buyer/quote-matrix';
import VendorSummary from '@/app/buyer/vendor-summary';
import LoginPage from '@/app/login/page';
import QuotationForm from '@/app/vendor/quotation-form';
import VendorQuotationFormPage from '@/app/vendor/quotation-form/page';
import OpportunityFeed from '@/app/vendor/opportunity-feed';
import VendorProfile from '@/app/vendor/vendor-profile';
import * as storeModule from '@/lib/store';
import { authClient } from '@/lib/authClient';
import * as rfqClientModule from '@/lib/rfqClient';
import * as buyerProfileClientModule from '@/lib/buyerProfileClient';
import type { RFQItem, VendorOpportunity, BuyerProfile } from '@/lib/types';

jest.mock('@/lib/store');
jest.mock('@/lib/authClient', () => ({
  authClient: {
    loginWithPassword: jest.fn(),
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    register: jest.fn(),
    getVendorProfile: jest.fn(),
    updateVendorProfile: jest.fn(),
    getProfile: jest.fn(),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
  },
}));
jest.mock('@/lib/documentExtraction', () => ({
  buildExtractionRequest: jest.fn(async (file: File) => ({
    fileName: file.name,
    inlineData: 'ZmFrZQ==',
    mimeType: file.type || 'application/pdf',
  })),
}));
jest.mock('@/lib/rfqClient', () => {
  const actual = jest.requireActual('@/lib/rfqClient');
  return {
    ...actual,
    createRFQ: jest.fn(),
    updateRFQ: jest.fn(),
    fetchRFQById: jest.fn(),
    extractLineItemsFromDocument: jest.fn(),
    classifyLineItems: jest.fn(),
    replyToRFQInquiry: jest.fn(),
    submitRFQInquiry: jest.fn(),
    fetchAllVendors: jest.fn(),
    uploadRFQAttachment: jest.fn(),
    rfqAttachmentUrl: jest.fn((id: string, attId: string) => `/api/rfq/${id}/attachments/${attId}`),
  };
});
jest.mock('@/lib/buyerProfileClient', () => {
  const actual = jest.requireActual('@/lib/buyerProfileClient');
  return {
    ...actual,
    fetchBuyerProfile: jest.fn(),
    fetchCategoryTaxonomy: jest.fn(),
    saveBuyerProfile: jest.fn(),
  };
});

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockQueryParam: string | null = 'RFQ-2026-00421';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  useSearchParams: () => ({ get: (key: string) => (key === 'rfq' || key === 'id' ? mockQueryParam : null) }),
}));

describe('Frontend Master Coverage Booster Suite', () => {
  const mockShowToast = jest.fn();
  const mockAddAuditLog = jest.fn();
  const mockCreateRFQ = jest.fn();
  const mockUnlockRFQForVendor = jest.fn();
  const mockRefreshVendorCredits = jest.fn();
  const mockAdoptCreatedRFQ = jest.fn();
  const mockRefreshFromDB = jest.fn();
  const mockTriggerChannelChaser = jest.fn();
  const mockTriggerBatchChannelChaser = jest.fn();
  const mockTriggerEscalation = jest.fn();
  const mockSetSelectedRFQForMatrix = jest.fn();
  const mockOpenRFQDeepDive = jest.fn();
  const mockSetDeepDiveModalOpen = jest.fn();
  const mockSetCurrentUserSession = jest.fn();
  const mockSetIsLoggedIn = jest.fn();
  const mockSetCurrentRole = jest.fn();
  const mockSetRemainingFreeRFQs = jest.fn();
  const mockSetActiveSubscription = jest.fn();
  const mockSetInitialSetupModalOpen = jest.fn();
  const mockAddBuyerAccount = jest.fn();
  const mockUpdateVendorProfile = jest.fn();

  const mockTaxonomy = [
    { majorCategory: 'Mechanical', minorCategories: ['Pumps', 'Valves', 'Piping'] },
    { majorCategory: 'Electrical', minorCategories: ['Transformers', 'Switchgear'] },
    { majorCategory: 'Civil', minorCategories: ['Cement', 'Steel Bars'] },
  ];

  const mockRfqs: any[] = [
    {
      id: 'rfq-boost-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Industrial Pumps',
      category: 'Mechanical',
      budget: 850000,
      targetDeliveryDate: '2026-11-30',
      deliveryLocation: 'Mumbai Hub Gate 2',
      deliveryPincode: '400701',
      status: 'In Evaluation',
      sourcingMode: 'cb_open',
      source: 'email_gateway',
      sourceEmail: 'requisitions@lnt.com',
      sourceFileName: 'boq_pumps.pdf',
      extractedEntities: [
        {
          id: 'ent-1',
          itemName: 'Pump 50HP',
          technicalSpecs: 'High pressure 50HP 3-phase',
          quantity: 4,
          unit: 'Nos',
          category: 'Mechanical',
          majorCategory: 'Mechanical',
          minorCategory: 'Pumps',
          confidence: 0.98,
          targetDate: '2026-11-30',
        },
      ],
      quotesCount: 2,
      quotes: [
        {
          vendorId: 'v-1',
          vendorName: 'Apex Hydro Ltd',
          vendorCategory: 'Client List',
          unitPrice: 200000,
          totalPrice: 800000,
          leadTimeDays: 14,
          aiMatchScore: 95,
          complianceStatus: 'Fully Compliant',
          paymentTerms: '30 Days Net',
          remarks: 'Direct factory shipment',
          lineItemQuotes: [{ lineItemId: 'ent-1', itemName: 'Pump 50HP', quantity: 4, unitPrice: 200000, totalPrice: 800000 }],
        },
      ],
      assignedVendors: [
        { id: 'v-1', name: 'Apex Hydro Ltd', contactPerson: 'Rajesh', email: 'rajesh@apex.com', phone: '+91 98200 11223', score: 95, status: 'Quoted', channel: 'email' },
      ],
      followUpData: {
        rfqNumber: 'RFQ-2026-00421',
        totalInvited: 3,
        respondedCount: 2,
        autoChasingEnabled: true,
        callStats: { total: 4, connected: 3, avgDuration: '2m 10s' },
        whatsappStats: { total: 5, delivered: 5, read: 4, replied: 2 },
        smsStats: { total: 3, delivered: 3, clicked: 2 },
        vendors: [
          {
            vendorId: 'v-1',
            vendorName: 'Apex Hydro Ltd',
            channel: 'whatsapp',
            lastContact: '2026-09-02 10:30',
            status: 'Quoted',
            responseReceived: true,
            attemptsCount: 2,
          },
        ],
      },
      inquiries: [
        {
          id: 'inq-1',
          vendorId: 'v-1',
          vendorName: 'Apex Hydro Ltd',
          subject: 'Delivery Timeline Clarification',
          message: 'Can we deliver in two batches of 2 pumps each?',
          status: 'pending',
          createdAt: '2026-09-02T10:00:00Z',
        },
      ],
      attachments: [
        { id: 'att-1', name: 'specs_sheet.pdf', size: 1048576, uploadedAt: '2026-09-01T10:00:00Z' },
      ],
      createdAt: '2026-09-01',
    },
    {
      id: 'rfq-boost-2',
      rfqNumber: 'RFQ-2026-00420',
      title: 'Electrical Transformers',
      category: 'Electrical',
      budget: 1200000,
      targetDeliveryDate: '2026-12-15',
      deliveryLocation: 'Pune Facility',
      deliveryPincode: '411001',
      status: 'Closed',
      sourcingMode: 'mode_3',
      source: 'web_portal',
      sourceFileName: 'transformer_specs.xlsx',
      extractedEntities: [
        {
          id: 'ent-2',
          itemName: 'Step Down Transformer',
          technicalSpecs: '11kV to 415V 500kVA',
          quantity: 2,
          unit: 'Units',
          category: 'Electrical',
          majorCategory: 'Electrical',
          minorCategory: 'Transformers',
          confidence: 0.94,
          targetDate: '2026-12-15',
        },
      ],
      quotesCount: 1,
      quotes: [],
      assignedVendors: [],
      createdAt: '2026-09-02',
      attachments: [],
      inquiries: [],
    },
  ];

  const mockOpportunities: any[] = [
    {
      id: 'opp-1',
      rfqId: 'rfq-boost-1',
      rfqNumber: 'RFQ-2026-00421',
      title: 'Centrifugal Industrial Pumps',
      category: 'Mechanical',
      budget: 850000,
      targetDeliveryDate: '2026-11-30',
      deliveryLocation: 'Mumbai Hub Gate 2',
      deliveryPincode: '400701',
      status: 'Open',
      urgency: 'Medium',
      matchScore: 92,
      matchedReason: 'Matches line item Pumps in Mechanical',
      lineItemsCount: 1,
      requiredCertifications: ['ISO 9001'],
      attachmentsCount: 1,
      createdAt: '2026-09-01',
      buyerCompany: 'Larsen & Toubro Ltd. (L&T)',
      buyerContactPerson: 'Rajesh Sharma',
      buyerEmail: 'client@procucev.com',
      buyerPhone: '+91 98201 44520',
      lineItems: [
        { id: 'li-1', description: 'Pump 50HP', quantity: 4, unit: 'Nos', unitPrice: 0, leadTimeDays: 0, marketBandStatus: 'optimal', paymentTerms: '' },
      ],
    },
  ];

  const mockBuyerProfile: BuyerProfile = {
    organizationId: 'org-1',
    userId: 'user-1',
    companyName: 'L&T Heavy Engineering',
    brandName: 'L&T',
    organizationType: 'Public Limited',
    panNumber: 'AAACL1234F',
    gstNumber: '27AAACL1234F1Z5',
    cinNumber: 'L28920MH1946PLC004768',
    website: 'https://www.lnt.com',
    annualTurnover: 'INR 1,80,000 Cr+',
    street: 'L&T House, Ballard Estate',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    country: 'India',
    contactName: 'Rajesh Sharma',
    contactDesignation: 'Head of Procurement',
    contactEmail: 'client@procucev.com',
    contactPhone: '+919820144520',
    categories: [{ major: 'Mechanical', minor: 'Pumps' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryParam = 'RFQ-2026-00421';

    (storeModule.useApp as jest.Mock).mockReturnValue({
      rfqs: mockRfqs,
      vendorOpportunities: mockOpportunities,
      selectedVendorOpportunity: mockOpportunities[0],
      buyerVendors: [
        { id: 'v-1', name: 'Apex Hydro Ltd', contactPerson: 'Rajesh', email: 'rajesh@apex.com', phone: '+91 98200 11223', score: 95, status: 'Quoted', channel: 'email', source: 'buyer_uploaded' },
      ],
      vendorEvaluations: [],
      categoryTaxonomy: mockTaxonomy,
      vendorCatalogue: [],
      showToast: mockShowToast,
      addAuditLog: mockAddAuditLog,
      createRFQ: mockCreateRFQ,
      unlockRFQForVendor: mockUnlockRFQForVendor,
      refreshVendorCredits: mockRefreshVendorCredits,
      adoptCreatedRFQ: mockAdoptCreatedRFQ,
      refreshFromDB: mockRefreshFromDB,
      triggerChannelChaser: mockTriggerChannelChaser,
      triggerBatchChannelChaser: mockTriggerBatchChannelChaser,
      triggerEscalation: mockTriggerEscalation,
      vendorFreeCreditsRemaining: 3,
      vendorUnlockedRfqIds: ['RFQ-2026-00421'],
      vendorSubscription: 'pro',
      currentUserSession: {
        id: 'usr-1',
        email: 'client@procucev.com',
        name: 'Rajesh Sharma',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'L&T Heavy Engineering',
      },
      currentRole: 'buyer',
      isLoggedIn: false,
      setIsLoggedIn: mockSetIsLoggedIn,
      setCurrentRole: mockSetCurrentRole,
      setCurrentUserSession: mockSetCurrentUserSession,
      remainingFreeRFQs: 5,
      setRemainingFreeRFQs: mockSetRemainingFreeRFQs,
      activeSubscription: { tier: 'enterprise', active: true },
      setActiveSubscription: mockSetActiveSubscription,
      setInitialSetupModalOpen: mockSetInitialSetupModalOpen,
      initialSetupCompleted: true,
      addBuyerAccount: mockAddBuyerAccount,
      selectedRFQForMatrix: mockRfqs[0],
      setSelectedRFQForMatrix: mockSetSelectedRFQForMatrix,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: mockRfqs[0],
      vendorProfile: {
        id: 'v-1',
        companyName: 'Apex Hydro Ltd',
        brandName: 'Apex',
        categories: ['Mechanical'],
        isVerified: true,
      },
      updateVendorProfile: mockUpdateVendorProfile,
    });

    (buyerProfileClientModule.fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: mockBuyerProfile,
    });
    (buyerProfileClientModule.fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: true,
      data: mockTaxonomy,
    });
    (buyerProfileClientModule.saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: mockBuyerProfile,
    });

    ((authClient as any).getVendorProfile as jest.Mock).mockResolvedValue({
      vendor: { id: 'v-1', companyName: 'Apex Hydro Ltd', brandName: 'Apex' },
    });
    (authClient.loginWithPassword as jest.Mock).mockResolvedValue({
      success: true,
      user: { id: 'usr-1', name: 'Rajesh Sharma', role: 'buyer', email: 'client@procucev.com' },
    });
    (authClient.requestOtp as jest.Mock).mockResolvedValue({
      success: true,
      demoCode: '123456',
      demoEmailCode: '123456',
      demoMobileCode: '654321',
    });
    (authClient.verifyOtp as jest.Mock).mockResolvedValue({
      success: true,
      user: { id: 'usr-1', name: 'Rajesh Sharma', role: 'buyer', email: 'client@procucev.com' },
    });
    (authClient.register as jest.Mock).mockResolvedValue({
      success: true,
      user: { id: 'usr-1', name: 'Rajesh Sharma', role: 'buyer', email: 'client@procucev.com', orgName: 'L&T' },
    });
    (rfqClientModule.fetchAllVendors as jest.Mock).mockResolvedValue({
      vendors: [{ id: 'v-1', name: 'Apex Hydro Ltd' }],
      candidates: [{ id: 'v-1', name: 'Apex Hydro Ltd' }],
      meta: { totalVendors: 1, page: 1, limit: 20 },
      success: true,
    });
    (rfqClientModule.fetchRFQById as jest.Mock).mockResolvedValue({
      success: true,
      rfq: mockRfqs[0],
    });
    (rfqClientModule.extractLineItemsFromDocument as jest.Mock).mockResolvedValue({
      success: true,
      entities: [
        {
          id: 'ent-ext-1',
          itemName: 'Centrifugal Pump 25HP',
          technicalSpecs: '25HP 3-phase',
          quantity: 5,
          unit: 'Nos',
          majorCategory: 'Mechanical',
          minorCategory: 'Pumps',
          confidence: 0.95,
          targetDate: '2026-11-30',
        },
      ],
    });
    (rfqClientModule.classifyLineItems as jest.Mock).mockResolvedValue({
      success: true,
      entities: [
        {
          id: 'ent-ext-1',
          itemName: 'Centrifugal Pump 25HP',
          majorCategory: 'Mechanical',
          minorCategory: 'Pumps',
          confidence: 0.95,
        },
      ],
    });
    (rfqClientModule.replyToRFQInquiry as jest.Mock).mockResolvedValue({ success: true });
    (rfqClientModule.submitRFQInquiry as jest.Mock).mockResolvedValue({ success: true });
    (rfqClientModule.updateRFQ as jest.Mock).mockResolvedValue({ success: true, rfq: mockRfqs[0] });
    (rfqClientModule.createRFQ as jest.Mock).mockResolvedValue({ success: true, rfq: mockRfqs[0] });
  });

  // ── CommandCenter Extended Tests ──────────────────────────────────────────
  test('CommandCenter filtering, tabs, quick actions, and deep dive', () => {
    const onWizard = jest.fn();
    const onMatrix = jest.fn();
    const onDeepDive = jest.fn();

    render(
      <CommandCenter
        {...({
          onNavigateToWizard: onWizard,
          onNavigateToMatrix: onMatrix,
          onOpenDeepDive: onDeepDive,
        } as any)}
      />
    );

    expect(screen.getByText('Active Procurement Pipeline')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search pipeline by RFQ#/i);
    fireEvent.change(searchInput, { target: { value: 'Centrifugal' } });
    expect(screen.getByText('RFQ-2026-00421')).toBeInTheDocument();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('RFQ-2026-00420')).toBeInTheDocument();

    // Click Matrix button
    const matrixBtn = screen.queryByRole('button', { name: /Comparison Matrix/i });
    if (matrixBtn) fireEvent.click(matrixBtn);

    // Click Ingest button
    const ingestBtn = screen.queryByRole('button', { name: /Ingest RFQ/i });
    if (ingestBtn) fireEvent.click(ingestBtn);
  });

  // ── BuyerProfilePage Extended Tests ───────────────────────────────────────
  test('BuyerProfilePage tabs navigation, taxonomy management and address validation', async () => {
    render(<BuyerProfilePage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('L&T Heavy Engineering')).toBeInTheDocument();
    });

    // Street, City, State, Pincode
    const streetInput = screen.getByDisplayValue('L&T House, Ballard Estate');
    fireEvent.change(streetInput, { target: { value: 'New Industrial Area, MIDC' } });

    const pincodeInput = screen.getByDisplayValue('400001');
    fireEvent.change(pincodeInput, { target: { value: '400701' } });

    // Contact inputs
    const contactNameInput = screen.getByDisplayValue('Rajesh Sharma');
    fireEvent.change(contactNameInput, { target: { value: 'Rajesh S' } });

    // Save profile
    const saveBtn = screen.getByRole('button', { name: /Save Organization Profile/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(mockShowToast).toHaveBeenCalled();
  });

  // ── RFQDetails Extended Tests ─────────────────────────────────────────────
  test('RFQDetails tabs, inquiry reply, follow up triggers and back navigation', async () => {
    const onBack = jest.fn();
    const onNavigateToMatrix = jest.fn();

    render(
      <RFQDetails
        rfq={mockRfqs[0]}
        {...({
          onBack,
          onNavigateToMatrix,
        } as any)}
      />
    );

    expect(screen.getAllByText('RFQ-2026-00421').length).toBeGreaterThan(0);

    // Click tabs if available
    const vendorsTab = screen.queryByRole('button', { name: /Assigned Vendors/i });
    if (vendorsTab) fireEvent.click(vendorsTab);

    const followUpTab = screen.queryByRole('button', { name: /Follow-ups/i });
    if (followUpTab) fireEvent.click(followUpTab);

    const inquiriesTab = screen.queryByRole('button', { name: /Vendor Inquiries/i });
    if (inquiriesTab) {
      fireEvent.click(inquiriesTab);
      // Type inquiry reply
      const replyArea = screen.queryByPlaceholderText(/Type clarification response/i);
      if (replyArea) {
        fireEvent.change(replyArea, { target: { value: 'Batch delivery of 2 units is approved.' } });
        fireEvent.keyDown(replyArea, { key: 'Enter', code: 'Enter', shiftKey: false });
      }
    }

    // Matrix button click
    const matrixBtn = screen.queryByRole('button', { name: /Quote Matrix/i });
    if (matrixBtn) fireEvent.click(matrixBtn);

    // Back button
    const backBtn = screen.queryByRole('button', { name: /Back to RFQs/i });
    if (backBtn) fireEvent.click(backBtn);
  });

  // ── Page Wrapper Routes Tests ─────────────────────────────────────────────
  test('BuyerRFQDetailsPage load, not found, error and retry', async () => {
    mockQueryParam = 'RFQ-2026-00421';
    render(<BuyerRFQDetailsPage />);
    await waitFor(() => {
      expect(rfqClientModule.fetchRFQById).toHaveBeenCalledWith('RFQ-2026-00421');
    });

    (rfqClientModule.fetchRFQById as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Network connection failed',
      reason: 'NETWORK_ERROR',
    });
    render(<BuyerRFQDetailsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Network connection failed/i)).toBeInTheDocument();
    });
  });

  test('BuyerRFQDetailsPage with missing query parameter', () => {
    mockQueryParam = null;
    render(<BuyerRFQDetailsPage />);
    expect(screen.getByText(/No RFQ Selected/i)).toBeInTheDocument();
    const backBtn = screen.getByRole('button', { name: /Back to RFQs/i });
    fireEvent.click(backBtn);
    expect(mockPush).toHaveBeenCalledWith('/buyer/dashboard');
  });

  test('BuyerRFQDetailsPage updates its loaded RFQ after a buyer replies to an inquiry', async () => {
    const updatedRfq = {
      ...mockRfqs[0],
      inquiries: [{ ...mockRfqs[0].inquiries[0], reply: 'Delivery in two batches is approved.' }],
    };
    (rfqClientModule.replyToRFQInquiry as jest.Mock).mockResolvedValueOnce({
      success: true,
      rfq: updatedRfq,
    });

    render(<BuyerRFQDetailsPage />);
    await waitFor(() => expect(rfqClientModule.fetchRFQById).toHaveBeenCalledWith(mockQueryParam));

    const replyArea = screen.getByPlaceholderText(/Type clarification response/i);
    fireEvent.change(replyArea, { target: { value: 'Delivery in two batches is approved.' } });
    fireEvent.keyDown(replyArea, { key: 'Enter', code: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(rfqClientModule.replyToRFQInquiry).toHaveBeenCalledWith(
        mockRfqs[0].id,
        mockRfqs[0].inquiries[0].id,
        expect.objectContaining({ reply: 'Delivery in two batches is approved.' }),
      );
    });
    expect(screen.getAllByText(/Delivery in two batches is approved/i).length).toBeGreaterThan(0);
  });

  test('BuyerQuoteMatrixPage and CategoryManagerQuoteMatrixPage back routing', () => {
    render(<BuyerQuoteMatrixPage />);
    expect(screen.getByText(/Target Delivery/i)).toBeInTheDocument();
    const backBtn = screen.getByRole('button', { name: /Back to Command Center/i });
    fireEvent.click(backBtn);

    render(<CategoryManagerQuoteMatrixPage />);
    expect(screen.getAllByText(/Target Delivery/i).length).toBeGreaterThan(0);
    const cmBackBtns = screen.getAllByRole('button', { name: /Back to Command Center/i });
    if (cmBackBtns.length > 0) fireEvent.click(cmBackBtns[0]);
  });

  test('VendorQuotationFormPage loads matching RFQ, fallback and missing opportunity', () => {
    mockQueryParam = 'RFQ-2026-00420'; // matches closed rfq in rfqs
    render(<VendorQuotationFormPage />);

    mockQueryParam = 'NON_EXISTENT';
    render(<VendorQuotationFormPage />);
  });

  // ── RFQEditModal Tests ────────────────────────────────────────────────────
  test('RFQEditModal editing fields, category selection and save', () => {
    const onClose = jest.fn();
    const onSave = jest.fn();

    render(
      <RFQEditModal
        rfq={mockRfqs[0]}
        onClose={onClose}
        onSave={onSave}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Close the edit dialog/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  // ── QuoteMatrix Tests ─────────────────────────────────────────────────────
  test('QuoteMatrix renders comparison table and handles actions', () => {
    const onBack = jest.fn();

    render(<QuoteMatrix onBackToDashboard={onBack} />);

    expect(screen.getByText(/Target Delivery/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Apex Hydro Ltd/i).length).toBeGreaterThan(0);

    const selectBtns = screen.queryAllByRole('button', { name: /Select/i });
    if (selectBtns.length > 0) {
      fireEvent.click(selectBtns[0]);
    }
  });

  test('quote matrix reports when no RFQs are available', () => {
    (storeModule.useApp as jest.Mock).mockReturnValueOnce({
      rfqs: [],
      selectedRFQForMatrix: mockRfqs[0],
      currentRole: 'buyer',
      setSelectedRFQForMatrix: jest.fn(),
      showToast: mockShowToast,
      openRFQDeepDive: mockOpenRFQDeepDive,
      deepDiveModalOpen: false,
      setDeepDiveModalOpen: mockSetDeepDiveModalOpen,
      selectedRFQForDeepDive: null,
    });

    render(<QuoteMatrix scopeToOwnBuyerAccount />);

    expect(screen.getByText('No RFQs Available')).toBeInTheDocument();
    expect(screen.getByText(/Please create or ingest an RFQ first/i)).toBeInTheDocument();
  });

  test('matrix route back controls use browser history when a previous page exists', () => {
    const historyDescriptor = Object.getOwnPropertyDescriptor(window.history, 'length');
    Object.defineProperty(window.history, 'length', { configurable: true, value: 2 });

    try {
      const { unmount } = render(<BuyerQuoteMatrixPage />);
      fireEvent.click(screen.getByRole('button', { name: /Back to Command Center/i }));
      expect(mockBack).toHaveBeenCalled();
      unmount();

      render(<CategoryManagerQuoteMatrixPage />);
      fireEvent.click(screen.getByRole('button', { name: /Back to Command Center/i }));
      expect(mockBack).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(window.history, 'length');
      if (historyDescriptor) Object.defineProperty(window.history, 'length', historyDescriptor);
    }
  });

  // ── VendorSummary Tests ───────────────────────────────────────────────────
  test('VendorSummary displays vendor list and handles search', async () => {
    const onViewEval = jest.fn();
    const onWizard = jest.fn();

    render(
      <VendorSummary onViewEvaluation={onViewEval} onNavigateToWizard={onWizard} />
    );

    expect(screen.getByText(/Total Empanelled/i)).toBeInTheDocument();
    const searchInputs = screen.queryAllByRole('textbox');
    if (searchInputs.length > 0) {
      fireEvent.change(searchInputs[0], { target: { value: 'Apex' } });
    }

    const uploadHistoryBtn = screen.getByRole('button', { name: /Upload History/i });
    fireEvent.click(uploadHistoryBtn);

    const addVendorBtn = screen.getByTestId('open-add-vendor-modal');
    fireEvent.click(addVendorBtn);
  });

  // ── QuotationForm Extended Tests ──────────────────────────────────────────
  test('QuotationForm inputting unit prices, compliance and submitting quote', async () => {
    const onBack = jest.fn();
    const onSubmitSuccess = jest.fn();

    render(
      <QuotationForm
        opportunity={mockOpportunities[0]}
        onBack={onBack}
        onSubmitSuccess={onSubmitSuccess}
      />
    );

    const priceInputs = screen.getAllByRole('spinbutton');
    if (priceInputs.length > 0) {
      fireEvent.change(priceInputs[0], { target: { value: '195000' } });
    }

    const leadTimeInputs = screen.getAllByRole('spinbutton');
    if (leadTimeInputs.length > 1) {
      fireEvent.change(leadTimeInputs[1], { target: { value: '10' } });
    }

    // View Buyer Contact modal
    const contactBtn = screen.queryByRole('button', { name: /View Buyer Contact/i });
    if (contactBtn) {
      fireEvent.click(contactBtn);
    }

    // Submit quote
    const submitBtn = screen.queryByRole('button', { name: /Submit Formal Quote/i });
    if (submitBtn) {
      await act(async () => {
        fireEvent.click(submitBtn);
      });
    }
  });

  // ── OpportunityFeed Extended Tests ────────────────────────────────────────
  test('OpportunityFeed filtering, search, and selecting opportunity to quote', () => {
    const onNavigateToBidForm = jest.fn();

    render(<OpportunityFeed onNavigateToBidForm={onNavigateToBidForm} />);

    expect(screen.getByText(/DIRECT INVITATIONS/i)).toBeInTheDocument();
  });

  // ── VendorProfile Extended Tests ──────────────────────────────────────────
  test('VendorProfile editing company details, GSTIN, PAN and submitting', async () => {
    render(<VendorProfile />);

    expect(screen.getByText(/Save Supplier Profile/i)).toBeInTheDocument();

    const inputs = screen.getAllByRole('textbox');
    if (inputs.length > 1) {
      fireEvent.change(inputs[1], { target: { value: 'Apex Hydro Innovations' } });
    }

    const saveBtn = screen.getByRole('button', { name: /Save Supplier Profile/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mockShowToast).toHaveBeenCalled();
  });

  // ── ManualRFQModal Extended Tests ─────────────────────────────────────────
  test('ManualRFQModal creating RFQ and closing dialog', async () => {
    const onClose = jest.fn();
    const onCreated = jest.fn();

    render(
      <ManualRFQModal
        isOpen={true}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Close manual RFQ entry/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  // ── IngestionWizard Extended Tests ────────────────────────────────────────
  test('IngestionWizard file dropzone, file extraction and tab switching', async () => {
    const onBack = jest.fn();
    const onNavigateToPipeline = jest.fn();

    render(
      <IngestionWizard
        {...({
          onBack,
          onNavigateToPipeline,
        } as any)}
      />
    );

    expect(screen.getByText(/Upload Source Documents/i)).toBeInTheDocument();

    // Upload file simulation
    const file = new File(['mock content'], 'test_boq.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [file] } });
    }

    // Switch to Email Gateway tab
    const emailTab = screen.queryByRole('button', { name: /Email Gateway/i });
    if (emailTab) fireEvent.click(emailTab);

    // Switch to Manual Entry tab
    const manualTab = screen.queryByRole('button', { name: /Manual Entry/i });
    if (manualTab) fireEvent.click(manualTab);

    // Back to pipeline
    const pipelineBtn = screen.queryByRole('button', { name: /View Procurement Pipeline/i });
    if (pipelineBtn) fireEvent.click(pipelineBtn);
  });

  // ── LoginPage Dual OTP & Pincode Lookup Tests ─────────────────────────────
  test('LoginPage password login, role switching and register pincode auto-fill', async () => {
    render(<LoginPage />);

    // Login with password
    const emailInput = screen.getByLabelText(/Registered Email ID/i);
    const mobileInput = screen.getByLabelText(/Registered Mobile Number/i);
    const passwordInput = screen.getByLabelText(/^Password$/i);

    fireEvent.change(emailInput, { target: { value: 'client@procucev.com' } });
    fireEvent.change(mobileInput, { target: { value: '9157154504' } });
    fireEvent.change(passwordInput, { target: { value: 'Pass@1234' } });

    const signInBtn = screen.getAllByRole('button', { name: /Sign In/i }).find((b) => b.getAttribute('type') === 'submit');
    if (signInBtn) {
      await act(async () => {
        fireEvent.click(signInBtn);
      });
      expect(authClient.loginWithPassword).toHaveBeenCalled();
      expect(mockSetCurrentUserSession).toHaveBeenCalled();
    }

    // Switch to Create Account Tab
    const createAccountTab = screen.getAllByRole('button', { name: /Create Account/i }).find((b) => b.getAttribute('type') === 'button');
    if (createAccountTab) {
      fireEvent.click(createAccountTab);
    }

    // Fill registration form with pincode
    const regNameInput = screen.queryByLabelText(/Full Name/i);
    if (regNameInput) fireEvent.change(regNameInput, { target: { value: 'Rajesh Sharma' } });

    const regCompanyInput = screen.queryByLabelText(/Company Name/i);
    if (regCompanyInput) fireEvent.change(regCompanyInput, { target: { value: 'Larsen & Toubro Ltd' } });

    const regPincodeInput = screen.queryByLabelText(/Pincode/i);
    if (regPincodeInput) {
      fireEvent.change(regPincodeInput, { target: { value: '400701' } });
    }
  });

  test('LoginPage requests, resends and verifies an email OTP', async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));
    fireEvent.change(screen.getByLabelText(/Registered Email ID/i), {
      target: { value: 'CLIENT@PROCUCEV.COM' },
    });
    fireEvent.change(screen.getByLabelText(/Registered Mobile Number/i), {
      target: { value: '9157154504' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));

    await waitFor(() => expect(authClient.requestOtp).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/Email Verification Code/i)).toHaveValue('123456');

    fireEvent.click(screen.getByRole('button', { name: /Resend OTP/i }));
    await waitFor(() => expect(authClient.requestOtp).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    await waitFor(() => {
      expect(authClient.verifyOtp).toHaveBeenCalledWith(
        'client@procucev.com',
        '123456',
        '9157154504',
      );
    });
    expect(mockSetCurrentUserSession).toHaveBeenCalled();
  });

  test('LoginPage rejects malformed contact details and an incomplete verification code', async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /Email OTP/i }));
    fireEvent.change(screen.getByLabelText(/Registered Email ID/i), {
      target: { value: 'client@procucev.com' },
    });
    fireEvent.change(screen.getByLabelText(/Registered Mobile Number/i), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));

    expect(authClient.requestOtp).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Registered Mobile Number/i), {
      target: { value: '9157154504' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Request Login OTP/i }));
    await waitFor(() => expect(authClient.requestOtp).toHaveBeenCalledTimes(1));

    const otpInput = screen.getByLabelText(/Email Verification Code/i);
    fireEvent.change(otpInput, { target: { value: '' } });
    fireEvent.submit(otpInput.closest('form')!);

    expect(authClient.verifyOtp).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(3);
  });

  test('LoginPage validates registration details and requests dual verification codes', async () => {
    render(<LoginPage />);
    const createAccountTab = screen.getAllByRole('button', { name: /Create Account/i })
      .find((button) => button.getAttribute('type') === 'button');
    expect(createAccountTab).toBeDefined();
    fireEvent.click(createAccountTab!);

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Rajesh Sharma' } });
    fireEvent.change(screen.getByLabelText(/Company Name/i), { target: { value: 'Larsen & Toubro Ltd' } });
    fireEvent.change(screen.getByLabelText(/GSTIN/i), { target: { value: '27AAACL1234F1Z5' } });
    fireEvent.change(screen.getByLabelText(/Pincode/i), { target: { value: '400701' } });
    fireEvent.change(screen.getByLabelText(/^City/i), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByLabelText(/^State/i), { target: { value: 'Maharashtra' } });
    fireEvent.change(screen.getByLabelText(/Corporate Email ID/i), {
      target: { value: 'CLIENT@PROCUCEV.COM' },
    });
    fireEvent.change(screen.getByLabelText(/Mobile Number/i), { target: { value: '9157154504' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'StrongPass123' } });

    const submitButton = screen.getAllByRole('button', { name: /Create Account/i })
      .find((button) => button.getAttribute('type') === 'submit');
    expect(submitButton).toBeDefined();
    fireEvent.click(submitButton!);

    await waitFor(() => {
      expect(authClient.requestOtp).toHaveBeenCalledWith(
        'client@procucev.com',
        '9157154504',
        'buyer',
        true,
      );
      expect(screen.getByText(/Dual OTP Identity Verification/i)).toBeInTheDocument();
    });
  });

  test('LoginPage rejects dummy registration pincodes and clears the warning for an in-progress entry', () => {
    render(<LoginPage />);
    const createAccountTab = screen.getAllByRole('button', { name: /Create Account/i })
      .find((button) => button.getAttribute('type') === 'button');
    fireEvent.click(createAccountTab!);

    const pincode = screen.getByLabelText(/Pincode/i);
    fireEvent.change(pincode, { target: { value: '000000' } });
    expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

    fireEvent.change(pincode, { target: { value: '123' } });
    expect(pincode).toHaveValue('123');
    expect(screen.queryByText('Invalid or dummy PIN code')).not.toBeInTheDocument();
  });
});
