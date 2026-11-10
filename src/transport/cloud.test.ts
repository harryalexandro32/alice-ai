/**
 * Jalur Cloud API terhadap Graph API tiruan dan webhook yang ditandatangani
 * sungguhan. Tidak menyentuh Meta.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { cfg } from '../config';
import { cloudPort, cloudTransport, stopCloud } from './cloud';
import type { TransportInbound } from './types';

const SECRET = 'rahasia-app';
const calls: { method: string; url: string; auth?: string; body?: any }[] = [];
let failNext: { status: number; body: unknown } | null = null;

const graph = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    calls.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
    res.setHeader('content-type', 'application/json');
    if (failNext) {
      res.writeHead(failNext.status);
      res.end(JSON.stringify(failNext.body));
      failNext = null;
    } else if (req.method === 'GET') {
      res.end(JSON.stringify({ display_phone_number: '+62 812-5555-0000', verified_name: 'Toko Uji' }));
    } else {
      res.end(JSON.stringify({ messages: [{ id: `wamid.BOT${calls.length}` }] }));
    }
  });
});

const inbound: TransportInbound[] = [];
const human: { address: string; text: string }[] = [];

async function hook(payload: unknown, sign: string | null = SECRET): Promise<number> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sign) headers['x-hub-signature-256'] = 'sha256=' + createHmac('sha256', sign).update(raw).digest('hex');
  const res = await fetch(`http://127.0.0.1:${cloudPort()}/webhook`, { method: 'POST', headers, body: raw });
  await new Promise((r) => setTimeout(r, 20));
  return res.status;
}

const nowSec = () => String(Math.floor(Date.now() / 1000));
const wrap = (field: string, value: object) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PID1' }, ...value } }] }],
});

graph.listen(0, '127.0.0.1', async () => {
  cfg.waApiBase = `http://127.0.0.1:${(graph.address() as AddressInfo).port}/v23.0`;
  cfg.waPhoneNumberId = 'PID1';
  cfg.waToken = 'token-uji';
  cfg.waAppSecret = SECRET;
  cfg.waVerifyToken = 'verif-uji';
  cfg.waLeadTemplate = '';
  cfg.port = 0;

  try {
    await cloudTransport.start({ onInbound: (m) => void inbound.push(m), onHumanReply: (m) => void human.push(m) });
    assert.equal(cloudTransport.selfPhone(), '+6281255550000');
    assert.equal(calls[0]?.auth, 'Bearer token-uji');
    const base = `http://127.0.0.1:${cloudPort()}`;

    // Verifikasi webhook dari dasbor Meta.
    const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verif-uji&hub.challenge=12345`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345');
    assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=1`)).status, 403);

    // Pesan masuk bertanda tangan sah.
    const msg = wrap('messages', {
      contacts: [{ wa_id: '6281211110001' }],
      messages: [{ from: '6281211110001', id: 'wamid.IN1', timestamp: nowSec(), type: 'text', text: { body: ' halo ' } }],
    });
    assert.equal(await hook(msg), 200);
    assert.deepEqual(inbound, [{ phone: '+6281211110001', address: '6281211110001', text: 'halo', waId: 'wamid.IN1' }]);

    // Tanpa tanda tangan / tanda tangan dengan kunci lain: ditolak, tidak diproses.
    assert.equal(await hook(msg, null), 401);
    assert.equal(await hook(msg, 'kunci-lain'), 401);
    assert.equal(inbound.length, 1);

    // Gambar = bukan teks; reaksi, pesan lama, dan nomor lain dilewat.
    await hook(wrap('messages', { messages: [{ from: '6281211110001', id: 'wamid.IN2', timestamp: nowSec(), type: 'image' }] }));
    assert.equal(inbound[1]?.text, null);
    await hook(wrap('messages', { messages: [{ from: '6281211110001', id: 'x', timestamp: nowSec(), type: 'reaction' }] }));
    await hook(wrap('messages', { messages: [{ from: '6281211110001', id: 'y', timestamp: '1700000000', type: 'text', text: { body: 'basi' } }] }));
    const other = wrap('messages', { messages: [{ from: '628999', id: 'z', timestamp: nowSec(), type: 'text', text: { body: 'salah alamat' } }] });
    (other.entry[0]!.changes[0]!.value as any).metadata.phone_number_id = 'PID-LAIN';
    await hook(other);
    assert.equal(inbound.length, 2);

    // Kirim teks.
    await cloudTransport.send({ phone: '+6281211110001', address: '6281211110001' }, 'Halo Pak');
    const sentCall = calls.at(-1);
    assert.equal(sentCall?.url, '/v23.0/PID1/messages');
    assert.deepEqual(sentCall?.body, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '6281211110001',
      type: 'text', text: { preview_url: false, body: 'Halo Pak' },
    });

    // Echo: kiriman bot sendiri diabaikan; ketikan pemilik dari aplikasi = manusia.
    const echo = (id: string, body: string) =>
      wrap('smb_message_echoes', { message_echoes: [{ from: '6281255550000', to: '6281211110001', id, timestamp: nowSec(), type: 'text', text: { body } }] });
    await hook(echo(`wamid.BOT${calls.length}`, 'Halo Pak'));
    await hook(echo('wamid.LAIN', 'Halo Pak'));
    assert.equal(human.length, 0, 'gema kiriman bot bukan balasan manusia');
    await hook(echo('wamid.APP1', 'Saya bantu ya, Pak'));
    assert.deepEqual(human, [{ address: '6281211110001', text: 'Saya bantu ya, Pak' }]);
    await hook(wrap('smb_message_echoes', { message_echoes: [{ from: '6281255550000', id: 'wamid.APP2', type: 'text', text: { body: 'tanpa tujuan' } }] }));
    assert.equal(human.length, 1);

    // Notifikasi sales: teks biasa tanpa template, template kalau diatur.
    await cloudTransport.send({ phone: '+6281299990001', address: '' }, 'Lead\nNama: Budi', { notify: true });
    assert.equal(calls.at(-1)?.body.type, 'text');
    assert.equal(calls.at(-1)?.body.to, '6281299990001');
    cfg.waLeadTemplate = 'lead_baru';
    await cloudTransport.send({ phone: '+6281299990001', address: '' }, 'Lead\nNama: Budi', { notify: true });
    assert.deepEqual(calls.at(-1)?.body.template, {
      name: 'lead_baru', language: { code: 'id' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Lead | Nama: Budi' }] }],
    });
    await cloudTransport.send({ phone: '+6281211110001', address: '6281211110001' }, 'balasan biasa');
    assert.equal(calls.at(-1)?.body.type, 'text', 'balasan ke pelanggan tidak pernah memakai template lead');

    // Di luar jendela 24 jam: galatnya jelas, bukan diam.
    failNext = { status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } };
    await assert.rejects(
      cloudTransport.send({ phone: '+6281211110001', address: '6281211110001' }, 'telat'),
      /131047[\s\S]*di luar jendela 24 jam/
    );

    console.log('jalur Cloud API: OK');
  } catch (e) {
    console.error('jalur Cloud API: GAGAL\n', e);
    process.exitCode = 1;
  } finally {
    await stopCloud();
    graph.close();
  }
});
