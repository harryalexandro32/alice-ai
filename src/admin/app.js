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
  beranda: '', percakapan: 'conversations',
  identitas: 'knowledge/identity', produk: 'knowledge/products', rekomendasi: 'knowledge/recommendations',
  brosur: 'knowledge/brochures', lainnya: 'knowledge/other',
  pengaturan: 'settings', whatsapp: 'settings/whatsapp', notifikasi: 'settings/notifications', lanjutan: 'settings/advanced',
};
/** Alamat lama (bahasa Indonesia) -> alamat baru. */
const OLD_ROUTES = {
  percakapan: 'conversations', pengetahuan: 'knowledge', pengaturan: 'settings',
  'pengetahuan/identitas': 'knowledge/identity', 'pengetahuan/produk': 'knowledge/products',
  'pengetahuan/rekomendasi': 'knowledge/recommendations', 'pengetahuan/brosur': 'knowledge/brochures',
  'pengetahuan/lainnya': 'knowledge/other',
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
const KNOWLEDGE = ['identitas', 'produk', 'rekomendasi', 'brosur', 'lainnya'];

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
  if (rest === 'knowledge') return { project: pid, page: 'identitas', redirect: true };
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
  beranda: () => ['', T('Beranda', 'Home'), T('Ringkasan 7 hari terakhir, pelanggan yang menunggu orang, dan pertanyaan yang belum bisa dijawab bot.', 'The last 7 days at a glance, customers waiting for a person, and questions the bot could not answer.')],
  percakapan: () => ['', T('Percakapan', 'Conversations'), T('Semua calon pelanggan yang chat dengan bot. Klik satu baris untuk membuka percakapannya dan membalas dari sini.', 'Every prospective customer who chatted with the bot. Click a row to open the conversation and reply from here.')],
  chat: () => [T('Percakapan', 'Conversations'), T('Percakapan', 'Conversation'), ''],
  identitas: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Identitas', 'Identity'), T('Siapa yang membalas chat, logonya, dan pembukaannya. Perubahan berlaku pada pesan berikutnya setelah disimpan.', 'Who replies to chats, the logo, and the opening. Changes apply to the next message after you save.')],
  produk: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Produk', 'Products'), T('Satu-satunya sumber jawaban bot. Yang tidak tertulis di sini tidak akan dijawabnya.', 'The bot\'s only source of answers. Anything not written here, it will not answer.')],
  rekomendasi: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Rekomendasi', 'Recommendations'), T('Apa yang ditanyakan bot ke pelanggan, dan cara ia memilih produk.', 'What the bot asks the customer, and how it picks a product.')],
  brosur: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Brosur', 'Brochures'), T('Brosur dan katalog PDF yang bisa dikirim bot ke pelanggan.', 'PDF brochures and catalogues the bot can send to customers.')],
  lainnya: () => [T('Pengetahuan bot', 'Bot knowledge'), T('Lainnya', 'Other'), T('Pertanyaan yang belum terjawab, pengetahuan lain, topik yang harus dijawab manusia, dan gaya balasan.', 'Unanswered questions, other knowledge, topics a human must answer, and the reply style.')],
  pengaturan: () => [T('Pengaturan', 'Settings'), T('Umum', 'General'), T('Proyek, saat admin ikut membalas, dan follow-up.', 'Project, when a human admin steps in, and follow-up.')],
  whatsapp: () => [T('Pengaturan', 'Settings'), 'WhatsApp', T('Tautkan nomor bot, lihat keadaan bot, dan pengaman nomornya.', 'Link the bot\'s number, see the bot\'s status and the number safeguard.')],
  notifikasi: () => [T('Pengaturan', 'Settings'), T('Notifikasi', 'Notifications'), T('Siapa yang dikabari bot, dan kabar mana ke siapa.', 'Who the bot notifies, and which news goes to whom.')],
  lanjutan: () => [T('Pengaturan', 'Settings'), T('Lanjutan', 'Advanced'), T('Mode uji, batas dan pengaman, irama balasan, biaya LLM, riwayat warning, dan catatan error.', 'Test mode, limits and safeguards, reply rhythm, LLM cost, alert history and the error log.')],
  notfound: () => ['', T('Halaman tidak ada', 'Page not found'), ''],
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
    throw new Error(T('Belum masuk.', 'Not signed in.'));
  }
  if (!res.ok) throw new Error(data.error || T('Gagal', 'Failed') + ' (' + res.status + ').');
  return data;
}

