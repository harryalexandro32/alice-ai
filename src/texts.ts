/**
 * Kalimat tetap mesin. Tidak ada nama klien di sini: merek, sapaan, dan nama
 * field semuanya dibaca dari profil bisnis saat dipakai (profil bisa berubah
 * lewat dashboard). Salam pembuka sepenuhnya milik profil — Business.greeting.
 */

import { biz } from './business';
import type { LeadField } from './business/types';

/**
 * Buang tanda pisah panjang (— dan –) dari teks yang dikirim bot.
 *
 * Tanda itu jarang diketik orang di WhatsApp dan membuat balasan terasa
 * buatan mesin. Di antara angka ia menjadi tanda hubung biasa ("23–25" ->
 * "23-25"); di tempat lain menjadi koma. Dipasang di semua jalan keluar, jadi
 * berlaku juga untuk teks yang ditulis pemilik di dashboard.
 */
export function noDash(text: string): string {
  return text
    .replace(/(\d)[ \t]*[\u2013\u2014][ \t]*(\d)/g, '$1-$2')
    .replace(/[ \t]*\u2014[ \t]*/g, ', ')
    .replace(/[ \t]+\u2013[ \t]+/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/^[ \t]*,[ \t]*/gm, '')
    .replace(/,[ \t]*$/gm, '')
    .replace(/,[ \t]*([,.!?:;])/g, '$1');
}

/** Emoji ramah yang dipakai bot: tangan terkatup (terima kasih, maaf, minta tolong) dan senyum. */
export const PRAY = '🙏🏻';
export const SMILE = '☺️';

/**
 * Satu emoji utuh: karakter yang memang tampil sebagai emoji, atau simbol yang
 * diberi penanda tampilan emoji (FE0F, mis. "☺️" dan "❤️"); termasuk warna
 * kulit, gabungan ZWJ, dan bendera (dua huruf regional). Sengaja tidak
 * menangkap © ® ™ ★ ✓, tanda panah, dan "☺" tanpa FE0F, yang bisa muncul di
 * nama produk atau teks biasa.
 */
const EMOJI_SRC =
  '(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\u{FE0F})[\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*' +
  '(?:\\u{200D}\\p{Extended_Pictographic}[\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*)*';
const EMOJI = new RegExp(EMOJI_SRC, 'u');
/** Rangkaian emoji, boleh berselang spasi ("🙏 😊"), beserta spasi di kiri-kanannya. */
const EMOJI_RUN = new RegExp(`[ \\t]*(?:${EMOJI_SRC})(?:[ \\t]*(?:${EMOJI_SRC}))*[ \\t]*`, 'gu');
const FIRST_OF_RUN = new RegExp(`^([ \\t]*(?:${EMOJI_SRC}))(?:[ \\t]*(?:${EMOJI_SRC}))*`, 'u');

export const hasEmoji = (text: string | null | undefined): boolean => EMOJI.test(text ?? '');

/** Teks tanpa emoji sama sekali, mis. "halo 🙏🏻" -> "halo ". Untuk mengenali isi pesan. */
export const withoutEmoji = (text: string): string => text.replace(new RegExp(EMOJI_SRC, 'gu'), '');

/**
 * Dua kalimat tetap dianggap sama kalau isinya sama tanpa emoji dan spasi
 * berlebih. Kalimat lama yang tersimpan (mis. dengan 🙏 polos) tetap dikenali
 * setelah emojinya berganti, jadi tidak terkirim ulang.
 */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const bare = (t: string): string => withoutEmoji(t).replace(/\s+/g, ' ').trim();
  return bare(a) === bare(b);
}

/** Sapaan yang ditulis dengan huruf besar di tengah kalimat ("Siap 🙏🏻 Pak"). */
const HONORIFICS = new Set(['Pak', 'Bu', 'Bapak', 'Ibu', 'Kak', 'Kakak', 'Mas', 'Mbak', 'Gan', 'Bos', 'Om', 'Tante', 'Bang', 'Sis']);

/** Sapaan profil ("Bapak/Ibu" -> "Bapak"); kosong kalau belum ada proyek. */
function ownHonorific(): string {
  try {
    const w = biz.honorific.match(/^\p{L}+/u)?.[0] ?? '';
    return w.charAt(0).toUpperCase() + w.slice(1);
  } catch {
    return '';
  }
}

/**
 * Kata berhuruf besar sesudah emoji yang bukan awal kalimat baru: sapaan
 * ("Pak", sapaan profil) atau kode/merek berhuruf kapital semua ("GFAN",
 * "GFAF-40A").
 */
function keepsSentence(after: string): boolean {
  const word = after.match(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/u)?.[0] ?? '';
  if (HONORIFICS.has(word)) return true;
  if (!/\p{Ll}/u.test(word) && word.replace(/-/g, '').length >= 2) return true;
  return word !== '' && word === ownHonorific();
}

/**
 * Buang rangkaian emoji dari balasan, kecuali `keep` rangkaian pertama (yang
 * juga dipangkas ke satu emoji). Emoji yang dipakai sebagai akhir kalimat
 * ("Terima kasih 🙏 Kami cek dulu") diganti titik, supaya kalimatnya tidak
 * menyambung; sebelum sapaan atau kode produk ("Siap 🙏🏻 Pak") cukup spasi, dan
 * sebelum tanda baca ("ya 🙏🏻, nanti") tidak diganti apa pun.
 */
