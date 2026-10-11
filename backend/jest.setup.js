// Backend tests must never touch the real, shared Neon database. `app.js`
// loads `.env` via dotenv, which does NOT override a variable that already
// exists in `process.env` — so pre-setting this here (before any test file's
// own requires run) permanently blanks it out for the whole test process.
// `pool.js`'s resolveConfig() treats an empty string exactly like "unset"
// (`env.DATABASE_URL || ''`), so a query is refused outright rather than
// reaching the real database. Tests that specifically exercise pool/migrate/view
// CLI logic (pool.test.js, migrate.test.js, view.test.js,
// storeServiceRemainingBranches.test.js) set their own fake DATABASE_URL value
// per test case and are unaffected by this default.
process.env.DATABASE_URL = '';

// Same reasoning, same mechanism, for the real Gmail API credentials: without
// this, mailerService.isGmailApiConfigured()/isVendorGmailApiConfigured()
// come back true in every test process (backend/.env has real values for
// live use), and the Gmail API is the ONLY inbound/outbound mail transport
// now (IMAP support was removed — Cloudflare Workers cannot hold an IMAP
// socket open), so a stray real credential here would let a test actually
// reach Gmail. Tests that specifically exercise the Gmail API path
// (mailerService.test.js, emailGateway.test.js's pollViaGmailApi/pollOnce/
// pollVendorOnce describe blocks) mock the Gmail client getters
// (mailerService.getGmailOAuthClient/getVendorGmailOAuthClient) and/or
// isGmailApiConfigured()/isVendorGmailApiConfigured() directly per test via
// jest.spyOn, which overrides this default and is unaffected by it.
process.env.GMAIL_CLIENT_ID = '';
process.env.GMAIL_CLIENT_SECRET = '';
process.env.GMAIL_REFRESH_TOKEN = '';
process.env.VENDOR_GMAIL_REFRESH_TOKEN = '';
process.env.QUOTE_ALERT_GMAIL_REFRESH_TOKEN = '';

// Same reasoning again for the D1 HTTP client (src/db/d1Bridge.js's
// getD1HttpClient): CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_D1_DATABASE_ID/
// CLOUDFLARE_API_TOKEN in backend/.env are real credentials for the live
// production D1 database. pool.hasStorage() only checks these are truthy,
// not reachable, so leaving them set here means every `{d1:true}` query a
// test runs goes out over the network to the REAL database instead of
// safely no-op'ing — confirmed live: correcting a stale, wrong
// CLOUDFLARE_D1_DATABASE_ID in .env (it was pointing at an abandoned
// database) immediately made 27 previously-passing tests fail, because they
// started reaching the actual production RFQs/vendors instead of nothing.
process.env.CLOUDFLARE_ACCOUNT_ID = '';
process.env.CLOUDFLARE_D1_DATABASE_ID = '';
process.env.CLOUDFLARE_API_TOKEN = '';

// Session-signing key, pinned for the whole test process.
//
// authService resolves this once at module load. Without it, a non-production
// process generates a random key, which is correct behaviour but leaves the suite
// unable to sign a token itself — and the tests that build deliberately malformed
// tokens have to produce a valid signature first in order to reach the payload
// checks at all.
//
// It used to work because authService shipped a hardcoded fallback secret and
// three tests re-signed with that literal. That literal is gone: it meant the
// signing key for any deployment that forgot to set AUTH_SECRET was sitting in
// the repository. Pinning it here is the test-side replacement.
process.env.AUTH_SECRET = 'test-only-session-signing-key-not-used-anywhere-else';