/** Tandai ada (atau tidak ada) perubahan; bilah simpan di bawah layar muncul selama ada perubahan. */
function setDirty(v, key) {
  dirty = v;
  if (v && key === 'project') projectDirty = true;
  else if (v && key) changed.add(key);
  if (!v) { changed.clear(); projectDirty = false; }
  $('save').disabled = !v;
  withIcon($('save'), 'check', T('Simpan & terapkan', 'Save & apply'));
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
const NOTIFY = [
  ['lead', () => T('Lead baru (data pelanggan lengkap)', 'New lead (customer data complete)'), 'staff'],
  ['butuh-staf', () => T('Pelanggan butuh staf (bot tidak bisa menjawab, minta orang, kirim suara/dokumen)', 'Customer needs staff (bot cannot answer, asks for a person, sends voice/document)'), 'staff'],
  ['wa-putus', () => T('WhatsApp terputus', 'WhatsApp disconnected'), 'owner'],
  ['kiriman-dijeda', () => T('Kiriman bot dijeda pengaman', 'Sending paused by the safeguard'), 'owner'],
  ['kiriman-gagal', () => T('Balasan dari dashboard gagal terkirim', 'Reply from the dashboard could not be sent'), 'owner'],
  ['llm', () => T('LLM bermasalah / jatah harian habis', 'LLM failing / daily limit reached'), 'owner'],
  ['bot-mati', () => T('Bot berhenti', 'Bot stopped'), 'owner'],
];
function renderRecipients() {
  const list = profile.recipients;
  const touch = () => setDirty(true, 'recipients');
  const body = el('tbody', {}, ...list.map((r, i) => {
    const role = el('select', {}, el('option', { value: 'owner', textContent: T('Pemilik', 'Owner') }), el('option', { value: 'staff', textContent: T('Staf', 'Staff') }));
    role.value = r.role;
    role.addEventListener('change', () => { r.role = role.value; touch(); });
    const cell = (k, ph) => el('td', { className: k === 'name' ? 'first' : '' }, cellInput(r[k], (v) => { r[k] = v; touch(); }, ph));
    return el('tr', {}, cell('name', T('mis. Bu Rina', 'e.g. Rina')), el('td', {}, role), cell('phone', T('0812… atau self', '0812… or self')), cell('email', 'nama@contoh.com'),
      cell('telegram', T('id chat, mis. 123456789', 'chat id, e.g. 123456789')),
      el('td', { className: 'act' }, xBtn(T('Hapus', 'Delete'), () => { list.splice(i, 1); touch(); renderRecipients(); })));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 6, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada penerima. Selama kosong, bot memakai nomor sales proyek (kartu Proyek di Pengaturan > Umum).', 'No recipients yet. While empty, the bot uses the project\'s sales number (Project card in Settings > General).') })));
  $('recipients').replaceChildren(headRow([T('Nama', 'Name'), T('Peran', 'Role'), 'WhatsApp', 'Email', 'Telegram']), body);

  const opts = [['owner', T('Pemilik', 'Owner')], ['staff', T('Staf', 'Staff')], ['both', T('Pemilik dan staf', 'Owner and staff')], ['none', T('Tidak dikirim', 'Not sent')]];
  $('routes').replaceChildren(el('thead', {}, el('tr', {}, el('th', { textContent: T('Jenis kabar', 'Kind of news') }), el('th', { textContent: T('Dikirim ke', 'Sent to') }))),
    el('tbody', {}, ...NOTIFY.map(([kind, label, def]) => {
      const sel = el('select', {}, ...opts.map(([v, t]) => el('option', { value: v, textContent: t })));
      sel.value = (profile.notifyRoutes || {})[kind] || def;
      sel.addEventListener('change', () => { profile.notifyRoutes = { ...(profile.notifyRoutes || {}), [kind]: sel.value }; setDirty(true, 'notifyRoutes'); });
      return el('tr', {}, el('td', { textContent: label() }), el('td', {}, sel));
    })));

  const ch = state && state.status && state.status.channels;
  const yes = T('siap', 'ready');
  const no = T('belum diatur di .env bot', 'not set in the bot\'s .env');
  $('channels').textContent = !ch
    ? T('Bot belum melapor, jadi belum diketahui jalur mana yang siap.', 'The bot has not reported yet, so it is unknown which channels are ready.')
    : 'WhatsApp: ' + yes + ' · Email: ' + (ch.email ? yes : no) + ' · Telegram: ' + (ch.telegram ? yes : no);
}
$('addRecipient').addEventListener('click', () => {
  if (profile.recipients.length >= 20) return toast(T('Maksimal 20 orang.', '20 people max.'), true);
  profile.recipients.push({ name: '', role: 'staff', phone: '', email: '', telegram: '' });
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
  if (file.size > 4000000) throw new Error(T('Berkas terlalu besar (maksimal 4 MB).', 'File too large (4 MB max).'));
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
  !readable ? name + T(': tidak terbaca (hasil pindai?). Pasangkan sendiri.', ': not readable (a scan?). Attach it by hand.')
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
  const head = el('thead', {}, el('tr', {}, el('th', { textContent: T('Berkas', 'File') }), el('th', { textContent: T('Produk yang memakai', 'Products using it') }), el('th', { textContent: T('Dibaca bot', 'Read by bot') }), el('th')));
  const rows = list.map((f) => {
    const using = profile.products.filter((p) => p.pdf === f.id);
    const free = profile.products.filter((p) => p.name && p.pdf !== f.id);
    const add = el('select', {}, el('option', { value: '', textContent: T('+ produk…', '+ product…') }),
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
      if (dirty) return toast(T('Simpan dulu perubahan lain sebelum menghapus PDF.', 'Save your other changes before deleting a PDF.'), true);
      if (!confirm(T('Hapus "', 'Delete "') + f.name + '"?' + (using.length ? ' ' + using.length + T(' produk akan kehilangan PDF-nya.', ' products will lose their PDF.') : ''))) return;
      try {
        profile = (await api('files/' + f.id, { method: 'DELETE' })).profile;
        renderProducts();
        renderPdfs();
        toast(T('PDF dihapus.', 'PDF deleted.'));
      } catch (e) { toast(e.message, true); }
    });
    const read = el('input', { type: 'checkbox', checked: Boolean(f.read) });
    read.addEventListener('change', async () => {
      read.disabled = true;
      try {
        profile.files = (await api('files/' + f.id + '/read', { method: 'POST', body: JSON.stringify({ read: read.checked }) })).files;
        toast(read.checked ? T('Bot sekarang membaca isi PDF ini. Uji lewat "Coba chat".', 'The bot now reads this PDF. Test it with "Try chat".') : T('Bot tidak lagi membaca isi PDF ini.', 'The bot no longer reads this PDF.'));
      } catch (e) { toast(e.message, true); }
      renderPdfs();
    });
    return el('tr', {}, el('td', {}, el('a', { href: mediaBase() + f.file, target: '_blank', rel: 'noopener', textContent: '📄 ' + f.name })),
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
  $('logoBox').replaceChildren(src ? el('img', { src, alt: 'Logo' }) : T('belum ada logo', 'no logo yet'));
  $('logoClear').style.display = src ? '' : 'none';
}
$('logoPick').addEventListener('click', () => pick(IMAGES, (f) => {
  if (f.file.endsWith('.pdf')) return toast(T('Logo harus berupa gambar.', 'The logo must be an image.'), true);
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
    const isName = el('input', { type: 'checkbox', checked: Boolean(f.isName), title: T('Dipakai untuk menyapa', 'Used to address the customer') });
    isName.addEventListener('change', () => {
      profile.leadFields.forEach((x) => (x.isName = false));
      f.isName = isName.checked;
      setDirty(true, 'leadFields');
      renderFields();
    });
    const del = xBtn(T('Hapus baris', 'Delete row'), () => {
      if (profile.leadFields.length <= 1) return toast(T('Minimal satu baris.', 'At least one row.'), true);
      profile.leadFields.splice(i, 1);
      setDirty(true, 'leadFields');
      renderFields();
    });
    body.append(el('tr', {}, mk('key', T('mis. kota', 'e.g. kota')), mk('label', T('mis. kota/alamat', 'e.g. kota/alamat')), mk('hint', T('apa yang dihitung sebagai jawabannya', 'what counts as the answer')),
      el('td', { className: 'center' }, isName), el('td', { className: 'act' }, del)));
  });
  $('fields').replaceChildren(headRow([T('Kunci', 'Key'), T('Sebutan ke pelanggan', 'What the customer is asked for'), T('Petunjuk untuk bot', 'Hint for the bot'), T('Nama', 'Name')]), body);
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
    el('td', {}, cellInput(q, (v) => { profile.questions[i] = v; setDirty(true, 'questions'); }, T('mis. Ukuran ruangannya berapa × berapa meter?', 'e.g. Ukuran ruangannya berapa × berapa meter?'))),
    el('td', { className: 'act' }, xBtn(T('Hapus pertanyaan', 'Delete question'), () => { profile.questions.splice(i, 1); setDirty(true, 'questions'); renderQuestions(); })))));
  if (!profile.questions.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada pertanyaan. Bot akan bertanya seperlunya saja.', 'No questions yet. The bot will only ask when it has to.') })));
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
    const box = el('textarea', { rows: Math.min(5, Math.max(2, Math.ceil((r || '').length / 90))), value: r, placeholder: T('mis. Pakai kalimat positif dan langsung ke inti.', 'e.g. Pakai kalimat positif dan langsung ke inti.'), style: 'border:0;border-radius:0;background:transparent' });
    box.addEventListener('input', () => { list[i] = box.value; setDirty(true, 'styleRules'); });
    return el('tr', {}, el('td', {}, box), el('td', { className: 'act' }, xBtn(T('Hapus aturan', 'Delete rule'), () => { list.splice(i, 1); setDirty(true, 'styleRules'); renderRules(); })));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada aturan. Bot memakai gaya bawaannya.', 'No rules yet. The bot uses its default style.') })));
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

// ---------- daftar produk ----------
const P_COLS = ['name', 'description', 'price', 'stock'];
const blankProduct = () => ({ name: '', description: '', price: '', stock: '', photos: [], pdf: '' });
const touchProducts = () => { setDirty(true, 'products'); updateKnowLen(); };
let focusProduct = () => {};

function renderProducts() {
  const list = profile.products;
  const pdfs = pdfLibrary();
  const ph = [T('mis. GFAF-40A', 'e.g. GFAF-40A'), T('jenis, ukuran, kegunaan', 'type, size, use'), T('mis. Rp 450.000', 'e.g. Rp 450.000'), T('mis. ada / 12 unit', 'e.g. ada / 12 unit')];

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
        if (f.file.endsWith('.pdf')) return toast(T('Itu PDF, bukan foto. Pakai kolom PDF.', 'That is a PDF, not a photo. Use the PDF column.'), true);
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
      pdf = el('div', { className: 'pdf' }, el('a', { href: mediaUrl(p.pdf), target: '_blank', rel: 'noopener', textContent: '📄 ' + cur.name, title: cur.name }),
        xBtn(T('Lepas PDF', 'Remove PDF'), () => { p.pdf = ''; touchProducts(); renderProducts(); renderPdfs(); }, 'x'));
    } else {
      const sel = el('select', {}, el('option', { value: '', textContent: T('Tanpa PDF', 'No PDF') }),
        el('option', { value: '+', textContent: T('⬆ Unggah PDF…', '⬆ Upload PDF…') }),
        ...pdfs.map((f) => el('option', { value: f.id, textContent: f.name })));
      sel.addEventListener('change', () => {
        if (sel.value === '+') {
          sel.value = '';
          return pick('application/pdf', (f) => {
            if (!f.file.endsWith('.pdf')) return toast(T('Berkas itu bukan PDF.', 'That file is not a PDF.'), true);
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
    return el('tr', {}, ...cells, el('td', {}, thumbs), el('td', {}, pdf), el('td', { className: 'act' }, del));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 7, style: 'padding:12px;color:var(--muted)', textContent: T('Belum ada produk.', 'No products yet.') })));
  $('products').replaceChildren(headRow([T('Nama', 'Name'), T('Keterangan', 'Description'), T('Harga', 'Price'), T('Stok', 'Stock'), T('Foto', 'Photos'), 'PDF']), body);
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
  const products = profile.products.map((x) => [x.name, v(x.description), v(x.price), v(x.stock), v(x.photos.join(', ')), v(x.pdf)].join(' | ')).join('\n');
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
  $('knowLen').textContent = profile.products.filter((p) => p.name).length + T(' produk · ±', ' products · ±') + n.toLocaleString(locale()) +
    T(' karakter dibaca bot di tiap balasan. Makin panjang, makin mahal tiap balasan.', ' characters read by the bot on every reply. The longer, the more each reply costs.');
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
  const addRow = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Baris', 'Row'));
  addRow.addEventListener('click', () => { t.rows.push(t.columns.map(() => '')); touchCatalog(); draw(); focusCell(t.rows.length - 1, 0); });
  const addCol = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Kolom', 'Column'));
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
  const name = cellInput(s.name, (v) => { s.name = v; title.textContent = v || blank; touchCatalog(); }, T('mis. Exhaust Fan Industri, Seri A', 'e.g. Exhaust Fan Industri, Seri A'));
  const facts = el('textarea', { rows: Math.max(2, s.facts.length + 1), value: s.facts.join('\n'), placeholder: T('Satu kalimat per baris: bahan, pemakaian, rentang ukuran, …', 'One sentence per line: material, use, size range, …') });
  facts.addEventListener('input', () => { s.facts = facts.value.split('\n').map((f) => f.trim()).filter(Boolean); touchCatalog(); });

  const body = el('div', { className: 'series-body' },
    el('div', { className: 'row' },
      el('label', { className: 'f' }, el('span', { textContent: T('Nama kelompok / seri', 'Group / series name') }), name),
      el('label', { className: 'f' }, el('span', { textContent: T('Keterangan umum', 'General notes') }), facts)));

  s.tables.forEach((t, ti) => {
    const { table, addRow, addCol } = tableNode(t);
    const tTitle = cellInput(t.title, (v) => { t.title = v; touchCatalog(); }, T('judul tabel, mis. Spesifikasi teknis', 'table title, e.g. Spesifikasi teknis'));
    const delT = el('button', { className: 'btn danger sm', type: 'button' }, ico('trash'), T('Hapus tabel', 'Delete table'));
    delT.addEventListener('click', () => {
      if (t.rows.length && !confirm(T('Hapus tabel "', 'Delete table "') + t.title + T('" beserta barisnya?', '" and its rows?'))) return;
      s.tables.splice(ti, 1);
      touchCatalog();
      renderCatalog();
    });
    body.append(el('div', { className: 'tblhead' }, tTitle), el('div', { className: 'scroll' }, table), el('div', { className: 'tblfoot' }, addRow, addCol, delT));
  });

  const addT = el('button', { className: 'btn ghost sm', type: 'button' }, ico('plus'), T('Tabel', 'Table'));
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
const chatHint = () => el('div', { className: 'msg note', textContent: T('Ketik seperti calon pelanggan.', 'Type as a prospective customer would (in Indonesian).') });

function addMsg(cls, text, photos, docs) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  for (const p of photos || []) m.append(el('img', { src: mediaBase() + p.file, alt: p.name, title: p.name }));
  for (const d of docs || []) m.append(el('a', { className: 'doc', href: mediaBase() + d.file, target: '_blank', rel: 'noopener', textContent: '📄 ' + d.name }));
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
      addMsg('bad', T('Balasan ini TIDAK akan dikirim (', 'This reply will NOT be sent (') + r.rejected + '):\n\n' + r.reply);
    } else {
      addMsg('out', r.reply, r.photos, r.docs);
    }
    Object.assign(known, r.fields);
    const got = Object.entries(r.fields).map(([k, v]) => k + ' = ' + v).join(' · ');
    const n = r.photos.length + r.docs.length;
    addMsg('note', T('niat: ', 'intent: ') + r.intent + (got ? T(' · tercatat: ', ' · captured: ') + got : '') + (n ? ' · ' + n + T(' lampiran', ' attachments') : ''));
    chat.push({ dir: 'in', text }, { dir: 'out', text: r.reply });
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
  else if ($('importDlg').classList.contains('on')) $('importDlg').classList.remove('on');
});

// ---------- bantu tampilan ----------
const when = (at) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
const clock = (at) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dayLabel = (at) => new Date(at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const int = (n) => Math.round(n).toLocaleString(locale());
const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const idr = (n) => 'Rp ' + n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 1 : 0 });
const pct = (a, b) => (b ? Math.round((a * 100) / b) + '%' : '-');
const emptyRow = (cols, text) => el('tr', {}, el('td', { colSpan: cols, style: 'color:var(--muted)', textContent: text }));

