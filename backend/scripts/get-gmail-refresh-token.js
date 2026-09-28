// One-time script: mints a Gmail API refresh token via the OAuth2
// "installed app" flow (localhost redirect), using the Desktop-app client
// downloaded from Google Cloud Console. Run once locally, then discard —
// the resulting refresh token goes into backend/.env, not into source.
//
// Usage: node get-gmail-refresh-token.js /path/to/client_secret_*.json
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

async function main() {
  const credPath = process.argv[2];
  if (!credPath) {
    console.error('Usage: node get-gmail-refresh-token.js /path/to/client_secret_*.json');
    process.exit(1);
  }
  const { installed } = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const { client_id, client_secret } = installed;
  // Google's "installed app" (loopback) OAuth flow accepts any port on
  // http://localhost at request time even though the registered
  // redirect_uris just says "http://localhost" with no port (RFC 8252) — so
  // this picks a fixed local port rather than parsing one out of the JSON.
  const port = 53682;
  const redirectUri = `http://localhost:${port}`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on repeat runs
    scope: SCOPES,
  });

  console.log('\n1. Open this URL in your browser and sign in with the Gmail account you want to send FROM:\n');
  console.log(authUrl);
  console.log('\n2. Approve access. You will be redirected to localhost — this script is waiting for that.\n');

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/')) return;
    const code = new URL(req.url, redirectUri).searchParams.get('code');
    if (!code) {
      res.end('No code found in redirect. Check the terminal.');
      return;
    }
    res.end('Success — you can close this tab and go back to the terminal.');
    server.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      console.log('\n=== SAVE THESE INTO backend/.env ===\n');
      console.log(`GMAIL_CLIENT_ID=${client_id}`);
      console.log(`GMAIL_CLIENT_SECRET=${client_secret}`);
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\n=====================================\n');
      if (!tokens.refresh_token) {
        console.warn(
          'WARNING: no refresh_token returned. This happens if you already granted access before ' +
          'without revoking it. Fix: go to https://myaccount.google.com/permissions, remove access ' +
          'for this app, then re-run this script.'
        );
      }
    } catch (err) {
      console.error('Token exchange failed:', err.message);
    }
    process.exit(0);
  });
  server.listen(port, () => {});
}

main();
