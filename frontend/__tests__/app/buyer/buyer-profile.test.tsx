import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import BuyerProfilePage from '@/app/buyer/buyer-profile';
import { useApp } from '@/lib/store';
import {
  fetchBuyerProfile,
  fetchCategoryTaxonomy,
  saveBuyerProfile,
} from '@/lib/buyerProfileClient';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';
import type { BuyerProfile } from '@/lib/types';

jest.mock('@/lib/store', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/lib/buyerProfileClient', () => ({
  fetchBuyerProfile: jest.fn(),
  fetchCategoryTaxonomy: jest.fn(),
  saveBuyerProfile: jest.fn(),
  flattenCategorySelection: jest.requireActual('@/lib/buyerProfileClient').flattenCategorySelection,
  expandCategorySelection: jest.requireActual('@/lib/buyerProfileClient').expandCategorySelection,
}));

const TAXONOMY = [
  {
    majorCategory: 'Civil Works',
    minorCategories: ['Piling', 'Excavation', 'Waterproofing', 'Roofing', 'Bricks'],
  },
  { majorCategory: 'IT', minorCategories: ['Laptop', 'Servers', 'Software'] },
  { majorCategory: 'Logistics', minorCategories: ['Road transport'] },
  { majorCategory: 'Raw Material', minorCategories: ['Steels'] },
  { majorCategory: 'Packing Material', minorCategories: ['Pet Jars'] },
  { majorCategory: 'Professional Services', minorCategories: ['Consultant'] },
];

const PROFILE: BuyerProfile = {
  organizationId: 'org-1',
  userId: 'user-1',
  companyName: 'Navin Chaudhary Enterprises',
  brandName: 'NC Heavy Engineering',
  organizationType: 'Public Limited',
  panNumber: 'AAACL1234F',
  gstNumber: '27AAACL1234F1Z5',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.example.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'L&T House, Ballard Estate',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Navin Chaudhary',
  contactDesignation: 'Chief Procurement Officer (CPO)',
  contactEmail: 'navinchaudhary.dev@gmail.com',
  contactPhone: '+919157154504',
  categories: [
    { major: 'Civil Works', minor: 'Piling' },
    { major: 'IT', minor: 'Laptop' },
  ],
};

const mockAddAuditLog = jest.fn();
const mockShowToast = jest.fn();

function mockLoad(profile: BuyerProfile | null = PROFILE, taxonomy = TAXONOMY) {
  (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: taxonomy });
  (fetchBuyerProfile as jest.Mock).mockResolvedValue(
    profile ? { success: true, data: profile } : { success: false, error: 'boom' }
  );
}

/**
 * Render and wait for the mount-time load to settle.
 */
async function renderLoaded() {
  const utils = render(<BuyerProfilePage />);
  rerenderCurrent = () => utils.rerender(<BuyerProfilePage />);
  await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
  );
  return utils;
}

/** Re-render the mounted component, picking up the latest useApp() mock value. */
let rerenderCurrent: () => void = () => undefined;

