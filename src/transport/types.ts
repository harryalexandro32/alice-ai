/**
 * Yang harus bisa dilakukan sebuah jalur WhatsApp. Baileys dan Cloud API
 * sama-sama memenuhi ini; alur percakapan tidak tahu bedanya.
 */

export interface TransportInbound {
  /** "+62…", atau "lid:…" kalau nomornya tidak diberikan. */
  phone: string;
  /** Alamat balasan (JID di Baileys, nomor di Cloud API). */
  address: string;
  /** Null = bukan teks. */
  text: string | null;
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
}

export interface Transport {
  name: string;
  start(handlers: TransportHandlers): Promise<void>;
  /** `address` kosong = turunkan dari `phone`. */
  send(to: { phone: string; address: string }, text: string, opts?: SendOptions): Promise<void>;
  /** Nomor bot sendiri ("+62…"), atau null kalau belum diketahui. */
  selfPhone(): string | null;
  /**
   * Bisakah mengirim pesan ke nomor sendiri? Baileys bisa (chat "pesan ke diri
   * sendiri"); Cloud API tidak — sebuah nomor bisnis tidak bisa mengirimi
   * dirinya lewat API.
   */
  canMessageSelf: boolean;
}
