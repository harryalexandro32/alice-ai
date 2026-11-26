// Dashboard pemilik. Semua teks dari server dipasang lewat textContent, tidak
// pernah innerHTML: data produk dan nama pelanggan diketik orang.
//
// Tiap menu punya alamatnya sendiri dengan id proyek di depan (/gfan,
// /gfan/conversations, /gfan/knowledge/products, …). Server melayani page.html
// yang sama untuk semuanya; router di bawah membaca location.pathname, dan
// pindah menu memakai History API (pushState) tanpa memuat ulang halaman.
// Semua tautan menu adalah <a href> sungguhan, jadi klik tengah / tab baru jalan.
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

// ---------- ikon ----------
// Ikon dari sprite SVG di page.html (<symbol id="i-…">). Nama ikon selalu ditulis
// di kode ini, tidak pernah dari pengguna, jadi aman diurai sebagai HTML.
const icon = (name) => '<svg class="i" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
/** Ikon sebagai simpul DOM, untuk dipasang lewat el(…) atau append. */
function ico(name) {
  const t = document.createElement('template');
  t.innerHTML = icon(name);
  return t.content.firstChild;
}
/**
 * Panah di depan tiap judul lipatan (details > summary): ikon chevron-right, diputar CSS saat terbuka.
 * Dipanggil saat halaman dimuat dan setiap kali ada lipatan baru (mis. kelompok data teknis).
 */
function decorateSummaries(root = document) {
  for (const s of root.querySelectorAll('details > summary')) {
    if (s.firstElementChild && s.firstElementChild.classList.contains('chev')) continue;
    const c = ico('chevron-right');
    c.classList.add('chev');
    s.prepend(c);
  }
}
/**
 * Tautan ke berkas PDF (dibuka di tab baru): ikon file-text abu-abu lalu nama berkasnya.
 * Nama berkas diketik orang, jadi dipasang lewat textContent.
 */
function fileLink(href, name, className = '') {
  const i = ico('file-text');
  i.classList.add('fico');
  return el('a', { className: 'filelink' + (className ? ' ' + className : ''), href, target: '_blank', rel: 'noopener', title: name }, i, el('span', { textContent: name }));
}
/** Isi tombol (atau tautan) dengan ikon + teks; teksnya tetap lewat textContent. */
function withIcon(node, name, text) {
  node.replaceChildren(ico(name), text);
  return node;
}

// ---------- bahasa tampilan (hanya dashboard; bot tetap berbahasa Indonesia) ----------
let lang = 'id';
try { if (localStorage.getItem('lang') === 'en') lang = 'en'; } catch { /* penyimpanan peramban diblokir */ }
const T = (id, en) => (lang === 'en' ? en : id);
const locale = () => T('id-ID', 'en-GB');
/** Huruf pertama kapital: teks lencana (chip) yang juga dipakai di tengah kalimat. */
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function applyLang() {
  document.documentElement.lang = lang;
  // data-en hanya berisi teks yang ditulis di page.html (bukan dari pengguna),
  // jadi aman dipasang sebagai HTML.
  for (const n of document.querySelectorAll('[data-en]')) {
    if (n.dataset.id === undefined) n.dataset.id = n.innerHTML;
    n.innerHTML = lang === 'en' ? n.dataset.en : n.dataset.id;
  }
  for (const n of document.querySelectorAll('[data-en-ph]')) {
    if (n.dataset.idPh === undefined) n.dataset.idPh = n.placeholder;
    n.placeholder = lang === 'en' ? n.dataset.enPh : n.dataset.idPh;
  }
  // Tombol ikon (dan tombol yang di HP hanya ikon) memakai title + aria-label sebagai namanya.
  for (const n of document.querySelectorAll('[data-en-title]')) {
    if (n.dataset.idTitle === undefined) n.dataset.idTitle = n.title || n.getAttribute('aria-label') || '';
    const t = lang === 'en' ? n.dataset.enTitle : n.dataset.idTitle;
    n.title = t;
    n.setAttribute('aria-label', t);
  }
  for (const b of $('lang').querySelectorAll('button')) b.classList.toggle('on', b.dataset.lang === lang);
}

// ---------- tema terang / gelap ----------
let theme = 'light';
try {
  const saved = localStorage.getItem('theme');
  theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch { /* tetap terang */ }
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').replaceChildren(ico(theme === 'dark' ? 'sun' : 'moon'));
}
applyTheme();
$('theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', theme); } catch { /* berlaku untuk kunjungan ini saja */ }
  applyTheme();
});

// ---------- menu samping ----------
// Layar lebar: #navToggle menyembunyikan atau menampilkan menu (diingat peramban).
// Layar <= 820 px: menu jadi laci; #navToggle membukanya, dan pilihan menu, latar, Esc, atau ✕ menutupnya.
const narrow = matchMedia('(max-width: 820px)');
let navOff = false;
try { navOff = localStorage.getItem('nav') === 'off'; } catch { /* menu tetap tampil */ }
function applyNav() {
  const root = document.documentElement;
  root.classList.toggle('nav-off', navOff);
  $('navToggle').setAttribute('aria-expanded', String(narrow.matches ? root.classList.contains('nav-open') : !navOff));
}
function setDrawer(open) {
  document.documentElement.classList.toggle('nav-open', open);
  applyNav();
  if (open) ($('nav').querySelector('a.on') || $('nav').querySelector('a')).focus();
}
const drawerOpen = () => document.documentElement.classList.contains('nav-open');
$('navToggle').addEventListener('click', () => {
  if (narrow.matches) return setDrawer(!drawerOpen());
  navOff = !navOff;
  try { localStorage.setItem('nav', navOff ? 'off' : 'on'); } catch { /* berlaku untuk kunjungan ini saja */ }
  applyNav();
});
$('navClose').addEventListener('click', () => { setDrawer(false); $('navToggle').focus(); });
$('navBg').addEventListener('click', () => setDrawer(false));
$('nav').addEventListener('click', (e) => { if (e.target.closest('a[href]')) setDrawer(false); });
$('projectSel').addEventListener('change', () => setDrawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerOpen()) { setDrawer(false); $('navToggle').focus(); } });
narrow.addEventListener('change', () => setDrawer(false));
applyNav();

let profile = null;
let state = null;
// Proyek yang sedang dibuka (satu bisnis, satu nomor WhatsApp); diambil dari alamat.
let project = '';
let projects = [];
let templates = [];
// Halaman yang sedang tampil (kunci di PAGES) dan rute lengkapnya.
let page = '';
let current = {};
let dirty = false;
// Hanya kunci yang benar-benar diubah yang dikirim: yang tidak disentuh tetap
// mengikuti bawaan, jadi perbaikan bawaan di kemudian hari tetap sampai.
const changed = new Set();
// Isian kartu Proyek (nama, jalur, nomor, aktif) ikut bilah simpan yang sama,
// tapi disimpan ke PUT /api/:proyek/project, bukan ke profil.
let projectDirty = false;
let chat = [];
let known = {};

// ---------- alamat ----------
// ROUTES, OLD_ROUTES, dan renamedPath disalin dari src/admin/routes.ts (server
// memakai yang sama untuk memeriksa dan mengalihkan alamat): ubah keduanya bersama.
/** Halaman -> alamat di bawah /<proyek>/. */
const ROUTES = {
  beranda: '', percakapan: 'conversations', pesanan: 'orders',
  behavior: 'knowledge/behavior', produk: 'knowledge/products', brosur: 'knowledge/brochures',
  pengaturan: 'settings', whatsapp: 'settings/whatsapp', notifikasi: 'settings/notifications', lanjutan: 'settings/advanced',
  marketplace: 'settings/marketplace',
};
/** Alamat lama (bahasa Indonesia) -> alamat baru. */
const OLD_ROUTES = {
  percakapan: 'conversations', pengetahuan: 'knowledge', pengaturan: 'settings',
  'pengaturan/whatsapp': 'settings/whatsapp', 'pengaturan/notifikasi': 'settings/notifications',
  'pengaturan/lanjutan': 'settings/advanced',
};
/** Alamat baru untuk alamat lama, atau null. Nomor di percakapan/<nomor> dibawa apa adanya. */
function renamedPath(rest) {
  if (Object.hasOwn(OLD_ROUTES, rest)) return OLD_ROUTES[rest];
  const m = rest.match(/^percakapan\/([^/]+)$/);
  return m ? 'conversations/' + m[1] : null;
}
/** Halaman Pengetahuan: di sini tombol "Coba chat" tersedia. */
const KNOWLEDGE = ['behavior', 'produk', 'brosur'];

const pathOf = (pg, pid = project) => '/' + pid + (ROUTES[pg] ? '/' + ROUTES[pg] : '');
const convPath = (phone, pid = project) => '/' + pid + '/conversations/' + encodeURIComponent(phone);

/** Baca alamat: { login } | { root } | { project, page, phone?, redirect? }. */
function parseRoute(pathname) {
  if (pathname === '/login') return { login: true };
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1);
  if (!parts[0]) return { root: true };
  const pid = parts[0];
  const rest = parts.slice(1).join('/');
  if (!rest) return { project: pid, page: 'beranda' };
  for (const [pg, p] of Object.entries(ROUTES)) if (p && p === rest) return { project: pid, page: pg };
  if (rest === 'knowledge') return { project: pid, page: 'behavior', redirect: true };
  // Alamat lama berbahasa Indonesia (mis. tautan yang tersimpan): baca alamat barunya.
  const moved = renamedPath(rest);
  if (moved !== null) return { ...parseRoute('/' + pid + '/' + moved), redirect: true };
  const m = rest.match(/^conversations\/([^/]+)$/);
  if (m) {
    try { return { project: pid, page: 'chat', phone: decodeURIComponent(m[1]) }; } catch { /* alamat rusak: tidak ada */ }
  }
  return { project: pid, page: 'notfound' };
}

const PAGES = {
  beranda: () => ['', T('Beranda', 'Home'), T('Ringkasan 7 hari terakhir, pelanggan yang menunggu staf, dan pertanyaan yang belum bisa dijawab bot.', 'The last 7 days at a glance, customers waiting for a person, and questions the bot could not answer.')],
  percakapan: () => ['', T('Percakapan', 'Conversations'), T('Semua calon pelanggan yang chat dengan bot. Klik satu baris untuk membuka percakapannya dan membalas dari sini.', 'Every prospective customer who chatted with the bot. Click a row to open the conversation and reply from here.')],
  pesanan: () => ['', T('Pesanan', 'Orders'), T('Pesanan dari toko Tokopedia & Shop yang ditautkan. Pesanan dicocokkan ke percakapan lewat nomor pesanan, atau ditautkan di sini.', 'Orders from the linked Tokopedia & Shop store. An order is matched to a conversation by its order number, or linked here.')],
  chat: () => [T('Percakapan', 'Conversations'), T('Percakapan', 'Conversation'), ''],
  behavior: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Cara bot bicara', 'How the bot talks'), T('Siapa yang menjawab, pembukaan, pertanyaan dan rekomendasi, gaya, dan yang harus dijawab manusia. Perubahan berlaku mulai pesan berikutnya setelah Anda menyimpan.', 'Who answers, the opening, questions and recommendations, the style, and what a human must answer. Changes apply to the next message after you save.')],
  produk: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Produk', 'Products'), T('Daftar produk, pengetahuan lain, dan pertanyaan yang belum terjawab. Bot tidak menjawab hal yang tidak tertulis di sini.', 'The product list, other knowledge, and unanswered questions. Anything not written here, the bot will not answer.')],
  brosur: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Brosur', 'Brochures'), T('Brosur dan katalog PDF yang bisa dikirim bot ke pelanggan.', 'PDF brochures and catalogues the bot can send to customers.')],
  pengaturan: () => [T('Pengaturan', 'Settings'), T('Umum', 'General'), T('Proyek, saat admin ikut membalas, dan follow-up.', 'Project, when a human admin steps in, and follow-up.')],
  whatsapp: () => [T('Pengaturan', 'Settings'), 'WhatsApp', T('Tautkan nomor bot, lihat keadaan bot, dan pengaman nomornya.', 'Link the bot\'s number, see the bot\'s status and the number safeguard.')],
  notifikasi: () => [T('Pengaturan', 'Settings'), T('Notifikasi', 'Notifications'), T('Siapa yang dikabari bot, dan notifikasi mana untuk siapa.', 'Who the bot notifies, and which news goes to whom.')],
  marketplace: () => [T('Pengaturan', 'Settings'), 'Tokopedia & Shop', T('Tautkan toko Tokopedia & Shop agar status pembayaran dan resi pesanan masuk sendiri ke percakapan.', 'Link your Tokopedia & Shop store so payment status and tracking numbers reach the conversations by themselves.')],
  lanjutan: () => [T('Pengaturan', 'Settings'), T('Lanjutan', 'Advanced'), T('Mode uji, batas dan pengaman, irama balasan, biaya LLM, riwayat warning, dan catatan error.', 'Test mode, limits and safeguards, reply rhythm, LLM cost, alert history and the error log.')],
  notfound: () => ['', T('Halaman tidak ditemukan', 'Page not found'), ''],
};

function toast(text, err = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), err ? 5000 : 2600);
}

// Alamat yang bukan milik satu proyek; sisanya ada di /api/<proyek>/….
const GLOBAL_API = ['login', 'logout', 'projects'];
const mediaBase = () => '/api/' + encodeURIComponent(project) + '/media/';

async function api(path, opts = {}) {
  const base = GLOBAL_API.includes(path) ? '/api/' : '/api/' + encodeURIComponent(project) + '/';
  const res = await fetch(base + path, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    showLogin();
    throw new Error(T('Anda belum masuk. Silakan masuk dulu.', 'Not signed in.'));
  }
  if (!res.ok) throw new Error(data.error || T('Permintaan gagal', 'Failed') + ' (' + res.status + ').' + T(' Coba lagi.', ''));
  return data;
}

/** Tandai ada (atau tidak ada) perubahan; bilah simpan di bawah layar muncul selama ada perubahan. */
function setDirty(v, key) {
  dirty = v;
  if (v && key === 'project') projectDirty = true;
  else if (v && key) changed.add(key);
  if (!v) { changed.clear(); projectDirty = false; }
  $('save').disabled = !v;
  withIcon($('save'), 'check', T('Simpan dan terapkan', 'Save & apply'));
  $('savebar').classList.toggle('on', v);
  $('savebar').setAttribute('aria-hidden', String(!v));
  // Selama tersembunyi, tombolnya tidak bisa dicapai dengan Tab.
  for (const b of [$('save'), $('discard')]) b.tabIndex = v ? 0 : -1;
  document.body.classList.toggle('has-savebar', v);
}

// ---------- isian sederhana ----------
function fillInputs() {
  for (const input of document.querySelectorAll('[data-key]')) {
    const v = profile[input.dataset.key];
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = v ?? '';
  }
}

// Pengaturan operasional: kotak kosong = ikut .env bot (nilainya tampil abu-abu).
const effective = () => (state && state.status && state.status.effective) || {};
function fillSettings() {
  const set = profile.settings || {};
  const eff = effective();
  for (const n of document.querySelectorAll('[data-set]')) {
    const k = n.dataset.set;
    n.value = set[k] ?? '';
    n.placeholder = eff[k] !== undefined ? String(eff[k]) : '';
  }
  for (const n of document.querySelectorAll('[data-set-bool]')) {
    const k = n.dataset.setBool;
    n.checked = Boolean(set[k] ?? eff[k] ?? true);
  }
  for (const n of document.querySelectorAll('[data-set-list]')) {
    const k = n.dataset.setList;
    n.value = (set[k] ?? eff[k] ?? []).join(', ');
  }
  syncFollowupMode();
}
function touchSetting(apply) {
  profile.settings = { ...(profile.settings || {}) };
  apply(profile.settings);
  setDirty(true, 'settings');
}
document.addEventListener('input', (e) => {
  const d = e.target.dataset || {};
  if (!profile) return;
  if (d.set) touchSetting((x) => { if (e.target.value === '') delete x[d.set]; else x[d.set] = Number(e.target.value); });
  else if (d.setBool) touchSetting((x) => { x[d.setBool] = e.target.checked; });
  else if (d.setList) touchSetting((x) => { x[d.setList] = e.target.value.split(/[,;\s]+/).map((v) => v.trim()).filter(Boolean); });
});

// Follow-up, "Isi pesan": dua tombol (radiogroup) mengubah kotak centang tersembunyi #fuSmart
// (data-set-bool="followupSmart") lalu memicu event input, jadi muat, tanda berubah, dan simpan
// tetap lewat jalur data-set-bool di atas. Label kotak kalimat ikut pilihan ([data-smart]).
function syncFollowupMode() {
  const smart = $('fuSmart').checked;
  for (const b of $('fuMode').querySelectorAll('[role=radio]')) {
    const on = (b.dataset.val === '1') === smart;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const n of document.querySelectorAll('.fu [data-smart]')) n.hidden = (n.dataset.smart === '1') !== smart;
}
function pickFollowupMode(smart) {
  const box = $('fuSmart');
  if (box.checked !== smart) {
    box.checked = smart;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  syncFollowupMode();
}
$('fuMode').addEventListener('click', (e) => {
  const b = e.target.closest('[role=radio]');
  if (b) pickFollowupMode(b.dataset.val === '1');
});
// Panah kiri/kanan/atas/bawah berpindah pilihan, seperti radio biasa.
$('fuMode').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  pickFollowupMode(!$('fuSmart').checked);
  $('fuMode').querySelector('[aria-checked=true]').focus();
});

// ---------- penerima notifikasi & rute ----------
// Hanya kabar yang bisa lewat WhatsApp. Kabar soal WhatsApp-nya sendiri dan bot berhenti hanya tampil di dashboard.
const NOTIFY = [
  ['lead', () => T('Lead baru (data pelanggan lengkap)', 'New lead (customer data complete)'), 'staff'],
  ['butuh-staf', () => T('Pelanggan butuh staf (bot tidak bisa menjawab, pelanggan minta bicara dengan orang, atau mengirim suara atau dokumen)', 'Customer needs staff (bot cannot answer, asks for a person, sends voice/document)'), 'staff'],
  ['llm', () => T('LLM bermasalah atau jatah hariannya habis', 'LLM failing / daily limit reached'), 'owner'],
  ['resi', () => T('Cek resi: saldo Binderbyte menipis atau batas harian tercapai', 'Tracking: Binderbyte balance low or daily cap reached'), 'owner'],
  ['marketplace', () => T('Tokopedia & Shop: tautan toko putus atau akan berakhir', 'Tokopedia & Shop: shop link lost or expiring'), 'owner'],
];
function renderRecipients() {
  const list = profile.recipients;
  const touch = () => setDirty(true, 'recipients');
  const body = el('tbody', {}, ...list.map((r, i) => {
    const role = el('select', {}, el('option', { value: 'owner', textContent: T('Pemilik', 'Owner') }), el('option', { value: 'staff', textContent: T('Staf', 'Staff') }));
    role.value = r.role;
    role.addEventListener('change', () => { r.role = role.value; touch(); });
    const cell = (k, ph) => {
      const input = cellInput(r[k], (v) => { r[k] = v; touch(); }, ph);
      if (k === 'phone') input.classList.add('phone');
      return el('td', { className: k === 'name' ? 'first' : '' }, input);
    };
    return el('tr', {}, cell('name', T('misalnya Bu Rina', 'e.g. Rina')), el('td', {}, role), cell('phone', T('0812… atau self', '0812… or self')),
      el('td', { className: 'act' }, xBtn(T('Hapus', 'Delete'), () => { list.splice(i, 1); touch(); renderRecipients(); })));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 4, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada penerima, jadi tidak ada yang dikabari lewat WhatsApp. Tambahkan minimal satu penerima.', 'No recipients yet, so nobody is notified on WhatsApp. Add at least one person.') })));
  $('recipients').replaceChildren(headRow([T('Nama', 'Name'), T('Peran', 'Role'), 'WhatsApp']), body);

  const opts = [['owner', T('Pemilik', 'Owner')], ['staff', T('Staf', 'Staff')], ['both', T('Pemilik dan staf', 'Owner and staff')], ['none', T('Tidak dikirim', 'Not sent')]];
  $('routes').replaceChildren(el('thead', {}, el('tr', {}, el('th', { textContent: T('Jenis notifikasi', 'Kind of news') }), el('th', { textContent: T('Dikirim ke', 'Sent to') }))),
    el('tbody', {}, ...NOTIFY.map(([kind, label, def]) => {
      const sel = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v, textContent: t })));
      sel.value = (profile.notifyRoutes || {})[kind] || def;
      sel.addEventListener('change', () => { profile.notifyRoutes = { ...(profile.notifyRoutes || {}), [kind]: sel.value }; setDirty(true, 'notifyRoutes'); });
      return el('tr', {}, el('td', { textContent: label() }), el('td', {}, sel));
    })));
}
// "Kirim tes": bot mengirim pesan tes ke tiap penerima yang sudah disimpan; di sini ditunggu kabarnya (±1 menit).
$('testNotify').addEventListener('click', async () => {
  if (changed.has('recipients') || changed.has('notifyRoutes')) {
    return toast(T('Simpan dulu perubahan penerima, lalu kirim pesan tes.', 'Save your recipient changes before sending a test.'), true);
  }
  const btn = $('testNotify');
  const out = $('testNotifyState');
  btn.disabled = true;
  out.textContent = T('Pesan tes masuk antrean…', 'Queuing the test…');
  try {
    const r = await api('notify/test', { method: 'POST', body: '{}' });
    const total = r.ids.length;
    let done = 0;
    let failed = 0;
    for (let i = 0; i < 30 && done + failed < total; i++) {
      await new Promise((ok) => setTimeout(ok, 2000));
      const s = await api('notify/test?ids=' + r.ids.join(','));
      done = s.items.filter((x) => x.done).length;
      // Berhenti dicoba setelah 5 kali gagal (MAX_REPLY_ATTEMPTS di src/sinks/outbox.ts).
      failed = s.items.filter((x) => !x.done && x.attempts >= 5).length;
      out.textContent = T('Terkirim ke ', 'Sent to ') + done + T(' dari ', ' of ') + total + T(' nomor.', ' numbers.');
    }
    if (done === total) out.textContent += T(' Cek WhatsApp di nomor penerima.', ' Check WhatsApp on the recipient numbers.');
    else if (failed) out.textContent += T(' Sebagian gagal. Lihat penyebabnya di Pengaturan › Lanjutan › Catatan error.', ' Some failed; see Settings › Advanced › Error log.');
    else out.textContent += T(' Sisanya menunggu sampai WhatsApp bot tersambung (Pengaturan › WhatsApp).', ' The rest waits for the bot\'s WhatsApp to connect (Settings › WhatsApp).');
  } catch (e) {
    out.textContent = '';
    toast(e.message, true);
  }
  btn.disabled = false;
});

$('addRecipient').addEventListener('click', () => {
  if (profile.recipients.length >= 20) return toast(T('Maksimal 20 penerima.', '20 people max.'), true);
  profile.recipients.push({ name: '', role: 'staff', phone: '' });
  setDirty(true, 'recipients');
  renderRecipients();
});

document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.key;
  if (!key || !profile) return;
  profile[key] =
    e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  if (key === 'notes') updateKnowLen();
  setDirty(true, key);
});

// ---------- berkas (foto, PDF, logo) ----------
const fileOf = (id) => (profile.files || []).find((f) => f.id === id);
const mediaUrl = (id) => { const f = fileOf(id); return f ? mediaBase() + f.file : ''; };

async function uploadFile(file) {
  if (file.size > 4000000) throw new Error(T('Berkas lebih dari 4 MB. Pilih berkas yang lebih kecil.', 'File too large (4 MB max).'));
  const r = await api('files?' + new URLSearchParams({ name: file.name }), { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
  profile.files = r.files;
  return Object.assign(r.file, { matches: r.matches, readable: r.readable });
}

// ---------- PDF: satu berkas untuk banyak produk ----------
const isPdfFile = (f) => f.file.endsWith('.pdf');
const pdfLibrary = () => (profile.files || []).filter(isPdfFile);

/** Pasang PDF ke produk yang disebut di dalamnya dan belum punya PDF. */
function assignPdf(id, names) {
  const wanted = new Set(names || []);
  let set = 0;
  let taken = 0;
  for (const p of profile.products) {
    if (!wanted.has(p.name)) continue;
    if (!p.pdf) { p.pdf = id; set += 1; } else if (p.pdf !== id) taken += 1;
  }
  if (set) setDirty(true, 'products');
  return { set, taken };
}

const matchNote = (name, readable, r) =>
  !readable ? name + T(': tidak bisa dibaca, mungkin hasil pindai. Pasangkan sendiri.', ': not readable (a scan?). Attach it by hand.')
    : name + T(': dipasang ke ', ': attached to ') + r.set + T(' produk', ' products') +
      (r.taken ? T(', ', ', ') + r.taken + T(' sudah punya PDF lain', ' already had another PDF') : '') + '.';

/** Perubahan dari pencocokan langsung disimpan, kecuali ada suntingan lain yang belum disimpan. */
async function afterAssign(wasDirty, notes) {
  renderProducts();
  renderPdfs();
  if (dirty && !wasDirty) await save(true);
  toast(notes.join(' ') + (dirty ? T(' Klik Simpan untuk menerapkan.', ' Click Save to apply.') : ''));
}

function renderPdfs() {
  const list = pdfLibrary();
  const head = el('thead', {}, el('tr', {}, el('th', { textContent: T('Berkas', 'File') }), el('th', { textContent: T('Dipakai di produk', 'Products using it') }), el('th', { textContent: T('Dibaca bot', 'Read by bot') }), el('th')));
  const rows = list.map((f) => {
    const using = profile.products.filter((p) => p.pdf === f.id);
    const free = profile.products.filter((p) => p.name && p.pdf !== f.id);
    const add = el('select', {}, el('option', { value: '', textContent: T('+ Tambah produk…', '+ product…') }),
      ...free.map((p) => el('option', { value: String(profile.products.indexOf(p)), textContent: p.name + (p.pdf ? T(' (ganti)', ' (replace)') : '') })));
    add.addEventListener('change', () => {
      if (add.value === '') return;
      profile.products[Number(add.value)].pdf = f.id;
      touchProducts();
      renderProducts();
      renderPdfs();
    });
    const chips = el('div', { className: 'chips' }, ...using.map((p) => {
      const rm = el('button', { type: 'button', title: T('Lepas dari produk ini', 'Detach from this product') }, ico('x'));
      rm.setAttribute('aria-label', rm.title);
      rm.addEventListener('click', () => { p.pdf = ''; touchProducts(); renderProducts(); renderPdfs(); });
      return el('span', { className: 'chip' }, el('span', { className: 'raw', textContent: p.name }), rm);
    }), add);

    const re = el('button', { className: 'btn ghost sm', type: 'button' }, ico('refresh'), T('Cocokkan ulang', 'Re-match'));
    re.addEventListener('click', async () => {
      re.disabled = true;
      try {
        const wasDirty = dirty;
        const r = await api('files/' + f.id + '/match', { method: 'POST' });
        await afterAssign(wasDirty, [matchNote(f.name, r.readable, assignPdf(f.id, r.matches))]);
      } catch (e) { toast(e.message, true); re.disabled = false; }
    });
    const del = el('button', { className: 'btn danger sm', type: 'button', style: 'margin-left:6px' }, ico('trash'), T('Hapus', 'Delete'));
    del.addEventListener('click', async () => {
      if (dirty) return toast(T('Simpan dulu perubahan lain, lalu hapus PDF ini.', 'Save your other changes before deleting a PDF.'), true);
      if (!confirm(T('Hapus "', 'Delete "') + f.name + '"?' + (using.length ? ' ' + using.length + T(' produk akan kehilangan PDF-nya.', ' products will lose their PDF.') : ''))) return;
      try {
        profile = (await api('files/' + f.id, { method: 'DELETE' })).profile;
        renderProducts();
        renderPdfs();
        toast(T('PDF sudah dihapus.', 'PDF deleted.'));
      } catch (e) { toast(e.message, true); }
    });
    const read = el('input', { type: 'checkbox', checked: Boolean(f.read) });
    read.addEventListener('change', async () => {
      read.disabled = true;
      try {
        profile.files = (await api('files/' + f.id + '/read', { method: 'POST', body: JSON.stringify({ read: read.checked }) })).files;
        toast(read.checked ? T('Bot sekarang membaca isi PDF ini. Uji lewat “Coba chat”.', 'The bot now reads this PDF. Test it with "Try chat".') : T('Bot tidak lagi membaca isi PDF ini.', 'The bot no longer reads this PDF.'));
      } catch (e) { toast(e.message, true); }
      renderPdfs();
    });
    return el('tr', {}, el('td', {}, fileLink(mediaBase() + f.file, f.name)),
      el('td', {}, chips), el('td', {}, el('label', { className: 'switch' }, read)), el('td', { className: 'acts' }, re, del));
  });
  $('pdfs').replaceChildren(head, el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 4, style: 'color:var(--muted)', textContent: T('Belum ada PDF. Unggah brosur atau katalog Anda.', 'No PDFs yet. Upload your brochures or catalogues.') }))])));
  $('pdfRematch').style.display = list.length ? '' : 'none';
}

$('pdfUpload').addEventListener('click', () => { $('pickPdfs').value = ''; $('pickPdfs').click(); });
$('pickPdfs').addEventListener('change', async () => {
  const files = [...$('pickPdfs').files];
  if (!files.length) return;
  const wasDirty = dirty;
  const notes = [];
  $('pdfUpload').disabled = true;
  for (const file of files) {
    try {
      const f = await uploadFile(file);
      if (!isPdfFile(f)) { notes.push(file.name + T(': bukan PDF.', ': not a PDF.')); continue; }
      notes.push(matchNote(f.name, f.readable, assignPdf(f.id, f.matches)));
    } catch (e) { notes.push(file.name + ': ' + e.message); }
  }
  $('pdfUpload').disabled = false;
  await afterAssign(wasDirty, notes);
});