// ---------- grafik ----------
// Grafik sebagai SVG polos yang digambar di sini (dashboard tanpa pustaka grafik).
// Semua grafik memakai columnChart (batang per hari, tunggal atau bertumpuk) dan
// stackedBar100 (satu batang 100 %), supaya tampilan dan perilakunya sama:
// - seri N selalu berwarna --viz-N (urutan tetap, tidak diputar atau diurutkan ulang);
// - teks memakai warna teks; identitas seri hanya dari kotak warna di sampingnya;
// - legenda hanya kalau ada 2 seri atau lebih;
// - tiap batang/segmen bisa disorot dengan tetikus dan papan ketik (satu tooltip per grafik);
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

/** Legenda: kotak warna + nama (+ jumlah); kalau ada href, tiap butir adalah tautan. */
function legend(items) {
  return el('div', { className: 'legend' }, ...items.map((it) => {
    const kids = [swatch(it.slot), el('span', { textContent: it.label }), it.count !== undefined ? el('b', { textContent: it.count }) : null];
    return it.href ? el('a', { href: it.href }, ...kids) : el('div', {}, ...kids);
  }));
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
function columnChart({ el: host, title, help, days, series, stacked = false, format = int }) {
  const ser = stacked ? series : series.slice(0, 1);
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
    const H = 190, mt = 20, mb = 24, mr = 2;
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

/**
 * Satu batang mendatar 100 % (bagian dari keseluruhan).
 * parts: [{ key, label, value, slot, href }] dalam urutan tetap; klik segmen atau butir legenda membuka href.
 */
function stackedBar100({ el: host, title, help, parts }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const { view, plot, tip, table } = chartFrame(host, title, help);
  view.append(legend(parts.map((p) => ({ slot: p.slot, label: p.label, count: int(p.value), href: p.href }))));
  const td = (kid, num) => el('td', { className: num ? 'num' : '' }, kid);
  table.append(el('table', { className: 'list' },
    el('thead', {}, el('tr', {}, el('th', { textContent: T('Tahap', 'Stage') }), el('th', { className: 'num', textContent: T('Jumlah', 'Count') }), el('th', { className: 'num', textContent: '%' }))),
    el('tbody', {}, ...parts.map((p) => el('tr', {}, td(el('a', { href: p.href, textContent: p.label })), td(int(p.value), true), td(pct(p.value, total), true)))),
    el('tfoot', {}, el('tr', {}, td('Total'), td(int(total), true), td(total ? '100%' : '-', true)))));

  const draw = (W) => {
    const H = 30, bh = 28;
    const root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group', 'aria-label': title });
    if (!total) {
      root.append(svg('rect', { class: 'track', x: 0, y: 0, width: W, height: bh, rx: RADIUS }));
      root.append(svg('text', { class: 'empty', x: W / 2, y: bh / 2 + 4, 'text-anchor': 'middle' }, T('Belum ada data', 'No data yet')));
      plot.replaceChildren(root, tip);
      tip.hidden = true;
      return;
    }
    const shown = parts.filter((p) => p.value > 0);
    const avail = W - GAP * (shown.length - 1);
    const marks = [];
    let x = 0;
    shown.forEach((p, j) => {
      const w = j === shown.length - 1 ? W - x : Math.max(3, (avail * p.value) / total);
      const rl = j === 0 ? RADIUS : 0, rr = j === shown.length - 1 ? RADIUS : 0;
      const mark = svg('path', { class: 'mark viz' + p.slot, d: roundRect(x, 0, w, bh, [rl, rr, rr, rl]) });
      root.append(mark);
      // Label di dalam segmen hanya kalau muat dengan jarak 8 px di kiri-kanan.
      const full = p.label + ' ' + int(p.value);
      const text = textWidth(full, '600 12px') + 16 <= w ? full : textWidth(int(p.value), '600 12px') + 16 <= w ? int(p.value) : '';
      if (text) root.append(svg('text', { class: 'seg-label on' + p.slot, x: x + w / 2, y: bh / 2 + 4, 'text-anchor': 'middle' }, text));
      marks.push({ p, x, w, mark });
      x += w + GAP;
    });
    const hide = () => { tip.hidden = true; for (const m of marks) m.mark.classList.remove('hot'); };
    for (const m of marks) {
      const rows = parts.map((p) => ({ slot: p.slot, value: int(p.value) + ' (' + pct(p.value, total) + ')', label: p.label, cur: p === m.p }));
      const hit = svg('rect', { class: 'hit link', x: m.x, y: 0, width: m.w, height: bh, tabindex: 0, role: 'link',
        'aria-label': m.p.label + ': ' + int(m.p.value) + ' (' + pct(m.p.value, total) + '). ' + T('Buka daftarnya.', 'Open the list.') });
      const show = () => {
        hide();
        m.mark.classList.add('hot');
        fillTip(tip, title, rows, { value: int(total), label: 'Total' });
        // Di bawah batang, sejajar dengan segmen yang disorot.
        const tw = tip.offsetWidth;
        tip.style.left = Math.round(Math.max(0, Math.min(W - tw, m.x + m.w / 2 - tw / 2))) + 'px';
        tip.style.top = (bh + 8) + 'px';
      };
      const open = () => void go(m.p.href);
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', hide);
      hit.addEventListener('blur', hide);
      hit.addEventListener('click', open);
      hit.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      root.append(hit);
    }
    plot.replaceChildren(root, tip);
    tip.hidden = true;
  };
  onWidth(plot, draw);
}

const STAGES = ['baru', 'dihubungi', 'closing', 'batal'];
const stageLabel = (s) => ({ baru: T('Baru', 'New'), dihubungi: T('Dihubungi', 'Contacted'), closing: 'Closing', batal: T('Batal', 'Cancelled') })[s] || s;
function stageSelect(value, onChange) {
  const sel = el('select', {}, ...STAGES.map((s) => el('option', { value: s, textContent: stageLabel(s) })));
  sel.value = value || 'baru';
  sel.setAttribute('aria-label', T('Tahap', 'Stage'));
  sel.addEventListener('change', () => onChange(sel.value, sel));
  return sel;
}
/** Simpan tahap pipeline satu pelanggan. */
async function putStage(phone, stage) {
  const r = await api('leads/' + encodeURIComponent(phone), { method: 'PUT', body: JSON.stringify({ stage }) });
  if (leadData) for (const c of leadData.rows) if (c.phone === phone) c.stage = r.stage;
  toast(T('Tahap diubah ke ', 'Stage changed to ') + stageLabel(r.stage) + '.');
  return r;
}

/** Nama pelanggan: isian "nama" dari bot, lalu nama profil WhatsApp-nya. */
function nameOf(c) {
  const key = profile && (profile.leadFields.find((f) => f.isName) || {}).key;
  return (key && c.lead && c.lead[key]) || c.waName || '';
}

// ---------- lead / percakapan ----------
let leadData = null;
let leadFilter = 'semua';

async function loadLeads() {
  try {
    leadData = await api('leads');
    renderLeads();
    setBadge();
  } catch (e) { toast(e.message, true); }
}

const FILTERS = () => [
  ['semua', T('Semua', 'All')], ['baru', stageLabel('baru')], ['dihubungi', stageLabel('dihubungi')],
  ['closing', stageLabel('closing')], ['batal', stageLabel('batal')], ['staf', T('Perlu staf', 'Needs staff')],
];
const matchFilter = (c, f) => f === 'semua' || (f === 'staf' ? c.needsSales : (c.stage || 'baru') === f);

function visibleLeads() {
  const q = $('leadSearch').value.trim().toLowerCase();
  return leadData.rows.filter((c) => {
    if (!matchFilter(c, leadFilter)) return false;
    if (!q) return true;
    return [c.phone, c.summary || '', c.note || '', c.waName || '', ...Object.values(c.lead)].join(' ').toLowerCase().includes(q);
  });
}

function renderFilters() {
  const rows = leadData ? leadData.rows : [];
  $('leadFilters').replaceChildren(...FILTERS().map(([k, label]) => {
    const b = el('button', { type: 'button', className: k === leadFilter ? 'on' : '' }, label, el('small', { textContent: String(rows.filter((c) => matchFilter(c, k)).length) }));
    b.setAttribute('aria-pressed', String(k === leadFilter));
    b.addEventListener('click', () => { leadFilter = k; renderLeads(); });
    return b;
  }));
}

function renderLeads() {
  if (!leadData || !profile) return;
  const r = leadData;
  renderFilters();
  const nameKey = (profile.leadFields.find((f) => f.isName) || {}).key;
  const fields = r.fields.filter((f) => f.key !== nameKey);
  const head = el('tr', {}, el('th', { textContent: T('Pelanggan', 'Customer') }), el('th', { textContent: T('Tahap', 'Stage') }),
    ...fields.map((f) => el('th', { textContent: f.label })),
    el('th', { textContent: T('Ringkasan percakapan', 'Conversation summary') }), el('th', { textContent: 'Status' }), el('th', { textContent: 'Bot' }),
    el('th', { textContent: T('Terakhir chat', 'Last message') }));
  const list = visibleLeads();
  const rows = list.map((c) => {
    // Menunggu jam tenang = bot tetap aktif di chat ini, hanya balasannya tertunda.
    const box = el('input', { type: 'checkbox', checked: !c.hold || c.hold === 'tenang' });
    box.setAttribute('aria-label', T('Bot aktif di chat ini', 'Bot active in this chat'));
    box.addEventListener('change', async () => {
      if (box.checked && c.hold === 'berhenti' && !confirmOptOutResume()) {
        box.checked = false;
        return;
      }
      box.disabled = true;
      try {
        await api('leads/' + encodeURIComponent(c.phone) + '/bot', { method: 'POST', body: JSON.stringify({ mode: box.checked ? 'on' : 'off' }) });
        toast(box.checked ? T('Chat ini dikembalikan ke bot.', 'This chat is handed back to the bot.') : T('Bot dijeda di chat ini.', 'The bot is paused in this chat.'));
      } catch (e) { toast(e.message, true); }
      await loadLeads();
    });
    const why = holdLabel(c.hold);
    const stage = stageSelect(c.stage, async (v, sel) => {
      sel.disabled = true;
      try { await putStage(c.phone, v); renderFilters(); } catch (e) { toast(e.message, true); sel.value = c.stage; }
      sel.disabled = false;
    });
    const name = nameOf(c);
    const who = el('td', { className: 'who' }, el('a', { href: convPath(c.phone), textContent: name || c.phone }),
      c.note ? el('span', { className: 'note-ico', textContent: ' ✎', title: c.note }) : null,
      name ? el('small', { textContent: c.phone }) : null);
    const status = el('td', {}, el('span', { className: 'chip ' + (c.complete ? 'ok' : ''), textContent: c.complete ? T('lengkap', 'complete') : T('belum lengkap', 'incomplete') }),
      c.needsSales ? el('span', { className: 'chip warn', textContent: T('perlu staf', 'needs staff'), style: 'margin-left:4px' }) : null);
    const tr = el('tr', {}, who, el('td', {}, stage), ...fields.map((f) => el('td', { textContent: c.lead[f.key] || '-' })),
      el('td', { className: 'sum', textContent: c.summary || '-' }), status,
      el('td', {}, el('label', { className: 'switch' }, box, why ? el('span', { className: 'chip ' + (c.hold === 'berhenti' ? 'danger' : 'warn'), textContent: why }) : null)),
      el('td', { textContent: c.lastAt ? when(c.lastAt) : T('belum pernah chat', 'never chatted'), style: 'white-space:nowrap' }));
    // Klik di mana saja pada baris (selain kontrolnya) membuka percakapannya.
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button, select, input, label, textarea')) return;
      void go(convPath(c.phone));
    });
    return tr;
  });
  const empty = r.rows.length ? T('Tidak ada yang cocok dengan pencarian atau saringan ini.', 'Nothing matches this search or filter.') : T('Belum ada percakapan.', 'No conversations yet.');
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
  const lines = [[T('Nomor', 'Number'), ...r.fields.map((f) => f.label), T('Tahap', 'Stage'), T('Catatan', 'Note'), T('Ringkasan', 'Summary'), T('Lengkap', 'Complete'),
    T('Perlu staf', 'Needs staff'), 'Bot', T('Terakhir chat', 'Last message')]];
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

// ---------- satu percakapan ----------
/** Percakapan yang sedang dibuka: data terakhir dari server + pesan lama yang dimuat. */
let conv = null;
let convTimer = null;
let noteTimer = null;

async function openConv(phone) {
  if (!conv || conv.phone !== phone) {
    conv = { phone, older: [], olderMore: false, key: '', first: true };
    $('thread').replaceChildren(el('div', { className: 'daysep', textContent: T('memuat…', 'loading…') }));
    $('convNote').value = '';
    $('convNoteState').textContent = '';
    $('convName').textContent = phone;
    $('convPhone').textContent = '';
    $('convLead').replaceChildren();
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
      const r = await api('leads/' + encodeURIComponent(phone));
      if (!conv || conv.phone !== phone || page !== 'chat') return;
      Object.assign(conv, r);
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
    : hold === 'tenang' ? T('menunggu jam tenang berakhir', 'waiting for quiet hours to end') : '';
}
/** Pelanggan ini minta tidak dihubungi: menyalakan bot lagi berarti mengabaikan permintaannya. */
function confirmOptOutResume() {
  return confirm(T('Pelanggan ini minta tidak dihubungi lagi. Aktifkan bot lagi dan abaikan permintaannya?',
    'This customer asked not to be contacted again. Turn the bot back on and ignore the request?'));
}

function renderConvHead() {
  const c = conv.contact;
  const name = nameOf(c);
  $('convName').textContent = name || c.phone;
  $('convPhone').textContent = [name ? c.phone : '', c.waName && c.waName !== name ? 'WA: ' + c.waName : ''].filter(Boolean).join(' · ');
  $('title').textContent = name || c.phone;
  document.title = (name || c.phone) + ' · Alice AI';
  const [holdText, holdCls] = c.hold === 'berhenti' ? [T('Minta tidak dihubungi', 'Asked not to be contacted'), 'danger']
    : c.hold === 'admin' ? [T('Bot diam: admin membalas', 'Bot quiet: an admin replied'), 'warn']
    : c.hold === 'tombol' ? [T('Bot dijeda di chat ini', 'Bot paused in this chat'), 'warn']
    : c.hold === 'tenang' ? [T('Bot aktif: menunggu jam tenang berakhir', 'Bot active: waiting for quiet hours to end'), 'warn']
    : [T('Bot aktif', 'Bot active'), 'ok'];
  $('convHold').textContent = holdText + (c.needsSales ? T(' · perlu staf', ' · needs staff') : '');
  $('convHold').className = 'chip ' + (c.needsSales ? 'danger' : holdCls);
  const off = botHeld(c.hold);
  withIcon($('convBot'), off ? 'play' : 'pause', c.hold === 'berhenti' ? T('Aktifkan bot lagi (abaikan permintaan berhenti)', 'Turn the bot back on (ignore the stop request)')
    : off ? T('Aktifkan bot lagi', 'Turn the bot back on') : T('Jeda bot di chat ini', 'Pause the bot in this chat'));
  $('convHandled').hidden = !c.needsSales;
  if ($('convStage').options.length !== STAGES.length || $('convStage').dataset.lang !== lang) {
    $('convStage').replaceChildren(...STAGES.map((s) => el('option', { value: s, textContent: stageLabel(s) })));
    $('convStage').dataset.lang = lang;
  }
  if (document.activeElement !== $('convStage')) $('convStage').value = c.stage || 'baru';
  // Catatan yang sedang diketik tidak ditimpa oleh pembaruan berkala.
  if (document.activeElement !== $('convNote') && !noteTimer) $('convNote').value = c.note || '';
  const facts = conv.fields.map((f) => [f.label, c.lead[f.key]]).filter(([, v]) => v);
  $('convLead').replaceChildren(...[
    ...facts.flatMap(([k, v], i) => [i ? ' · ' : '', el('b', { textContent: k + ': ' }), v]),
    c.summary ? el('div', { style: 'flex-basis:100%', textContent: T('Ringkasan: ', 'Summary: ') + c.summary }) : null,
    !facts.length && !c.summary ? T('Belum ada data pelanggan yang tercatat.', 'No customer data recorded yet.') : null,
  ].filter((x) => x !== null));
  $('convLead').hidden = false;
  $('replyBlocked').hidden = c.canReply;
  $('replyText').disabled = $('replySend').disabled = !c.canReply;
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
    else meta.push(p.attempts ? T('mencoba lagi…', 'retrying…') : T('menunggu terkirim…', 'waiting to send…'));
  }
  return el('div', { className: 'bubble ' + m.dir, textContent: m.text }, el('span', { className: 'meta' + (bad ? ' bad' : ''), textContent: meta.join(' · ') }));
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
    toast(on ? T('Bot aktif lagi di chat ini.', 'The bot is active again in this chat.') : T('Bot dijeda di chat ini.', 'The bot is paused in this chat.'));
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
  if (!conv || !conv.contact) return;
  try {
    const r = await putStage(conv.phone, $('convStage').value);
    conv.contact.stage = r.stage;
  } catch (e) { toast(e.message, true); $('convStage').value = conv.contact.stage; }
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
  $('questionList').replaceChildren(...(list.length ? list.map((g) => {
    const box = el('textarea', { rows: 2, maxLength: 4000, placeholder: T('Tulis jawabannya seperti Anda menjawab pelanggan…', 'Write the answer as you would tell the customer…') });
    box.setAttribute('aria-label', T('Jawaban', 'Answer'));
    const add = el('button', { type: 'button', className: 'btn' }, ico('book-plus'), T('Tambahkan ke pengetahuan', 'Add to knowledge'));
    const skip = el('button', { type: 'button', className: 'btn ghost' }, ico('x'), T('Abaikan', 'Ignore'));
    add.addEventListener('click', () => void resolveQuestion(g, 'ditambahkan', box.value, [add, skip]));
    skip.addEventListener('click', () => void resolveQuestion(g, 'diabaikan', '', [add, skip]));
    return el('div', { className: 'qitem' }, el('div', { className: 'q', textContent: g.question }),
      el('div', { className: 'm' }, askedLine(g) + T(' · contoh dari ', ' · e.g. from '), el('a', { className: 'link', href: convPath(g.phone), textContent: g.phone })),
      box, el('div', { className: 'acts' }, add, skip));
  }) : [el('p', { className: 'help', textContent: T('Belum ada pertanyaan yang menunggu jawaban. Pertanyaan yang dioper bot ke staf muncul di sini.', 'No questions waiting for an answer. Questions the bot hands to staff appear here.') })]));
}

async function resolveQuestion(g, resolution, answer, buttons) {
  if (resolution === 'ditambahkan') {
    if (!answer.trim()) return toast(T('Tulis jawabannya dulu.', 'Write the answer first.'), true);
    if (changed.has('notes')) return toast(T('Simpan dulu perubahan di "Pengetahuan lain" sebelum menambahkan jawaban.', 'Save your changes to "Other knowledge" before adding an answer.'), true);
  }
  for (const b of buttons) b.disabled = true;
  try {
    const r = await api('handoffs/' + g.id + '/resolve', { method: 'POST', body: JSON.stringify({ resolution, ...(answer.trim() ? { answer } : {}) }) });
    if (r.profile) {
      profile.notes = r.profile.notes;
      for (const n of document.querySelectorAll('[data-key="notes"]')) n.value = profile.notes;
      updateKnowLen();
    }
    handoffData = (handoffData || []).filter((x) => x.id !== g.id);
    renderHandoffs();
    if (homeData) renderHome();
    toast(resolution === 'ditambahkan'
      ? T('Jawaban ditambahkan ke "Pengetahuan lain". Bot memakainya mulai pesan berikutnya.', 'Answer added to "Other knowledge". The bot uses it from the next message.')
      : T('Pertanyaan diabaikan.', 'Question ignored.'));
  } catch (e) {
    toast(e.message, true);
    for (const b of buttons) b.disabled = false;
  }
}

// ---------- beranda ----------
let homeData = null;
/** Jendela grafik Beranda (hari); angka di kotak tetap 7 hari. */
const CHART_DAYS = 14;

async function loadHome() {
  try {
    const [metrics, trend, h, leads] = await Promise.all([api('metrics'), api('metrics?days=' + CHART_DAYS), api('handoffs?status=open'), api('leads')]);
    homeData = { metrics, trend };
    handoffData = h.groups;
    leadData = leads;
    renderHome();
    setBadge();
  } catch (e) { toast(e.message, true); }
}

/** Lama waktu dalam detik -> "45 dtk" / "3 mnt" / "1 jam". */
function duration(s) {
  if (s === null || s === undefined) return '-';
  if (s < 60) return s + T(' dtk', ' s');
  if (s < 3600) return Math.round(s / 60) + T(' mnt', ' min');
  return T('≥ 1 jam', '≥ 1 h');
}

function renderHome() {
  if (!homeData) return;
  const m = homeData.metrics;
  const tile = (k, v, s, extra) => el('div', { className: 'tile' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }), extra || null, el('div', { className: 's', textContent: s }));
  // Meter: jalur biru muda, isinya sepanjang rasio; angkanya tetap judul kotak.
  const meter = (a, b) => {
    const n = el('div', { className: 'meter' }, el('span', { style: 'width:' + (b ? Math.min(100, (a * 100) / b) : 0) + '%' }));
    n.setAttribute('aria-hidden', 'true');
    return n;
  };
  const week = m.days.reduce((a, d) => a + d.conversations, 0);
  $('tiles').replaceChildren(
    tile(T('Percakapan hari ini', 'Conversations today'), int(m.today), T('Orang yang chat hari ini; ', 'People chatting today; ') + int(week) + T(' dalam 7 hari', ' in 7 days')),
    tile(T('Dioper ke staf', 'Handed to staff'), pct(m.handed.count, m.handed.total), int(m.handed.count) + T(' dari ', ' of ') + int(m.handed.total) + T(' percakapan dalam 7 hari', ' conversations in 7 days'), meter(m.handed.count, m.handed.total)),
    tile(T('Waktu balas median', 'Median reply time'), duration(m.replyMedianSec), T('Dari pesan pelanggan sampai balasan bot', 'From a customer message to the bot\'s reply')),
    tile(T('Follow-up dijawab', 'Follow-ups answered'), pct(m.followup.answered, m.followup.sent), int(m.followup.answered) + T(' dari ', ' of ') + int(m.followup.sent) + T(' pelanggan membalas dalam 48 jam', ' customers replied within 48 h'), meter(m.followup.answered, m.followup.sent)));

  // Grafik: jendela CHART_DAYS hari (terlama di kiri); tahap lead dari semua kontak.
  const t = homeData.trend;
  columnChart({ el: $('chartConv'), title: T('Percakapan per hari', 'Conversations per day'),
    help: T('Orang yang chat dengan bot, ' + t.windowDays + ' hari terakhir.', 'People who chatted with the bot, last ' + t.windowDays + ' days.'),
    days: t.days, series: [{ key: 'conversations', label: T('Percakapan', 'Conversations'), slot: 1 }] });
  columnChart({ el: $('chartMsgs'), title: T('Pesan per hari', 'Messages per day'), stacked: true,
    help: T('Pesan masuk dan balasan, ' + t.windowDays + ' hari terakhir.', 'Incoming messages and replies, last ' + t.windowDays + ' days.'),
    days: t.messagesByDay, series: [
      { key: 'in', label: T('Dari pelanggan', 'From customers'), slot: 1 },
      { key: 'out', label: T('Dibalas bot', 'Replied by the bot'), slot: 2 },
      { key: 'human', label: T('Dibalas admin', 'Replied by an admin'), slot: 3 }] });
  stackedBar100({ el: $('chartStages'), title: T('Tahap lead', 'Lead stages'),
    help: T('Semua kontak menurut tahapnya. Klik satu tahap untuk membuka daftarnya.', 'All contacts by stage. Click a stage to open its list.'),
    parts: STAGES.map((s, i) => ({ key: s, label: stageLabel(s), value: Number(t.stages[s]) || 0, slot: i + 1, href: pathOf('percakapan') + '?stage=' + s })) });

  // Perlu perhatian: pelanggan yang menunggu staf, lalu masalah bot 24 jam terakhir.
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
    const open = el('a', { className: 'btn', href: convPath(c.phone) }, ico('message-circle'), T('Buka chat', 'Open chat'));
    rows.push(el('tr', {}, el('td', { className: 'who' }, el('a', { href: convPath(c.phone), textContent: name || c.phone }), name ? el('small', { textContent: c.phone }) : null),
      el('td', {}, el('span', { className: 'chip warn', textContent: T('perlu staf', 'needs staff') })),
      el('td', { className: 'sum', textContent: c.summary || '-' }),
      el('td', { className: 'acts' }, el('div', { className: 'acts-in' }, open, done))));
  }
  // Petunjuk satu baris di atas daftar, hanya kalau ada pelanggan yang menunggu staf.
  $('attentionHelp').textContent = T('Pelanggan di bawah menanyakan hal yang harus dijawab staf. Buka chatnya, balas, lalu tandai sudah ditangani.',
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
      el('td', { colSpan: 2, textContent: T('Bot terakhir melapor ', 'The bot last reported ') + mins + T(' menit lalu. Kemungkinan bot mati atau mesinnya tidak tersambung internet.', ' minutes ago. It is probably stopped, or its machine is offline.') })));
  }
  $('attention').replaceChildren(el('tbody', {}, ...(rows.length ? rows : [emptyRow(4, T('Tidak ada yang perlu perhatian.', 'Nothing needs attention.'))])));

  const qs = (handoffData || []).slice(0, 5);
  $('homeQuestions').replaceChildren(...(qs.length ? qs.map((g) => el('div', { className: 'qrow' },
    el('a', { className: 'q link', href: pathOf('lainnya') + '#questions', textContent: g.question, title: g.question }),
    el('small', { textContent: g.count + '× · ' + when(g.last_at) }))) : [el('p', { className: 'help', textContent: T('Belum ada pertanyaan yang dioper ke staf.', 'No questions handed to staff yet.') })]));
  $('allQuestions').textContent = (handoffData || []).length > 5
    ? T('Lihat semua (', 'See all (') + handoffData.length + ') →' : T('Buka di Pengetahuan > Lainnya →', 'Open in Knowledge > Other →');
}

