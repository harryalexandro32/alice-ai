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
 * Satu emoji utuh: termasuk warna kulit, penanda tampilan emoji (FE0F), dan
 * gabungan ZWJ. Sengaja tidak menangkap © ® ™ dan tanda panah, yang bisa
 * muncul di nama produk.
 */
const EMOJI_SRC =
  '[\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F000}-\\u{1FAFF}][\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*' +
  '(?:\\u{200D}[\\u{2600}-\\u{27BF}\\u{1F000}-\\u{1FAFF}][\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*)*';
const EMOJI = new RegExp(EMOJI_SRC, 'u');
const EMOJI_RUN = new RegExp(`[ \\t]*(?:${EMOJI_SRC})+[ \\t]*`, 'gu');

export const hasEmoji = (text: string | null | undefined): boolean => EMOJI.test(text ?? '');

/** Teks tanpa emoji sama sekali, mis. "halo 🙏🏻" -> "halo ". Untuk mengenali isi pesan. */
export const withoutEmoji = (text: string): string => text.replace(new RegExp(EMOJI_SRC, 'gu'), '');

/**
 * Buang rangkaian emoji dari balasan, kecuali `keep` rangkaian pertama (yang
 * juga dipangkas ke satu emoji). Emoji yang dipakai sebagai akhir kalimat
 * ("Terima kasih 🙏 Kami cek dulu") diganti titik, supaya kalimatnya tidak
 * menyambung.
 */
function dropEmoji(text: string, keep: number): string {
  let seen = 0;
  return text.replace(EMOJI_RUN, (run, at: number, s: string) => {
    // Rangkaian yang dipertahankan pun dipangkas ke emoji pertamanya ("🙏🏻😊" -> "🙏🏻").
    if (seen++ < keep) return run.replace(new RegExp(`^([ \\t]*${EMOJI_SRC})(?:${EMOJI_SRC})*`, 'u'), '$1');
    const before = s.slice(0, at);
    const after = s.slice(at + run.length);
    const midLine = before !== '' && !before.endsWith('\n') && after !== '' && !after.startsWith('\n');
    if (!midLine) return '';
    return /[\p{L}\p{N}]$/u.test(before) && /^\p{Lu}/u.test(after) ? '. ' : ' ';
  });
}

/** Paling banyak satu emoji per balasan: yang pertama yang dipertahankan. */
export const oneEmoji = (text: string): string => dropEmoji(text, 1);

/**
 * Emoji di balasan LLM, supaya tidak muncul di setiap pesan: kalau salah satu
 * dari dua pesan bot terakhir (`recentOuts`, terbaru di akhir) sudah memakai
 * emoji, balasan ini tanpa emoji; kalau tidak, paling banyak satu.
 */
export function paceEmoji(reply: string, recentOuts: readonly (string | null | undefined)[]): string {
  return recentOuts.slice(-2).some(hasEmoji) ? dropEmoji(reply, 0) : oneEmoji(reply);
}

/** Follow-up selalu ditutup dengan tepat satu emoji: yang ditulis LLM, atau 🙏🏻. */
export function followupEmoji(text: string): string {
  const one = oneEmoji(text).trimEnd();
  return hasEmoji(one) ? one : `${one} ${PRAY}`;
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