$('pdfRematch').addEventListener('click', async () => {
  const wasDirty = dirty;
  const notes = [];
  $('pdfRematch').disabled = true;
  for (const f of pdfLibrary()) {
    try {
      const r = await api('files/' + f.id + '/match', { method: 'POST' });
      notes.push(matchNote(f.name, r.readable, assignPdf(f.id, r.matches)));
    } catch (e) { notes.push(f.name + ': ' + e.message); }
  }
  $('pdfRematch').disabled = false;
  await afterAssign(wasDirty, notes);
});

// Satu pemilih berkas untuk semua tombol unggah.
let onPicked = null;
function pick(accept, handler) {
  onPicked = handler;
  $('pickFile').accept = accept;
  $('pickFile').value = '';
  $('pickFile').click();
}
$('pickFile').addEventListener('change', async () => {
  const file = $('pickFile').files[0];
  const handler = onPicked;
  onPicked = null;
  if (!file || !handler) return;
  try {
    handler(await uploadFile(file));
  } catch (e) { toast(e.message, true); }
});
const IMAGES = 'image/jpeg,image/png,image/webp';

// ---------- logo ----------
// Logo proyek tampil di tombol pemilih proyek (bilah atas), menggantikan ikon lapisan.
function renderLogo() {
  const src = mediaUrl(profile.logo);
  document.body.classList.toggle('has-logo', Boolean(src));
  if (src) $('logoTop').src = src; else $('logoTop').removeAttribute('src');
  $('logoTop').hidden = !src;
  $('logoBox').replaceChildren(src ? el('img', { src, alt: 'Logo' }) : T('Belum ada logo', 'no logo yet'));
  $('logoClear').style.display = src ? '' : 'none';
}
$('logoPick').addEventListener('click', () => pick(IMAGES, (f) => {
  if (f.file.endsWith('.pdf')) return toast(T('Logo harus berupa gambar JPG, PNG, atau WebP.', 'The logo must be an image.'), true);
  profile.logo = f.id;
  setDirty(true, 'logo');
  renderLogo();
}));
$('logoClear').addEventListener('click', () => { profile.logo = ''; setDirty(true, 'logo'); renderLogo(); });

// ---------- tabel isian ----------
// Lebar kolom diatur CSS (table-layout: fixed); kotak isian selalu selebar selnya.
const cellInput = (value, onInput, placeholder = '') => {
  const input = el('input', { type: 'text', value: value || '', placeholder });
  input.addEventListener('input', () => onInput(input.value));
  return input;
};
/** Sel teks panjang (mis. keterangan produk): membungkus ke baris berikutnya dan tumbuh mengikuti isinya. */
const cellText = (value, onInput, placeholder = '') => {
  const box = el('textarea', { className: 'cellbox', rows: 1, value: value || '', placeholder });
  box.addEventListener('input', () => onInput(box.value));
  return box;
};
const xBtn = (title, onClick, name = 'trash') => {
  const b = el('button', { className: 'x', type: 'button', title }, ico(name));
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
};
const headRow = (labels) => el('thead', {}, el('tr', {}, ...labels.map((t) => el('th', { className: 'lbl', textContent: t })), el('th', { className: 'act' })));

/** Enter = turun satu baris; tempel dari Excel = isi banyak sel. `rows` = daftar baris, `get/set` = akses sel. */
function gridKeys(table, opts) {
  const focusCell = (r, c) => {
    const n = table.querySelector('[data-r="' + r + '"][data-c="' + c + '"]');
    if (n) { n.focus(); n.select(); }
  };
  table.addEventListener('keydown', (e) => {
    const d = e.target.dataset;
    if (e.key !== 'Enter' || d.r === undefined) return;
    e.preventDefault();
    const r = Number(d.r) + 1;
    if (r >= opts.count()) { opts.addRow(); opts.redraw(); }
    focusCell(r, Number(d.c));
  });
  table.addEventListener('paste', (e) => {
    const d = e.target.dataset;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (d.r === undefined || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const r0 = Number(d.r);
    const c0 = Number(d.c);
    lines.forEach((cells, i) => {
      if (r0 + i >= opts.max) return;
      while (opts.count() <= r0 + i) opts.addRow();
      cells.forEach((v, j) => { if (c0 + j < opts.cols()) opts.set(r0 + i, c0 + j, v.trim()); });
    });
    opts.redraw();
    focusCell(r0, c0);
    toast(lines.length + T(' baris ditempel.', ' rows pasted.'));
  });
  return focusCell;
}

// ---------- data pelanggan ----------
function renderFields() {
  const body = el('tbody');
  profile.leadFields.forEach((f, i) => {
    const mk = (prop, ph) => el('td', { className: prop === 'key' ? 'first' : '' },
      cellInput(f[prop], (v) => { f[prop] = v; setDirty(true, 'leadFields'); }, ph));
    const isName = el('input', { type: 'checkbox', checked: Boolean(f.isName), title: T('Dipakai untuk menyapa pelanggan', 'Used to address the customer') });
    isName.addEventListener('change', () => {
      profile.leadFields.forEach((x) => (x.isName = false));
      f.isName = isName.checked;
      setDirty(true, 'leadFields');
      renderFields();
    });
    const del = xBtn(T('Hapus baris', 'Delete row'), () => {
      if (profile.leadFields.length <= 1) return toast(T('Harus ada minimal satu baris.', 'At least one row.'), true);
      profile.leadFields.splice(i, 1);
      setDirty(true, 'leadFields');
      renderFields();
    });
    body.append(el('tr', {}, mk('key', T('misalnya kota', 'e.g. kota')), mk('label', T('misalnya kota/alamat', 'e.g. kota/alamat')), mk('hint', T('apa yang dianggap sebagai jawaban', 'what counts as the answer')),
      el('td', { className: 'center' }, isName), el('td', { className: 'act' }, del)));
  });
  $('fields').replaceChildren(headRow([T('Kunci', 'Key'), T('Yang diminta dari pelanggan', 'What the customer is asked for'), T('Petunjuk untuk bot', 'Hint for the bot'), T('Nama', 'Name')]), body);
}

$('addField').addEventListener('click', () => {
  if (profile.leadFields.length >= 8) return toast(T('Maksimal 8 baris.', '8 rows max.'), true);
  profile.leadFields.push({ key: '', label: '', hint: '', isName: false });
  setDirty(true, 'leadFields');
  renderFields();
});

// ---------- pertanyaan kebutuhan ----------
function renderQuestions() {
  const body = el('tbody', {}, ...profile.questions.map((q, i) => el('tr', {},
    el('td', {}, cellInput(q, (v) => { profile.questions[i] = v; setDirty(true, 'questions'); }, T('Contoh: Ukuran ruangannya berapa × berapa meter?', 'e.g. Ukuran ruangannya berapa × berapa meter?'))),
    el('td', { className: 'act' }, xBtn(T('Hapus pertanyaan', 'Delete question'), () => { profile.questions.splice(i, 1); setDirty(true, 'questions'); renderQuestions(); })))));
  if (!profile.questions.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada pertanyaan, jadi bot hanya bertanya kalau perlu. Tambahkan pertanyaan di bawah.', 'No questions yet. The bot will only ask when it has to.') })));
  $('questionTable').replaceChildren(headRow([T('Pertanyaan', 'Question')]), body);
}
$('addQuestion').addEventListener('click', () => {
  if (profile.questions.length >= 12) return toast(T('Maksimal 12 pertanyaan.', '12 questions max.'), true);
  profile.questions.push('');
  setDirty(true, 'questions');
  renderQuestions();
  const inputs = $('questionTable').querySelectorAll('input');
  inputs[inputs.length - 1].focus();
});

// ---------- aturan gaya balasan ----------
function renderRules() {
  const list = profile.styleRules;
  const body = el('tbody', {}, ...list.map((r, i) => {
    // Aturan bisa panjang: kotak teks yang membungkus, bukan satu baris.
    const box = el('textarea', { rows: Math.min(5, Math.max(2, Math.ceil((r || '').length / 90))), value: r, placeholder: T('Contoh: Pakai kalimat positif dan langsung ke inti.', 'e.g. Pakai kalimat positif dan langsung ke inti.'), style: 'border:0;border-radius:0;background:transparent' });
    box.addEventListener('input', () => { list[i] = box.value; setDirty(true, 'styleRules'); });
    return el('tr', {}, el('td', {}, box), el('td', { className: 'act' }, xBtn(T('Hapus aturan', 'Delete rule'), () => { list.splice(i, 1); setDirty(true, 'styleRules'); renderRules(); })));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada aturan, jadi bot memakai gaya bawaannya. Tambahkan aturan di bawah.', 'No rules yet. The bot uses its default style.') })));
  $('rules').replaceChildren(headRow([T('Aturan', 'Rule')]), body);
}
$('addRule').addEventListener('click', () => {
  if (profile.styleRules.length >= 20) return toast(T('Maksimal 20 aturan.', '20 rules max.'), true);
  profile.styleRules.push('');
  setDirty(true, 'styleRules');
  renderRules();
  const boxes = $('rules').querySelectorAll('textarea');
  boxes[boxes.length - 1].focus();
});

// ---------- pelajaran dari percakapan ----------
function renderLessons() {
  const list = profile.lessons || (profile.lessons = []);
  const body = el('tbody', {}, ...list.map((l, i) => {
    const box = el('textarea', { rows: Math.min(5, Math.max(2, Math.ceil((l.rule || '').length / 90))), value: l.rule, maxLength: 600,
      placeholder: T('Contoh: Kalau pelanggan menyebut jumlah orang, itu jawaban atas pertanyaan bot soal pemakaian ruangan.', 'e.g. Kalau pelanggan menyebut jumlah orang, itu jawaban atas pertanyaan kita soal pemakaian ruangan.'),
      style: 'border:0;border-radius:0;background:transparent' });
    box.setAttribute('aria-label', T('Pelajaran ', 'Lesson ') + (i + 1));
    box.addEventListener('input', () => { l.rule = box.value; setDirty(true, 'lessons'); });
    const ex = l.example ? el('div', { className: 'lesson-ex', textContent: T('Dari: ', 'From: ') + l.example }) : null;
    return el('tr', {}, el('td', {}, box, ex),
      el('td', { className: 'act' }, xBtn(T('Hapus pelajaran', 'Delete lesson'), () => { list.splice(i, 1); setDirty(true, 'lessons'); renderLessons(); })));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)',
    textContent: T('Belum ada pelajaran. Tambahkan lewat “Ajari bot” di Pertanyaan yang belum terjawab, atau tulis sendiri di sini.', 'No lessons yet. Add one with “Teach the bot” in Unanswered questions, or write one here.') })));
  $('lessonTable').replaceChildren(headRow([T('Pelajaran', 'Lesson')]), body);
}
$('addLesson').addEventListener('click', () => {
  const list = profile.lessons || (profile.lessons = []);
  if (list.length >= 40) return toast(T('Maksimal 40 pelajaran.', '40 lessons max.'), true);
  list.push({ rule: '', example: '' });
  setDirty(true, 'lessons');
  renderLessons();
  const boxes = $('lessonTable').querySelectorAll('textarea');
  boxes[boxes.length - 1].focus();
});

// ---------- daftar produk ----------
const P_COLS = ['name', 'description', 'price', 'stock'];
// Sama dengan MARKETS dan MARKET_HOSTS di src/business (server memeriksanya lagi saat menyimpan).
const MARKETS = [
  { key: 'tokopedia', label: 'Tokopedia', icon: '/assets/tokopedia.png', example: 'https://www.tokopedia.com/…', host: /(^|\.)(tokopedia\.com|tokopedia\.link)$/i },
  { key: 'shopee', label: 'Shopee', icon: '/assets/shopee.svg', example: 'https://shopee.co.id/…', host: /(^|\.)(shopee\.co\.id|shp\.ee|shope\.ee)$/i },
];
/** Marketplace dari sebuah tautan, atau null kalau bukan tautan marketplace yang dikenal. */
function marketOf(url) {
  try { const h = new URL(url).hostname; return MARKETS.find((m) => m.host.test(h)) || null; } catch { return null; }
}
const blankProduct = () => ({ name: '', description: '', price: '', stock: '', photos: [], pdf: '', links: { tokopedia: '', shopee: '' } });
const touchProducts = () => { setDirty(true, 'products'); updateKnowLen(); };
let focusProduct = () => {};

// Dialog tambah tautan marketplace untuk satu produk.
let linkTarget = null;
function openLinkDlg(p, m) {
  linkTarget = { p, m };
  $('linkTitle').textContent = T('Link ', '') + m.label + T('', ' link');
  $('linkFor').textContent = p.name || T('Produk tanpa nama', 'Unnamed product');
  $('linkUrl').value = '';
  $('linkUrl').placeholder = m.example;
  $('linkDlg').classList.add('on');
  $('linkUrl').focus();
}
$('linkCancel').addEventListener('click', () => $('linkDlg').classList.remove('on'));
$('linkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const { p, m } = linkTarget;
  const url = $('linkUrl').value.trim();
  if (marketOf(url) !== m) return toast(T('Tempel link produk dari ', 'Paste a product link from ') + m.label + '.', true);
  if (!url.startsWith('https://')) return toast(T('Link harus diawali https://', 'The link must start with https://'), true);
  (p.links ||= { tokopedia: '', shopee: '' })[m.key] = url;
  $('linkDlg').classList.remove('on');
  touchProducts();
  renderProducts();
});

/**
 * Kolom Marketplace: selalu satu baris per marketplace, tingginya sama. Ada link: ikon, nama
 * (buka di tab baru), dan hapus. Kosong: tombol "+ Tambah link <marketplace>".
 */
function marketCell(p) {
  const links = p.links || {};
  return el('div', { className: 'mkt' }, ...MARKETS.map((m) => {
    if (links[m.key]) {
      const a = el('a', { href: links[m.key], target: '_blank', rel: 'noopener', title: links[m.key] },
        el('img', { src: m.icon, alt: '', width: 16, height: 16 }), el('span', { textContent: m.label }));
      return el('div', { className: 'ln' }, a, xBtn(T('Hapus link ', 'Remove ') + m.label + T('', ' link'), () => { links[m.key] = ''; touchProducts(); renderProducts(); }, 'x'));
    }
    const add = el('button', { className: 'addlink', type: 'button' }, ico('plus'), el('span', { textContent: T('Tambah link ', 'Add ') + m.label + T('', ' link') }));
    add.addEventListener('click', () => openLinkDlg(p, m));
    return el('div', { className: 'ln' }, add);
  }));
}

function renderProducts() {
  const list = profile.products;
  const pdfs = pdfLibrary();
  const ph = [T('misalnya GFAF-40A', 'e.g. GFAF-40A'), T('jenis, ukuran, kegunaan', 'type, size, use'), T('misalnya Rp450.000', 'e.g. Rp 450.000'), T('misalnya ada atau 12 unit', 'e.g. ada / 12 unit')];

  const body = el('tbody', {}, ...list.map((p, ri) => {
    const cells = P_COLS.map((k, ci) => {
      const make = k === 'description' ? cellText : cellInput;
      const input = make(p[k], (v) => { p[k] = v; touchProducts(); }, ri === 0 || !p.name ? ph[ci] : '');
      input.dataset.r = ri;
      input.dataset.c = ci;
      return el('td', { className: ci === 0 ? 'first' : '' }, input);
    });

    const add = el('button', { className: 'add', type: 'button', title: T('Tambah foto', 'Add photo') }, ico('plus'));
    add.setAttribute('aria-label', add.title);
    add.addEventListener('click', () => {
      if (p.photos.length >= 6) return toast(T('Maksimal 6 foto per produk.', '6 photos per product max.'), true);
      pick(IMAGES, (f) => {
        if (f.file.endsWith('.pdf')) return toast(T('Berkas itu PDF, bukan foto. Pasang di kolom PDF.', 'That is a PDF, not a photo. Use the PDF column.'), true);
        p.photos.push(f.id);
        touchProducts();
        renderProducts();
      });
    });
    const thumbs = el('div', { className: 'thumbs' }, ...p.photos.map((id, pi) => {
      const rm = el('button', { type: 'button', title: T('Lepas foto', 'Remove photo') }, ico('x'));
      rm.setAttribute('aria-label', rm.title);
      rm.addEventListener('click', () => { p.photos.splice(pi, 1); touchProducts(); renderProducts(); });
      return el('span', { className: 'th' }, el('img', { src: mediaUrl(id), alt: p.name, loading: 'lazy' }), rm);
    }), add);

    let pdf;
    const cur = fileOf(p.pdf);
    if (cur) {
      pdf = el('div', { className: 'pdf' }, fileLink(mediaUrl(p.pdf), cur.name),
        xBtn(T('Lepas PDF', 'Remove PDF'), () => { p.pdf = ''; touchProducts(); renderProducts(); renderPdfs(); }, 'x'));
    } else {
      const sel = el('select', {}, el('option', { value: '', textContent: T('Tanpa PDF', 'No PDF') }),
        el('option', { value: '+', textContent: T('⬆ Unggah PDF…', '⬆ Upload PDF…') }),
        ...pdfs.map((f) => el('option', { value: f.id, textContent: f.name })));
      sel.addEventListener('change', () => {
        if (sel.value === '+') {
          sel.value = '';
          return pick('application/pdf', (f) => {
            if (!f.file.endsWith('.pdf')) return toast(T('Berkas itu bukan PDF. Pilih berkas PDF.', 'That file is not a PDF.'), true);
            p.pdf = f.id;
            // Produk lain yang disebut di PDF yang sama ikut dipasangkan.
            const r = assignPdf(f.id, f.matches);
            touchProducts();
            renderProducts();
            renderPdfs();
            if (r.set) toast(matchNote(f.name, true, { set: r.set + 1, taken: r.taken }));
          });
        }
        p.pdf = sel.value;
        touchProducts();
        renderProducts();
        renderPdfs();
      });
      pdf = el('div', { className: 'pdf' }, sel);
    }

    const del = xBtn(T('Hapus produk', 'Delete product'), () => { list.splice(ri, 1); touchProducts(); renderProducts(); });
    return el('tr', {}, ...cells, el('td', {}, thumbs), el('td', {}, pdf), el('td', {}, marketCell(p)), el('td', { className: 'act' }, del));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 8, style: 'padding:12px;color:var(--muted)', textContent: T('Belum ada produk. Klik Tambah produk untuk menambahkan yang pertama.', 'No products yet.') })));
  $('products').replaceChildren(headRow([T('Nama', 'Name'), T('Keterangan', 'Description'), T('Harga', 'Price'), T('Stok', 'Stock'), T('Foto', 'Photos'), 'PDF', 'Marketplace']), body);
  updateKnowLen();
}

focusProduct = gridKeys($('products'), {
  max: 300,
  count: () => profile.products.length,
  cols: () => P_COLS.length,
  addRow: () => { profile.products.push(blankProduct()); },
  set: (r, c, v) => { profile.products[r][P_COLS[c]] = v; },
  redraw: () => { touchProducts(); renderProducts(); },
});

$('addProduct').addEventListener('click', () => {
  if (profile.products.length >= 300) return toast(T('Maksimal 300 produk.', '300 products max.'), true);
  profile.products.push(blankProduct());
  touchProducts();
  renderProducts();
  focusProduct(profile.products.length - 1, 0);
});

// Sama dengan rakitan di server (src/business/catalog.ts): ini yang dibaca bot.
function knowledgeLength() {
  const v = (s) => s || '-';
  const buy = (x) => MARKETS.filter((m) => (x.links || {})[m.key]).map((m) => m.label).join(', ');
  const products = profile.products.map((x) => [x.name, v(x.description), v(x.price), v(x.stock), v(x.photos.join(', ')), v(x.pdf), v(buy(x))].join(' | ')).join('\n');
  const catalog = profile.catalog
    .map((s) => {
      const tables = s.tables.map((t) => t.title + ':\n' + t.columns.join(' | ') + '\n' + t.rows.map((r) => r.join(' | ')).join('\n')).join('\n\n');
      return ['### ' + s.name, s.facts.map((f) => '- ' + f).join('\n')].filter(Boolean).join('\n') + (tables ? '\n\n' + tables : '');
    })
    .join('\n\n');
  return products.length + catalog.length + (profile.notes || '').length;
}

function updateKnowLen() {
  const n = knowledgeLength();
  $('knowLen').textContent = profile.products.filter((p) => p.name).length + T(' produk · sekitar ', ' products · ±') + n.toLocaleString(locale()) +
    T(' karakter dibaca bot di tiap balasan. Makin panjang, makin mahal biaya tiap balasan.', ' characters read by the bot on every reply. The longer, the more each reply costs.');
  $('detailCount').textContent = profile.catalog.length ? profile.catalog.length + T(' kelompok', ' groups') : T('kosong', 'empty');
}

// ---------- data teknis rinci ----------
const touchCatalog = () => { setDirty(true, 'catalog'); updateKnowLen(); };
const openSeries = new Set();

function tableNode(t) {
  const table = el('table', { className: 'grid' });
  function draw() {
    const head = el('tr', {}, ...t.columns.map((col, ci) => {
      const input = cellInput(col, (v) => { t.columns[ci] = v; touchCatalog(); }, T('judul kolom', 'column title'));
      const del = ci === 0 ? null : xBtn(T('Hapus kolom', 'Delete column') + ' "' + col + '"', () => {
        if (t.rows.some((r) => r[ci]) && !confirm(T('Hapus kolom "', 'Delete column "') + t.columns[ci] + T('" beserta isinya?', '" and its contents?'))) return;
        t.columns.splice(ci, 1);
        t.rows.forEach((r) => r.splice(ci, 1));
        touchCatalog();
        draw();
      });
      return el('th', {}, el('div', { className: 'hc' }, input, del));
    }), el('th', { className: 'act' }));
    const body = el('tbody', {}, ...t.rows.map((row, ri) => {
      const cells = t.columns.map((_, ci) => {
        const input = cellInput(row[ci], (v) => { row[ci] = v; touchCatalog(); });
        input.dataset.r = ri;
        input.dataset.c = ci;
        return el('td', { className: ci === 0 ? 'first' : '' }, input);
      });
      return el('tr', {}, ...cells, el('td', { className: 'act' }, xBtn(T('Hapus baris', 'Delete row'), () => { t.rows.splice(ri, 1); touchCatalog(); draw(); })));
    }));
    table.replaceChildren(el('thead', {}, head), body);
    // Kolom sama lebar (table-layout: fixed), paling sempit 110 px; lebih dari itu wadahnya bergulung ke samping.
    table.style.minWidth = t.columns.length * 110 + 44 + 'px';
  }
  const focusCell = gridKeys(table, {
    max: 200,
    count: () => t.rows.length,
    cols: () => t.columns.length,
    addRow: () => { t.rows.push(t.columns.map(() => '')); },
    set: (r, c, v) => { t.rows[r][c] = v; },
    redraw: () => { touchCatalog(); draw(); },
  });
  draw();
  const addRow = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Tambah baris', 'Row'));
  addRow.addEventListener('click', () => { t.rows.push(t.columns.map(() => '')); touchCatalog(); draw(); focusCell(t.rows.length - 1, 0); });
  const addCol = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Tambah kolom', 'Column'));
  addCol.addEventListener('click', () => {
    if (t.columns.length >= 16) return toast(T('Maksimal 16 kolom.', '16 columns max.'), true);
    t.columns.push(T('Kolom ', 'Column ') + (t.columns.length + 1));
    t.rows.forEach((r) => r.push(''));
    touchCatalog();
    draw();
  });
  return { table, addRow, addCol };
}

function seriesNode(s, si) {
  const blank = T('(kelompok baru)', '(new group)');
  const title = el('span', { textContent: s.name || blank });
  const count = el('span', { className: 'count', textContent: s.tables.length + T(' tabel', ' tables') });
  const name = cellInput(s.name, (v) => { s.name = v; title.textContent = v || blank; touchCatalog(); }, T('misalnya Exhaust Fan Industri, Seri A', 'e.g. Exhaust Fan Industri, Seri A'));
  const facts = el('textarea', { rows: Math.max(2, s.facts.length + 1), value: s.facts.join('\n'), placeholder: T('Satu kalimat per baris, misalnya bahan, pemakaian, dan rentang ukuran', 'One sentence per line: material, use, size range, …') });
  facts.addEventListener('input', () => { s.facts = facts.value.split('\n').map((f) => f.trim()).filter(Boolean); touchCatalog(); });

  const body = el('div', { className: 'series-body' },
    el('div', { className: 'row' },
      el('label', { className: 'f' }, el('span', { textContent: T('Nama kelompok atau seri', 'Group / series name') }), name),
      el('label', { className: 'f' }, el('span', { textContent: T('Keterangan umum', 'General notes') }), facts)));

  s.tables.forEach((t, ti) => {
    const { table, addRow, addCol } = tableNode(t);
    const tTitle = cellInput(t.title, (v) => { t.title = v; touchCatalog(); }, T('judul tabel, misalnya Spesifikasi teknis', 'table title, e.g. Spesifikasi teknis'));
    const delT = el('button', { className: 'btn danger sm', type: 'button' }, ico('trash'), T('Hapus tabel', 'Delete table'));
    delT.addEventListener('click', () => {
      if (t.rows.length && !confirm(T('Hapus tabel "', 'Delete table "') + t.title + T('" beserta barisnya?', '" and its rows?'))) return;
      s.tables.splice(ti, 1);
      touchCatalog();
      renderCatalog();
    });
    body.append(el('div', { className: 'tblhead' }, tTitle), el('div', { className: 'scroll' }, table), el('div', { className: 'tblfoot' }, addRow, addCol, delT));
  });

  const addT = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Tambah tabel', 'Table'));
  addT.addEventListener('click', () => {
    if (s.tables.length >= 6) return toast(T('Maksimal 6 tabel per kelompok.', '6 tables per group max.'), true);
    const first = s.tables[0];
    s.tables.push({ title: '', columns: [first ? first.columns[0] : 'Model', T('Kolom 2', 'Column 2')], rows: first ? first.rows.map((r) => [r[0], '']) : [['', '']] });
    touchCatalog();
    renderCatalog();
  });
  const delS = el('button', { className: 'btn danger sm', type: 'button' }, ico('trash'), T('Hapus kelompok', 'Delete group'));
  delS.addEventListener('click', () => {
    if (!confirm(T('Hapus kelompok "', 'Delete group "') + (s.name || blank) + T('" beserta semua tabelnya? Bot tidak akan bisa lagi menjawab spesifikasi di dalamnya.', '" and all its tables? The bot will no longer be able to answer the specifications in it.'))) return;
    profile.catalog.splice(si, 1);
    openSeries.clear();
    touchCatalog();
    renderCatalog();
  });
  body.append(el('div', { className: 'tblfoot', style: 'margin-top:16px;padding-top:12px;border-top:1px solid var(--line-soft)' }, addT, delS));

  const d = el('details', { className: 'series', open: openSeries.has(si) }, el('summary', {}, title, count), body);
  d.addEventListener('toggle', () => (d.open ? openSeries.add(si) : openSeries.delete(si)));
  return d;
}

function renderCatalog() {
  $('catalog').replaceChildren(...profile.catalog.map(seriesNode));
  decorateSummaries($('catalog'));
  updateKnowLen();
}

$('addSeries').addEventListener('click', () => {
  if (profile.catalog.length >= 40) return toast(T('Maksimal 40 kelompok.', '40 groups max.'), true);
  profile.catalog.push({ name: '', facts: [], tables: [{ title: T('Spesifikasi', 'Specifications'), columns: ['Model', T('Kolom 2', 'Column 2')], rows: [['', '']] }] });
  openSeries.add(profile.catalog.length - 1);
  touchCatalog();
  renderCatalog();
});

// Klik foto kecil = lihat besar.
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.thumbs')) {
    $('viewer').firstElementChild.src = e.target.src;
    $('viewer').classList.add('on');
  }
});
$('viewer').addEventListener('click', () => $('viewer').classList.remove('on'));

// ---------- uji coba ----------
const chatHint = () => el('div', { className: 'msg note', textContent: T('Ketik pesan seperti calon pelanggan.', 'Type as a prospective customer would (in Indonesian).') });

function addMsg(cls, text, photos, docs) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  for (const p of photos || []) m.append(el('img', { src: mediaBase() + p.file, alt: p.name, title: p.name }));
  for (const d of docs || []) m.append(fileLink(mediaBase() + d.file, d.name, 'doc'));
  $('chat').append(m);
  $('chat').scrollTop = $('chat').scrollHeight;
  return m;
}

$('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('sendText').value.trim();
  if (!text) return;
  if (dirty) addMsg('note', T('Ada perubahan yang belum disimpan. Jawaban di bawah masih memakai profil lama.', 'There are unsaved changes. The answer below still uses the old profile.'));
  $('sendText').value = '';
  addMsg('in', text);
  const wait = addMsg('note', T('sedang mengetik…', 'typing…'));
  try {
    const r = await api('test', { method: 'POST', body: JSON.stringify({ text, history: chat, known }) });
    wait.remove();
    if (r.rejected) {
      addMsg('bad', T('Balasan ini tidak akan dikirim (', 'This reply will NOT be sent (') + r.rejected + '):\n\n' + r.reply);
    } else {
      addMsg('out', r.reply, r.photos, r.docs);
      for (const b of r.buy || []) addMsg('out', b.text);
    }
    Object.assign(known, r.fields);
    const got = Object.entries(r.fields).map(([k, v]) => k + ' = ' + v).join(' · ');
    const n = r.photos.length + r.docs.length;
    addMsg('note', T('niat: ', 'intent: ') + r.intent + (got ? T(' · tercatat: ', ' · captured: ') + got : '') + (n ? ' · ' + n + T(' lampiran', ' attachments') : ''));
    chat.push({ dir: 'in', text }, { dir: 'out', text: r.reply }, ...(r.rejected ? [] : (r.buy || []).map((b) => ({ dir: 'out', text: b.mark }))));
  } catch (err) {
    wait.remove();
    addMsg('bad', err.message);
  }
});

$('resetChat').addEventListener('click', () => {
  chat = [];
  known = {};
  $('chat').replaceChildren(chatHint());
});

