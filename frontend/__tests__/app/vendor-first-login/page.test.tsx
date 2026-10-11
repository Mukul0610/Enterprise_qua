import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VendorFirstLoginPage from '@/app/vendor-first-login/page';
import { authClient } from '@/lib/authClient';
import * as storeModule from '@/lib/store';
import { ROLE_LANDING_ROUTE } from '@/lib/constants';

jest.mock('@/lib/store');
jest.mock('@/lib/authClient', () => ({
  authClient: {
    changePassword: jest.fn(),
  },
}));

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockSetCurrentUserSession = jest.fn();
const mockSetIsLoggedIn = jest.fn();
const mockShowToast = jest.fn();
let mockCurrentUserSession: Record<string, unknown> | null = {
  role: 'vendor',
  passwordChangeRequired: true,
};

describe('VendorFirstLoginPage', () => {
  beforeEach(() => {
    mockCurrentUserSession = { role: 'vendor', passwordChangeRequired: true };
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: mockCurrentUserSession,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const fillPasswords = (current: string, next: string, confirmation = next) => {
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: current } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
  };

  const submit = () => {
    fireEvent.submit(screen.getByRole('button', { name: 'Change password and continue' }).closest('form')!);
  };

  it('opens the required password-change step as a modal dialog', () => {
    render(<VendorFirstLoginPage />);

    expect(screen.getByRole('dialog', { name: 'Secure your vendor account' })).toHaveAttribute(
      'aria-modal',
      'true'
    );
  });

  it('does not submit or continue when the new password is too short', () => {
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'short');

    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('at least');
    expect(authClient.changePassword).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
  });

  it('requires the confirmation to match the new password', () => {
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'NewPassword@123', 'DifferentPassword@123');

    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(authClient.changePassword).not.toHaveBeenCalled();
  });

  it('requires a different password from the temporary credential', () => {
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'Temporary@123');

    submit();

    expect(screen.getByRole('alert')).toHaveTextContent('different from your temporary password');
    expect(authClient.changePassword).not.toHaveBeenCalled();
  });

  it('does not enter the dashboard when the password change is rejected', async () => {
    (authClient.changePassword as jest.Mock).mockResolvedValue({
      success: false,
      error: 'The temporary password is incorrect.',
    });
    render(<VendorFirstLoginPage />);
    fillPasswords('WrongTemporary@123', 'NewPassword@123');

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The temporary password is incorrect.');
    expect(mockSetCurrentUserSession).not.toHaveBeenCalled();
    expect(mockSetIsLoggedIn).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
  });

  it('shows a fallback error for an unsuccessful response without a message', async () => {
    (authClient.changePassword as jest.Mock).mockResolvedValue({ success: false });
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'NewPassword@123');

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password could not be changed. Please try again.'
    );
    expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
  });

  it('updates the session and redirects to the vendor dashboard only after success', async () => {
    const updatedUser = { role: 'vendor', passwordChangeRequired: false };
    (authClient.changePassword as jest.Mock).mockResolvedValue({
      success: true,
      user: updatedUser,
      token: 'updated-token',
    });
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'NewPassword@123');

    submit();

    await waitFor(() => {
      expect(authClient.changePassword).toHaveBeenCalledWith('Temporary@123', 'NewPassword@123');
      expect(mockSetCurrentUserSession).toHaveBeenCalledWith(updatedUser);
      expect(mockSetIsLoggedIn).toHaveBeenCalledWith(true);
      expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      'Password Updated',
      'Your account is ready to use.',
      'success'
    );
  });

  it('keeps the vendor out of the dashboard when the change request throws', async () => {
    (authClient.changePassword as jest.Mock).mockRejectedValue(new Error('request failed'));
    render(<VendorFirstLoginPage />);
    fillPasswords('Temporary@123', 'NewPassword@123');

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password could not be changed. Please try again.'
    );
    expect(mockReplace).not.toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
  });

  it('sends unauthenticated visitors back to sign-in', async () => {
    mockCurrentUserSession = null;
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: null,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<VendorFirstLoginPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it.each([
    [{ role: 'buyer', passwordChangeRequired: true }],
    [{ role: 'vendor', passwordChangeRequired: false }],
  ])('redirects users who do not require vendor first-login setup', async (session) => {
    mockCurrentUserSession = session;
    (storeModule.useApp as jest.Mock).mockReturnValue({
      currentUserSession: session,
      setCurrentUserSession: mockSetCurrentUserSession,
      setIsLoggedIn: mockSetIsLoggedIn,
      showToast: mockShowToast,
    });

    render(<VendorFirstLoginPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor));
  });
});
