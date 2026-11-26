/**
 * Tokopedia & Shop: tanda tangan API, webhook, state OAuth, bentuk pesanan,
 * kurir, dan aturan tahap; lalu dengan fetch tiruan dan database di memori:
 * tautkan toko, panggilan API, webhook, perpanjangan token, sinkron, dan
 * tautan pesanan ke percakapan. Tidak pernah menyentuh internet.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { loadProject, seedCtx } from './business';
import { cfg } from './config';
import { clearDb, db, openDb } from './db';
import { ensureProject } from './db/seed';
import { setDefaultProject, withProject } from './project';
import {
  createContact, getContact, getOrder, getShopLink, getWebhookEvent, hasWebhookEvent, listOrders, orderCounts, orderForContact, recentAlerts, saveShopLink, setOrderContact,
  setStageNote, updateContact, updateShopLink, upsertOrderRow, type ShopLink,
} from './store';
import {
  apiCall, consumeState, courierFromProvider, fetchOrders, handleWebhook, isPaid, linkOrderToContact, linkShop, makeState, matchOrder, MAX_PAGES, MAX_WEBHOOK_TRIES,
  normalizeOrder, onOrderRefChanged, readState, receiveWebhook, refreshDueTokens, refreshToken, resetStateKey, retryWebhooks, searchOrders, setAfterSaveHook, setTiktokFetch, signRequest, stageTargets,
  STATE_TTL_MS, syncOrders, syncRunning, TiktokError, unlinkShop, verifyWebhook, shopRound, webhookId, webhookProject, type TiktokFetch,
} from './tiktok';

setDefaultProject(seedCtx('gfan'));

const T0 = Date.UTC(2026, 10, 26, 3, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KEY = 'appkey123';
const SECRET = 'appsecret456';

/** Satu panggilan ke fetch tiruan. */
interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
let calls: Call[] = [];
/** Penjawab untuk panggilan berikutnya; melempar kalau alamatnya tidak diharapkan. */
let respond: (c: Call) => Response | Promise<Response> = (c) => {
  throw new Error(`panggilan tak terduga: ${c.method} ${c.url.pathname}`);
};
const fake: TiktokFetch = async (url, init) => {
  const c: Call = { url: new URL(url), method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) };
  calls.push(c);
  return respond(c);
};
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (data: unknown) => reply({ code: 0, message: 'Success', request_id: 'req-1', data });
const bad = (code: number, message: string, status = 200, headers: Record<string, string> = {}) =>
  reply({ code, message, request_id: 'req-2', data: {} }, status, headers);
const q = (c: Call) => Object.fromEntries(c.url.searchParams);
/** Gerbang untuk fetch tiruan: panggilan menunggu sampai `open()`. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}
/** Tunggu sampai fetch tiruan sudah dipanggil `n` kali. */
async function untilCalls(n: number): Promise<void> {
  while (calls.length < n) await new Promise((r) => setImmediate(r));
}

/** Panggilan API bisnis harus bertanda tangan sah, membawa app_key, timestamp, dan token di header. */
function assertSigned(c: Call, token: string): void {
  const query = q(c);
  const { sign, ...rest } = query;
  assert.equal(rest.app_key, KEY);
  assert.match(rest.timestamp ?? '', /^\d{10}$/);
  assert.ok(Math.abs(Number(rest.timestamp) - Date.now() / 1000) < 60, 'timestamp = sekarang, dalam detik');
  assert.equal(sign, signRequest(SECRET, c.url.pathname, rest, c.body), `tanda tangan ${c.url.pathname}`);
  assert.equal(c.headers['x-tts-access-token'], token);
  assert.equal(c.headers['content-type'], 'application/json');
}

const tokenData = (n: number, at = T0) => ({
  access_token: `akses-${n}`, access_token_expire_in: Math.floor((at + 7 * DAY) / 1000),
  refresh_token: `segar-${n}`, refresh_token_expire_in: Math.floor((at + 60 * DAY) / 1000),
  open_id: 'open-1', seller_name: 'Toko GFAN', seller_base_region: 'ID', user_type: 0, granted_scopes: ['seller.order.info'],
});

/** Tautan aktif tiruan langsung di database. */
async function seedLink(over: Partial<ShopLink> = {}): Promise<ShopLink> {
  return saveShopLink({
    shop_id: 'SHOP-ID', shop_cipher: 'CIPHER-ID', shop_name: 'GFAN Official', region: 'ID', seller_name: 'Toko GFAN', open_id: 'open-1',
    access_token: 'akses-0', access_expires_at: T0 + 7 * DAY, refresh_token: 'segar-0', refresh_expires_at: T0 + 60 * DAY,
    granted_scopes: [], linked_at: T0, last_sync_at: null, status: 'active', error: null, updated_at: T0, ...over,
  });
}

/** Pesanan API tiruan. */
const apiOrder = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, status, commerce_platform: 'TOKOPEDIA', create_time: Math.floor(T0 / 1000) - 3600, update_time: Math.floor(T0 / 1000),
  paid_time: status === 'UNPAID' ? 0 : Math.floor(T0 / 1000) - 3000, payment: { total_amount: '250000', currency: 'IDR' },
  line_items: [{ id: 'l1', product_name: 'Kipas', sku_id: 'S1', sale_price: '250000' }], ...over,
});

const ORDER = '576462377512830168';
const A = '+6281211110001';

