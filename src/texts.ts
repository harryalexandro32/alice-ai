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

/** Jawaban tetap untuk pelanggan yang minta tidak dihubungi lagi; pesan terakhir bot ke nomor itu. */
export const OPT_OUT_ACK = 'Baik, kami tidak akan menghubungi lagi. Terima kasih 🙏';

export const NON_TEXT =
  'Mohon maaf, boleh diketik saja pertanyaannya? 🙏 Biar bisa langsung kami bantu.';

/** Pelanggan mengirim sesuatu yang tidak bisa dilihat/didengar bot. */
export function mediaAck(kind: string): string {
  return kind === 'suara'
    ? 'Terima kasih pesan suaranya 🙏 Kami teruskan ke tim supaya didengarkan. Kalau berkenan, boleh juga diketik supaya bisa langsung kami bantu.'
    : `Terima kasih, ${kind}-nya sudah kami terima 🙏 Kami teruskan ke tim supaya dicek dulu ya.`;
}

export const handoffText = (): string =>
  `Terima kasih, pertanyaan ${biz.honorific} sudah kami teruskan ke tim ${biz.brand}. ` +
  'Tim kami akan segera menghubungi ya 🙏';

export function listFields(missing: LeadField[]): string {
  const parts = missing.map((f) => f.label);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} dan ${parts[parts.length - 1]}`;
}

/** Dipakai waktu LLM tidak bisa menjawab tapi data lead masih kurang. */
export function askMissing(missing: LeadField[]): string {
  return `Terima kasih pesannya 🙏 Supaya tim kami bisa bantu, boleh diinfokan ${listFields(missing)}?`;
}

export function followupText(name: string | null, missing: LeadField[]): string {
  const hi = name ? `Halo ${name}` : 'Halo';
  const open = `${hi}, kami dari ${biz.brand} 🙏 Menyambung chat sebelumnya, `;
  return missing.length
    ? `${open}supaya tim kami bisa bantu dengan tepat, boleh diinfokan ${listFields(missing)}?`
    : `${open}${biz.followupClosing}`;
}

/** Pengingat setelah admin manusia membalas dan pelanggan diam: kalimat tetap, suara tim sales. */
export function humanFollowupText(name: string | null): string {
  const hi = name ? `Halo ${name}` : 'Halo';
  return `${hi}, menyambung chat sebelumnya dengan tim kami, apakah masih ada yang bisa kami bantu? 🙏`;
}
