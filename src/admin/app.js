// Dashboard pemilik. Semua teks dari server dipasang lewat textContent, tidak
// pernah innerHTML: data produk dan nama pelanggan diketik orang.
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

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
  for (const b of $('lang').children) b.classList.toggle('on', b.dataset.lang === lang);
}

// ---------- tema terang / gelap ----------
let theme = 'light';
try {
  const saved = localStorage.getItem('theme');
  theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch { /* tetap terang */ }
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? '☀' : '☾';
}
applyTheme();
$('theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', theme); } catch { /* berlaku untuk kunjungan ini saja */ }
  applyTheme();
});

let profile = null;
let state = null;
// Proyek yang sedang dibuka (satu bisnis, satu nomor WhatsApp). Disimpan di
// alamat (#id) supaya muat ulang halaman tetap di proyek yang sama.
let project = decodeURIComponent(location.hash.slice(1)) || '';
let projects = [];
let templates = [];
let tab = 'identitas';
const NO_SAVE = ['lead', 'biaya', 'uji', 'pdf', 'peringatan'];
let dirty = false;
// Hanya kunci yang benar-benar diubah yang dikirim: yang tidak disentuh tetap
// mengikuti bawaan, jadi perbaikan bawaan di kemudian hari tetap sampai.
const changed = new Set();
let chat = [];
let known = {};

const PAGES = {
  identitas: () => [T('Identitas', 'Identity'), T('Siapa yang membalas chat, logonya, dan salam pembukanya. Perubahan berlaku pada pesan berikutnya setelah disimpan.', 'Who replies to chats, the logo, and the greeting. Changes apply to the next message after you save.')],
  pengaturan: () => [T('Pengaturan', 'Settings'), T('Notifikasi, irama balasan, follow-up, batas, dan keadaan bot.', 'Notifications, reply rhythm, follow-up, limits, and the bot\'s status.')],
  rekomendasi: () => [T('Rekomendasi', 'Recommendations'), T('Apa yang ditanyakan bot ke pelanggan, dan cara ia memilih produk.', 'What the bot asks the customer, and how it picks a product.')],
  pdf: () => ['PDF', T('Brosur dan katalog yang bisa dikirim bot ke pelanggan.', 'Brochures and catalogues the bot can send to customers.')],
  produk: () => [T('Produk', 'Products'), T('Satu-satunya sumber jawaban bot. Yang tidak tertulis di sini tidak akan dijawabnya.', 'The bot\'s only source of answers. Anything not written here, it will not answer.')],
  data: () => [T('Data pelanggan', 'Customer data'), T('Data yang diminta bot dari tiap calon pelanggan.', 'What the bot asks every prospective customer for.')],
  peringatan: () => [T('Peringatan & log', 'Alerts & log'), T('Hal yang butuh perhatian Anda, dan catatan galat bot.', 'Things that need your attention, and the bot\'s error log.')],
  lead: () => ['Lead', T('Calon pelanggan yang sudah chat dengan bot.', 'Prospective customers who have chatted with the bot.')],
  biaya: () => [T('Pemakaian & biaya', 'Usage & cost'), T('Token LLM yang dipakai bot dan perkiraan biayanya.', 'LLM tokens used by the bot and their estimated cost.')],
  uji: () => [T('Uji coba', 'Test chat'), T('Coba bicara dengan bot tanpa mengirim apa pun ke WhatsApp.', 'Talk to the bot without sending anything to WhatsApp.')],
};

function toast(text, err = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), err ? 5000 : 2600);
}

// Alamat yang bukan milik satu proyek; sisanya ada di /admin/<proyek>/api/….
const GLOBAL_API = ['login', 'logout', 'projects'];
const mediaBase = () => '/admin/' + encodeURIComponent(project) + '/media/';

async function api(path, opts = {}) {
  const base = GLOBAL_API.includes(path) ? '/admin/api/' : '/admin/' + encodeURIComponent(project) + '/api/';
  const res = await fetch(base + path, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    $('login').classList.add('on');
    throw new Error(T('Belum masuk.', 'Not signed in.'));
  }
  if (!res.ok) throw new Error(data.error || T('Gagal', 'Failed') + ' (' + res.status + ').');
  return data;
}

