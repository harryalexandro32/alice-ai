// Dashboard pemilik. Semua teks dari server dipasang lewat textContent, tidak
// pernah innerHTML: data produk dan nama pelanggan diketik orang.
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

let profile = null;
let dirty = false;
// Hanya kunci yang benar-benar diubah yang dikirim: yang tidak disentuh tetap
// mengikuti bawaan, jadi perbaikan bawaan di kemudian hari tetap sampai.
const changed = new Set();
let chat = [];
let known = {};

const TITLES = {
  identitas: 'Identitas', data: 'Data pelanggan', produk: 'Data produk', rekomendasi: 'Rekomendasi',
  foto: 'Foto', perilaku: 'Perilaku', uji: 'Uji coba', lead: 'Lead',
};

function toast(text, err = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), err ? 5000 : 2600);
}

async function api(path, opts = {}) {
  const res = await fetch('/admin/api/' + path, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    $('login').classList.add('on');
    throw new Error('Belum masuk.');
  }
  if (!res.ok) throw new Error(data.error || 'Gagal (' + res.status + ').');
  return data;
}

function setDirty(v, key) {
  dirty = v;
  if (v && key) changed.add(key);
  if (!v) changed.clear();
  $('save').disabled = !v;
  $('save').textContent = v ? 'Simpan & terapkan' : 'Tersimpan';
}

// ---------- isian sederhana ----------
function fillInputs() {
  for (const input of document.querySelectorAll('[data-key]')) {
    const v = profile[input.dataset.key];
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = v ?? '';
  }
  updateKnowLen();
}

function updateKnowLen() {
  const n = (profile.knowledge || '').length;
  $('knowLen').textContent =
    n.toLocaleString('id-ID') + ' karakter. Makin panjang, makin mahal tiap balasan; di atas ±30.000 mulai terasa.';
}

document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.key;
  if (!key || !profile) return;
  profile[key] =
    e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  if (key === 'knowledge') updateKnowLen();
  setDirty(true, key);
});

// ---------- data pelanggan ----------
function renderFields() {
  const box = $('fields');
  box.replaceChildren(
    el('div', { className: 'fr head' },
      el('div', { textContent: 'Kunci' }), el('div', { textContent: 'Sebutan ke pelanggan' }),
      el('div', { textContent: 'Petunjuk untuk bot' }), el('div', { textContent: 'Nama?' }), el('div'))
  );
  profile.leadFields.forEach((f, i) => {
    const mk = (prop, ph) => {
      const input = el('input', { type: 'text', value: f[prop] || '', placeholder: ph });
      input.addEventListener('input', () => { f[prop] = input.value; setDirty(true, 'leadFields'); });
      return input;
    };
    const isName = el('input', { type: 'checkbox', checked: Boolean(f.isName), title: 'Dipakai untuk menyapa' });
    isName.addEventListener('change', () => {
      profile.leadFields.forEach((x) => (x.isName = false));
      f.isName = isName.checked;
      setDirty(true, 'leadFields');
      renderFields();
    });
    const del = el('button', { className: 'btn danger small', textContent: 'Hapus', type: 'button' });
    del.addEventListener('click', () => {
      if (profile.leadFields.length <= 1) return toast('Minimal satu baris.', true);
      profile.leadFields.splice(i, 1);
      setDirty(true, 'leadFields');
      renderFields();
    });
    box.append(el('div', { className: 'fr' }, mk('key', 'mis. kota'), mk('label', 'mis. kota/alamat'), mk('hint', 'apa yang dihitung sebagai jawabannya'), isName, del));
  });
}

$('addField').addEventListener('click', () => {
  if (profile.leadFields.length >= 8) return toast('Maksimal 8 baris.', true);
  profile.leadFields.push({ key: '', label: '', hint: '', isName: false });
  setDirty(true, 'leadFields');
  renderFields();
});

// ---------- foto ----------
function renderPhotos() {
  const list = profile.photos || [];
  $('photoCount').textContent = list.length + ' foto';
  $('photoEmpty').style.display = list.length ? 'none' : '';
  $('photos').replaceChildren(
    ...list.map((p) => {
      const lab = el('input', { type: 'text', value: p.label });
      const tags = el('input', { type: 'text', value: p.tags || '', placeholder: 'produk / kata kunci' });
      const save = el('button', { className: 'btn ghost small', textContent: 'Simpan', type: 'button' });
      const del = el('button', { className: 'btn danger small', textContent: 'Hapus', type: 'button' });
      save.addEventListener('click', async () => {
        try {
          const r = await api('photos/' + p.id, { method: 'PATCH', body: JSON.stringify({ label: lab.value, tags: tags.value }) });
          profile.photos = r.photos;
          renderPhotos();
          toast('Keterangan foto disimpan.');
        } catch (e) { toast(e.message, true); }
      });
      del.addEventListener('click', async () => {
        if (!confirm('Hapus foto "' + p.label + '"? Tidak bisa dibatalkan.')) return;
        try {
          const r = await api('photos/' + p.id, { method: 'DELETE' });
          profile.photos = r.photos;
          renderPhotos();
          toast('Foto dihapus.');
        } catch (e) { toast(e.message, true); }
      });
      return el('div', { className: 'photo' },
        el('img', { src: '/admin/media/' + p.file, alt: p.label, loading: 'lazy' }),
        el('div', { className: 'pb' }, lab, tags, el('div', { className: 'pa' }, save, del)));
    })
  );
}

