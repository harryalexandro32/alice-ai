/**
 * Menambah baris ke Google Sheet lewat akun layanan.
 *
 * Tanpa pustaka Google: JWT ditandatangani node:crypto, lalu dua fetch. Sheet
 * harus dibagikan (Editor) ke email akun layanan.
 *
 * valueInputOption=RAW itu disengaja. Nama dan kebutuhan diketik orang asing;
 * dengan USER_ENTERED, nama yang diawali "=" akan dijalankan sebagai rumus di
 * spreadsheet klien.
 */

import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { cfg } from '../config';

let token: { value: string; expiresAt: number } | null = null;

export function sheetConfigured(): boolean {
  return Boolean(cfg.sheetId) && existsSync(cfg.googleCredentials);
}

const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const key = JSON.parse(readFileSync(cfg.googleCredentials, 'utf8')) as {
    client_email: string;
    private_key: string;
  };
  const iat = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) +
    '.' +
    b64url(
      JSON.stringify({
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600,
      })
    );
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token Google ditolak (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export async function appendSheetRow(row: string[]): Promise<void> {
  const range = encodeURIComponent(`${cfg.sheetTab}!A:H`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.sheetId)}` +
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sheet menolak (${res.status}): ${(await res.text()).slice(0, 160)}`);
}