function setDirty(v, key) {
  dirty = v;
  if (v && key) changed.add(key);
  if (!v) changed.clear();
  $('save').disabled = !v;
  $('save').textContent = v ? T('Simpan & terapkan', 'Save & apply') : T('Tersimpan', 'Saved');
  $('save').style.display = NO_SAVE.includes(tab) && !v ? 'none' : '';
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

// ---------- penerima notifikasi & rute ----------
const NOTIFY = [
  ['lead', () => T('Lead baru (data pelanggan lengkap)', 'New lead (customer data complete)'), 'staff'],
  ['butuh-staf', () => T('Pelanggan butuh staf (bot tidak bisa menjawab, minta orang, kirim suara/dokumen)', 'Customer needs staff (bot cannot answer, asks for a person, sends voice/document)'), 'staff'],
  ['wa-putus', () => T('WhatsApp terputus', 'WhatsApp disconnected'), 'owner'],
  ['kiriman-dijeda', () => T('Kiriman bot dijeda pengaman', 'Sending paused by the safeguard'), 'owner'],
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
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 6, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada penerima. Selama kosong, bot memakai nomor sales proyek (kartu Proyek di atas).', 'No recipients yet. While empty, the bot uses the project\'s sales number (Project card above).') })));
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
  !readable ? name + T(': tidak terbaca (hasil pindai?) — pasangkan sendiri.', ': not readable (a scan?) — attach it by hand.')
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
      const rm = el('button', { type: 'button', textContent: '×', title: T('Lepas dari produk ini', 'Detach from this product') });
      rm.addEventListener('click', () => { p.pdf = ''; touchProducts(); renderProducts(); renderPdfs(); });
      return el('span', { className: 'chip' }, p.name, rm);
    }), add);

    const re = el('button', { className: 'btn ghost small', type: 'button', textContent: T('Cocokkan ulang', 'Re-match') });
    re.addEventListener('click', async () => {
      re.disabled = true;
      try {
        const wasDirty = dirty;
        const r = await api('files/' + f.id + '/match', { method: 'POST' });
        await afterAssign(wasDirty, [matchNote(f.name, r.readable, assignPdf(f.id, r.matches))]);
      } catch (e) { toast(e.message, true); re.disabled = false; }
    });
    const del = el('button', { className: 'btn danger small', type: 'button', textContent: T('Hapus', 'Delete'), style: 'margin-left:6px' });
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
        toast(read.checked ? T('Bot sekarang membaca isi PDF ini. Coba di Uji coba.', 'The bot now reads this PDF. Try it in Test chat.') : T('Bot tidak lagi membaca isi PDF ini.', 'The bot no longer reads this PDF.'));
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
function renderLogo() {
  const src = mediaUrl(profile.logo);
  document.body.classList.toggle('has-logo', Boolean(src));
  if (src) $('logoTop').src = src;
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
const cellInput = (value, onInput, placeholder = '') => {
  const input = el('input', { type: 'text', value: value || '', placeholder });
  // Lebar kolom mengikuti isinya, supaya kode dan judul kolom tidak terpotong.
  const fit = () => (input.style.minWidth = Math.min(36, Math.max(4, (input.value || placeholder).length) + 3) + 'ch');
  fit();
  input.addEventListener('input', () => { fit(); onInput(input.value); });
  return input;
};
const xBtn = (title, onClick) => {
  const b = el('button', { className: 'x', type: 'button', textContent: '×', title });
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
};
const headRow = (labels) => el('thead', {}, el('tr', {}, ...labels.map((t) => el('th', { className: 'lbl', textContent: t })), el('th', { className: 'act' })));

/** Enter = turun satu baris; tempel dari Excel = isi banyak sel. `rows` = daftar baris, `get/set` = akses sel. */
function sheetKeys(table, opts) {
  const focusCell = (r, c) => {
    const n = table.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]');
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
  $('questions').replaceChildren(headRow([T('Pertanyaan', 'Question')]), body);
}
$('addQuestion').addEventListener('click', () => {
  if (profile.questions.length >= 12) return toast(T('Maksimal 12 pertanyaan.', '12 questions max.'), true);
  profile.questions.push('');
  setDirty(true, 'questions');
  renderQuestions();
  const inputs = $('questions').querySelectorAll('input');
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
      const input = cellInput(p[k], (v) => { p[k] = v; touchProducts(); }, ri === 0 || !p.name ? ph[ci] : '');
      input.dataset.r = ri;
      input.dataset.c = ci;
      return el('td', { className: ci === 0 ? 'first' : ci === 1 ? 'wide' : '' }, input);
    });

    const add = el('button', { className: 'add', type: 'button', textContent: '+', title: T('Tambah foto', 'Add photo') });
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
      const rm = el('button', { type: 'button', textContent: '×', title: T('Lepas foto', 'Remove photo') });
      rm.addEventListener('click', () => { p.photos.splice(pi, 1); touchProducts(); renderProducts(); });
      return el('span', { className: 'th' }, el('img', { src: mediaUrl(id), alt: p.name, loading: 'lazy' }), rm);
    }), add);

    let pdf;
    const cur = fileOf(p.pdf);
    if (cur) {
      pdf = el('div', { className: 'pdf' }, el('a', { href: mediaUrl(p.pdf), target: '_blank', rel: 'noopener', textContent: '📄 ' + cur.name, title: cur.name }),
        xBtn(T('Lepas PDF', 'Remove PDF'), () => { p.pdf = ''; touchProducts(); renderProducts(); renderPdfs(); }));
    } else {
      const sel = el('select', {}, el('option', { value: '', textContent: T('— tanpa PDF —', '— no PDF —') }),
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

focusProduct = sheetKeys($('products'), {
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
  }
  const focusCell = sheetKeys(table, {
    max: 200,
    count: () => t.rows.length,
    cols: () => t.columns.length,
    addRow: () => { t.rows.push(t.columns.map(() => '')); },
    set: (r, c, v) => { t.rows[r][c] = v; },
    redraw: () => { touchCatalog(); draw(); },
  });
  draw();
  const addRow = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Baris', '+ Row') });
  addRow.addEventListener('click', () => { t.rows.push(t.columns.map(() => '')); touchCatalog(); draw(); focusCell(t.rows.length - 1, 0); });
  const addCol = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Kolom', '+ Column') });
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
  const name = cellInput(s.name, (v) => { s.name = v; title.textContent = v || blank; touchCatalog(); }, T('mis. Exhaust Fan Industri — Seri A', 'e.g. Exhaust Fan Industri — Seri A'));
  const facts = el('textarea', { rows: Math.max(2, s.facts.length + 1), value: s.facts.join('\n'), placeholder: T('Satu kalimat per baris: bahan, pemakaian, rentang ukuran, …', 'One sentence per line: material, use, size range, …') });
  facts.addEventListener('input', () => { s.facts = facts.value.split('\n').map((f) => f.trim()).filter(Boolean); touchCatalog(); });

  const body = el('div', { className: 'series-body' },
    el('div', { className: 'row' },
      el('label', { className: 'f' }, el('span', { textContent: T('Nama kelompok / seri', 'Group / series name') }), name),
      el('label', { className: 'f' }, el('span', { textContent: T('Keterangan umum', 'General notes') }), facts)));

  s.tables.forEach((t, ti) => {
    const { table, addRow, addCol } = tableNode(t);
    const tTitle = cellInput(t.title, (v) => { t.title = v; touchCatalog(); }, T('judul tabel, mis. Spesifikasi teknis', 'table title, e.g. Spesifikasi teknis'));
    const delT = el('button', { className: 'btn danger small', type: 'button', textContent: T('Hapus tabel', 'Delete table') });
    delT.addEventListener('click', () => {
      if (t.rows.length && !confirm(T('Hapus tabel "', 'Delete table "') + t.title + T('" beserta barisnya?', '" and its rows?'))) return;
      s.tables.splice(ti, 1);
      touchCatalog();
      renderCatalog();
    });
    body.append(el('div', { className: 'tblhead' }, tTitle), el('div', { className: 'scroll' }, table), el('div', { className: 'tblfoot' }, addRow, addCol, delT));
  });

  const addT = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Tabel', '+ Table') });
  addT.addEventListener('click', () => {
    if (s.tables.length >= 6) return toast(T('Maksimal 6 tabel per kelompok.', '6 tables per group max.'), true);
    const first = s.tables[0];
    s.tables.push({ title: '', columns: [first ? first.columns[0] : 'Model', T('Kolom 2', 'Column 2')], rows: first ? first.rows.map((r) => [r[0], '']) : [['', '']] });
    touchCatalog();
    renderCatalog();
  });
  const delS = el('button', { className: 'btn danger small', type: 'button', textContent: T('Hapus kelompok', 'Delete group') });
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
  if (dirty) addMsg('note', T('Ada perubahan yang belum disimpan — jawaban di bawah masih memakai profil lama.', 'There are unsaved changes — the answer below still uses the old profile.'));
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

// ---------- lead ----------
let leadData = null;

/** Keadaan satu baris lead. Tombolnya ditulis langsung ke database, jadi selalu sesuai. */
function leadState(c) {
  return { botOn: !c.hold, needs: c.needsSales };
}

async function loadLeads() {
  try {
    leadData = await api('leads');
    renderLeads();
  } catch (e) { toast(e.message, true); }
}

function visibleLeads() {
  const q = $('leadSearch').value.trim().toLowerCase();
  const f = $('leadFilter').value;
  return leadData.rows.filter((c) => {
    const s = leadState(c);
    if (f === 'staf' && !s.needs) return false;
    if (f === 'belum' && c.complete) return false;
    if (f === 'lengkap' && !c.complete) return false;
    if (f === 'diam' && s.botOn) return false;
    if (!q) return true;
    return [c.phone, c.summary || '', ...Object.values(c.lead)].join(' ').toLowerCase().includes(q);
  });
}

function renderLeads() {
  if (!leadData) return;
  const r = leadData;
  const head = el('tr', {}, el('th', { textContent: T('Nomor', 'Number') }), ...r.fields.map((f) => el('th', { textContent: f.label })),
    el('th', { textContent: T('Ringkasan percakapan', 'Conversation summary') }), el('th', { textContent: 'Status' }), el('th', { textContent: 'Bot' }),
    el('th', { textContent: T('Terakhir chat', 'Last message') }));
  const list = visibleLeads();
  const rows = list.map((c) => {
    const s = leadState(c);
    const box = el('input', { type: 'checkbox', checked: s.botOn });
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        await api('leads/' + encodeURIComponent(c.phone) + '/bot', { method: 'POST', body: JSON.stringify({ mode: box.checked ? 'on' : 'off' }) });
        toast(box.checked ? T('Chat ini dikembalikan ke bot.', 'This chat is handed back to the bot.') : T('Bot dimatikan untuk chat ini.', 'The bot is turned off for this chat.'));
      } catch (e) { toast(e.message, true); }
      await loadLeads();
    });
    const why = c.hold === 'admin' ? T('admin membalas', 'an admin replied') : c.hold === 'tombol' ? T('dimatikan', 'turned off') : '';
    let staff = null;
    if (s.needs) {
      const done = el('button', { className: 'btn ghost small', type: 'button', textContent: T('✓ Sudah ditangani', '✓ Handled'), style: 'margin-left:6px' });
      done.addEventListener('click', async () => {
        done.disabled = true;
        try {
          await api('leads/' + encodeURIComponent(c.phone) + '/handled', { method: 'POST' });
          toast(T('Ditandai sudah ditangani.', 'Marked as handled.'));
        } catch (e) { toast(e.message, true); }
        await loadLeads();
      });
      staff = el('span', { style: 'white-space:nowrap' }, el('span', { className: 'chip warn', textContent: T('perlu staf', 'needs staff'), style: 'margin-left:4px' }), done);
    }
    return el('tr', {}, el('td', { textContent: c.phone }), ...r.fields.map((f) => el('td', { textContent: c.lead[f.key] || '—' })),
      el('td', { className: 'sum', textContent: c.summary || '—' }),
      el('td', {}, el('span', { className: 'chip ' + (c.complete ? 'ok' : ''), textContent: c.complete ? T('lengkap', 'complete') : T('belum lengkap', 'incomplete') }), staff),
      el('td', {}, el('label', { className: 'switch' }, box, el('small', { textContent: why }))),
      el('td', { textContent: c.lastAt ? new Date(c.lastAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : T('belum pernah chat', 'never chatted') }));
  });
  const empty = r.rows.length ? T('Tidak ada yang cocok dengan pencarian atau saringan ini.', 'Nothing matches this search or filter.') : T('Belum ada percakapan.', 'No conversations yet.');
  $('leads').replaceChildren(el('thead', {}, head), el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: r.fields.length + 5, textContent: empty }))])));
  $('leadCount').textContent = list.length + T(' dari ', ' of ') + r.rows.length + T(' kontak', ' contacts');
  $('knownCount').textContent = profile.knownCount
    ? profile.knownCount + T(' pelanggan lama terdaftar.', ' existing customers on file.')
    : T('Belum ada pelanggan lama yang diimpor.', 'No existing customers imported yet.');
}

