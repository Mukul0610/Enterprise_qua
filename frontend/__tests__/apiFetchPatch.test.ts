describe('apiFetchPatch', () => {
  const originalFetch = window.fetch;
  const originalEnv = process.env.NEXT_PUBLIC_BACKEND_URL;

  afterEach(() => {
    jest.resetModules();
    window.fetch = originalFetch;
    delete (window as unknown as { __apiFetchPatched?: boolean }).__apiFetchPatched;
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_BACKEND_URL;
    } else {
      process.env.NEXT_PUBLIC_BACKEND_URL = originalEnv;
    }
  });

  it('is a no-op when NEXT_PUBLIC_BACKEND_URL is not set', () => {
    delete process.env.NEXT_PUBLIC_BACKEND_URL;
    const mockFetch = jest.fn();
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    expect(window.fetch).toBe(mockFetch);
  });

  it('rewrites a relative /api/* call to the configured backend origin', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch('/api/auth/login', { method: 'POST' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://backend.example.workers.dev/api/auth/login',
      { method: 'POST' }
    );
  });

  it('leaves a non-API URL untouched', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch('https://fonts.googleapis.com/css');

    expect(mockFetch).toHaveBeenCalledWith('https://fonts.googleapis.com/css', undefined);
  });

  it('only patches window.fetch once even if called again', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();
    const patchedFetch = window.fetch;
    installApiFetchPatch();

    expect(window.fetch).toBe(patchedFetch);
  });

  it('handles URL instances and passes them through', async () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://backend.example.workers.dev';
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    window.fetch = mockFetch as unknown as typeof window.fetch;

    const { installApiFetchPatch } = require('../lib/apiFetchPatch');
    installApiFetchPatch();

    await window.fetch(new URL('https://example.com/other'));
    expect(mockFetch).toHaveBeenCalled();
  });
});