// Panel samping "Coba chat": tersedia di semua halaman Pengetahuan.
function openTry() {
  closeHelp();
  $('uji').classList.add('on');
  $('ujiBg').classList.add('on');
  $('uji').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('sendText').focus(), 50);
}
function closeTry() {
  $('uji').classList.remove('on');
  $('ujiBg').classList.remove('on');
  $('uji').setAttribute('aria-hidden', 'true');
}
$('tryBtn').addEventListener('click', openTry);
$('ujiClose').addEventListener('click', closeTry);
$('ujiBg').addEventListener('click', closeTry);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('uji').classList.contains('on')) closeTry();
  else if ($('help').classList.contains('on')) closeHelp();
  else if ($('importDlg').classList.contains('on')) $('importDlg').classList.remove('on');
  else if ($('linkDlg').classList.contains('on')) $('linkDlg').classList.remove('on');
});

// ---------- bantuan ----------
// Panel Bantuan (tombol tanda tanya di kanan bawah). Tab "Tanya": pertanyaan staf tentang dashboard dijawab LLM
// dari src/admin/bantuan.md lewat POST help/ask; tab "Panduan": berkas itu digambar apa adanya (renderMd).
// Riwayat tanya jawab hanya di memori halaman. Pertanyaan yang tidak terjawab dicatat server untuk pengembang.
let helpHistory = [];
let helpData = null;
const HELP_SUGGEST = () => [
  T('Bagaimana cara menautkan WhatsApp?', 'How do I link WhatsApp?'),
  T('Di mana mengubah salam pembuka?', 'Where do I change the greeting?'),
  T('Bagaimana membalas pelanggan dari dashboard?', 'How do I reply to a customer from here?'),
  T('Kenapa bot tidak membalas?', 'Why is the bot not replying?'),
];

function helpMsg(cls, text) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  $('helpChat').append(m);
  $('helpChat').scrollTop = $('helpChat').scrollHeight;
  return m;
}

/** Awal percakapan bantuan: keterangan singkat dan beberapa pertanyaan contoh. */
function helpIntro() {
  $('helpChat').replaceChildren(
    el('div', { className: 'msg note', textContent: T('Tanya apa saja tentang dashboard ini. Jawabannya diambil dari panduan.', 'Ask anything about this dashboard. Answers come from the guide.') }),
    el('div', { className: 'help-sug' }, ...HELP_SUGGEST().map((q) => el('button', { className: 'btn ghost', type: 'button', textContent: q, onclick: () => askHelp(q) })))
  );
}

async function askHelp(question) {
  const q = String(question || '').trim();
  if (!q || $('helpSend').disabled) return;
  $('helpText').value = '';
  const sug = $('helpChat').querySelector('.help-sug');
  if (sug) sug.remove();
  helpMsg('in', q);
  const wait = helpMsg('note', T('sedang mencari jawaban…', 'looking it up…'));
  $('helpSend').disabled = true;
  try {
    const r = await api('help/ask', { method: 'POST', body: JSON.stringify({ question: q, history: helpHistory, lang }) });
    wait.remove();
    const m = helpMsg('out', r.answer);
    if (r.page && PAGES[r.page]) {
      // Tautan sungguhan: router menanganinya; panelnya ditutup supaya halamannya terlihat.
      m.append(el('a', { className: 'btn ghost sm goto', href: pathOf(r.page), onclick: () => closeHelp() }, ico('arrow-right'), el('span', { textContent: T('Buka ', 'Open ') + PAGES[r.page]()[1] })));
    }
    if (!r.found) helpMsg('note', T('Pertanyaan ini dicatat untuk developer.', 'This question was noted for the developer.'));
    helpHistory = [...helpHistory, { dir: 'in', text: q }, { dir: 'out', text: r.answer }].slice(-8);
  } catch (err) {
    wait.remove();
    helpMsg('bad', err.message);
  }
  $('helpSend').disabled = false;
  $('helpText').focus();
}

/**
 * Markdown sederhana jadi DOM tanpa innerHTML: judul (#, ##, ###), daftar "- " dengan sub-daftar (indentasi
 * 2 spasi), paragraf, **tebal**, dan `kode`. Cukup untuk bantuan.md; tautan dan tabel tidak dipakai di sana.
 */
function renderMd(text) {
  const inline = (str) => {
    const frag = document.createDocumentFragment();
    const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(str))) {
      if (m.index > last) frag.append(str.slice(last, m.index));
      const t = m[0];
      frag.append(t[0] === '`' ? el('code', { textContent: t.slice(1, -1) }) : el('b', { textContent: t.slice(2, -2) }));
      last = m.index + t.length;
    }
    if (last < str.length) frag.append(str.slice(last));
    return frag;
  };
  const out = [];
  const stack = []; // daftar yang sedang terbuka: { ul, indent }
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = el('p');
    p.append(inline(para.join(' ')));
    out.push(p);
    para = [];
  };
  for (const raw of text.split('\n')) {
    const h = raw.match(/^(#{1,3}) (.*)/);
    if (h) {
      flushPara();
      stack.length = 0;
      const n = el('h' + h[1].length);
      n.append(inline(h[2]));
      out.push(n);
      continue;
    }
    const li = raw.match(/^( *)- (.*)/);
    if (li) {
      flushPara();
      const indent = li[1].length;
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        const ul = el('ul');
        if (stack.length) stack[stack.length - 1].ul.lastElementChild.append(ul); else out.push(ul);
        stack.push({ ul, indent });
      }
      const item = el('li');
      item.append(inline(li[2]));
      stack[stack.length - 1].ul.append(item);
      continue;
    }
    if (!raw.trim()) { flushPara(); stack.length = 0; continue; }
    if (stack.length && /^\s/.test(raw)) { stack[stack.length - 1].ul.lastElementChild.append(' ', inline(raw.trim())); continue; }
    stack.length = 0;
    para.push(raw.trim());
  }
  flushPara();
  return out;
}

async function loadGuide() {
  if (helpData) return;
  $('helpGuide').replaceChildren(el('p', { className: 'help', textContent: T('Memuat panduan…', 'Loading the guide…') }));
  try {
    helpData = await api('help');
    $('helpGuide').replaceChildren(...renderMd(helpData.text));
  } catch (e) {
    helpData = null;
    $('helpGuide').replaceChildren(el('p', { className: 'load-err', textContent: e.message }));
  }
}

function helpTab(which) {
  for (const b of document.querySelectorAll('.help-tabs [role=tab]')) {
    const on = b.dataset.tab === which;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('helpChat').hidden = which !== 'ask';
  $('helpForm').hidden = which !== 'ask';
  $('helpGuide').hidden = which !== 'guide';
  if (which === 'guide') void loadGuide();
  else $('helpText').focus();
}

function openHelp() {
  closeTry();
  $('help').classList.add('on');
  $('helpBg').classList.add('on');
  $('help').setAttribute('aria-hidden', 'false');
  if (!$('helpChat').childElementCount) helpIntro();
  setTimeout(() => { if (!$('helpForm').hidden) $('helpText').focus(); }, 50);
}
function closeHelp() {
  $('help').classList.remove('on');
  $('helpBg').classList.remove('on');
  $('help').setAttribute('aria-hidden', 'true');
}
$('helpFab').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('helpBg').addEventListener('click', closeHelp);
$('helpForm').addEventListener('submit', (e) => { e.preventDefault(); void askHelp($('helpText').value); });
document.querySelector('.help-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[role=tab]');
  if (b) helpTab(b.dataset.tab);
});

// ---------- pencarian cepat (QuickSwitch) ----------
// Satu kotak cari untuk seluruh dashboard: halaman dan bagiannya, percakapan, produk, proyek, dan beberapa
// aksi. Dibuka dengan tombol Cari di bilah atas, Ctrl+K / ⌘K, atau "/" selama tidak sedang mengetik.
// Semua dicari di peramban dari data yang sudah dimuat; daftar percakapan dimuat saat kotak dibuka kalau belum ada.

const QS_PAGES = ['beranda', 'percakapan', 'pesanan', 'behavior', 'produk', 'brosur', 'pengaturan', 'whatsapp', 'notifikasi', 'marketplace', 'lanjutan'];
/** Urutan kelompok hasil, dan berapa hasil paling banyak per kelompok. */
const QS_GROUPS = [
  ['page', () => T('Halaman', 'Pages'), 11], ['chat', () => T('Percakapan', 'Conversations'), 8],
  ['product', () => T('Produk', 'Products'), 6], ['project', () => T('Proyek', 'Projects'), 5], ['action', () => T('Aksi', 'Actions'), 5],
];
$('qsKey').textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

/** Kata lain yang biasa diketik orang untuk satu halaman (mis. "wa" untuk WhatsApp). */
const QS_KEYS = {
  beranda: 'home dashboard ringkasan', percakapan: 'chat lead pelanggan customer', behavior: 'salam gaya aturan prompt pelajaran ajari',
  produk: 'katalog harga stok marketplace tokopedia shopee', brosur: 'pdf katalog', pengaturan: 'proyek follow-up',
  whatsapp: 'wa qr pairing tautkan nomor', notifikasi: 'penerima sales wa kabar', lanjutan: 'biaya llm error warning mode uji resi binderbyte saldo',
  marketplace: 'tokopedia tiktok shop toko tautkan pesanan', pesanan: 'order pesanan resi bayar tokopedia',
};
/** Huruf kecil tanpa aksen, untuk dicocokkan. */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Nomor dalam bentuk yang biasa diketik orang: +62812…, 62812…, dan 0812…. */
function phoneKeys(phone) {
  const d = String(phone).replace(/\D/g, '');
  return phone + ' ' + d + (d.startsWith('62') ? ' 0' + d.slice(2) : '');
}
/** Ikon menu samping untuk satu halaman. */
const navIcon = (pg) => {
  const u = document.querySelector('#nav [data-nav="' + pg + '"] use');
  return u ? u.getAttribute('href').replace('#i-', '') : 'file-text';
};

/** Semua yang bisa dicari sekarang: { group, icon, label, sub, hay, run, stage? }. */
function qsItems() {
  const items = [];
  const add = (x) => items.push({ ...x, hay: fold([x.label, x.sub, x.keys].join(' ')), words: fold([x.label, x.keys].join(' ')).split(/[^a-z0-9+]+/) });
  for (const pg of QS_PAGES) {
    const [group, title] = PAGES[pg]();
    const icon = navIcon(pg);
    add({ group: 'page', icon, label: title, sub: group, keys: QS_KEYS[pg], run: () => go(pathOf(pg)) });
    const sec = document.querySelector('section[data-page="' + pg + '"]');
    for (const s of sec ? sectionsOf(sec, false) : []) {
      add({ group: 'page', icon, label: s.label, sub: [group, title].filter(Boolean).join(' › '), section: true, run: () => go(pathOf(pg) + '#' + s.node.id) });
    }
  }
  for (const c of (leadData && leadData.rows) || []) {
    const name = nameOf(c);
    add({
      group: 'chat', icon: 'message-circle', label: name || c.phone, sub: [name ? c.phone : '', ...Object.values(c.lead || {}).filter((v) => v !== name)].filter(Boolean).join(' · '),
      keys: [phoneKeys(c.phone), c.waName, c.note].join(' '), stage: c.stage || 'baru', run: () => go(convPath(c.phone)),
    });
  }
  ((profile && profile.products) || []).forEach((p, i) => {
    if (!p.name) return;
    add({ group: 'product', icon: 'package', label: p.name, sub: p.description, run: () => go(pathOf('produk')).then(() => focusProduct(i, 0)) });
  });
  if (projects.length > 1) {
    for (const p of projects) {
      if (p.id === project) continue;
      add({ group: 'project', icon: 'layers', label: p.name, sub: T('Pindah ke proyek ', 'Switch to project ') + p.id, keys: p.id,
        run: () => go(pathOf(ROUTES[page] !== undefined ? page : 'beranda', p.id)) });
    }
  }
  add({ group: 'action', icon: theme === 'dark' ? 'sun' : 'moon', label: theme === 'dark' ? T('Mode terang', 'Light mode') : T('Mode gelap', 'Dark mode'),
    keys: 'tema theme gelap terang dark light', run: () => $('theme').click() });
  add({ group: 'action', icon: 'globe', label: lang === 'en' ? 'Bahasa Indonesia' : 'English', keys: 'bahasa language',
    run: () => $('lang').querySelector('[data-lang="' + (lang === 'en' ? 'id' : 'en') + '"]').click() });
  add({ group: 'action', icon: 'message-square', label: T('Coba chat', 'Try chat'), sub: T('Uji jawaban bot', 'Test the bot\'s answers'),
    run: () => (KNOWLEDGE.includes(page) ? Promise.resolve() : go(pathOf('behavior'))).then(openTry) });
  add({ group: 'action', icon: 'help-circle', label: T('Bantuan', 'Help'), sub: T('Tanya cara pakai dashboard', 'Ask how the dashboard works'), keys: 'help bantuan panduan tanya cara', run: openHelp });
  add({ group: 'action', icon: 'log-out', label: T('Keluar', 'Sign out'), keys: 'logout', run: () => $('logout').click() });
  return items;
}

/** Hasil untuk teks ini: per kelompok, yang paling cocok dulu. Tanpa teks: halaman utama dan aksi. */
function qsFilter(items, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const scored = [];
  for (const x of items) {
    if (!words.length) {
      if (!x.section && (x.group === 'page' || x.group === 'action')) scored.push({ x, score: 0 });
      continue;
    }
    if (!words.every((w) => x.hay.includes(w))) continue;
    const label = fold(x.label);
    const all = words.join(' ');
    // Judul yang diawali teksnya > kata di judul (atau kata lainnya) yang diawali kata pertama > ada di judul > hanya di keterangan.
    const score = label.startsWith(all) ? 4 : x.words.some((t) => t.startsWith(words[0])) ? 3 : label.includes(words[0]) ? 2 : 1;
    scored.push({ x, score: score - (x.section ? 0.5 : 0) });
  }
  const out = [];
  for (const [g, , max] of QS_GROUPS) {
    out.push(...scored.filter((r) => r.x.group === g).sort((a, b) => b.score - a.score).slice(0, max).map((r) => r.x));
  }
  return out;
}

let qsAll = [];
let qsShown = [];
let qsActive = 0;
let qsReturn = null;

function renderQs() {
  qsShown = qsFilter(qsAll, $('qsInput').value);
  qsActive = Math.min(qsActive, Math.max(0, qsShown.length - 1));
  const list = $('qsList');
  if (!qsShown.length) {
    list.replaceChildren(el('div', { className: 'qs-empty', textContent: T('Tidak ada hasil. Coba kata lain.', 'Nothing matches.') }));
    $('qsInput').removeAttribute('aria-activedescendant');
    return;
  }
  const kids = [];
  let group = '';
  qsShown.forEach((x, i) => {
    if (x.group !== group) {
      group = x.group;
      kids.push(el('div', { className: 'qs-h', role: 'presentation', textContent: QS_GROUPS.find((g) => g[0] === group)[1]() }));
    }
    const o = el('div', { className: 'qs-o' + (i === qsActive ? ' on' : ''), id: 'qs-o-' + i, role: 'option' },
      ico(x.icon), el('div', { className: 'qs-t' }, el('span', { className: 'qs-l', textContent: x.label }), x.sub ? el('span', { className: 'qs-s', textContent: x.sub }) : null),
      x.stage ? el('span', { className: 'qs-st ' + stageClass(x.stage), textContent: stageLabel(x.stage) }) : null);
    o.setAttribute('aria-selected', String(i === qsActive));
    o.addEventListener('mousemove', () => { if (qsActive !== i) { qsActive = i; markQs(); } });
    o.addEventListener('click', () => runQs(i));
    kids.push(o);
  });
  list.replaceChildren(...kids);
  markQs();
}

function markQs() {
  for (const o of $('qsList').querySelectorAll('.qs-o')) {
    const on = o.id === 'qs-o-' + qsActive;
    o.classList.toggle('on', on);
    o.setAttribute('aria-selected', String(on));
    if (on) o.scrollIntoView({ block: 'nearest' });
  }
  $('qsInput').setAttribute('aria-activedescendant', 'qs-o-' + qsActive);
}

function openQs() {
  if (!project || $('app').hidden || !$('qs').hidden) return;
  qsReturn = document.activeElement;
  $('qsPanel').setAttribute('aria-label', T('Cari', 'Search'));
  $('qsList').setAttribute('aria-label', T('Hasil', 'Results'));
  $('qsInput').placeholder = T('Cari halaman, pelanggan, produk, pengaturan…', 'Search pages, customers, products, settings…');
  $('qsFoot').replaceChildren(
    el('span', {}, el('kbd', { textContent: '↑' }), el('kbd', { textContent: '↓' }), ' ' + T('pilih', 'move')),
    el('span', {}, el('kbd', { textContent: 'Enter' }), ' ' + T('buka', 'open')),
    el('span', {}, el('kbd', { textContent: 'Esc' }), ' ' + T('tutup', 'close')));
  $('qsInput').value = '';
  qsActive = 0;
  qsAll = qsItems();
  $('qs').hidden = false;
  renderQs();
  $('qsInput').focus();
  // Daftar percakapan belum pernah dimuat di proyek ini: muat sekarang, lalu cari ulang.
  if (!leadData) {
    void loadLeads().then(() => {
      if ($('qs').hidden) return;
      qsAll = qsItems();
      renderQs();
    });
  }
}

function closeQs() {
  if ($('qs').hidden) return;
  $('qs').hidden = true;
  if (qsReturn && document.contains(qsReturn)) qsReturn.focus();
  qsReturn = null;
}

function runQs(i) {
  const x = qsShown[i];
  if (!x) return;
  closeQs();
  void Promise.resolve(x.run()).catch((e) => toast(e.message, true));
}

$('qsOpen').addEventListener('click', openQs);
$('qsBg').addEventListener('click', closeQs);
$('qsInput').addEventListener('input', () => { qsActive = 0; renderQs(); });
$('qsInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!qsShown.length) return;
    qsActive = (qsActive + (e.key === 'ArrowDown' ? 1 : -1) + qsShown.length) % qsShown.length;
    markQs();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runQs(qsActive);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeQs();
  } else if (e.key === 'Tab') {
    e.preventDefault(); // fokus tetap di kotak cari selama terbuka
  }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('qs').hidden) openQs(); else closeQs();
    return;
  }
  // "/" membuka pencarian hanya kalau tidak sedang mengetik dan tidak ada dialog lain yang terbuka.
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector('.modal.on, #uji.on')) {
    e.preventDefault();
    openQs();
  }
});

// ---------- penjelasan singkat (tooltip) ----------
// Satu kotak untuk semua: tampil saat elemennya disorot tetikus atau difokus papan ketik, hilang saat
// tetikus pergi, diklik, digulung, atau Esc. Isinya juga dibacakan pembaca layar (aria-describedby).
const hintBox = el('div', { className: 'hint', id: 'hint', role: 'tooltip', hidden: true });
document.body.append(hintBox);
/** Elemen yang penjelasannya sedang tampil. */
let hintFor = null;
const hideHint = () => { hintBox.hidden = true; hintFor = null; };
/** Pasang penjelasan singkat di elemen ini; mengembalikan elemennya. */
function hint(node, text) {
  if (!text) return node;
  node.setAttribute('aria-describedby', 'hint');
  const show = () => {
    hintFor = node;
    hintBox.textContent = text;
    hintBox.hidden = false;
    const r = node.getBoundingClientRect();
    const w = hintBox.offsetWidth;
    const h = hintBox.offsetHeight;
    // Di bawah elemennya, atau di atas kalau tidak muat; tidak keluar dari layar di kiri dan kanan.
    const below = r.bottom + 8 + h <= window.innerHeight;
    hintBox.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + 'px';
    hintBox.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8)) + 'px';
  };
  node.addEventListener('mouseenter', show);
  node.addEventListener('focus', show);
  for (const ev of ['mouseleave', 'blur', 'click']) node.addEventListener(ev, hideHint);
  return node;
}
window.addEventListener('scroll', hideHint, { passive: true });
// Elemennya digambar ulang selagi penjelasannya tampil (mis. daftar dimuat ulang): mouseleave tidak datang lagi.
document.addEventListener('pointermove', () => { if (hintFor && !hintFor.isConnected) hideHint(); }, { passive: true });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHint(); });

// ---------- bantu tampilan ----------
const when = (at) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
const clock = (at) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dayLabel = (at) => new Date(at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const int = (n) => Math.round(n).toLocaleString(locale());
const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const idr = (n) => 'Rp' + n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 1 : 0 });
const pct = (a, b) => (b ? Math.round((a * 100) / b) + '%' : '-');
const emptyRow = (cols, text) => el('tr', {}, el('td', { colSpan: cols, style: 'color:var(--muted)', textContent: text }));
/** Pesan error di dalam satu kartu (data kartu itu gagal dimuat); kartu lain tetap tampil. */
const loadError = (msg) => T('Gagal memuat: ', 'Failed to load: ') + msg;
const errorNote = (msg) => el('p', { className: 'help load-err', textContent: loadError(msg) });
/** Pesan dari hasil Promise.allSettled yang gagal; '' kalau berhasil. */
const failure = (r) => (r.status === 'rejected' ? (r.reason && r.reason.message) || String(r.reason) : '');

// ---------- kerangka muat (skeleton) ----------
// Saat satu halaman dibuka, tiap wadah datanya langsung diisi kerangka abu-abu seukuran isi akhirnya
// (digambar tanpa menunggu server), lalu ditukar dengan isinya sekali saja setelah SEMUA permintaan
// halaman itu selesai (Promise.allSettled). Jadi kartu tidak melompat satu per satu saat data datang.
// Kotak angka memakai kerangka teks (skelText): teks contoh yang sama panjang, jadi baris yang membungkus
// sama dengan isi akhirnya. Animasi kilau ada di app.css dan mati kalau pengguna memilih gerak dikurangi.
/** Tinggi grafik batang (SVG di columnChart); kerangka grafik memakai tinggi yang sama. */
const CHART_H = 190;
/** Teks contoh berbentuk balok abu-abu (huruf tidak terlihat), selebar dan sebaris teks aslinya. */
function skelText(sample) {
  const n = el('span', { className: 'skel-text', textContent: sample });
  n.setAttribute('aria-hidden', 'true');
  return n;
}
/**
 * Kerangka sejenis, sebanyak n:
 * - 'chart': balok setinggi grafik batang;
 * - 'row': baris tabel 40 px (satu sel selebar tabel);
 * - 'qrow': baris pertanyaan 48 px.
 */
function skeleton(kind, n = 1) {
  const bar = (width, height) => {
    const b = el('span', { className: 'skel' });
    b.setAttribute('aria-hidden', 'true');
    b.style.width = width;
    if (height) b.style.height = height;
    return b;
  };
  const widths = ['92%', '78%', '64%'];
  return Array.from({ length: n }, (_, i) => {
    if (kind === 'chart') return bar('100%', CHART_H + 'px');
    if (kind === 'row') return el('tr', { className: 'skel-row' }, el('td', { colSpan: 12 }, bar(widths[i % 3])));
    if (kind === 'qrow') return el('div', { className: 'skel-qrow' }, bar(widths[(i + 1) % 3]), bar('88px'));
    throw new Error('kerangka tidak dikenal: ' + kind);
  });
}
/** Tandai wadah sedang dimuat (aria-busy), supaya pembaca layar tidak membacakan kerangkanya. */
function busy(ids, on) {
  for (const id of ids) $(id).setAttribute('aria-busy', String(on));
}

// ---------- grafik ----------
// Grafik sebagai SVG polos yang digambar di sini (dashboard tanpa pustaka grafik).
// Semua grafik memakai columnChart (batang per hari, tunggal atau bertumpuk), supaya
// tampilan dan perilakunya sama:
// - seri N selalu berwarna --viz-N (urutan tetap, tidak diputar atau diurutkan ulang);
// - teks memakai warna teks; identitas seri hanya dari kotak warna di sampingnya;
// - legenda hanya kalau ada 2 seri atau lebih;
// - tiap batang bisa disorot dengan tetikus dan papan ketik (satu tooltip per grafik);
// - tombol "Tabel" menukar grafik dengan tabel angkanya: tidak ada angka yang hanya ada di tooltip.
const SVG_NS = 'http://www.w3.org/2000/svg';
const COL_MAX = 24; // batang paling tebal
const GAP = 2; // celah antarsegmen bertumpuk, dalam warna permukaan kartu
const RADIUS = 4; // sudut atas batang (alasnya tetap persegi)

function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
}

/** Tanggal "YYYY-MM-DD" (hari menurut zona waktu bot) -> Date tengah hari, aman dari geser zona waktu. */
const dayDate = (d) => new Date(d + 'T12:00:00');
const dayShort = (d) => dayDate(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const dayLong = (d) => dayDate(d).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });

let measureCtx = null;
/** Lebar teks dalam piksel dengan huruf dashboard; dipakai supaya label tidak bertumpuk atau terpotong. */
function textWidth(text, font = '11px') {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return String(text).length * 7;
  measureCtx.font = font + ' ' + getComputedStyle(document.body).fontFamily;
  return measureCtx.measureText(String(text)).width;
}

/** Garis bantu sumbu y di angka bulat (1, 2, atau 5 × 10ⁿ), 3–4 garis termasuk garis dasar. */
function niceTicks(max) {
  const raw = Math.max(1, max) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw));
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/** Jalur persegi dengan sudut membulat sendiri-sendiri: [kiri-atas, kanan-atas, kanan-bawah, kiri-bawah]. */
function roundRect(x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, w / 2, h / 2)));
  const a = (r, ex, ey) => (r ? 'A' + r + ',' + r + ' 0 0 1 ' + ex + ',' + ey : '');
  return 'M' + (x + tl) + ',' + y + 'H' + (x + w - tr) + a(tr, x + w, y + tr) + 'V' + (y + h - br) + a(br, x + w - br, y + h) +
    'H' + (x + bl) + a(bl, x, y + h - bl) + 'V' + (y + tl) + a(tl, x + tl, y) + 'Z';
}

/** Gambar ulang setiap kali lebar wadahnya berubah (layar diputar, panel dibuka, tabel ditutup). */
function onWidth(node, draw) {
  let last = -1;
  const run = () => {
    const w = Math.floor(node.clientWidth);
    if (w > 0 && w !== last) { last = w; draw(w); }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(run).observe(node);
  run();
}

const swatch = (slot) => el('span', { className: 'sw viz' + slot });

/**
 * Kerangka kartu grafik: judul, keterangan, tombol "Tabel", lalu grafik (dengan legenda) atau tabelnya.
 * Pilihan grafik/tabel disimpan di kartu, jadi tetap saat kartu digambar ulang (mis. ganti bahasa).
 */
function chartFrame(host, title, help) {
  host.classList.add('card', 'chart-card');
  const asTable = host.dataset.view === 'table';
  const view = el('div', { hidden: asTable });
  const plot = el('div', { className: 'plot' });
  const tip = el('div', { className: 'tip', hidden: true });
  tip.setAttribute('aria-hidden', 'true');
  plot.append(tip);
  view.append(plot);
  const table = el('div', { className: 'scroll', hidden: !asTable });
  const toggle = el('button', { type: 'button', className: 'btn ghost sm tbl-toggle' }, ico('list'), T('Tabel', 'Table'));
  toggle.setAttribute('aria-pressed', String(asTable));
  toggle.title = T('Tampilkan angkanya sebagai tabel', 'Show the numbers as a table');
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    host.dataset.view = on ? 'table' : 'chart';
    toggle.setAttribute('aria-pressed', String(on));
    view.hidden = on;
    table.hidden = !on;
  });
  host.replaceChildren(
    el('div', { className: 'ch' }, el('div', {}, el('h2', { textContent: title }), help ? el('p', { className: 'help', textContent: help }) : null), toggle),
    el('div', { className: 'cb' }, view, table));
  return { view, plot, tip, table };
}

/** Isi tooltip: judul, lalu satu baris per seri (angka dulu, lalu nama, dengan kotak warna). */
function fillTip(tip, head, rows, sum) {
  tip.replaceChildren(el('div', { className: 't', textContent: head }),
    ...rows.map((r) => el('div', { className: 'r' + (r.cur ? ' cur' : '') }, swatch(r.slot), el('b', { textContent: r.value }), el('span', { textContent: r.label }))),
    sum ? el('div', { className: 'r sum' }, el('b', { textContent: sum.value }), el('span', { textContent: sum.label })) : null);
  tip.hidden = false;
}

/** Letakkan tooltip di samping tanda yang disorot (kanan, atau kiri kalau tidak muat), tidak menutupinya. */
function placeTip(tip, plotWidth, x0, x1, top) {
  const tw = tip.offsetWidth;
  let left = x1 + 8;
  if (left + tw > plotWidth) left = x0 - 8 - tw;
  if (left < 0) left = Math.max(0, Math.min(plotWidth - tw, x1 + 8));
  tip.style.left = Math.round(left) + 'px';
  tip.style.top = Math.round(top) + 'px';
}

/** Legenda: kotak warna + nama seri. */
function legend(items) {
  return el('div', { className: 'legend' }, ...items.map((it) => el('div', {}, swatch(it.slot), el('span', { textContent: it.label }))));
}

/** Teks label sumbu x: di tengah batangnya, tapi digeser masuk kalau akan terpotong di tepi. */
function edgeText(x, y, text, w, width, cls) {
  let anchor = 'middle';
  if (x + w / 2 > width) { anchor = 'end'; x = width; } else if (x - w / 2 < 0) { anchor = 'start'; x = 0; }
  return svg('text', { x, y, 'text-anchor': anchor, class: cls || null }, text);
}

/**
 * Grafik batang per hari.
 * days: [{ day: "YYYY-MM-DD", [key]: angka }] terlama dulu (paling kiri).
 * series: [{ key, label, slot }] dengan slot 1–4 = --viz-1…4. Tanpa stacked hanya seri pertama yang dipakai.
 * format: angka -> teks untuk sumbu, label, tooltip, dan tabel (bawaan: bilangan bulat dengan pemisah ribuan).
 */