$('leadSearch').addEventListener('input', renderLeads);
$('leadFilter').addEventListener('change', renderLeads);

// Unduh yang sedang tampil sebagai CSV (bisa dibuka di Excel).
$('leadExport').addEventListener('click', () => {
  if (!leadData) return;
  const r = leadData;
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [[T('Nomor', 'Number'), ...r.fields.map((f) => f.label), T('Ringkasan', 'Summary'), T('Lengkap', 'Complete'), T('Perlu staf', 'Needs staff'), 'Bot', T('Terakhir chat', 'Last message')]];
  for (const c of visibleLeads()) {
    const s = leadState(c);
    lines.push([c.phone, ...r.fields.map((f) => c.lead[f.key] || ''), c.summary || '', c.complete ? T('ya', 'yes') : T('tidak', 'no'), s.needs ? T('ya', 'yes') : '',
      s.botOn ? T('aktif', 'on') : T('diam', 'off'), c.lastAt ? new Date(c.lastAt).toLocaleString(locale()) : '']);
  }
  // BOM di depan supaya Excel membaca huruf dan emoji dengan benar.
  const csv = '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n');
  const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'lead-' + new Date().toLocaleDateString('en-CA') + '.csv' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// Impor pelanggan lama: satu nomor per baris, boleh diikuti nama.
$('knownImport').addEventListener('click', async () => {
  const text = $('knownText').value.trim();
  if (!text) return toast(T('Tempel dulu daftar nomornya.', 'Paste the list of numbers first.'), true);
  $('knownImport').disabled = true;
  try {
    const r = await api('known', { method: 'POST', body: JSON.stringify({ text, off: $('knownOff').checked }) });
    profile = r.profile;
    $('knownText').value = '';
    toast(r.added + T(' nomor ditambahkan', ' numbers added') + (r.invalid ? ', ' + r.invalid + T(' baris dilewati (bukan nomor)', ' lines skipped (not a number)') : '') + '. ' + T('Total: ', 'Total: ') + r.total + '.');
    await loadLeads();
  } catch (e) { toast(e.message, true); }
  $('knownImport').disabled = false;
});

// ---------- peringatan & catatan galat ----------
const ALERT_KINDS = {
  'butuh-staf': () => T('Pelanggan butuh staf', 'Customer needs staff'),
  'wa-putus': () => T('WhatsApp terputus', 'WhatsApp disconnected'),
  'kiriman-dijeda': () => T('Kiriman dijeda', 'Sending paused'),
  llm: () => T('LLM bermasalah', 'LLM problem'),
  'bot-mati': () => T('Bot berhenti', 'Bot stopped'),
};
const when = (at) => new Date(at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

function setBadge(alerts, status) {
  const day = Date.now() - 86400000;
  const stale = status && status.reportedAt && Date.now() - status.reportedAt > 40 * 60000;
  const n = (alerts || []).filter((a) => a.at > day).length + (stale ? 1 : 0);
  $('alertBadge').textContent = n > 99 ? '99+' : String(n);
  $('alertBadge').classList.toggle('on', n > 0);
}

async function loadAlerts() {
  try {
    const r = await api('alerts');
    setBadge(r.alerts, r.status);
    const th = (...names) => el('thead', {}, el('tr', {}, ...names.map((n) => el('th', { textContent: n }))));
    const rows = r.alerts.map((a) => el('tr', {}, el('td', { textContent: when(a.at), style: 'white-space:nowrap' }),
      el('td', {}, el('span', { className: 'chip warn', textContent: (ALERT_KINDS[a.kind] || (() => a.kind))() })), el('td', { textContent: a.text })));
    // Bot yang mati tidak bisa melapor sendiri: dashboard yang menyimpulkannya.
    const mins = r.status && r.status.reportedAt ? Math.round((Date.now() - r.status.reportedAt) / 60000) : null;
    if (mins !== null && mins > 40) {
      rows.unshift(el('tr', { className: 'stale' }, el('td', { textContent: when(r.status.reportedAt), style: 'white-space:nowrap' }),
        el('td', {}, el('span', { className: 'chip warn', textContent: T('Bot tidak melapor', 'Bot not reporting') })),
        el('td', { textContent: T('Bot terakhir melapor ', 'The bot last reported ') + mins + T(' menit lalu. Kemungkinan bot mati atau mesinnya tidak tersambung internet.', ' minutes ago. It is probably stopped, or its machine is offline.') })));
    }
    $('alerts').replaceChildren(th(T('Waktu', 'Time'), T('Jenis', 'Type'), T('Keterangan', 'Details')),
      el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 3, style: 'color:var(--muted)', textContent: T('Tidak ada yang perlu perhatian.', 'Nothing needs attention.') }))])));
    const errs = r.errors.map((e) => el('tr', {}, el('td', { textContent: when(e.at), style: 'white-space:nowrap' }),
      el('td', {}, el('span', { className: 'chip ' + (e.level === 'galat' ? 'warn' : ''), textContent: e.level === 'galat' ? T('galat', 'error') : T('peringatan', 'warning') })),
      el('td', { className: 'mono', textContent: e.text })));
    $('errors').replaceChildren(th(T('Waktu', 'Time'), 'Level', T('Isi', 'Message')),
      el('tbody', {}, ...(errs.length ? errs : [el('tr', {}, el('td', { colSpan: 3, style: 'color:var(--muted)', textContent: T('Belum ada galat yang tercatat.', 'No errors recorded yet.') }))])));
  } catch (e) { toast(e.message, true); }
}

