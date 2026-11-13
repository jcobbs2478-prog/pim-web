// The few OneDrive calls the page needs, all inside PIM's app folder (OneDrive\Apps\PIM Sync).
import { getToken, forgetAccessToken } from './auth.js';

const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const enc = p => p.split('/').map(encodeURIComponent).join('/');

export class SignInNeeded extends Error {}

async function call(url, init = {}) {
  const token = await getToken();
  if (!token) throw new SignInNeeded('sign-in needed');
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { forgetAccessToken(); throw new SignInNeeded('sign-in expired'); }
  return res;
}

/** Items directly inside a folder of the app folder: {name, eTag, folder?, file?, downloadUrl}. Empty if missing. */
export async function children(path) {
  const res = await call(`${ROOT}:/${enc(path)}:/children?$top=200`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
  return (await res.json()).value.map(i => ({ name: i.name, eTag: i.eTag, folder: !!i.folder, file: !!i.file, downloadUrl: i['@microsoft.graph.downloadUrl'] }));
}

/** Downloads a file through its pre-authorised link (no token needed for that request). */
export async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OneDrive download failed (${res.status})`);
  return res.text();
}

export async function put(path, text) {
  const res = await call(`${ROOT}:/${enc(path)}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
  if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`);
}

export async function remove(path) {
  const res = await call(`${ROOT}:/${enc(path)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`OneDrive delete failed (${res.status})`);
}