function columnChart({ el: host, title, help, days, series, stacked = false, format = int, error = '' }) {
  const ser = stacked ? series : series.slice(0, 1);
  // Belum ada data (days null): judul, keterangan, dan legenda asli, grafiknya diganti kerangka setinggi grafik.
  // Data gagal dimuat: pesan error di tempat grafiknya.
  if (!days || error) {
    const { view, plot, table } = chartFrame(host, title, help);
    if (ser.length >= 2) view.append(legend(ser.map((s) => ({ slot: s.slot, label: s.label }))));
    plot.replaceChildren(...(error ? [errorNote(error)] : skeleton('chart')));
    table.replaceChildren(...(error ? [errorNote(error)] : skeleton('chart')));
    return;
  }
  const val = (d, s) => Number(d[s.key]) || 0;
  const totalOf = (d) => ser.reduce((a, s) => a + val(d, s), 0);
  const peak = Math.max(0, ...days.map(totalOf));
  const { view, plot, tip, table } = chartFrame(host, title, help);
  if (ser.length >= 2) view.append(legend(ser.map((s) => ({ slot: s.slot, label: s.label }))));

  // Tampilan tabel: semua angka, hari terbaru di atas.
  const showSum = ser.length >= 2;
  const th = (t, num) => el('th', { className: num ? 'num' : '', textContent: t });
  const td = (t, num) => el('td', { className: num ? 'num' : '', textContent: t });
  table.append(el('table', { className: 'list' },
    el('thead', {}, el('tr', {}, th(T('Tanggal', 'Date')), ...ser.map((s) => th(s.label, true)), showSum ? th('Total', true) : null)),
    el('tbody', {}, ...days.slice().reverse().map((d) => el('tr', {}, td(dayLong(d.day)), ...ser.map((s) => td(format(val(d, s)), true)), showSum ? td(format(totalOf(d)), true) : null))),
    el('tfoot', {}, el('tr', {}, td(T('Jumlah', 'Sum')), ...ser.map((s) => td(format(days.reduce((a, d) => a + val(d, s), 0)), true)),
      showSum ? td(format(days.reduce((a, d) => a + totalOf(d), 0)), true) : null))));

  const draw = (W) => {
    const H = CHART_H, mt = 20, mb = 24, mr = 2;
    const { top, ticks } = niceTicks(peak);
    const empty = peak === 0;
    const left = empty ? 0 : Math.ceil(Math.max(...ticks.map((v) => textWidth(format(v))))) + 8;
    const pw = Math.max(10, W - left - mr), ph = H - mt - mb;
    const n = Math.max(1, days.length), band = pw / n;
    const cw = Math.max(2, Math.min(COL_MAX, band - Math.max(GAP, band * 0.3)));
    const y = (v) => mt + ph - (v / top) * ph;
    const root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': title });

    // Garis bantu tipis (garis dasar ikut), label sumbu y di kirinya.
    for (const v of empty ? [0] : ticks) {
      const gy = Math.round(y(v)) + 0.5;
      root.append(svg('line', { class: 'gridline', x1: left, x2: W - mr, y1: gy, y2: gy }));
      if (!empty) root.append(svg('text', { x: left - 6, y: gy + 4, 'text-anchor': 'end' }, format(v)));
    }
    // Label tanggal: tiap label punya ruang paling sedikit 44 px (atau selebar teksnya + 10 px),
    // jadi hanya tiap hari ke-k yang berlabel. Hari pertama dan terakhir selalu berlabel;
    // label di tepi digeser masuk (rata kiri / rata kanan) supaya tidak terpotong.
    const LABEL_ROOM = 44, LABEL_GAP = 12;
    const lw = Math.max(LABEL_ROOM, ...days.map((d) => textWidth(dayShort(d.day)) + 10));
    const k = Math.max(1, Math.ceil(lw / band));
    const last = days.length - 1;
    const labels = [];
    days.forEach((d, i) => {
      if (i % k && i !== last) return;
      const t = dayShort(d.day), w = textWidth(t), cx = left + band * (i + 0.5);
      // Di tengah batangnya; digeser masuk (rata kiri/kanan) hanya kalau akan keluar dari tepi.
      let x0 = cx - w / 2, anchor = 'middle', ax = cx;
      if (x0 + w > W) { x0 = W - w; anchor = 'end'; ax = W; }
      if (x0 < 0) { x0 = 0; anchor = 'start'; ax = 0; }
      const lab = { t, x0, x1: x0 + w, anchor, ax };
      // Kalau bertabrakan dengan label sebelumnya: buang yang sebelumnya bila ini hari terakhir, kalau tidak buang yang ini.
      while (labels.length && lab.x0 < labels[labels.length - 1].x1 + LABEL_GAP) {
        if (i !== last) return;
        labels.pop();
      }
      labels.push(lab);
    });
    for (const lab of labels) root.append(svg('text', { x: lab.ax, y: H - 6, 'text-anchor': lab.anchor }, lab.t));
    if (empty) {
      root.append(svg('text', { class: 'empty', x: left + pw / 2, y: mt + ph / 2, 'text-anchor': 'middle' }, T('Belum ada data', 'No data yet')));
      plot.replaceChildren(root, tip);
      tip.hidden = true;
      return;
    }

    // Batang: segmen dari bawah ke atas, celah 2 px di antaranya, hanya ujung atas yang membulat.
    const cols = days.map((d, i) => {
      const cx = left + band * (i + 0.5), x0 = cx - cw / 2;
      const g = svg('g', { class: 'mark' });
      const parts = ser.filter((s) => val(d, s) > 0);
      let base = 0;
      parts.forEach((s, j) => {
        const v = val(d, s);
        const y1 = y(base + v);
        let h = y(base) - y1 - (j > 0 ? GAP : 0);
        h = Math.max(1, h);
        const r = j === parts.length - 1 ? RADIUS : 0;
        g.append(svg('path', { class: 'viz' + s.slot, d: roundRect(x0, y1, cw, h, [r, r, 0, 0]) }));
        base += v;
      });
      root.append(g);
      return g;
    });
    // Label langsung hanya di batang tertinggi (yang terakhir kalau sama tinggi).
    let hi = 0;
    days.forEach((d, i) => { if (totalOf(d) >= totalOf(days[hi])) hi = i; });
    const ht = format(totalOf(days[hi]));
    root.append(edgeText(left + band * (hi + 0.5), y(totalOf(days[hi])) - 6, ht, textWidth(ht), W, 'total'));

    // Lapisan sorot: satu sasaran selebar pita per hari, juga untuk papan ketik.
    const hide = () => { tip.hidden = true; for (const g of cols) g.classList.remove('hot'); };
    days.forEach((d, i) => {
      const cx = left + band * (i + 0.5);
      const rows = ser.map((s) => ({ slot: s.slot, value: format(val(d, s)), label: s.label }));
      const sum = showSum ? { value: format(totalOf(d)), label: 'Total' } : null;
      const hit = svg('rect', { class: 'hit', x: left + band * i, y: mt, width: band, height: ph, tabindex: 0,
        'aria-label': dayLong(d.day) + ': ' + rows.map((r) => r.label + ' ' + r.value).join(', ') + (sum ? ', Total ' + sum.value : '') });
      const show = () => {
        hide();
        cols[i].classList.add('hot');
        fillTip(tip, dayLong(d.day), rows, sum);
        placeTip(tip, W, cx - cw / 2, cx + cw / 2, mt);
      };
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('click', show);
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
      root.append(hit);
    });
    plot.replaceChildren(root, tip);
    tip.hidden = true;
  };
  onWidth(plot, draw);
}

const STAGES = ['baru', 'menunggu', 'dihubungi', 'link', 'payment', 'dikirim', 'selesai', 'batal'];
const stageLabel = (s) => ({ baru: T('Baru', 'New'), menunggu: T('Menunggu tim', 'Waiting for team'), dihubungi: T('Dihubungi', 'Contacted'), link: T('Link terkirim', 'Link sent'), payment: T('Pembayaran', 'Payment'), dikirim: T('Barang terkirim', 'Shipped'), selesai: T('Pesanan selesai', 'Order complete'), batal: T('Batal', 'Cancelled') })[s] || s;
/**
 * Warna tiap tahap: satu sumber untuk chip Beranda, saringan Percakapan, dan pilihan tahap.
 * Kelasnya ada di app.css (.stage-baru …) dan mengisi --st-bg / --st-fg untuk tema terang dan gelap:
 * baru biru, menunggu tim kuning, dihubungi oranye, link ungu, pembayaran hijau toska, barang terkirim merah muda,
 * pesanan selesai hijau, batal abu-abu.
 */
const STAGE_COLOR = { baru: 'stage-baru', menunggu: 'stage-menunggu', dihubungi: 'stage-dihubungi', link: 'stage-link', payment: 'stage-payment', dikirim: 'stage-dikirim', selesai: 'stage-selesai', batal: 'stage-batal' };
const stageClass = (s) => STAGE_COLOR[s] || STAGE_COLOR.baru;
/** Pilihan tahap berwarna sesuai tahap yang terpilih. */
function paintStage(sel) {
  sel.classList.remove(...Object.values(STAGE_COLOR));
  sel.classList.add('stagesel', stageClass(sel.value));
}
function stageSelect(value, onChange) {
  const sel = el('select', {}, ...STAGES.map((s) => el('option', { value: s, textContent: stageLabel(s) })));
  sel.value = value || 'baru';
  paintStage(sel);
  sel.setAttribute('aria-label', T('Tahap', 'Stage'));
  sel.addEventListener('change', () => { paintStage(sel); onChange(sel.value, sel); });
  return sel;
}
/** Simpan tahap pipeline satu pelanggan. */
async function putStage(phone, stage) {
  const r = await api('leads/' + encodeURIComponent(phone), { method: 'PUT', body: JSON.stringify({ stage }) });
  if (leadData) for (const c of leadData.rows) if (c.phone === phone) c.stage = r.stage;
  toast(T('Tahap diubah ke ', 'Stage changed to ') + stageLabel(r.stage) + '.');
  return r;
}

/**
 * Sebutan isian lead sebagai judul (kolom, CSV, label di halaman chat): huruf pertamanya besar. Sebutannya
 * sendiri tetap huruf kecil, karena bot memakainya di tengah kalimat ("boleh diinfokan kota/alamat").
 */
const sentenceCase = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** Nama pelanggan: isian "nama" dari bot, lalu nama profil WhatsApp-nya. */
function nameOf(c) {
  const key = profile && (profile.leadFields.find((f) => f.isName) || {}).key;
  return (key && c.lead && c.lead[key]) || c.waName || '';
}

// ---------- lead / percakapan ----------
let leadData = null;
let leadFilter = 'semua';
/** Halaman Percakapan baru dibuka dan daftarnya belum datang: tabel berisi kerangka. */
let leadsPending = false;
/** Pesan error muat daftar terakhir ('' = berhasil). */
let leadError = '';

async function loadLeads() {
  const pid = project;
  try {
    const r = await api('leads');
    if (pid !== project) return;
    leadData = r;
    leadError = '';
  } catch (e) {
    if (pid !== project) return;
    leadError = e.message;
    toast(e.message, true);
  }
  leadsPending = false;
  renderLeads();
  setBadge();
}

const FILTERS = () => [
  ['semua', T('Semua', 'All')], ['baru', stageLabel('baru')], ['menunggu', stageLabel('menunggu')], ['dihubungi', stageLabel('dihubungi')], ['link', stageLabel('link')],
  ['payment', stageLabel('payment')], ['dikirim', stageLabel('dikirim')], ['selesai', stageLabel('selesai')], ['batal', stageLabel('batal')], ['staf', T('Perlu staf', 'Needs staff')],
];
/** Arti tiap saringan (tooltip di saringan Percakapan dan chip tahap di Beranda). */
const FILTER_HELP = () => ({
  semua: T('Semua pelanggan yang pernah chat.', 'Every customer who has chatted.'),
  baru: T('Belum ada staf yang ikut membalas. Bot masih melayani sendiri.', 'No staff member has stepped in. The bot handles the chat alone.'),
  menunggu: T('Bot sudah meneruskan percakapan ini ke tim, dan belum ada staf yang membalas. Tahapnya pindah ke Dihubungi saat staf membalas atau menandainya sudah ditangani.',
    'The bot passed this chat to the team, and no staff member has replied yet. It moves to Contacted when staff reply or mark it as handled.'),
  dihubungi: T('Staf sudah membalas pelanggan ini, dari HP atau dari dashboard.', 'A staff member has replied to this customer, from the phone or the web.'),
  link: T('Bot sudah mengirim link Tokopedia atau Shopee. Staf yang memindahkannya ke Pembayaran atau Batal, atau pesanan dari toko Tokopedia & Shop yang ditautkan.',
    'The bot sent a Tokopedia or Shopee link. Staff move it to Payment or Cancelled, or an order from the linked Tokopedia & Shop store does.'),
  payment: T('Pelanggan sedang membayar atau sudah membayar. Staf yang mengubah tahap ini, atau pesanan dari toko Tokopedia & Shop yang ditautkan.', 'The customer is paying or has paid. Staff set this, or an order from the linked Tokopedia & Shop store does.'),
  dikirim: T('Barangnya sudah dikirim ke pelanggan. Staf yang mengubah tahap ini, atau pelacakan resi dan pesanan dari toko Tokopedia & Shop yang ditautkan.', 'The goods are on the way to the customer. Staff set this, or tracking and orders from the linked Tokopedia & Shop store do.'),
  selesai: T('Pesanan selesai: pelanggan sudah menerima barangnya. Staf yang mengubah tahap ini, atau pelacakan resi dan pesanan dari toko Tokopedia & Shop yang ditautkan.', 'The order is complete: the customer received the goods. Staff set this, or tracking and orders from the linked Tokopedia & Shop store do.'),
  batal: T('Pelanggan tidak jadi membeli. Hanya staf yang mengubah tahap ini.', 'The customer did not buy. Only staff set this.'),
  staf: T('Ini bukan tahap. Bot meminta bantuan staf dan belum ada staf yang membalas, di tahap apa pun. Tanda ini hilang saat staf membalas, atau saat ditandai sudah ditangani (misalnya setelah pelanggan ditelepon).',
    'Not a stage. The bot asked staff for help and no staff member has replied yet, at any stage. It clears when staff reply, or when someone marks it as handled (for example after a phone call).'),
});
const matchFilter = (c, f) => f === 'semua' || (f === 'staf' ? c.needsSales : (c.stage || 'baru') === f);

// Urutan tabel Percakapan: kolom ('nama', 'tahap', 'f:<kunci isian>', 'status', 'bot', 'chat') dan arahnya.
// Diingat di peramban ini. Bawaan: chat terakhir, yang terbaru di atas.
let leadSort = { key: 'chat', dir: 'desc' };
try {
  const [key, dir] = (localStorage.getItem('leadSort') || '').split('|');
  if (key && (dir === 'asc' || dir === 'desc')) leadSort = { key, dir };
} catch { /* penyimpanan diblokir: urutan bawaan */ }

/** Nilai urut satu baris untuk satu kolom. null = kosong, selalu di bawah apa pun arahnya. */
function sortValue(c, key) {
  if (key === 'nama') return nameOf(c) || c.phone;
  if (key === 'tahap') return STAGES.indexOf(c.stage || 'baru');
  // Perlu staf paling penting, lalu data lengkap.
  if (key === 'status') return (c.needsSales ? 2 : 0) + (c.complete ? 1 : 0);
  if (key === 'bot') return botHeld(c.hold) ? 1 : 0;
  if (key === 'chat') return c.lastAt ? new Date(c.lastAt).getTime() : null;
  if (key.startsWith('f:')) return (c.lead && c.lead[key.slice(2)]) || null;
  return null;
}

function sortLeads(list) {
  const { key, dir } = leadSort;
  const sign = dir === 'asc' ? 1 : -1;
  const coll = new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' });
  // sort() stabil: baris dengan nilai sama tetap dalam urutan dari server (chat terakhir).
  return list.map((c) => [c, sortValue(c, key)]).sort(([, a], [, b]) => {
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return sign * (typeof a === 'string' ? coll.compare(a, b) : a - b);
  }).map(([c]) => c);
}

function visibleLeads() {
  const q = $('leadSearch').value.trim().toLowerCase();
  return sortLeads(leadData.rows.filter((c) => {
    if (!matchFilter(c, leadFilter)) return false;
    if (!q) return true;
    return [c.phone, c.summary || '', c.note || '', c.waName || '', ...Object.values(c.lead)].join(' ').toLowerCase().includes(q);
  }));
}

/**
 * Judul kolom yang bisa diurutkan: tombol di dalam th. Klik pertama memakai arah awal kolomnya
 * (first: 'desc' untuk waktu dan status, supaya yang terbaru atau terpenting di atas); klik berikutnya membalik arah.
 */
function sortHead(label, key, first = 'asc') {
  const on = leadSort.key === key;
  const b = el('button', { type: 'button', className: 'sorthd' + (on ? ' on' : '') }, label);
  if (on) b.append(ico(leadSort.dir === 'asc' ? 'arrow-up' : 'arrow-down'));
  b.addEventListener('click', () => {
    leadSort = { key, dir: on ? (leadSort.dir === 'asc' ? 'desc' : 'asc') : first };
    try { localStorage.setItem('leadSort', key + '|' + leadSort.dir); } catch { /* berlaku untuk kunjungan ini saja */ }
    renderLeads();
  });
  const th = el('th', {}, b);
  if (on) th.setAttribute('aria-sort', leadSort.dir === 'asc' ? 'ascending' : 'descending');
  return th;
}

/** Saringan; loading = jumlahnya belum diketahui (kerangka). Saringan tahap memakai warna tahapnya. */
function renderFilters(loading = false) {
  const rows = leadData ? leadData.rows : [];
  $('leadFilters').replaceChildren(...FILTERS().map(([k, label]) => {
    const stage = STAGE_COLOR[k];
    const count = loading ? skelText('00') : el('small', { textContent: String(rows.filter((c) => matchFilter(c, k)).length) });
    const b = el('button', { type: 'button', className: [k === leadFilter ? 'on' : '', stage || ''].join(' ').trim() },
      stage ? el('span', { className: 'dot' }) : null, label, count);
    if (stage) b.dataset.stage = k;
    b.setAttribute('aria-pressed', String(k === leadFilter));
    b.addEventListener('click', () => { leadFilter = k; renderLeads(); });
    hint(b, FILTER_HELP()[k]);
    return b;
  }));
}

/** Daftar belum ada: kerangka selama dimuat, pesan error kalau gagal. */
function renderLeadsPending() {
  const failed = !leadsPending && leadError;
  renderFilters(!failed);
  busy(['leads'], !failed);
  $('leadCount').replaceChildren(failed ? '' : skelText(T('00 dari 00 kontak', '00 of 00 contacts')));
  $('leads').replaceChildren(el('tbody', {}, ...(failed ? [emptyRow(1, loadError(leadError))] : skeleton('row', 3))));
}

/** Sel ringkasan: paling banyak 3 baris (CSS), teks lengkapnya di tooltip. */
function sumCell(text) {
  return el('td', { className: 'sum' }, el('div', { className: 'clamp', textContent: text || '-', title: text || '' }));
}

function renderLeads() {
  if (!profile) return;
  if (leadsPending || !leadData) return renderLeadsPending();
  busy(['leads'], false);
  const r = leadData;
  renderFilters();
  const nameKey = (profile.leadFields.find((f) => f.isName) || {}).key;
  const fields = r.fields.filter((f) => f.key !== nameKey);
  // Kolom yang dulu diurutkan bisa hilang (isian dihapus, proyek lain): kembali ke urutan bawaan.
  const keys = ['nama', 'tahap', ...fields.map((f) => 'f:' + f.key), 'status', 'bot', 'chat'];
  if (!keys.includes(leadSort.key)) leadSort = { key: 'chat', dir: 'desc' };
  const head = el('tr', {}, sortHead(T('Pelanggan', 'Customer'), 'nama'), sortHead(T('Tahap', 'Stage'), 'tahap'),
    ...fields.map((f) => sortHead(sentenceCase(f.label), 'f:' + f.key)),
    el('th', { textContent: T('Ringkasan percakapan', 'Conversation summary') }), sortHead('Status', 'status', 'desc'), sortHead(T('Bot menjawab', 'Bot replies'), 'bot'),
    sortHead(T('Chat terakhir', 'Last message'), 'chat', 'desc'));
  const list = visibleLeads();
  const rows = list.map((c) => {
    // Menunggu jam tenang = bot tetap aktif di chat ini, hanya balasannya tertunda.
    const box = el('input', { type: 'checkbox', checked: !c.hold || c.hold === 'tenang' });
    box.setAttribute('aria-label', T('Bot aktif di percakapan ini', 'Bot active in this chat'));
    box.addEventListener('change', async () => {
      if (box.checked && c.hold === 'berhenti' && !confirmOptOutResume()) {
        box.checked = false;
        return;
      }
      box.disabled = true;
      try {
        await api('leads/' + encodeURIComponent(c.phone) + '/bot', { method: 'POST', body: JSON.stringify({ mode: box.checked ? 'on' : 'off' }) });
        toast(box.checked ? T('Percakapan ini dikembalikan ke bot.', 'This chat is handed back to the bot.') : T('Bot dijeda di percakapan ini.', 'The bot is paused in this chat.'));
      } catch (e) { toast(e.message, true); }
      await loadLeads();
    });
    const why = holdLabel(c.hold);
    const stage = stageSelect(c.stage, async (v, sel) => {
      sel.disabled = true;
      try { await putStage(c.phone, v); renderFilters(); } catch (e) { toast(e.message, true); sel.value = c.stage || 'baru'; paintStage(sel); }
      sel.disabled = false;
    });
    const name = nameOf(c);
    const who = el('td', { className: 'who' }, el('a', { href: convPath(c.phone), className: name ? '' : 'phone', textContent: name || c.phone }),
      c.note ? el('span', { className: 'note-ico', textContent: ' ✎', title: c.note }) : null,
      name ? el('small', { className: 'phone', textContent: c.phone }) : null);
    const status = el('td', {}, el('div', { className: 'chiprow' },
      el('span', { className: 'chip ' + (c.complete ? 'ok' : ''), textContent: c.complete ? T('Lengkap', 'Complete') : T('Belum lengkap', 'Incomplete') }),
      c.needsSales ? el('span', { className: 'chip warn', textContent: T('Perlu staf', 'Needs staff') }) : null));
    // Kebutuhan berisi kalimat bebas: tampil seperti ringkasan (kecil, pudar, paling banyak 3 baris).
    const tr = el('tr', {}, who, el('td', {}, stage), ...fields.map((f) => (f.key === 'need' ? sumCell(c.lead[f.key]) : el('td', { textContent: c.lead[f.key] || '-' }))),
      sumCell(c.summary), status,
      el('td', {}, el('label', { className: 'switch' }, box, why ? el('span', { className: 'chip ' + (c.hold === 'berhenti' ? 'danger' : 'warn'), textContent: cap(why) }) : null)),
      el('td', { textContent: c.lastAt ? when(c.lastAt) : T('belum pernah chat', 'never chatted'), style: 'white-space:nowrap' }));
    // Klik di mana saja pada baris (selain kontrolnya) membuka percakapannya.
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, input, label, textarea')) return;
      void go(convPath(c.phone));
    });
    return tr;
  });
  const empty = r.rows.length ? T('Tidak ada yang cocok dengan pencarian atau saringan ini. Coba kata lain atau pilih Semua.', 'Nothing matches this search or filter.') : T('Belum ada percakapan. Percakapan muncul di sini setelah pelanggan chat ke nomor bot.', 'No conversations yet.');
  $('leads').replaceChildren(el('thead', {}, head), el('tbody', {}, ...(rows.length ? rows : [emptyRow(fields.length + 6, empty)])));
  $('leadCount').textContent = list.length + T(' dari ', ' of ') + r.rows.length + T(' kontak', ' contacts');
  $('knownCount').textContent = profile.knownCount
    ? profile.knownCount + T(' pelanggan lama terdaftar.', ' existing customers on file.')
    : T('Belum ada pelanggan lama yang diimpor.', 'No existing customers imported yet.');
}

$('leadSearch').addEventListener('input', renderLeads);

// Unduh yang sedang tampil sebagai CSV (bisa dibuka di Excel).
$('leadExport').addEventListener('click', () => {
  if (!leadData) return;
  const r = leadData;
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [[T('Nomor', 'Number'), ...r.fields.map((f) => sentenceCase(f.label)), T('Tahap', 'Stage'), T('Catatan', 'Note'), T('Ringkasan', 'Summary'), T('Lengkap', 'Complete'),
    T('Perlu staf', 'Needs staff'), T('Bot menjawab', 'Bot replies'), T('Chat terakhir', 'Last message')]];
  for (const c of visibleLeads()) {
    lines.push([c.phone, ...r.fields.map((f) => c.lead[f.key] || ''), stageLabel(c.stage || 'baru'), c.note || '', c.summary || '', c.complete ? T('ya', 'yes') : T('tidak', 'no'),
      c.needsSales ? T('ya', 'yes') : '', botHeld(c.hold) ? T('diam', 'off') : T('aktif', 'on'), c.lastAt ? new Date(c.lastAt).toLocaleString(locale()) : '']);
  }
  // BOM di depan supaya Excel membaca huruf dan emoji dengan benar.
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'lead-' + new Date().toLocaleDateString('en-CA') + '.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// Impor pelanggan lama (dialog): satu nomor per baris, boleh diikuti nama.
$('importOpen').addEventListener('click', () => { $('importDlg').classList.add('on'); $('knownText').focus(); });
$('importCancel').addEventListener('click', () => $('importDlg').classList.remove('on'));
$('importForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('knownText').value.trim();
  if (!text) return toast(T('Tempel dulu daftar nomornya.', 'Paste the list of numbers first.'), true);
  $('knownImport').disabled = true;
  try {
    const r = await api('known', { method: 'POST', body: JSON.stringify({ text, off: $('knownOff').checked }) });
    profile.knownCount = r.profile.knownCount;
    profile.knownAt = r.profile.knownAt;
    $('knownText').value = '';
    $('importDlg').classList.remove('on');
    toast(r.added + T(' nomor ditambahkan', ' numbers added') + (r.invalid ? ', ' + r.invalid + T(' baris dilewati (bukan nomor)', ' lines skipped (not a number)') : '') + '. ' + T('Total: ', 'Total: ') + r.total + '.');
    await loadLeads();
  } catch (err) { toast(err.message, true); }
  $('knownImport').disabled = false;
});

// ---------- Tokopedia & Shop: tautan toko dan halaman Pesanan ----------
/** Jawaban GET marketplace terakhir (tautan toko, alamat untuk Partner Center, jumlah pesanan); null = belum dimuat. */
let shopInfo = null;
let shopInfoError = '';
/** Pesanan di saringan dan pencarian sekarang; null = belum dimuat. */
let shopRows = null;
let shopRowsError = '';
let shopFilter = 'semua';
/** Nomor urut muat daftar: jawaban yang terlambat (saringan sudah berganti) dibuang. */
let shopSeq = 0;
let shopSearchTimer = null;

/** Saringan halaman Pesanan (id sama dengan server). */
const SHOP_FILTERS = () => [
  ['semua', T('Semua', 'All')], ['belum-bayar', T('Belum bayar', 'Unpaid')], ['perlu-kirim', T('Perlu dikirim', 'To ship')],
  ['dikirim', T('Dikirim', 'Shipped')], ['selesai', T('Selesai', 'Completed')], ['batal', T('Batal', 'Cancelled')],
  ['belum-tertaut', T('Belum tertaut', 'Not linked')],
];
/** Status pesanan (ejaan API) -> [label, warna chip], menurut kelompok saringannya. */
function shopStatus(s) {
  if (s === 'UNPAID' || s === 'ON_HOLD') return [T('Belum bayar', 'Unpaid'), 'warn'];
  if (s === 'AWAITING_SHIPMENT' || s === 'PARTIALLY_SHIPPING') return [T('Perlu dikirim', 'To ship'), 'info'];
  if (s === 'AWAITING_COLLECTION' || s === 'IN_TRANSIT') return [T('Dikirim', 'Shipped'), 'info'];
  if (s === 'DELIVERED' || s === 'COMPLETED') return [T('Selesai', 'Completed'), 'ok'];
  if (s === 'CANCELLED') return [T('Batal', 'Cancelled'), 'danger'];
  return [s || '-', ''];
}
const PLATFORMS = { TOKOPEDIA: 'Tokopedia', TIKTOK_SHOP: 'TikTok Shop', TIKTOK_SHOP_APP: 'TikTok Shop App' };
/** Total pesanan: Rupiah lewat idr, mata uang lain apa adanya. */
function shopMoney(total, currency) {
  if (total === null || total === undefined || total === '') return '-';
  const n = Number(total);
  return (!currency || currency === 'IDR') && Number.isFinite(n) ? idr(n) : total + ' ' + (currency || '');
}

/** Angka di menu Pesanan: semua pesanan yang sudah dibayar tapi belum tertaut ke percakapan (sama dengan saringan "Belum tertaut"). */
function setShopBadge() {
  const n = shopInfo && shopInfo.orders ? shopInfo.orders.unmatched : 0;
  const b = $('shopBadge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('on', n > 0);
  const tip = n + T(' pesanan dibayar belum tertaut ke percakapan', n === 1 ? ' paid order not linked to a conversation' : ' paid orders not linked to a conversation');
  b.title = n > 0 ? tip : '';
  if (n > 0) b.setAttribute('aria-label', tip); else b.removeAttribute('aria-label');
}

async function loadShopInfo() {
  const pid = project;
  try {
    const r = await api('marketplace');
    if (pid !== project) return;
    shopInfo = r;
    shopInfoError = '';
  } catch (e) {
    if (pid !== project) return;
    shopInfoError = e.message;
  }
  setShopBadge();
  if (page === 'marketplace') renderMarketplace();
  if (page === 'pesanan' && shopRows) renderShopOrders();
}

/** Kembali dari halaman izin (?linked=1|0&error=…): kabari sekali, lalu bersihkan alamatnya. */
function readLinked() {
  const q = new URLSearchParams(location.search);
  if (!q.has('linked')) return;
  if (q.get('linked') === '1') toast(T('Toko berhasil ditautkan. Pesanan 30 hari terakhir sedang disinkronkan.', 'Shop linked. Orders from the last 30 days are syncing.'));
  else if (q.get('error')) toast(T('Toko tidak tertaut. Error: ', 'Shop not linked. Error: ') + q.get('error'), true);
  else toast(T('Toko tidak tertaut. Pemilik toko tidak menyetujui akses, atau prosesnya dibatalkan.', 'Shop not linked. The shop owner did not approve access, or the process was cancelled.'), true);
  history.replaceState(null, '', location.pathname + location.hash);
}

/** Satu alamat untuk Partner Center, dengan tombol salin. */
function urlRow(label, url) {
  const copy = el('button', { type: 'button', className: 'btn ghost sm', textContent: T('Salin', 'Copy') });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(T('Alamat disalin.', 'Address copied.'));
    } catch { toast(T('Tidak bisa menyalin. Pilih alamatnya, lalu salin sendiri.', 'Could not copy. Select the address and copy it yourself.'), true); }
  });
  return el('div', { className: 'mk-url' }, el('span', { className: 'cp-k', textContent: label }), el('code', { textContent: url }), copy);
}