// ---------- pemakaian & biaya ----------
const int = (n) => Math.round(n).toLocaleString(locale());
const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const idr = (n) => 'Rp ' + n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 1 : 0 });

async function loadUsage() {
  const tiles = $('usageTiles');
  const table = $('usage');
  try {
    const u = (await api('usage')).usage;
    if (!u) {
      tiles.replaceChildren();
      $('usageRate').textContent = T('Belum ada pemakaian yang tercatat.', 'No usage recorded yet.');
      table.replaceChildren();
      return;
    }
    // Token masuk yang kena cache jauh lebih murah, jadi dihitung terpisah.
    const cost = (d) => ((d.promptTokens - d.cachedTokens) * u.price.in + d.cachedTokens * u.price.cached + d.completionTokens * u.price.out) / 1e6;
    const sum = (days) => days.reduce((a, d) => ({
      calls: a.calls + d.calls, promptTokens: a.promptTokens + d.promptTokens, cachedTokens: a.cachedTokens + d.cachedTokens,
      completionTokens: a.completionTokens + d.completionTokens, usd: a.usd + cost(d),
    }), { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, usd: 0 });
    const dayStr = (back) => new Date(Date.now() - back * 86400000).toLocaleDateString('en-CA');
    const since = (n) => u.days.filter((d) => d.day > dayStr(n));

    const tile = (k, days) => {
      const s = sum(days);
      return el('div', { className: 'tile' }, el('div', { className: 'k', textContent: k }),
        el('div', { className: 'v', textContent: idr(s.usd * u.usdIdr) }),
        el('div', { className: 's', textContent: usd(s.usd) + ' · ' + int(s.calls) + T(' balasan · ', ' replies · ') + int(s.promptTokens + s.completionTokens) + ' token' }));
    };
    tiles.replaceChildren(tile(T('Hari ini', 'Today'), since(1)), tile(T('7 hari terakhir', 'Last 7 days'), since(7)), tile(T('30 hari terakhir', 'Last 30 days'), since(30)));

    $('usageRate').textContent = 'Model ' + u.model + T(' · tarif per 1 juta token: masuk ', ' · rates per 1M tokens: input ') + usd(u.price.in) + T(', masuk dari cache ', ', cached input ') + usd(u.price.cached) +
      T(', keluar ', ', output ') + usd(u.price.out) + T(' · kurs Rp ', ' · exchange rate Rp ') + int(u.usdIdr) + T(' per USD. Tarif dan kurs diatur di Pengaturan.', ' per USD. Rates and exchange rate are set in Settings.');

    const th = (t, num) => el('th', { textContent: t, className: num ? 'num' : '' });
    const td = (t, num) => el('td', { textContent: t, className: num ? 'num' : '' });
    const max = Math.max(...u.days.map(cost), 0);
    const line = (label, d, c, bar) => el('tr', {}, td(label), td(int(d.calls), 1), td(int(d.promptTokens), 1), td(int(d.cachedTokens), 1),
      td(int(d.completionTokens), 1), td(usd(c), 1), td(idr(c * u.usdIdr), 1),
      el('td', { style: 'width:120px;vertical-align:middle' }, bar && max ? el('div', { className: 'bar', style: 'width:' + Math.round((c / max) * 100) + '%' }) : null));
    const rows = u.days.map((d) => line(new Date(d.day + 'T00:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), d, cost(d), true));
    const total = sum(u.days);
    table.replaceChildren(
      el('thead', {}, el('tr', {}, th(T('Tanggal', 'Date')), th(T('Balasan', 'Replies'), 1), th(T('Token masuk', 'Input tokens'), 1), th(T('…dari cache', '…cached'), 1), th(T('Token keluar', 'Output tokens'), 1), th(T('Biaya (USD)', 'Cost (USD)'), 1), th(T('Biaya (Rp)', 'Cost (Rp)'), 1), th(''))),
      el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 8, textContent: T('Belum ada pemakaian yang tercatat.', 'No usage recorded yet.') }))])),
      rows.length ? el('tfoot', {}, line(T('Jumlah (', 'Total (') + u.days.length + T(' hari)', ' days)'), total, total.usd, false)) : null);
  } catch (e) { toast(e.message, true); }
}