$('upBtn').addEventListener('click', async () => {
  const file = $('upFile').files[0];
  const label = $('upLabel').value.trim();
  if (!file) return toast('Pilih berkas fotonya dulu.', true);
  if (!label) return toast('Isi keterangan fotonya dulu.', true);
  $('upBtn').disabled = true;
  try {
    const q = new URLSearchParams({ label, tags: $('upTags').value.trim() });
    const r = await api('photos?' + q, { method: 'POST', body: file, headers: { 'content-type': file.type } });
    profile.photos = r.photos;
    renderPhotos();
    $('upFile').value = $('upLabel').value = $('upTags').value = '';
    toast('Foto tersimpan dan langsung bisa dipakai bot.');
  } catch (e) { toast(e.message, true); }
  $('upBtn').disabled = false;
});

// ---------- uji coba ----------
function addMsg(cls, text, photos) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  for (const p of photos || []) m.append(el('img', { src: '/admin/media/' + p.file, alt: p.label, title: p.label }));
  $('chat').append(m);
  $('chat').scrollTop = $('chat').scrollHeight;
  return m;
}

$('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('sendText').value.trim();
  if (!text) return;
  if (dirty) addMsg('note', 'Ada perubahan yang belum disimpan — jawaban di bawah masih memakai profil lama.');
  $('sendText').value = '';
  addMsg('in', text);
  const wait = addMsg('note', 'sedang mengetik…');
  try {
    const r = await api('test', { method: 'POST', body: JSON.stringify({ text, history: chat, known }) });
    wait.remove();
    if (r.rejected) {
      addMsg('bad', 'Balasan ini TIDAK akan dikirim (' + r.rejected + '):\n\n' + r.reply);
    } else {
      addMsg('out', r.reply, r.photos);
    }
    Object.assign(known, r.fields);
    const got = Object.entries(r.fields).map(([k, v]) => k + ' = ' + v).join(' · ');
    addMsg('note', 'niat: ' + r.intent + (got ? ' · tercatat: ' + got : '') + (r.photos.length ? ' · ' + r.photos.length + ' foto' : ''));
    chat.push({ dir: 'in', text }, { dir: 'out', text: r.reply });
  } catch (err) {
    wait.remove();
    addMsg('bad', err.message);
  }
});

$('resetChat').addEventListener('click', () => {
  chat = [];
  known = {};
  $('chat').replaceChildren(el('div', { className: 'msg note', textContent: 'Ketik seperti calon pelanggan.' }));
});

// ---------- lead ----------
async function loadLeads() {
  const t = $('leads');
  try {
    const r = await api('leads');
    const head = el('tr', {}, el('th', { textContent: 'Nomor' }), ...r.fields.map((f) => el('th', { textContent: f.label })),
      el('th', { textContent: 'Status' }), el('th', { textContent: 'Terakhir chat' }));
    const rows = r.rows.map((c) =>
      el('tr', {}, el('td', { textContent: c.phone }), ...r.fields.map((f) => el('td', { textContent: c.lead[f.key] || '—' })),
        el('td', { textContent: (c.complete ? 'lengkap' : 'belum lengkap') + (c.needsSales ? ' · perlu sales' : '') + (c.lastDir === 'human' ? ' · ditangani manusia' : '') }),
        el('td', { textContent: new Date(c.lastAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) })));
    t.replaceChildren(head, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: r.fields.length + 3, textContent: 'Belum ada percakapan.' }))]));
  } catch (e) { toast(e.message, true); }
}

// ---------- navigasi, simpan, masuk ----------
$('nav').addEventListener('click', (e) => {
  const tab = e.target.dataset && e.target.dataset.tab;
  if (!tab) return;
  for (const b of $('nav').children) b.classList.toggle('on', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === 'tab-' + tab);
  $('title').textContent = TITLES[tab];
  if (tab === 'lead') loadLeads();
});

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const body = {};
    for (const k of changed) body[k] = profile[k];
    const r = await api('profile', { method: 'PUT', body: JSON.stringify(body) });
    profile = r.profile;
    fillInputs();
    renderFields();
    setDirty(false);
    $('brandName').textContent = profile.brand;
    toast('Tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.');
  } catch (e) {
    toast(e.message, true);
    setDirty(true);
  }
});

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

async function load() {
  const s = await api('state');
  profile = s.profile;
  $('login').classList.remove('on');
  $('brandName').textContent = profile.brand;
  $('brandSub').textContent = 'profil: ' + s.status.business;
  $('chipLlm').textContent = s.status.llm ? 'LLM: ' + s.status.llm : 'LLM belum diatur';
  $('chipLlm').className = 'chip ' + (s.status.llm ? 'ok' : 'warn');
  $('chipWa').textContent = 'jalur: ' + s.status.transport;
  $('envInfo').textContent =
    'Sekarang — nomor sales: ' + (s.status.sales || 'belum diatur') + ' · Google Sheet: ' + (s.status.sheet ? 'siap' : 'belum diatur') +
    (s.status.onlyNumbers ? ' · MODE UJI: hanya ' + s.status.onlyNumbers + ' nomor yang dibalas' : ' · membalas semua nomor') +
    ' · panggilan LLM hari ini: ' + s.status.usage.calls + ' dari ' + s.status.usage.limit;
  fillInputs();
  renderFields();
  renderPhotos();
  setDirty(false);
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

load().catch(() => {});