/**
 * Tombol ke halaman izin Tokopedia & Shop (tab baru); tanpa TIKTOK_SERVICE_ID
 * hanya keterangan. Alamatnya dibuat server saat diklik (state sekali pakai).
 * Tab baru dibuka langsung saat klik (supaya tidak dicegat pemblokir popup),
 * lalu diarahkan sesudah alamatnya ada. Kalau tab tidak bisa dibuka,
 * tautannya ditampilkan untuk diklik sendiri.
 */
function authButton(m, again = false) {
  if (!m.canAuth) return el('p', { className: 'help', textContent: T('TIKTOK_SERVICE_ID di .env server masih kosong, jadi halaman izin belum bisa dibuka.', 'TIKTOK_SERVICE_ID in the server .env is empty, so the authorization page cannot open yet.') });
  const btn = el('button', { type: 'button', className: 'btn' });
  withIcon(btn, 'package', again ? T('Tautkan lagi', 'Link again') : T('Tautkan toko', 'Link shop'));
  const fallback = el('span', { className: 'help' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    fallback.replaceChildren();
    const tab = window.open('', '_blank');
    try {
      const r = await api('marketplace/auth-url', { method: 'POST' });
      if (tab) {
        tab.opener = null;
        tab.location.href = r.url;
      } else {
        const a = el('a', { href: r.url, target: '_blank', rel: 'noopener', textContent: T('Buka halaman izin Tokopedia & Shop', 'Open the Tokopedia & Shop authorization page') });
        fallback.replaceChildren(T('Tab baru tidak bisa dibuka. ', 'A new tab could not open. '), a);
      }
    } catch (e) {
      if (tab) tab.close();
      toast(e.message, true);
    }
    btn.disabled = false;
  });
  return el('span', {}, btn, ' ', fallback);
}

/**
 * Kode izin yang ditempel sendiri: aplikasi "seller developer" (aplikasi
 * pribadi untuk toko sendiri di Partner Center) bisa menampilkan kodenya
 * langsung, tanpa kembali ke dashboard. Server menukarnya seperti callback izin.
 */
function codeForm() {
  const input = el('input', { type: 'text', className: 'phone', maxLength: 200, autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', T('Kode izin dari Partner Center', 'Authorization code from Partner Center'));
  const btn = el('button', { type: 'button', className: 'btn ghost', textContent: T('Tautkan dengan kode', 'Link with code') });
  const send = async () => {
    const code = input.value.trim();
    if (code.length < 8) {
      toast(T('Isi kode izin dari Partner Center.', 'Enter the authorization code from Partner Center.'), true);
      input.focus();
      return;
    }
    btn.disabled = true;
    try {
      shopInfo = await api('marketplace/code', { method: 'POST', body: JSON.stringify({ code }) });
      toast(T('Toko berhasil ditautkan. Pesanan 30 hari terakhir sedang disinkronkan.', 'Shop linked. Orders from the last 30 days are syncing.'));
    } catch (e) {
      toast(T('Toko tidak tertaut. Error: ', 'Shop not linked. Error: ') + e.message, true);
      btn.disabled = false;
      return;
    }
    setShopBadge();
    renderMarketplace();
  };
  btn.addEventListener('click', () => void send());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });
  return el('div', { className: 'mk-code' },
    el('p', { className: 'help', textContent: T('Atau tempel kode izin dari Partner Center:', 'Or paste the authorization code from Partner Center:') }),
    el('div', { className: 'mk-code-row' }, input, btn));
}

/** Alamat webhook harus ke server ini, bukan ke dashboard di Vercel. */
const webhookNote = () => el('p', { className: 'help', textContent: T(
  'Alamat webhook harus memakai alamat server ini (PUBLIC_BASE_URL), bukan alamat dashboard di Vercel. Tanda tangan webhook dihitung dari isi kiriman apa adanya, jadi kiriman itu harus langsung sampai ke server ini.',
  'The webhook address must use this server address (PUBLIC_BASE_URL), not the dashboard address on Vercel. The webhook signature is computed over the exact request body, so the request must reach this server directly.') });

function renderMarketplace() {
  const box = $('mkBody');
  if (!shopInfo) {
    busy(['mkBody'], !shopInfoError);
    box.replaceChildren(shopInfoError ? errorNote(shopInfoError) : el('p', {}, skelText(T('Memuat keadaan tautan toko Tokopedia & Shop di sini', 'Loading the Tokopedia & Shop link state here'))));
    return;
  }
  busy(['mkBody'], false);
  const m = shopInfo;
  const webhook = urlRow('Webhook URL', m.webhookUrl);
  if (!m.enabled) {
    box.replaceChildren(
      el('p', { className: 'help', textContent: T('Fitur ini belum menyala. Isi TIKTOK_APP_KEY, TIKTOK_APP_SECRET, dan TIKTOK_SERVICE_ID di .env server, lalu jalankan ulang dashboard. Ketiga nilai ini ada di halaman aplikasi Anda di Partner Center (partner.tiktokshop.com).',
        'This feature is off. Fill in TIKTOK_APP_KEY, TIKTOK_APP_SECRET and TIKTOK_SERVICE_ID in the server .env, then restart the dashboard. All three values are on your app page in Partner Center (partner.tiktokshop.com).') }),
      el('p', { className: 'help', textContent: T('Di halaman aplikasi itu, isi juga dua alamat ini:', 'On that app page, also enter these two addresses:') }),
      urlRow(T('Redirect URL (callback izin)', 'Redirect URL (authorization callback)'), m.redirectUrl), webhook, webhookNote());
    return;
  }
  const l = m.link;
  if (!l) {
    box.replaceChildren(
      el('div', { className: 'tblfoot' }, authButton(m)),
      codeForm(),
      el('p', { className: 'help', textContent: T('Pemilik toko masuk dengan akun Seller Center, lalu menyetujui akses pesanan. Setelah itu halaman ini menampilkan tokonya.',
        'The shop owner signs in with the Seller Center account and approves order access. This page then shows the shop.') }),
      el('div', { className: 'sub', textContent: T('Alamat webhook', 'Webhook address') }),
      el('p', { className: 'help', textContent: T('Isi alamat ini sekali di Partner Center, supaya perubahan pesanan langsung masuk:', 'Enter this address once in Partner Center, so order changes arrive at once:') }),
      webhook, webhookNote());
    return;
  }
  const [stText, stCls] = l.status === 'active' ? [T('Aktif', 'Active'), 'ok'] : l.status === 'expired' ? [T('Kedaluwarsa', 'Expired'), 'warn'] : [T('Dicabut', 'Revoked'), 'danger'];
  const facts = [
    [T('Toko', 'Shop'), (l.shopName || l.shopId) + (l.region ? ' (' + l.region + ')' : '')],
    [T('Penjual', 'Seller'), l.sellerName || '-'],
    [T('Token berlaku sampai', 'Token valid until'), l.accessExpiresAt ? when(l.accessExpiresAt) : '-'],
    [T('Izin berakhir', 'Authorization ends'), l.refreshExpiresAt ? when(l.refreshExpiresAt) : '-'],
    [T('Sinkron terakhir', 'Last sync'), l.lastSyncAt ? when(l.lastSyncAt) : T('belum pernah', 'never')],
  ];
  const sync = el('button', { type: 'button', className: 'btn ghost' });
  withIcon(sync, 'refresh', T('Sinkron sekarang', 'Sync now'));
  sync.disabled = l.status !== 'active';
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    const pid = project;
    try {
      shopInfo = await api('marketplace/sync', { method: 'POST' });
      toast(shopInfo.started
        ? T('Sinkron dimulai. Halaman ini diperbarui dalam beberapa detik.', 'Sync started. This page updates in a few seconds.')
        : T('Sinkron masih berjalan. Halaman ini diperbarui dalam beberapa detik.', 'A sync is still running. This page updates in a few seconds.'));
      // Sinkron berjalan di server (latar belakang): data halaman ini dibaca lagi sesudah 5 detik.
      setTimeout(() => { if (pid === project) void loadShopInfo(); }, 5000);
    } catch (e) { toast(e.message, true); }
    setShopBadge();
    renderMarketplace();
  });
  const cut = el('button', { type: 'button', className: 'btn danger' });
  withIcon(cut, 'x', T('Putuskan tautan', 'Unlink'));
  cut.addEventListener('click', async () => {
    if (!confirm(T('Putuskan tautan toko ini? Pesanan baru tidak masuk lagi. Pesanan yang sudah masuk tetap disimpan.', 'Unlink this shop? New orders stop arriving. Orders already here are kept.'))) return;
    cut.disabled = true;
    try {
      shopInfo = await api('marketplace/unlink', { method: 'POST' });
      toast(T('Tautan toko diputus.', 'Shop unlinked.'));
    } catch (e) { toast(e.message, true); }
    setShopBadge();
    renderMarketplace();
  });
  const counts = el('a', { href: pathOf('pesanan'),
    textContent: m.orders.total + T(' pesanan 30 hari, ', ' orders in 30 days, ') + m.orders.unmatched + T(' belum tertaut ke percakapan', ' not linked to a conversation') });
  box.replaceChildren(
    el('div', {}, el('span', { className: 'chip ' + stCls, textContent: stText }), l.error ? el('span', { className: 'help', textContent: ' ' + T('Error: ', 'Error: ') + l.error }) : null),
    el('dl', { className: 'cp-dl mk-facts' }, ...facts.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
    el('p', {}, counts),
    el('div', { className: 'tblfoot' }, sync, l.status !== 'active' ? authButton(m, true) : null, cut),
    el('div', { className: 'sub', textContent: T('Alamat webhook', 'Webhook address') }),
    webhook, webhookNote());
}

async function loadShopOrders() {
  const pid = project;
  const seq = ++shopSeq;
  const q = new URLSearchParams({ status: shopFilter, q: $('shopSearch').value.trim(), limit: '200' });
  try {
    const r = await api('orders?' + q);
    if (pid !== project || seq !== shopSeq) return;
    shopRows = r.rows;
    shopRowsError = '';
  } catch (e) {
    if (pid !== project || seq !== shopSeq) return;
    shopRowsError = e.message;
    toast(e.message, true);
  }
  renderShopOrders();
}

function renderShopFilters() {
  $('shopFilters').replaceChildren(...SHOP_FILTERS().map(([k, label]) => {
    const b = el('button', { type: 'button', className: k === shopFilter ? 'on' : '' }, label);
    b.setAttribute('aria-pressed', String(k === shopFilter));
    b.addEventListener('click', () => {
      shopFilter = k;
      shopRows = null;
      renderShopOrders();
      void loadShopOrders();
    });
    return b;
  }));
}

/** Tautkan (atau lepas, phone '') satu pesanan ke percakapan, lalu muat ulang daftar dan angkanya. */
async function linkShopOrder(orderId, phone, btn) {
  btn.disabled = true;
  try {
    await api('orders/' + encodeURIComponent(orderId), { method: 'PUT', body: JSON.stringify({ phone }) });
    toast(phone ? T('Pesanan ditautkan ke percakapan.', 'Order linked to the conversation.') : T('Pesanan dilepas dari percakapan.', 'Order unlinked from the conversation.'));
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
    return;
  }
  void loadShopInfo();
  await loadShopOrders();
}

function shopOrderRow(o) {
  const items = o.items || [];
  const first = items[0];
  const what = first ? first.name + (first.qty > 1 ? ' ×' + first.qty : '') + (items.length > 1 ? ' ' + T('+' + (items.length - 1) + ' lainnya', '+' + (items.length - 1) + ' more') : '') : '';
  const [stText, stCls] = shopStatus(o.status);
  const status = el('span', { className: 'chip' + (stCls ? ' ' + stCls : ''), textContent: stText });
  if (o.cancelReason) status.title = o.cancelReason;
  let link;
  if (o.contactPhone) {
    const off = el('button', { type: 'button', className: 'btn ghost sm', textContent: T('Lepas', 'Unlink') });
    off.addEventListener('click', () => void linkShopOrder(o.orderId, '', off));
    link = el('td', { className: 'who' }, el('a', { href: convPath(o.contactPhone), className: o.contactName ? '' : 'phone', textContent: o.contactName || o.contactPhone }),
      o.contactName ? el('small', { className: 'phone', textContent: o.contactPhone }) : null, off);
  } else {
    const input = el('input', { type: 'text', className: 'phone', placeholder: '+62…' });
    input.setAttribute('aria-label', T('Nomor percakapan untuk pesanan ini', 'Conversation number for this order'));
    const on = el('button', { type: 'button', className: 'btn ghost sm', textContent: T('Tautkan', 'Link') });
    const send = () => (input.value.trim() ? void linkShopOrder(o.orderId, input.value.trim(), on) : input.focus());
    on.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    link = el('td', {}, el('div', { className: 'shop-link' }, input, on));
  }
  return el('tr', {},
    el('td', {}, el('div', { className: 'shop-id' }, el('small', { className: 'phone', textContent: o.orderId }), o.platform ? el('span', { className: 'chip', textContent: PLATFORMS[o.platform] || o.platform }) : null),
      what ? el('small', { className: 'shop-item', textContent: what }) : null),
    el('td', {}, status),
    el('td', { textContent: o.paidTime ? when(o.paidTime) : '-', style: 'white-space:nowrap' }),
    el('td', { textContent: shopMoney(o.total, o.currency), style: 'white-space:nowrap' }),
    el('td', {}, o.trackingNumber ? el('span', { className: 'phone', textContent: o.trackingNumber }) : '-', o.trackingNumber && o.shippingProvider ? el('small', { className: 'shop-item', textContent: o.shippingProvider }) : null),
    link);
}

function renderShopOrders() {
  renderShopFilters();
  if (!shopRows) {
    const failed = Boolean(shopRowsError);
    busy(['shopOrders'], !failed);
    $('shopCount').replaceChildren(failed ? '' : skelText(T('00 pesanan', '00 orders')));
    $('shopOrders').replaceChildren(el('tbody', {}, ...(failed ? [emptyRow(1, loadError(shopRowsError))] : skeleton('row', 3))));
    return;
  }
  busy(['shopOrders'], false);
  const head = el('tr', {}, ...[T('Pesanan', 'Order'), 'Status', T('Dibayar', 'Paid'), 'Total', T('Resi', 'Tracking'), T('Percakapan', 'Conversation')].map((t) => el('th', { textContent: t })));
  const linked = shopInfo && shopInfo.link;
  const empty = !linked && shopFilter === 'semua' && !$('shopSearch').value.trim()
    ? T('Belum ada pesanan. Tautkan toko di Pengaturan > Tokopedia & Shop.', 'No orders yet. Link the shop in Settings > Tokopedia & Shop.')
    : T('Tidak ada pesanan di saringan ini.', 'No orders in this filter.');
  $('shopOrders').replaceChildren(el('thead', {}, head), el('tbody', {}, ...(shopRows.length ? shopRows.map(shopOrderRow) : [emptyRow(6, empty)])));
  $('shopCount').textContent = shopRows.length + T(' pesanan', shopRows.length === 1 ? ' order' : ' orders') + (shopRows.length >= 200 ? T(' (200 terbaru)', ' (latest 200)') : '');
}

$('shopSearch').addEventListener('input', () => {
  clearTimeout(shopSearchTimer);
  shopSearchTimer = setTimeout(() => void loadShopOrders(), 250);
});

// ---------- satu percakapan ----------
/** Percakapan yang sedang dibuka: data terakhir dari server + pesan lama yang dimuat. */
let conv = null;
let convTimer = null;
let noteTimer = null;
/** Isian pesanan (nomor pesanan, resi, kurir): jeda simpan, kolom yang menunggu disimpan, dan yang sedang disimpan. */
let orderTimer = null;
const orderPending = new Set();
const orderSaving = new Set();
/** Simpanan isian pesanan yang sedang berjalan (Promise), atau null. Simpanan berikutnya dan "Cek resi" menunggu yang ini. */
let orderSave = null;
/** Percakapan pemilik orderSave. Hasil simpanan percakapan lain tidak menghentikan simpanan atau "Cek resi" di percakapan ini. */
let orderSaveConv = null;
/** id kolom di halaman -> [nama kolom di server, kunci di conv.order]. */
const ORDER_INPUTS = { orderRef: ['order_ref', 'ref'], orderAwb: ['awb', 'awb'], orderCourier: ['courier', 'courier'] };

async function openConv(phone) {
  if (!conv || conv.phone !== phone) {
    // Isian pesanan yang belum tersimpan ikut percakapan yang lama. Penanda
    // kolomnya dikosongkan: percakapan baru langsung menampilkan isiannya sendiri.
    if (orderTimer || orderPending.size) void saveOrder();
    orderPending.clear();
    orderSaving.clear();
    conv = { phone, older: [], olderMore: false, key: '', first: true };
    for (const id of Object.keys(ORDER_INPUTS)) $(id).value = '';
    $('orderState').textContent = '';
    $('orderStatus').hidden = true;
    $('orderChecked').textContent = '';
    $('orderLinks').replaceChildren();
    $('orderHistory').replaceChildren();
    $('thread').replaceChildren(el('div', { className: 'daysep', textContent: T('memuat…', 'loading…') }));
    $('convNote').value = '';
    $('convNoteState').textContent = '';
    $('convLead').replaceChildren();
    $('convSum').hidden = true;
  }
  await pollConv();
}

async function pollConv() {
  clearTimeout(convTimer);
  if (page !== 'chat' || !conv) return;
  const phone = conv.phone;
  // Tab tidak terlihat: tidak perlu bertanya ke server, cukup jadwalkan lagi.
  if (!document.hidden || conv.first) {
    try {
      const seq = conv.orderSeq || 0;
      const r = await api('leads/' + encodeURIComponent(phone));
      if (!conv || conv.phone !== phone || page !== 'chat') return;
      // Isian pesanan disimpan atau resi dicek selama permintaan ini berjalan:
      // data pesanan dan tahap di jawaban ini sudah basi, yang sekarang dipakai.
      const keep = conv.order && (conv.orderBusy || orderSaving.size || (conv.orderSeq || 0) !== seq)
        ? { order: conv.order, stage: conv.contact && conv.contact.stage } : null;
      Object.assign(conv, r);
      if (keep) {
        conv.order = keep.order;
        if (conv.contact && keep.stage) conv.contact.stage = keep.stage;
      }
      renderConv();
    } catch (e) {
      if (conv.first) {
        $('thread').replaceChildren(el('div', { className: 'daysep', textContent: e.message }));
        $('replyText').disabled = $('replySend').disabled = true;
        return;
      }
    }
  }
  convTimer = setTimeout(pollConv, 5000);
}

/** Bot benar-benar diam di chat ini (menunggu jam tenang tidak dihitung: bot tetap aktif). */
function botHeld(hold) { return Boolean(hold) && hold !== 'tenang'; }
/** Keterangan singkat penahan bot untuk daftar lead; '' = bot aktif. */
function holdLabel(hold) {
  return hold === 'berhenti' ? T('minta tidak dihubungi', 'asked not to be contacted')
    : hold === 'admin' ? T('admin membalas', 'an admin replied')
    : hold === 'tombol' ? T('dijeda', 'paused')
    : hold === 'tenang' ? T('menunggu jam tenang selesai', 'waiting for quiet hours to end') : '';
}
/** Pelanggan ini minta tidak dihubungi: menyalakan bot lagi berarti mengabaikan permintaannya. */
function confirmOptOutResume() {
  return confirm(T('Pelanggan ini minta tidak dihubungi lagi. Nyalakan bot lagi dan abaikan permintaan itu?',
    'This customer asked not to be contacted again. Turn the bot back on and ignore the request?'));
}

function renderConvHead() {
  const c = conv.contact;
  const name = nameOf(c);
  $('title').textContent = name || c.phone;
  document.title = (name || c.phone) + ' · Alice AI';
  // Sakelar "Bot menjawab": keadaannya ditulis di sampingnya. Klik = jeda atau nyalakan lagi.
  const [holdText, holdCls] = c.hold === 'berhenti' ? [T('Pelanggan minta tidak dihubungi', 'The customer asked not to be contacted'), 'danger']
    : c.hold === 'admin' ? [T('Diam, admin sedang membalas', 'Quiet, an admin is replying'), 'warn']
    : c.hold === 'tombol' ? [T('Dijeda', 'Paused'), 'warn']
    : c.hold === 'tenang' ? [T('Aktif, menunggu jam tenang selesai', 'Active, waiting for quiet hours to end'), 'warn']
    : [T('Aktif', 'Active'), 'ok'];
  const off = botHeld(c.hold);
  $('convBot').setAttribute('aria-checked', String(!off));
  $('convBot').className = 'switchbtn ' + holdCls;
  $('convHold').textContent = holdText;
  $('convBot').title = off ? T('Nyalakan bot lagi di percakapan ini', 'Turn the bot back on in this chat') : T('Jeda bot di percakapan ini', 'Pause the bot in this chat');
  $('convNeeds').hidden = !c.needsSales;
  if ($('convStage').options.length !== STAGES.length || $('convStage').dataset.lang !== lang) {
    $('convStage').replaceChildren(...STAGES.map((s) => el('option', { value: s, textContent: stageLabel(s) })));
    $('convStage').dataset.lang = lang;
  }
  if (document.activeElement !== $('convStage')) $('convStage').value = c.stage || 'baru';
  paintStage($('convStage'));
  // Catatan yang sedang diketik tidak ditimpa oleh pembaruan berkala.
  if (document.activeElement !== $('convNote') && !noteTimer) $('convNote').value = c.note || '';
  // Data pelanggan: nomor dan nama WhatsApp, lalu isian yang sudah terisi. Isian kosong ditulis "-" supaya terlihat apa yang belum diketahui.
  const facts = [
    [T('Nomor', 'Number'), c.phone, 'phone'],
    ...(c.waName && c.waName !== name ? [[T('Nama WhatsApp', 'WhatsApp name'), c.waName]] : []),
    ...conv.fields.map((f) => [sentenceCase(f.label), c.lead[f.key] || '']),
  ];
  $('convLead').replaceChildren(...facts.flatMap(([k, v, cls]) => [el('dt', { textContent: k }), el('dd', { className: v ? cls || '' : 'empty', textContent: v || '-' })]));
  $('convSum').hidden = !c.summary;
  $('convSumText').textContent = c.summary || '';
  $('replyBlocked').hidden = c.canReply;
  $('replyText').disabled = $('replySend').disabled = !c.canReply;
  renderConvOrder();
}

/** Nomor pesanan, resi, kurir, dan status kurir terakhir di kepala percakapan. */
function renderConvOrder() {
  const o = conv.order;
  $('convOrder').hidden = !o;
  if (!o) return;
  // Pesanan Tokopedia & Shop yang tertaut: status, waktu bayar, dan total, di atas kolom pesanan.
  const shop = conv.marketplace;
  $('convShop').hidden = !shop;
  if (shop) {
    const [stText, stCls] = shopStatus(shop.status);
    $('convShop').replaceChildren('Tokopedia & Shop: ', el('span', { className: 'chip' + (stCls ? ' ' + stCls : ''), textContent: stText }),
      shop.paidTime ? ' · ' + T('dibayar ', 'paid ') + when(shop.paidTime) : '', ' · ' + shopMoney(shop.total, shop.currency));
    $('convShop').title = shop.orderId;
  }
  const couriers = conv.couriers || [];
  const sel = $('orderCourier');
  if (sel.options.length !== couriers.length + 1 || sel.dataset.lang !== lang) {
    const cur = sel.value;
    sel.replaceChildren(el('option', { value: '', textContent: T('Pilih kurir', 'Choose a courier') }),
      ...couriers.map((k) => el('option', { value: k.code, textContent: k.label })));
    sel.dataset.lang = lang;
    sel.value = cur;
  }
  // Kolom yang sedang diketik atau menunggu disimpan tidak ditimpa oleh pembaruan berkala.
  for (const [id, [, key]] of Object.entries(ORDER_INPUTS)) {
    if (document.activeElement !== $(id) && !orderPending.has(id) && !orderSaving.has(id)) $(id).value = o[key] || '';
  }
  const [text, cls] = o.error ? [T('Error: ', 'Error: ') + o.error, 'danger']
    : o.phase === 'delivered' ? [T('Terkirim ke pelanggan: ', 'Delivered to the customer: ') + o.status, 'ok']
    : o.phase === 'problem' ? [T('Bermasalah: ', 'Problem: ') + o.status, 'warn']
    : o.phase === 'transit' ? [T('Dalam perjalanan: ', 'In transit: ') + o.status, 'info']
    : o.phase === 'pending' ? [T('Menunggu kurir: ', 'Waiting for pickup: ') + o.status, '']
    : [T('Belum dicek', 'Not checked yet'), ''];
  $('orderStatus').textContent = text;
  $('orderStatus').className = 'chip' + (cls ? ' ' + cls : '');
  $('orderStatus').hidden = !o.awb;
  $('orderChecked').textContent = o.awb && o.checkedAt ? T('dicek ', 'checked ') + clock(o.checkedAt) : '';
  $('orderLinks').replaceChildren(...(o.links || []).map((l) => el('a', { className: 'link', href: l.url, target: '_blank', rel: 'noopener', textContent: l.label })));
  $('orderTrack').hidden = !o.trackingEnabled;
  $('orderOff').hidden = o.trackingEnabled;
  $('orderHistory').replaceChildren(...(o.history || []).slice(0, 3).map((h) =>
    el('li', { textContent: [h.date, h.desc, h.location].filter(Boolean).join(' · ') })));
}

function bubble(m, pending) {
  const meta = [];
  if (m.dir === 'human') meta.push(m.kind === 'dashboard' ? T('Anda (dashboard)', 'You (dashboard)') : T('admin (HP)', 'admin (phone)'));
  if (m.dir === 'out') meta.push(m.kind === 'followup' ? 'bot · follow-up' : 'bot');
  meta.push(clock(m.at));
  let bad = false;
  if (m.dir === 'human' && m.kind === 'dashboard') {
    const p = pending.get(m.id);
    if (!p) meta.push(T('terkirim ✓', 'sent ✓'));
    else if (p.failed) { meta.push(T('gagal terkirim', 'not sent')); bad = true; }
    else meta.push(p.attempts ? T('mencoba lagi…', 'retrying…') : T('menunggu dikirim…', 'waiting to send…'));
  }
  // Pelanggan membalas pesan tertentu (fitur "balas" WhatsApp): kutipannya di atas, seperti di WhatsApp.
  const q = m.quote;
  const quote = q ? el('div', { className: 'quote' + (q.by === 'us' ? ' us' : '') },
    el('b', { textContent: q.by === 'us' ? (profile.brand || T('Anda', 'Us')) : q.by === 'customer' ? T('Pelanggan', 'Customer') : T('Pesan sebelumnya', 'Earlier message') }),
    el('span', { textContent: (q.media ? '[' + q.media + '] ' : '') + (q.text || '') })) : null;
  return el('div', { className: 'bubble ' + m.dir }, quote, m.text, el('span', { className: 'meta' + (bad ? ' bad' : ''), textContent: meta.join(' · ') }));
}

function renderConv() {
  if (!conv || !conv.contact) return;
  renderConvHead();
  const latest = conv.messages || [];
  const firstId = latest.length ? latest[0].id : Infinity;
  const all = [...conv.older.filter((m) => m.id < firstId), ...latest];
  const pending = new Map((conv.pending_replies || []).filter((p) => p.message_id).map((p) => [p.message_id, p]));
  const more = conv.older.length ? conv.olderMore : conv.more;
  // Gambar ulang hanya kalau ada yang berubah, supaya gulungan tidak melompat.
  const key = lang + '|' + more + '|' + all.map((m) => m.id).join(',') + '|' + [...pending.values()].map((p) => p.message_id + ':' + p.attempts + ':' + p.failed).join(',');
  if (key === conv.key) return;
  conv.key = key;
  const box = $('thread');
  const nearBottom = conv.first || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const kids = [];
  if (more) {
    const btn = el('button', { type: 'button', className: 'btn ghost sm', textContent: T('Muat pesan lebih lama', 'Load older messages'), style: 'align-self:center' });
    btn.addEventListener('click', () => void loadOlder(all.length ? all[0].id : 0, btn));
    kids.push(btn);
  }
  let lastDay = '';
  for (const m of all) {
    const d = new Date(m.at).toDateString();
    if (d !== lastDay) { kids.push(el('div', { className: 'daysep', textContent: dayLabel(m.at) })); lastDay = d; }
    kids.push(bubble(m, pending));
  }
  if (!all.length) kids.push(el('div', { className: 'daysep', textContent: T('Belum ada pesan.', 'No messages yet.') }));
  box.replaceChildren(...kids);
  if (nearBottom) box.scrollTop = box.scrollHeight;
  conv.first = false;
}