// ---------- status bot ----------
function renderStatus() {
  if (!state) return;
  $('brandSub').textContent = profile.brand;
  const st = state.status;
  // Dashboard online hanya tahu keadaan bot dari laporan terakhirnya.
  const mins = st && st.reportedAt ? Math.round((Date.now() - st.reportedAt) / 60000) : null;
  $('chipLlm').textContent = state.testReady ? T('uji coba siap', 'test chat ready') : T('LLM belum diatur', 'LLM not configured');
  $('chipLlm').className = 'chip ' + (state.testReady ? 'ok' : 'warn');
  const paused = state.project && state.project.paused;
  $('chipWa').textContent = paused ? T('bot dijeda', 'bot paused') : !st || mins === null ? T('bot belum pernah melapor', 'bot has never reported')
    : mins > 2 ? T('bot terakhir melapor ', 'bot last reported ') + mins + T(' menit lalu', ' min ago') : 'WhatsApp: ' + waLabel(st.wa);
  $('chipWa').className = 'chip ' + (paused ? 'danger' : !st || mins === null || mins > 2 || st.wa !== 'connected' ? 'warn' : 'ok');
  const info = !st
    ? [['Bot', T('Belum pernah melapor ke dashboard ini.', 'Has never reported to this dashboard.')]]
    : [[T('Jalur WhatsApp', 'WhatsApp channel'), st.transport], [T('Kabar lead lewat WA ke', 'Lead news on WA goes to'), st.sales || T('belum ada nomor', 'no number yet')],
        ['Google Sheet', st.sheet ? T('siap', 'ready') : T('belum diatur', 'not set')],
        [T('Transkripsi pesan suara', 'Voice note transcription'), st.channels && st.channels.stt ? T('siap', 'ready') : T('belum diatur di .env bot (STT_API_KEY)', 'not set in the bot\'s .env (STT_API_KEY)')],
        [T('Yang dibalas', 'Who gets a reply'), st.onlyNumbers ? T('MODE UJI: hanya ', 'TEST MODE: only ') + st.onlyNumbers + T(' nomor', ' numbers') : T('semua nomor', 'every number')],
        [T('Panggilan LLM hari ini', 'LLM calls today'), st.usage.calls + T(' dari batas ', ' of limit ') + st.usage.limit],
        ...(st.guard ? [[T('Pengaman nomor', 'Number safeguard'), st.guard]] : [])];
  $('envInfo').replaceChildren(el('tbody', {}, ...info.map(([k, v]) => el('tr', {}, el('td', { textContent: k, style: 'width:220px;color:var(--muted)' }), el('td', { textContent: v })))));
}

