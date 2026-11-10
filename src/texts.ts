/**
 * Semua kalimat tetap bot, di satu tempat — supaya klien bisa minta ganti
 * kata-kata tanpa ada yang perlu membaca logika.
 */

export const BRAND = 'GFAN Indonesia';

export const GREETING =
  `Halo, terima kasih sudah menghubungi ${BRAND} 🙏\n` +
  'Saya asisten virtual GFAN, siap bantu info produk kipas & ventilasi kami.\n\n' +
  'Supaya bisa kami bantu dengan tepat, boleh diinfokan:\n' +
  '1. Nama\n' +
  '2. Kota / alamat\n' +
  '3. Kebutuhan (jenis kipas atau untuk ruangan apa)';

export const NON_TEXT =
  'Mohon maaf, saat ini saya baru bisa membaca pesan teks 🙏 Boleh diketik pertanyaannya?';

export const HANDOFF =
  'Terima kasih, pertanyaan Bapak/Ibu sudah kami teruskan ke tim sales GFAN. ' +
  'Tim kami akan segera menghubungi ya 🙏';

const LABEL = { name: 'nama', city: 'kota/alamat', need: 'kebutuhannya' } as const;
export type LeadField = keyof typeof LABEL;

export function listFields(missing: LeadField[]): string {
  const parts = missing.map((f) => LABEL[f]);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} dan ${parts[parts.length - 1]}`;
}

/** Dipakai waktu LLM tidak bisa menjawab tapi data lead masih kurang. */
export function askMissing(missing: LeadField[]): string {
  return `Terima kasih pesannya 🙏 Supaya tim kami bisa bantu, boleh diinfokan ${listFields(missing)}?`;
}

export function followupText(name: string | null, missing: LeadField[]): string {
  const hi = name ? `Halo ${name}` : 'Halo';
  if (missing.length) {
    return (
      `${hi}, kami dari ${BRAND} 🙏 Menyambung chat sebelumnya — supaya tim kami bisa ` +
      `bantu rekomendasi yang pas, boleh diinfokan ${listFields(missing)}?`
    );
  }
  return (
    `${hi}, kami dari ${BRAND} 🙏 Menyambung chat sebelumnya — apakah masih ada yang ` +
    'bisa kami bantu soal kebutuhan kipas/ventilasinya?'
  );
}