function dropEmoji(text: string, keep: number): string {
  let seen = 0;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(EMOJI_RUN)) {
    const run = m[0];
    const at = m.index ?? 0;
    out += text.slice(last, at);
    last = at + run.length;
    // Rangkaian yang dipertahankan pun dipangkas ke emoji pertamanya ("🙏🏻😊" -> "🙏🏻").
    if (seen++ < keep) {
      out += run.replace(FIRST_OF_RUN, '$1');
      continue;
    }
    // Yang sebelumnya dilihat dari hasil yang sudah jadi, bukan dari teks asli.
    const after = text.slice(last);
    const midLine = out !== '' && !out.endsWith('\n') && after !== '' && !after.startsWith('\n');
    if (!midLine || /^[,.!?:;)]/.test(after) || out.endsWith('(')) continue;
    out += /[\p{L}\p{N}]$/u.test(out) && /^\p{Lu}/u.test(after) && !keepsSentence(after) ? '. ' : ' ';
  }
  out += text.slice(last);
  if (out === text) return text;
  // Rapikan sisa spasi: satu spasi di dalam baris, tanpa spasi di ujung baris,
  // paling banyak satu baris kosong di antara paragraf.
  return out
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Paling banyak satu emoji per balasan: yang pertama yang dipertahankan. */
export const oneEmoji = (text: string): string => dropEmoji(text, 1);

/**
 * Emoji di balasan LLM, supaya tidak muncul di setiap pesan: kalau salah satu
 * dari dua pesan bot terakhir (`recentOuts`, terbaru di akhir) sudah memakai
 * emoji, balasan ini tanpa emoji; kalau tidak, paling banyak satu. Balasan
 * yang isinya hanya emoji ("🙏🏻") tetap dikirim dengan satu emoji, supaya
 * tidak menjadi balasan kosong yang diserahkan ke tim.
 */
export function paceEmoji(reply: string, recentOuts: readonly (string | null | undefined)[]): string {
  if (!recentOuts.slice(-2).some(hasEmoji)) return oneEmoji(reply);
  const bare = dropEmoji(reply, 0);
  return bare.trim() ? bare : oneEmoji(reply);
}

/**
 * Follow-up tulisan LLM selalu ditutup dengan tepat satu emoji: emoji pertama
 * yang ditulis LLM, atau 🙏🏻. Emoji lain di tengah teks dibuang.
 */
export function followupEmoji(text: string): string {
  const close = text.match(EMOJI)?.[0] ?? PRAY;
  const body = dropEmoji(text, 0).trimEnd();
  return body ? `${body} ${close}` : close;
}

/** Jawaban tetap untuk pelanggan yang minta tidak dihubungi lagi; pesan terakhir bot ke nomor itu. */
export const OPT_OUT_ACK = `Baik, kami tidak akan menghubungi lagi. Terima kasih ${PRAY}`;

export const NON_TEXT =
  `Mohon maaf, boleh diketik saja pertanyaannya? ${PRAY} Biar bisa langsung kami bantu.`;

/** Pelanggan mengirim sesuatu yang tidak bisa dilihat/didengar bot. */
export function mediaAck(kind: string): string {
  return kind === 'suara'
    ? `Terima kasih pesan suaranya ${PRAY} Kami teruskan ke tim supaya didengarkan. Kalau berkenan, boleh juga diketik supaya bisa langsung kami bantu.`
    : `Terima kasih, ${kind}-nya sudah kami terima ${PRAY} Kami teruskan ke tim supaya dicek dulu ya.`;
}

export const handoffText = (): string =>
  `Terima kasih, pertanyaan ${biz.honorific} sudah kami teruskan ke tim ${biz.brand}. ` +
  `Tim kami akan segera menghubungi ya ${PRAY}`;

export function listFields(missing: LeadField[]): string {
  const parts = missing.map((f) => f.label);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} dan ${parts[parts.length - 1]}`;
}

/** Dipakai waktu LLM tidak bisa menjawab tapi data lead masih kurang. */
export function askMissing(missing: LeadField[]): string {
  return `Terima kasih pesannya ${PRAY} Supaya tim kami bisa bantu, boleh diinfokan ${listFields(missing)}?`;
}

export function followupText(name: string | null, missing: LeadField[]): string {
  const hi = name ? `Halo ${name}` : 'Halo';
  const open = `${hi}, kami dari ${biz.brand} ${PRAY} Menyambung chat sebelumnya, `;
  return missing.length
    ? `${open}supaya tim kami bisa bantu dengan tepat, boleh diinfokan ${listFields(missing)}?`
    : `${open}${biz.followupClosing}`;
}

/** Pengingat setelah admin manusia membalas dan pelanggan diam: kalimat tetap, suara tim sales. */
export function humanFollowupText(name: string | null): string {
  const hi = name ? `Halo ${name}` : 'Halo';
  return `${hi}, menyambung chat sebelumnya dengan tim kami, apakah masih ada yang bisa kami bantu? ${PRAY}`;
}