// ---------- WhatsApp & proyek ----------
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
const waLabel = (s) => (WA_STATES[s] ? WA_STATES[s]()[0] : s || '—');
let waTimer = null;
let wa = null;

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
  const showQr = w && !stale && w.state === 'qr' && w.qr && typeof qrcode === 'function';
  $('waQr').hidden = !showQr;
  if (!showQr) {
    // Jangan sisakan gambar kosong (ikon rusak) saat QR tidak lagi berlaku.
    $('waQrImg').removeAttribute('src');
    delete $('waQrImg').dataset.qr;
  }
  if (showQr && $('waQrImg').dataset.qr !== w.qr) {
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
    : w && w.state === 'connected' ? T('Tersambung sebagai ', 'Connected as ') + (w.self_phone || '?')
    : w && w.detail ? w.detail : '';
  const cloud = p && p.transport === 'cloud';
  $('waPair').disabled = cloud;
  $('waNumber').disabled = cloud;
  if (!$('waNumber').value && p && p.wa_number) $('waNumber').value = p.wa_number;
  $('waFoot').textContent = w ? [T('Jalur: ', 'Channel: ') + (w.transport || (p && p.transport) || '—'), w.version ? T('versi bot ', 'bot version ') + w.version : '',
    w.started_at ? T('dinyalakan ', 'started ') + when(w.started_at) : ''].filter(Boolean).join(' · ') : T('Bot proyek ini belum pernah melapor. Di server, bot dinyalakan dalam ±1 menit setelah proyek dibuat.', 'This project\'s bot has never reported. On the server it starts within a minute after the project is created.');
}

