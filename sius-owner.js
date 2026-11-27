/* WRbeta v3.1.0 小白單「站長工具」（window.WRSiusOwner）：只有站長帳號（WRMember.owner＝staff/{uid}.badge=='owner'）看得到。【White 2026-11-27 18:38「開工」】
 *   1. 保存解析檔：引擎直接讀出來、還沒人工改過的結果（含錯）→ JSON 檔，檔名自己取（White 習慣前面加 xx）。
 *   2. 另存新檔：人工對照單子全部改正後的同一份 → 另一個檔名（White 習慣前面加 oo）。兩份成對，拿來調引擎、算真正的正確率。
 *   3. 照片上傳 Google Drive：「小白單/月日＋會員 ID」資料夾（例 小白單/1127ChaotiC），每天自動建新的。
 *      用 Google Identity Services（瀏覽器直接拿權杖），權限只要 drive.file（只看得到 App 自己建的檔案和資料夾）。
 *      OAuth 用戶端 ID 放在 firebase-config.js 的 window.WR_DRIVE_CLIENT_ID；空的＝還沒設定，按鈕只提示「設定中」。
 *   檔案存到手機（下載）；Drive 已連上的話也一起傳到同一個資料夾。
 * v3.1.2【White 2026-11-27 20:12「把312推上去」】
 *   4. 原樣存檔：這次掃描照原樣（紅黃綠燈、缺座標、推估、照片）存在這台裝置（IndexedDB），之後可回小白單繼續改、或直接送分析。
 *   5. 上傳檢視資料：這次掃描的每發列表（JSON＋CSV）＋掃描用的照片 → Drive「小白單/MMDD代號」，檔名同一個前綴 rvMMDD_HHMMSS，
 *      例 rv1127_201530_list.json／_list.csv／_p1.jpg…，下載後照前綴一一對應。 */
