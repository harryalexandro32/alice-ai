/**
 * Nama profil WhatsApp: layak dipakai untuk menyapa atau tidak?
 *
 * Banyak orang mengisi nama profilnya dengan nama asli, tapi banyak juga yang
 * memakai inisial, julukan, nama toko, atau emoji. Di sini aturannya sengaja
 * ketat: yang meragukan dianggap bukan nama, dan bot bertanya seperti biasa.
 * Salah menolak nama asli hanya berarti bot bertanya; salah menerima julukan
 * berarti bot menyapa "Bapak/Ibu Demonslayer".
 */

/** Kata yang menandakan nama profil itu bukan nama orang. */
const NOT_A_PERSON =
  /\b(toko|store|shop|olshop|official|admin|cs|customer|service|sales|marketing|pt|cv|ud|tbk|ltd|corp|group|gaming|gamer|game|slayer|killer|hunter|king|queen|boss|bos|juragan|sultan|ganteng|cantik|anonymous|anonim|unknown|user|whatsapp|wa|test|tes|null|none|iphone|android|samsung|xiaomi|oppo|vivo)\b/i;

const title = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/**
 * Nama yang sudah dirapikan kalau nama profil itu tampak seperti nama orang,
 * atau null kalau tidak jelas (inisial, julukan, nama usaha, emoji, angka).
 */
export function plausibleName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Emoji dan hiasan di tepi dibuang dulu; yang di tengah membuatnya gugur.
  // Angka tidak ikut dibuang: "Budi123" bukan nama, dan harus tetap gugur.
  const s = raw.normalize('NFKC').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 40) return null;
  if (!/^[\p{L}][\p{L} .'’-]*$/u.test(s)) return null; // angka, garis bawah, simbol
  if (NOT_A_PERSON.test(s)) return null;

  const words = s.split(' ');
  if (words.length > 4) return null;
  const letters = (w: string): string => w.replace(/[^\p{L}]/gu, '');
  // Kata pertama harus kata sungguhan, bukan inisial ("J", "A.").
  if (letters(words[0] as string).length < 3) return null;
  for (const w of words) {
    const l = letters(w);
    if (l.length > 15) return null;
    if (l.length >= 3 && !/[aeiouy]/i.test(l)) return null; // "xxx", "bcd"
    if (/(.)\1\1/i.test(l)) return null; // "aaaa", "wkwkwkk"
    if (/[a-z][A-Z]/.test(w)) return null; // "DemonSlayer"
  }
  // Satu kata panjang tanpa spasi hampir selalu julukan ("demonslayer").
  if (words.length === 1 && letters(s).length >= 10) return null;

  // Rapikan huruf besar-kecilnya kalau seluruhnya kecil atau seluruhnya besar.
  const plain = s === s.toLowerCase() || s === s.toUpperCase();
  return plain ? words.map(title).join(' ') : s;
}