async function loadWa() {
  clearTimeout(waTimer);
  if (!project || tab !== 'pengaturan') return;
  try {
    wa = await api('wa');
    renderWa();
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

function renderProject() {
  const p = state && state.project;
  if (!p) return;
  $('projName').value = p.name || '';
  $('projTransport').value = p.transport || 'baileys';
  $('projWa').value = p.wa_number || '';
  $('projSales').value = p.sales_number || '';
  $('projEnabled').checked = Boolean(p.enabled);
  $('projPaused').checked = Boolean(p.paused);
  $('pauseBar').classList.toggle('on', Boolean(p.paused));
}

async function putProject(patch, message) {
  const r = await api('project', { method: 'PUT', body: JSON.stringify(patch) });
  state.project = r.project;
  const i = projects.findIndex((x) => x.id === r.project.id);
  if (i >= 0) projects[i] = { ...projects[i], ...r.project };
  renderProjects();
  renderProject();
  renderStatus();
  toast(message);
}

$('projSave').addEventListener('click', async () => {
  try {
    await putProject({ name: $('projName').value, transport: $('projTransport').value, wa_number: $('projWa').value, sales_number: $('projSales').value, enabled: $('projEnabled').checked },
      T('Proyek disimpan.', 'Project saved.'));
  } catch (e) { toast(e.message, true); renderProject(); }
});

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

async function switchProject(id) {
  if (id === project) return;
  if (dirty && !confirm(T('Ada perubahan yang belum disimpan. Pindah proyek tanpa menyimpan?', 'There are unsaved changes. Switch project without saving?'))) {
    $('projectSel').value = project;
    return;
  }
  project = id;
  history.replaceState(null, '', '#' + encodeURIComponent(id));
  chat = [];
  known = {};
  leadData = null;
  wa = null;
  $('waNumber').value = '';
  $('waQrImg').removeAttribute('src');
  delete $('waQrImg').dataset.qr;
  await load();
}

$('projectSel').addEventListener('change', () => {
  if ($('projectSel').value === '+') {
    $('projectSel').value = project;
    $('npErr').textContent = '';
    $('newProject').classList.add('on');
    $('npId').focus();
    return;
  }
  void switchProject($('projectSel').value);
});
$('npCancel').addEventListener('click', () => $('newProject').classList.remove('on'));
$('newProjectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('npErr').textContent = '';
  try {
    const r = await api('projects', { method: 'POST', body: JSON.stringify({
      id: $('npId').value.trim().toLowerCase(), name: $('npName').value, template: $('npTemplate').value, wa_number: $('npWa').value, sales_number: $('npSales').value,
    }) });
    $('newProject').classList.remove('on');
    $('newProjectForm').reset();
    toast(T('Proyek dibuat. Tautkan WhatsApp-nya di halaman Pengaturan.', 'Project created. Link its WhatsApp on the Settings page.'));
    tab = 'pengaturan';
    project = '';
    await switchProject(r.project.id);
  } catch (err) { $('npErr').textContent = err.message; }
});

// ---------- navigasi, simpan, masuk ----------
function show(next) {
  tab = next;
  for (const b of $('nav').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === 'tab-' + tab);
  const [title, desc] = PAGES[tab]();
  $('title').textContent = title;
  $('desc').textContent = desc;
  setDirty(dirty);
  if (tab === 'lead') loadLeads();
  if (tab === 'biaya') loadUsage();
  if (tab === 'peringatan') loadAlerts();
  if (tab === 'pengaturan') void loadWa();
  else clearTimeout(waTimer);
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
  setBadge(state.alerts, state.status);
  if (!chat.length) $('chat').replaceChildren(chatHint());
  show(tab);
}

$('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) show(btn.dataset.tab);
});