(function (root) {
  'use strict';
  var GIS = 'https://accounts.google.com/gsi/client', SCOPE = 'https://www.googleapis.com/auth/drive.file', API = 'https://www.googleapis.com/drive/v3/files', UP = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name';
  var ROOT_DIR = '小白單', FOLDER = 'application/vnd.google-apps.folder';
  var tok = null, tokExp = 0, client = null, gisP = null;
  function cid() { return String(root.WR_DRIVE_CLIENT_ID || '').trim(); }
  function isOwner() { try { return !!(root.WRMember && root.WRMember.owner); } catch (e) { return false; } }
  function mid() { try { var p = root.WRMember && root.WRMember.profile; return (p && (p.mid || p.id)) || 'owner'; } catch (e) { return 'owner'; } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mmdd(d) { d = d || new Date(); return pad(d.getMonth() + 1) + pad(d.getDate()); }
  function stamp(d) { d = d || new Date(); return mmdd(d) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
  function dirName(d) { return mmdd(d) + mid(); }
  function loadGis() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (!gisP) gisP = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = GIS; s.async = true; s.onload = res; s.onerror = function () { gisP = null; rej(new Error('gis')); }; document.head.appendChild(s); });
    return gisP;
  }
  function connected() { return !!tok && Date.now() < tokExp - 60000; }
  // 要在按鈕的 click 裡同步呼叫（彈出視窗才不會被擋）；GIS 先在畫面出現時預先載好
  function token(interactive) {
    if (!isOwner()) return Promise.reject(new Error('owner'));
    if (connected()) return Promise.resolve(tok);
    if (!cid()) return Promise.reject(new Error('noclient'));
    if (!(root.google && root.google.accounts && root.google.accounts.oauth2)) return loadGis().then(function () { return token(interactive); });
    return new Promise(function (res, rej) {
      try {
        client = root.google.accounts.oauth2.initTokenClient({ client_id: cid(), scope: SCOPE, callback: function (r) { if (r && r.access_token) { tok = r.access_token; tokExp = Date.now() + (+r.expires_in || 3600) * 1000; res(tok); } else rej(new Error((r && r.error) || 'denied')); }, error_callback: function (e) { rej(new Error((e && e.type) || 'popup')); } });
        client.requestAccessToken({ prompt: tok ? '' : 'consent' });
      } catch (e) { rej(e); }
    });
  }
  function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  function api(url, o) {
    o = o || {}; o.headers = o.headers || {}; o.headers.Authorization = 'Bearer ' + tok;
    return fetch(url, o).then(function (r) { if (r.status === 401) { tok = null; throw new Error('401'); } if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t.slice(0, 120)); }); return r.json(); });
  }
  function folder(name, parent) { // 找 App 自己建的資料夾，沒有就建
    var qs = 'name=' + q(name) + " and mimeType='" + FOLDER + "' and trashed=false and " + q(parent) + ' in parents';
    return api(API + '?q=' + encodeURIComponent(qs) + '&fields=files(id,name)&spaces=drive').then(function (r) {
      if (r.files && r.files.length) return r.files[0].id;
      return api(API + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, mimeType: FOLDER, parents: [parent] }) }).then(function (f) { return f.id; });
    });
  }
  function dayFolder(d) { return folder(ROOT_DIR, 'root').then(function (id) { return folder(dirName(d), id); }); }
  function upload(parent, name, blob, type) {
    var b = 'wrb' + Math.random().toString(36).slice(2), meta = JSON.stringify({ name: name, parents: [parent] });
    var body = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: ' + (type || blob.type || 'application/octet-stream') + '\r\n\r\n', blob, '\r\n--' + b + '--'], { type: 'multipart/related; boundary=' + b });
    return api(UP, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: body });
  }
  // v3.2.0（上傳中斷可以續傳）：網路斷線／429／5xx 自動重試（最多 RETRY 次、間隔加長）；
  // 同一批（同一個檔名前綴）再按一次：先看資料夾裡已經有哪些檔名，只補傳還沒上去的（multipart 一個檔不是全有就是全無，不會留半個檔）
  var RETRY = 3, WAIT = 1200;
  function transient(e) { var m = String(e && e.message || e); return e instanceof TypeError || /^(429|5\d\d)\b/.test(m) || /network|failed to fetch|load failed/i.test(m); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function retry(fn, n) { n = n || 0; return fn().catch(function (e) { if (n >= RETRY || !transient(e)) throw e; return sleep(WAIT * (n + 1)).then(function () { return retry(fn, n + 1); }); }); }
  function namesIn(fid) { // 資料夾裡（App 自己建的）現有的檔名；查不到就當作沒有（照常全部上傳）
    var out = {}, page = function (tk) {
      var qs = q(fid) + ' in parents and trashed=false';
      return api(API + '?q=' + encodeURIComponent(qs) + '&fields=nextPageToken,files(name,size)&pageSize=1000&spaces=drive' + (tk ? '&pageToken=' + encodeURIComponent(tk) : '')).then(function (r) {
        (r.files || []).forEach(function (f) { out[f.name] = 1; }); return r.nextPageToken ? page(r.nextPageToken) : out;
      });
    };
    return retry(function () { out = {}; return page(); }); // 查不到就整批停（不要當成空資料夾而重傳造成重複檔；審查建議）
  }
  function sendAll(fid, jobs, onStep, have) { // jobs: [{ name, blob, type }]；回傳 { sent, skipped }
    var i = 0, sent = 0, skipped = 0, next = function () {
      if (i >= jobs.length) return { sent: sent, skipped: skipped };
      var j = jobs[i]; if (onStep) onStep(i, jobs.length); i++;
      if (have && have[j.name]) { skipped++; return next(); }
      var tries = 0;
      // 重送前先看資料夾裡是不是其實已經建好了（伺服器收到、回應斷掉）→ 不重複建檔（Carbon 審查）
      return retry(function () { var k = tries++; return (k ? namesIn(fid).then(function (h) { return h[j.name] ? 'had' : upload(fid, j.name, j.blob, j.type); }) : upload(fid, j.name, j.blob, j.type)); }).then(function () { sent++; if (have) have[j.name] = 1; return next(); });
    };
    return next();
  }
  // 照片 → Drive；onStep(i, n) 回報進度。回傳 { n, dir, base }；opt.base＝上次沒傳完的那批（續傳）
  function uploadPhotos(files, onStep, opt) {
    opt = opt || {};
    var d = opt.date ? new Date(opt.date) : new Date(), base = opt.base || stamp(d), dir = ROOT_DIR + '/' + dirName(d);
    return retry(function () { return dayFolder(d); }).then(function (fid) {
      var jobs = files.map(function (f, i) { return { name: base + '_' + (i + 1) + '.' + photoExt(f), blob: f, type: f.type || 'image/jpeg' }; });
      return (opt.base ? namesIn(fid) : Promise.resolve(null)).then(function (have) { return sendAll(fid, jobs, onStep, have); });
    }).then(function (r) { return { n: files.length, dir: dir, base: base, sent: r.sent, skipped: r.skipped }; }, function (e) { if (e && typeof e === 'object') { e.base = base; e.date = d.getTime(); } throw e; });
  }
  function uploadText(name, text) { return dayFolder().then(function (fid) { return upload(fid, name, new Blob([text], { type: 'application/json' }), 'application/json'); }).then(function () { return ROOT_DIR + '/' + dirName(); }); }
  // ---- v3.1.2 上傳檢視資料：base＝檔名前綴；pack＝{ json, csv }；files＝掃描用的照片 ----
  function photoExt(f) { return (/\.(\w{2,5})$/.exec(f.name || '') || [0, /png/i.test(f.type || '') ? 'png' : 'jpg'])[1].toLowerCase(); }
  function photoNames(base, files) { return files.map(function (f, i) { return base + '_p' + (i + 1) + '.' + photoExt(f); }); }
  function uploadReview(base, pack, files, onStep, opt) {
    if (!isOwner()) return Promise.reject(new Error('owner'));
    opt = opt || {};
    var d = opt.date ? new Date(opt.date) : new Date(), dir = ROOT_DIR + '/' + dirName(d), names = photoNames(base, files), n = files.length + 2;
    return retry(function () { return dayFolder(d); }).then(function (fid) {
      var jobs = [{ name: base + '_list.json', blob: new Blob([pack.json], { type: 'application/json' }), type: 'application/json' }, { name: base + '_list.csv', blob: new Blob(['\ufeff' + pack.csv], { type: 'text/csv' }), type: 'text/csv' }]
        .concat(files.map(function (f, i) { return { name: names[i], blob: f, type: f.type || 'image/jpeg' }; }));
      // 續傳（opt.resume）：已經在資料夾裡的檔名跳過（App 那邊只有在內容沒改過時才沿用同一個前綴）
      return (opt.resume ? namesIn(fid) : Promise.resolve(null)).then(function (have) { return sendAll(fid, jobs, onStep, have); });
    }).then(function (r) { return { n: n, dir: dir, base: base, sent: r.sent, skipped: r.skipped }; }, function (e) { if (e && typeof e === 'object') { e.base = base; e.date = d.getTime(); } throw e; });
  }
  function csvCell(v) { if (v == null) return ''; if (typeof v === 'string' && /^[=+@\t\r]|^-(?![\d.])/.test(v)) v = "'" + v; v = String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(cols, rows) { return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); })).join('\r\n') + '\r\n'; }
  // ---- v3.1.2 原樣檔（只存在這台裝置的 IndexedDB；最多 MAXS 筆，舊的自動刪） ----
  // v3.2.0：清單另外放一個小的 'list' store（只有名稱、燈號、照片張數、時間），開清單不用把每筆的照片和模型整個讀出來；
  // 空間滿（QuotaExceededError）時先刪最舊的一筆再重試（最多 QUOTA_TRY 次），還是不行才回報失敗。
  var DBN = 'wrbeta-sius-scans', OS = 'scans', LS = 'list', MAXS = 30, QUOTA_TRY = 5, dbP = null;
  function brief(d) { return { id: d.id, name: d.name || '', lights: d.lights || {}, nPhotos: (d.photos || []).length, sent: d.sent || null, updated: d.updated || 0, created: d.created || 0, targetId: d.targetId || null }; }
  function idb() {
    if (!dbP) dbP = new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('idb')); return; }
      var r = root.indexedDB.open(DBN, 2);
      r.onupgradeneeded = function () {
        var db = r.result, t = r.transaction;
        if (!db.objectStoreNames.contains(OS)) db.createObjectStore(OS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(LS)) {
          var ls = db.createObjectStore(LS, { keyPath: 'id' });
          var c = t.objectStore(OS).openCursor(); // 舊版（v1）留下的原樣檔補進清單
          c.onsuccess = function () { var k = c.result; if (!k) return; try { ls.put(brief(k.value)); } catch (e) {} k.continue(); };
        }
      };
      r.onsuccess = function () { var db = r.result; db.onclose = function () { dbP = null; }; db.onversionchange = function () { try { db.close(); } catch (e) {} dbP = null; }; res(db); };
      r.onerror = function () { dbP = null; rej(r.error || new Error('idb')); }; r.onblocked = function () { dbP = null; rej(new Error('idb blocked')); };
    });
    return dbP;
  }
  function tx(mode, fn, stores) {
    stores = stores || [OS, LS];
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(stores, mode), out;
        t.oncomplete = function () { res(out && typeof out === 'object' && 'readyState' in out ? out.result : out); };
        var er = function (ev, d) { return t.error || (ev && ev.target && ev.target.error) || new Error(d); }; // 空間滿的 QuotaExceededError 在 request 上（交易還沒 abort 時 t.error 是 null；Carbon 審查）
        t.onerror = function (ev) { rej(er(ev, 'idb')); }; t.onabort = function (ev) { rej(er(ev, 'abort')); };
        // 只拿交易範圍內的 store（審查 P0：範圍外的 objectStore() 會丟 NotFoundError）
        try { out = fn(stores.indexOf(OS) >= 0 ? t.objectStore(OS) : null, stores.indexOf(LS) >= 0 ? t.objectStore(LS) : null); } catch (e) { try { t.abort(); } catch (e2) {} rej(e); }
      });
    });
  }
  function own() { return isOwner() ? null : Promise.reject(new Error('owner')); }
  function sortNew(a) { return (a || []).sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); }); }
  function scanList() { return own() || tx('readonly', function (s, l) { return l.getAll(); }, [LS]).then(sortNew); }
  function scanGet(id) { return own() || tx('readonly', function (s) { return s.get(id); }, [OS]); }
  function scanDel(id) { return own() || tx('readwrite', function (s, l) { s.delete(id); l.delete(id); }); }
  function isQuota(e) { var n = e && (e.name || ''), m = String(e && e.message || ''); return n === 'QuotaExceededError' || /quota/i.test(n + ' ' + m); }
  function putOnce(d) {
    return tx('readwrite', function (s, l) { // 同一筆更新：保留原本的建立時間、已送分析（同一個交易裡讀再寫）
      var g = s.get(d.id); g.onsuccess = function () { var p = g.result; if (p) { d.created = p.created || d.created; if (p.sent && d.sent == null) d.sent = p.sent; } if (!d.created) d.created = d.updated; s.put(d); l.put(brief(d)); };
    });
  }
  function scanPut(d) {
    if (!isOwner()) return Promise.reject(new Error('owner'));
    d.updated = Date.now();
    var tries = 0, go = function () {
      return putOnce(d).catch(function (e) {
        if (!isQuota(e) || tries >= QUOTA_TRY) throw e;
        tries++;
        return scanList().then(function (a) { // 空間滿：刪最舊的一筆（不是正在存的這筆）再試
          var old = a.filter(function (o) { return o.id !== d.id; }).pop();
          if (!old) throw e;
          return tx('readwrite', function (s, l) { s.delete(old.id); l.delete(old.id); }).then(go);
        });
      });
    };
    return go().then(function () {
      return scanList().then(function (a) { var old = a.slice(MAXS); return old.length ? tx('readwrite', function (s, l) { old.forEach(function (o) { s.delete(o.id); l.delete(o.id); }); }) : null; });
    }).then(function () { return d.id; });
  }
  function scanMark(id, f) { return own() || tx('readwrite', function (s, l) { var g = s.get(id); g.onsuccess = function () { var d = g.result; if (!d) return; for (var k in f) d[k] = f[k]; s.put(d); l.put(brief(d)); }; }); }
  // ---- 解析檔 ----
  function serialize(m, ck, kind, extra) {
    var rows = (ck && ck.rows) || [];
    var sh = m.shots.map(function (q, i) {
      var r = rows[i] || {}, o = q.ocr || {}, f = [];
      if (q.decCalc) f.push('decCalc'); if (q.decSub) f.push('decSub'); if (o.xyFix) f.push('xyFix'); if (o.tFix) f.push('tFix'); if (o.arrowFix) f.push('arrowFix'); if (q.fb) f.push('fb'); if (q.ed) f.push('edited'); if (r.missing) f.push('missing');
      return { sec: q.sighter ? 'P' : 'M', n: q.n == null ? null : q.n, pn: q.pn != null ? q.pn : q.n, blk: q.blk || 0, score: q.dec == null ? null : q.dec, inner: !!q.inner, t: q.t || null, x: q.x == null ? null : q.x, y: q.y == null ? null : q.y, light: r.status || null, why: (r.why || []).slice(), cons: (r.cons || []).slice(), flags: f };
    });
    var o = { format: 'wrbeta-sius', v: 1, kind: kind, created: new Date().toISOString(), app: extra && extra.app || '', engine: 'v3.1.0', targetId: m.targetId, event: m.event || '', date: m.date || '', athlete: m.athlete || '', lane: m.lane || '', practice: !!m.practice, intSheet: !!m.intSheet,
      subs: (m.subs || []).map(function (s) { return s ? { score: s.dec, inner: s.inner } : null; }), total: m.total ? { score: m.total.dec, inner: m.total.inner } : null,
      lights: { green: rows.filter(function (r) { return r.status === 'ok'; }).length, yellow: rows.filter(function (r) { return r.status === 'near'; }).length, red: ck ? ck.bad : 0 }, photos: extra && extra.photos || 0, shots: sh };
    return JSON.stringify(o, null, 1);
  }
  function safeName(s, def) { s = String(s || '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80); if (!s) s = def; if (!/\.json$/i.test(s)) s += '.json'; return s; }
  function download(name, text) { var blob = new Blob([text], { type: 'application/json' }), a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1500); }
  // 取檔名的小對話框（跟 App.ask 同一種樣式）：onOk(name)
  function askName(title, def, onOk) {
    var bg = document.createElement('div'); bg.className = 'modal-bg sius-own-bg';
    bg.innerHTML = '<div class="modal sius-own-modal" role="dialog" aria-modal="true"><p></p><label class="sius-f"><span></span><input type="text" autocomplete="off" spellcheck="false" enterkeyhint="done"></label><small class="sius-own-tip"></small><div class="row"><button type="button" class="no"></button><button type="button" class="primary yes"></button></div></div>';
    bg.querySelector('p').textContent = title; bg.querySelector('label span').textContent = wrT('sius.own_fname');
    bg.querySelector('.sius-own-tip').textContent = wrT('sius.own_fname_tip');
    bg.querySelector('.no').textContent = wrT('h.cancel'); bg.querySelector('.yes').textContent = wrT('sius.own_save_btn');
    var inp = bg.querySelector('input'); inp.value = def;
    var go = function () { var v = inp.value; bg.remove(); onOk(v); };
    bg.querySelector('.no').onclick = function () { bg.remove(); }; bg.querySelector('.yes').onclick = go;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    document.body.appendChild(bg); try { inp.focus(); inp.setSelectionRange(0, inp.value.length); } catch (e) {}
  }
  var api2 = { isOwner: isOwner, hasClient: function () { return !!cid(); }, connected: connected, token: token, preload: function () { if (cid()) loadGis().catch(function () {}); },
    uploadPhotos: uploadPhotos, uploadText: uploadText, serialize: serialize, safeName: safeName, download: download, askName: askName, stamp: stamp, dirName: dirName, ROOT_DIR: ROOT_DIR,
    uploadReview: uploadReview, photoNames: photoNames, toCsv: toCsv, scanList: scanList, scanGet: scanGet, scanPut: scanPut, scanDel: scanDel, scanMark: scanMark, MAX_SCANS: MAXS };
  root.WRSiusOwner = api2;
})(window);