// ---------- warning & catatan error ----------
const ALERT_KINDS = {
  'butuh-staf': () => T('Pelanggan butuh staf', 'Customer needs staff'),
  'wa-putus': () => T('WhatsApp terputus', 'WhatsApp disconnected'),
  'kiriman-dijeda': () => T('Kiriman dijeda', 'Sending paused'),
  'kiriman-gagal': () => T('Balasan gagal terkirim', 'Reply not sent'),
  llm: () => T('LLM bermasalah', 'LLM problem'),
  'bot-mati': () => T('Bot berhenti', 'Bot stopped'),
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

async function loadAlerts() {
  try {
    const r = await api('alerts');
    state.alerts = r.alerts;
    state.status = r.status;
    setBadge();
    const th = (...names) => el('thead', {}, el('tr', {}, ...names.map((n) => el('th', { textContent: n }))));
    const rows = r.alerts.map((a) => el('tr', {}, el('td', { textContent: when(a.at), style: 'white-space:nowrap' }),
      el('td', {}, el('span', { className: 'chip warn', textContent: (ALERT_KINDS[a.kind] || (() => a.kind))() })), el('td', { textContent: a.text })));
    $('alerts').replaceChildren(th(T('Waktu', 'Time'), T('Jenis', 'Type'), T('Keterangan', 'Details')),
      el('tbody', {}, ...(rows.length ? rows : [emptyRow(3, T('Belum ada warning.', 'No alerts yet.'))])));
    const errs = r.errors.map((e) => el('tr', {}, el('td', { textContent: when(e.at), style: 'white-space:nowrap' }),
      el('td', {}, el('span', { className: 'chip ' + (isError(e.level) ? 'warn' : ''), textContent: isError(e.level) ? T('error', 'error') : T('warning', 'warning') })),
      el('td', { className: 'mono', textContent: e.text })));
    $('errors').replaceChildren(th(T('Waktu', 'Time'), 'Level', T('Isi', 'Message')),
      el('tbody', {}, ...(errs.length ? errs : [emptyRow(3, T('Belum ada error yang tercatat.', 'No errors recorded yet.'))])));
  } catch (e) { toast(e.message, true); }
}

// ---------- pemakaian & biaya ----------
/** Data /usage terakhir; dipakai lagi saat rentang diganti, tanpa memuat ulang. */
let usageData = null;
/** Rentang grafik, kotak, dan tabel biaya (hari). */
let usageRange = 30;
const USAGE_RANGES = [7, 30, 90];

async function loadUsage() {
  try {
    usageData = { u: (await api('usage')).usage };
    renderUsage();
  } catch (e) { toast(e.message, true); }
}

/** Geser tanggal "YYYY-MM-DD" sekian hari (dihitung di UTC, jadi aman dari geser zona waktu). */
const shiftDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function renderUsage() {
  if (!usageData) return;
  const u = usageData.u;
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
  const tile = (k, v, s) => el('div', { className: 'tile' }, el('div', { className: 'k', textContent: k }), el('div', { className: 'v', textContent: v }), el('div', { className: 's', textContent: s }));
  const todaySum = sum(used.filter((d) => d.day === last));
  $('usageTiles').replaceChildren(
    tile(T('Hari ini', 'Today'), idr(todaySum.usd * rate),
      usd(todaySum.usd) + ' · ' + int(todaySum.calls) + T(' balasan · ', ' replies · ') + int(todaySum.promptTokens + todaySum.completionTokens) + ' token'),
    tile(T(n + ' hari terakhir', 'Last ' + n + ' days'), idr(total.usd * rate),
      usd(total.usd) + ' · ' + int(total.calls) + T(' balasan · ', ' replies · ') + int(total.promptTokens + total.completionTokens) + ' token'),
    tile(T('Rata-rata per hari', 'Average per day'), idr((total.usd * rate) / n),
      usd(total.usd / n) + ' · ' + (total.calls / n).toLocaleString(locale(), { maximumFractionDigits: 1 }) + T(' balasan per hari', ' replies per day')));

  // Grafik biaya: tiga bagian bertumpuk dalam Rupiah, urutan seri tetap.
  const host = $('chartCost');
  columnChart({ el: host, title: T('Biaya per hari (Rp)', 'Cost per day (Rp)'), stacked: true, format: idr,
    help: T('Perkiraan biaya LLM, ' + n + ' hari terakhir.', 'Estimated LLM cost, last ' + n + ' days.'),
    days: days.map((d) => { const p = parts(d); return { day: d.day, in: p.in * rate, cached: p.cached * rate, out: p.out * rate }; }),
    series: [
      { key: 'in', label: 'Input', slot: 1 },
      { key: 'cached', label: T('Input dari cache', 'Cached input'), slot: 2 },
      { key: 'out', label: 'Output', slot: 3 }] });
  // Satu baris keterangan tarif dan kurs di bawah grafik.
  if (u) {
    host.querySelector(':scope > .cb').append(el('p', { className: 'help chart-note', textContent: 'Model ' + u.model + T(' · tarif per 1 juta token: input ', ' · rates per 1M tokens: input ') + usd(price.in) +
      T(', dari cache ', ', cached ') + usd(price.cached) + ', output ' + usd(price.out) + T(' · kurs Rp ', ' · exchange rate Rp ') + int(rate) + T(' per USD', ' per USD') }));
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

// ---------- WhatsApp & keadaan bot ----------
const WA_STATES = {
  starting: () => [T('menyambung…', 'connecting…'), ''],
  qr: () => [T('menunggu dipindai', 'waiting for scan'), 'warn'],
  pairing: () => [T('menunggu kode pairing', 'waiting for pairing code'), 'warn'],
  connected: () => [T('tersambung', 'connected'), 'ok'],
  disconnected: () => [T('terputus, menyambung lagi', 'disconnected, reconnecting'), 'warn'],
  logged_out: () => [T('sesi dicabut dari HP', 'session removed on the phone'), 'danger'],
  conflict: () => [T('sesi direbut sesi lain', 'session taken over'), 'danger'],
  stopped: () => [T('bot berhenti', 'bot stopped'), 'danger'],
};
const waLabel = (s) => (WA_STATES[s] ? WA_STATES[s]()[0] : s || '-');
const showPhone = (p) => (p ? (/^\d+$/.test(p) ? '+' + p : p) : T('nomor belum diketahui', 'number not known yet'));
let waTimer = null;
let wa = null;

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
    info = [[T('Jalur WhatsApp', 'WhatsApp channel'), st.transport], [T('Kabar lead lewat WA ke', 'Lead news on WA goes to'), st.sales || T('belum ada nomor', 'no number yet')],
      ['LLM', state.testReady ? T('siap', 'ready') : T('belum diatur (LLM_API_KEY di .env)', 'not set (LLM_API_KEY in .env)')],
      [T('Transkripsi pesan suara', 'Voice note transcription'), st.channels && st.channels.stt ? T('siap', 'ready') : T('belum diatur di .env bot (STT_API_KEY)', 'not set in the bot\'s .env (STT_API_KEY)')],
      [T('Yang dibalas', 'Who gets a reply'), st.onlyNumbers ? T('MODE UJI: hanya ', 'TEST MODE: only ') + st.onlyNumbers + T(' nomor', ' numbers') : T('semua nomor', 'every number')],
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

function renderWa() {
  const w = wa && wa.wa;
  const p = state && state.project;
  // Laporan bot datang tiap 30 detik; lebih dari 2 menit diam = bot tidak jalan.
  const stale = !w || !w.last_seen_at || Date.now() - w.last_seen_at > 120000;
  const [text, cls] = !w ? [T('bot belum pernah melapor', 'bot has never reported'), 'warn']
    : stale ? [T('bot tidak melapor', 'bot not reporting'), 'danger'] : WA_STATES[w.state] ? WA_STATES[w.state]() : [w.state, ''];
  $('waState').textContent = text;
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
  $('waDetail').textContent = wa && wa.pending === 'pair' ? T('Permintaan kode pairing dikirim ke bot…', 'Pairing code requested from the bot…')
    : wa && wa.pending === 'reset' ? T('Bot sedang memutus sesi lama…', 'The bot is disconnecting the old session…')
    : connected ? T('Tersambung sebagai ', 'Connected as ') + showPhone(w.self_phone)
    : w && w.detail ? w.detail : '';
  const cloud = p && p.transport === 'cloud';
  // Kode pairing hanya berguna selama belum tersambung, dan hanya di jalur Baileys.
  $('waPairBox').hidden = connected || cloud;
  if (!$('waNumber').value && p && p.wa_number) $('waNumber').value = p.wa_number;
  $('waFoot').textContent = w ? [T('Jalur: ', 'Channel: ') + (w.transport || (p && p.transport) || '-'), w.version ? T('versi bot ', 'bot version ') + w.version : '',
    w.started_at ? T('dinyalakan ', 'started ') + when(w.started_at) : ''].filter(Boolean).join(' · ') : T('Bot proyek ini belum pernah melapor. Di server, bot dinyalakan dalam ±1 menit setelah proyek dibuat.', 'This project\'s bot has never reported. On the server it starts within a minute after the project is created.');
}

async function loadWa() {
  clearTimeout(waTimer);
  if (!project || page !== 'whatsapp') return;
  try {
    wa = await api('wa');
    renderWa();
    renderStrip();
  } catch { /* dicoba lagi di putaran berikutnya */ }
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
    toast(T('Sesi lama diputus. QR baru muncul di sini sebentar lagi.', 'Old session disconnected. A new QR code appears here shortly.'));
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
  if (st && st.onlyNumbers) out.push(chip('warn', T('MODE UJI', 'TEST MODE') + ' · ' + st.onlyNumbers + T(' nomor', ' numbers'), pathOf('lanjutan'), 'flask'));
  if (!state.testReady) out.push(chip('warn', T('LLM belum diatur', 'LLM not configured'), waHref, 'alert'));
  const month = state.month || { idr: 0 };
  // Nominal tetap "Rp" (bukan "RP"): dibungkus .raw.
  out.push(chip('', el('span', {}, el('span', { className: 'raw', textContent: idr(month.idr) }), T(' bulan ini', ' this month')), pathOf('lanjutan') + '#cost', 'coins'));
  // Tombol Coba chat ikut di strip, di ujung kanan, di semua halaman (node yang sama dipindahkan lagi).
  out.push($('tryBtn'));
  $('strip').replaceChildren(...out);
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
    $('projWa').value = p.wa_number || '';
    $('projSales').value = p.sales_number || '';
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
for (const id of ['projName', 'projTransport', 'projWa', 'projSales', 'projEnabled']) {
  const input = $(id);
  input.addEventListener(input.tagName === 'INPUT' && input.type === 'text' ? 'input' : 'change', () => setDirty(true, 'project'));
}

$('projPaused').addEventListener('change', async () => {
  const paused = $('projPaused').checked;
  try {
    await putProject({ paused }, paused ? T('Bot dijeda untuk semua chat.', 'The bot is paused for all chats.') : T('Bot aktif lagi untuk semua chat.', 'The bot is active again for all chats.'));
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
      id: $('npId').value.trim().toLowerCase(), name: $('npName').value, template: $('npTemplate').value, wa_number: $('npWa').value, sales_number: $('npSales').value,
    }) });
    $('newProject').classList.remove('on');
    $('newProjectForm').reset();
    projects = (await api('projects')).projects;
    toast(T('Proyek dibuat. Tautkan WhatsApp-nya di sini.', 'Project created. Link its WhatsApp here.'));
    dirty = false;
    changed.clear();
    projectDirty = false;
    await go(pathOf('whatsapp', r.project.id));
  } catch (err) { $('npErr').textContent = err.message; }
});

// ---------- navigasi ----------
/** Pasang alamat di semua tautan menu untuk proyek yang sedang dibuka. */
function renderNav() {
  for (const a of document.querySelectorAll('a[data-nav]')) a.href = pathOf(a.dataset.nav);
  for (const a of document.querySelectorAll('a[data-to]')) a.href = pathOf(a.dataset.to);
  $('homeLink').href = pathOf('beranda');
  $('convBack').href = pathOf('percakapan');
  $('allQuestions').href = pathOf('lainnya') + '#questions';
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
  $('crumb').textContent = crumb;
  $('crumb').hidden = !crumb;
  $('title').textContent = title;
  $('desc').textContent = desc;
  $('desc').hidden = !desc;
  const p = projects.find((x) => x.id === project);
  document.title = title + (p ? ' · ' + p.name : '') + ' · Alice AI';
  setDirty(dirty);
  $('convBack').hidden = page !== 'chat';
  if (page === 'chat' && conv && conv.contact) renderConvHead();
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
  if (page !== 'chat') { if (noteTimer) void saveNote(); conv = null; }
  renderMeta();
  if (page === 'beranda') void loadHome();
  if (page === 'percakapan') {
    // ?stage=<tahap> (mis. dari grafik "Tahap lead" di Beranda) memilih saringannya.
    const st = new URLSearchParams(location.search).get('stage');
    if (st && FILTERS().some(([k]) => k === st)) leadFilter = st;
    void loadLeads();
  }
  if (page === 'chat') void openConv(r.phone);
  if (page === 'lainnya') void loadHandoffs();
  if (page === 'whatsapp') { renderStatus(); void loadWa(); }
  if (page === 'notifikasi') renderRecipients();
  if (page === 'lanjutan') { void loadUsage(); void loadAlerts(); }
  if (page === 'notfound') $('notFoundText').textContent = r.text || T('Alamat ini tidak ada di dashboard.', 'This address does not exist in the dashboard.');
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
    !confirm(T('Ada perubahan yang belum disimpan. Pindah proyek tanpa menyimpan?', 'There are unsaved changes. Switch project without saving?'))) return;
  const target = path + u.search + u.hash;
  // Alamat yang sama tidak menambah riwayat (mis. klik menu yang sedang dibuka).
  const same = target === location.pathname + location.search + location.hash;
  history[opts.replace || same ? 'replaceState' : 'pushState'](null, '', target);
  await route();
}

