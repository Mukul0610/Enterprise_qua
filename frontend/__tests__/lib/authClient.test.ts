import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('Frontend AuthClient Service - Comprehensive 100% Coverage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authClient.setSession(null, null);
    jest.clearAllMocks();
  });

  describe('Successful API Paths', () => {
    test('loginWithPassword handles successful login response', async () => {
      const mockUser = {
        id: 'usr-buyer-001',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer Desk',
        role: 'buyer' as const,
        orgId: 'org-procucev-01',
        orgName: 'Procucev Heavy Engineering',
        authMethod: 'PASSWORD' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'test-jwt-token',
          user: mockUser,
        }),
      });

      const res = await authClient.loginWithPassword('buyer@procucev.com', 'password123', '9157154504');
      expect(res.success).toBe(true);
      expect(res.user?.email).toBe('buyer@procucev.com');
      expect(authClient.getToken()).toBe('test-jwt-token');
      expect(authClient.getSessionUser()?.email).toBe('buyer@procucev.com');
    });

    test('loginWithPassword sends the registered mobile number in the request body', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'checked separately' }),
      });

      await authClient.loginWithPassword('buyer@procucev.com', 'password123', '9157154504');

      const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(path).toBe('/api/auth/login');
      expect(JSON.parse(init.body)).toEqual({
        email: 'buyer@procucev.com',
        password: 'password123',
        mobile: '9157154504',
      });
    });

    test('requestOtp dispatches verification code', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Verification OTP dispatched to buyer@procucev.com',
          demoCode: '1234',
          expiresInSeconds: 600,
        }),
      });

      const res = await authClient.requestOtp('buyer@procucev.com', '9157154504', 'buyer');
      expect(res.success).toBe(true);
      expect(res.demoCode).toBe('1234');
    });

    test('verifyOtp signs in user upon successful verification', async () => {
      const mockUser = {
        id: 'usr-buyer-001',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer Desk',
        role: 'buyer' as const,
        orgId: 'org-procucev-01',
        orgName: 'Procucev Heavy Engineering',
        authMethod: 'EMAIL_OTP' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'test-otp-jwt-token',
          user: mockUser,
        }),
      });

      const res = await authClient.verifyOtp('buyer@procucev.com', '123456', '9157154504');
      expect(res.success).toBe(true);
      expect(res.user?.authMethod).toBe('EMAIL_OTP');
      expect(authClient.getToken()).toBe('test-otp-jwt-token');
    });

    test('register creates a new user account', async () => {
      const mockNewUser = {
        id: 'usr-new-001',
        email: 'newbuyer@enterprise.com',
        name: 'New Buyer',
        role: 'buyer' as const,
        orgId: 'org-new-001',
        orgName: 'New Enterprise Corp',
        authMethod: 'PASSWORD' as const,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          token: 'new-user-jwt-token',
          user: mockNewUser,
        }),
      });

      const res = await authClient.register({
        name: 'New Buyer',
        email: 'newbuyer@enterprise.com',
        password: 'SecurePassword123!',
        mobile: '+91 98000 11223',
        role: 'buyer',
        orgName: 'New Enterprise Corp',
      });

      expect(res.success).toBe(true);
      expect(res.user?.email).toBe('newbuyer@enterprise.com');
    });

    test('getSession returns server session when token is valid and active', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'session@procucev.com',
          name: 'Session User',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'valid-token'
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          user: {
            id: 'usr-1',
            email: 'session@procucev.com',
            name: 'Session User',
            role: 'buyer',
            orgId: 'org-1',
            orgName: 'Org',
          },
        }),
      });

      const session = await authClient.getSession();
      expect(session?.email).toBe('session@procucev.com');
    });

    test('getSession returns cached session when token is null', async () => {
      authClient.setSession(null, null);
      const session = await authClient.getSession();
      expect(session).toBeNull();
    });

    test('logout clears active session state', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'buyer@procucev.com',
          name: 'Buyer',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Procucev',
        },
        'active-token'
      );

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await authClient.logout('buyer@procucev.com');
      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });
  });

  describe('Unreachable Backend Fails Closed', () => {
    // The client used to fabricate a valid session whenever fetch() rejected,
    // which made an unreachable API indistinguishable from a real sign-in.
    // Every transport failure must now surface as an explicit failure.
    test('loginWithPassword reports a network failure instead of signing the user in', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      for (const email of ['vendor@test.com', 'admin@test.com', 'manager@test.com', 'buyer@test.com']) {
        const res = await authClient.loginWithPassword(email, 'p', '9157154504');
        expect(res.success).toBe(false);
        expect(res.user).toBeUndefined();
        expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      }

      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });

    test('requestOtp reports a network failure and never invents a demo code', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.requestOtp('buyer@test.com', '9157154504', 'buyer');
      expect(res.success).toBe(false);
      expect(res.demoCode).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
    });

    test('verifyOtp reports a network failure instead of signing the user in', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.verifyOtp('vendor@test.com', '123456', '9157154504');
      expect(res.success).toBe(false);
      expect(res.user).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      expect(authClient.getToken()).toBeNull();
    });

    test('register reports a network failure instead of creating a local account', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const res = await authClient.register({ name: '', email: 'fallback.reg@enterprise.com' });
      expect(res.success).toBe(false);
      expect(res.user).toBeUndefined();
      expect(res.error).toBe(UI_STRINGS.auth.networkUnreachable);
      expect(authClient.getToken()).toBeNull();
    });

    test('a response body that is not JSON is reported as a server error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      });

      const res = await authClient.loginWithPassword('buyer@test.com', 'p', '9157154504');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.auth.serverErrorFallback);
    });

    test('an error status with no message from the server still fails with an explanation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false }),
      });

      const res = await authClient.loginWithPassword('buyer@test.com', 'p', '9157154504');
      expect(res.success).toBe(false);
      expect(res.error).toBe(UI_STRINGS.auth.serverErrorFallback);
    });

    test('getSession keeps the cached session offline but discards a rejected token', async () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'cached@test.com',
          name: 'Cached',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'token-123'
      );

      // Network failure: the cached session is retained rather than signing out.
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const offlineSession = await authClient.getSession();
      expect(offlineSession?.email).toBe('cached@test.com');

      // A 401 means the token is genuinely invalid, so local state is cleared.
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
      const rejectedSession = await authClient.getSession();
      expect(rejectedSession).toBeNull();
      expect(authClient.getToken()).toBeNull();
    });

    test('getSession returns null without a token and makes no request', async () => {
      authClient.setSession(null, null);
      global.fetch = jest.fn();

      await expect(authClient.getSession()).resolves.toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('logout handles fetch error gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      await expect(authClient.logout()).resolves.toBeUndefined();
      expect(authClient.getToken()).toBeNull();
    });
  });

  describe('Resolved but Unsuccessful Responses', () => {
    test('loginWithPassword returns the failure response without establishing a session', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Invalid email or password.' }),
      });

      const res = await authClient.loginWithPassword('buyer@procucev.com', 'wrongpassword', '9157154504');
      expect(res.success).toBe(false);
      expect(authClient.getToken()).toBeNull();
      expect(authClient.getSessionUser()).toBeNull();
    });

    test('register returns the failure response without establishing a session', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Email is required for registration.' }),
      });

      const res = await authClient.register({ name: 'No Email', email: '' });
      expect(res.success).toBe(false);
      expect(authClient.getToken()).toBeNull();
    });

    test('getSession returns null when the server responds with success:false', async () => {
      authClient.setSession(null, 'some-token');
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Invalid session' }),
      });

      const session = await authClient.getSession();
      expect(session).toBeNull();
    });
  });

  describe('Storage & Session Management', () => {
    test('setSession writes to and removes from localStorage', () => {
      authClient.setSession(
        {
          id: 'usr-1',
          email: 'stored@test.com',
          name: 'Stored',
          role: 'buyer',
          orgId: 'org-1',
          orgName: 'Org',
        },
        'token-abc'
      );
      expect(localStorage.getItem('procucev_user_session')).toContain('stored@test.com');
      expect(localStorage.getItem('procucev_auth_token')).toBe('token-abc');

      authClient.setSession(null, null);
      expect(localStorage.getItem('procucev_user_session')).toBeNull();
      expect(localStorage.getItem('procucev_auth_token')).toBeNull();
    });
  });
});

