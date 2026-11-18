/**
 * Bibit profil umum untuk proyek baru yang belum punya bibit sendiri di kode.
 *
 * Isinya netral: tanpa produk dan tanpa data teknis. Pemilik mengisi nama
 * bisnis, salam, dan daftar produknya lewat dashboard; sampai itu diisi, bot
 * mengumpulkan data pelanggan dan meneruskan pertanyaan ke tim.
 */

import type { Business } from '../types';

export const generic: Business = {
  id: 'generic',
  brand: 'Bisnis Baru',
  persona: 'admin penjualan',
  alias: '',
  about: 'Bisnis ini belum mengisi keterangannya. Isi lewat dashboard: bisnis ini apa dan menjual apa.',
  honorific: 'Kak',

  greeting:
    'Halo, terima kasih sudah menghubungi kami 🙏\n' +
    'Ada yang bisa kami bantu?\n\n' +
    'Biar bisa kami bantu dengan tepat, boleh diinfokan dulu:\n' +
    '1. Nama\n' +
    '2. Kota / alamat\n' +
    '3. Kebutuhannya',
  greetingKnown:
    'Halo, terima kasih sudah menghubungi kami 🙏\n' +
    'Dengan Kak {nama}, betul?\n\n' +
    'Biar bisa kami bantu dengan tepat, boleh diinfokan dulu:\n' +
    '1. Kota / alamat\n' +
    '2. Kebutuhannya',

  leadFields: [
    { key: 'name', label: 'nama', hint: 'nama orangnya; jangan dari sapaan, nama bisnis kami, atau tebakan', isName: true },
    { key: 'city', label: 'kota/alamat', hint: 'kota atau alamat pelanggan' },
    { key: 'need', label: 'kebutuhannya', hint: 'ringkasan singkat kebutuhannya dengan kata-katamu' },
  ],

  products: [],
  catalog: [],
  notes: '',
  questions: [],
  styleRules: [],
  lessons: [],
  advice: '',
  handoffTopics: 'harga, diskon, stok, waktu kirim, ongkir, garansi, cara bayar, alamat/kontak toko',
  handoffLabel: 'harga/stok',
  forbidPrices: true,
  guardCodes: false,
  stopAfterHuman: true,
  knownAt: 0,
  knownCount: 0,
  recipients: [],
  notifyRoutes: {},
  settings: {},
  followupClosing: 'apakah masih ada yang bisa kami bantu?',
  files: [],
  logo: '',
  replyDelayMin: 8,
  replyDelayMax: 30,

  evalCases: [
    { q: 'harganya berapa?', intent: 'handoff' },
    { q: 'saya mau ngomong sama adminnya langsung', intent: 'human' },
  ],
};
