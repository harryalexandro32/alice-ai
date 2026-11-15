/**
 * Alamat halaman dashboard di bawah /<proyek>/ (tanpa garis miring di depan).
 *
 * Kunci = id halaman di app.js (tetap bahasa Indonesia); nilai = alamatnya
 * (bahasa Inggris). app.js adalah JavaScript biasa untuk peramban dan tidak
 * bisa mengimpor berkas ini, jadi isinya disalin apa adanya ke sana: kalau
 * mengubah salah satu, ubah keduanya.
 */
export const ROUTES: Readonly<Record<string, string>> = {
  beranda: '', percakapan: 'conversations',
  identitas: 'knowledge/identity', produk: 'knowledge/products', rekomendasi: 'knowledge/recommendations',
  brosur: 'knowledge/brochures', lainnya: 'knowledge/other',
  pengaturan: 'settings', whatsapp: 'settings/whatsapp', notifikasi: 'settings/notifications', lanjutan: 'settings/advanced',
};

/** Alamat lama (bahasa Indonesia) -> alamat baru. Server mengalihkannya dengan 301. */
export const OLD_ROUTES: Readonly<Record<string, string>> = {
  percakapan: 'conversations', pengetahuan: 'knowledge', pengaturan: 'settings',
  'pengetahuan/identitas': 'knowledge/identity', 'pengetahuan/produk': 'knowledge/products',
  'pengetahuan/rekomendasi': 'knowledge/recommendations', 'pengetahuan/brosur': 'knowledge/brochures',
  'pengetahuan/lainnya': 'knowledge/other',
  'pengaturan/whatsapp': 'settings/whatsapp', 'pengaturan/notifikasi': 'settings/notifications',
  'pengaturan/lanjutan': 'settings/advanced',
};

/**
 * Alamat baru untuk alamat lama, atau null kalau `rest` bukan alamat lama.
 * Nomor di percakapan/<nomor> dibawa apa adanya (masih ter-encode).
 */
export function renamedPath(rest: string): string | null {
  if (Object.hasOwn(OLD_ROUTES, rest)) return OLD_ROUTES[rest] as string;
  const m = rest.match(/^percakapan\/([^/]+)$/);
  return m ? `conversations/${m[1]}` : null;
}
