// Microsoft sign-in for the page: authorization code + PKCE, the standard flow for a browser app with no server.
// App registration "PIM Sync" (personal Microsoft accounts only) grants one permission, Files.ReadWrite.AppFolder:
// the page can reach OneDrive\Apps\PIM Sync and nothing else. Tokens stay in this browser's local storage.
//
// Microsoft limits a browser app's sign-in to 24 hours. After that the page sends you to Microsoft and straight
// back without asking anything, as long as Microsoft still remembers you on this device ("silent" sign-in).

export const CLIENT_ID = 'f398bacd-d0ce-4cb0-8b6e-f2fc35d48a3a';
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'Files.ReadWrite.AppFolder offline_access';
const KEY = 'pim.auth', PKCE = 'pim.pkce';

export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = a => localStorage.setItem(KEY, JSON.stringify(a));

export const hasSignedInBefore = () => !!load();

/** Sends the browser to Microsoft. `silent` asks Microsoft not to show anything (prompt=none). */
export async function startSignIn(silent = false) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem(PKCE, JSON.stringify({ verifier, state, silent }));
  const q = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: silent ? 'none' : 'select_account',
  });
  location.assign(`${AUTH}/authorize?${q}`);
}

/**
 * Finishes a sign-in when the page loads with ?code=... (or ?error=...). Returns 'signed-in', 'needs-sign-in'
 * (a silent attempt was refused) or null when this load is not a sign-in return.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', redirectUri());
  const pkce = JSON.parse(localStorage.getItem(PKCE) || 'null');
  localStorage.removeItem(PKCE);
  if (q.has('error') || !pkce || q.get('state') !== pkce.state) return 'needs-sign-in';
  await redeem({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pkce.verifier });
  return 'signed-in';
}

/** A valid access token, refreshing it if needed; null when a new sign-in is required. */
export async function getToken() {
  const a = load();
  if (!a) return null;
  if (a.access && a.exp > Date.now() + 60_000) return a.access;
  if (!a.refresh) return null;
  try {
    await redeem({ grant_type: 'refresh_token', refresh_token: a.refresh });
    return load().access;
  } catch (e) {
    if (e.status === 400) save({ ...a, access: null, refresh: null });   // expired: a sign-in is needed
    throw e;
  }
}

export function forgetAccessToken() { const a = load(); if (a) save({ ...a, access: null, exp: 0 }); }
export function signOut() { localStorage.removeItem(KEY); }

async function redeem(form) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...form }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(json.error_description || `sign-in failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  save({ access: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000, refresh: json.refresh_token || load()?.refresh || null });
}