$('lang').addEventListener('click', (e) => {
  const next = e.target.dataset && e.target.dataset.lang;
  if (!next || next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch { /* tetap berlaku untuk kunjungan ini */ }
  renderAll();
});

async function save(quiet = false) {
  $('save').disabled = true;
  try {
    const body = {};
    for (const k of changed) if (k !== 'files') body[k] = profile[k];
    const r = await api('profile', { method: 'PUT', body: JSON.stringify(body) });
    profile = r.profile;
    setDirty(false);
    renderAll();
    if (leadData) renderLeads();
    if (!quiet) toast(T('Tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.', 'Saved. The bot uses the new settings from the next message.') +
      (r.autoPdf ? ' ' + r.autoPdf + T(' produk baru otomatis dipasangi PDF.', ' new products were given a PDF automatically.') : ''));
  } catch (e) {
    toast(e.message, true);
    setDirty(true);
  }
}
$('save').addEventListener('click', () => void save());

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

async function load() {
  const list = await api('projects');
  projects = list.projects;
  templates = list.templates;
  if (!projects.some((p) => p.id === project)) project = projects.length ? projects[0].id : '';
  history.replaceState(null, '', project ? '#' + encodeURIComponent(project) : location.pathname);
  if (!project) {
    // Belum ada proyek sama sekali: mulai dengan membuat satu.
    $('login').classList.remove('on');
    renderProjects();
    $('newProject').classList.add('on');
    return;
  }
  state = await api('state');
  profile = state.profile;
  $('login').classList.remove('on');
  dirty = false;
  changed.clear();
  renderAll();
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
  location.reload();
});

applyLang();
load().catch(() => {});