async function loadOlder(beforeId, btn) {
  if (!beforeId) return;
  btn.disabled = true;
  const box = $('thread');
  const fromBottom = box.scrollHeight - box.scrollTop;
  try {
    const r = await api('leads/' + encodeURIComponent(conv.phone) + '?' + new URLSearchParams({ before: String(beforeId), limit: '100' }));
    conv.older = [...r.messages, ...conv.older];
    conv.olderMore = r.more;
    renderConv();
    box.scrollTop = box.scrollHeight - fromBottom;
  } catch (e) { toast(e.message, true); btn.disabled = false; }
}

$('replyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!conv) return;
  const text = $('replyText').value.trim();
  if (!text) return;
  $('replySend').disabled = true;
  try {
    await api('leads/' + encodeURIComponent(conv.phone) + '/reply', { method: 'POST', body: JSON.stringify({ text }) });
    $('replyText').value = '';
    conv.first = true; // gulung ke balasan yang baru
    await pollConv();
  } catch (err) { toast(err.message, true); }
  $('replySend').disabled = !(conv && conv.contact && conv.contact.canReply);
});
$('replyText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('replyForm').requestSubmit();
  }
});

$('convBot').addEventListener('click', async () => {
  if (!conv || !conv.contact) return;
  const on = botHeld(conv.contact.hold);
  if (conv.contact.hold === 'berhenti' && !confirmOptOutResume()) return;
  $('convBot').disabled = true;
  try {
    await api('leads/' + encodeURIComponent(conv.phone) + '/bot', { method: 'POST', body: JSON.stringify({ mode: on ? 'on' : 'off' }) });
    toast(on ? T('Bot aktif lagi di percakapan ini.', 'The bot is active again in this chat.') : T('Bot dijeda di percakapan ini.', 'The bot is paused in this chat.'));
    await pollConv();
  } catch (e) { toast(e.message, true); }
  $('convBot').disabled = false;
});

$('convHandled').addEventListener('click', async () => {
  if (!conv) return;
  $('convHandled').disabled = true;
  try {
    await api('leads/' + encodeURIComponent(conv.phone) + '/handled', { method: 'POST' });
    toast(T('Ditandai sudah ditangani.', 'Marked as handled.'));
    await pollConv();
  } catch (e) { toast(e.message, true); }
  $('convHandled').disabled = false;
});

$('convStage').addEventListener('change', async () => {
  paintStage($('convStage'));
  if (!conv || !conv.contact) return;
  try {
    const r = await putStage(conv.phone, $('convStage').value);
    conv.contact.stage = r.stage;
  } catch (e) { toast(e.message, true); $('convStage').value = conv.contact.stage || 'baru'; paintStage($('convStage')); }
});

async function saveNote() {
  clearTimeout(noteTimer);
  noteTimer = null;
  // Percakapan bisa sudah ditutup saat simpanan selesai: pegang yang sekarang.
  const cv = conv;
  if (!cv || !cv.contact) return;
  const note = $('convNote').value;
  if (note.trim() === (cv.contact.note || '')) { $('convNoteState').textContent = ''; return; }
  $('convNoteState').textContent = T('Menyimpan…', 'Saving…');
  try {
    const r = await api('leads/' + encodeURIComponent(cv.phone), { method: 'PUT', body: JSON.stringify({ note }) });
    cv.contact.note = r.note || '';
    if (leadData) for (const c of leadData.rows) if (c.phone === cv.phone) c.note = cv.contact.note;
    $('convNoteState').textContent = T('Catatan tersimpan.', 'Note saved.');
  } catch (e) { $('convNoteState').textContent = e.message; }
}
$('convNote').addEventListener('input', () => {
  clearTimeout(noteTimer);
  $('convNoteState').textContent = '';
  noteTimer = setTimeout(() => void saveNote(), 900);
});
$('convNote').addEventListener('blur', () => { if (noteTimer) void saveNote(); });

/**
 * Simpan isian pesanan yang berubah (hanya kolom yang berubah). Simpanan
 * berjalan satu per satu: yang baru menunggu yang sebelumnya selesai, supaya
 * dua simpanan untuk kolom yang sama tidak saling menyalip. Mengembalikan
 * Promise<boolean> yang tidak pernah gagal: true = tersimpan atau tidak ada
 * yang perlu disimpan, false = error (pesannya ditampilkan di #orderState),
 * juga kalau simpanan sebelumnya dalam antrean error.
 */
function saveOrder() {
  clearTimeout(orderTimer);
  orderTimer = null;
  // Percakapan bisa sudah berganti saat simpanan berjalan: pegang yang sekarang
  // beserta isi kolomnya, karena openConv langsung mengosongkan kolom-kolom itu.
  const cv = conv;
  const ids = [...orderPending];
  orderPending.clear();
  if (!cv || !ids.length) return orderSave && orderSaveConv === cv ? orderSave : Promise.resolve(true);
  const values = ids.map((id) => [id, id === 'orderAwb' ? $(id).value.trim().toUpperCase() : $(id).value.trim()]);
  for (const id of ids) orderSaving.add(id);
  cv.orderBusy = (cv.orderBusy || 0) + 1;
  const prev = orderSave;
  const prevConv = orderSaveConv;
  const p = (async () => {
    // Urutan tetap dijaga untuk semua percakapan, tetapi error simpanan milik
    // percakapan lain tidak dihitung di sini.
    const prevRes = prev ? await prev : true;
    const prevOk = prevConv === cv ? prevRes : true;
    let ok = true;
    // Dibandingkan dengan data sesudah simpanan sebelumnya selesai. Data
    // percakapan pertama belum datang (cv.order kosong): semua kolom yang
    // menunggu dikirim apa adanya, tanpa perbandingan.
    const body = {};
    for (const [id, v] of values) {
      const [field, key] = ORDER_INPUTS[id];
      if (!cv.order || v !== (cv.order[key] || '')) body[field] = v;
    }
    if (!Object.keys(body).length) {
      if (conv === cv && prevOk) $('orderState').textContent = '';
    } else {
      if (conv === cv) $('orderState').textContent = T('Menyimpan…', 'Saving…');
      try {
        const r = await api('leads/' + encodeURIComponent(cv.phone), { method: 'PUT', body: JSON.stringify(body) });
        cv.order = r.order;
        if (cv.contact) cv.contact.stage = r.stage;
        if (conv === cv) $('orderState').textContent = T('Tersimpan.', 'Saved.');
      } catch (e) {
        ok = false;
        if (conv === cv) $('orderState').textContent = e.message;
      }
    }
    cv.orderBusy -= 1;
    cv.orderSeq = (cv.orderSeq || 0) + 1;
    // Penanda kolom milik percakapan lain (sesudah pindah) tidak disentuh.
    if (conv === cv) for (const id of ids) orderSaving.delete(id);
    if (conv === cv && cv.contact) renderConvHead();
    return prevOk && ok;
  })();
  orderSave = p;
  orderSaveConv = cv;
  void p.finally(() => { if (orderSave === p) orderSave = orderSaveConv = null; });
  return p;
}
for (const id of ['orderRef', 'orderAwb']) {
  $(id).addEventListener('input', () => {
    orderPending.add(id);
    clearTimeout(orderTimer);
    $('orderState').textContent = '';
    orderTimer = setTimeout(() => void saveOrder(), 900);
  });
  $(id).addEventListener('blur', () => { if (orderPending.size) void saveOrder(); });
}
$('orderCourier').addEventListener('change', () => {
  orderPending.add('orderCourier');
  void saveOrder();
});

/** Bagian `order` yang berasal dari pelacakan, bukan dari isian staf. */
const TRACK_FIELDS = ['status', 'phase', 'history', 'checkedAt', 'error', 'links', 'trackingEnabled'];
function trackingPart(order) {
  const out = {};
  for (const k of TRACK_FIELDS) if (order && k in order) out[k] = order[k];
  return out;
}

// "Cek resi": tanya status kurir sekarang; tahap bisa ikut naik ke dikirim atau selesai.
$('orderTrack').addEventListener('click', async () => {
  if (!conv || !conv.order) return;
  const cv = conv;
  $('orderTrack').disabled = true;
  cv.orderBusy = (cv.orderBusy || 0) + 1;
  try {
    // Isian yang belum tersimpan atau sedang disimpan selesai dulu: yang dicek
    // resi terbaru. Simpanan error: resi tidak dicek, pesan errornya sudah ada
    // di #orderState.
    // Simpanan yang berjalan untuk percakapan lain (sebelum pindah) tidak ditunggu.
    const saved = orderTimer || orderPending.size ? saveOrder() : orderSaveConv === cv ? orderSave : null;
    if (saved && !(await saved)) return;
    const r = await api('leads/' + encodeURIComponent(cv.phone) + '/track', { method: 'POST' });
    // Hanya hasil pelacakan yang diambil. Nomor pesanan, resi, dan kurir tetap
    // dari cv.order: simpanan yang mulai selama pengecekan bisa selesai lebih
    // dulu, dan isinya lebih baru daripada jawaban ini.
    const { ref, awb, courier } = cv.order;
    cv.order = { ...cv.order, ...trackingPart(r.order), ref, awb, courier };
    if (cv.contact) cv.contact.stage = r.stage;
    if (leadData) for (const c of leadData.rows) if (c.phone === cv.phone) c.stage = r.stage;
    if (conv === cv && cv.contact) renderConvHead();
  } catch (e) {
    toast(e.message, true);
  } finally {
    cv.orderBusy -= 1;
    cv.orderSeq = (cv.orderSeq || 0) + 1;
    $('orderTrack').disabled = false;
  }
});

// ---------- pertanyaan yang belum terjawab ----------
let handoffData = null;

async function loadHandoffs() {
  try {
    handoffData = (await api('handoffs?status=open')).groups;
    renderHandoffs();
  } catch (e) { toast(e.message, true); }
}

function askedLine(g) {
  return g.count + T('× ditanyakan', '× asked') + (g.people > 1 ? T(' oleh ', ' by ') + g.people + T(' orang', ' people') : '') +
    T(' · terakhir ', ' · last ') + when(g.last_at);
}

function renderHandoffs() {
  const list = handoffData || [];
  $('questionList').replaceChildren(...(list.length ? list.map(questionItem) : [el('p', { className: 'help', textContent: T('Belum ada pertanyaan yang menunggu jawaban. Pertanyaan yang diteruskan bot ke staf akan muncul di sini.', 'No questions waiting for an answer. Questions the bot hands to staff appear here.') })]));
}

/**
 * Satu pertanyaan yang dioper bot ke tim: konteksnya (pesan bot sebelumnya dan balasan bot), lalu tiga
 * pilihan: jawab untuk pelanggan (masuk "Pengetahuan lain"), ajari bot (jadi pelajaran), atau abaikan.
 */
function questionItem(g) {
  const box = el('textarea', { rows: 2, maxLength: 4000, placeholder: T('Tulis jawabannya seperti Anda menjawab pelanggan…', 'Write the answer as you would tell the customer…') });
  box.setAttribute('aria-label', T('Jawaban', 'Answer'));
  const add = el('button', { type: 'button', className: 'btn' }, ico('book-plus'), T('Tambahkan ke pengetahuan', 'Add to knowledge'));
  const teach = el('button', { type: 'button', className: 'btn ghost' }, ico('sparkles'), T('Ajari bot', 'Teach the bot'));
  const skip = el('button', { type: 'button', className: 'btn ghost' }, ico('x'), T('Abaikan', 'Ignore'));
  add.addEventListener('click', () => void resolveQuestion(g, 'ditambahkan', box.value, [add, teach, skip]));
  skip.addEventListener('click', () => void resolveQuestion(g, 'diabaikan', '', [add, teach, skip]));

  const ctx = g.context || {};
  const line = (label, text) => el('div', { className: 'qctx-l' }, el('b', { textContent: label }), el('span', { textContent: text }));
  // Balasan panjang dipotong 3 baris; "Lihat semua" membukanya (alasan handoff sering ada di kalimat terakhir).
  const long = (ctx.before || '').length + (ctx.reply || '').length > 220 || /\n/.test(ctx.reply || '');
  const more = long ? el('button', { type: 'button', className: 'linkbtn', textContent: T('Lihat semua', 'Show all') }) : null;
  const context = ctx.before || ctx.reply ? el('div', { className: 'qctx' },
    ctx.before ? line(T('Pesan bot sebelumnya: ', 'Bot before: '), ctx.before) : null,
    ctx.reply ? line(T('Balasan bot: ', 'Bot reply: '), ctx.reply) : line(T('Balasan bot: ', 'Bot reply: '), T('(tidak ada)', '(none)')), more) : null;
  if (more) {
    more.addEventListener('click', () => {
      const open = context.classList.toggle('open');
      more.textContent = open ? T('Ringkas', 'Show less') : T('Lihat semua', 'Show all');
    });
  }

  // "Ajari bot": tulis pelajarannya (atau minta usulan), coba dulu, lalu simpan.
  const lesson = el('textarea', { rows: 3, maxLength: 600,
    placeholder: T('Contoh: Kalau pelanggan menyebut jumlah orang, itu jawaban atas pertanyaan bot soal pemakaian ruangan. Pakai untuk menghitung kebutuhan udaranya.',
      'e.g. Kalau pelanggan menyebut jumlah orang, itu jawaban atas pertanyaan kita soal pemakaian ruangan. Pakai untuk menghitung kebutuhan udaranya.') });
  lesson.setAttribute('aria-label', T('Pelajaran untuk bot', 'Lesson for the bot'));
  const why = el('p', { className: 'qwhy', hidden: true });
  const result = el('div', { className: 'qtry', hidden: true });
  const save = el('button', { type: 'button', className: 'btn' }, ico('book-plus'), T('Simpan pelajaran', 'Save lesson'));
  const retry = el('button', { type: 'button', className: 'btn ghost' }, ico('refresh'), T('Coba lagi', 'Try again'));
  const explain = el('button', { type: 'button', className: 'btn ghost' }, ico('sparkles'), T('Bantu jelaskan', 'Help me explain'));
  const cancel = el('button', { type: 'button', className: 'btn ghost' }, T('Batal', 'Cancel'));
  const panel = el('div', { className: 'qteach', hidden: true },
    el('p', { className: 'help', textContent: T('Jelaskan arti pesan seperti ini dan apa yang harus dilakukan bot. Bot membaca pelajaran di tiap balasan, dan juga menerapkannya pada pesan yang mirip.',
      'Explain what a message like this means and what the bot must do. The bot reads it on every reply, and applies it to similar messages too.') }),
    why, lesson, el('div', { className: 'acts' }, save, retry, explain, cancel), result);
  const answer = el('div', {}, box, el('div', { className: 'acts' }, add, teach, skip));
  const busyBtns = (on) => { for (const b of [save, retry, explain, cancel]) b.disabled = on; };

  teach.addEventListener('click', () => { answer.hidden = true; panel.hidden = false; lesson.focus(); });
  cancel.addEventListener('click', () => { panel.hidden = true; answer.hidden = false; });
  explain.addEventListener('click', async () => {
    busyBtns(true);
    try {
      const r = await api('handoffs/' + g.id + '/explain', { method: 'POST', body: '{}' });
      const parts = [r.why ? T('Alasannya: ', 'Why: ') + r.why : ''];
      if (!r.lesson) parts.push(T('Bot kurang data dari tim, jadi lebih cocok pakai “Tambahkan ke pengetahuan”.', 'What is missing is data from the team. “Add to knowledge” fits better.'));
      else if (lesson.value.trim()) parts.push(T('Usulan pelajaran: ', 'Suggested lesson: ') + r.lesson);
      else lesson.value = r.lesson;
      why.textContent = parts.filter(Boolean).join(' ');
      why.hidden = !why.textContent;
    } catch (e) { toast(e.message, true); }
    busyBtns(false);
  });
  retry.addEventListener('click', async () => {
    busyBtns(true);
    result.hidden = false;
    result.replaceChildren(el('p', { className: 'help', textContent: T('Bot menjawab ulang…', 'The bot is answering again…') }));
    try {
      const r = await api('handoffs/' + g.id + '/retry', { method: 'POST', body: JSON.stringify({ lesson: lesson.value }) });
      const passed = r.intent === 'handoff' || r.intent === 'human';
      const verdict = r.rejected ? el('span', { className: 'chip danger', textContent: T('Tidak akan dikirim: ', 'Would not be sent: ') + r.rejected })
        : passed ? el('span', { className: 'chip warn', textContent: T('Masih diteruskan ke tim', 'Still passed to the team') })
          : el('span', { className: 'chip ok', textContent: T('Dijawab bot', 'Answered by the bot') });
      const files = [...(r.photos || []), ...(r.docs || [])].map((f) => f.name);
      result.replaceChildren(
        el('div', { className: 'qtry-h' }, el('b', { textContent: T('Jawaban bot sekarang', 'The bot\'s answer now') }), verdict),
        el('div', { className: 'qtry-reply', textContent: r.reply }),
        ...(r.buy || []).map((b) => el('div', { className: 'qtry-reply', textContent: b.text })),
        files.length ? el('p', { className: 'help', textContent: T('Lampiran: ', 'Attachments: ') + files.join(', ') }) : null);
    } catch (e) {
      result.replaceChildren(el('p', { className: 'help', textContent: e.message }));
    }
    busyBtns(false);
  });
  save.addEventListener('click', () => void resolveQuestion(g, 'diajarkan', lesson.value, [save, retry, explain, cancel]));

  return el('div', { className: 'qitem' }, el('div', { className: 'q', textContent: g.question }),
    el('div', { className: 'm' }, askedLine(g) + T(' · contoh dari ', ' · e.g. from '), el('a', { className: 'link', href: convPath(g.phone), textContent: g.phone })),
    context, answer, panel);
}

async function resolveQuestion(g, resolution, answer, buttons) {
  if (resolution === 'ditambahkan') {
    if (!answer.trim()) return toast(T('Tulis jawabannya dulu.', 'Write the answer first.'), true);
    if (changed.has('notes')) return toast(T('Simpan dulu perubahan di “Pengetahuan lain”, lalu tambahkan jawaban ini.', 'Save your changes to "Other knowledge" before adding an answer.'), true);
  }
  if (resolution === 'diajarkan') {
    if (!answer.trim()) return toast(T('Tulis pelajarannya dulu.', 'Write the lesson first.'), true);
    if (changed.has('lessons')) return toast(T('Simpan dulu perubahan di “Pelajaran dari percakapan”, lalu tambahkan pelajaran ini.', 'Save your changes to "Lessons from real chats" before adding a lesson.'), true);
  }
  for (const b of buttons) b.disabled = true;
  try {
    const text = answer.trim() ? (resolution === 'diajarkan' ? { lesson: answer } : { answer }) : {};
    const r = await api('handoffs/' + g.id + '/resolve', { method: 'POST', body: JSON.stringify({ resolution, ...text }) });
    if (r.profile && resolution === 'diajarkan') {
      profile.lessons = r.profile.lessons;
      renderLessons();
    } else if (r.profile) {
      profile.notes = r.profile.notes;
      for (const n of document.querySelectorAll('[data-key="notes"]')) n.value = profile.notes;
      updateKnowLen();
    }
    handoffData = (handoffData || []).filter((x) => x.id !== g.id);
    renderHandoffs();
    if (homeData) renderHome();
    toast(resolution === 'ditambahkan'
      ? T('Jawaban ditambahkan ke “Pengetahuan lain”. Bot memakainya mulai pesan berikutnya.', 'Answer added to "Other knowledge". The bot uses it from the next message.')
      : resolution === 'diajarkan'
        ? T('Pelajaran disimpan di “Cara bot bicara”. Bot memakainya mulai pesan berikutnya.', 'Lesson saved in "How the bot talks". The bot uses it from the next message.')
        : T('Pertanyaan diabaikan.', 'Question ignored.'));
  } catch (e) {
    toast(e.message, true);
    for (const b of buttons) b.disabled = false;
  }
}

// ---------- beranda ----------
/** Data Beranda; null = halaman baru dibuka dan datanya belum datang (kerangka). */
let homeData = null;
/** Jendela grafik Beranda (hari); angka di kotak tetap 7 hari. */
const CHART_DAYS = 14;

/**
 * Muat semua data Beranda sekaligus. Kartu baru ditukar dari kerangka ke isinya setelah keempat
 * permintaan selesai; permintaan yang gagal hanya membuat kartunya sendiri menampilkan error.
 */
async function loadHome() {
  const pid = project;
  const res = await Promise.allSettled([api('metrics'), api('metrics?days=' + CHART_DAYS), api('handoffs?status=open'), api('leads')]);
  if (pid !== project) return; // proyek sudah diganti selagi menunggu
  const [metrics, trend, h, leads] = res.map((r) => (r.status === 'fulfilled' ? r.value : null));
  const [eMetrics, eTrend, eHandoffs, eLeads] = res.map(failure);
  if (h) handoffData = h.groups;
  if (leads) leadData = leads;
  homeData = { metrics, trend, errors: { metrics: eMetrics, trend: eTrend, handoffs: eHandoffs, leads: eLeads } };
  renderHome();
  setBadge();
  const err = [eMetrics, eTrend, eHandoffs, eLeads].find(Boolean);
  if (err) toast(err, true);
}

/** Lama waktu dalam detik -> "45 dtk" / "3 mnt" / "1 jam". */
function duration(s) {
  if (s === null || s === undefined) return '-';
  if (s < 60) return s + T(' detik', ' s');
  if (s < 3600) return Math.round(s / 60) + T(' menit', ' min');
  return T('1 jam atau lebih', '≥ 1 h');
}

/**
 * Kotak angka. loading = kerangka: angka dan keterangannya jadi balok abu-abu dengan teks contoh
 * yang sama panjang, jadi tinggi kotaknya sama dengan kotak yang sudah berisi.
 */
function tileNode(k, v, s, extra, loading = false) {
  const val = (cls, text) => el('div', { className: cls }, loading ? skelText(text) : text);
  return el('div', { className: 'tile' }, el('div', { className: 'k', textContent: k }), val('v', v), extra || null, val('s', s));
}
/** Meter: jalur biru muda, isinya sepanjang rasio; angkanya tetap judul kotak. */
function meter(a, b, loading = false) {
  const n = el('div', { className: 'meter' + (loading ? ' skel' : '') }, loading ? null : el('span', { style: 'width:' + (b ? Math.min(100, (a * 100) / b) : 0) + '%' }));
  n.setAttribute('aria-hidden', 'true');
  return n;
}
/** Angka nol untuk kerangka kotak Beranda (teks contohnya sepanjang teks asli). */
const ZERO_METRICS = { today: 0, days: [], handed: { count: 0, total: 0 }, replyMedianSec: 0, followup: { answered: 0, sent: 0 } };

function renderHome() {
  const d = homeData;
  const loading = !d;
  const errors = d ? d.errors : {};
  busy(['tiles', 'chartConv', 'chartMsgs', 'stageChips', 'attention', 'homeQuestions'], loading);

  // Kotak angka (7 hari).
  if (errors.metrics) {
    $('tiles').replaceChildren(el('div', { className: 'tile tile-err' }, errorNote(errors.metrics)));
  } else {
    const m = loading ? ZERO_METRICS : d.metrics;
    const week = m.days.reduce((a, x) => a + x.conversations, 0);
    const pctText = (a, b) => (loading ? '00%' : pct(a, b));
    $('tiles').replaceChildren(
      tileNode(T('Percakapan hari ini', 'Conversations today'), loading ? '00' : int(m.today), T('Orang yang chat hari ini, dan ', 'People chatting today; ') + int(week) + T(' dalam 7 hari terakhir', ' in 7 days'), null, loading),
      tileNode(T('Diteruskan ke staf', 'Handed to staff'), pctText(m.handed.count, m.handed.total), int(m.handed.count) + T(' dari ', ' of ') + int(m.handed.total) + T(' percakapan dalam 7 hari', ' conversations in 7 days'), meter(m.handed.count, m.handed.total, loading), loading),
      tileNode(T('Waktu balas (median)', 'Median reply time'), loading ? T('00 detik', '00 s') : duration(m.replyMedianSec), T('Dari pesan pelanggan sampai balasan bot', 'From a customer message to the bot\'s reply'), null, loading),
      tileNode(T('Follow-up dijawab', 'Follow-ups answered'), pctText(m.followup.answered, m.followup.sent), int(m.followup.answered) + T(' dari ', ' of ') + int(m.followup.sent) + T(' pelanggan membalas dalam 48 jam', ' customers replied within 48 h'), meter(m.followup.answered, m.followup.sent, loading), loading));
  }

  // Grafik: jendela CHART_DAYS hari (terlama di kiri). Tanpa data: kerangka setinggi grafik.
  const t = d && d.trend;
  const win = t ? t.windowDays : CHART_DAYS;
  columnChart({ el: $('chartConv'), title: T('Percakapan per hari', 'Conversations per day'), error: errors.trend,
    help: T('Orang yang chat dengan bot, ' + win + ' hari terakhir.', 'People who chatted with the bot, last ' + win + ' days.'),
    days: t ? t.days : null, series: [{ key: 'conversations', label: T('Percakapan', 'Conversations'), slot: 1 }] });
  columnChart({ el: $('chartMsgs'), title: T('Pesan per hari', 'Messages per day'), stacked: true, error: errors.trend,
    help: T('Pesan masuk dan balasan, ' + win + ' hari terakhir.', 'Incoming messages and replies, last ' + win + ' days.'),
    days: t ? t.messagesByDay : null, series: [
      { key: 'in', label: T('Dari pelanggan', 'From customers'), slot: 1 },
      { key: 'out', label: T('Dibalas bot', 'Replied by the bot'), slot: 2 },
      { key: 'human', label: T('Dibalas admin', 'Replied by an admin'), slot: 3 }] });

  // Tahap lead: satu chip per tahap (semua kontak), tiap chip membuka daftarnya.
  $('stageChips').replaceChildren(...(errors.trend ? [errorNote(errors.trend)] : STAGES.map((s) => hint(el('a', { className: 'stagechip ' + stageClass(s), href: pathOf('percakapan') + '?stage=' + s },
    el('span', { textContent: stageLabel(s) }), t ? el('b', { textContent: int(Number(t.stages[s]) || 0) }) : skelText('00')), FILTER_HELP()[s]))));

  // Perlu perhatian: pelanggan yang menunggu staf, lalu masalah bot 24 jam terakhir.
  if (loading || errors.leads) {
    $('attentionHelp').hidden = true;
    $('attention').replaceChildren(el('tbody', {}, ...(loading ? skeleton('row', 3) : [emptyRow(4, loadError(errors.leads))])));
  } else {
    renderAttention();
  }

  // Pertanyaan yang belum terjawab (5 terbaru).
  const qs = (handoffData || []).slice(0, 5);
  $('homeQuestions').replaceChildren(...(loading ? skeleton('qrow', 3)
    : errors.handoffs ? [errorNote(errors.handoffs)]
    : qs.length ? qs.map((g) => el('div', { className: 'qrow' },
      el('a', { className: 'q link', href: pathOf('produk') + '#questions', textContent: g.question, title: g.question }),
      el('small', { textContent: g.count + '× · ' + when(g.last_at) })))
    : [el('p', { className: 'help', textContent: T('Belum ada pertanyaan yang diteruskan ke staf.', 'No questions handed to staff yet.') })]));
  $('allQuestions').textContent = !loading && (handoffData || []).length > 5
    ? T('Lihat semua (', 'See all (') + handoffData.length + ') →' : T('Buka di Pengetahuan bot › Produk →', 'Open in Bot knowledge > Products →');
}

/** Isi kartu "Perlu perhatian" dari daftar pelanggan dan warning bot. */
function renderAttention() {
  const rows = [];
  for (const c of (leadData ? leadData.rows : []).filter((x) => x.needsSales)) {
    const done = el('button', { className: 'btn ghost', type: 'button' }, ico('check-circle'), T('Sudah ditangani', 'Handled'));
    done.addEventListener('click', async () => {
      done.disabled = true;
      try {
        await api('leads/' + encodeURIComponent(c.phone) + '/handled', { method: 'POST' });
        toast(T('Ditandai sudah ditangani.', 'Marked as handled.'));
        await loadHome();
      } catch (e) { toast(e.message, true); done.disabled = false; }
    });
    const name = nameOf(c);
    const open = el('a', { className: 'btn', href: convPath(c.phone) }, ico('message-circle'), T('Buka percakapan', 'Open chat'));
    rows.push(el('tr', {}, el('td', { className: 'who' }, el('a', { href: convPath(c.phone), className: name ? '' : 'phone', textContent: name || c.phone }), name ? el('small', { className: 'phone', textContent: c.phone }) : null),
      el('td', {}, el('span', { className: 'chip warn', textContent: T('Perlu staf', 'Needs staff') })),
      sumCell(c.summary),
      el('td', { className: 'acts' }, el('div', { className: 'acts-in' }, open, done))));
  }
  // Petunjuk satu baris di atas daftar, hanya kalau ada pelanggan yang menunggu staf.
  $('attentionHelp').textContent = T('Pelanggan di bawah menanyakan hal yang harus dijawab staf. Buka percakapannya, balas, lalu tandai sudah ditangani.',
    'The customers below asked something that your staff must answer. Open the chat, reply, then mark it as handled.');
  $('attentionHelp').hidden = !rows.length;
  const day = Date.now() - 86400000;
  for (const a of ((state && state.alerts) || []).filter((x) => x.at > day && x.kind !== 'butuh-staf')) {
    rows.push(el('tr', {}, el('td', { textContent: when(a.at), style: 'white-space:nowrap' }),
      el('td', {}, el('span', { className: 'chip danger', textContent: (ALERT_KINDS[a.kind] || (() => a.kind))() })),
      el('td', { className: 'sum', textContent: a.text, colSpan: 2 })));
  }
  const mins = staleMinutes();
  if (mins !== null) {
    rows.unshift(el('tr', { className: 'stale' }, el('td', { textContent: T('sekarang', 'now') }),
      el('td', {}, el('span', { className: 'chip danger', textContent: T('Bot tidak melapor', 'Bot not reporting') })),
      el('td', { colSpan: 2, textContent: T('Bot terakhir melapor ', 'The bot last reported ') + mins + T(' menit lalu. Mungkin bot berhenti, atau servernya tidak tersambung ke internet.', ' minutes ago. It is probably stopped, or its machine is offline.') })));
  }
  $('attention').replaceChildren(el('tbody', {}, ...(rows.length ? rows : [emptyRow(4, T('Tidak ada yang perlu perhatian saat ini.', 'Nothing needs attention.'))])));
}