window.addEventListener('popstate', () => {
  const r = parseRoute(location.pathname);
  if (r.project && project && r.project !== project && dirty &&
    !confirm(T('Ada perubahan yang belum disimpan. Pindah proyek tanpa menyimpan?', 'There are unsaved changes. Switch project without saving?'))) {
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
  renderAll();
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
  }
  renderProjects();
  if (!exists) show('notfound', { text: T('Proyek "', 'Project "') + r.project + T('" tidak ada. Pilih proyek di atas.', '" does not exist. Choose a project above.') });
  else show(r.page, r);
  currentUrl = location.pathname + location.search + location.hash;
}

function showLogin() {
  $('login').classList.add('on');
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
  // Data halaman yang sudah dimuat cukup digambar ulang (mis. setelah ganti bahasa).
  if (leadData) renderLeads();
  if (homeData) renderHome();
  if (handoffData) renderHandoffs();
  if (wa) renderWa();
  if (conv) { conv.key = ''; renderConv(); }
  if (page) renderMeta();
}

$('lang').addEventListener('click', (e) => {
  const next = e.target.dataset && e.target.dataset.lang;
  if (!next || next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch { /* tetap berlaku untuk kunjungan ini */ }
  renderAll();
  if (page === 'lanjutan') { void loadUsage(); void loadAlerts(); }
});

/** Simpan semua perubahan: baris proyek dulu (kalau diubah), lalu profil (kalau diubah). */
async function save(quiet = false) {
  $('save').disabled = true;
  try {
    let moved = false;
    if (projectDirty) {
      moved = $('projTransport').value !== (state.project && state.project.transport);
      await putProject({ name: $('projName').value, transport: $('projTransport').value, wa_number: $('projWa').value, sales_number: $('projSales').value, enabled: $('projEnabled').checked });
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
    if (!quiet) toast(T('Tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.', 'Saved. The bot uses the new settings from the next message.') +
      (r.autoPdf ? ' ' + r.autoPdf + T(' produk baru otomatis dipasangi PDF.', ' new products were given a PDF automatically.') : '') +
      (moved ? T(' Jalur WhatsApp diganti: bot menyala ulang di jalur baru.', ' WhatsApp channel changed: the bot restarts on the new channel.') : ''));
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
    toast(T('Perubahan dibatalkan.', 'Changes discarded.'));
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
function watchHeight(node, name) {
  const put = () => document.documentElement.style.setProperty(name, Math.ceil(node.getBoundingClientRect().height) + 'px');
  if (typeof ResizeObserver === 'function') new ResizeObserver(put).observe(node);
  put();
}

applyLang();
decorateSummaries();
watchHeight($('chrome'), '--chrome-h');
watchHeight($('savebar'), '--savebar-h');
if (location.pathname === '/login') showLogin();
load().catch(() => {});