// ==============================================================================
// SESSION RESTORATION ON CONSTRUCTION
// ==============================================================================
// The client is a singleton created when the module is first imported, so the
// only way to exercise what it restores from storage is to reset the module
// registry and import it again against a prepared storage state. This matters:
// the store clears the RFQ list when there is no token, so a session that fails
// to restore signs the buyer out on a page reload.
// ==============================================================================

describe('authClient session restoration', () => {
  const SESSION = {
    id: 'usr-buyer-001',
    email: 'buyer@procucev.com',
    name: 'Procucev Buyer Desk',
    role: 'buyer' as const,
    orgId: 'org-procucev-01',
    orgName: 'Procucev Heavy Engineering',
  };

  /** Re-import the module so its constructor runs against current storage. */
  function freshClient() {
    let restored: typeof import('@/lib/authClient').authClient | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      restored = require('@/lib/authClient').authClient;
    });
    if (!restored) throw new Error('authClient did not load');
    return restored;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test('restores a session persisted in localStorage', () => {
    localStorage.setItem('procucev_auth_token', 'local-token');
    localStorage.setItem('procucev_user_session', JSON.stringify(SESSION));

    const client = freshClient();

    expect(client.getToken()).toBe('local-token');
    expect(client.getSessionUser()).toEqual(SESSION);
  });

  // A tab-scoped sign-in lands in sessionStorage, and must survive a reload of
  // that tab even though localStorage holds nothing.
  test('falls back to sessionStorage when localStorage holds nothing', () => {
    sessionStorage.setItem('procucev_auth_token', 'tab-token');
    sessionStorage.setItem('procucev_user_session', JSON.stringify(SESSION));

    const client = freshClient();

    expect(client.getToken()).toBe('tab-token');
    expect(client.getSessionUser()).toEqual(SESSION);
  });

  test('prefers the localStorage token over the sessionStorage one', () => {
    localStorage.setItem('procucev_auth_token', 'local-token');
    sessionStorage.setItem('procucev_auth_token', 'tab-token');

    expect(freshClient().getToken()).toBe('local-token');
  });

  // Nothing stored is a signed-out browser, not an error.
  test('starts signed out when neither store holds anything', () => {
    const client = freshClient();

    expect(client.getToken()).toBeNull();
    expect(client.getSessionUser()).toBeNull();
  });

  test('holds a token without a session when only the token survived', () => {
    localStorage.setItem('procucev_auth_token', 'orphan-token');

    const client = freshClient();

    expect(client.getToken()).toBe('orphan-token');
    expect(client.getSessionUser()).toBeNull();
  });

  // A corrupt record is discarded rather than thrown: a bad entry in storage must
  // not stop the application from loading.
  test('discards an unreadable session record', () => {
    localStorage.setItem('procucev_auth_token', 'local-token');
    localStorage.setItem('procucev_user_session', '{not json');

    const client = freshClient();

    expect(client.getToken()).toBe('local-token');
    expect(client.getSessionUser()).toBeNull();
  });
});