// ---------- warning & catatan error ----------
const ALERT_KINDS = {
  'butuh-staf': () => T('Pelanggan butuh staf', 'Customer needs staff'),
  'wa-putus': () => T('WhatsApp terputus', 'WhatsApp disconnected'),
  'kiriman-dijeda': () => T('Kiriman dijeda', 'Sending paused'),
  'kiriman-gagal': () => T('Balasan gagal terkirim', 'Reply not sent'),
  llm: () => T('LLM bermasalah', 'LLM problem'),
  'bot-mati': () => T('Bot berhenti', 'Bot stopped'),
  resi: () => T('Cek resi: saldo atau batas', 'Tracking: balance or cap'),
  marketplace: () => T('Tokopedia & Shop: tautan toko', 'Tokopedia & Shop: shop link'),
};

/** Level baris catatan error; nilai lama di baris yang sudah tersimpan juga dikenali. */
const isError = (level) => level === 'error' || level === 'galat';

/** Menit sejak laporan terakhir bot, kalau lebih dari 40 menit (bot dianggap mati); selain itu null. */
function staleMinutes() {
  const st = state && state.status;
  const mins = st && st.reportedAt ? Math.round((Date.now() - st.reportedAt) / 60000) : null;
  return mins !== null && mins > 40 ? mins : null;
}

/** Angka di menu Percakapan: hanya pelanggan yang menunggu balasan staf. */
function setBadge() {
  const n = leadData ? leadData.rows.filter((c) => c.needsSales).length : 0;
  const b = $('convBadge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.classList.toggle('on', n > 0);
  const tip = n + T(' pelanggan menunggu balasan staf', n === 1 ? ' customer waiting for a staff reply' : ' customers waiting for a staff reply');
  b.title = n > 0 ? tip : '';
  if (n > 0) b.setAttribute('aria-label', tip); else b.removeAttribute('aria-label');
}

/** Isi riwayat warning dan catatan error (Lanjutan) dari jawaban /alerts. */
function renderAlerts(r) {
  state.alerts = r.alerts;
  state.status = r.status;
  setBadge();
  const th = (...names) => el('thead', {}, el('tr', {}, ...names.map((n) => el('th', { textContent: n }))));
  const rows = r.alerts.map((a) => el('tr', {}, el('td', { textContent: when(a.at), style: 'white-space:nowrap' }),
    el('td', {}, el('span', { className: 'chip warn', textContent: (ALERT_KINDS[a.kind] || (() => a.kind))() })), el('td', { textContent: a.text })));
  $('alerts').replaceChildren(th(T('Waktu', 'Time'), T('Jenis', 'Type'), T('Keterangan', 'Details')),
    el('tbody', {}, ...(rows.length ? rows : [emptyRow(3, T('Belum ada warning.', 'No alerts yet.'))])));
  const errs = r.errors.map((e) => el('tr', {}, el('td', { textContent: when(e.at), style: 'white-space:nowrap' }),
    el('td', {}, el('span', { className: 'chip ' + (isError(e.level) ? 'danger' : 'warn'), textContent: isError(e.level) ? 'Error' : 'Warning' })),
    el('td', { className: 'mono', textContent: e.text })));
  $('errors').replaceChildren(th(T('Waktu', 'Time'), 'Level', T('Pesan', 'Message')),
    el('tbody', {}, ...(errs.length ? errs : [emptyRow(3, T('Belum ada error yang tercatat.', 'No errors recorded yet.'))])));
}

// ---------- pemakaian & biaya ----------
/** Data /usage terakhir; dipakai lagi saat rentang diganti, tanpa memuat ulang. */
let usageData = null;
/** Rentang grafik, kotak, dan tabel biaya (hari). */
let usageRange = 30;
const USAGE_RANGES = [7, 30, 90];

/**
 * Muat halaman Lanjutan: pemakaian LLM dan riwayat warning sekaligus, lalu gambar keduanya sekali.
 * Selama dimuat (usageData null) kartu pemakaian berisi kerangka.
 */
async function loadAdvanced() {
  const pid = project;
  const [u, a] = await Promise.allSettled([api('usage'), api('alerts')]);
  if (pid !== project) return;
  usageData = u.status === 'fulfilled' ? { u: u.value.usage } : { error: failure(u) };
  renderUsage();
  if (a.status === 'fulfilled') renderAlerts(a.value);
  const err = failure(u) || failure(a);
  if (err) toast(err, true);
}

/** Geser tanggal "YYYY-MM-DD" sekian hari (dihitung di UTC, jadi aman dari geser zona waktu). */
const shiftDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function renderUsage() {
  // usageData null = sedang dimuat: kotak dan grafik berupa kerangka. usageData.error = gagal dimuat.
  const loading = !usageData;
  const error = (usageData && usageData.error) || '';
  busy(['usageTiles', 'chartCost', 'chartCalls', 'resiTiles', 'chartResi'], loading);
  const u = usageData && usageData.u;
  const price = u ? u.price : { in: 0, cached: 0, out: 0 };
  const rate = u ? u.usdIdr : 0;
  const n = usageRange;

  // Pilihan rentang: tombol seperti saringan di Percakapan.
  $('usageRange').setAttribute('aria-label', T('Rentang waktu', 'Time range'));
  $('usageRange').replaceChildren(...USAGE_RANGES.map((r) => {
    const b = el('button', { type: 'button', className: r === n ? 'on' : '', textContent: r + T(' hari', ' days') });
    b.setAttribute('aria-pressed', String(r === n));
    b.addEventListener('click', () => { if (usageRange !== r) { usageRange = r; renderUsage(); } });
    return b;
  }));
  // Kartu cek resi memakai data dan rentang yang sama.
  renderResi(loading, error, u && u.resi, n);

  // Hari terakhir = hari ini menurut peramban, atau hari data terbaru kalau zona waktu bot sudah lebih dulu.
  const raw = u ? u.days : [];
  const today = new Date().toLocaleDateString('en-CA');
  const last = raw.length && raw[0].day > today ? raw[0].day : today;
  const first = shiftDay(last, 1 - n);
  const byDay = new Map(raw.map((d) => [d.day, d]));
  const zero = { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
  // Hari tanpa pemakaian diisi 0; terlama dulu (paling kiri di grafik).
  const days = [];
  for (let i = 0; i < n; i++) {
    const day = shiftDay(first, i);
    days.push({ ...zero, ...byDay.get(day), day });
  }
  const used = raw.filter((d) => d.day >= first && d.day <= last);

  // Biaya dalam USD per bagian. Token masuk yang kena cache jauh lebih murah, jadi dihitung terpisah.
  const parts = (d) => ({
    in: ((d.promptTokens - d.cachedTokens) * price.in) / 1e6,
    cached: (d.cachedTokens * price.cached) / 1e6,
    out: (d.completionTokens * price.out) / 1e6,
  });
  const cost = (d) => { const p = parts(d); return p.in + p.cached + p.out; };
  const sum = (list) => list.reduce((a, d) => ({
    calls: a.calls + d.calls, promptTokens: a.promptTokens + d.promptTokens, cachedTokens: a.cachedTokens + d.cachedTokens,
    completionTokens: a.completionTokens + d.completionTokens, usd: a.usd + cost(d),
  }), { ...zero, usd: 0 });

  // Kotak angka: hari ini, seluruh rentang, dan rata-rata per hari dalam rentang.
  const total = sum(used);
  const tile = (k, v, s) => tileNode(k, loading ? 'Rp00.000' : v, s, null, loading);
  const todaySum = sum(used.filter((d) => d.day === last));
  if (error) $('usageTiles').replaceChildren(el('div', { className: 'tile tile-err' }, errorNote(error)));
  else $('usageTiles').replaceChildren(
    tile(T('Hari ini', 'Today'), idr(todaySum.usd * rate),
      usd(todaySum.usd) + ' · ' + int(todaySum.calls) + T(' balasan · ', ' replies · ') + int(todaySum.promptTokens + todaySum.completionTokens) + ' token'),
    tile(T(n + ' hari terakhir', 'Last ' + n + ' days'), idr(total.usd * rate),
      usd(total.usd) + ' · ' + int(total.calls) + T(' balasan · ', ' replies · ') + int(total.promptTokens + total.completionTokens) + ' token'),
    tile(T('Rata-rata per hari', 'Average per day'), idr((total.usd * rate) / n),
      usd(total.usd / n) + ' · ' + (total.calls / n).toLocaleString(locale(), { maximumFractionDigits: 1 }) + T(' balasan per hari', ' replies per day')));

  // Grafik biaya: tiga bagian bertumpuk dalam Rupiah, urutan seri tetap.
  const host = $('chartCost');
  columnChart({ el: host, title: T('Biaya per hari (Rp)', 'Cost per day (Rp)'), stacked: true, format: idr, error,
    help: T('Perkiraan biaya LLM, ' + n + ' hari terakhir.', 'Estimated LLM cost, last ' + n + ' days.'),
    days: loading ? null : days.map((d) => { const p = parts(d); return { day: d.day, in: p.in * rate, cached: p.cached * rate, out: p.out * rate }; }),
    series: [
      { key: 'in', label: 'Input', slot: 1 },
      { key: 'cached', label: T('Input dari cache', 'Cached input'), slot: 2 },
      { key: 'out', label: 'Output', slot: 3 }] });
  // Satu baris keterangan tarif dan kurs di bawah grafik (selama dimuat: kerangka sepanjang teks biasanya).
  if (loading) {
    host.querySelector(':scope > .cb').append(el('p', { className: 'help chart-note' },
      skelText(T('Model gpt-4o-mini · tarif per 1 juta token: input $0.1500, dari cache $0.0750, output $0.6000 · kurs Rp16.000 per USD',
        'Model gpt-4o-mini · rates per 1M tokens: input $0.1500, cached $0.0750, output $0.6000 · exchange rate Rp 16.000 per USD'))));
  }
  if (loading || error) {
    columnChart({ el: $('chartCalls'), title: T('Panggilan LLM per hari', 'LLM calls per day'), error,
      help: T('Jumlah panggilan ke LLM, ' + n + ' hari terakhir.', 'Number of LLM calls, last ' + n + ' days.'),
      days: null, series: [{ key: 'calls', label: T('Panggilan', 'Calls'), slot: 1 }] });
    return;
  }
  if (u) {
    host.querySelector(':scope > .cb').append(el('p', { className: 'help chart-note', textContent: 'Model ' + u.model + T(' · tarif per 1 juta token: input ', ' · rates per 1M tokens: input ') + usd(price.in) +
      T(', dari cache ', ', cached ') + usd(price.cached) + ', output ' + usd(price.out) + T(' · kurs Rp', ' · exchange rate Rp ') + int(rate) + T(' per USD', ' per USD') }));
  }

  // Tampilan "Tabel" grafik biaya = tabel pemakaian lengkap (hari dengan pemakaian, terbaru di atas).
  const th = (t, num) => el('th', { textContent: t, className: num ? 'num' : '' });
  const td = (t, num) => el('td', { textContent: t, className: num ? 'num' : '' });
  const line = (label, d, c) => el('tr', {}, el('td', { textContent: label, style: 'white-space:nowrap' }), td(int(d.calls), 1), td(int(d.promptTokens), 1), td(int(d.cachedTokens), 1),
    td(int(d.completionTokens), 1), td(usd(c), 1), td(idr(c * rate), 1));
  const rows = used.map((d) => line(dayLong(d.day), d, cost(d)));
  host.querySelector(':scope > .cb > .scroll').replaceChildren(el('table', { className: 'list' },
    el('thead', {}, el('tr', {}, th(T('Tanggal', 'Date')), th(T('Balasan', 'Replies'), 1), th(T('Token masuk', 'Input tokens'), 1), th(T('…dari cache', '…cached'), 1), th(T('Token keluar', 'Output tokens'), 1), th(T('Biaya (USD)', 'Cost (USD)'), 1), th(T('Biaya (Rp)', 'Cost (Rp)'), 1))),
    el('tbody', {}, ...(rows.length ? rows : [emptyRow(7, T('Belum ada data', 'No data yet'))])),
    ...(rows.length ? [el('tfoot', {}, line(T('Jumlah ' + n + ' hari', 'Total, ' + n + ' days'), total, total.usd))] : [])));

  // Grafik jumlah panggilan: satu seri, tanpa legenda, rentang yang sama.
  columnChart({ el: $('chartCalls'), title: T('Panggilan LLM per hari', 'LLM calls per day'),
    help: T('Jumlah panggilan ke LLM, ' + n + ' hari terakhir.', 'Number of LLM calls, last ' + n + ' days.'),
    days, series: [{ key: 'calls', label: T('Panggilan', 'Calls'), slot: 1 }] });
}

/** Teks contoh kerangka kotak dan catatan kartu cek resi (sepanjang teks aslinya). */
const RESI_SAMPLE = {
  counts: () => T('000 cek · otomatis 000 · manual 00', '000 checks · automatic 000 · manual 00'),
  balance: () => T('cukup untuk ±000 cek lagi · 00 cek gratis tersisa', 'enough for about 000 more checks · 00 free checks left'),
  note: () => T('Tarif Rp15 per cek setelah kuota gratis · saldo dibaca 14.05', 'Rate Rp15 per check after the free quota · balance read at 14:05'),
};

/**
 * Kartu "Pemakaian dan biaya cek resi" (usage.resi dari /usage). Rentangnya sama dengan kartu LLM.
 * Biaya = jumlah cek × tarif: batas atas, karena kuota gratis berlaku untuk seluruh akun Binderbyte
 * (semua proyek). Sisa kuota gratis tampil terpisah, tidak dikurangkan.
 */
function renderResi(loading, error, r, n) {
  const resi = r || { enabled: false, price: 0, dailyMax: 0, days: [], account: null, accountError: null };
  $('resiOff').hidden = loading || Boolean(error) || resi.enabled;

  // Hari tanpa cek diisi 0; terlama dulu (paling kiri di grafik). Hari terakhir seperti di kartu LLM.
  const raw = resi.days;
  const today = new Date().toLocaleDateString('en-CA');
  const last = raw.length && raw[0].day > today ? raw[0].day : today;
  const first = shiftDay(last, 1 - n);
  const byDay = new Map(raw.map((d) => [d.day, d]));
  const days = [];
  for (let i = 0; i < n; i++) {
    const day = shiftDay(first, i);
    const d = byDay.get(day);
    days.push({ day, auto: d ? d.auto : 0, manual: d ? d.manual : 0 });
  }
  const price = resi.price;
  const checks = (d) => d.auto + d.manual;
  const sum = (list) => list.reduce((a, d) => ({ auto: a.auto + d.auto, manual: a.manual + d.manual }), { auto: 0, manual: 0 });
  const counts = (c) => int(checks(c)) + T(' cek · otomatis ', ' checks · automatic ') + int(c.auto) + ' · manual ' + int(c.manual);
  const todaySum = sum(days.filter((d) => d.day === last));
  const total = sum(days);

  // Kotak angka: hari ini, seluruh rentang, saldo akun, dan batas harian cek otomatis.
  const acc = resi.account;
  let balance = [T('Tidak aktif', 'Not active'), ''];
  if (loading) balance = ['Rp00.000', RESI_SAMPLE.balance()];
  else if (resi.enabled && !acc) balance = [T('belum terbaca', 'not read yet'), resi.accountError || ''];
  else if (resi.enabled && resi.accountError) {
    // Pembacaan terakhir gagal: saldo lama tetap tampil, dengan waktunya dan pesan error-nya.
    balance = [idr(acc.balance), T('Saldo terakhir dibaca ', 'Balance last read ') + when(acc.at) + ' · Error: ' + resi.accountError];
  } else if (resi.enabled) {
    balance = [idr(acc.balance), T('cukup untuk ±', 'enough for about ') + int(price > 0 ? Math.floor(acc.balance / price) : 0) +
      T(' cek lagi · ', ' more checks · ') + int(acc.freeLeft) + T(' cek gratis tersisa', ' free checks left')];
  }
  const tile = (k, v, sub) => tileNode(k, v, sub, null, loading);
  if (error) $('resiTiles').replaceChildren(el('div', { className: 'tile tile-err' }, errorNote(error)));
  else $('resiTiles').replaceChildren(
    tile(T('Hari ini', 'Today'), loading ? 'Rp000' : idr(checks(todaySum) * price), loading ? RESI_SAMPLE.counts() : counts(todaySum)),
    tile(T(n + ' hari terakhir', 'Last ' + n + ' days'), loading ? 'Rp0.000' : idr(checks(total) * price), loading ? RESI_SAMPLE.counts() : counts(total)),
    tile(T('Saldo Binderbyte', 'Binderbyte balance'), balance[0], balance[1]),
    // TRACK_DAILY_MAX=0 (atau kurang): cek otomatis dimatikan di bot, tombol "Cek resi" tetap jalan.
    !loading && resi.dailyMax <= 0
      ? tile(T('Batas harian', 'Daily cap'), T('Nonaktif', 'Off'),
        T('Cek otomatis dimatikan (TRACK_DAILY_MAX=0); tombol Cek resi tetap bisa dipakai',
          'Automatic checks are off (TRACK_DAILY_MAX=0); the Cek resi button still works'))
      : tile(T('Batas harian', 'Daily cap'), loading ? '000 / 000' : int(todaySum.auto) + ' / ' + int(resi.dailyMax),
        T('cek otomatis hari ini; manual tidak dibatasi', 'automatic checks today; manual is not capped')));

  // Grafik: cek otomatis dan manual bertumpuk, urutan seri tetap.
  const host = $('chartResi');
  columnChart({ el: host, title: T('Cek resi per hari', 'Tracking checks per day'), stacked: true, format: int, error,
    help: T('Jumlah cek resi, ' + n + ' hari terakhir.', 'Number of tracking checks, last ' + n + ' days.'),
    days: loading ? null : days,
    series: [{ key: 'auto', label: T('Otomatis', 'Automatic'), slot: 1 }, { key: 'manual', label: 'Manual', slot: 2 }] });
  if (error) return;
  // Satu baris keterangan tarif di bawah grafik (selama dimuat: kerangka sepanjang teks biasanya).
  const note = (content) => host.querySelector(':scope > .cb').append(el('p', { className: 'help chart-note' }, content));
  if (loading) { note(skelText(RESI_SAMPLE.note())); return; }
  // Saldo dibaca hari ini: jam saja; hari lain: tanggal dan jam.
  const readAt = (at) => (new Date(at).toLocaleDateString('en-CA') === today ? clock(at) : when(at));
  note(acc
    ? T('Tarif ', 'Rate ') + idr(price) + T(' per cek setelah kuota gratis · saldo dibaca ', ' per check after the free quota · balance read at ') + readAt(acc.at)
    : T('Tarif bawaan ', 'Default rate ') + idr(price) + T(' per cek setelah kuota gratis', ' per check after the free quota'));

  // Tampilan "Tabel": hari dengan cek, terbaru di atas, dengan biayanya.
  const th = (t, num) => el('th', { textContent: t, className: num ? 'num' : '' });
  const td = (t, num) => el('td', { textContent: t, className: num ? 'num' : '' });
  const line = (label, d) => el('tr', {}, el('td', { textContent: label, style: 'white-space:nowrap' }), td(int(d.auto), 1), td(int(d.manual), 1), td(idr(checks(d) * price), 1));
  const rows = days.filter((d) => checks(d) > 0).reverse().map((d) => line(dayLong(d.day), d));
  host.querySelector(':scope > .cb > .scroll').replaceChildren(el('table', { className: 'list' },
    el('thead', {}, el('tr', {}, th(T('Tanggal', 'Date')), th(T('Otomatis', 'Automatic'), 1), th('Manual', 1), th(T('Biaya (Rp)', 'Cost (Rp)'), 1))),
    el('tbody', {}, ...(rows.length ? rows : [emptyRow(4, T('Belum ada data', 'No data yet'))])),
    ...(rows.length ? [el('tfoot', {}, line(T('Jumlah ' + n + ' hari', 'Total, ' + n + ' days'), total))] : [])));
}

// ---------- WhatsApp & keadaan bot ----------
const WA_STATES = {
  starting: () => [T('menyambung…', 'connecting…'), ''],
  qr: () => [T('menunggu dipindai', 'waiting for scan'), 'warn'],
  pairing: () => [T('menunggu kode pairing', 'waiting for pairing code'), 'warn'],
  connected: () => [T('tersambung', 'connected'), 'ok'],
  disconnected: () => [T('terputus, menyambung lagi', 'disconnected, reconnecting'), 'warn'],
  logged_out: () => [T('sesi diputus dari HP', 'session removed on the phone'), 'danger'],
  conflict: () => [T('sesi diambil alih sesi lain', 'session taken over'), 'danger'],
  stopped: () => [T('bot berhenti', 'bot stopped'), 'danger'],
};
const waLabel = (s) => (WA_STATES[s] ? WA_STATES[s]()[0] : s || '-');
const showPhone = (p) => (p ? (/^\d+$/.test(p) ? '+' + p : p) : T('nomor belum diketahui', 'number not known yet'));
let waTimer = null;
let wa = null;
/** Halaman WhatsApp baru dibuka dan laporan /wa belum datang: area keadaan berisi kerangka. */
let waPending = false;
/** Pesan error kalau laporan pertama gagal dimuat. */
let waError = '';

/** Keadaan bot (tabel di Pengaturan > WhatsApp), termasuk pengaman nomor dan antiban. */
function renderStatus() {
  if (!state) return;
  const st = state.status;
  let info;
  if (!st) {
    info = [['Bot', T('Belum pernah melapor ke dashboard ini.', 'Has never reported to this dashboard.')]];
  } else {
    // Ringkasan pengaman dari bot: "<batas kiriman> · antiban: <keadaan>".
    const guard = st.guard || '';
    const cut = guard.indexOf(' · antiban: ');
    const own = cut >= 0 ? guard.slice(0, cut) : guard;
    const ab = cut >= 0 ? guard.slice(cut + ' · antiban: '.length) : '';
    info = [[T('Jalur WhatsApp', 'WhatsApp channel'), st.transport], [T('Notifikasi lead lewat WhatsApp ke', 'Lead news on WA goes to'), st.sales || T('belum ada nomor', 'no number yet')],
      ['LLM', state.testReady ? T('siap', 'ready') : T('belum diatur (LLM_API_KEY di .env)', 'not set (LLM_API_KEY in .env)')],
      [T('Ubah pesan suara jadi teks', 'Voice note transcription'), st.channels && st.channels.stt ? T('siap', 'ready') : T('belum diatur di .env bot (STT_API_KEY)', 'not set in the bot\'s .env (STT_API_KEY)')],
      [T('Yang dibalas', 'Who gets a reply'), st.onlyNumbers ? T('Mode uji: hanya ', 'TEST MODE: only ') + st.onlyNumbers + T(' nomor', ' numbers') : T('semua nomor', 'every number')],
      [T('Panggilan LLM hari ini', 'LLM calls today'), st.usage.calls + T(' dari batas ', ' of limit ') + st.usage.limit],
      [T('Pengaman nomor', 'Number safeguard'), own || (st.transport === 'baileys' ? T('belum dilaporkan bot', 'not reported by the bot yet') : T('tidak dipakai (Cloud API)', 'not used (Cloud API)'))],
      ['Antiban', ab || (st.transport === 'baileys' ? T('belum dilaporkan bot', 'not reported by the bot yet') : T('tidak dipakai (Cloud API)', 'not used (Cloud API)'))]];
  }
  $('envInfo').replaceChildren(el('tbody', {}, ...info.map(([k, v]) => el('tr', {}, el('td', { textContent: k, style: 'width:220px;color:var(--muted)' }), el('td', { textContent: v })))));
}

/** Kosongkan gambar QR: jangan sisakan ikon gambar rusak saat QR tidak berlaku lagi. */
function clearQr() {
  $('waQrImg').removeAttribute('src');
  delete $('waQrImg').dataset.qr;
}

/** Area keadaan WhatsApp selama laporan pertama belum datang (kerangka) atau gagal dimuat (error). */
function renderWaPending() {
  const failed = !waPending && waError;
  busy(['waState', 'waDetail', 'waFoot'], !failed);
  $('waState').className = 'chip' + (failed ? ' danger' : '');
  $('waState').replaceChildren(failed ? T('Gagal memuat', 'Failed to load') : skelText(T('menyambung…', 'connecting…')));
  $('waQr').hidden = true;
  $('waCodeBox').hidden = true;
  // Tebak susunan akhirnya dari laporan bot terakhir (sudah ada di state): tersambung = baris rincian
  // tanpa kotak kode pairing; belum = kotak kode pairing tanpa baris rincian. Jadi kartunya tidak melompat.
  const st = state && state.status;
  const reported = Boolean(st && st.reportedAt);
  $('waSeen').replaceChildren(failed || !reported ? '' : skelText(T('laporan terakhir 12 Nov 2026 10.00', 'last report 12 Nov 2026 10:00')));
  const linked = reported && st.wa === 'connected' && Date.now() - st.reportedAt < 120000;
  const cloud = Boolean(state && state.project && state.project.transport === 'cloud');
  if (!failed) $('waPairBox').hidden = linked || cloud;
  $('waDetail').replaceChildren(failed ? loadError(waError) : linked ? skelText(T('Tersambung sebagai +6281234567890', 'Connected as +6281234567890')) : '');
  $('waFoot').replaceChildren(failed ? '' : skelText(reported ? T('Jalur: baileys · versi bot 0.1.0 · dinyalakan 12 Nov 2026 10.00', 'Channel: baileys · bot version 0.1.0 · started 12 Nov 2026 10:00')
    : WA_NEVER()));
}
/** Kaki kartu WhatsApp kalau bot proyek ini belum pernah melapor. */
const WA_NEVER = () => T('Bot proyek ini belum pernah melapor. Di server, bot menyala sekitar 1 menit setelah proyek dibuat.', 'This project\'s bot has never reported. On the server it starts within a minute after the project is created.');

function renderWa() {
  if (waPending || (!wa && waError)) return renderWaPending();
  busy(['waState', 'waDetail', 'waFoot'], false);
  const w = wa && wa.wa;
  const p = state && state.project;
  // Laporan bot datang tiap 30 detik; lebih dari 2 menit diam = bot tidak jalan.
  const stale = !w || !w.last_seen_at || Date.now() - w.last_seen_at > 120000;
  const [text, cls] = !w ? [T('bot belum pernah melapor', 'bot has never reported'), 'warn']
    : stale ? [T('bot tidak melapor', 'bot not reporting'), 'danger'] : WA_STATES[w.state] ? WA_STATES[w.state]() : [w.state, ''];
  $('waState').textContent = cap(text);
  $('waState').className = 'chip ' + cls;
  $('waSeen').textContent = w && w.last_seen_at ? T('laporan terakhir ', 'last report ') + when(w.last_seen_at) : '';
  const connected = Boolean(w && !stale && w.state === 'connected' && !(wa && wa.pending));
  // Sudah tersambung: tidak ada kotak QR sama sekali.
  const showQr = Boolean(w && !stale && !connected && w.state === 'qr' && w.qr && typeof qrcode === 'function');
  $('waQr').hidden = !showQr;
  if (!showQr) clearQr();
  else if ($('waQrImg').dataset.qr !== w.qr) {
    const q = qrcode(0, 'L');
    q.addData(w.qr);
    q.make();
    $('waQrImg').src = q.createDataURL(6, 2);
    $('waQrImg').dataset.qr = w.qr;
  }
  const code = w && !stale && w.state === 'pairing' && w.pairing_code;
  $('waCodeBox').hidden = !code;
  $('waCode').textContent = code ? w.pairing_code.replace(/^(.{4})(.{4})$/, '$1-$2') : '';
  $('waDetail').replaceChildren(...(wa && wa.pending === 'pair' ? [T('Permintaan kode pairing dikirim ke bot…', 'Pairing code requested from the bot…')]
    : wa && wa.pending === 'reset' ? [T('Bot sedang memutus sesi lama…', 'The bot is disconnecting the old session…')]
    : connected ? [T('Tersambung sebagai ', 'Connected as '), w.self_phone ? el('span', { className: 'phone', textContent: showPhone(w.self_phone) }) : showPhone(w.self_phone)]
    : w && w.detail ? [w.detail] : []));
  const cloud = p && p.transport === 'cloud';
  // Kode pairing hanya berguna selama belum tersambung, dan hanya di jalur Baileys.
  $('waPairBox').hidden = connected || cloud;
  if (!$('waNumber').value && p && p.wa_number) $('waNumber').value = p.wa_number;
  $('waFoot').textContent = w ? [T('Jalur: ', 'Channel: ') + (w.transport || (p && p.transport) || '-'), w.version ? T('versi bot ', 'bot version ') + w.version : '',
    w.started_at ? T('dinyalakan ', 'started ') + when(w.started_at) : ''].filter(Boolean).join(' · ') : WA_NEVER();
}

async function loadWa() {
  clearTimeout(waTimer);
  if (!project || page !== 'whatsapp') return;
  const pid = project;
  try {
    const r = await api('wa');
    if (pid !== project) return;
    wa = r;
    waError = '';
    waPending = false;
    renderWa();
    renderStrip();
  } catch (e) {
    // Dicoba lagi di putaran berikutnya. Laporan pertama yang gagal tampil sebagai error di kartunya.
    if (pid !== project) return;
    waError = e.message;
    if (waPending) { waPending = false; renderWa(); }
  }
  // Selama belum tersambung, QR dan kode pairing berganti cepat: periksa tiap 3 detik.
  const connected = wa && wa.wa && wa.wa.state === 'connected' && !wa.pending;
  waTimer = setTimeout(loadWa, connected ? 15000 : 3000);
}

$('waPair').addEventListener('click', async () => {
  $('waPair').disabled = true;
  try {
    await api('wa/pair', { method: 'POST', body: JSON.stringify({ number: $('waNumber').value }) });
    toast(T('Kode pairing diminta. Kodenya muncul di sini dalam beberapa detik.', 'Pairing code requested. It appears here in a few seconds.'));
  } catch (e) { toast(e.message, true); }
  $('waPair').disabled = false;
  void loadWa();
});

$('waReset').addEventListener('click', async () => {
  if (!confirm(T('Putuskan WhatsApp proyek ini dan tautkan dari awal? Bot berhenti membalas sampai ditautkan lagi.', 'Disconnect this project\'s WhatsApp and link it again? The bot stops replying until it is linked again.'))) return;
  try {
    await api('wa/reset', { method: 'POST' });
    toast(T('Sesi lama sudah diputus. Kode QR baru akan muncul di sini sebentar lagi.', 'Old session disconnected. A new QR code appears here shortly.'));
  } catch (e) { toast(e.message, true); }
  void loadWa();
});

// ---------- bilah keadaan (semua halaman proyek) ----------
function renderStrip() {
  if (!state) return;
  const st = state.status;
  const p = state.project;
  const chip = (cls, text, href, name) => el('a', { className: 'chip ' + cls, href }, ico(name), text);
  const out = [];
  // Keadaan WhatsApp: laporan /wa kalau sudah ada (lebih baru), selain itu dari keadaan bot.
  const w = wa && wa.wa ? { state: wa.wa.state, at: wa.wa.last_seen_at } : st ? { state: st.wa, at: st.reportedAt } : null;
  const waHref = pathOf('whatsapp');
  if (!w || !w.at) out.push(chip('warn', T('WhatsApp: bot belum pernah melapor', 'WhatsApp: bot has never reported'), waHref, 'smartphone'));
  else if (Date.now() - w.at > 120000) out.push(chip('danger', T('Bot tidak melapor', 'Bot not reporting'), waHref, 'smartphone'));
  else if (w.state === 'connected') out.push(chip('ok', T('WhatsApp tersambung', 'WhatsApp connected'), waHref, 'smartphone'));
  else out.push(chip('warn', T('WhatsApp belum tertaut', 'WhatsApp not linked') + ' · ' + waLabel(w.state), waHref, 'smartphone'));
  if (p && p.paused) out.push(chip('danger', T('Bot dijeda', 'Bot paused'), pathOf('pengaturan'), 'pause-circle'));
  if (st && st.onlyNumbers) out.push(chip('warn', T('Mode uji', 'TEST MODE') + ' · ' + st.onlyNumbers + T(' nomor', ' numbers'), pathOf('lanjutan'), 'flask'));
  if (!state.testReady) out.push(chip('warn', T('LLM belum diatur', 'LLM not configured'), waHref, 'alert'));
  const month = state.month || { idr: 0 };
  // Nominal tetap "Rp" (bukan "RP"): dibungkus .raw. Tooltip: rincian LLM dan cek resi.
  const cost = chip('', el('span', {}, el('span', { className: 'raw', textContent: idr(month.idr) }), T(' bulan ini', ' this month')), pathOf('lanjutan') + '#cost', 'coins');
  const llm = month.llm !== undefined ? month.llm : month.idr;
  // Biaya cek resi = batas atas (kuota gratis belum dikurangi).
  cost.title = 'LLM ' + idr(llm) + T(' · Cek resi maks. ', ' · Tracking up to ') + idr(month.resi || 0);
  out.push(cost);
  // Lencana di wadahnya sendiri (di HP bergulung ke samping); tombol Coba chat di ujung kanan, di semua halaman
  // (node yang sama dipindahkan lagi).
  $('strip').replaceChildren(el('div', { className: 'strip-chips' }, ...out), $('tryBtn'));
}

// Keadaan WhatsApp di bilah atas tetap segar walau tidak di halaman WhatsApp.
setInterval(async () => {
  if (!project || !state || page === 'whatsapp' || document.hidden) return;
  try {
    wa = await api('wa');
    renderStrip();
  } catch { /* dicoba lagi menit berikutnya */ }
}, 60000);

// ---------- proyek ----------
function renderProject() {
  const p = state && state.project;
  if (!p) return;
  // Suntingan yang belum disimpan tidak ditimpa (mis. saat tombol jeda diubah).
  if (!projectDirty) {
    $('projName').value = p.name || '';
    $('projTransport').value = p.transport || 'baileys';
    $('projEnabled').checked = Boolean(p.enabled);
  }
  $('projPaused').checked = Boolean(p.paused);
  $('pauseBar').classList.toggle('on', Boolean(p.paused));
}

/** Kirim perubahan baris proyek; tanpa pesan, tidak ada toast (save() memberi toast sendiri). */
async function putProject(patch, message) {
  const r = await api('project', { method: 'PUT', body: JSON.stringify(patch) });
  state.project = r.project;
  const i = projects.findIndex((x) => x.id === r.project.id);
  if (i >= 0) projects[i] = { ...projects[i], ...r.project };
  renderProjects();
  renderProject();
  renderStrip();
  if (message) toast(message);
}

// Isian kartu Proyek: perubahan memunculkan bilah simpan di bawah, seperti isian lain.
for (const id of ['projName', 'projTransport', 'projEnabled']) {
  const input = $(id);
  input.addEventListener(input.tagName === 'INPUT' && input.type === 'text' ? 'input' : 'change', () => setDirty(true, 'project'));
}

$('projPaused').addEventListener('change', async () => {
  const paused = $('projPaused').checked;
  try {
    await putProject({ paused }, paused ? T('Bot dijeda di semua percakapan.', 'The bot is paused for all chats.') : T('Bot aktif lagi di semua percakapan.', 'The bot is active again for all chats.'));
  } catch (e) { toast(e.message, true); renderProject(); }
});

function renderProjects() {
  const sel = $('projectSel');
  sel.replaceChildren(...projects.map((p) => el('option', { value: p.id, textContent: p.name + (p.paused ? T(' (dijeda)', ' (paused)') : '') + (p.enabled ? '' : T(' (nonaktif)', ' (inactive)')) })),
    el('option', { value: '+', textContent: T('＋ Proyek baru…', '＋ New project…') }));
  sel.value = project;
  $('npTemplate').replaceChildren(...templates.map((t) => el('option', { value: t, textContent: t })));
  $('npTemplate').value = templates.includes('generic') ? 'generic' : templates[0] || '';
}

function openNewProject() {
  $('npErr').textContent = '';
  $('newProject').classList.add('on');
  $('npId').focus();
}

// Pindah proyek: tetap di menu yang sama (percakapan satu nomor -> daftar percakapan).
$('projectSel').addEventListener('change', () => {
  const id = $('projectSel').value;
  $('projectSel').value = project;
  if (id === '+') return openNewProject();
  if (id !== project) void go(pathOf(page && page !== 'chat' && page !== 'notfound' ? page : page === 'chat' ? 'percakapan' : 'beranda', id));
});
$('npCancel').addEventListener('click', () => { if (projects.length) $('newProject').classList.remove('on'); });
$('newProjectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('npErr').textContent = '';
  try {
    const r = await api('projects', { method: 'POST', body: JSON.stringify({
      id: $('npId').value.trim().toLowerCase(), name: $('npName').value, template: $('npTemplate').value,
    }) });
    $('newProject').classList.remove('on');
    $('newProjectForm').reset();
    projects = (await api('projects')).projects;
    toast(T('Proyek sudah dibuat. Sekarang tautkan WhatsApp-nya di halaman ini.', 'Project created. Link its WhatsApp here.'));
    dirty = false;
    changed.clear();
    projectDirty = false;
    await go(pathOf('whatsapp', r.project.id));
  } catch (err) { $('npErr').textContent = err.message; }
});

// ---------- lipatan yang diingat, daftar "Di halaman ini" ----------
/**
 * Lipatan bertanda data-remember (mis. Gaya & aturan balasan): tertutup sampai pernah dibuka.
 * Keadaan buka/tutupnya diingat per bagian di peramban ini.
 */
function rememberFolds() {
  for (const d of document.querySelectorAll('details[data-remember][id]')) {
    const key = 'fold:' + d.id;
    try { if (localStorage.getItem(key) === '1') d.open = true; } catch { /* penyimpanan diblokir: tetap tertutup */ }
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(key, d.open ? '1' : '0'); } catch { /* berlaku untuk kunjungan ini saja */ }
    });
  }
}

