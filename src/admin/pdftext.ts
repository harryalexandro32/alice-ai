/**
 * Membaca teks PDF, hanya untuk satu keperluan: mencocokkan PDF dengan produk
 * yang disebut di dalamnya (satu brosur sering memuat banyak produk).
 *
 * Teksnya TIDAK dipakai sebagai pengetahuan bot: tabel hasil ekstraksi sering
 * bergeser kolom, dan angka yang bergeser membuat bot menjawab salah dengan
 * yakin. Untuk mencocokkan nama/kode produk, itu tidak masalah.
 */

/** Huruf dan angka saja, huruf besar: "GFAF - 40 A" dan "gfaf-40a" jadi sama. */
export const squash = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '');

/**
 * Teks PDF apa adanya (spasi dirapikan). Kosong kalau PDF-nya hasil pindai atau
 * tidak terbaca. Dipakai untuk dua hal: mencocokkan produk, dan — kalau pemilik
 * menyalakannya untuk PDF itu — dibaca bot sebagai pengetahuan.
 */
export async function pdfPlain(data: Buffer): Promise<string> {
  try {
    // Dimuat saat dipakai: bot tidak butuh pustaka ini, hanya dashboard.
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(doc, { mergePages: false });
    return text.map((page) => page.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()).filter(Boolean).join('\n\n');
  } catch (e) {
    console.error(`[dashboard] PDF tidak terbaca: ${e instanceof Error ? e.message : e}`);
    return '';
  }
}

/** Teks PDF yang sudah dipadatkan, untuk mencocokkan nama produk. */
export async function pdfText(data: Buffer): Promise<string> {
  return squash(await pdfPlain(data));
}

/**
 * Produk mana yang disebut di PDF ini. Nama yang terlalu pendek dilewati
 * (dua-tiga huruf cocok di mana saja). Nama yang merupakan awalan nama lain
 * ("GFAF-40A" vs "GFAF-40AB") hanya dihitung kalau memang muncul berdiri sendiri.
 */
export function matchProducts(text: string, names: readonly string[]): string[] {
  if (!text) return [];
  const keys = names.map((n) => ({ name: n, key: squash(n) })).filter((x) => x.key.length >= 4);
  return keys
    .filter(({ key }) => {
      const longer = keys.map((x) => x.key).filter((k) => k !== key && k.startsWith(key));
      for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
        if (!longer.some((k) => text.startsWith(k, i))) return true;
      }
      return false;
    })
    .map((x) => x.name);
}
