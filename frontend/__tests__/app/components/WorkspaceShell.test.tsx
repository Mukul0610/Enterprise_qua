import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceShell from '@/app/components/WorkspaceShell';
import * as storeModule from '@/lib/store';
import { authClient } from '@/lib/authClient';
import { LOGIN_ROUTE, ROLE_LANDING_ROUTE } from '@/lib/constants';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/store');

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/buyer/dashboard',
}));

jest.mock('@/lib/authClient', () => ({
  authClient: { logout: jest.fn().mockResolvedValue(undefined), getToken: () => 'jwt' },
}));

// The shell composes several heavy screens; they are not under test here.
jest.mock('@/app/components/SupportChatWidget', () => () => <div data-testid="support-chat" />);
jest.mock('@/app/buyer/initial-setup-modal', () => () => <div data-testid="initial-setup" />);
jest.mock('@/app/components/RoleNavigation', () => ({ onLogout }: { onLogout?: () => void }) => (
  <button type="button" onClick={onLogout}>
    rail-sign-out
  </button>
));

describe('WorkspaceShell route guard', () => {
  const setIsLoggedIn = jest.fn();
  const setCurrentUserSession = jest.fn();
  const setCurrentRole = jest.fn();
  const showToast = jest.fn();

  const mockStore = (overrides: Record<string, unknown> = {}) => {
    (storeModule.useApp as jest.Mock).mockReturnValue({
      isLoggedIn: true,
      currentRole: 'buyer',
      currentUserSession: null,
      setCurrentRole,
      setIsLoggedIn,
      setCurrentUserSession,
      showToast,
      ...overrides,
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the requested screen for a matching role', () => {
    mockStore({ isLoggedIn: true, currentRole: 'buyer' });

    render(
      <WorkspaceShell role="buyer">
        <p>buyer screen</p>
      </WorkspaceShell>
    );

    expect(screen.getByText('buyer screen')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sends an unauthenticated visitor to the sign-in route without rendering the screen', () => {
    mockStore({ isLoggedIn: false });

    render(
      <WorkspaceShell role="buyer">
        <p>buyer screen</p>
      </WorkspaceShell>
    );

    expect(mockReplace).toHaveBeenCalledWith(LOGIN_ROUTE);
    expect(screen.queryByText('buyer screen')).not.toBeInTheDocument();
    expect(screen.getByText(UI_STRINGS.auth.redirecting)).toBeInTheDocument();
  });

  it('redirects a vendor away from a buyer URL to their own workspace', () => {
    mockStore({ isLoggedIn: true, currentRole: 'vendor' });

    render(
      <WorkspaceShell role="buyer">
        <p>buyer screen</p>
      </WorkspaceShell>
    );

    expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.vendor);
    expect(screen.queryByText('buyer screen')).not.toBeInTheDocument();
  });

  it('sends first-login vendors to password setup without rendering the workspace', () => {
    mockStore({
      isLoggedIn: true,
      currentRole: 'vendor',
      currentUserSession: { role: 'vendor', passwordChangeRequired: true },
    });

    render(
      <WorkspaceShell role="vendor">
        <p>vendor screen</p>
      </WorkspaceShell>
    );

    expect(mockReplace).toHaveBeenCalledWith('/vendor-first-login');
    expect(screen.queryByText('vendor screen')).not.toBeInTheDocument();
  });

  it('mounts the initial-setup modal only inside the buyer workspace', () => {
    mockStore({ isLoggedIn: true, currentRole: 'buyer' });
    const { unmount } = render(
      <WorkspaceShell role="buyer">
        <p>screen</p>
      </WorkspaceShell>
    );
    expect(screen.getByTestId('initial-setup')).toBeInTheDocument();
    unmount();

    mockStore({ isLoggedIn: true, currentRole: 'admin' });
    render(
      <WorkspaceShell role="admin">
        <p>screen</p>
      </WorkspaceShell>
    );
    expect(screen.queryByTestId('initial-setup')).not.toBeInTheDocument();
  });

  it('clears the session and returns to sign-in when the rail signs out', () => {
    mockStore({ isLoggedIn: true, currentRole: 'buyer' });

    render(
      <WorkspaceShell role="buyer">
        <p>screen</p>
      </WorkspaceShell>
    );

    fireEvent.click(screen.getByText('rail-sign-out'));

    expect(setIsLoggedIn).toHaveBeenCalledWith(false);
    expect(setCurrentUserSession).toHaveBeenCalledWith(null);
    expect(setCurrentRole).toHaveBeenCalledWith('buyer');
    expect(authClient.logout).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith(LOGIN_ROUTE);
  });

  it('still clears local state when the server-side logout call fails', async () => {
    mockStore({ isLoggedIn: true, currentRole: 'buyer' });
    (authClient.logout as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    render(
      <WorkspaceShell role="buyer">
        <p>screen</p>
      </WorkspaceShell>
    );

    fireEvent.click(screen.getByText('rail-sign-out'));

    expect(setIsLoggedIn).toHaveBeenCalledWith(false);
    expect(mockReplace).toHaveBeenCalledWith(LOGIN_ROUTE);
    // Let the rejected logout promise settle so the swallow path executes.
    await Promise.resolve();
  });

  it('falls back to the buyer workspace when the session role is unrecognised', () => {
    mockStore({ isLoggedIn: true, currentRole: 'something_else' });

    render(
      <WorkspaceShell role="buyer">
        <p>buyer screen</p>
      </WorkspaceShell>
    );

    expect(mockReplace).toHaveBeenCalledWith(ROLE_LANDING_ROUTE.buyer);
  });
});
