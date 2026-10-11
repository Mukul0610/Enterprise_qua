const authService = require('../src/services/authService');
const { authenticate } = require('../src/middleware/auth');

describe('forced password change gate', () => {
  afterEach(() => jest.restoreAllMocks());

  function requestFor(originalUrl, method = 'GET') {
    return {
      headers: { authorization: 'Bearer session-token' },
      originalUrl,
      method,
    };
  }

  function response() {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  }

  test('blocks protected routes for a vendor who must change their password', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: { sub: 'vendor-1', role: 'vendor', passwordChangeRequired: true },
    });
    const res = response();
    const next = jest.fn();

    await authenticate(requestFor('/api/rfqs/all'), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, passwordChangeRequired: true })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('allows only the password-change endpoint through the gate', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: { sub: 'vendor-1', role: 'vendor', passwordChangeRequired: true },
    });
    const res = response();
    const next = jest.fn();

    await authenticate(requestFor('/api/auth/change-password', 'POST'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('does not change access for a regular session', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: { sub: 'buyer-1', role: 'buyer', passwordChangeRequired: false },
    });
    const res = response();
    const next = jest.fn();

    await authenticate(requestFor('/api/rfqs/all'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