// ==============================================================================
// CHANGE PASSWORD
// ==============================================================================
// POST /api/auth/change-password identifies the account from the bearer token, so
// this method sends only the credential pair. Every failure path has to be
// distinguishable by the caller: an unreachable API, a rejected token and a
// refused password all need different handling on screen.
// ==============================================================================

describe('AuthClient.changePassword', () => {
  const CURRENT = 'Pass@123';
  const NEXT = 'Brand@New456';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authClient.setSession(null, null);
    jest.clearAllMocks();
  });

  /** Put the client in a signed-in state so the token is attached. */
  const signIn = () => {
    authClient.setSession(
      {
        id: 'usr-buyer-001',
        email: 'buyer@procucev.com',
        name: 'Procucev Buyer Desk',
        role: 'buyer' as const,
        orgId: 'org-procucev-01',
        orgName: 'Procucev Heavy Engineering',
      },
      'test-jwt-token'
    );
  };

  test('sends only the credential pair, with the token as a bearer header', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'Your password has been changed.' }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.success).toBe(true);
    expect(res.message).toBe('Your password has been changed.');

    const [path, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toBe('/api/auth/change-password');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-jwt-token');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
  });

  test('stores the refreshed session returned after a forced password change', async () => {
    signIn();
    const user = {
      id: 'vendor-1',
      email: 'vendor@procucev.com',
      name: 'Vendor',
      role: 'vendor' as const,
      orgId: 'org-1',
      orgName: 'Vendor Org',
      passwordChangeRequired: false,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, token: 'refreshed-token', user }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.success).toBe(true);
    expect(authClient.getToken()).toBe('refreshed-token');
    expect(authClient.getSessionUser()).toEqual(user);
  });

  // Nothing is posted without a token: the endpoint requires authentication, so a
  // request would be refused anyway and the real problem is the missing session.
  test('reports an expired session and makes no request when no token is held', async () => {
    global.fetch = jest.fn();

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res).toEqual({ success: false, error: UI_STRINGS.auth.sessionExpired });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Fails closed: the server-side password state is unknown, so the caller must
  // not be shown a success.
  test('reports the API as unreachable on a transport failure', async () => {
    signIn();
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res).toEqual({ success: false, error: UI_STRINGS.auth.networkUnreachable });
  });

  test('reports a server error when the response body cannot be parsed', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res).toEqual({ success: false, error: UI_STRINGS.auth.serverErrorFallback });
  });

  test('clears the local session when the token is rejected', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'No active session token provided.' }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.success).toBe(false);
    expect(res.error).toBe('No active session token provided.');
    expect(authClient.getToken()).toBeNull();
    expect(authClient.getSessionUser()).toBeNull();
  });

  test('falls back to expired-session copy when a 401 carries no reason', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.error).toBe(UI_STRINGS.auth.sessionExpired);
    expect(authClient.getToken()).toBeNull();
  });

  // A refused password is a 400 with an explanation, which is passed through
  // unchanged so the panel can show exactly which rule failed.
  test('passes a rejection reason through untouched', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'Your current password is not correct, so the password was not changed.',
      }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.error).toBe(
      'Your current password is not correct, so the password was not changed.'
    );
    // A refused password is not a session problem, so the token is kept.
    expect(authClient.getToken()).toBe('test-jwt-token');
  });

  test('supplies a fallback when a non-401 failure carries no reason', async () => {
    signIn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false }),
    });

    const res = await authClient.changePassword(CURRENT, NEXT);

    expect(res.error).toBe(UI_STRINGS.auth.serverErrorFallback);
  });
});
