/**
 * Yang harus bisa dilakukan sebuah jalur WhatsApp. Baileys dan Cloud API
 * sama-sama memenuhi ini; alur percakapan tidak tahu bedanya.
 */

/** Isi pesan yang bukan teks. Bot tidak bisa melihat/mendengarnya; staf yang bisa. */
export type MediaKind = 'foto' | 'video' | 'suara' | 'dokumen' | 'stiker' | 'lokasi' | 'kontak';

export interface TransportInbound {
  /** "+62…", atau "lid:…" kalau nomornya tidak diberikan. */
  phone: string;
  /** Alamat balasan (JID di Baileys, nomor di Cloud API). */
  address: string;
  /** Null = bukan teks. Untuk foto/video/dokumen: keterangannya, kalau ada. */
  text: string | null;
  /** Nama profil WhatsApp pengirim, kalau ia mengisinya dan membagikannya. */
  profileName?: string;
  /** Diisi kalau pesannya membawa foto, suara, dan sejenisnya. */
  media?: MediaKind;
  /** Untuk foto dan pesan suara: unduh isinya (baru dipanggil kalau memang akan dipakai). */
  fetchMedia?: () => Promise<{ data: Buffer; mime: string } | null>;
  waId: string | null;
}

export interface TransportHandlers {
  onInbound(m: TransportInbound): void;
  /** Pemilik nomor membalas sendiri dari aplikasi WhatsApp. */
  onHumanReply(m: { address: string; text: string }): void;
}

export interface SendOptions {
  /** Notifikasi ke sales, bukan balasan ke pelanggan (boleh memakai template). */
  notify?: boolean;
  /** Path file foto atau PDF. Kalau ada, teksnya menjadi keterangannya. */
  image?: string;
  /** Nama berkas yang dilihat penerima (untuk PDF). */
  fileName?: string;
}

export interface Transport {
  name: string;
  start(handlers: TransportHandlers): Promise<void>;
  /** `address` kosong = turunkan dari `phone`. */
  send(to: { phone: string; address: string }, text: string, opts?: SendOptions): Promise<void>;
  /** Tampilkan "sedang mengetik…" ke lawan bicara, kalau jalurnya bisa. */
  typing?(to: { phone: string; address: string }): Promise<void>;
  /** Nomor bot sendiri ("+62…"), atau null kalau belum diketahui. */
  selfPhone(): string | null;
  /**
   * Bisakah mengirim pesan ke nomor sendiri? Baileys bisa (chat "pesan ke diri
   * sendiri"); Cloud API tidak — sebuah nomor bisnis tidak bisa mengirimi
   * dirinya lewat API.
   */
  canMessageSelf: boolean;
}