const tests: [string, () => Promise<void> | void][] = [
  ['signRequest: contoh dari dokumentasi', () => {
    assert.equal(
      signRequest('e59af819cc', '/authorization/202309/shops', { app_key: '29a39d', timestamp: '1623812664' }),
      'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8'
    );
    // sign dan access_token tidak ikut; urutan kunci tidak berpengaruh.
    assert.equal(
      signRequest('e59af819cc', '/authorization/202309/shops', { timestamp: '1623812664', sign: 'x', access_token: 'y', app_key: '29a39d' }),
      'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8'
    );
    // Badan JSON ikut di belakang parameter.
    const body = '{"update_time_ge":1}';
    const expect = createHmac('sha256', 's').update('s/p' + 'a1b2' + body + 's').digest('hex');
    assert.equal(signRequest('s', '/p', { b: '2', a: '1' }, body), expect);
  }],

  ['verifyWebhook: badan asli diterima, yang lain ditolak', () => {
    const body = Buffer.from('{"type":1,"tts_notification_id":"7380066284010030890","shop_id":"7495540735365777507","timestamp":1718305585,"data":{"order_id":"576462377512830168","order_status":"CANCEL"}}');
    const sig = createHmac('sha256', '123').update(Buffer.concat([Buffer.from('abcdef'), body])).digest('hex');
    assert.equal(verifyWebhook('abcdef', '123', body, sig), true);
    assert.equal(verifyWebhook('abcdef', '124', body, sig), false, 'secret lain');
    assert.equal(verifyWebhook('abcdeg', '123', body, sig), false, 'app key lain');
    assert.equal(verifyWebhook('abcdef', '123', body, `Bearer ${sig}`), false, 'tanpa awalan');
    assert.equal(verifyWebhook('abcdef', '123', Buffer.from(body.toString().replace('CANCEL', 'COMPLETED')), sig), false, 'badan diubah');
    assert.equal(verifyWebhook('abcdef', '123', body, undefined), false);
    assert.equal(verifyWebhook('', '', body, sig), false);
  }],

  ['makeState / readState: bolak-balik, diubah, kedaluwarsa, kunci baru sesudah dimulai ulang', () => {
    cfg.adminPassword = 'kata-sandi-uji-123';
    const st = makeState('gfan', T0);
    assert.equal(readState(st, T0), 'gfan');
    assert.equal(readState(st, T0 + 29 * MIN), 'gfan');
    assert.equal(readState(st, T0 + 31 * MIN), null, '31 menit: kedaluwarsa');
    assert.equal(STATE_TTL_MS, 30 * MIN);
    const forged = Buffer.from(Buffer.from(st, 'base64url').toString().replace('gfan', 'toko')).toString('base64url');
    assert.equal(readState(forged, T0), null, 'proyek diganti');
    const later = Buffer.from(Buffer.from(st, 'base64url').toString().replace(String(T0), String(T0 + 1))).toString('base64url');
    assert.equal(readState(later, T0), null, 'waktu diganti');
    assert.equal(readState('', T0), null);
    assert.equal(readState('bukan-state', T0), null);
    // Kata sandi dashboard tidak dipakai untuk state: diganti atau kosong, state tetap sah.
    cfg.adminPassword = 'kata-sandi-lain-456';
    assert.equal(readState(st, T0), 'gfan', 'kata sandi dashboard berganti');
    cfg.adminPassword = '';
    assert.equal(readState(st, T0), 'gfan', 'kata sandi dashboard kosong');
    cfg.adminPassword = 'kata-sandi-uji-123';
    // Kunci state baru (dashboard dimulai ulang): state dari sebelumnya ditolak, state baru sah.
    const before = makeState('gfan', T0);
    resetStateKey();
    assert.equal(readState(before, T0), null, 'state dari sebelum dimulai ulang');
    assert.equal(readState(st, T0), null);
    assert.equal(readState(makeState('gfan', T0), T0), 'gfan', 'state baru');
    // Tiap state berbeda (angka acak), juga untuk waktu yang sama; masing-masing hanya sekali pakai.
    const st2 = makeState('gfan', T0);
    assert.notEqual(st2, st);
    assert.equal(readState(st2, T0), 'gfan');
    assert.equal(consumeState(st, T0), true, 'pemakaian pertama');
    assert.equal(consumeState(st, T0 + MIN), false, 'pemakaian kedua ditolak');
    assert.equal(consumeState(st2, T0 + MIN), true, 'state lain tidak terpengaruh');
    // Ejaan lain dari state yang sudah dipakai: dekoder Node mengabaikan "=" dan tanda asing, jadi semua ditolak.
    for (const variant of [`${st}=`, `${st}.`, `${st}==`, `.${st}`]) {
      assert.equal(readState(variant, T0), null, `readState ${variant.slice(-3)}`);
      assert.equal(consumeState(variant, T0 + MIN), false, `consumeState ${variant.slice(-3)}`);
    }
    // State yang belum dipakai dengan tanda asing: ditolak; yang asli tetap sah.
    const st3 = makeState('gfan', T0);
    assert.equal(readState(`${st3}.`, T0), null);
    assert.equal(readState(`${st3.slice(0, 5)}!${st3.slice(5)}`, T0), null);
    assert.equal(readState(st3, T0), 'gfan');
    // Ejaan bukan kanonis (bit sisa di huruf terakhir diubah, isinya sama): ditolak.
    let found = 0;
    for (let i = 0; i < 20 && !found; i += 1) {
      const s = makeState('gfan', T0);
      const bytes = Buffer.from(s, 'base64url');
      const alt = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_']
        .map((ch) => s.slice(0, -1) + ch)
        .find((v) => v !== s && Buffer.from(v, 'base64url').equals(bytes));
      if (!alt) continue;
      found += 1;
      assert.equal(readState(alt, T0), null, 'ejaan bukan kanonis');
      assert.equal(consumeState(s, T0), true);
      assert.equal(consumeState(alt, T0), false, 'ejaan lain dari state terpakai');
    }
    assert.equal(found, 1, 'contoh ejaan bukan kanonis ditemukan');
  }],

  ['normalizeOrder: detik ke ms, barang digabung per SKU, resi dari line item, CANCEL', () => {
    const raw = {
      id: '576462377512830168', status: 'AWAITING_COLLECTION', commerce_platform: 'TOKOPEDIA',
      create_time: 1764120000, update_time: 1764123600, paid_time: 1764120300, cancel_time: 0,
      payment: { total_amount: '250000', currency: 'IDR' }, payment_method_name: 'BCA Virtual Account', is_cod: false,
      user_id: '7000', recipient_address: { name: 'B***i', phone_number: '(+62)812-***-1234' },
      line_items: [
        { id: '1', product_name: 'Kipas Plafon', sku_name: 'Putih', sku_id: 'S1', seller_sku: 'GFC10', sale_price: '100000', currency: 'IDR' },
        { id: '2', product_name: 'Kipas Plafon', sku_name: 'Putih', sku_id: 'S1', seller_sku: 'GFC10', sale_price: '100000', currency: 'IDR' },
        { id: '3', product_name: 'Remote', sku_id: 'S2', sale_price: '50000', tracking_number: 'JP1234567890', shipping_provider_name: 'J&T Express' },
      ],
      fulfillment_type: 'FULFILLMENT_BY_SELLER', shipping_type: 'TIKTOK',
    };
    const o = normalizeOrder(raw, 'SHOP1', T0);
    assert.deepEqual(
      [o.order_id, o.shop_id, o.platform, o.status, o.create_time, o.update_time, o.paid_time, o.cancel_time],
      ['576462377512830168', 'SHOP1', 'TOKOPEDIA', 'AWAITING_COLLECTION', 1764120000000, 1764123600000, 1764120300000, null]
    );
    assert.deepEqual([o.total_amount, o.currency, o.payment_method, o.is_cod, o.recipient_name, o.recipient_phone],
      ['250000', 'IDR', 'BCA Virtual Account', false, 'B***i', '(+62)812-***-1234']);
    assert.deepEqual(o.items, [
      { name: 'Kipas Plafon Putih', sku: 'GFC10', qty: 2, price: '100000' },
      { name: 'Remote', sku: 'S2', qty: 1, price: '50000' },
    ]);
    assert.deepEqual([o.tracking_number, o.shipping_provider, o.synced_at], ['JP1234567890', 'J&T Express', T0], 'resi dari line item');
    const own = normalizeOrder({ ...raw, tracking_number: 'TKP01-ABCDE', shipping_provider: 'Kurir Rekomendasi' }, 'SHOP1', T0);
    assert.deepEqual([own.tracking_number, own.shipping_provider], ['TKP01-ABCDE', 'Kurir Rekomendasi'], 'resi dari pesanan menang');
    assert.equal(normalizeOrder({ id: '1', status: 'CANCEL' }, 'S', T0).status, 'CANCELLED');
    const bare = normalizeOrder({ id: 9, status: 'UNPAID' }, 'S', T0);
    assert.deepEqual([bare.order_id, bare.items, bare.tracking_number, bare.recipient_name, bare.paid_time], ['9', [], null, null, null]);
  }],

  ['courierFromProvider: nama kurir marketplace ke kode Binderbyte', () => {
    const table: [string | null, string | null][] = [
      ['J&T Express', 'jnt'], ['JNT', 'jnt'], ['JNE Reguler', 'jne'], ['SiCepat REG', 'sicepat'], ['AnterAja', 'anteraja'],
      ['ID Express', 'ide'], ['IDExpress', 'ide'], ['Ninja Xpress', 'ninja'], ['Lion Parcel', 'lion'], ['SPX Express', 'spx'],
      ['Shopee Express', 'spx'], ['POS Indonesia', 'pos'], ['TIKI', 'tiki'], ['SAP Express', 'sap'], ['Wahana', 'wahana'],
      ['GoTo Logistics', 'gtl'], ['GTL', 'gtl'], ['Kurir Rekomendasi', 'kurir_tokopedia'], ['Tokopedia Kurir', 'kurir_tokopedia'],
      ['DHL', null], ['', null], [null, null],
    ];
    for (const [name, code] of table) assert.equal(courierFromProvider(name), code, String(name));
  }],

  ['isPaid dan stageTargets', () => {
    assert.equal(isPaid('UNPAID'), false);
    assert.equal(isPaid('ON_HOLD'), false, 'ditahan: belum dihitung dibayar');
    assert.equal(isPaid('AWAITING_SHIPMENT'), true);
    assert.equal(isPaid('CANCELLED'), false, 'batal tidak pernah dihitung dibayar');
    // Dibayar = ada kenaikan tahap, untuk semua status.
    for (const st of ['UNPAID', 'ON_HOLD', 'AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING', 'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'UNKNOWN']) {
      assert.equal(isPaid(st), stageTargets(st).length > 0, st);
    }
    const to = (s: string) => stageTargets(s).map((t) => t.to);
    assert.deepEqual(to('UNPAID'), []);
    assert.deepEqual(to('ON_HOLD'), []);
    assert.deepEqual(to('CANCELLED'), []);
    assert.deepEqual(to('AWAITING_SHIPMENT'), ['payment']);
    assert.deepEqual(to('PARTIALLY_SHIPPING'), ['payment']);
    assert.deepEqual(to('AWAITING_COLLECTION'), ['payment', 'dikirim']);
    assert.deepEqual(to('IN_TRANSIT'), ['payment', 'dikirim']);
    assert.deepEqual(to('DELIVERED'), ['payment', 'selesai']);
    assert.deepEqual(to('COMPLETED'), ['payment', 'selesai']);
    const [pay, , done] = [...stageTargets('IN_TRANSIT'), ...stageTargets('COMPLETED').slice(1)];
    assert.deepEqual(pay?.from, ['baru', 'menunggu', 'dihubungi', 'link']);
    assert.deepEqual(stageTargets('IN_TRANSIT')[1]?.from, ['baru', 'menunggu', 'dihubungi', 'link', 'payment']);
    assert.deepEqual(done?.from, ['baru', 'menunggu', 'dihubungi', 'link', 'payment', 'dikirim']);
  }],

  ['linkShop: tukar kode, pilih toko Indonesia, simpan token dalam ms', async () => {
    respond = (c) => {
      if (c.url.host === 'auth.tiktok-shops.com') return ok(tokenData(1));
      if (c.url.pathname === '/authorization/202309/shops') {
        return ok({ shops: [
          { id: 'SHOP-MY', name: 'GFAN MY', region: 'MY', seller_type: 'LOCAL', cipher: 'CIPHER-MY', code: 'MY1' },
          { id: 'SHOP-ID', name: 'GFAN Official', region: 'ID', seller_type: 'LOCAL', cipher: 'CIPHER-ID', code: 'ID1' },
        ] });
      }
      throw new Error(c.url.href);
    };
    const link = await linkShop('gfan', 'kode-izin', T0);
    const [tok, shops] = calls;
    assert.equal(calls.length, 2);
    assert.equal(tok!.url.origin + tok!.url.pathname, 'https://auth.tiktok-shops.com/api/v2/token/get');
    assert.deepEqual(q(tok!), { app_key: KEY, app_secret: SECRET, auth_code: 'kode-izin', grant_type: 'authorized_code' });
    assert.equal(shops!.url.origin, 'https://open-api.tiktokglobalshop.com');
    assert.equal(q(shops!).shop_cipher, undefined, 'daftar toko tanpa shop_cipher');
    assertSigned(shops!, 'akses-1');
    assert.deepEqual([link.shop_id, link.shop_cipher, link.shop_name, link.region, link.seller_name, link.status], ['SHOP-ID', 'CIPHER-ID', 'GFAN Official', 'ID', 'Toko GFAN', 'active']);
    assert.equal(link.access_expires_at, Math.floor((T0 + 7 * DAY) / 1000) * 1000, 'detik Unix -> ms');
    assert.equal(link.refresh_expires_at, Math.floor((T0 + 60 * DAY) / 1000) * 1000);
    assert.deepEqual(link.granted_scopes, ['seller.order.info']);
    assert.equal((await getShopLink())?.access_token, 'akses-1');
    assert.equal(await webhookProject('SHOP-ID'), 'gfan');
    assert.equal(await webhookProject('SHOP-LAIN'), null);
    // Kode yang salah: error dari TikTok dilempar dengan kodenya.
    respond = () => bad(36004004, 'invalid auth code');
    await assert.rejects(linkShop('gfan', 'salah', T0), (e: unknown) => e instanceof TiktokError && e.code === 36004004 && /invalid auth code/.test(e.message));

    // Toko yang sama dari proyek lain: ditolak, tautan gfan tetap.
    await ensureProject('toko-b', 'generic', 'Toko B');
    respond = (c) => {
      if (c.url.host === 'auth.tiktok-shops.com') return ok(tokenData(9));
      return ok({ shops: [{ id: 'SHOP-ID', name: 'GFAN Official', region: 'ID', cipher: 'CIPHER-ID' }] });
    };
    await assert.rejects(linkShop('toko-b', 'kode-b', T0), (e: unknown) => e instanceof TiktokError && e.message === 'Toko ini sudah tertaut ke proyek gfan. Putuskan tautannya di sana dulu.');
    assert.equal(await withProject((await loadProject('toko-b'))!, () => getShopLink()), undefined);
    assert.equal(await webhookProject('SHOP-ID'), 'gfan');
    // Menautkan ulang toko yang sama di proyek yang sama boleh.
    assert.equal((await linkShop('gfan', 'kode-ulang', T0)).access_token, 'akses-9');
    // Tautan gfan kedaluwarsa: tidak menghalangi proyek lain, dan baris gfan dibiarkan apa adanya.
    await updateShopLink({ status: 'expired', error: 'refresh token expired', updated_at: T0 + HOUR });
    const b = await linkShop('toko-b', 'kode-b', T0);
    assert.deepEqual([b.project, b.shop_id, b.status], ['toko-b', 'SHOP-ID', 'active']);
    const g = await getShopLink();
    assert.deepEqual([g?.status, g?.error, g?.access_token], ['expired', 'refresh token expired', 'akses-9'], 'tautan gfan tidak disentuh');
    assert.equal(await webhookProject('SHOP-ID'), 'toko-b', 'webhook ke tautan yang aktif, walau tautan lama lebih baru diubah');
  }],

  ['upsertOrderRow: data lama tidak menimpa data baru; batal tidak dihitung dibayar', async () => {
    const base = normalizeOrder(apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'JP2' }), 'SHOP-ID', T0);
    await upsertOrderRow({ ...base, update_time: 200 });
    const old = await upsertOrderRow({ ...base, status: 'AWAITING_SHIPMENT', tracking_number: 'JP1', update_time: 100 });
    assert.deepEqual([old?.status, old?.tracking_number, old?.update_time], ['IN_TRANSIT', 'JP2', 200], 'yang dikembalikan = baris tersimpan');
    assert.deepEqual([(await getOrder(ORDER))?.status, (await getOrder(ORDER))?.tracking_number], ['IN_TRANSIT', 'JP2']);
    const same = await upsertOrderRow({ ...base, status: 'DELIVERED', tracking_number: 'JP3', update_time: 200 });
    assert.deepEqual([same?.status, same?.tracking_number], ['DELIVERED', 'JP3'], 'waktu sama: tetap ditimpa');
    const newer = await upsertOrderRow({ ...base, status: 'COMPLETED', update_time: 300 });
    assert.equal(newer?.status, 'COMPLETED');
    await upsertOrderRow({ ...base, update_time: null });
    assert.equal((await getOrder(ORDER))?.status, 'COMPLETED', 'tanpa waktu ubah: tidak menimpa yang punya waktu');
    // Pesanan batal yang sempat dibayar tidak masuk hitungan "belum tertaut".
    await upsertOrderRow({ ...normalizeOrder(apiOrder('576000000000000003', 'CANCELLED'), 'SHOP-ID', T0) });
    assert.ok((await getOrder('576000000000000003'))!.paid_time! > 0);
    assert.deepEqual(await orderCounts(0), { total: 2, unmatched: 1 });
    // Pesanan ditahan dengan waktu bayar: juga belum dihitung dibayar.
    await upsertOrderRow(normalizeOrder(apiOrder('576000000000000004', 'ON_HOLD'), 'SHOP-ID', T0));
    assert.ok((await getOrder('576000000000000004'))!.paid_time! > 0);
    assert.deepEqual(await orderCounts(0), { total: 3, unmatched: 1 });
    // Pesanan dibayar dari 60 hari lalu: tidak masuk total 30 hari, tapi tetap dihitung belum tertaut.
    const old60 = Math.floor((T0 - 60 * DAY) / 1000);
    await upsertOrderRow(normalizeOrder(apiOrder('576000000000000005', 'AWAITING_SHIPMENT', { create_time: old60, update_time: old60 }), 'SHOP-ID', T0));
    assert.deepEqual(await orderCounts(T0 - 30 * DAY), { total: 3, unmatched: 2 }, 'belum tertaut tanpa batas tanggal');
  }],

  ['apiCall: tanda tangan, header, badan; token kedaluwarsa diperpanjang sekali; rate limit dicoba lagi sekali', async () => {
    const link = await seedLink();
    respond = (c) => {
      assertSigned(c, 'akses-0');
      return ok({ orders: [], next_page_token: '' });
    };
    await apiCall(link, 'POST', '/order/202309/orders/search', { query: { page_size: '50' }, body: { update_time_ge: 5 } });
    assert.equal(calls[0]!.body, '{"update_time_ge":5}', 'badan dikirim persis seperti yang ditandatangani');
    assert.deepEqual([q(calls[0]!).shop_cipher, q(calls[0]!).page_size, calls[0]!.method], ['CIPHER-ID', '50', 'POST']);

    // 105002: perpanjang token, simpan, coba lagi dengan token baru.
    calls = [];
    let n = 0;
    respond = (c) => {
      if (c.url.host === 'auth.tiktok-shops.com') {
        assert.deepEqual(q(c), { app_key: KEY, app_secret: SECRET, refresh_token: 'segar-0', grant_type: 'refresh_token' });
        return ok(tokenData(2));
      }
      n += 1;
      if (n === 1) return bad(105002, 'access token expired');
      assertSigned(c, 'akses-2');
      return ok({ orders: [{ id: '1' }] });
    };
    const data = await apiCall(link, 'GET', '/order/202507/orders', { query: { ids: '1' } });
    assert.deepEqual(data, { orders: [{ id: '1' }] });
    assert.equal(calls.length, 3, 'gagal, perpanjang, coba lagi');
    assert.deepEqual([(await getShopLink())?.access_token, (await getShopLink())?.refresh_token, link.access_token], ['akses-2', 'segar-2', 'akses-2']);
    // Kedaluwarsa lagi sesudah diperpanjang: tidak berputar, error dilempar.
    calls = [];
    respond = (c) => (c.url.host === 'auth.tiktok-shops.com' ? ok(tokenData(3)) : bad(105002, 'access token expired'));
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders', { query: { ids: '1' } }), (e: unknown) => e instanceof TiktokError && e.code === 105002);
    assert.equal(calls.length, 3);

    // HTTP 429: tunggu Retry-After lalu coba lagi sekali.
    calls = [];
    n = 0;
    respond = () => (++n === 1 ? new Response('too many', { status: 429, headers: { 'retry-after': '0' } }) : ok({ orders: [] }));
    assert.deepEqual(await apiCall(link, 'GET', '/order/202507/orders', { query: { ids: '1' } }), { orders: [] });
    assert.equal(calls.length, 2);
    calls = [];
    respond = () => bad(36009002, 'rate limit', 200, { 'retry-after': '0' });
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders'), (e: unknown) => e instanceof TiktokError && e.code === 36009002);
    assert.equal(calls.length, 2, 'rate limit hanya dicoba lagi sekali');
    calls = [];
    respond = () => bad(106001, 'invalid sign');
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders'), /invalid sign \(kode 106001, request req-2\)/);
    assert.equal(calls.length, 1);
    // Status HTTP error dengan kode amplop 0 atau tanpa kode: pesannya status HTTP, bukan "kode 0".
    const httpFail = (re: RegExp) => (e: unknown) => e instanceof TiktokError && re.test(e.message) && !/kode 0/.test(e.message) && e.code === -1;
    respond = () => reply({ code: 0, message: 'Bad Gateway', request_id: 'req-3', data: {} }, 502);
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders'), httpFail(/^Tokopedia & Shop menolak: HTTP 502, Bad Gateway \(request req-3\)$/));
    respond = () => reply({ message: 'internal error' }, 500);
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders'), httpFail(/^Tokopedia & Shop menolak: HTTP 500, internal error$/));
    respond = () => reply({ code: 0, data: {} }, 403);
    await assert.rejects(apiCall(link, 'GET', '/order/202507/orders'), httpFail(/^Tokopedia & Shop menolak: HTTP 403$/));
  }],

  ['fetchOrders: 50 id per panggilan; searchOrders: halaman demi halaman', async () => {
    const link = await seedLink();
    respond = (c) => ok({ orders: (q(c).ids ?? '').split(',').map((id) => ({ id })) });
    const ids = Array.from({ length: 120 }, (_, i) => String(1000 + i));
    const got = await fetchOrders(link, [...ids, '1000']);
    assert.equal(got.length, 120, 'id ganda dibuang');
    assert.deepEqual(calls.map((c) => (q(c).ids ?? '').split(',').length), [50, 50, 20]);
    assert.ok(calls.every((c) => c.url.pathname === '/order/202507/orders' && c.method === 'GET'));

    calls = [];
    const pages: Record<string, unknown> = { '': { orders: [{ id: 'a' }, { id: 'b' }], next_page_token: 't2' }, t2: { orders: [{ id: 'c' }], next_page_token: 't3' }, t3: { orders: [], next_page_token: '' } };
    respond = (c) => {
      assertSigned(c, 'akses-0');
      return ok(pages[q(c).page_token ?? '']);
    };
    const found = await searchOrders(link, T0);
    assert.deepEqual(found.orders.map((o) => o.id), ['a', 'b', 'c']);
    assert.deepEqual([found.truncated, found.pages], [false, 3]);
    assert.deepEqual(calls.map((c) => q(c).page_token ?? ''), ['', 't2', 't3']);
    assert.ok(calls.every((c) => c.method === 'POST' && c.url.pathname === '/order/202309/orders/search' && c.body === `{"update_time_ge":${Math.floor(T0 / 1000)}}`));
    assert.deepEqual([q(calls[0]!).page_size, q(calls[0]!).sort_field, q(calls[0]!).sort_order], ['50', 'update_time', 'ASC']);
  }],

  ['handleWebhook: kiriman ganda, pesanan disimpan dan dicocokkan, resi dan tahap naik saja', async () => {
    await seedLink();
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { order_ref: ORDER, stage: 'link' });
    let status = 'AWAITING_SHIPMENT';
    let extra: Record<string, unknown> = {};
    respond = (c) => {
      assert.equal(q(c).ids, ORDER);
      return ok({ orders: [apiOrder(ORDER, status, extra)] });
    };
    const ev = (id: string, order_status = 'AWAITING_SHIPMENT') => ({
      type: 1, tts_notification_id: id, shop_id: 'SHOP-ID', timestamp: Math.floor(T0 / 1000), data: { order_id: ORDER, order_status, is_on_hold_order: false, update_time: Math.floor(T0 / 1000) },
    });
    assert.equal(await handleWebhook('gfan', ev('n1'), T0), 'pesanan');
    assert.equal((await getOrder(ORDER))?.contact_phone, A, 'dicocokkan lewat nomor pesanan');
    assert.equal((await getContact(A))?.stage, 'payment');
    assert.equal(await handleWebhook('gfan', ev('n1'), T0), 'ganda');
    assert.equal(calls.length, 1, 'kiriman ganda tidak mengambil pesanan lagi');

    status = 'IN_TRANSIT';
    extra = { tracking_number: 'JP1234567890', shipping_provider: 'J&T Express' };
    assert.equal(await handleWebhook('gfan', ev('n2', 'IN_TRANSIT'), T0 + MIN), 'pesanan');
    let c = await getContact(A);
    assert.deepEqual([c?.awb, c?.courier, c?.awb_at, c?.stage], ['JP1234567890', 'jnt', T0 + MIN, 'dikirim']);

    status = 'DELIVERED';
    assert.equal(await handleWebhook('gfan', ev('n3', 'DELIVERED'), T0 + 2 * MIN), 'pesanan');
    c = await getContact(A);
    assert.deepEqual([c?.stage, c?.awb_at], ['selesai', T0 + MIN], 'resi yang sama tidak diisi ulang');

    // Status mundur (data lama): tahap tidak turun.
    status = 'AWAITING_SHIPMENT';
    await handleWebhook('gfan', ev('n4'), T0 + 3 * MIN);
    assert.equal((await getContact(A))?.stage, 'selesai');

    // Resi berganti untuk pesanan yang sama: resi diganti, kurir lama tetap kalau nama kurirnya tidak dikenal.
    status = 'IN_TRANSIT';
    extra = { tracking_number: 'JP9999999999', shipping_provider: 'Kurir Entah' };
    await handleWebhook('gfan', ev('n5', 'IN_TRANSIT'), T0 + 4 * MIN);
    c = await getContact(A);
    assert.deepEqual([c?.awb, c?.courier, c?.stage], ['JP9999999999', 'jnt', 'selesai']);

    // "batal" tidak pernah disentuh; pesanan batal tidak mengubah tahap.
    await updateContact(A, { stage: 'batal' });
    status = 'COMPLETED';
    await handleWebhook('gfan', ev('n6', 'COMPLETED'), T0 + 5 * MIN);
    assert.equal((await getContact(A))?.stage, 'batal');
    await updateContact(A, { stage: 'link' });
    status = 'CANCELLED';
    extra = { cancel_reason: 'Pembeli berubah pikiran' };
    await handleWebhook('gfan', { ...ev('n7', 'CANCEL') }, T0 + 6 * MIN);
    assert.equal((await getContact(A))?.stage, 'link', 'CANCELLED tidak mengubah tahap');
    assert.deepEqual([(await getOrder(ORDER))?.status, (await getOrder(ORDER))?.cancel_reason], ['CANCELLED', 'Pembeli berubah pikiran']);

    // Pesanan tanpa percakapan yang cocok: disimpan, belum tertaut.
    respond = () => ok({ orders: [apiOrder('576000000000000001', 'AWAITING_SHIPMENT')] });
    await handleWebhook('gfan', { ...ev('n8'), data: { order_id: '576000000000000001' } }, T0);
    assert.equal((await getOrder('576000000000000001'))?.contact_phone, null);
    assert.equal((await listOrders(10)).length, 2);
    assert.equal(await handleWebhook('gfan', { type: 99, tts_notification_id: 'n9', data: {} }, T0), 'diabaikan');
  }],

  ['handleWebhook: toko mencabut izin (hapus tautan dan pesanan) dan izin akan berakhir (warning)', async () => {
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] });
    await handleWebhook('gfan', { type: 1, tts_notification_id: 'a1', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0);
    assert.equal((await listOrders(10)).length, 1);
    assert.equal(await handleWebhook('gfan', { type: 7, tts_notification_id: 'a2', shop_id: 'SHOP-ID', data: { message: 'x', expiration_time: String(Math.floor((T0 + 3 * DAY) / 1000)) } }, T0), 'akan-berakhir');
    let alerts = await recentAlerts(10);
    assert.deepEqual([alerts[0]?.kind, alerts[0]?.key], ['marketplace', 'expiring']);
    assert.match(alerts[0]!.text, /berakhir dalam 3 hari/);
    // Pesanan toko lain di proyek yang sama (mis. toko yang dulu ditautkan) tidak ikut dihapus.
    await upsertOrderRow(normalizeOrder(apiOrder('576000000000000777', 'COMPLETED'), 'SHOP-LAIN', T0));
    assert.equal(await handleWebhook('gfan', { type: 6, tts_notification_id: 'a3', shop_id: 'SHOP-ID', data: { message: 'deauthorized' } }, T0), 'diputus');
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), ['576000000000000777'], 'hanya pesanan toko ini yang dihapus');
    alerts = await recentAlerts(10);
    assert.deepEqual([alerts[0]?.kind, alerts[0]?.key], ['marketplace', 'revoked']);
    assert.match(alerts[0]!.text, /GFAN Official memutus tautan/);
  }],

  ['handleWebhook: gagal = belum dicatat, kiriman ulang diproses; berhasil = kiriman ulang dilewati', async () => {
    await seedLink();
    let fail = true;
    respond = () => {
      if (fail) throw new Error('Tokopedia & Shop tidak bisa dihubungi: ECONNRESET');
      return ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] });
    };
    const ev = { type: 1, tts_notification_id: 'r1', shop_id: 'SHOP-ID', data: { order_id: ORDER } };
    await assert.rejects(handleWebhook('gfan', ev, T0), /ECONNRESET/);
    assert.equal(await hasWebhookEvent('r1'), false, 'gagal: id belum dicatat');
    assert.equal(await getOrder(ORDER), undefined);
    fail = false;
    assert.equal(await handleWebhook('gfan', ev, T0 + 2 * MIN), 'pesanan', 'kiriman ulang diproses');
    assert.equal(await hasWebhookEvent('r1'), true);
    assert.equal((await getOrder(ORDER))?.status, 'AWAITING_SHIPMENT');
    calls = [];
    assert.equal(await handleWebhook('gfan', ev, T0 + 30 * MIN), 'ganda');
    assert.equal(calls.length, 0);

    // Dua kiriman yang sama bersamaan: hanya satu yang diproses (juga selagi database diperiksa).
    respond = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT')] });
    calls = [];
    const ev2 = { ...ev, tts_notification_id: 'r2' };
    const both = await Promise.all([handleWebhook('gfan', ev2, T0), handleWebhook('gfan', ev2, T0)]);
    assert.deepEqual(both.sort(), ['ganda', 'pesanan']);
    assert.equal(calls.length, 1, 'satu panggilan ke Tokopedia & Shop');
    assert.equal(await hasWebhookEvent('r2'), true);
    assert.equal(await handleWebhook('gfan', ev2, T0), 'ganda', 'sesudahnya: dari database');

    // Pesanannya belum terbaca dari API: id tidak dicatat, kiriman ulang diproses.
    const ev3 = { type: 1, tts_notification_id: 'r3', shop_id: 'SHOP-ID', data: { order_id: '576000000000000009' } };
    respond = () => ok({ orders: [] });
    assert.equal(await handleWebhook('gfan', ev3, T0), 'menunggu');
    assert.equal(await hasWebhookEvent('r3'), false, 'belum terbaca: id belum dicatat');
    respond = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT')] });
    assert.equal(await handleWebhook('gfan', ev3, T0 + 2 * MIN), 'menunggu', 'jawaban tanpa id yang diminta: tetap menunggu');
    respond = () => ok({ orders: [apiOrder('576000000000000009', 'AWAITING_SHIPMENT')] });
    assert.equal(await handleWebhook('gfan', ev3, T0 + 30 * MIN), 'pesanan', 'kiriman ulang diproses');
    assert.equal(await hasWebhookEvent('r3'), true);
    assert.equal((await getOrder('576000000000000009'))?.status, 'AWAITING_SHIPMENT');
  }],

  ['refreshDueTokens: hanya token yang hampir berakhir; gagal = expired + warning', async () => {
    await seedLink({ access_expires_at: T0 + 3 * DAY });
    assert.equal(await refreshDueTokens(T0), false);
    assert.equal(calls.length, 0, 'masih lama: tidak diperpanjang');
    respond = () => ok(tokenData(5));
    await seedLink({ access_expires_at: T0 + 2 * HOUR });
    assert.equal(await refreshDueTokens(T0), true);
    assert.equal(calls.length, 1);
    assert.deepEqual([(await getShopLink())?.access_token, (await getShopLink())?.status], ['akses-5', 'active']);
    await seedLink({ access_expires_at: T0 + HOUR });
    respond = () => bad(105003, 'refresh token expired');
    assert.equal(await refreshDueTokens(T0), false);
    const link = await getShopLink();
    assert.equal(link?.status, 'expired');
    assert.match(link?.error ?? '', /refresh token expired/);
    const alerts = await recentAlerts(5);
    assert.deepEqual([alerts[0]?.kind, alerts[0]?.key], ['marketplace', 'token']);
    calls = [];
    assert.equal(await refreshDueTokens(T0), false, 'tautan expired tidak dicoba lagi');
    assert.equal(calls.length, 0);
  }],

  ['refreshDueTokens: gangguan sementara tetap active; izin ditolak = expired + warning', async () => {
    const tokenAlerts = async () => (await recentAlerts(20)).filter((a) => a.kind === 'marketplace' && a.key === 'token').length;
    // Jaringan putus: tetap aktif, error dicatat, tanpa warning; putaran berikutnya mencoba lagi.
    await seedLink({ access_expires_at: T0 + HOUR });
    respond = () => {
      throw new Error('Tokopedia & Shop tidak bisa dihubungi: ECONNRESET');
    };
    assert.equal(await refreshDueTokens(T0), false);
    let link = await getShopLink();
    assert.deepEqual([link?.status, /ECONNRESET/.test(link?.error ?? '')], ['active', true]);
    assert.equal(await tokenAlerts(), 0);
    // HTTP 5xx, rate limit, dan jawaban yang tidak bisa dibaca: juga sementara.
    for (const r of [
      () => bad(50001, 'internal error', 503),
      () => new Response('too many', { status: 429 }),
      () => bad(36009002, 'rate limit'),
      () => new Response('<html>bad gateway</html>', { status: 502 }),
    ]) {
      respond = r;
      assert.equal(await refreshDueTokens(T0), false);
      assert.equal((await getShopLink())?.status, 'active');
    }
    assert.equal(await tokenAlerts(), 0);
    // Berhasil pada putaran berikutnya: error dikosongkan.
    respond = () => ok(tokenData(6));
    assert.equal(await refreshDueTokens(T0), true);
    link = await getShopLink();
    assert.deepEqual([link?.status, link?.error, link?.access_token], ['active', null, 'akses-6']);

    // Kode error dari endpoint token (refresh token salah): expired + warning.
    await seedLink({ access_expires_at: T0 + HOUR });
    respond = () => bad(36004004, 'invalid refresh token');
    assert.equal(await refreshDueTokens(T0), false);
    link = await getShopLink();
    assert.deepEqual([link?.status, /invalid refresh token/.test(link?.error ?? '')], ['expired', true]);
    assert.equal(await tokenAlerts(), 1);

    // Masa izin sudah lewat: gangguan apa pun = expired.
    await seedLink({ access_expires_at: T0 + HOUR, refresh_expires_at: T0 - MIN });
    respond = () => {
      throw new Error('timeout');
    };
    assert.equal(await refreshDueTokens(T0), false);
    assert.equal((await getShopLink())?.status, 'expired');
  }],

  ['syncOrders: sejak sinkron terakhir, last_sync_at diisi, error dicatat', async () => {
    await seedLink();
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { order_ref: ORDER });
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT'), apiOrder('576000000000000002', 'UNPAID')], next_page_token: '' });
    assert.deepEqual(await syncOrders('gfan', T0), { synced: 2, error: null });
    assert.equal(calls[0]!.body, `{"update_time_ge":${Math.floor((T0 - 30 * DAY - HOUR) / 1000)}}`, 'sinkron pertama: 30 hari ke belakang');
    assert.equal((await getShopLink())?.last_sync_at, T0);
    assert.equal((await getContact(A))?.stage, 'payment');
    calls = [];
    respond = () => bad(105005, 'missing scope');
    const r = await syncOrders('gfan', T0 + HOUR);
    assert.match(r.error ?? '', /missing scope/);
    assert.equal(calls[0]!.body, `{"update_time_ge":${Math.floor(T0 / 1000) - 3600}}`, 'sejak sinkron terakhir, dikurangi 1 jam');
    assert.deepEqual([(await getShopLink())?.last_sync_at, (await getShopLink())?.error?.includes('missing scope')], [T0, true]);
    respond = () => ok({ orders: [] });
    await syncOrders('gfan', T0 + 2 * HOUR);
    assert.deepEqual([(await getShopLink())?.last_sync_at, (await getShopLink())?.error], [T0 + 2 * HOUR, null], 'berhasil: error dikosongkan');
  }],

  ['syncOrders: terpotong di MAX_PAGES = last_sync_at dari pesanan terbaru yang terbaca, dilanjutkan putaran berikutnya', async () => {
    await seedLink();
    const base = Math.floor(T0 / 1000) - 600;
    // Selalu ada halaman berikutnya; pesanan hanya di dua halaman pertama.
    respond = (c) => {
      const page = Number(q(c).page_token ?? '0');
      return ok({ orders: page < 2 ? [apiOrder(`57600000000010${page}`, 'UNPAID', { update_time: base + page * 60 })] : [], next_page_token: String(page + 1) });
    };
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
    try {
      assert.deepEqual(await syncOrders('gfan', T0), { synced: 2, error: null });
      assert.equal(calls.length, MAX_PAGES);
      assert.equal((await getShopLink())?.last_sync_at, (base + 60) * 1000 - 1, 'waktu ubah terbaru dikurangi 1 ms, bukan sekarang');
      assert.deepEqual(warned, [`[toko] sinkron terpotong di ${MAX_PAGES} halaman, dilanjutkan putaran berikutnya`]);
      // Putaran berikutnya mulai dari situ (dikurangi 1 jam). Tanpa pesanan sama sekali: last_sync_at tidak bergerak.
      calls = [];
      respond = (c) => ok({ orders: [], next_page_token: String(Number(q(c).page_token ?? '0') + 1) });
      await syncOrders('gfan', T0 + HOUR);
      assert.equal(calls[0]!.body, `{"update_time_ge":${Math.floor(((base + 60) * 1000 - 1 - HOUR) / 1000)}}`);
      assert.equal((await getShopLink())?.last_sync_at, (base + 60) * 1000 - 1);
      assert.equal(warned.length, 2);
    } finally {
      console.warn = warn;
    }
  }],

  ['syncOrders: pesanan lama yang belum tertaut dicocokkan ke nomor pesanan yang dicatat belakangan', async () => {
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'JP5550001', shipping_provider: 'JNE' })], next_page_token: '' });
    await syncOrders('gfan', T0);
    assert.equal((await getOrder(ORDER))?.contact_phone, null);
    // Nomor pesanan ditulis langsung (tanpa onOrderRefChanged), misalnya oleh proses lain.
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { order_ref: ORDER, stage: 'dihubungi' });
    // Sinkron berikutnya tidak membawa pesanan itu lagi, tapi tetap mencocokkannya.
    respond = () => ok({ orders: [], next_page_token: '' });
    await syncOrders('gfan', T0 + HOUR);
    assert.equal((await getOrder(ORDER))?.contact_phone, A);
    const c = await getContact(A);
    assert.deepEqual([c?.awb, c?.courier, c?.stage], ['JP5550001', 'jne', 'dikirim']);
  }],

  ['onOrderRefChanged dan linkOrderToContact: tautan dari staf, lalu dilepas', async () => {
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'TKP01-ABCDEF', shipping_provider: 'Kurir Rekomendasi' })], next_page_token: '' });
    await syncOrders('gfan', T0);
    assert.equal((await getOrder(ORDER))?.contact_phone, null);
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    assert.equal(await onOrderRefChanged(A, '576999999999999999', T0), null, 'pesanan yang belum ada');
    await setStageNote(A, { order_ref: ORDER }, T0);
    const row = await onOrderRefChanged(A, ORDER, T0);
    assert.equal(row?.contact_phone, A);
    let c = await getContact(A);
    assert.deepEqual([c?.awb, c?.courier, c?.stage], ['TKP01-ABCDEF', 'kurir_tokopedia', 'dikirim']);

    // Lepas: tautan pesanan dan nomor pesanan di percakapan dikosongkan; sinkron berikutnya tidak menautkannya lagi.
    const off = await linkOrderToContact(ORDER, null, T0);
    assert.equal(off?.contact_phone, null);
    assert.equal((await getContact(A))?.order_ref, null);
    await syncOrders('gfan', T0 + MIN);
    assert.equal((await getOrder(ORDER))?.contact_phone, null);

    // Tautkan manual ke percakapan lain: nomor pesanannya ikut diisi.
    const B = '+6281211110002';
    await createContact(B, `${B.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(B, { order_ref: 'INV/LAMA' });
    const on = await linkOrderToContact(ORDER, B, T0);
    assert.equal(on?.contact_phone, B);
    c = await getContact(B);
    assert.deepEqual([c?.order_ref, c?.awb, c?.stage], [ORDER, 'TKP01-ABCDEF', 'dikirim']);
    assert.equal(await linkOrderToContact('tidak-ada', B, T0), undefined);

    // Nomor pesanan yang sama diisi di percakapan ketiga: percakapan lama melepas nomornya.
    const C = '+6281211110003';
    await createContact(C, `${C.slice(1)}@s.whatsapp.net`, T0);
    await setStageNote(C, { order_ref: ORDER }, T0);
    assert.equal((await onOrderRefChanged(C, ORDER, T0))?.contact_phone, C);
    assert.equal((await getContact(B))?.order_ref, null, 'dua percakapan tidak memegang nomor yang sama');
    assert.equal((await getContact(C))?.order_ref, ORDER);
  }],

  ['nomor pesanan diganti atau dikosongkan: pesanan lama dilepas', async () => {
    await seedLink();
    const ORDER_B = '576462377512830999';
    respond = () => ok({
      orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT', { tracking_number: 'JP1110001', shipping_provider: 'JNE' }), apiOrder(ORDER_B, 'UNPAID')],
      next_page_token: '',
    });
    await syncOrders('gfan', T0);
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await setStageNote(A, { order_ref: ORDER }, T0);
    assert.equal((await onOrderRefChanged(A, ORDER, T0))?.contact_phone, A);

    // Staf mengganti nomor pesanan ke B: A dilepas, B ditautkan.
    await setStageNote(A, { order_ref: ORDER_B }, T0);
    assert.equal((await onOrderRefChanged(A, ORDER_B, T0))?.contact_phone, A);
    assert.equal((await getOrder(ORDER))?.contact_phone, null, 'pesanan lama dilepas');
    assert.equal((await getOrder(ORDER_B))?.contact_phone, A);
    // Sinkron berikutnya tidak menautkan pesanan lama lagi.
    await syncOrders('gfan', T0 + MIN);
    assert.equal((await getOrder(ORDER))?.contact_phone, null);

    // Nomor pesanan ke nomor yang belum ada di toko: semua pesanan lain tetap dilepas.
    assert.equal(await onOrderRefChanged(A, 'INV/BELUM-ADA', T0), null);
    assert.equal((await getOrder(ORDER_B))?.contact_phone, null);

    // Dikosongkan: semua dilepas.
    await linkOrderToContact(ORDER_B, A, T0);
    assert.equal((await getOrder(ORDER_B))?.contact_phone, A);
    await setStageNote(A, { order_ref: null }, T0);
    assert.equal(await onOrderRefChanged(A, null, T0), null);
    assert.deepEqual([(await getOrder(ORDER))?.contact_phone, (await getOrder(ORDER_B))?.contact_phone], [null, null]);

    // Tautan manual ke pesanan lain: pesanan yang tadinya tertaut ke percakapan ini dilepas.
    await linkOrderToContact(ORDER, A, T0);
    await linkOrderToContact(ORDER_B, A, T0);
    assert.deepEqual([(await getOrder(ORDER))?.contact_phone, (await getOrder(ORDER_B))?.contact_phone], [null, A]);
  }],

  ['refreshToken: satu perpanjangan per proyek; token basi memakai token tersimpan', async () => {
    await seedLink({ access_expires_at: T0 + HOUR });
    const g = gate();
    respond = async () => {
      await g.wait;
      return ok(tokenData(5));
    };
    const both = Promise.all([refreshDueTokens(T0), refreshDueTokens(T0)]);
    await untilCalls(1);
    g.open();
    assert.deepEqual(await both, [true, true]);
    assert.equal(calls.length, 1, 'dua pemanggil bersamaan: satu panggilan ke endpoint token');
    assert.equal((await getShopLink())?.access_token, 'akses-5');

    // Pemanggil dengan token basi (sudah diperpanjang di tempat lain): tautan tersimpan, tanpa panggilan jaringan.
    calls = [];
    const stale = { ...(await getShopLink())!, access_token: 'akses-0', refresh_token: 'segar-0' };
    const got = await refreshToken(stale, T0);
    assert.equal(calls.length, 0);
    assert.deepEqual([got.access_token, got.refresh_token, stale.access_token], ['akses-5', 'segar-5', 'akses-5']);
    // Jalur 105002 di apiCall dengan token basi: memakai token tersimpan, lalu mencoba lagi.
    const old = { ...(await getShopLink())!, access_token: 'akses-0', refresh_token: 'segar-0' };
    let n = 0;
    respond = (c) => {
      assert.notEqual(c.url.host, 'auth.tiktok-shops.com', 'tidak ada panggilan ke endpoint token');
      if (++n === 1) return bad(105002, 'access token expired');
      assertSigned(c, 'akses-5');
      return ok({ orders: [] });
    };
    assert.deepEqual(await apiCall(old, 'GET', '/order/202507/orders', { query: { ids: '1' } }), { orders: [] });
    assert.equal(calls.length, 2);

    // Endpoint token menolak, padahal refresh token tersimpan sudah lain: gangguan sementara, tetap active, tanpa warning.
    await seedLink({ access_expires_at: T0 + HOUR });
    respond = async () => {
      await updateShopLink({ access_token: 'akses-lain', refresh_token: 'segar-lain', access_expires_at: T0 + 7 * DAY });
      return bad(36004004, 'invalid refresh token');
    };
    assert.equal(await refreshDueTokens(T0), false);
    const link = await getShopLink();
    assert.deepEqual([link?.status, link?.access_token], ['active', 'akses-lain']);
    assert.match(link?.error ?? '', /diperpanjang di tempat lain/);
    assert.equal((await recentAlerts(10)).filter((a) => a.key === 'token').length, 0);
  }],

  ['webhook gagal disimpan, putaran mencoba lagi: pencabutan izin sampai berhasil', async () => {
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'COMPLETED'), 'SHOP-ID', T0));
    const ev = { type: 6, tts_notification_id: 'd1', shop_id: 'SHOP-ID', data: { message: 'deauthorized' } };
    // Menghapus pesanan gagal sekali (tabelnya sementara tidak ada).
    await db().execute(sql.raw('ALTER TABLE orders RENAME TO orders_rusak'));
    try {
      await assert.rejects(handleWebhook('gfan', ev, T0));
    } finally {
      await db().execute(sql.raw('ALTER TABLE orders_rusak RENAME TO orders'));
    }
    assert.equal((await getShopLink())?.status, 'active', 'gagal: token masih ada');
    assert.equal((await listOrders(10)).length, 1);
    assert.equal(await hasWebhookEvent('d1'), false, 'belum selesai');
    // Pencabutan izin dicoba terus, juga sesudah lebih dari MAX_WEBHOOK_TRIES percobaan.
    await db().execute(sql.raw(`UPDATE webhook_events SET tries = ${MAX_WEBHOOK_TRIES + 5} WHERE id = 'd1'`));
    assert.equal(await shopRound(T0 + 15 * MIN), 1);
    assert.equal(await getShopLink(), undefined, 'token dihapus');
    assert.equal((await listOrders(10)).length, 0, 'pesanan dihapus');
    assert.equal(await hasWebhookEvent('d1'), true);
    assert.equal((await recentAlerts(5))[0]?.key, 'revoked');
    assert.equal(calls.length, 0, 'tanpa tautan: tidak ada sinkron');
    // Sudah selesai: putaran berikutnya tidak mengulanginya.
    assert.equal(await shopRound(T0 + 30 * MIN), 0);
  }],

  ['webhook menunggu (pesanan belum terbaca) dicoba lagi oleh putaran; webhook lain menyerah sesudah 10 kali', async () => {
    await seedLink();
    const ev = { type: 1, tts_notification_id: 'w1', shop_id: 'SHOP-ID', data: { order_id: ORDER } };
    respond = () => ok({ orders: [] });
    assert.equal(await handleWebhook('gfan', ev, T0), 'menunggu');
    assert.equal(await hasWebhookEvent('w1'), false);
    calls = [];
    respond = (c) => (c.url.pathname === '/order/202507/orders' ? ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] }) : ok({ orders: [], next_page_token: '' }));
    assert.equal(await shopRound(T0 + 15 * MIN), 1);
    assert.deepEqual(calls.map((c) => c.url.pathname), ['/order/202507/orders', '/order/202309/orders/search'], 'coba lagi dulu, lalu sinkron');
    assert.equal(await hasWebhookEvent('w1'), true);
    assert.equal((await getOrder(ORDER))?.status, 'AWAITING_SHIPMENT');

    // Selalu gagal: dicoba sampai 10 kali, lalu menyerah dengan log.
    const ev2 = { type: 1, tts_notification_id: 'w2', shop_id: 'SHOP-ID', data: { order_id: '576000000000000042' } };
    respond = () => {
      throw new Error('Tokopedia & Shop tidak bisa dihubungi: ECONNRESET');
    };
    const errs: string[] = [];
    const error = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      calls = [];
      await assert.rejects(handleWebhook('gfan', ev2, T0), /ECONNRESET/);
      for (let i = 1; i < MAX_WEBHOOK_TRIES; i += 1) assert.equal(await retryWebhooks('gfan', T0 + i * 15 * MIN), 0);
      assert.equal(calls.length, MAX_WEBHOOK_TRIES);
      assert.ok(errs.some((e) => e.includes(`webhook w2 (jenis 1) menyerah sesudah ${MAX_WEBHOOK_TRIES} percobaan`)), errs.join('\n'));
      calls = [];
      await retryWebhooks('gfan', T0 + DAY);
      assert.equal(calls.length, 0, 'sesudah menyerah: tidak dicoba lagi');
    } finally {
      console.error = error;
    }
    assert.equal(await hasWebhookEvent('w2'), false);
  }],

  ['webhook tanpa tts_notification_id: id dari isinya; tautan tidak aktif: tanpa panggilan API', async () => {
    const ev = { type: 1, shop_id: 'SHOP-ID', timestamp: 1718305585, data: { order_id: ORDER, order_status: 'IN_TRANSIT' } };
    const id = webhookId(ev);
    assert.match(id, /^sha256:[0-9a-f]{64}$/);
    assert.equal(webhookId({ ...ev }), id, 'isi sama = id sama');
    assert.notEqual(webhookId({ ...ev, data: { ...ev.data, order_status: 'DELIVERED' } }), id);
    assert.notEqual(webhookId({ ...ev, timestamp: 1718305586 }), id);
    assert.equal(webhookId({ ...ev, tts_notification_id: 'n-1' }), 'n-1');
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT')] });
    assert.equal(await handleWebhook('gfan', ev, T0), 'pesanan');
    assert.equal(await handleWebhook('gfan', ev, T0 + 2 * MIN), 'ganda', 'kiriman ulang tanpa id: tetap dikenali, tidak bergantung jam');
    assert.equal(calls.length, 1);

    // Tautan kedaluwarsa: jenis 1 dicatat tanpa panggilan API; jenis 7 tetap diproses.
    await updateShopLink({ status: 'expired' });
    calls = [];
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'x1', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.equal(calls.length, 0);
    assert.equal(await hasWebhookEvent('x1'), true, 'tetap dicatat');
    assert.equal(await handleWebhook('gfan', { type: 7, tts_notification_id: 'x2', shop_id: 'SHOP-ID', data: { expiration_time: String(Math.floor((T0 + 2 * DAY) / 1000)) } }, T0), 'akan-berakhir');
  }],

  ['syncOrders: satu sinkron per proyek; tautan putus selagi sinkron = pesanan tidak disimpan', async () => {
    await seedLink();
    const g = gate();
    respond = async () => {
      await g.wait;
      return ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')], next_page_token: '' });
    };
    const first = syncOrders('gfan', T0);
    assert.equal(syncRunning('gfan'), true);
    assert.deepEqual(await syncOrders('gfan', T0), { synced: 0, error: null, skipped: true }, 'pemanggil kedua dilewati');
    await untilCalls(1);
    g.open();
    assert.deepEqual(await first, { synced: 1, error: null });
    assert.equal(syncRunning('gfan'), false);
    assert.equal(calls.length, 1);

    // Toko mencabut izin selagi pesanan diambil: pesanan dari sinkron itu tidak disimpan.
    calls = [];
    await updateShopLink({ last_sync_at: null });
    respond = async (c) => {
      if (c.url.pathname === '/order/202309/orders/search') {
        await handleWebhook('gfan', { type: 6, tts_notification_id: 'z6', shop_id: 'SHOP-ID', data: {} }, T0);
      }
      return ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT'), apiOrder('576000000000000050', 'AWAITING_SHIPMENT')], next_page_token: '' });
    };
    assert.deepEqual(await syncOrders('gfan', T0 + HOUR), { synced: 0, error: null });
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual(await listOrders(10), [], 'pesanan yang sudah ada dihapus, yang baru diambil tidak disimpan');

    // Pemutusan manual selagi sinkron: pesanan baru tidak disimpan, pesanan lama tetap (pemutusan manual menyimpannya).
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder('576000000000000060', 'COMPLETED'), 'SHOP-ID', T0));
    respond = async () => {
      await unlinkShop('gfan');
      return ok({ orders: [apiOrder('576000000000000061', 'AWAITING_SHIPMENT')], next_page_token: '' });
    };
    assert.deepEqual(await syncOrders('gfan', T0 + 2 * HOUR), { synced: 0, error: null });
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), ['576000000000000060']);
  }],

  ['handleWebhook jenis 1: izin dicabut atau tautan diputus selagi pesanan diambil = tidak disimpan', async () => {
    await seedLink();
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { order_ref: ORDER, stage: 'link' });
    const shipped = () => ok({ orders: [apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'JP1234567890', shipping_provider: 'J&T Express' })] });
    // Pencabutan izin (jenis 6) masuk selagi detail pesanan diambil.
    respond = async (c) => {
      if (c.url.pathname === '/order/202507/orders') await handleWebhook('gfan', { type: 6, tts_notification_id: 'r6', shop_id: 'SHOP-ID', data: {} }, T0);
      return shipped();
    };
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'r1', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual(await listOrders(10), [], 'pesanan dari jawaban sesudah pencabutan tidak disimpan');
    let c = await getContact(A);
    assert.ok(!c?.awb, 'resi tidak diisi');
    assert.equal(c?.stage, 'link', 'tahap tidak naik');
    assert.equal(await hasWebhookEvent('r1'), true, 'dicatat selesai, tidak dicoba lagi');

    // Diputus dari dashboard selagi detail pesanan diambil: sama.
    await seedLink();
    respond = async () => {
      await unlinkShop('gfan', T0);
      return shipped();
    };
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'r2', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.deepEqual(await listOrders(10), []);
    c = await getContact(A);
    assert.deepEqual([Boolean(c?.awb), c?.stage], [false, 'link']);

    // Baris pesanan sudah hilang saat dicocokkan: matchOrder mengembalikan null, tidak melempar, percakapan tidak diubah.
    const ghost = { ...normalizeOrder(apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'JP1234567890' }), 'SHOP-ID', T0), project: 'gfan', contact_phone: null };
    assert.equal(await matchOrder(ghost, T0), null);
    c = await getContact(A);
    assert.deepEqual([Boolean(c?.awb), c?.stage], [false, 'link']);
  }],

  ['unlinkShop: baris tetap ada (unlinked, tanpa token); pencabutan izin sesudahnya menghapus pesanan; tautkan lagi menimpa', async () => {
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'COMPLETED'), 'SHOP-ID', T0));
    await unlinkShop('gfan', T0 + MIN);
    const cut = await getShopLink();
    assert.deepEqual(
      [cut?.status, cut?.access_token, cut?.refresh_token, cut?.shop_cipher, cut?.error, cut?.shop_id, cut?.updated_at],
      ['unlinked', '', '', '', null, 'SHOP-ID', T0 + MIN]
    );
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), [ORDER], 'pesanan tetap disimpan');
    assert.equal(await webhookProject('SHOP-ID'), 'gfan', 'webhook toko ini tetap sampai ke proyek ini');

    // Jenis 1 dan 7: diabaikan, tanpa panggilan API dan tanpa warning.
    respond = () => ok({ orders: [apiOrder(ORDER, 'DELIVERED')] });
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'u1', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.equal(await handleWebhook('gfan', { type: 7, tts_notification_id: 'u2', shop_id: 'SHOP-ID', data: { expiration_time: String(Math.floor((T0 + 2 * DAY) / 1000)) } }, T0), 'diabaikan');
    assert.equal(calls.length, 0);
    assert.deepEqual(await recentAlerts(10), []);
    assert.equal((await getOrder(ORDER))?.status, 'COMPLETED');
    // Perpanjangan token, sinkron, dan putaran berkala tidak menyentuhnya.
    assert.equal(await refreshDueTokens(T0 + 30 * DAY), false);
    assert.equal((await syncOrders('gfan', T0)).error, 'Toko belum ditautkan.');
    assert.equal(await shopRound(T0), 0);
    assert.equal(calls.length, 0);

    // Jenis 6: pesanan yang disimpan dan barisnya dihapus.
    assert.equal(await handleWebhook('gfan', { type: 6, tts_notification_id: 'u3', shop_id: 'SHOP-ID', data: { message: 'deauthorized' } }, T0), 'diputus');
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual(await listOrders(10), []);
    assert.equal((await recentAlerts(10))[0]?.key, 'revoked');

    // Tautkan lagi sesudah diputus: baris unlinked ditimpa.
    await seedLink();
    await unlinkShop('gfan', T0);
    respond = (c) =>
      c.url.host === 'auth.tiktok-shops.com' ? ok(tokenData(3)) : ok({ shops: [{ id: 'SHOP-ID', name: 'GFAN Official', region: 'ID', cipher: 'CIPHER-ID' }] });
    const again = await linkShop('gfan', 'kode-lagi', T0 + HOUR);
    assert.deepEqual([again.status, again.access_token, again.refresh_token, again.shop_cipher], ['active', 'akses-3', 'segar-3', 'CIPHER-ID']);
    assert.equal((await getShopLink())?.status, 'active');
  }],

  ['orderForContact: pesanan pembeli lain tidak tampil lewat nomor pesanan', async () => {
    const B = '+6281211110002';
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await createContact(B, `${B.slice(1)}@s.whatsapp.net`, T0);
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'AWAITING_SHIPMENT'), 'SHOP-ID', T0));
    assert.equal((await orderForContact(A, ORDER))?.order_id, ORDER, 'belum tertaut: tampil lewat nomor pesanan');
    await setOrderContact(ORDER, B);
    assert.equal(await orderForContact(A, ORDER), undefined, 'tertaut ke percakapan lain: tidak tampil');
    assert.equal((await orderForContact(B, null))?.order_id, ORDER);
    await setOrderContact(ORDER, A);
    assert.equal((await orderForContact(A, ORDER))?.order_id, ORDER);
    assert.equal((await orderForContact(A, null))?.order_id, ORDER);
  }],

  ['shopRound: semua toko aktif, satu gagal tidak menghentikan yang lain, mati tanpa app key', async () => {
    await seedLink({ access_expires_at: T0 + HOUR });
    await ensureProject('toko-b', 'generic', 'Toko B');
    await withProject((await loadProject('toko-b'))!, () => seedLink({ shop_id: 'SHOP-B', shop_cipher: 'CIPHER-B' }));
    await ensureProject('toko-c', 'generic', 'Toko C');
    await withProject((await loadProject('toko-c'))!, () => seedLink({ shop_id: 'SHOP-C', shop_cipher: 'CIPHER-C', status: 'expired' }));
    respond = (c) => {
      if (c.url.host === 'auth.tiktok-shops.com') return ok(tokenData(7));
      if (q(c).shop_cipher === 'CIPHER-B') return bad(106001, 'invalid sign');
      return ok({ orders: [apiOrder(ORDER, 'UNPAID')], next_page_token: '' });
    };
    cfg.tiktokAppKey = '';
    assert.equal(await shopRound(T0), 0, 'tanpa app key: tidak ada putaran');
    assert.equal(calls.length, 0);
    cfg.tiktokAppKey = KEY;
    assert.equal(await shopRound(T0), 2, 'gfan dan toko-b; toko-c tidak aktif');
    assert.deepEqual(calls.map((c) => q(c).shop_cipher ?? 'token'), ['token', 'CIPHER-ID', 'CIPHER-B'], 'gfan: token diperpanjang dulu, lalu sinkron');
    assert.equal((await getShopLink())?.last_sync_at, T0);
    assert.equal((await getOrder(ORDER))?.status, 'UNPAID');
    const b = await withProject((await loadProject('toko-b'))!, () => getShopLink());
    assert.deepEqual([b?.last_sync_at, b?.error?.includes('invalid sign')], [null, true]);
  }],
  ['pencabutan izin basi (lebih tua dari tautan sekarang) atau untuk toko lain: tidak menghapus apa pun', async () => {
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'COMPLETED'), 'SHOP-ID', T0));
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      // Pencabutan gagal sekali (tabel pesanan sementara tidak ada), jadi menunggu dicoba lagi.
      const ev = { type: 6, tts_notification_id: 's6', shop_id: 'SHOP-ID', timestamp: Math.floor(T0 / 1000) + 60, data: {} };
      await db().execute(sql.raw('ALTER TABLE orders RENAME TO orders_rusak'));
      try {
        await assert.rejects(handleWebhook('gfan', ev, T0 + MIN));
      } finally {
        await db().execute(sql.raw('ALTER TABLE orders_rusak RENAME TO orders'));
      }
      // Pemilik menautkan toko itu lagi sesudah pencabutan itu: tautan baru lebih muda dari webhook-nya.
      await seedLink({ linked_at: T0 + HOUR, access_token: 'akses-baru' });
      assert.equal(await retryWebhooks('gfan', T0 + 2 * HOUR), 1);
      assert.equal(await hasWebhookEvent('s6'), true, 'selesai, tidak dicoba lagi');
      assert.equal((await getShopLink())?.access_token, 'akses-baru', 'tautan baru tetap');
      assert.deepEqual((await listOrders(10)).map((o) => o.order_id), [ORDER], 'pesanan tetap');
      assert.ok(logs.some((l) => l.includes('pencabutan izin untuk toko SHOP-ID tidak cocok dengan tautan sekarang, diabaikan')), logs.join('\n'));

      // Pencabutan untuk toko lain: diabaikan.
      const other = { type: 6, tts_notification_id: 's7', shop_id: 'SHOP-LAIN', timestamp: Math.floor((T0 + 3 * HOUR) / 1000), data: {} };
      assert.equal(await handleWebhook('gfan', other, T0 + 3 * HOUR), 'diabaikan');
      assert.equal((await getShopLink())?.status, 'active');
      assert.equal((await listOrders(10)).length, 1);
      assert.deepEqual(await recentAlerts(10), [], 'tanpa warning');

      // Pencabutan sesudah tautan sekarang (detik yang sama pun): berlaku.
      await updateShopLink({ linked_at: T0 + 3 * HOUR + 500 });
      const now6 = { type: 6, tts_notification_id: 's8', shop_id: 'SHOP-ID', timestamp: Math.floor((T0 + 3 * HOUR) / 1000), data: {} };
      assert.equal(await handleWebhook('gfan', now6, T0 + 3 * HOUR + 900), 'diputus');
      assert.equal(await getShopLink(), undefined);
      assert.deepEqual(await listOrders(10), []);
    } finally {
      console.log = log;
    }
  }],

  ['linkShop: mengganti toko menghapus pesanan toko lama; toko yang sama menyimpannya', async () => {
    await seedLink({ shop_id: 'SHOP-LAMA', shop_cipher: 'CIPHER-LAMA', status: 'expired' });
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'COMPLETED'), 'SHOP-LAMA', T0));
    await upsertOrderRow(normalizeOrder(apiOrder('576000000000000070', 'COMPLETED'), 'SHOP-ID', T0));
    respond = (c) =>
      c.url.host === 'auth.tiktok-shops.com' ? ok(tokenData(4)) : ok({ shops: [{ id: 'SHOP-ID', name: 'GFAN Official', region: 'ID', cipher: 'CIPHER-ID' }] });
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(' '));
    try {
      const link = await linkShop('gfan', 'kode-ganti', T0 + HOUR);
      assert.deepEqual([link.shop_id, link.status], ['SHOP-ID', 'active']);
    } finally {
      console.log = log;
    }
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), ['576000000000000070'], 'pesanan toko lama dihapus');
    assert.ok(logs.some((l) => l.includes('[toko] gfan: toko SHOP-LAMA diganti SHOP-ID, 1 pesanan toko lama dihapus')), logs.join('\n'));
    // Menautkan toko yang sama lagi: pesanannya tetap.
    await linkShop('gfan', 'kode-sama', T0 + 2 * HOUR);
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), ['576000000000000070']);
  }],

  ['izin dicabut selagi pesanan disimpan: webhook jenis 1 dan sinkron menghapusnya lagi; diputus manual menyimpannya', async () => {
    await seedLink();
    // Pencabutan izin menghapus pesanan, lalu simpanan yang masih berjalan menulis pesanan itu lagi.
    const revoke = (id: string) => async () => {
      assert.equal(await handleWebhook('gfan', { type: 6, tts_notification_id: id, shop_id: 'SHOP-ID', data: {} }, T0), 'diputus');
      assert.deepEqual(await listOrders(10), []);
      await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'AWAITING_SHIPMENT'), 'SHOP-ID', T0));
    };
    // Webhook jenis 1: pencabutan izin masuk sesudah pesanan disimpan, sebelum pemeriksaan.
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] });
    setAfterSaveHook(async () => {
      assert.ok(await getOrder(ORDER), 'pesanan sudah disimpan');
      await revoke('p6')();
    });
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'p1', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual(await listOrders(10), [], 'pesanan yang baru disimpan dihapus lagi');
    assert.equal(await hasWebhookEvent('p1'), true);

    // Sinkron: sama.
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT'), apiOrder('576000000000000080', 'UNPAID')], next_page_token: '' });
    setAfterSaveHook(revoke('p7'));
    assert.deepEqual(await syncOrders('gfan', T0), { synced: 0, error: null });
    assert.deepEqual(await listOrders(10), []);

    // Proyek ini ditautkan ke toko lain selagi pesanan disimpan: pesanan toko lama itu dihapus.
    await seedLink();
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] });
    setAfterSaveHook(async () => void (await seedLink({ shop_id: 'SHOP-BARU', shop_cipher: 'CIPHER-BARU' })));
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'p2', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'diabaikan');
    assert.deepEqual(await listOrders(10), []);

    // Diputus dari dashboard selagi pesanan disimpan: pesanan tetap (pemutusan manual menyimpannya).
    await seedLink();
    setAfterSaveHook(async () => unlinkShop('gfan', T0));
    assert.equal(await handleWebhook('gfan', { type: 1, tts_notification_id: 'p3', shop_id: 'SHOP-ID', data: { order_id: ORDER } }, T0), 'pesanan');
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), [ORDER]);
  }],

  ['linkOrderToContact dan onOrderRefChanged: pesanan hilang di tengah jalan = kosong, tanpa error', async () => {
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { stage: 'link' });
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'IN_TRANSIT', { tracking_number: 'JP1234567890' }), 'SHOP-ID', T0));
    // Pemicu database: ubahan baris pesanan tidak mengenai apa pun, seperti baris yang dihapus sementara itu.
    await db().execute(sql.raw('CREATE FUNCTION uji_lewati() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$'));
    await db().execute(sql.raw('CREATE TRIGGER uji_lewati BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION uji_lewati()'));
    try {
      assert.equal(await linkOrderToContact(ORDER, A, T0), undefined);
      assert.equal(await onOrderRefChanged(A, ORDER, T0), null);
    } finally {
      await db().execute(sql.raw('DROP TRIGGER uji_lewati ON orders'));
      await db().execute(sql.raw('DROP FUNCTION uji_lewati()'));
    }
    const c = await getContact(A);
    assert.deepEqual([c?.order_ref ?? null, Boolean(c?.awb), c?.stage], [null, false, 'link'], 'percakapan tidak diubah');
  }],

  ['pencabutan izin menghapus pesanan dan tautan toko ini di semua proyek; warning hanya di proyek tujuan', async () => {
    // Proyek toko-b: toko yang sama, diputus dari dashboard (baris dan pesanan tetap ada), plus pesanan toko lain.
    await ensureProject('toko-b', 'generic', 'Toko B');
    const b = (await loadProject('toko-b'))!;
    await withProject(b, async () => {
      await seedLink({ linked_at: T0 - DAY });
      await upsertOrderRow(normalizeOrder(apiOrder('576000000000000101', 'COMPLETED'), 'SHOP-ID', T0));
      await upsertOrderRow(normalizeOrder(apiOrder('576000000000000102', 'COMPLETED'), 'SHOP-LAIN', T0));
    });
    await unlinkShop('toko-b', T0);
    // Proyek gfan: toko yang sama, aktif sekarang.
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'IN_TRANSIT'), 'SHOP-ID', T0));
    assert.equal(await webhookProject('SHOP-ID'), 'gfan', 'tautan aktif menerima webhook');

    const ev = { type: 6, tts_notification_id: 'e6', shop_id: 'SHOP-ID', timestamp: Math.floor(T0 / 1000) + 60, data: { message: 'deauthorized' } };
    assert.equal(await handleWebhook('gfan', ev, T0 + MIN), 'diputus');
    assert.equal(await getShopLink(), undefined, 'tautan gfan dihapus');
    assert.deepEqual(await listOrders(10), [], 'pesanan gfan dihapus');
    const left = await withProject(b, async () => ({ link: await getShopLink(), orders: (await listOrders(10)).map((o) => o.order_id), alerts: await recentAlerts(10) }));
    assert.equal(left.link, undefined, 'tautan toko-b (unlinked) ikut dihapus');
    assert.deepEqual(left.orders, ['576000000000000102'], 'pesanan toko ini di toko-b dihapus, toko lain tetap');
    assert.deepEqual(left.alerts, [], 'tanpa warning di toko-b');
    const alerts = await recentAlerts(10);
    assert.deepEqual([alerts[0]?.kind, alerts[0]?.key], ['marketplace', 'revoked']);
    assert.match(alerts[0]!.text, / 2 pesanan toko ini dihapus/);
    assert.equal(await webhookProject('SHOP-ID'), null, 'toko tidak dikenal lagi');
  }],

  ['webhook disimpan menunggu sebelum diproses; proses berhenti = putaran berkala memprosesnya', async () => {
    await seedLink();
    const ev = { type: 1, tts_notification_id: 'm1', shop_id: 'SHOP-ID', timestamp: Math.floor(T0 / 1000), data: { order_id: ORDER } };
    assert.deepEqual(await receiveWebhook('gfan', ev, T0), { id: 'm1', state: 'baru' });
    const row = await getWebhookEvent('m1');
    assert.deepEqual([row?.at, row?.tries, row?.pending], [T0, 0, ev], 'tersimpan menunggu, 0 percobaan');
    assert.deepEqual((await receiveWebhook('gfan', ev, T0 + MIN)).state, 'menunggu', 'kiriman kedua: tidak diproses dua kali');
    assert.equal(calls.length, 0);
    // Proses dashboard berhenti sebelum memprosesnya; putaran berikutnya (sesudah dimulai ulang) memprosesnya.
    respond = () => ok({ orders: [apiOrder(ORDER, 'AWAITING_SHIPMENT')] });
    assert.equal(await retryWebhooks('gfan', T0 + 15 * MIN), 1);
    assert.equal((await getOrder(ORDER))?.status, 'AWAITING_SHIPMENT');
    assert.deepEqual([await hasWebhookEvent('m1'), (await getWebhookEvent('m1'))?.at], [true, T0], 'selesai; waktu masuk pertama tetap');
    assert.deepEqual((await receiveWebhook('gfan', ev, T0 + HOUR)).state, 'selesai', 'kiriman ulang sesudah selesai: dilewati');
    assert.equal(calls.length, 1);
  }],

  ['resi hanya dari pesanan yang sudah dibayar: batal, belum bayar, dan ditahan tidak mengisi resi', async () => {
    await seedLink();
    await createContact(A, `${A.slice(1)}@s.whatsapp.net`, T0);
    await updateContact(A, { order_ref: ORDER, stage: 'link' });
    const ship = { tracking_number: 'JNE000111', shipping_provider: 'JNE Reguler' };
    let step = 0;
    for (const status of ['UNPAID', 'ON_HOLD', 'CANCELLED']) {
      step += 1;
      const row = await upsertOrderRow(normalizeOrder(apiOrder(ORDER, status, { ...ship, update_time: Math.floor(T0 / 1000) + step }), 'SHOP-ID', T0));
      await matchOrder(row!, T0 + step * MIN);
      const c = await getContact(A);
      assert.deepEqual([c?.awb ?? null, c?.courier ?? null, c?.stage], [null, null, 'link'], `${status}: resi tidak diisi`);
    }
    const paid = await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'AWAITING_COLLECTION', { ...ship, update_time: Math.floor(T0 / 1000) + 10 }), 'SHOP-ID', T0));
    await matchOrder(paid!, T0 + 10 * MIN);
    let c = await getContact(A);
    assert.deepEqual([c?.awb, c?.courier, c?.stage], ['JNE000111', 'jne', 'dikirim'], 'dibayar: resi diisi');
    // Pesanan yang sama lalu batal dengan resi lain: resi percakapan tidak diganti.
    const cancelled = await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'CANCELLED', { tracking_number: 'JNE999', shipping_provider: 'JNE', update_time: Math.floor(T0 / 1000) + 20 }), 'SHOP-ID', T0));
    await matchOrder(cancelled!, T0 + 20 * MIN);
    c = await getContact(A);
    assert.deepEqual([c?.awb, c?.stage], ['JNE000111', 'dikirim']);
  }],

  ['pencabutan izin tanpa timestamp: waktunya = saat pertama masuk; masuk sebelum ditautkan lagi = tidak menghapus apa pun', async () => {
    await seedLink();
    await upsertOrderRow(normalizeOrder(apiOrder(ORDER, 'COMPLETED'), 'SHOP-ID', T0));
    const old6 = { type: 6, tts_notification_id: 't6', shop_id: 'SHOP-ID', data: { message: 'deauthorized' } };
    // Masuk dan tersimpan, tapi proses berhenti sebelum memprosesnya.
    assert.equal((await receiveWebhook('gfan', old6, T0 + MIN)).state, 'baru');
    // Pemilik menautkan toko itu lagi; sesudah itu putaran mencoba webhook lama itu.
    await seedLink({ linked_at: T0 + HOUR, access_token: 'akses-baru' });
    assert.equal(await retryWebhooks('gfan', T0 + 2 * HOUR), 1);
    assert.equal(await hasWebhookEvent('t6'), true, 'selesai, tidak dicoba lagi');
    assert.equal((await getShopLink())?.access_token, 'akses-baru', 'tautan baru tetap');
    assert.deepEqual((await listOrders(10)).map((o) => o.order_id), [ORDER], 'pesanan tetap');
    assert.deepEqual(await recentAlerts(10), [], 'tanpa warning');
    // Tanpa timestamp dan masuk sesudah tautan sekarang: berlaku.
    const new6 = { type: 6, tts_notification_id: 't7', shop_id: 'SHOP-ID', data: { message: 'deauthorized' } };
    assert.equal(await handleWebhook('gfan', new6, T0 + 3 * HOUR), 'diputus');
    assert.equal(await getShopLink(), undefined);
    assert.deepEqual(await listOrders(10), []);
  }],
];

(async () => {
  await openDb('memory://');
  cfg.adminPassword = 'kata-sandi-uji-123';
  let failed = 0;
  for (const [name, fn] of tests) {
    await clearDb();
    await ensureProject('gfan', 'gfan', 'GFAN Indonesia');
    setDefaultProject((await loadProject('gfan'))!);
    cfg.tiktokAppKey = KEY;
    cfg.tiktokAppSecret = SECRET;
    cfg.tiktokServiceId = 'svc-1';
    calls = [];
    respond = (c) => {
      throw new Error(`panggilan tak terduga: ${c.method} ${c.url.pathname}`);
    };
    setTiktokFetch(fake);
    setAfterSaveHook(null);
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.message.split('\n').join('\n    ') : e}`);
    }
  }
  setTiktokFetch(null);
  setAfterSaveHook(null);
  console.log(`\ntoko: ${tests.length - failed}/${tests.length} lulus`);
  process.exit(failed ? 1 : 0);
})();