/**
 * Daftar "Di halaman ini" di kanan halaman (hanya tampil di layar >= 1100 px), sama untuk semua halaman.
 * Isinya bagian-bagian halaman yang sedang tampil, urut seperti di halaman: tiap kartu yang terlihat dan
 * berjudul (.ch h2), plus blok bertanda data-toc (deretan angka dan grafik Beranda, beberapa lipatan).
 * Kurang dari dua bagian: daftar tidak tampil dan halaman tetap satu kolom.
 * Bagian yang ditandai = bagian pertama yang terlihat di bawah kepala tetap (IntersectionObserver);
 * di ujung bawah halaman, bagian terakhir.
 */

/** id untuk bagian yang belum punya id: id halaman + judul Indonesianya, mis. "pengaturan-follow-up". */
function tocSlug(pageId, title) {
  const s = String(title).replace(/<[^>]*>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return pageId + '-' + (s || 'bagian');
}

/** Judul satu bagian: [teks Indonesia (untuk id), teks dalam bahasa tampilan sekarang], atau null. */
function tocTitle(n) {
  if (n.dataset.toc) return [n.dataset.toc, T(n.dataset.toc, n.dataset.tocEn || n.dataset.toc)];
  const s = n.tagName === 'DETAILS' ? n.querySelector(':scope > summary') : null;
  const h = s ? s.querySelector('[data-en]') || s : n.querySelector(':scope > .ch h2');
  if (!h) return null;
  const now = h.textContent.trim();
  // applyLang menyimpan teks Indonesia aslinya di data-id; judul tanpa data-en sama di kedua bahasa.
  return now ? [h.dataset.id !== undefined ? h.dataset.id : now, now] : null;
}

/**
 * Bagian berjudul satu halaman (section[data-page]), urut seperti di halaman. Bagian tanpa id diberi id.
 * `visible` = hanya yang sedang terlihat; tanpa itu, semua kecuali yang disembunyikan dengan atribut hidden.
 */
function sectionsOf(sec, visible) {
  const out = [];
  for (const n of sec.querySelectorAll('.card, [data-toc]')) {
    // Kartu di dalam kartu atau blok lain (mis. grafik di kartu biaya, grafik Beranda) ikut induknya.
    if (n.parentElement.closest('.card, [data-toc], section[data-page]') !== sec) continue;
    if (visible ? !n.getClientRects().length : n.closest('[hidden]')) continue; // tersembunyi
    const title = tocTitle(n);
    if (!title) continue;
    if (!n.id) {
      const base = tocSlug(sec.dataset.page, title[0]);
      let id = base;
      for (let k = 2; document.getElementById(id); k++) id = base + '-' + k;
      n.id = id;
    }
    out.push({ node: n, label: title[1] });
  }
  return out;
}

/** Bagian halaman yang sedang tampil. */
function tocEntries() {
  const sec = document.querySelector('section[data-page].on');
  return sec ? sectionsOf(sec, true) : [];
}

/** Bagian yang sedang diamati (kosong = daftar tidak tampil). */
let tocItems = [];
const tocLinks = () => [...$('pageToc').querySelectorAll('a[href^="#"]')];
const tocTargets = () => tocItems.map((x) => x.node);
/** Bagian yang sedang memotong pita baca (dari bawah kepala sampai 45% tinggi layar). */
const tocSeen = new Map();
let tocObserver = null;
/** Timer selagi hasil klik digulung: selama ini tanda tidak diubah oleh guliran. */
let tocHold = 0;

function markToc(id) {
  for (const a of tocLinks()) {
    const on = a.hash === '#' + id;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
  }
}

function updateToc() {
  if (!tocItems.length || tocHold) return;
  const targets = tocTargets();
  const root = document.documentElement;
  const atBottom = window.innerHeight + window.scrollY >= root.scrollHeight - 4;
  const at = atBottom ? targets[targets.length - 1] : targets.find((t) => tocSeen.get(t.id));
  if (at) markToc(at.id);
}

/** Pasang ulang pengamat: pita bacanya bergantung pada tinggi kepala, yang bisa berubah. */
function watchToc() {
  if (tocObserver) tocObserver.disconnect();
  tocObserver = null;
  tocSeen.clear();
  if (!tocItems.length || typeof IntersectionObserver !== 'function') return;
  const top = Math.ceil($('chrome').getBoundingClientRect().height) + 16;
  tocObserver = new IntersectionObserver((entries) => {
    for (const e of entries) tocSeen.set(e.target.id, e.isIntersecting);
    updateToc();
  }, { rootMargin: '-' + top + 'px 0px -55% 0px' });
  for (const t of tocTargets()) tocObserver.observe(t);
}

/**
 * Susun ulang daftar untuk halaman yang sedang tampil. Dipanggil saat halaman ditampilkan, setelah ganti
 * bahasa (renderAll), dan setelah kartu ditambah, dihapus, atau disembunyikan (MutationObserver di bawah).
 * Kalau bagian dan judulnya tidak berubah, daftar dibiarkan (tanda yang sedang menyala tetap).
 */
function renderToc() {
  const items = page ? tocEntries() : [];
  const next = items.length >= 2 ? items : [];
  if (next.length === tocItems.length && next.every((x, i) => x.node === tocItems[i].node && x.label === tocItems[i].label)) return;
  const same = next.length === tocItems.length && next.every((x, i) => x.node === tocItems[i].node);
  const lit = same ? ($('pageToc').querySelector('a.on') || {}).hash : '';
  tocItems = next;
  for (const a of tocLinks()) a.remove();
  $('pageToc').append(...next.map((x) => el('a', { href: '#' + x.node.id, textContent: x.label })));
  $('pageToc').parentElement.classList.toggle('withtoc', next.length > 0);
  if (lit) markToc(lit.slice(1));
  if (!same) watchToc();
}

// Render yang menambah, menghapus, atau menyembunyikan kartu (mis. data halaman yang baru datang):
// susun ulang daftarnya sekali per bingkai. Perubahan di dalam kartu (tabel, grafik, tooltip) diabaikan.
{
  const PART = '.card, [data-toc]';
  const holds = (n) => n.nodeType === 1 && (n.matches(PART) || !!n.querySelector(PART));
  let frame = 0;
  new MutationObserver((list) => {
    if (frame) return;
    const hit = list.some((m) => (m.type === 'attributes' ? holds(m.target)
      : [...m.addedNodes, ...m.removedNodes].some(holds)));
    if (hit) frame = requestAnimationFrame(() => { frame = 0; renderToc(); });
  }).observe($('pageToc').parentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

function holdToc(ms) {
  clearTimeout(tocHold);
  tocHold = setTimeout(() => { tocHold = 0; }, ms);
}

$('pageToc').addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = document.getElementById(a.hash.slice(1));
  if (!target) return;
  e.preventDefault();
  if (target.tagName === 'DETAILS') target.open = true;
  markToc(target.id);
  // Tanda tetap pada yang diklik sampai guliran halus selesai (bagian terakhir bisa tidak sampai atas).
  holdToc(300);
  history.replaceState(null, '', location.pathname + location.search + a.hash);
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
});
window.addEventListener('scroll', () => {
  if (!tocItems.length) return;
  if (tocHold) holdToc(150); else updateToc();
}, { passive: true });
window.addEventListener('resize', () => { if (tocItems.length) watchToc(); });

// ---------- navigasi ----------
/** Pasang alamat di semua tautan menu untuk proyek yang sedang dibuka. */
function renderNav() {
  for (const a of document.querySelectorAll('a[data-nav]')) a.href = pathOf(a.dataset.nav);
  for (const a of document.querySelectorAll('a[data-to]')) a.href = pathOf(a.dataset.to);
  $('homeLink').href = pathOf('beranda');
  $('convBack').href = pathOf('percakapan');
  $('allQuestions').href = pathOf('produk') + '#questions';
}

/** Judul, keterangan, dan tanda menu untuk halaman yang sedang tampil. */
function renderMeta() {
  const navKey = page === 'chat' ? 'percakapan' : page;
  for (const a of $('nav').querySelectorAll('a[data-nav]')) {
    const on = a.dataset.nav === navKey;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const [crumb, title, desc] = PAGES[page]();
  $('title').textContent = title;
  $('desc').textContent = desc;
  $('desc').hidden = !desc;
  const p = projects.find((x) => x.id === project);
  renderBreadcrumb(p ? p.name : '', crumb, title);
  document.title = title + (p ? ' · ' + p.name : '') + ' · Alice AI';
  setDirty(dirty);
  $('convBack').hidden = page !== 'chat';
  if (page === 'chat' && conv && conv.contact) renderConvHead();
}

/** Jejak di bilah atas: proyek › kelompok menu › halaman. Yang terakhir tebal; yang sama dengan sebelumnya dilewati. */
function renderBreadcrumb(projectName, crumb, title) {
  const sep = () => { const i = ico('chevron-right'); i.classList.add('bc-sep'); return i; };
  const out = [];
  if (projectName) out.push(el('a', { href: pathOf('beranda'), textContent: projectName }));
  if (crumb && crumb !== title) out.push(page === 'chat' ? el('a', { href: pathOf('percakapan'), textContent: crumb }) : el('span', { textContent: crumb }));
  out.push(el('b', { textContent: title }));
  $('bc').replaceChildren(...out.flatMap((n, i) => (i ? [sep(), n] : [n])));
}

/** Tampilkan satu halaman dan muat datanya. */
function show(next, r = {}) {
  const prev = page;
  page = next;
  current = r;
  for (const s of document.querySelectorAll('section[data-page]')) s.classList.toggle('on', s.dataset.page === page);
  if (!KNOWLEDGE.includes(page)) closeTry();
  clearTimeout(waTimer);
  clearTimeout(convTimer);
  if (page !== 'chat') {
    if (noteTimer) void saveNote();
    if (orderTimer || orderPending.size) void saveOrder();
    conv = null;
  }
  renderMeta();
  // Halaman berdata: kerangka digambar langsung (sebelum permintaan apa pun), lalu datanya dimuat.
  // Pindah halaman dan ganti proyek memakai jalur yang sama.
  if (page === 'beranda') {
    homeData = null;
    renderHome();
    void loadHome();
  }
  if (page === 'percakapan') {
    // ?stage=<tahap> (mis. dari chip "Tahap lead" di Beranda) memilih saringannya.
    const st = new URLSearchParams(location.search).get('stage');
    if (st && FILTERS().some(([k]) => k === st)) leadFilter = st;
    leadsPending = true;
    renderLeads();
    void loadLeads();
  }
  if (page === 'chat') void openConv(r.phone);
  if (page === 'pesanan') {
    shopRows = null;
    shopRowsError = '';
    renderShopOrders();
    void loadShopOrders();
    void loadShopInfo();
  }
  if (page === 'marketplace') {
    readLinked();
    shopInfo = null;
    shopInfoError = '';
    renderMarketplace();
    void loadShopInfo();
  }
  if (page === 'produk') {
    // Daftar yang sudah dimuat Beranda langsung digambar: kartu ini dekat bawah halaman, jadi tanpa isinya
    // halaman terlalu pendek dan guliran ke #questions (dari "Lihat semua") berhenti di tempat yang salah.
    if (handoffData) renderHandoffs();
    void loadHandoffs();
  }
  if (page === 'whatsapp') {
    renderStatus();
    waPending = true;
    renderWa();
    void loadWa();
  }
  if (page === 'notifikasi') renderRecipients();
  if (page === 'lanjutan') {
    usageData = null;
    renderUsage();
    void loadAdvanced();
  }
  if (page === 'notfound') $('notFoundText').textContent = r.text || T('Alamat ini tidak ada di dashboard. Pilih menu di samping, atau kembali ke beranda.', 'This address does not exist in the dashboard.');
  renderToc();
  // Tautan ke bagian tertentu (#cost, #questions): buka lipatannya dan gulung ke sana.
  const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (target && target.closest('section[data-page].on')) {
    if (target.tagName === 'DETAILS') target.open = true;
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  } else if (prev !== page || page === 'chat') {
    window.scrollTo(0, 0);
  }
}

let currentUrl = location.pathname + location.search + location.hash;

/** Pindah ke alamat lain di dashboard tanpa memuat ulang halaman. */
async function go(url, opts = {}) {
  const u = new URL(url, location.href);
  let path = u.pathname;
  if (path === '/' && project) path = pathOf('beranda');
  const r = parseRoute(path);
  if (r.project && project && r.project !== project && dirty &&
    !confirm(T('Ada perubahan yang belum disimpan. Kalau pindah proyek sekarang, perubahan itu hilang. Tetap pindah?', 'There are unsaved changes. Switch project without saving?'))) return;
  const target = path + u.search + u.hash;
  // Alamat yang sama tidak menambah riwayat (mis. klik menu yang sedang dibuka).
  const same = target === location.pathname + location.search + location.hash;
  history[opts.replace || same ? 'replaceState' : 'pushState'](null, '', target);
  await route();
}

window.addEventListener('popstate', () => {
  const r = parseRoute(location.pathname);
  if (r.project && project && r.project !== project && dirty &&
    !confirm(T('Ada perubahan yang belum disimpan. Kalau pindah proyek sekarang, perubahan itu hilang. Tetap pindah?', 'There are unsaved changes. Switch project without saving?'))) {
    history.pushState(null, '', currentUrl);
    return;
  }
  void route();
});

// Tautan di dalam dashboard: pindah lewat router. Klik tengah, Ctrl/Cmd+klik,
// tautan ke tab baru, unduhan, dan alamat API dibiarkan ke peramban.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download')) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/assets/')) return;
  e.preventDefault();
  if (u.pathname === location.pathname && u.search === location.search && u.hash && u.hash !== location.hash) {
    history.pushState(null, '', u.pathname + u.search + u.hash);
    show(page, current);
    return;
  }
  void go(u.pathname + u.search + u.hash);
});

/** Proyek bawaan untuk "/": yang terakhir dibuka (cookie), yang aktif, atau yang pertama. */
function defaultProject() {
  const m = document.cookie.match(/(?:^|;\s*)last_project=([a-z0-9-]+)/);
  const last = m && projects.find((p) => p.id === m[1]);
  return (last || projects.find((p) => p.enabled) || projects[0]).id;
}

/** Buka satu proyek: muat keadaannya dan gambar ulang semua isian. */
async function openProject(id) {
  project = id;
  chat = [];
  known = {};
  leadData = null;
  homeData = null;
  handoffData = null;
  conv = null;
  wa = null;
  waError = '';
  leadError = '';
  usageData = null;
  shopInfo = null;
  shopInfoError = '';
  shopRows = null;
  shopRowsError = '';
  shopFilter = 'semua';
  $('shopSearch').value = '';
  setShopBadge();
  $('waNumber').value = '';
  clearQr();
  $('chat').replaceChildren(chatHint());
  state = await api('state');
  profile = state.profile;
  dirty = false;
  changed.clear();
  projectDirty = false;
  $('app').hidden = false;
  $('strip').hidden = false;
  $('helpFab').hidden = false;
  renderAll();
  // Tinggi kepala (kini dengan bilah keadaan) langsung ditulis, tidak menunggu ResizeObserver:
  // kalau menunggu, isi halaman sempat tergambar setinggi kepala lama lalu melompat turun.
  putHeight($('chrome'), '--chrome-h');
}

/** Baca alamat sekarang, buka proyeknya kalau perlu, lalu tampilkan halamannya. */
async function route() {
  const r = parseRoute(location.pathname);
  if (!projects.length) {
    // Belum ada proyek sama sekali: mulai dengan membuat satu.
    renderProjects();
    openNewProject();
    return;
  }
  if (r.login || r.root) {
    const next = new URLSearchParams(location.search).get('next');
    const safe = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && next !== '/login';
    return go(safe ? next : pathOf('beranda', defaultProject()), { replace: true });
  }
  if (r.redirect && r.page !== 'notfound') {
    history.replaceState(null, '', (r.page === 'chat' ? convPath(r.phone, r.project) : pathOf(r.page, r.project)) + location.search + location.hash);
  }
  const exists = projects.some((p) => p.id === r.project);
  const want = exists ? r.project : project || defaultProject();
  if (want !== project || !state) {
    await openProject(want);
    // Angka di menu Percakapan butuh daftar pelanggan; dua halaman ini memuatnya sendiri.
    if (r.page !== 'beranda' && r.page !== 'percakapan') void loadLeads();
    // Angka di menu Pesanan; dua halaman Tokopedia & Shop memuatnya sendiri.
    if (r.page !== 'pesanan' && r.page !== 'marketplace') void loadShopInfo();
  }
  renderProjects();
  if (!exists) show('notfound', { text: T('Proyek “', 'Project "') + r.project + T('” tidak ditemukan. Pilih proyek lain di menu samping.', '" does not exist. Choose a project above.') });
  else show(r.page, r);
  currentUrl = location.pathname + location.search + location.hash;
}

function showLogin() {
  $('login').classList.add('on');
  $('helpFab').hidden = true;
  closeHelp();
  setTimeout(() => $('pw').focus(), 0);
}

function renderAll() {
  applyLang();
  if (!profile) return;
  fillInputs();
  fillSettings();
  renderRecipients();
  renderLogo();
  renderFields();
  renderQuestions();
  renderRules();
  renderLessons();
  renderProducts();
  renderPdfs();
  renderCatalog();
  renderProjects();
  renderProject();
  renderStatus();
  renderNav();
  renderStrip();
  setBadge();
  if (!chat.length) $('chat').replaceChildren(chatHint());
  if (!helpHistory.length && $('helpChat').childElementCount) helpIntro();
  // Data halaman yang sudah dimuat cukup digambar ulang (mis. setelah ganti bahasa).
  if (leadData || page === 'percakapan') renderLeads();
  if (homeData || page === 'beranda') renderHome();
  if (handoffData) renderHandoffs();
  if (wa || page === 'whatsapp') renderWa();
  if (usageData || page === 'lanjutan') renderUsage();
  if (shopInfo || page === 'marketplace') renderMarketplace();
  if (shopRows || page === 'pesanan') renderShopOrders();
  if (conv) { conv.key = ''; renderConv(); }
  if (page) { renderMeta(); renderToc(); }
}

$('lang').addEventListener('click', (e) => {
  const next = e.target.dataset && e.target.dataset.lang;
  if (!next || next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch { /* tetap berlaku untuk kunjungan ini */ }
  renderAll();
  if (page === 'lanjutan') void loadAdvanced();
});

/** Simpan semua perubahan: baris proyek dulu (kalau diubah), lalu profil (kalau diubah). */
async function save(quiet = false) {
  $('save').disabled = true;
  try {
    let moved = false;
    if (projectDirty) {
      moved = $('projTransport').value !== (state.project && state.project.transport);
      await putProject({ name: $('projName').value, transport: $('projTransport').value, enabled: $('projEnabled').checked });
      // Baris proyek sudah tersimpan: kalau profil gagal, yang dikirim ulang hanya profil.
      projectDirty = false;
    }
    let r = {};
    if (changed.size) {
      const body = {};
      for (const k of changed) if (k !== 'files') body[k] = profile[k];
      r = await api('profile', { method: 'PUT', body: JSON.stringify(body) });
      profile = r.profile;
    }
    setDirty(false);
    renderAll();
    if (!quiet) toast(T('Perubahan tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.', 'Saved. The bot uses the new settings from the next message.') +
      (r.autoPdf ? ' ' + r.autoPdf + T(' produk baru otomatis dipasangi PDF.', ' new products were given a PDF automatically.') : '') +
      (moved ? T(' Jalur WhatsApp diganti, jadi bot menyala ulang di jalur baru.', ' WhatsApp channel changed: the bot restarts on the new channel.') : ''));
  } catch (e) {
    toast(e.message, true);
    setDirty(true);
  }
}
$('save').addEventListener('click', () => void save());

// Batalkan: muat ulang profil dan baris proyek dari server, jadi semua isian kembali ke yang tersimpan.
$('discard').addEventListener('click', async () => {
  $('discard').disabled = true;
  try {
    state = await api('state');
    profile = state.profile;
    setDirty(false);
    renderAll();
    toast(T('Perubahan dibuang.', 'Changes discarded.'));
  } catch (e) { toast(e.message, true); }
  $('discard').disabled = false;
});

// Cmd/Ctrl+S menyimpan, sama dengan tombol "Simpan & terapkan".
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  e.preventDefault();
  if (dirty && profile && !$('save').disabled) void save();
});

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

/** Mulai: daftar proyek (sekaligus memeriksa sesi), lalu halaman sesuai alamat. */
async function load() {
  const list = await api('projects');
  projects = list.projects;
  templates = list.templates;
  $('login').classList.remove('on');
  await route();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
    $('pw').value = '';
    await load();
  } catch (err) { $('loginErr').textContent = err.message; }
});

$('logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});

// Kepala tetap (bilah atas + bilah keadaan) dan bilah simpan: tingginya berubah saat bilah keadaan muncul
// atau saat isinya membungkus di HP, jadi diukur terus dan ditulis ke variabel CSS (--chrome-h untuk jarak
// atas halaman dan menu samping, --savebar-h untuk jarak bawah isi dan letak kabar singkat).
function putHeight(node, name) {
  document.documentElement.style.setProperty(name, Math.ceil(node.getBoundingClientRect().height) + 'px');
}
function watchHeight(node, name) {
  const put = () => putHeight(node, name);
  if (typeof ResizeObserver === 'function') new ResizeObserver(put).observe(node);
  put();
}

applyLang();
decorateSummaries();
rememberFolds();
watchHeight($('chrome'), '--chrome-h');
watchHeight($('savebar'), '--savebar-h');
if (location.pathname === '/login') showLogin();
load().catch(() => {});
