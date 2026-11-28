/**
 * Katalog GFAN, ditranskripsi dari tujuh PDF di catalog-pdf/.
 *
 * Ditulis tangan, bukan hasil pdftotext: kolom tabelnya berantakan kalau
 * diekstrak otomatis, dan satu angka yang bergeser kolom sudah cukup buat bikin
 * bot menjawab salah dengan yakin. Angka di sini PERSIS seperti di PDF —
 * termasuk yang tampak janggal (lihat CATATAN di bawah). Jangan "dirapikan".
 *
 * Tabel di sini TIDAK memuat harga, stok, garansi, maupun kontak. Harga dari
 * price list (Agustus 2026) ada di daftar produk (profile.ts), bukan di sini.
 */

import { renderCatalog } from '../catalog';

export interface Table {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface Series {
  id: string;
  name: string;
  source: string;
  facts: string[];
  tables: Table[];
}

export const SERIES: Series[] = [
  {
    id: 'GFC-B4',
    name: 'Ceiling Fan GFC — Model B4 (ceiling vent-type)',
    source: 'Ceiling Fan - GFan.pdf',
    facts: [
      'Dipasang di plafon untuk ventilasi ruangan.',
      'Material rangka dan louver: ABS & PP.',
      'Aplikasi: toilet, kantor, kamar tidur.',
      '2 pilihan model. Air delivery 120–150 m³/h, daya 24–30 W, 220 V 50 Hz, kebisingan 41–43 dB.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: ['Model', 'Tegangan (V)', 'Frekuensi (Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Kebisingan (dB)'],
        rows: [
          ['GFC10-12B4', '220', '50', '24', '120', '41'],
          ['GFC10-15B4', '220', '50', '30', '150', '43'],
        ],
      },
      {
        title: 'Ukuran pemasangan (mm)',
        columns: ['Model', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
        rows: [
          ['GFC10-12B4', '245', '202', '238', '30', '167', '98', '156'],
          ['GFC10-15B4', '268', '223', '260', '30', '167', '98', '156'],
        ],
      },
    ],
  },
  {
    id: 'GFC-A',
    name: 'Ceiling Fan GFC — Model A (ceiling vent-type)',
    source: 'Ceiling Fan A - GFan.pdf',
    facts: [
      'Dipasang di plafon untuk ventilasi ruangan.',
      'Material rangka dan louver: ABS & PP.',
      'Aplikasi: toilet, kantor, kamar tidur.',
      '5 pilihan model. Air delivery 100–330 m³/h, daya 20–52 W, 220 V 50 Hz, kebisingan 39–45 dB.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: ['Model', 'Tegangan (V)', 'Frekuensi (Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Kebisingan (dB)'],
        rows: [
          ['GFC10-10A', '220', '50', '20', '100', '39'],
          ['GFC10-12A', '220', '50', '24', '120', '41'],
          ['GFC10-15A', '220', '50', '30', '150', '43'],
          ['GFC15-18A', '220', '50', '43', '250', '45'],
          ['GFC15-20A', '220', '50', '52', '330', '45'],
        ],
      },
      {
        title: 'Ukuran pemasangan (mm)',
        columns: ['Model', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
        rows: [
          ['GFC10-10A', '195', '127', '155', '99', '18', '85', '170'],
          ['GFC10-12A', '245', '170', '189', '122', '30', '98', '200'],
          ['GFC10-15A', '268', '176', '215', '128', '30', '98', '225'],
          ['GFC15-18A', '340', '193', '275', '134', '37', '120', '290'],
          ['GFC15-20A', '400', '200', '310', '144', '37', '149', '327'],
        ],
      },
    ],
  },
  {
    id: 'GFAF-A',
    name: 'Plate Mounted Industrial Ventilation Fan — GFAF-A',
    source: 'Industrial Fan - GFan.pdf',
    facts: [
      'Kipas ventilasi industri tipe plate mounted, dipasang pada dinding atau plat.',
      '8 pilihan ukuran, 8 inci sampai 24 inci.',
      'Air delivery 840–6900 m³/h, daya 32–300 W, 220/380 V 50 Hz, kebisingan 50–67 dB.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: ['Model', 'Ukuran', 'Tegangan (V)', 'Frekuensi (Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Dimensi dus (cm)', 'Set/dus', 'Berat total (kg)', 'Kebisingan (dB)'],
        rows: [
          ['GFAF-20A', '8"', '220', '50', '32', '840', '80 x 26 x 26', '5', '10', '50'],
          ['GFAF-25A', '10"', '220', '50', '42', '1020', '81 x 31 x 31', '5', '11.5', '52'],
          ['GFAF-30A', '12"', '220', '50', '52', '1170', '86 x 38 x 38', '5', '15', '56'],
          ['GFAF-35A', '14"', '220', '50', '62', '1350', '84 x 44 x 44', '4', '17.5', '62'],
          ['GFAF-40A', '16"', '220/380', '50', '130', '2880', '50 x 28 x 50', '1', '8.5', '62'],
          ['GFAF-45A', '18"', '220/380', '50', '180', '3600', '56 x 28 x 56', '1', '10', '64'],
          ['GFAF-50A', '20"', '220/380', '50', '230', '5700', '61 x 29 x 61', '1', '11', '64'],
          ['GFAF-60A', '24"', '220/380', '50', '300', '6900', '72 x 29 x 72', '1', '16', '67'],
        ],
      },
      {
        title: 'Ukuran pemasangan (mm)',
        columns: ['Model', 'A', 'B', 'C', 'D'],
        rows: [
          ['GFAF-20A', '220', '202', '150', '12'],
          ['GFAF-25A', '270', '255', '150', '12'],
          ['GFAF-30A', '325', '300', '150', '12'],
          ['GFAF-35A', '375', '340', '180', '12'],
          ['GFAF-40A', '420', '375', '250', '16'],
          ['GFAF-45A', '470', '430', '260', '16'],
          ['GFAF-50A', '520', '480', '260', '16'],
          ['GFAF-60A', '620', '560', '345', '18'],
        ],
      },
    ],
  },
  {
    id: 'GFAF-AB',
    name: 'Steel Exhaust Fan With Shutter — GFAF-AB',
    source: 'Industrial Fan + Shutter - GFan.pdf',
    facts: [
      'Exhaust fan industri dari baja, dilengkapi shutter.',
      '6 pilihan ukuran, 8 inci sampai 18 inci.',
      'Air delivery 840–5700 m³/h, daya 32–230 W, 220/380 V 50 Hz, kebisingan 50–64 dB.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: ['Model', 'Ukuran', 'Tegangan (V)', 'Frekuensi (Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Dimensi dus (cm)', 'Set/dus', 'Berat total (kg)', 'Kebisingan (dB)'],
        rows: [
          ['GFAF-20AB', '8"', '220', '50', '32', '840', '80 x 26 x 26', '5', '10', '50'],
          ['GFAF-25AB', '10"', '220', '50', '42', '1020', '81 x 31 x 31', '5', '11.5', '52'],
          ['GFAF-30AB', '12"', '220', '50', '52', '1170', '86 x 38 x 38', '5', '15', '56'],
          ['GFAF-35AB', '14"', '220', '50', '62', '1350', '84 x 44 x 44', '4', '17.5', '62'],
          ['GFAF-40AB', '16"', '220/380', '50', '130', '2880', '50 x 28 x 50', '1', '8.5', '62'],
          // CATATAN: di PDF, baris 18" ini memuat angka yang sama dengan GFAF-50A
          // (20") di lembar plate mounted, bukan GFAF-45A. Ditulis apa adanya.
          ['GFAF-45AB', '18"', '220/380', '50', '230', '5700', '61 x 29 x 61', '1', '11', '64'],
        ],
      },
      {
        title: 'Ukuran pemasangan (mm)',
        columns: ['Model', 'A', 'B', 'C', 'D'],
        rows: [
          ['GFAF-20AB', '220', '202', '150', '12'],
          ['GFAF-25AB', '270', '255', '150', '12'],
          ['GFAF-30AB', '325', '300', '150', '12'],
          ['GFAF-35AB', '375', '340', '180', '12'],
          ['GFAF-40AB', '420', '375', '250', '16'],
          ['GFAF-45AB', '520', '480', '260', '16'],
        ],
      },
    ],
  },
  {
    id: 'GAI',
    name: 'Axial In-Line Fan — GAI Series (circular duct fan)',
    source: 'Inline Fan - GFan.pdf',
    facts: [
      'Kipas in-line untuk ducting bulat. Volume udara besar dan tekanan tinggi.',
      'Kebisingan rendah, getaran kecil, konsumsi daya rendah, umur panjang, ukuran ringkas, bobot ringan.',
      'Cocok untuk: rumah, apartemen, villa, kantor, ruang rapat, mal, hotel, restoran, stasiun.',
      '6 ukuran: GAI-100 (4"), GAI-125 (5"), GAI-150 (6"), GAI-200 (8"), GAI-250 (10"), GAI-315 (12").',
      'Tersedia versi single speed dan two speed. Air delivery 180–2900 m³/h, daya 30–320 W, 220 V 50 Hz, kebisingan 28–66 dB.',
      'Pada tabel two speed, angka ditulis kecepatan rendah/kecepatan tinggi.',
      'Kurva performa (tekanan vs volume) ada di halaman 2 katalognya; angkanya tidak dimuat di sini.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis — single speed',
        columns: ['Model', 'Tegangan/Frek. (V/Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Tekanan (Pa)', 'Kebisingan (dB)', 'Putaran (RPM)', 'Arus (A)'],
        rows: [
          ['GAI-100', '220/50', '35', '220', '150', '31', '2600', '0,13'],
          ['GAI-125', '220/50', '40', '310', '180', '34', '2600', '0,14'],
          ['GAI-150', '220/50', '75', '540', '300', '38', '2600', '0,22'],
          ['GAI-200', '220/50', '130', '900', '380', '43', '2600', '0,53'],
          ['GAI-250', '220/50', '225', '1405', '488', '66', '2450', '1,2'],
          ['GAI-315', '220/50', '320', '2900', '630', '65', '2500', '1,65'],
        ],
      },
      {
        title: 'Spesifikasi teknis — two speed (rendah/tinggi)',
        columns: ['Model', 'Tegangan/Frek. (V/Hz)', 'Daya (W)', 'Air delivery (m³/h)', 'Tekanan (Pa)', 'Kebisingan (dB)', 'Putaran (RPM)', 'Arus (A)'],
        rows: [
          ['GAI-100', '220/50', '30/35', '180/220', '130/150', '28/31', '2200/2600', '0,11/0,13'],
          ['GAI-125', '220/50', '35/40', '265/310', '120/180', '31/34', '2200/2600', '0,13/0,14'],
          ['GAI-150', '220/50', '58/75', '500/540', '270/300', '34/38', '2200/2600', '0,2/0,22'],
          ['GAI-200', '220/50', '100/130', '700/900', '302/380', '40/43', '2200/2600', '0,5/0,53'],
          ['GAI-250', '220/50', '165/225', '1064/1405', '371/488', '58/66', '1850/2450', '0,75/1,2'],
          ['GAI-315', '220/50', '245/320', '2150/2900', '420/630', '57/65', '1900/2500', '1,15/1,65'],
        ],
      },
      {
        title: 'Ukuran pemasangan (mm) dan berat',
        columns: ['Model', 'A', 'B', 'C', 'D', 'E', 'F', 'Berat (kg)'],
        rows: [
          ['GAI-100', '300', '96', '195', '202', '80', '60', '1,4'],
          ['GAI-125', '255', '122', '195', '202', '80', '60', '1,95'],
          ['GAI-150', '315', '148', '235', '226', '100', '60', '2,3'],
          ['GAI-200', '300', '197', '235', '246', '100', '95', '3,45'],
          ['GAI-250', '385', '245', '275', '300', '133', '100', '6,85'],
          ['GAI-315', '385', '310', '340', '360', '155', '122', '11'],
        ],
      },
    ],
  },
  {
    id: 'GZ',
    name: 'Jet Fan — Seri GZ',
    source: 'Jet Fan - GFan.pdf',
    facts: [
      '3 model: GZ-200, GZ-250, GZ-300. Air volume 1360–3000 m³/h.',
      'Semua model berputar 2900 r/min. Daya 0,2–0,55 kW. Kebisingan 50–69 dB(A).',
      'GZ-200 dan GZ-250 memakai 220 V/50 Hz (satu fasa); GZ-300 memakai 380 V/50 Hz (tiga fasa).',
      'Gambar dimensi ada di katalognya; angkanya tidak dimuat di sini.',
      'Di price list jet fan (Agustus 2026), GZ-300 ditulis sebagai GZ-315; spesifikasinya sama (3000 m³/h, 0,55 kW, 220/380 V).',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: ['Model', 'Air volume (m³/h)', 'Tekanan (Pa)', 'Putaran (r/min)', 'Daya (kW)', 'Tegangan (V/Hz)', 'Kebisingan (dB(A))', 'Berat (kg)'],
        rows: [
          ['GZ-200', '1360', '150', '2900', '0.2', '220/50', '50', '15'],
          ['GZ-250', '1998', '190', '2900', '0.21', '220/50', '59', '26'],
          ['GZ-300', '3000', '240', '2900', '0.55', '380/50', '69', '32'],
        ],
      },
    ],
  },
  {
    id: 'GAC',
    name: 'Evaporative Air Cooler — Seri GAC',
    source: 'Air Cooler - GFan.pdf',
    facts: [
      'Pendingin udara evaporatif (air cooler) beroda untuk area luas: gudang & workshop, area produksi, pabrik, bengkel, gedung olahraga, area komersial, restoran & kafe.',
      'Sistem evaporatif alami (bukan AC/freon): butuh udara segar masuk dan jalur buang udara panas supaya pendinginannya terasa.',
      'Motor 100% tembaga (copper). Semua model 220 V 50 Hz.',
      '5 model. Volume udara 12000–23000 m³/h, daya 550–1800 W, tangki air 100–260 L, area jangkauan 60–180 m².',
      // SEMENTARA: hapus setelah brosur yang sudah diperbaiki dipasang.
      'Brosur PDF air cooler yang beredar sekarang salah cetak: kodenya tertulis MHB (MHB-10-A, MHB-10-B, MHB-10-C, MHB-18-H, MHB-23-H). Kode yang benar GAC dengan angka dan huruf yang sama: MHB-18-H = GAC-18-H, dan seterusnya. Kalau pelanggan menyebut kode MHB, jawab dengan kode GAC yang sama dan jelaskan singkat bahwa itu model yang sama.',
    ],
    tables: [
      {
        title: 'Spesifikasi teknis',
        columns: [
          'Model', 'Volume udara (m³/h)', 'Daya (W)', 'Tegangan (V/Hz)', 'Kebisingan (dB)', 'Tangki air (L)',
          'Konsumsi air (L/jam)', 'Area jangkauan (m²)', 'Berat bersih/kotor (kg)', 'Dimensi P x L x T (mm)',
        ],
        rows: [
          ['GAC-10-A', '12000', '550', '220/50', '≤ 55', '100', '6–8', '60–80', '38 / 41', '870 x 870 x 1680'],
          ['GAC-10-B', '14000', '550', '220/50', '≤ 55', '100', '6–8', '60–80', '44 / 47', '870 x 870 x 1850'],
          // CATATAN: brosur menulis area "180–100 m²" (terbalik); price list menulis 100–180. Ditulis 100–180.
          ['GAC-10-C', '16000', '680', '220/50', '≤ 58', '100', '8–10', '100–180', '48 / 51', '870 x 870 x 2100'],
          ['GAC-18-H', '18000', '1100', '220/50', '≤ 75', '260', '5–10', '120–150', '72 / 75', '1100 x 1100 x 1960'],
          // CATATAN: brosur menulis 1800 W; price list menulis 1,30 kW. Ditulis angka brosur (lembar spesifikasi).
          ['GAC-23-H', '23000', '1800', '220/50', '≤ 80', '260', '5–10', '150–180', '82 / 85', '1100 x 1100 x 2200'],
        ],
      },
    ],
  },
];

/** Semua kode model yang benar-benar ada. Dipakai buat menolak model karangan. */
export const MODEL_CODES: ReadonlySet<string> = new Set(
  SERIES.flatMap((s) => s.tables.flatMap((t) => t.rows.map((r) => r[0] as string)))
);

/** Katalog sebagai teks polos buat prompt. Sama persis tiap panggilan. */
export function catalogText(): string {
  return renderCatalog(SERIES);
}

/**
 * Kode model yang disebut di sebuah teks tapi TIDAK ada di katalog.
 *
 * Polanya sengaja longgar (awalan seri + angka) supaya "GFC20-30A" maupun
 * "GZ-400" sama-sama tertangkap. "GFC Series" tanpa angka tidak dianggap kode.
 * Kode air cooler ditulis dengan dua tanda hubung (GAC-10-A); ejaan "GAC10A"
 * atau "GAC-10A" dirapikan dulu. Kode MHB-… (salah cetak di brosur lama) tetap
 * tertangkap dan ditolak, supaya bot tidak memakainya.
 */
export function unknownModels(text: string): string[] {
  const found = text.toUpperCase().match(/\b(?:GFC|GFAF|GAI|GZ|MHB|GAC)[-\s]?\d[0-9A-Z-]*/g) ?? [];
  return found
    .map((m) => m.replace(/\s+/g, '').replace(/-+$/, ''))
    .map((m) => (/^(GFAF|GAI|GZ)\d/.test(m) ? m.replace(/^(GFAF|GAI|GZ)/, '$1-') : m))
    .map((m) => m.replace(/^(MHB|GAC)-?(\d+)-?([A-Z])$/, '$1-$2-$3'))
    .filter((m) => !MODEL_CODES.has(m));
}
