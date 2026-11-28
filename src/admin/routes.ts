/**
 * Alamat halaman dashboard di bawah /<proyek>/ (tanpa garis miring di depan).
 *
 * Kunci = id halaman di app.js (tetap bahasa Indonesia); nilai = alamatnya
 * (bahasa Inggris). app.js adalah JavaScript biasa untuk peramban dan tidak
 * bisa mengimpor berkas ini, jadi isinya disalin apa adanya ke sana: kalau
 * mengubah salah satu, ubah keduanya.
 */
export const ROUTES: Readonly<Record<string, string>> = {
  beranda: '', percakapan: 'conversations', pesanan: 'orders',
  behavior: 'knowledge/behavior', produk: 'knowledge/products', brosur: 'knowledge/brochures',
  pengaturan: 'settings', whatsapp: 'settings/whatsapp', notifikasi: 'settings/notifications', lanjutan: 'settings/advanced',
  marketplace: 'settings/marketplace',
};

/**
 * Alamat lama (bahasa Indonesia) -> alamat baru. Server mengalihkannya dengan 301.
 * Halaman Pengetahuan lama (identity, recommendations, other, pengetahuan/*) sengaja
 * tidak dialihkan: alamatnya 404 seperti alamat lain yang tidak ada.
 */
export const OLD_ROUTES: Readonly<Record<string, string>> = {
  percakapan: 'conversations', pengetahuan: 'knowledge', pengaturan: 'settings',
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