describe('app/buyer/buyer-profile.tsx', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useApp as jest.Mock).mockReturnValue({
      addAuditLog: mockAddAuditLog,
      showToast: mockShowToast,
    });
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      data: PROFILE,
      categoryCount: 2,
    });
    mockLoad();
  });

  // ── Structure ─────────────────────────────────────────────────────────────
  it('renders organization, address, contact, and security sections, and hides procurement categories', async () => {
    await renderLoaded();
    expect(screen.getByText(/Section 1: Organization & Tax Registration/i)).toBeInTheDocument();
    expect(screen.getByText(/Registered Corporate Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Key Procurement Contact Person/i)).toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.accountSecurity.sectionTitle)).toBeInTheDocument();
    expect(screen.queryByText(/Relevant Procurement Categories/i)).not.toBeInTheDocument();
  });

  it('renders the account security forms outside the organization profile form', async () => {
    await renderLoaded();

    const currentPasswordInput = screen.getByPlaceholderText(
      UI_STRINGS.accountSecurity.currentPasswordPlaceholder
    );
    const accountForm = currentPasswordInput.closest('form');
    expect(accountForm).not.toBeNull();

    const legalEntityInput = screen.getByDisplayValue('Navin Chaudhary Enterprises');
    const profileForm = legalEntityInput.closest('form');
    expect(profileForm).not.toBeNull();

    expect(accountForm).not.toBe(profileForm);
    expect(profileForm?.contains(accountForm as Node)).toBe(false);
  });

  // ── Load ──────────────────────────────────────────────────────────────────
  it('populates every field from the database record rather than any seeded default', async () => {
    await renderLoaded();

    expect(screen.getByDisplayValue('Navin Chaudhary Enterprises')).toBeInTheDocument();
    expect(screen.getByDisplayValue('NC Heavy Engineering')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Public Limited Company')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AAACL1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('27AAACL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L28920MH1946PLC004768')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://www.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('INR 1,80,000 Cr+')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L&T House, Ballard Estate')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mumbai')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Maharashtra')).toBeInTheDocument();
    expect(screen.getByDisplayValue('400001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('India')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Navin Chaudhary')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Chief Procurement Officer (CPO)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('navinchaudhary.dev@gmail.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+919157154504')).toBeInTheDocument();
  });

  it('falls back to the default constitution when the stored value is outside the offered set', async () => {
    mockLoad({ ...PROFILE, organizationType: 'Cooperative Society' });
    await renderLoaded();
    expect(screen.getByDisplayValue('Public Limited Company')).toBeInTheDocument();
  });

  it('warns and leaves the form blank when the profile cannot be read', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Not linked to an organization.',
    });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.loadFailedTitle,
      'Not linked to an organization.',
      'warning'
    );
    expect(screen.queryByDisplayValue('Navin Chaudhary Enterprises')).not.toBeInTheDocument();
  });

  // ── Request loop regression ───────────────────────────────────────────────
  it('requests the profile exactly once per mount even when the load fails', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({
      success: false,
      data: [],
      error: 'Master unavailable.',
    });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'Unreachable.' });

    await renderLoaded();

    expect(mockShowToast).toHaveBeenCalledTimes(2);
    expect(fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);
  });

  it('does not re-request when the provider hands down a fresh showToast identity', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: false, data: [], error: 'down' });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'down' });

    const { rerender } = await renderLoaded();
    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      (useApp as jest.Mock).mockReturnValue({
        addAuditLog: jest.fn(),
        showToast: jest.fn(),
      });
      rerender(<BuyerProfilePage />);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(fetchBuyerProfile).toHaveBeenCalledTimes(1);
    expect(fetchCategoryTaxonomy).toHaveBeenCalledTimes(1);
  });

  it('reports a save through the current toast function after a re-render', async () => {
    await renderLoaded();

    const latestToast = jest.fn();
    (useApp as jest.Mock).mockReturnValue({ addAuditLog: mockAddAuditLog, showToast: latestToast });
    rerenderCurrent();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(latestToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      expect.any(String),
      'success'
    );
  });

  it('ignores a response that arrives after the page is closed', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    const { unmount } = render(<BuyerProfilePage />);
    await waitFor(() => expect(fetchBuyerProfile).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveProfile({ success: true, data: PROFILE });
    });

    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('disables the save button until the record has loaded', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveProfile = resolve;
      })
    );

    render(<BuyerProfilePage />);
    expect(screen.getByText('Save Organization Profile').closest('button')).toBeDisabled();

    await act(async () => {
      resolveProfile({ success: true, data: PROFILE });
    });

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
    );
  });

  // ── Editing ───────────────────────────────────────────────────────────────
  it('handles input changes across all form sections including the orgType select', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: 'L&T Heavy Infra' },
    });
    fireEvent.change(screen.getByDisplayValue('NC Heavy Engineering'), {
      target: { value: 'L&T Power & Defense' },
    });
    fireEvent.change(screen.getByDisplayValue('Public Limited Company'), {
      target: { value: 'Private Limited' },
    });
    fireEvent.change(screen.getByDisplayValue('AAACL1234F'), { target: { value: 'bbbcl1234f' } });
    fireEvent.change(screen.getByDisplayValue('27AAACL1234F1Z5'), {
      target: { value: '27bbbcl1234f1z5' },
    });
    fireEvent.change(screen.getByDisplayValue('L28920MH1946PLC004768'), {
      target: { value: 'l12345mh1946plc000000' },
    });
    fireEvent.change(screen.getByDisplayValue('https://www.example.com'), {
      target: { value: 'https://www.ltpower.com' },
    });
    fireEvent.change(screen.getByDisplayValue('INR 1,80,000 Cr+'), {
      target: { value: '₹ 2,00,000 Cr+' },
    });
    fireEvent.change(screen.getByDisplayValue('L&T House, Ballard Estate'), {
      target: { value: 'Powai Campus, Gate 1' },
    });
    fireEvent.change(screen.getByDisplayValue('Mumbai'), { target: { value: 'Navi Mumbai' } });
    fireEvent.change(screen.getByDisplayValue('Maharashtra'), { target: { value: 'Gujarat' } });
    fireEvent.change(screen.getByDisplayValue('400001'), { target: { value: '400076' } });
    fireEvent.change(screen.getByDisplayValue('India'), { target: { value: 'United Arab Emirates' } });
    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary'), {
      target: { value: 'Vikram Malhotra' },
    });
    fireEvent.change(screen.getByDisplayValue('Chief Procurement Officer (CPO)'), {
      target: { value: 'VP Supply Chain' },
    });
    fireEvent.change(screen.getByDisplayValue('navinchaudhary.dev@gmail.com'), {
      target: { value: 'vikram@lnt.com' },
    });
    fireEvent.change(screen.getByDisplayValue('+919157154504'), {
      target: { value: '+919820199999' },
    });

    expect(screen.getByDisplayValue('BBBCL1234F')).toBeInTheDocument();
    expect(screen.getByDisplayValue('27BBBCL1234F1Z5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('L12345MH1946PLC000000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Private Limited Company')).toBeInTheDocument();
  });

  it('shows the PAN and GSTIN format indicators', async () => {
    await renderLoaded();
    expect(screen.getByText('✓ Valid PAN')).toBeInTheDocument();
    expect(screen.getByText('✓ State 27 Verified')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('AAACL1234F'), { target: { value: 'NOPE' } });
    fireEvent.change(screen.getByDisplayValue('27AAACL1234F1Z5'), { target: { value: 'NOPE' } });

    expect(screen.getByText('Invalid Format')).toBeInTheDocument();
    expect(screen.getByText('Invalid GSTIN')).toBeInTheDocument();
  });

  // ── Save ──────────────────────────────────────────────────────────────────
  it('saves the profile and reports what was stored', async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Navin Chaudhary Enterprises',
        organizationType: 'Public Limited',
        panNumber: 'AAACL1234F',
        pincode: '400001',
        contactName: 'Navin Chaudhary',
      })
    );
    expect(Object.keys((saveBuyerProfile as jest.Mock).mock.calls[0][0])).not.toContain('contactEmail');

    expect(mockAddAuditLog).toHaveBeenCalledWith(
      expect.stringContaining('Navin Chaudhary Enterprises')
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, { categoryCount: 2 }),
      'success'
    );
  });

  it('re-applies the server-normalised record after a save', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: true,
      categoryCount: 2,
      data: { ...PROFILE, annualTurnover: 'INR 2,00,000 Cr+', companyName: 'ACME Normalised' },
    });
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('INR 1,80,000 Cr+'), {
      target: { value: '₹ 2,00,000 Cr+' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(screen.getByDisplayValue('INR 2,00,000 Cr+')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ACME Normalised')).toBeInTheDocument();
  });

  it('saves on form submit as well as from the header button', async () => {
    const { container } = await renderLoaded();
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(saveBuyerProfile).toHaveBeenCalledTimes(1);
  });

  it('falls back to the locally counted categories when the server omits a count', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: true, data: PROFILE });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      formatString(UI_STRINGS.buyerProfile.savedMessage, { categoryCount: 2 }),
      'success'
    );
  });

  it('succeeds without a returned record to re-apply', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({ success: true, categoryCount: 2 });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.savedTitle,
      expect.any(String),
      'success'
    );
  });

  // ── Save-path validation ──────────────────────────────────────────────────
  it('blocks a save with no legal entity name', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: '' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      expect.stringContaining(UI_STRINGS.buyerProfile.companyNameRequired),
      'warning'
    );
  });

  it.each([
    ['AAACL1234F', 'NOTAPAN', UI_STRINGS.buyerProfile.panInvalid],
    ['27AAACL1234F1Z5', '27AAACL1234F1Z', UI_STRINGS.buyerProfile.gstInvalid],
    ['L28920MH1946PLC004768', 'L28920MH1946PLC0047', UI_STRINGS.buyerProfile.cinInvalid],
    ['https://www.example.com', 'example.com', UI_STRINGS.buyerProfile.websiteInvalid],
    ['400001', '040001', UI_STRINGS.buyerProfile.pincodeInvalid],
  ])('blocks a save when %s is replaced with the malformed %s', async (current, next, message) => {
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue(current), { target: { value: next } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.validationErrorTitle,
      expect.stringContaining(message),
      'warning'
    );
  });

  it('refuses to save a form that never loaded', async () => {
    (fetchCategoryTaxonomy as jest.Mock).mockResolvedValue({ success: true, data: TAXONOMY });
    (fetchBuyerProfile as jest.Mock).mockResolvedValue({ success: false, error: 'unreachable' });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.saveFailedTitle,
      UI_STRINGS.buyerProfile.loadUnreachable,
      'warning'
    );
  });

  // ── Save failures ─────────────────────────────────────────────────────────
  it('reports a rejected save and keeps the buyer edits on screen', async () => {
    (saveBuyerProfile as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Your changes were not saved: PAN is invalid.',
    });
    await renderLoaded();

    fireEvent.change(screen.getByDisplayValue('Navin Chaudhary Enterprises'), {
      target: { value: 'Edited Name' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      UI_STRINGS.buyerProfile.saveFailedTitle,
      'Your changes were not saved: PAN is invalid.',
      'warning'
    );
    expect(screen.getByDisplayValue('Edited Name')).toBeInTheDocument();
    expect(mockAddAuditLog).not.toHaveBeenCalled();
  });

  it('disables the save buttons while a save is in flight and ignores a double click', async () => {
    let resolveSave: (v: unknown) => void = () => undefined;
    (saveBuyerProfile as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    await renderLoaded();

    fireEvent.click(screen.getByText('Save Organization Profile'));

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).toBeDisabled()
    );

    fireEvent.click(screen.getByText('Save Organization Profile'));
    expect(saveBuyerProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave({ success: true, data: PROFILE, categoryCount: 2 });
    });

    await waitFor(() =>
      expect(screen.getByText('Save Organization Profile').closest('button')).not.toBeDisabled()
    );
  });

  // ── Sections & Address Coverage ──────────────────────────────────────────
  it('exercises street, city, state, pincode, contact inputs and save', async () => {
    await renderLoaded();

    // 1. Street, city, state, pincode inputs
    const streetInput = screen.getByDisplayValue('L&T House, Ballard Estate');
    fireEvent.change(streetInput, { target: { value: 'New Industrial Area, MIDC' } });

    const pincodeInput = screen.getByDisplayValue('400001');
    fireEvent.change(pincodeInput, { target: { value: '400701' } });

    // 2. Contact inputs
    const contactNameInput = screen.getByDisplayValue('Navin Chaudhary');
    fireEvent.change(contactNameInput, { target: { value: 'Navin C' } });

    // 3. Save profile
    await act(async () => {
      fireEvent.click(screen.getByText('Save Organization Profile'));
    });

    expect(saveBuyerProfile).toHaveBeenCalled();
  });

  it('validates pincode debounce, dummy pincode, and invalid format', async () => {
    jest.useFakeTimers();
    await renderLoaded();

    const pincodeInput = screen.getByDisplayValue('400001');

    // 1. Clear pincode
    fireEvent.change(pincodeInput, { target: { value: '' } });

    // 2. Dummy pincode
    fireEvent.change(pincodeInput, { target: { value: '111111' } });
    expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

    // 3. 6-digit invalid format (starts with 0)
    fireEvent.change(pincodeInput, { target: { value: '012345' } });
    expect(screen.getByText('Invalid or dummy PIN code')).toBeInTheDocument();

    // 4. 6-digit valid pincode with debounce timer
    fireEvent.change(pincodeInput, { target: { value: '411001' } });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    jest.useRealTimers();
  });
});
