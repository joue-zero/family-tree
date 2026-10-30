'use strict';
/* شجرة العيلة — static app. Data lives in data/family.json (committed to the repo). */

// ───────────────────────── helpers ─────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'p' + Math.random().toString(36).slice(2, 8);
const norm = (s) => (s || '').toLowerCase().replace(/[ً-ٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
const yearOf = (p) => parseInt((p.birth || '').match(/\d{4}/)?.[0]) || 9999;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ───────────────────────── state ─────────────────────────
const CARD_W = 148, CARD_H = 206, GAP_X = 20, GAP_Y = 76, SP_GAP = 16, PAD = 50;
let data = { meta: { title: 'شجرة العيلة' }, people: [] };
let byId = new Map();
let kids = new Map();
let baseText = '';                 // family.json as last loaded/saved (for merge on save)
const state = { me: store.get('ft-me'), root: null, selected: null, edit: false, cmp: false, picks: [], coll: new Map(), dirty: false, photos: {}, newPhotos: new Set(), mblob: new Map(), newMedia: new Set() };
let cfg = { ...detectRepo(), branch: 'main', token: '', ...(store.get('ft-cfg') || {}) };
let cur = null;                    // current layout

function detectRepo() {
  const m = location.hostname.match(/^(.+)\.github\.io$/);
  return m ? { owner: m[1], repo: location.pathname.split('/')[1] || `${m[1]}.github.io` } : {};
}

// ───────────────────────── data model ─────────────────────────
document.documentElement.style.setProperty('--card-w', CARD_W + 'px');
document.documentElement.style.setProperty('--card-h', CARD_H + 'px');
const ancCache = new Map();
function index() {
  ancCache.clear();
  byId = new Map(data.people.map((p) => [p.id, p]));
  for (const p of data.people) {
    p.parents = (p.parents || []).filter((i) => byId.has(i) && i !== p.id).slice(0, 2);
    p.spouses = (p.spouses || []).filter((i) => byId.has(i) && i !== p.id);
  }
  for (const p of data.people) {
    for (const s of p.spouses) { const o = byId.get(s); if (!o.spouses.includes(p.id)) o.spouses.push(p.id); }
    if (p.parents.length === 2) {
      const [a, b] = p.parents.map((i) => byId.get(i));
      if (!a.spouses.includes(b.id)) a.spouses.push(b.id);
      if (!b.spouses.includes(a.id)) b.spouses.push(a.id);
    }
  }
  kids = new Map();
  for (const p of data.people) for (const par of p.parents) {
    if (!kids.has(par)) kids.set(par, []);
    kids.get(par).push(p);
  }
  for (const arr of kids.values()) arr.sort((a, b) => yearOf(a) - yearOf(b));
}
const get = (id) => byId.get(id);
const src = (path) => {            // pending local data URL → decrypted blob URL (encrypted mode) → plain path
  if (!path) return '';
  if (state.photos[path]) return state.photos[path];
  if (!vault.on) return path;
  const u = blobUrls.get(path);
  if (!u && !failedBlobs.has(path)) ensureBlob(path);
  return u || '';
};
const photoSrc = (p) => src(p.photo);
const lifeText = (p, full) => {      // cards show the year only; the panel shows full dates
  const f = (s) => (full ? s : (s || '').match(/\d{4}/)?.[0] ?? s);
  const b = f(p.birth), d = p.death && p.death !== '?' ? f(p.death) : '';
  if (b && d) return `${b} – ${d}`;
  if (b) return p.death ? `${b} –` : b;
  return d ? `– ${d}` : '';
};
function ageText(p) {
  const by = yearOf(p); if (by === 9999) return '';
  const dy = parseInt((p.death || '').match(/\d{4}/)?.[0]);
  if (p.death) return dy ? `عاش ${dy - by} سنة` : '';
  return `${new Date().getFullYear() - by} سنة`;
}
function lineage(p) {
  const out = []; let c = p;
  for (let i = 0; i < 3; i++) {
    const f = c.parents.map(get).find((x) => x.gender === 'm') || c.parents.map(get)[0];
    if (!f) break;
    const w = f.name.trim().split(/\s+/);
    out.push(/^(عبد|أبو|ابو|أم)$/.test(w[0]) && w[1] ? `${w[0]} ${w[1]}` : w[0]); c = f;
  }
  return out.length ? (p.gender === 'f' ? 'بنت ' : 'ابن ') + out.join(' بن ') : '';
}
function siblings(p) {
  const s = new Map();
  for (const par of p.parents) for (const c of kids.get(par) || []) if (c.id !== p.id) s.set(c.id, c);
  return [...s.values()];
}
const parentPick = (p) => { const ps = p.parents.map(get); return ps.find((x) => x.gender === 'm') || ps[0] || null; };
function topAncestor(p) {
  const seen = new Set(); let c = p;
  while (!seen.has(c.id)) { seen.add(c.id); const up = parentPick(c); if (!up) break; c = up; }
  return c;
}
function rootFor(p) {
  if (!p.parents.length) {
    const sp = p.spouses.map(get).find((s) => s.parents.length);
    if (sp) return topAncestor(sp);
  }
  return topAncestor(p);
}
function countDesc(p, seen = new Set()) {
  if (seen.has(p.id)) return 0; seen.add(p.id);
  let n = 1; for (const c of kids.get(p.id) || []) n += countDesc(c, seen);
  return n;
}

// ───────────────────────── persistence ─────────────────────────
const clean = (p) => {
  const o = {};
  for (const k of ['id', 'name', 'nick', 'gender', 'birth', 'death', 'photo', 'phone', 'note', 'details', 'gallery', 'media', 'parents', 'spouses']) {
    const v = p[k]; if (v && (!Array.isArray(v) || v.length)) o[k] = v;
  }
  return o;
};
function serialize(d) {
  const lines = d.people.map((p) => '    ' + JSON.stringify(clean(p)));
  return `{\n  "meta": ${JSON.stringify(d.meta)},\n  "people": [\n${lines.join(',\n')}\n  ]\n}\n`;
}
function touch() {
  index(); state.dirty = true;
  const ok = store.set('ft-draft', { data: JSON.parse(serialize(data)), photos: state.photos, newPhotos: [...state.newPhotos], newMedia: [...state.newMedia] });
  if (!ok) toast('تحذير: المسودة المحلية كبيرة ومحفوظتش — احفظ على GitHub قريب');
  render();
}
// ───────────────────────── vault (client-side encryption) ─────────────────────────
// Everything stored on GitHub (data/family.enc and every photo/audio/video as <path>.enc) is AES-256-GCM
// encrypted in the browser with a key derived (PBKDF2-SHA256) from the family password. GitHub only sees ciphertext.
const enc = new TextEncoder(), dec = new TextDecoder();
const vault = { on: false, key: null, salt: null, iter: 600000 };
const bytesB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64Bytes = (s) => Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0));
const dataUrlBytes = (u) => b64Bytes(u.split(',')[1]);
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function encBytes(u8) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vault.key, u8));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
async function decBytes(u8) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, vault.key, u8.subarray(12)));
}
async function makeEnvelope(text) {
  return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: vault.iter, salt: bytesB64(vault.salt), data: bytesB64(await encBytes(enc.encode(text))) }) + '\n';
}
const openEnvelope = async (env) => dec.decode(await decBytes(b64Bytes(env.data)));
async function rememberKey() {
  store.set('ft-key', { salt: bytesB64(vault.salt), k: bytesB64(new Uint8Array(await crypto.subtle.exportKey('raw', vault.key))) });
}
async function recallKey(env) {
  const m = store.get('ft-key'); if (!m || m.salt !== env.salt) return null;
  try { return await crypto.subtle.importKey('raw', b64Bytes(m.k), 'AES-GCM', true, ['encrypt', 'decrypt']); } catch { return null; }
}
function askPassword(env) {
  return new Promise((resolve) => {
    const L = $('#lock'), inp = $('#lockPw'), err = $('#lockErr'), btn = $('#lockGo');
    L.hidden = false; setTimeout(() => inp.focus(), 50);
    const go = async () => {
      if (!inp.value) return;
      btn.disabled = true; err.textContent = '';
      try {
        vault.salt = b64Bytes(env.salt); vault.iter = env.iter;
        vault.key = await deriveKey(inp.value, vault.salt, env.iter);
        const text = await openEnvelope(env);          // throws if the password is wrong
        if ($('#lockRemember').checked) await rememberKey();
        L.hidden = true; inp.value = ''; resolve(text);
      } catch { err.textContent = 'كلمة السر غلط'; btn.disabled = false; inp.select(); }
    };
    btn.onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}

// decrypted photo/audio/video blobs (fetched as <path>.enc on demand)
const blobUrls = new Map(), loadingBlobs = new Map(), failedBlobs = new Set(); let blobTimer = 0;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webm: 'video/webm', mp4: 'video/mp4', m4a: 'audio/mp4', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', mov: 'video/quicktime' };
function ensureBlob(path) {
  if (blobUrls.has(path)) return Promise.resolve(blobUrls.get(path));
  if (loadingBlobs.has(path)) return loadingBlobs.get(path);
  const pr = (async () => {
    const r = await fetch(path + '.enc'); if (!r.ok) throw new Error(r.status);
    const bytes = await decBytes(new Uint8Array(await r.arrayBuffer()));
    const url = URL.createObjectURL(new Blob([bytes], { type: MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream' }));
    blobUrls.set(path, url); clearTimeout(blobTimer); blobTimer = setTimeout(() => render(), 150);
    return url;
  })().catch(() => { failedBlobs.add(path); return ''; }).finally(() => loadingBlobs.delete(path));
  loadingBlobs.set(path, pr); return pr;
}

async function load() {
  let text = null, env = null;
  try { const r = await fetch('data/family.enc', { cache: 'no-cache' }); if (r.ok) env = await r.json(); } catch { /* missing or offline */ }
  if (env) {
    vault.on = true; vault.salt = b64Bytes(env.salt); vault.iter = env.iter;
    const k = await recallKey(env);
    if (k) { vault.key = k; try { text = await openEnvelope(env); } catch { vault.key = null; store.del('ft-key'); } }
    if (text == null) text = await askPassword(env);
  } else {
    try { const r = await fetch('data/family.json', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); text = await r.text(); }
    catch { toast('مقدرتش أقرأ البيانات — شغّل الموقع من سيرفر (مش فتح الملف مباشرة)'); text = JSON.stringify(data); }
  }
  baseText = text; data = JSON.parse(text);
  $('#btnEnc').hidden = vault.on;
  const draft = store.get('ft-draft');
  if (draft && draft.data) {
    data = draft.data; state.photos = draft.photos || {}; state.newPhotos = new Set(draft.newPhotos || []); state.dirty = true;
    // media files added but never saved live only in memory — drop dangling references after a reload
    const lost = new Set(draft.newMedia || []); let n = 0;
    for (const p of data.people) if (p.media) { const k = p.media.filter((m) => !lost.has(m.src)); n += p.media.length - k.length; p.media = k; }
    if (n) setTimeout(() => toast(`${n} تسجيل/فيديو ماتحفظوش قبل ما الصفحة تتقفل واتشالوا`), 800);
  }
  index();
  if (state.me && !byId.has(state.me)) state.me = null;
  $('#btnMe').textContent = state.me ? `👤 ${get(state.me).name.split(' ')[0]}` : '👤 أنا مين؟';
  state.root = data.meta.root && byId.has(data.meta.root) ? data.meta.root : (data.people.find((p) => !p.parents.length) || data.people[0] || {}).id || null;
  $('#title').textContent = data.meta.title || 'شجرة العيلة';
  document.title = data.meta.title || 'شجرة العيلة';
  render({ fit: true });
  const h = decodeURIComponent(location.hash.slice(1));
  if (h && byId.has(h)) setTimeout(() => locate(h), 50);
}

// GitHub API ---------------------------------------------------
async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
const b64 = (s) => { const b = new TextEncoder().encode(s); let t = ''; b.forEach((c) => (t += String.fromCharCode(c))); return btoa(t); };
const blobB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(b); });
const unb64 =(s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

function mergeRemote(remote, base) {         // keep other people's edits made since we loaded
  const key = (p) => JSON.stringify(clean(p));
  const B = new Map(base.people.map((p) => [p.id, key(p)]));
  const O = new Map(data.people.map((p) => [p.id, p]));
  const out = [...data.people];
  for (const rp of remote.people) {
    const o = O.get(rp.id);
    if (!o) { if (!B.has(rp.id)) out.push(rp); }
    else if (key(o) === B.get(rp.id) && key(rp) !== B.get(rp.id)) out[out.indexOf(o)] = rp;
  }
  data.people = out;
}
async function commitFiles(files, deletes, message) {
  const R = `/repos/${cfg.owner}/${cfg.repo}`;
  const ref = await gh(`${R}/git/ref/heads/${cfg.branch}`);
  const parent = await gh(`${R}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    const blob = await gh(`${R}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: f.content, encoding: 'base64' }) });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const d of deletes) tree.push({ path: d, mode: '100644', type: 'blob', sha: null });
  const t = await gh(`${R}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
  const c = await gh(`${R}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
  await gh(`${R}/git/refs/heads/${cfg.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
}
async function remotePlain() {             // what's on GitHub right now, decrypted (for merging other people's edits)
  const R = `/repos/${cfg.owner}/${cfg.repo}`;
  if (vault.on) {
    const f = await gh(`${R}/contents/data/family.enc?ref=${cfg.branch}`);
    return openEnvelope(JSON.parse(unb64(f.content)));
  }
  return unb64((await gh(`${R}/contents/data/family.json?ref=${cfg.branch}`)).content);
}
const fileEntry = async (path, u8) => (vault.on ? { path: path + '.enc', content: bytesB64(await encBytes(u8)) } : { path, content: bytesB64(u8) });
const referenced = (path) => data.people.some((p) => p.photo === path || (p.gallery || []).includes(path) || (p.media || []).some((m) => m.src === path));

async function saveToGitHub() {
  if (!cfg.token || !cfg.owner || !cfg.repo) { toast('لازم تضبط الريبو والـ Token الأول'); return openSettings(); }
  const btn = $('#btnSave'); btn.disabled = true; btn.firstChild.textContent = 'جاري الحفظ… ';
  try {
    const remoteText = await remotePlain();
    if (remoteText !== baseText) { mergeRemote(JSON.parse(remoteText), JSON.parse(baseText || remoteText)); index(); toast('اتدمجت تعديلات تانية من حد تاني'); }
    const text = serialize(data), files = [];
    files.push(vault.on ? { path: 'data/family.enc', content: b64(await makeEnvelope(text)) } : { path: 'data/family.json', content: b64(text) });
    for (const path of state.newPhotos) if (referenced(path) && state.photos[path]) files.push(await fileEntry(path, dataUrlBytes(state.photos[path])));
    for (const path of state.newMedia) {
      const m = state.mblob.get(path);
      if (m && referenced(path)) files.push(await fileEntry(path, new Uint8Array(await m.blob.arrayBuffer())));
    }
    await commitFiles(files, [], 'Update family tree');
    baseText = text; state.dirty = false; state.newPhotos.clear(); state.newMedia.clear(); store.del('ft-draft');
    toast('✓ اتحفظ — الموقع هيتحدّث خلال دقيقة تقريبًا');
    render();
  } catch (e) {
    toast('فشل الحفظ: ' + e.message);
  } finally {
    btn.disabled = false; btn.firstChild.textContent = 'حفظ ';
  }
}

// one-time: encrypt the existing plaintext data + files and delete the plaintext from the repo
function openEnable() {
  dlg.innerHTML = `<form><h2>🔒 تشفير الشجرة</h2>
    <p class="hint">كل البيانات والصور والصوت والفيديو هتتشفّر على جهازك قبل ما تترفع، وGitHub مش هيشوف غير بيانات مش مفهومة. أي حد يفتح الموقع هيحتاج كلمة السر دي.</p>
    <label>كلمة سر العيلة (جملة طويلة، 10 حروف على الأقل)<input id="ePw" type="password" autocomplete="new-password"></label>
    <label>أعد كتابتها<input id="ePw2" type="password" autocomplete="new-password"></label>
    <label class="chk"><input type="checkbox" id="eRem" checked> افتكرني على الجهاز ده</label>
    <p class="hint"><b>مهم:</b> كلمة السر مش بتتخزن في أي مكان ومفيش طريقة لاسترجاعها. لو ضاعت، البيانات المشفّرة ماتتفتحش. احفظها عند حد موثوق.<br>
    التاريخ القديم للـ commits على GitHub هيفضل فيه النسخة القديمة غير المشفّرة (لو كنت دخّلت بيانات حقيقية قبل كده، اعمل ريبو جديد).</p>
    <p class="hint" id="eStat"></p>
    <div class="dlgActions"><button type="button" data-close>إلغاء</button><button type="submit" class="primary" id="eGo">شفّر وارفع</button></div></form>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('form', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#ePw', dlg).value, st = $('#eStat', dlg);
    if (pw.length < 10) return (st.textContent = 'كلمة السر قصيرة — اكتب جملة من 10 حروف على الأقل');
    if (pw !== $('#ePw2', dlg).value) return (st.textContent = 'الكلمتين مش زي بعض');
    if (!cfg.token || !cfg.owner || !cfg.repo) { dlg.close(); toast('لازم تضبط الريبو والـ Token الأول'); return openSettings(); }
    $('#eGo', dlg).disabled = true; st.textContent = 'جاري التشفير والرفع… (ممكن ياخد دقيقة)';
    try { await enableEncryption(pw, $('#eRem', dlg).checked); dlg.close(); toast('✓ التشفير اتفعّل — الموقع هيطلب كلمة السر من دلوقتي'); }
    catch (err) { vault.on = false; vault.key = null; st.textContent = 'فشل: ' + err.message; $('#eGo', dlg).disabled = false; }
  };
  dlg.showModal(); $('#ePw', dlg).focus();
}
async function enableEncryption(pw, remember) {
  const R = `/repos/${cfg.owner}/${cfg.repo}`;
  vault.salt = crypto.getRandomValues(new Uint8Array(16)); vault.iter = 600000; vault.key = await deriveKey(pw, vault.salt, vault.iter);
  vault.on = true;
  const text = serialize(data), files = [{ path: 'data/family.enc', content: b64(await makeEnvelope(text)) }];
  // every plaintext file currently in the repo under photos/ or media/ (+ the plaintext data file) gets deleted
  const ref = await gh(`${R}/git/ref/heads/${cfg.branch}`), commit = await gh(`${R}/git/commits/${ref.object.sha}`);
  const listing = (await gh(`${R}/git/trees/${commit.tree.sha}?recursive=1`)).tree.filter((x) => x.type === 'blob').map((x) => x.path);
  const deletes = listing.filter((p) => p === 'data/family.json' || (/^(photos|media)\//.test(p) && !p.endsWith('.enc') && !p.endsWith('.gitkeep')));
  const paths = new Set();
  for (const p of data.people) { if (p.photo) paths.add(p.photo); (p.gallery || []).forEach((g) => paths.add(g)); (p.media || []).forEach((m) => m.t !== 'link' && paths.add(m.src)); }
  let missing = 0;
  for (const path of paths) {
    let bytes;
    if (state.photos[path]) bytes = dataUrlBytes(state.photos[path]);
    else if (state.mblob.has(path)) bytes = new Uint8Array(await state.mblob.get(path).blob.arrayBuffer());
    else { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) { missing++; continue; } bytes = new Uint8Array(await r.arrayBuffer()); }
    files.push({ path: path + '.enc', content: bytesB64(await encBytes(bytes)) });
  }
  await commitFiles(files, deletes, 'Encrypt family data');
  if (remember) await rememberKey();
  baseText = text; state.dirty = false; state.newPhotos.clear(); state.newMedia.clear(); store.del('ft-draft');
  $('#btnEnc').hidden = true; render();
  if (missing) toast(`تحذير: ${missing} ملف مش لاقيه واتجاهل`);
}
$('#btnEnc').onclick = openEnable;

// ───────────────────────── layout ─────────────────────────
let forceOpen = false;
const isCollapsed = (id, depth) => !forceOpen && (state.coll.has(id) ? state.coll.get(id) : depth >= 3);

function layout(rootId) {
  const root = get(rootId);
  const desc = new Set();
  (function w(p) { if (desc.has(p.id)) return; desc.add(p.id); (kids.get(p.id) || []).forEach(w); })(root);
  const placed = new Set(), spPlaced = new Set();

  function build(p, depth) {
    placed.add(p.id);
    const u = { p, depth, L: [], R: [], unk: { kids: [] } };
    p.spouses.forEach((sid, i) => {
      const s = get(sid);
      const ghost = desc.has(sid) || spPlaced.has(sid);
      spPlaced.add(sid);
      (i % 2 ? u.L : u.R).push({ p: s, ghost, kids: [] });
    });
    const mine = (kids.get(p.id) || []).filter((c) => !placed.has(c.id));
    u.total = mine.length;
    u.collapsed = mine.length > 0 && isCollapsed(p.id, depth);
    if (u.collapsed) { const seen = new Set(); u.hidden = mine.reduce((n, c) => n + countDesc(c, seen), 0); }
    else for (const c of mine) {
      if (placed.has(c.id)) continue;
      const other = c.parents.find((x) => x !== p.id);
      const g = [...u.L, ...u.R].find((e) => e.p.id === other) || u.unk;
      g.kids.push(build(c, depth + 1));
    }
    return u;
  }
  const groupsOf = (u) => [...u.L.slice().reverse(), u.unk, ...u.R];

  function measure(u) {
    const n = 1 + u.L.length + u.R.length;
    u.uw = n * CARD_W + (n - 1) * SP_GAP;
    let tw = 0, cnt = 0;
    for (const g of groupsOf(u)) for (const k of g.kids) { measure(k); tw += k.w; cnt++; }
    u.kw = tw + Math.max(0, cnt - 1) * GAP_X;
    u.w = Math.max(u.uw, u.kw);
  }

  const cards = [], lines = [], byPerson = new Map();
  function place(u, left, y, isRoot) {
    const x0 = left + u.w / 2 - u.uw / 2;
    const row = [...u.L.slice().reverse(), null, ...u.R];
    row.forEach((e, i) => {
      const self = e === null, x = x0 + i * (CARD_W + SP_GAP), p = self ? u.p : e.p;
      const c = { x, y, p, ghost: !self && e.ghost, main: self, u };
      c.key = c.ghost ? `g:${u.p.id}:${p.id}` : p.id;
      c.up = !c.ghost && p.parents.length > 0 && (isRoot || !self);
      if (self) { u.pcx = x + CARD_W / 2; c.tog = u.total ? { collapsed: u.collapsed, n: u.hidden } : null; }
      else e.cx = x + CARD_W / 2;
      if (!c.ghost) byPerson.set(p.id, c);
      cards.push(c);
    });
    const bottom = y + CARD_H, cy = y + CARD_H + GAP_Y, yb = bottom + 46;
    let kx = left + (u.w - u.kw) / 2;
    for (const g of groupsOf(u)) for (const k of g.kids) { place(k, kx, cy, false); kx += k.w + GAP_X; }
    [u.L, u.R].forEach((side) => side.forEach((e, rank) => {
      const ym = bottom + 12 + rank * 8;
      lines.push([[u.pcx, bottom], [u.pcx, ym], [e.cx, ym], [e.cx, bottom]]);
      e.drop = [(u.pcx + e.cx) / 2, ym];
    }));
    u.unk.drop = [u.pcx, bottom];
    for (const g of groupsOf(u)) {
      if (!g.kids.length) continue;
      const [dx, dy] = g.drop, xs = [dx, ...g.kids.map((k) => k.pcx)];
      lines.push([[dx, dy], [dx, yb]]);
      lines.push([[Math.min(...xs), yb], [Math.max(...xs), yb]]);
      for (const k of g.kids) lines.push([[k.pcx, yb], [k.pcx, cy]]);
    }
  }

  const tree = build(root, 0);
  measure(tree);
  place(tree, 0, 0, true);
  const W = tree.w, H = Math.max(...cards.map((c) => c.y)) + CARD_H;
  for (const c of cards) { c.x = W - c.x - CARD_W + PAD; c.y += PAD; }       // mirror for RTL
  const L2 = lines.map((pl) => pl.map(([x, y]) => [W - x + PAD, y + PAD]));
  return { cards, lines: L2, w: W + PAD * 2, h: H + PAD * 2, byPerson };
}

// ───────────────────────── render ─────────────────────────
const view = $('#view'), stage = $('#stage'), cardsBox = $('#cards'), svg = $('#lines');
const cardEls = new Map();
let T = { k: 1, x: 0, y: 0 };

function cardHTML(c) {
  const p = c.p, ph = photoSrc(p);
  const av = ph ? `<img src="${esc(ph)}" alt="" draggable="false">` : `<span>${esc([...p.name][0] || '؟')}</span>`;
  const note = c.ghost ? '<div class="ghost-note">مذكور في فرع تاني ↗</div>' : `<div class="yr">${esc(lifeText(p))}</div>`;
  const tog = c.tog ? `<button class="tg" data-act="tog" title="${c.tog.collapsed ? 'فتح' : 'طيّ'} الأبناء">${c.tog.collapsed ? '+' + c.tog.n : '−'}</button>` : '';
  const up = c.up ? '<button class="bdg up" data-act="up" title="العيلة الأصلية (فوق)">⇡</button>' : '';
  const pk = state.picks.indexOf(p.id);
  const pkb = pk >= 0 && !c.ghost ? `<span class="pk">${pk + 1}</span>` : '';
  const me = state.me && byId.has(state.me) && !c.ghost ? shortRel(get(state.me), p) : '';
  const rl = me ? `<span class="rl${p.id === state.me ? ' is-me' : ''}">${esc(me)}</span>` : '';
  return `<div class="av">${av}</div><div class="nm">${esc(p.name)}</div>${note}${rl}${up}${tog}${pkb}`;
}

function render(opts = {}) {
  const empty = !state.root || !byId.has(state.root);
  $('#empty').hidden = !empty;
  $('#btnSave').hidden = !state.dirty;
  $('#btnEdit').classList.toggle('on', state.edit);
  $('#btnUp').disabled = empty || !get(state.root).parents.length;
  if (empty) { cardsBox.innerHTML = ''; svg.innerHTML = ''; cardEls.clear(); cur = null; renderPanel(); return; }
  cur = layout(state.root);
  svg.setAttribute('width', cur.w); svg.setAttribute('height', cur.h);
  svg.style.animation = 'none'; void svg.getBoundingClientRect(); svg.style.animation = '';
  svg.innerHTML = cur.lines.map((pl) => `<path d="M${pl.map((p) => p.join(' ')).join('L')}"/>`).join('');
  stage.style.width = cur.w + 'px'; stage.style.height = cur.h + 'px';

  const keep = new Set();
  for (const c of cur.cards) {
    keep.add(c.key);
    let el = cardEls.get(c.key);
    if (!el) {
      el = document.createElement('div'); el.style.opacity = 0;
      el.style.transform = `translate(${c.x}px,${c.y}px)`;
      cardsBox.appendChild(el); cardEls.set(c.key, el);
      requestAnimationFrame(() => requestAnimationFrame(() => (el.style.opacity = '')));
    }
    el.dataset.id = c.p.id; el.dataset.key = c.key;
    el.className = `card ${c.p.gender || ''}${c.ghost ? ' ghost' : ''}${c.p.death ? ' dead' : ''}${state.selected === c.p.id && !c.ghost && !state.cmp ? ' sel' : ''}${state.picks.includes(c.p.id) && !c.ghost ? ' pick' : ''}${state.me === c.p.id && !c.ghost ? ' me' : ''}`;
    el.innerHTML = cardHTML(c);
    el.style.transform = `translate(${c.x}px,${c.y}px)`;
  }
  for (const [k, el] of cardEls) if (!keep.has(k)) { el.style.opacity = 0; setTimeout(() => el.remove(), 320); cardEls.delete(k); }
  if (opts.fit) fit();
  renderPanel(); renderCmp(); drawMini(); updateBday();
}

// pan & zoom ---------------------------------------------------
function applyT(smooth) { stage.classList.toggle('smooth', !!smooth); stage.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.k})`; drawMini(); }

// minimap: only for big trees; tap/drag to jump
const mini = $('#mini'), mctx = mini.getContext('2d');
let miniM = null;
function drawMini() {
  if (!cur || cur.cards.length < 12 || !$('#panel').hidden || state.cmp) { mini.hidden = true; return; }
  mini.hidden = false;
  const W = mini.width, H = mini.height, s = Math.min((W - 8) / cur.w, (H - 8) / cur.h);
  const ox = (W - cur.w * s) / 2, oy = (H - cur.h * s) / 2, cs = getComputedStyle(document.documentElement);
  const col = (v) => cs.getPropertyValue(v).trim();
  mctx.clearRect(0, 0, W, H);
  for (const c of cur.cards) {
    if (c.ghost) continue;
    mctx.fillStyle = c.p.gender === 'f' ? col('--f') : col('--m');
    mctx.fillRect(ox + c.x * s, oy + c.y * s, Math.max(2, CARD_W * s), Math.max(2, CARD_H * s));
  }
  mctx.strokeStyle = col('--accent'); mctx.lineWidth = 2;
  mctx.strokeRect(ox - (T.x / T.k) * s, oy - (T.y / T.k) * s, (view.clientWidth / T.k) * s, (view.clientHeight / T.k) * s);
  miniM = { s, ox, oy };
}
function miniJump(e) {
  if (!miniM) return;
  const r = mini.getBoundingClientRect(), k = mini.width / r.width;
  const sx = ((e.clientX - r.left) * k - miniM.ox) / miniM.s, sy = ((e.clientY - r.top) * k - miniM.oy) / miniM.s;
  T.x = view.clientWidth / 2 - sx * T.k; T.y = view.clientHeight / 2 - sy * T.k; applyT(false);
}
mini.addEventListener('pointerdown', (e) => { e.stopPropagation(); mini.setPointerCapture(e.pointerId); miniJump(e); });
mini.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure) miniJump(e); });
// keep the main pan handler from grabbing minimap gestures
mini.addEventListener('pointerup', (e) => e.stopPropagation());
const panelW = () => (!$('#panel').hidden && innerWidth > 700 ? 340 : 0);
function fit() {
  if (!cur) return;
  const vw = view.clientWidth - panelW(), vh = view.clientHeight;
  T.k = Math.max(0.55, Math.min(1, vw / cur.w, vh / cur.h));
  const rc = cur.byPerson.get(state.root);
  T.x = panelW() + (cur.w * T.k <= vw ? (vw - cur.w * T.k) / 2 : vw / 2 - (rc.x + CARD_W / 2) * T.k);
  T.y = cur.h * T.k <= vh ? (vh - cur.h * T.k) / 2 : 10;
  applyT(true);
}
function centerOn(c) {
  const vw = view.clientWidth - panelW(), vh = view.clientHeight;
  T.x = panelW() + vw / 2 - (c.x + CARD_W / 2) * T.k; T.y = vh / 2 - (c.y + CARD_H / 2) * T.k; applyT(true);
}
function zoomAt(f, cx, cy) {
  const k = Math.min(2.5, Math.max(0.2, T.k * f)), r = k / T.k;
  T.x = cx - (cx - T.x) * r; T.y = cy - (cy - T.y) * r; T.k = k; applyT(false);
}
const ptrs = new Map(); let moved = false, pinchD = 0;
view.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#zoom, #empty button')) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; view.classList.add('grabbing');
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  if (ptrs.size === 2) {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD) { const r = view.getBoundingClientRect(); zoomAt(d / pinchD, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); }
    pinchD = d; moved = true; return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (!moved && Math.hypot(dx, dy) < 6) return;
  moved = true; p.x = e.clientX; p.y = e.clientY; T.x += dx; T.y += dy; applyT(false);
});
const endPtr = (e) => { ptrs.delete(e.pointerId); pinchD = 0; if (!ptrs.size) view.classList.remove('grabbing'); };
addEventListener('pointerup', endPtr); addEventListener('pointercancel', endPtr);
view.addEventListener('wheel', (e) => {
  e.preventDefault(); const r = view.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
const zc = (f) => zoomAt(f, view.clientWidth / 2, view.clientHeight / 2);
$('#zIn').onclick = () => zc(1.25); $('#zOut').onclick = () => zc(0.8); $('#zFit').onclick = fit;

// card interactions -------------------------------------------
cardsBox.addEventListener('click', (e) => {
  if (moved) return;
  const el = e.target.closest('.card'); if (!el) return;
  const id = el.dataset.id, act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'tog') {
    const c = cur.byPerson.get(id); state.coll.set(id, !c.tog.collapsed); render(); return;
  }
  if (state.cmp) { togglePick(id); return; }
  if (act === 'up') { goUp(id); return; }
  if (el.classList.contains('ghost')) { locate(id); return; }
  select(id);
});
function select(id) {
  state.selected = id;
  if (id) history.replaceState(null, '', '#' + id); else history.replaceState(null, '', location.pathname);
  render();
}
function pulse(id) {
  const c = cur?.byPerson.get(id); if (!c) return;
  const el = cardEls.get(c.key); if (!el) return;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
}
function locate(id) {
  const p = get(id); if (!p) return;
  state.selected = id; history.replaceState(null, '', '#' + id);
  if (!cur?.byPerson.has(id)) {
    state.root = rootFor(p).id; state.coll.clear();
    render();
  }
  if (!cur.byPerson.has(id)) {                       // hidden under collapsed branches → open the path
    const seen = new Set(), q = [p];
    while (q.length) { const x = q.pop(); if (seen.has(x.id)) continue; seen.add(x.id); state.coll.set(x.id, false); x.parents.forEach((i) => q.push(get(i))); }
    state.coll.set(id, state.coll.get(id) ?? true);
    render();
  } else render();
  const c = cur.byPerson.get(id);
  if (c) { setTimeout(() => { centerOn(c); pulse(id); }, 60); }
}
function goUp(id) {
  const par = parentPick(get(id)); if (!par) return;
  state.root = par.id; state.coll.clear(); state.selected = id; render();
  const c = cur.byPerson.get(id); if (c) centerOn(c); else fit();
}
$('#btnUp').onclick = () => { const r = get(state.root); const par = r && parentPick(r); if (par) { state.root = par.id; state.coll.clear(); render({ fit: true }); } };
function setRoot(id) { state.root = id; state.coll.clear(); render({ fit: true }); }

// search --------------------------------------------------------
const sIn = $('#search'), sOut = $('#results'); let sSel = 0, sList = [];
function doSearch() {
  const q = norm(sIn.value); if (!q) { sOut.hidden = true; return; }
  sList = data.people.filter((p) => norm(p.name + ' ' + (p.nick || '')).includes(q)).slice(0, 8); sSel = 0;
  sOut.innerHTML = sList.length ? sList.map((p, i) => `<li data-id="${p.id}" class="${i ? '' : 'on'}"><div class="av" style="width:34px;height:34px;font-size:15px;border-width:2px;--g:var(--${p.gender === 'f' ? 'f' : 'm'})">${photoSrc(p) ? `<img src="${esc(photoSrc(p))}">` : esc([...p.name][0])}</div><div>${esc(p.name)}<small>${esc(lineage(p) || lifeText(p))}</small></div></li>`).join('') : '<li>مفيش نتايج</li>';
  sOut.hidden = false;
}
sIn.addEventListener('input', doSearch);
sIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && sList[sSel]) pickSearch(sList[sSel].id);
  if (e.key === 'Escape') { sOut.hidden = true; sIn.blur(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    sSel = (sSel + (e.key === 'ArrowDown' ? 1 : -1) + sList.length) % (sList.length || 1);
    [...sOut.children].forEach((li, i) => li.classList.toggle('on', i === sSel)); e.preventDefault();
  }
});
sOut.addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) pickSearch(li.dataset.id); });
function pickSearch(id) { sOut.hidden = true; sIn.value = ''; locate(id); }
document.addEventListener('click', (e) => { if (!e.target.closest('#searchwrap')) sOut.hidden = true; });

// ───────────────────────── detail panel ─────────────────────────
const panel = $('#panel');
const chip = (p, extra = '') => `<span class="chip" data-go="${p.id}"><span class="av" style="--g:var(--${p.gender === 'f' ? 'f' : 'm'})">${photoSrc(p) ? `<img src="${esc(photoSrc(p))}">` : esc([...p.name][0])}</span>${esc(p.name)}${extra}</span>`;
function renderPanel() {
  const p = state.selected && get(state.selected);
  if (!p || state.cmp) { panel.hidden = true; return; }
  if ([...panel.querySelectorAll('audio,video')].some((m) => !m.paused && !m.ended)) return;   // don't interrupt playback
  const wasHidden = panel.hidden; panel.hidden = false;
  if (wasHidden) panel.style.animation = 'none', void panel.offsetWidth, panel.style.animation = '';
  const par = p.parents.map(get), sp = p.spouses.map(get), ch = kids.get(p.id) || [], sib = siblings(p), ed = state.edit;
  const sec = (title, list, kind) => list.length ? `<h3>${title}</h3><div class="chips">${list.map((x) => chip(x, ed && kind ? `<i data-unlink="${kind}:${x.id}" title="فصل العلاقة">×</i>` : '')).join('')}</div>` : '';
  const life = lifeText(p, true), age = ageText(p);
  panel.innerHTML = `
    <button class="x" data-act="close">✕</button>
    <div class="hero">
      <div class="av" style="--g:var(--${p.gender === 'f' ? 'f' : 'm'})">${photoSrc(p) ? `<img src="${esc(photoSrc(p))}">` : esc([...p.name][0])}</div>
      <h2>${esc(p.name)}${p.death ? ' <small class="sub">(رحمه الله)</small>' : ''}</h2>
      ${p.nick ? `<div class="sub">${esc(p.nick)}</div>` : ''}
      <div class="sub">${esc(lineage(p))}</div>
      ${state.me && state.me !== p.id && shortRel(get(state.me), p) ? `<div class="sub" style="color:var(--accent);font-weight:600">بالنسبة لك: ${esc(shortRel(get(state.me), p))}</div>` : ''}
      ${life ? `<div class="sub">${esc(life)}${age ? ` · ${esc(age)}` : ''}</div>` : ''}
    </div>
    ${p.phone ? `<div class="kv">📞 <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></div>` : ''}
    ${p.note ? `<div class="kv">${esc(p.note).replace(/\n/g, '<br>')}</div>` : ''}
    ${(p.details || []).length ? `<h3>تفاصيل</h3>${p.details.map((d) => `<div class="kv"><b>${esc(d.k)}:</b> ${esc(d.v)}</div>`).join('')}` : ''}
    ${(p.media || []).length ? `<h3>تسجيلات وفيديو</h3>${p.media.map((m, i) => mediaHTML(m, i, ed)).join('')}` : ''}
    ${(p.gallery || []).length ? `<h3>الصور</h3><div class="gal">${p.gallery.map((g, i) => (src(g) ? `<img src="${esc(src(g))}" data-gal="${i}" alt="">` : '<div class="gph">…</div>')).join('')}</div>` : ''}
    ${sec('الوالدين', par, 'parent')}${sec(p.gender === 'f' ? 'الزوج' : 'الزوجة / الزوج', sp, 'spouse')}${sec('الأبناء', ch, 'child')}${sec('الإخوة', sib)}
    <div class="btnrow">
      ${ch.length || sp.length ? '<button data-act="root">🌳 اعرض شجرته</button>' : ''}
      ${p.parents.length ? '<button data-act="up">⇡ عيلته الأصلية</button>' : ''}
      <button data-act="cmp">⚖ صلة القرابة</button>
      ${state.me === p.id ? '' : '<button data-act="me">👤 ده أنا</button>'}
    </div>
    ${ed ? `<h3>إضافة</h3><div class="btnrow">
      <button data-add="child">+ ابن / بنت</button><button data-add="spouse">+ زوج / زوجة</button>
      <button data-add="parent" ${p.parents.length >= 2 ? 'disabled' : ''}>+ أب / أم</button>
      <button data-add="sibling" ${p.parents.length ? '' : 'disabled title="أضف الأب أو الأم الأول"'}>+ أخ / أخت</button></div>
      <div class="btnrow"><button data-act="media">🎙 صوت / 🎬 فيديو</button></div>
      <div class="btnrow"><button data-act="edit">✎ تعديل البيانات</button><button class="danger" data-act="del">حذف</button></div>` : ''}`;
}
panel.addEventListener('click', (e) => {
  const t = e.target, id = state.selected;
  const un = t.closest('[data-unlink]');
  if (un) { const [k, oid] = un.dataset.unlink.split(':'); unlink(id, oid, k); return; }
  const go = t.closest('[data-go]'); if (go) { locate(go.dataset.go); return; }
  const ml = t.closest('[data-mload]');
  if (ml) { ml.textContent = 'جاري فك التشفير…'; ensureBlob(ml.dataset.mload).then((u) => { if (!u) toast('مقدرتش أفك تشفير الملف'); renderPanel(); }); return; }
  const md = t.closest('[data-mdel]');
  if (md) { if (confirm('تشيل التسجيل/الفيديو ده من الشخص؟')) { get(id).media.splice(+md.dataset.mdel, 1); touch(); } return; }
  const gi = t.closest('[data-gal]'); if (gi) { lightbox(get(id), +gi.dataset.gal); return; }
  const add = t.closest('[data-add]'); if (add) { openForm({ rel: add.dataset.add, anchor: id }); return; }
  const act = t.closest('[data-act]')?.dataset.act;
  if (act === 'close') select(null);
  if (act === 'root') setRoot(id);
  if (act === 'up') goUp(id);
  if (act === 'cmp') { startCompare(id); return; }
  if (act === 'media') { openMedia(id); return; }
  if (act === 'me') { setMe(id); toast('تمام — الصلات اتحسبت من منظورك'); return; }
  if (act === 'edit') openForm({ person: id });
  if (act === 'del') removePerson(id);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#dlg').open && state.selected && document.activeElement !== sIn) select(null); });

function unlink(a, b, kind) {
  const A = get(a), B = get(b);
  if (kind === 'parent') A.parents = A.parents.filter((x) => x !== b);
  if (kind === 'child') B.parents = B.parents.filter((x) => x !== a);
  if (kind === 'spouse') { A.spouses = A.spouses.filter((x) => x !== b); B.spouses = B.spouses.filter((x) => x !== a); }
  touch(); toast('اتفصلت العلاقة');
}
function removePerson(id) {
  const p = get(id); if (!confirm(`تحذف "${p.name}" من الشجرة؟`)) return;
  for (const q of data.people) { q.parents = q.parents.filter((x) => x !== id); q.spouses = q.spouses.filter((x) => x !== id); }
  data.people = data.people.filter((q) => q.id !== id);
  if (state.root === id) { const alt = parentPick(p) || p.spouses.map(get)[0] || (kids.get(id) || [])[0] || data.people[0]; state.root = alt ? alt.id : null; }
  state.selected = null; touch();
}

// ───────────────────────── add / edit form ─────────────────────────
const dlg = $('#dlg');
const REL_TITLE = { child: 'إضافة ابن / بنت', spouse: 'إضافة زوج / زوجة', parent: 'إضافة أب / أم', sibling: 'إضافة أخ / أخت', root: 'إضافة أول شخص' };
function resizeImage(file, size = 360, square = true) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'), ctx = c.getContext('2d');
      if (square) {
        const s = Math.min(img.width, img.height); c.width = c.height = size;
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      } else {
        const k = Math.min(1, size / Math.max(img.width, img.height));
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        ctx.drawImage(img, 0, 0, c.width, c.height);
      }
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', square ? 0.82 : 0.78));
    };
    img.onerror = rej; img.src = url;
  });
}

function openForm({ rel, anchor, person }) {
  const editing = !!person, P = editing ? get(person) : null, A = anchor ? get(anchor) : null;
  if (rel === 'parent' && A.parents.length >= 2) return toast('عنده والدين بالفعل');
  let g = P?.gender || '';
  if (!editing && rel === 'spouse') g = A.gender === 'm' ? 'f' : 'm';
  if (!editing && rel === 'parent') g = A.parents.length ? (get(A.parents[0]).gender === 'm' ? 'f' : 'm') : 'm';
  let photo = P ? photoSrc(P) : '', newPhoto = null, mode = 'new', chosen = null;
  const title = editing ? `تعديل: ${P.name}` : `${REL_TITLE[rel]}${A ? ' — ' + A.name : ''}`;
  const otherSel = rel === 'child' && A.spouses.length ? `<label>الطرف التاني (الأب/الأم)
      <select name="other">${A.spouses.map(get).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}<option value="">غير معروف / غير مسجّل</option></select></label>` : '';
  const canExisting = !editing && rel && rel !== 'root';
  dlg.innerHTML = `<form id="pf">
    <h2>${esc(title)}</h2>
    ${canExisting ? '<div class="tabs"><button type="button" data-mode="new" class="on">شخص جديد</button><button type="button" data-mode="exist">شخص موجود في الشجرة</button></div>' : ''}
    <div id="newBox">
      <div class="photoPick"><div class="av" id="pv" style="--g:var(--${g === 'f' ? 'f' : 'm'})">${photo ? `<img src="${esc(photo)}">` : '📷'}</div>
        <label class="btn" style="margin:0"><button type="button" id="pickPh">اختر صورة</button><input type="file" id="ph" accept="image/*" hidden></label></div>
      <label>الاسم<input name="name" required value="${esc(P?.name)}" autocomplete="off"></label>
      <label>لقب / اسم الشهرة (اختياري)<input name="nick" value="${esc(P?.nick)}"></label>
      <div class="seg">
        <label><input type="radio" name="gender" value="m" required ${g === 'm' ? 'checked' : ''}><span>ذكر</span></label>
        <label><input type="radio" name="gender" value="f" ${g === 'f' ? 'checked' : ''}><span>أنثى</span></label></div>
      <div class="row2"><label>الميلاد (سنة أو تاريخ كامل)<input name="birth" value="${esc(P?.birth)}" placeholder="1985 أو 1985-03-27"></label>
        <label>الوفاة (لو متوفى)<input name="death" value="${esc(P?.death === '?' ? '' : P?.death)}" placeholder="2015 أو 2015-10-02 أو ؟"></label></div>
      <p class="hint" style="margin:4px 0 0">اكتب التاريخ كامل (سنة-شهر-يوم) عشان يظهر في «القادم» (أعياد الميلاد وذكرى الوفاة).</p>
      <label>رقم التليفون<input name="phone" type="tel" value="${esc(P?.phone)}"></label>
      <label>ملاحظات<textarea name="note">${esc(P?.note)}</textarea></label>
      <label>تفاصيل إضافية (الوظيفة، العنوان، تاريخ الجواز…)</label>
      <div id="dRows"></div><button type="button" id="dAdd">+ تفصيلة</button>
      <datalist id="dKeys"><option>الوظيفة<option>العنوان<option>المحافظة<option>التعليم<option>تاريخ الجواز<option>الهواية<option>تاريخ الوفاة<option>مكان الدفن</datalist>
      <label>ألبوم الصور</label>
      <div id="gal" class="gal"></div><button type="button" id="gAdd">+ أضف صور</button><input type="file" id="gIn" accept="image/*" multiple hidden>
      ${otherSel}
    </div>
    <div id="existBox" hidden>
      <label>دوّر على الشخص<input id="exq" autocomplete="off" placeholder="اكتب الاسم…"></label><ul id="exl"></ul>
      ${rel === 'child' ? otherSel.replace('<select', '<select id="otherEx"') : ''}
    </div>
    <div class="dlgActions">
      <button type="button" data-close>إلغاء</button>
      ${editing ? '' : '<button type="button" id="again">حفظ وإضافة غيره</button>'}
      <button type="submit" class="primary">حفظ</button>
    </div></form>`;
  const f = $('#pf', dlg), q = (s) => $(s, dlg);
  f.querySelectorAll('input[name=gender]').forEach((r) => r.addEventListener('change', () => { g = r.value; q('#pv').style.setProperty('--g', `var(--${g === 'f' ? 'f' : 'm'})`); }));
  q('#pickPh').onclick = () => q('#ph').click();
  q('#ph').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { newPhoto = await resizeImage(file); q('#pv').innerHTML = `<img src="${newPhoto}">`; } catch { toast('الصورة دي مش مدعومة'); }
  };
  // extra details + gallery
  const det = (P?.details || []).map((d) => ({ ...d }));
  const gal = (P?.gallery || []).map((path) => ({ path, src: src(path) }));
  const drawDet = () => {
    q('#dRows').innerHTML = det.map((d, i) => `<div class="row2" style="margin-top:6px"><input list="dKeys" data-dk="${i}" value="${esc(d.k)}" placeholder="العنوان"><input data-dv="${i}" value="${esc(d.v)}" placeholder="القيمة"><button type="button" data-dx="${i}" style="flex:none">×</button></div>`).join('');
  };
  const drawGal = () => {
    q('#gal').innerHTML = gal.map((g, i) => `<div class="gi"><img src="${esc(g.src)}" alt=""><button type="button" data-gx="${i}">×</button></div>`).join('');
  };
  drawDet(); drawGal();
  q('#dAdd').onclick = () => { det.push({ k: '', v: '' }); drawDet(); q(`[data-dk="${det.length - 1}"]`).focus(); };
  q('#dRows').oninput = (e) => { const t = e.target; if (t.dataset.dk) det[t.dataset.dk].k = t.value; if (t.dataset.dv) det[t.dataset.dv].v = t.value; };
  q('#dRows').onclick = (e) => { const x = e.target.closest('[data-dx]'); if (x) { det.splice(+x.dataset.dx, 1); drawDet(); } };
  q('#gAdd').onclick = () => q('#gIn').click();
  q('#gIn').onchange = async (e) => {
    for (const file of e.target.files) { try { gal.push({ path: null, src: await resizeImage(file, 1000, false) }); } catch { toast('صورة مش مدعومة'); } }
    e.target.value = ''; drawGal();
  };
  q('#gal').onclick = (e) => { const x = e.target.closest('[data-gx]'); if (x) { gal.splice(+x.dataset.gx, 1); drawGal(); } };
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => {
    mode = b.dataset.mode; dlg.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    q('#newBox').hidden = mode !== 'new'; q('#existBox').hidden = mode !== 'exist';
    f.querySelector('[name=name]').required = mode === 'new'; f.querySelector('[name=gender]').required = mode === 'new';
    if (mode === 'exist') q('#exq').focus();
  }));
  if (canExisting) {
    const list = q('#exl'), draw = () => {
      const s = norm(q('#exq').value);
      const res = data.people.filter((x) => x.id !== anchor && (!s || norm(x.name).includes(s))).slice(0, 30);
      list.innerHTML = res.map((x) => `<li data-id="${x.id}" class="${x.id === chosen ? 'on' : ''}">${esc(x.name)} <small class="hint">${esc(lineage(x) || lifeText(x))}</small></li>`).join('');
    };
    q('#exq').oninput = draw; draw();
    list.onclick = (e) => { const li = e.target.closest('li'); if (li) { chosen = li.dataset.id; draw(); } };
  }

  const submit = (again) => {
    if (mode === 'exist') {
      if (!chosen) return toast('اختار شخص من القايمة');
      const other = (q('#otherEx') || {}).value;
      linkRel(rel, A, get(chosen), other);
      finish(chosen, again); return;
    }
    if (!f.reportValidity()) return;
    const fd = new FormData(f);
    const v = (k) => (fd.get(k) || '').toString().trim();
    const obj = editing ? P : { id: uid(), parents: [], spouses: [] };
    Object.assign(obj, { name: v('name'), nick: v('nick'), gender: v('gender'), birth: v('birth'), death: v('death'), phone: v('phone'), note: v('note') });
    if (editing && !v('death') && P.death === '?') obj.death = '?';
    obj.details = det.map((d) => ({ k: d.k.trim(), v: d.v.trim() })).filter((d) => d.k && d.v);
    obj.gallery = gal.map((g, i) => {
      if (g.path) return g.path;
      const path = `photos/${obj.id}-g${Date.now().toString(36)}${i}.jpg`;
      state.photos[path] = g.src; state.newPhotos.add(path); return path;
    });
    if (newPhoto) {
      const path = `photos/${obj.id}-${Date.now().toString(36)}.jpg`;
      obj.photo = path; state.photos[path] = newPhoto; state.newPhotos.add(path);
    }
    if (!editing) {
      data.people.push(obj);
      if (rel === 'sibling') obj.parents = A.parents.slice();
      else if (rel) linkRel(rel, A, obj, fd.get('other'));
      if (rel === 'root' || !state.root) state.root = obj.id;
    }
    finish(obj.id, again);
  };
  const finish = (id, again) => {
    if (A) state.coll.set(A.id, false);
    dlg.close(); touch(); locate(id);
    if (again && rel) setTimeout(() => openForm({ rel, anchor }), 350);
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(false); };
  const ag = q('#again'); if (ag) ag.onclick = () => submit(true);
  dlg.showModal();
  if (!editing) setTimeout(() => f.querySelector('[name=name]')?.focus(), 50);
}
function linkRel(rel, A, X, other) {
  if (rel === 'child') { X.parents = [A.id, other].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2); }
  if (rel === 'spouse') { if (!A.spouses.includes(X.id)) A.spouses.push(X.id); if (!X.spouses.includes(A.id)) X.spouses.push(A.id); }
  if (rel === 'parent') { if (!A.parents.includes(X.id) && A.parents.length < 2) A.parents.push(X.id); }
  if (rel === 'sibling') { X.parents = A.parents.slice(); }
}
function lightbox(p, i) {
  const n = p.gallery.length;
  const show = () => {
    dlg.innerHTML = `<div class="lb"><img src="${esc(src(p.gallery[i]))}" alt=""><div class="dlgActions" style="justify-content:space-between;align-items:center">
      <button data-n="-1" ${n < 2 ? 'disabled' : ''}>السابقة</button><span class="hint">${i + 1} / ${n} — ${esc(p.name)}</span><button data-n="1" ${n < 2 ? 'disabled' : ''}>التالية</button><button data-close>إغلاق</button></div></div>`;
    dlg.querySelector('[data-close]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { i = (i + +b.dataset.n + n) % n; show(); }));
  };
  show(); if (!dlg.open) dlg.showModal();
}

// ───────────────────────── صوت وفيديو ─────────────────────────
const MAX_VIDEO = 25 * 1024 * 1024, MAX_AUDIO = 12 * 1024 * 1024;
const msrc = (s) => state.mblob.get(s)?.url || (vault.on ? blobUrls.get(s) || '' : s);
const ytId = (u) => (u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) || [])[1];
function mediaHTML(m, i, ed) {
  const del = ed ? `<button class="mx" data-mdel="${i}" title="شيل">×</button>` : '';
  const title = esc(m.title || (m.t === 'audio' ? 'تسجيل صوتي' : 'فيديو'));
  let body;
  if (m.t !== 'link' && !msrc(m.src)) body = `<button class="mload" data-mload="${esc(m.src)}">▶ ${m.t === 'audio' ? 'شغّل الصوت' : 'شغّل الفيديو'} (فك التشفير)</button>`;
  else if (m.t === 'audio') body = `<audio controls preload="none" src="${esc(msrc(m.src))}"></audio>`;
  else if (m.t === 'link') {
    const y = ytId(m.src);
    body = y ? `<iframe src="https://www.youtube-nocookie.com/embed/${y}" allowfullscreen loading="lazy"></iframe>` : `<a href="${esc(m.src)}" target="_blank" rel="noopener">${esc(m.src)}</a>`;
  } else body = `<video controls preload="metadata" playsinline src="${esc(msrc(m.src))}"></video>`;
  return `<div class="mi"><div class="mt">${m.t === 'audio' ? '🎙' : '🎬'} ${title}${del}</div>${body}</div>`;
}
function addMedia(id, item, blob, ext) {
  const p = get(id); p.media = p.media || [];
  if (blob) {
    const path = `media/${id}-${Date.now().toString(36)}.${ext}`;
    state.mblob.set(path, { blob, url: URL.createObjectURL(blob) }); state.newMedia.add(path); item.src = path;
  }
  p.media.push(item); touch();
}
function openMedia(id) {
  const p = get(id); let rec = null, stream = null, chunks = [], timer = 0, recBlob = null, recExt = 'webm', secs = 0, added = 0;
  dlg.innerHTML = `<form id="mf"><h2>صوت وفيديو — ${esc(p.name)}</h2>
    <div class="mbox"><b>🎙 تسجيل صوتي</b>
      <div class="btnrow"><button type="button" id="recBtn" class="primary">● ابدأ التسجيل</button><span id="recT" class="hint" style="align-self:center"></span></div>
      <audio id="recPrev" controls hidden></audio></div>
    <label>عنوان (اختياري)<input id="mTitle" placeholder="مثال: بيحكي عن أيام زمان"></label>
    <div class="btnrow"><button type="button" id="addRec" disabled>أضف التسجيل للشخص</button></div>
    <div class="mbox"><b>أو ارفع حاجة جاهزة</b><div class="btnrow">
      <button type="button" id="upA">ملف صوت</button><button type="button" id="upV">🎬 ملف فيديو</button><button type="button" id="lnk">🔗 رابط فيديو</button></div>
      <input type="file" id="fA" accept="audio/*" hidden><input type="file" id="fV" accept="video/*" hidden></div>
    <p class="hint">الفيديو لحد 25MB والصوت لحد 12MB (حدود GitHub). لفيديو أكبر ارفعه على يوتيوب (Unlisted) وحط الرابط. التسجيل بيحتاج إذن الميكروفون.</p>
    <p class="hint" id="mStat"></p>
    <div class="dlgActions"><button type="button" data-close class="primary">تم</button></div></form>`;
  const q = (s) => $(s, dlg), title = () => q('#mTitle').value.trim();
  const stat = () => (q('#mStat').textContent = added ? `اتضاف ${added} — متنساش تدوس «حفظ» فوق لما تخلص` : '');
  const cleanup = () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); if (rec && rec.state !== 'inactive') rec.stop(); };
  dlg.addEventListener('close', cleanup, { once: true });
  q('[data-close]').onclick = () => dlg.close();
  q('#recBtn').onclick = async () => {
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('مقدرتش أوصل للميكروفون — اسمح بالإذن من المتصفح'); }
    const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    recExt = mt.includes('mp4') ? 'm4a' : mt.includes('ogg') ? 'ogg' : 'webm';
    rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined); chunks = []; secs = 0;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer); stream.getTracks().forEach((t) => t.stop());
      recBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const a = q('#recPrev'); a.src = URL.createObjectURL(recBlob); a.hidden = false;
      q('#recBtn').textContent = '● تسجيل من جديد'; q('#addRec').disabled = false;
    };
    rec.start(); q('#recBtn').textContent = '■ إيقاف'; q('#addRec').disabled = true; q('#recPrev').hidden = true;
    timer = setInterval(() => { secs++; q('#recT').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; if (secs >= 600) rec.stop(); }, 1000);
  };
  q('#addRec').onclick = () => {
    if (!recBlob) return;
    if (recBlob.size > MAX_AUDIO) return toast('التسجيل كبير — اعمله أقصر من كده');
    addMedia(id, { t: 'audio', title: title() }, recBlob, recExt);
    recBlob = null; q('#recPrev').hidden = true; q('#addRec').disabled = true; q('#recT').textContent = ''; q('#mTitle').value = ''; added++; stat();
  };
  const upload = (input, kind, max) => {
    input.onchange = () => {
      const f = input.files[0]; input.value = ''; if (!f) return;
      if (f.size > max) return toast(`الملف أكبر من ${Math.round(max / 1048576)}MB`);
      addMedia(id, { t: kind, title: title() || f.name.replace(/\.[^.]+$/, '') }, f, (f.name.match(/\.(\w{2,4})$/) || [, kind === 'audio' ? 'webm' : 'mp4'])[1].toLowerCase());
      q('#mTitle').value = ''; added++; stat();
    };
  };
  upload(q('#fA'), 'audio', MAX_AUDIO); upload(q('#fV'), 'video', MAX_VIDEO);
  q('#upA').onclick = () => q('#fA').click(); q('#upV').onclick = () => q('#fV').click();
  q('#lnk').onclick = () => {
    const u = (prompt('الصق رابط الفيديو (يوتيوب أو غيره):') || '').trim();
    if (!/^https?:\/\//i.test(u)) { if (u) toast('الرابط لازم يبدأ بـ https://'); return; }
    addMedia(id, { t: 'link', title: title() || 'فيديو', src: u }); q('#mTitle').value = ''; added++; stat();
  };
  dlg.showModal();
}

// ───────────────────────── تصدير وطباعة ─────────────────────────
// Draws the tree on a canvas (light palette, always) so the image/print looks the same on every device.
function loadImg(src) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function wrapName(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].replace(/\s*\S*$/, '…') || lines[1]; }
  return lines;
}
async function renderTreeCanvas(openAll) {
  forceOpen = openAll; let L; try { L = layout(state.root); } finally { forceOpen = false; }
  const C = { bg: '#f5efe4', surface: '#fffdf8', ink: '#2b2723', muted: '#8b8176', line: '#bfb29c', m: '#3d8b86', f: '#c75d78', accent: '#2e6f5d' };
  const TOP = 90, BOT = 40, W = L.w, H = L.h + TOP + BOT;
  const sc = Math.min(2, 12000 / Math.max(W, H));
  const cv = document.createElement('canvas'); cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
  const x = cv.getContext('2d'); x.scale(sc, sc); x.direction = 'rtl'; x.textAlign = 'center';
  const FONT = (w, s) => `${w} ${s}px Cairo, "Segoe UI", Tahoma, sans-serif`;
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  x.fillStyle = C.ink; x.font = FONT(700, 30); x.fillText(data.meta.title || 'شجرة العيلة', W / 2, 52);
  x.translate(0, TOP);
  x.strokeStyle = C.line; x.lineWidth = 2.2; x.lineJoin = 'round'; x.lineCap = 'round';
  for (const pl of L.lines) { x.beginPath(); pl.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke(); }
  const imgs = new Map();
  await Promise.all(L.cards.filter((c) => photoSrc(c.p)).map(async (c) => imgs.set(c.p.id, await loadImg(photoSrc(c.p)))));
  const me = state.me && byId.has(state.me) ? get(state.me) : null;
  for (const c of L.cards) {
    const p = c.p, g = p.gender === 'f' ? C.f : C.m, cx = c.x + CARD_W / 2;
    x.save(); x.globalAlpha = c.ghost ? 0.55 : 1;
    x.beginPath(); x.roundRect(c.x, c.y, CARD_W, CARD_H, 18);
    x.shadowColor = 'rgba(60,40,10,.18)'; x.shadowBlur = c.ghost ? 0 : 14; x.shadowOffsetY = 4;
    x.fillStyle = c.ghost ? C.bg : C.surface; x.fill(); x.shadowColor = 'transparent';
    if (c.ghost) { x.setLineDash([6, 5]); x.strokeStyle = C.line; x.lineWidth = 2; x.stroke(); x.setLineDash([]); }
    else { x.save(); x.clip(); x.fillStyle = g; x.fillRect(c.x, c.y, CARD_W, 4); x.restore(); }
    const ay = c.y + 12 + 35;
    x.beginPath(); x.arc(cx, ay, 35, 0, 7);
    x.fillStyle = g + '33'; x.fill();
    const im = imgs.get(p.id);
    if (im) {
      x.save(); x.beginPath(); x.arc(cx, ay, 35, 0, 7); x.clip();
      const s = Math.min(im.width, im.height); x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, cx - 35, ay - 35, 70, 70); x.restore();
    } else { x.fillStyle = g; x.font = FONT(700, 28); x.textBaseline = 'middle'; x.fillText([...p.name][0] || '؟', cx, ay + 2); x.textBaseline = 'alphabetic'; }
    x.beginPath(); x.arc(cx, ay, 35, 0, 7); x.strokeStyle = g; x.lineWidth = 3; x.stroke();
    x.fillStyle = C.ink; x.font = FONT(700, 14.5);
    wrapName(x, p.name, CARD_W - 18).forEach((ln, i) => x.fillText(ln, cx, c.y + 12 + 70 + 22 + i * 19.5));
    x.fillStyle = C.muted; x.font = FONT(400, 12);
    x.fillText(c.ghost ? 'مذكور في فرع تاني' : lifeText(p), cx, c.y + 12 + 70 + 22 + 39 + 14);
    const rel = me && !c.ghost ? shortRel(me, p) : '';
    if (rel) {
      x.font = FONT(600, 11.5); const w = Math.min(CARD_W - 12, x.measureText(rel).width + 20), ry = c.y + CARD_H - 34;
      x.beginPath(); x.roundRect(cx - w / 2, ry, w, 20, 10); x.fillStyle = p.id === me.id ? C.accent : '#dbe8e2'; x.fill();
      x.fillStyle = p.id === me.id ? '#fff' : C.accent; x.fillText(rel, cx, ry + 14.5);
    }
    x.restore();
  }
  x.setTransform(sc, 0, 0, sc, 0, 0); x.fillStyle = C.muted; x.font = FONT(400, 13);
  x.fillText(`${data.meta.title || 'شجرة العيلة'} · ${new Date().toLocaleDateString('ar-EG')}`, W / 2, H - 14);
  return cv;
}
function openExport() {
  dlg.innerHTML = `<form><h2>🖨 تصدير الشجرة</h2>
    <p class="hint">بيتصدّر الفرع المعروض حاليًا (من ${esc(get(state.root).name)}). غيّر الجذر بـ «اعرض شجرته» لو عايز فرع تاني.</p>
    <label class="chk"><input type="checkbox" id="exOpen" checked> افتح كل الفروع المطوية في التصدير</label>
    <div class="dlgActions"><button type="button" id="exPng">🖼 تنزيل صورة PNG</button><button type="button" id="exPrint" class="primary">🖨 طباعة / PDF</button><button type="button" data-close>إغلاق</button></div>
    <p class="hint" id="exStat"></p></form>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  const run = async (fn) => {
    const st = $('#exStat', dlg); st.textContent = 'جاري التجهيز…';
    try { await document.fonts?.ready; await fn(await renderTreeCanvas($('#exOpen', dlg).checked)); st.textContent = ''; }
    catch (e) { st.textContent = 'فشل التصدير: ' + e.message; }
  };
  $('#exPng', dlg).onclick = () => run((cv) => new Promise((res) => cv.toBlob((b) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'family-tree.png'; a.click(); res();
  })));
  $('#exPrint', dlg).onclick = () => run((cv) => new Promise((res) => {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0';
    const land = cv.width >= cv.height;
    f.srcdoc = `<!doctype html><meta charset="utf-8"><style>@page{size:A4 ${land ? 'landscape' : 'portrait'};margin:8mm}html,body{margin:0}img{width:100%;height:auto;display:block;max-height:100vh;object-fit:contain}</style><img src="${cv.toDataURL('image/png')}">`;
    f.onload = () => setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); res(); }, 300);
    document.body.appendChild(f);
  }));
  dlg.showModal();
}
$('#zPrint').onclick = openExport;

