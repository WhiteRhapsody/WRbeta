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
  // 照片 → Drive；onStep(i, n) 回報進度。回傳 { n, dir }
  function uploadPhotos(files, onStep) {
    var d = new Date(), base = stamp(d), dir = ROOT_DIR + '/' + dirName(d);
    return dayFolder().then(function (fid) {
      var i = 0, next = function () {
        if (i >= files.length) return { n: files.length, dir: dir };
        var f = files[i], ext = (/\.(\w{2,5})$/.exec(f.name || '') || [0, /png/i.test(f.type) ? 'png' : 'jpg'])[1].toLowerCase();
        if (onStep) onStep(i, files.length);
        return upload(fid, base + '_' + (++i) + '.' + ext, f, f.type || 'image/jpeg').then(next);
      };
      return next();
    });
  }
  function uploadText(name, text) { return dayFolder().then(function (fid) { return upload(fid, name, new Blob([text], { type: 'application/json' }), 'application/json'); }).then(function () { return ROOT_DIR + '/' + dirName(); }); }
  // ---- v3.1.2 上傳檢視資料：base＝檔名前綴；pack＝{ json, csv }；files＝掃描用的照片 ----
  function photoExt(f) { return (/\.(\w{2,5})$/.exec(f.name || '') || [0, /png/i.test(f.type || '') ? 'png' : 'jpg'])[1].toLowerCase(); }
  function photoNames(base, files) { return files.map(function (f, i) { return base + '_p' + (i + 1) + '.' + photoExt(f); }); }
  function uploadReview(base, pack, files, onStep) {
    if (!isOwner()) return Promise.reject(new Error('owner'));
    var d = new Date(), dir = ROOT_DIR + '/' + dirName(d), names = photoNames(base, files), n = files.length + 2;
    return dayFolder(d).then(function (fid) {
      if (onStep) onStep(0, n);
      return upload(fid, base + '_list.json', new Blob([pack.json], { type: 'application/json' }), 'application/json').then(function () {
        if (onStep) onStep(1, n);
        return upload(fid, base + '_list.csv', new Blob(['\ufeff' + pack.csv], { type: 'text/csv' }), 'text/csv');
      }).then(function () {
        var i = 0, next = function () {
          if (i >= files.length) return { n: n, dir: dir, base: base };
          if (onStep) onStep(i + 2, n);
          var f = files[i], nm = names[i]; i++;
          return upload(fid, nm, f, f.type || 'image/jpeg').then(next);
        };
        return next();
      });
    });
  }
  function csvCell(v) { if (v == null) return ''; if (typeof v === 'string' && /^[=+@\t\r]|^-(?![\d.])/.test(v)) v = "'" + v; v = String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(cols, rows) { return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); })).join('\r\n') + '\r\n'; }
  // ---- v3.1.2 原樣檔（只存在這台裝置的 IndexedDB；最多 MAXS 筆，舊的自動刪） ----
  var DBN = 'wrbeta-sius-scans', OS = 'scans', MAXS = 30, dbP = null;
  function idb() {
    if (!dbP) dbP = new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('idb')); return; }
      var r = root.indexedDB.open(DBN, 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(OS)) r.result.createObjectStore(OS, { keyPath: 'id' }); };
      r.onsuccess = function () { var db = r.result; db.onclose = function () { dbP = null; }; db.onversionchange = function () { try { db.close(); } catch (e) {} dbP = null; }; res(db); };
      r.onerror = function () { dbP = null; rej(r.error || new Error('idb')); }; r.onblocked = function () { dbP = null; rej(new Error('idb blocked')); };
    });
    return dbP;
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(OS, mode), out;
        t.oncomplete = function () { res(out && typeof out === 'object' && 'readyState' in out ? out.result : out); };
        t.onerror = function () { rej(t.error || new Error('idb')); }; t.onabort = function () { rej(t.error || new Error('abort')); };
        try { out = fn(t.objectStore(OS)); } catch (e) { try { t.abort(); } catch (e2) {} rej(e); }
      });
    });
  }
  function own() { return isOwner() ? null : Promise.reject(new Error('owner')); }
  function scanList() { return own() || tx('readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return (y.updated || 0) - (x.updated || 0); }); }); }
  function scanGet(id) { return own() || tx('readonly', function (s) { return s.get(id); }); }
  function scanDel(id) { return own() || tx('readwrite', function (s) { s.delete(id); }); }
  function scanPut(d) {
    if (!isOwner()) return Promise.reject(new Error('owner'));
    d.updated = Date.now();
    return tx('readwrite', function (s) { // 同一筆更新：保留原本的建立時間、已送分析（同一個交易裡讀再寫）
      var g = s.get(d.id); g.onsuccess = function () { var p = g.result; if (p) { d.created = p.created || d.created; if (p.sent && d.sent == null) d.sent = p.sent; } if (!d.created) d.created = d.updated; s.put(d); };
    }).then(function () {
      return scanList().then(function (a) { var old = a.slice(MAXS); return old.length ? tx('readwrite', function (s) { old.forEach(function (o) { s.delete(o.id); }); }) : null; });
    }).then(function () { return d.id; });
  }
  function scanMark(id, f) { return own() || tx('readwrite', function (s) { var g = s.get(id); g.onsuccess = function () { var d = g.result; if (!d) return; for (var k in f) d[k] = f[k]; s.put(d); }; }); }
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
