/** Isi pesan Baileys: teks, lampiran, dan pesan yang dikutip (fitur "balas"). */

import assert from 'node:assert/strict';

import { mediaOf, quoteOf, textOf } from './wamessage';

const OURS = ['6287880008819:2@s.whatsapp.net', '264419829362700:2@lid'];
const reply = (quotedMessage: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  extendedTextMessage: { text: 'ada fotonya?', contextInfo: { stanzaId: '3EB0ABC', quotedMessage, ...extra } },
});

// Teks biasa dan keterangan foto.
assert.equal(textOf({ conversation: 'halo' }), 'halo');
assert.equal(textOf(reply({ conversation: 'x' })), 'ada fotonya?');
assert.equal(textOf({ imageMessage: { caption: 'ini ruangannya' } }), 'ini ruangannya');
assert.equal(mediaOf({ imageMessage: {} }), 'foto');

// Membalas pesan bot: kutipannya terbaca, pengirimnya "us" (nomor atau LID bot, perangkat mana pun).
assert.deepEqual(quoteOf(reply({ conversation: 'Untuk dapur 3x4, pakai *GFC15-20A*.' }, { participant: '6287880008819@s.whatsapp.net' }), OURS),
  { text: 'Untuk dapur 3x4, pakai *GFC15-20A*.', by: 'us' });
assert.equal(quoteOf(reply({ conversation: 'x' }, { participant: '264419829362700@lid' }), OURS)?.by, 'us');

// Membalas foto atau PDF dari bot: keterangannya (nama produk / berkas) dan jenisnya.
assert.deepEqual(quoteOf(reply({ imageMessage: { caption: 'GFAF-40AB', mimetype: 'image/jpeg' } }, { participant: OURS[0] }), OURS),
  { text: 'GFAF-40AB', by: 'us', media: 'foto' });
assert.deepEqual(quoteOf(reply({ documentMessage: { fileName: 'Ceiling Fan A - GFan.pdf' } }, { participant: OURS[0] }), OURS),
  { text: 'Ceiling Fan A - GFan.pdf', by: 'us', media: 'dokumen' });
assert.equal(quoteOf(reply({ documentMessage: { fileName: 'a.pdf', caption: 'Ceiling Fan A' } }, { participant: OURS[0] }), OURS)?.text, 'Ceiling Fan A');

// Membalas pesannya sendiri.
assert.equal(quoteOf(reply({ conversation: 'dapur 3x4x4' }, { participant: '87059138088998@lid' }), OURS)?.by, 'customer');

// Tanpa participant: dari id pesan yang baru dikirim bot; kalau tidak ada, tidak dipastikan.
assert.equal(quoteOf(reply({ conversation: 'x' }), OURS, new Set(['3EB0ABC']))?.by, 'us');
assert.equal(quoteOf(reply({ conversation: 'x' }), OURS, new Set())?.by, null);

// Foto berketerangan yang membalas, dan pesan yang dibungkus (pesan sementara).
assert.equal(quoteOf({ imageMessage: { caption: 'yang ini?', contextInfo: { participant: OURS[0], quotedMessage: { conversation: 'GFC10-12A' } } } }, OURS)?.text, 'GFC10-12A');
assert.equal(quoteOf({ ephemeralMessage: { message: reply({ conversation: 'GZ-300' }, { participant: OURS[0] }) } }, OURS)?.text, 'GZ-300');

// Bukan balasan: tidak ada kutipan (termasuk contextInfo tanpa pesan kutipan, mis. pesan terusan).
assert.equal(quoteOf({ conversation: 'halo' }, OURS), undefined);
assert.equal(quoteOf({ extendedTextMessage: { text: 'x', contextInfo: { isForwarded: true } } }, OURS), undefined);
assert.equal(quoteOf(null, OURS), undefined);

console.log('pesan WhatsApp: OK');