// ───────────────────────── أعياد الميلاد والذكرى ─────────────────────────
function parseDate(s) {
  s = (s || '').trim(); let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/), r;
  if (m) r = { y: +m[1], m: +m[2], d: +m[3] };
  else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) r = { y: +m[3], m: +m[2], d: +m[1] };
  return r && r.m >= 1 && r.m <= 12 && r.d >= 1 && r.d <= 31 ? r : null;
}
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function events() {
  const today = new Date(); today.setHours(0, 0, 0, 0); const out = [];
  for (const p of data.people) {
    for (const [kind, raw] of [['birth', p.death ? '' : p.birth], ['death', p.death !== '?' ? p.death : '']]) {
      const d = parseDate(raw); if (!d) continue;
      let next = new Date(today.getFullYear(), d.m - 1, d.d);
      if (next < today) next = new Date(today.getFullYear() + 1, d.m - 1, d.d);
      out.push({ p, kind, d, next, days: Math.round((next - today) / 864e5), n: next.getFullYear() - d.y });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
const whenText = (days) => (days === 0 ? 'النهاردة' : days === 1 ? 'بكرة' : days === 2 ? 'بعد يومين' : days <= 10 ? `بعد ${days} أيام` : `بعد ${days} يوم`);
function updateBday() {
  const n = events().filter((e) => e.days <= 7).length;
  $('#btnBday').textContent = n ? `🎂 ${n}` : '🎂';
}
function openBday() {
  const ev = events(), soon = ev.filter((e) => e.days <= 90).slice(0, 40);
  const row = (e) => `<li data-go="${e.p.id}" class="bd${e.days <= 7 ? ' soon' : ''}"><span class="bi">${e.kind === 'birth' ? '🎂' : '🕊'}</span>
    <div><b>${esc(e.p.name)}</b><div class="hint">${e.kind === 'birth' ? `عيد ميلاد ${e.n} (${e.d.d} ${MONTHS[e.d.m - 1]})` : `ذكرى وفاة ${e.n} سنة (${e.d.d} ${MONTHS[e.d.m - 1]})`}</div></div>
    <span class="when">${whenText(e.days)}</span></li>`;
  dlg.innerHTML = `<form><h2>🎂 القادم في العيلة</h2>
    ${soon.length ? `<ul class="bdl">${soon.map(row).join('')}</ul>` : `<p class="hint">مفيش مناسبات في الـ 90 يوم الجايين. ${ev.length ? '' : 'اكتب تاريخ الميلاد كامل (مثلاً 1985-03-27) من تعديل بيانات الشخص عشان يظهر هنا.'}</p>`}
    <div class="dlgActions"><button type="button" id="ics" ${ev.length ? '' : 'disabled'}>📅 تنزيل التقويم (ICS)</button><button type="button" data-close class="primary">إغلاق</button></div>
    <p class="hint">ملف الـ ICS بيتفتح في تقويم الموبايل أو جوجل، وبيكرر كل المناسبات كل سنة مع تنبيه قبلها بيوم.</p></form>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('.bdl', dlg)?.addEventListener('click', (e) => { const li = e.target.closest('[data-go]'); if (li) { dlg.close(); locate(li.dataset.go); } });
  $('#ics', dlg).onclick = exportICS;
  dlg.showModal();
}
function exportICS() {
  const pad = (n) => String(n).padStart(2, '0'), stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//family-tree//AR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${data.meta.title || 'شجرة العيلة'}`];
  for (const e of events()) {
    const ds = `${e.next.getFullYear()}${pad(e.next.getMonth() + 1)}${pad(e.next.getDate())}`;
    L.push('BEGIN:VEVENT', `UID:${e.p.id}-${e.kind}@family-tree`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ds}`,
      `SUMMARY:${e.kind === 'birth' ? '🎂 عيد ميلاد' : '🕊 ذكرى وفاة'} ${e.p.name}`, 'RRULE:FREQ=YEARLY',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:تذكير', 'TRIGGER:-P1D', 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([L.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
  a.download = 'family-events.ics'; a.click();
}
$('#btnBday').onclick = openBday;

// ───────────────────────── صلة القرابة ─────────────────────────
const G = (b, m, f) => (b.gender === 'f' ? f : m);
const H = (x) => (x.gender === 'f' ? 'هي' : 'هو');
const ORD = ['', 'الأولى', 'التانية', 'التالتة', 'الرابعة', 'الخامسة', 'السادسة'];
function ancMap(p) {                       // id → path [p … ancestor] (shortest)
  if (ancCache.has(p.id)) return ancCache.get(p.id);
  const m = new Map([[p.id, [p]]]); ancCache.set(p.id, m); let fr = [p];
  while (fr.length) {
    const next = [];
    for (const x of fr) for (const pid of x.parents) if (!m.has(pid)) { const y = get(pid); m.set(pid, [...m.get(x.id), y]); next.push(y); }
    fr = next;
  }
  return m;
}
// "b هو <noun> a" عن طريق الدم
function bloodRel(a, b) {
  if (a.id === b.id) return null;
  const A = ancMap(a), B = ancMap(b); let best = null, all = [];
  for (const [id, pa] of A) {
    const pb = B.get(id); if (!pb) continue;
    const s = pa.length + pb.length;
    if (!best || s < best.s) { best = { s, pa, pb }; all = [get(id)]; } else if (s === best.s) all.push(get(id));
  }
  if (!best) return null;
  const { pa, pb } = best, da = pa.length - 1, db = pb.length - 1;
  let n;
  if (da === 0) n = db === 1 ? G(b, 'ابن', 'بنت') : db === 2 ? G(b, 'حفيد', 'حفيدة') : db === 3 ? `${G(b, 'ابن', 'بنت')} حفيد` : `${G(b, 'حفيد', 'حفيدة')} (الجيل ${db})`;
  else if (db === 0) n = da === 1 ? G(b, 'أب', 'أم') : da === 2 ? G(b, 'جد', 'جدة') : da === 3 ? G(b, 'أبو الجد', 'أم الجدة') : `${G(b, 'جد', 'جدة')} أعلى (${da} أجيال فوق)`;
  else if (da === 1 && db === 1) {
    n = all.length > 1 ? G(b, 'أخ شقيق', 'أخت شقيقة') : `${G(b, 'أخ', 'أخت')} ${all[0].gender === 'f' ? 'لأم' : 'لأب'}`;
  } else if (da === 1) {
    const sib = pb[db - 1].gender === 'f' ? 'أخت' : 'أخ';
    n = db === 2 ? `${G(b, 'ابن', 'بنت')} ${sib}` : db === 3 ? `${G(b, 'حفيد', 'حفيدة')} ${sib}` : `${G(b, 'حفيد', 'حفيدة')} ${sib} (الجيل ${db - 1} بعده)`;
  } else if (db === 1) {
    const mid = pa[da - 1];
    n = da === 2 ? G(b, mid.gender === 'm' ? 'عم' : 'خال', mid.gender === 'm' ? 'عمة' : 'خالة')
      : da === 3 ? `${G(b, 'أخو', 'أخت')} ${mid.gender === 'm' ? 'الجد' : 'الجدة'}`
        : `${G(b, 'أخو', 'أخت')} ${mid.gender === 'm' ? 'جد' : 'جدة'} أعلى (${da - 1} أجيال فوق)`;
  } else if (da === 2 && db === 2) {
    const ap = pa[1], bp = pb[1];
    const w = ap.gender === 'm' ? (bp.gender === 'm' ? 'عم' : 'عمة') : (bp.gender === 'm' ? 'خال' : 'خالة');
    n = `${G(b, 'ابن', 'بنت')} ${w}`;
  } else if (db > da && bloodRel(a, pb[1])) {          // b من نسل قريب لـ a
    n = `${G(b, 'ابن', 'بنت')} ${bloodRel(a, pb[1]).noun}`;
  } else if (da > db && bloodRel(pa[1], b)) {          // b قريب لأب/أم a
    n = `${bloodRel(pa[1], b).noun} ${pa[1].gender === 'm' ? 'الأب' : 'الأم'}`;
  } else {
    const k = Math.min(da, db) - 1;
    n = `${G(b, 'قريب', 'قريبة')} من الدرجة ${ORD[k] || k}${da !== db ? ` بفارق ${Math.abs(da - db)} جيل` : ''}`;
  }
  return { noun: n, common: da > 0 && db > 0 ? all : [] };
}
// تسمية قصيرة: b إيه بالنسبة لـ a (للكروت)
function shortRel(a, b) {
  if (a.id === b.id) return 'أنا';
  const br = bloodRel(a, b); if (br) return br.noun;
  if (a.spouses.includes(b.id)) return G(b, 'زوج', 'زوجة');
  for (const s of a.spouses.map(get)) { const r = bloodRel(s, b); if (r) return `${r.noun} ${G(s, 'الزوج', 'الزوجة')}`; }
  for (const sb of b.spouses.map(get)) { const r = bloodRel(a, sb); if (r) return `${G(b, 'زوج', 'زوجة')} ${r.noun}`; }
  return '';
}
function setMe(id) {
  state.me = id || null; store.set('ft-me', state.me);
  $('#btnMe').textContent = state.me ? `👤 ${get(state.me).name.split(' ')[0]}` : '👤 أنا مين؟';
  render(); if (id) locate(id);
}
function openMe() {
  dlg.innerHTML = `<form><h2>👤 أنت مين في العيلة؟</h2><p class="hint">اختار اسمك وهيظهر على كل كارت صلته بيك (خالك، ابن عمتك…). بيتحفظ على جهازك بس.</p>
    <input id="meq" placeholder="اكتب اسمك…" autocomplete="off"><ul id="exl"></ul>
    <div class="dlgActions">${state.me ? '<button type="button" id="meClear">مسح اختياري</button>' : ''}<button type="button" data-close>إغلاق</button></div></form>`;
  const list = $('#exl', dlg), draw = () => {
    const s = norm($('#meq', dlg).value);
    list.innerHTML = data.people.filter((x) => !s || norm(x.name).includes(s)).slice(0, 40).map((x) => `<li data-id="${x.id}" class="${x.id === state.me ? 'on' : ''}">${esc(x.name)} <small class="hint">${esc(lineage(x) || lifeText(x))}</small></li>`).join('');
  };
  $('#meq', dlg).oninput = draw; draw();
  list.onclick = (e) => { const li = e.target.closest('li'); if (li) { dlg.close(); setMe(li.dataset.id); toast('تمام — الصلات اتحسبت من منظورك'); } };
  $('[data-close]', dlg).onclick = () => dlg.close();
  const c = $('#meClear', dlg); if (c) c.onclick = () => { dlg.close(); setMe(null); };
  dlg.showModal(); $('#meq', dlg).focus();
}
$('#btnMe').onclick = openMe;
function describe(a, b) {                  // كل الصلات اللي تخلي b قريب لـ a
  const out = [], seen = new Set(), add = (s) => { if (!seen.has(s)) { seen.add(s); out.push(s); } };
  const br = bloodRel(a, b);
  if (br) add(`${b.name} ${H(b)} ${br.noun} ${a.name}`);
  if (a.spouses.includes(b.id)) add(`${b.name} ${H(b)} ${G(b, 'زوج', 'زوجة')} ${a.name}`);
  if (out.length) return { lines: out, common: br ? br.common : [] };   // صلة مباشرة؟ ماتزودش صلات المصاهرة
  for (const s of a.spouses.map(get)) {   // قريب لزوج/زوجة a
    const r = s.id !== b.id && bloodRel(s, b);
    if (r) add(`${b.name} ${H(b)} ${r.noun} ${s.name}، و${s.name} ${H(s)} ${G(s, 'زوج', 'زوجة')} ${a.name}`);
  }
  for (const sb of b.spouses.map(get)) {  // b متجوز من قريب لـ a
    const r = sb.id !== a.id && bloodRel(a, sb);
    if (r) add(`${b.name} ${H(b)} ${G(b, 'زوج', 'زوجة')} ${sb.name}، و${sb.name} ${H(sb)} ${r.noun} ${a.name}`);
  }
  return { lines: out, common: br ? br.common : [] };
}
function pairHTML(a, b) {
  const x = describe(a, b), y = describe(b, a);
  const lines = [...x.lines, ...y.lines];
  const common = x.common.length ? `<div class="hint">الجد المشترك: ${x.common.map((c) => esc(c.name)).join(' و')}</div>` : '';
  return `<div class="pair"><div class="pn">${esc(a.name)} ↔ ${esc(b.name)}</div>${lines.length ? lines.map((l) => `<div>${esc(l)}</div>`).join('') : '<div class="hint">مفيش صلة مسجّلة بينهم لسه — ممكن تكون محتاجة تضيف أب/أم أو جواز ناقص.</div>'}${common}</div>`;
}
function startCompare(id) { state.cmp = true; state.picks = id ? [id] : []; render(); }
function togglePick(id) {
  const i = state.picks.indexOf(id);
  if (i >= 0) state.picks.splice(i, 1); else if (state.picks.length < 8) state.picks.push(id); else toast('الحد الأقصى 8 أشخاص');
  render();
}
function renderCmp() {
  const box = $('#cmp'); box.hidden = !state.cmp; $('#btnCmp').classList.toggle('on', state.cmp);
  if (!state.cmp) return;
  const ps = state.picks.map(get).filter(Boolean);
  let html = `<div class="cmpHead"><b>⚖ صلة القرابة</b><button data-x>إنهاء</button></div>`;
  html += ps.length ? `<div class="chips">${ps.map((p, i) => chip(p, `<i data-unpick="${p.id}">×</i>`).replace('class="chip"', `class="chip" title="${i + 1}"`)).join('')}</div>` : '';
  if (ps.length < 2) html += `<p class="hint">اضغط على شخصين أو أكتر في الشجرة عشان تشوف صلة القرابة بينهم.</p>`;
  else for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) html += pairHTML(ps[i], ps[j]);
  box.innerHTML = html;
}
$('#cmp').addEventListener('click', (e) => {
  if (e.target.closest('[data-x]')) { state.cmp = false; state.picks = []; render(); return; }
  const u = e.target.closest('[data-unpick]'); if (u) { e.stopPropagation(); togglePick(u.dataset.unpick); }
});
$('#btnCmp').onclick = () => { if (state.cmp) { state.cmp = false; state.picks = []; render(); } else startCompare(state.selected); };

$('#btnFirst').onclick = () => { state.edit = true; openForm({ rel: 'root' }); };

// ───────────────────────── settings ─────────────────────────
$('#btnEdit').onclick = () => { state.edit = !state.edit; render(); toast(state.edit ? 'وضع التعديل شغّال' : 'وضع العرض'); };
$('#btnSave').onclick = saveToGitHub;
$('#btnSettings').onclick = openSettings;
function openSettings() {
  dlg.innerHTML = `<form id="sf"><h2>الإعدادات</h2>
    <label>اسم العيلة (العنوان)<input name="title" value="${esc(data.meta.title)}"></label>
    <div class="row2"><label>صاحب الريبو (GitHub user)<input name="owner" value="${esc(cfg.owner)}" placeholder="username"></label>
      <label>اسم الريبو<input name="repo" value="${esc(cfg.repo)}" placeholder="family-tree"></label></div>
    <label>Branch<input name="branch" value="${esc(cfg.branch)}"></label>
    <label>GitHub Token (للتعديل فقط)<input name="token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocomplete="off"></label>
    <p class="hint">الـ Token بيتخزن في متصفحك بس. اعمل Fine-grained token لريبو الشجرة بس بصلاحية <b>Contents: Read and write</b>. اللي يشوف الموقع بس مش محتاج Token.</p>
    <div class="dlgActions">
      <button type="button" id="dl">تنزيل JSON</button>
      ${vault.on ? '<button type="button" id="forget">🔒 اقفل وانسَ المفتاح</button>' : ''}
      ${state.dirty ? '<button type="button" id="drop" class="danger">تجاهل التعديلات المحلية</button>' : ''}
      <button type="button" data-close>إلغاء</button><button type="submit" class="primary">حفظ</button></div></form>`;
  const f = $('#sf', dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  $('#dl', dlg).onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([serialize(data)], { type: 'application/json' })); a.download = 'family.json'; a.click();
  };
  const fg = $('#forget', dlg); if (fg) fg.onclick = () => { store.del('ft-key'); location.reload(); };
  const drop = $('#drop', dlg);
  if (drop) drop.onclick = () => { if (confirm('هتتمسح كل التعديلات اللي لسه ماتحفظتش. متأكد؟')) { store.del('ft-draft'); location.reload(); } };
  f.onsubmit = (e) => {
    e.preventDefault(); const fd = new FormData(f), v = (k) => fd.get(k).toString().trim();
    cfg = { owner: v('owner'), repo: v('repo'), branch: v('branch') || 'main', token: v('token') };
    store.set('ft-cfg', cfg);
    if (v('title') !== data.meta.title) { data.meta.title = v('title') || 'شجرة العيلة'; $('#title').textContent = data.meta.title; document.title = data.meta.title; touch(); }
    dlg.close(); toast('اتحفظت الإعدادات');
  };
  dlg.showModal();
}
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('resize', () => cur && fit());

// PWA: offline cache + install button
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
let installEv = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEv = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => { if (!installEv) return; installEv.prompt(); await installEv.userChoice; installEv = null; $('#btnInstall').hidden = true; };
addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; });

load();
