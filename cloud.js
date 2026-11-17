/* WRbeta 雲端同步（備註4）：Firebase Auth（Google；之後可加 Apple）＋ Firestore。
 * 原則：離線優先。本機 localStorage 永遠是主要資料，沒登入時完全不連網；登入後在背景同步。
 * 只有在 firebase-config.js 有設定時，才從 gstatic CDN 動態載入 Firebase 模組（沒設定＝零流量、零影響）。
 * Firestore 結構：users/{uid}（個人資料）、users/{uid}/records/{紀錄id}（每筆紀錄一份文件，data＝紀錄 JSON 字串）。
 * 衝突處理：以紀錄的 updated（ISO 時間）較新者為準；刪除用「墓碑」（deleted:true）讓其他裝置也刪掉。 */
(function (root) {
  'use strict';
  var SDK = '13.4.0', BASE = 'https://www.gstatic.com/firebasejs/' + SDK + '/';
  var LS_TOMB = 'wr_cloud_tomb_v1', LS_META = 'wr_cloud_meta_v1';
  var MAX_DATA = 400000; // 單筆紀錄 JSON 上限（字元）；Firestore 單一文件上限 1 MiB，規則同步檢查
  var RELAY_RE = /@privaterelay\.appleid\.com$/i; // Apple「隱藏我的電子郵件」轉寄信箱

  // ---------- 純函式（Node 測試用） ----------
  function ts(s) { var t = Date.parse(s && (s.updated || s.created)); return isFinite(t) ? t : 0; }
  function clean(s) { // 只存需要的資料：去掉暫存欄位（底線開頭，例如 _undo）
    return JSON.parse(JSON.stringify(s, function (k, v) { return k && k.charAt(0) === '_' ? undefined : v; }));
  }
  function toDoc(s) {
    var c = clean(s), data = JSON.stringify(c);
    if (data.length > MAX_DATA) return null;
    return { id: String(s.id), kind: s.kind === 'analysis' ? 'analysis' : 'forecast', targetId: String(s.targetId || 'ap10'), created: String(s.created || ''),
      updated: new Date(ts(s) || Date.now()).toISOString(), name: String(s.name || '').slice(0, 60), v: 2, data: data, size: data.length };
  }
  function fromDoc(d) { try { var s = JSON.parse(d.data); if (!s || s.id !== d.id) return null; if (!s.updated) s.updated = d.updated; return s; } catch (e) { return null; } }
  function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_\-]{1,64}$/.test(id); }
  /* 合併：local＝本機 sessions；remote＝雲端文件（可以只是「上次同步後有變的」）；tombs＝本機待刪 id；
   * sinceMs＝上次上傳時間（本機有、雲端這次沒回傳的紀錄，只有比這更新才上傳）。
   * 回傳 { list：合併後的 sessions（新到舊）, upload：要上傳的 sessions, del：要寫墓碑的 id, changed：本機有沒有變 } */
  function mergeSessions(local, remote, tombs, sinceMs) {
    var L = {}, R = {}, out = [], upload = [], del = [], changed = false, T = {};
    (tombs || []).forEach(function (id) { T[id] = 1; });
    (local || []).forEach(function (s) { if (s && s.id) L[s.id] = s; });
    (remote || []).forEach(function (d) { if (d && d.id) R[d.id] = d; });
    Object.keys(T).forEach(function (id) { del.push(id); if (L[id]) { delete L[id]; changed = true; } });
    var ids = {}; Object.keys(L).concat(Object.keys(R)).forEach(function (id) { ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      if (T[id]) return;
      var l = L[id], r = R[id], rt = r ? Date.parse(r.updated) || 0 : 0;
      if (r && r.deleted) {
        if (l && ts(l) > rt) { out.push(l); upload.push(l); } // 本機在刪除之後又改過：保留並重新上傳
        else if (l) changed = true;                            // 別台裝置刪掉了：本機也刪
        return;
      }
      if (l && r) {
        if (ts(l) > rt) { out.push(l); upload.push(l); }
        else if (ts(l) < rt) { var s = fromDoc(r); if (s) { out.push(s); changed = true; } else out.push(l); }
        else out.push(l);
      } else if (l) { out.push(l); if (ts(l) > (sinceMs || 0)) upload.push(l); }
      else { var s2 = fromDoc(r); if (s2) { out.push(s2); changed = true; } }
    });
    // 保持本機原本順序，新的雲端紀錄依建立時間插入（新到舊）
    var order = {}; (local || []).forEach(function (s, i) { if (s) order[s.id] = i; });
    out.sort(function (a, b) {
      var ia = order[a.id], ib = order[b.id];
      if (ia != null && ib != null) return ia - ib;
      return (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0);
    });
    return { list: out, upload: upload, del: del, changed: changed };
  }
  function isRelayEmail(e) { return RELAY_RE.test(String(e || '')); }

  var pure = { SDK: SDK, MAX_DATA: MAX_DATA, ts: ts, toDoc: toDoc, fromDoc: fromDoc, mergeSessions: mergeSessions, isRelayEmail: isRelayEmail, validId: validId };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  // ---------- 瀏覽器端 ----------
  var cfg = root.WR_FIREBASE_CONFIG || null;
  var providers = (root.WR_AUTH_PROVIDERS || ['google']).filter(function (p) { return p === 'google' || p === 'apple'; });
  var state = { status: cfg ? 'loading' : 'off', providers: providers, user: null, lastSync: null, syncing: false, error: '' };
  var hooks = null, M = null, app = null, auth = null, db = null, user = null, timer = null, busy = false, again = false;
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function meta() { var m = ls(LS_META) || {}; return user && m.uid === user.uid ? m : { uid: user && user.uid }; }
  function emit() { if (hooks && hooks.onState) try { hooks.onState(state); } catch (e) {} }
  function setErr(e) { state.error = e ? (e.code ? e.code.replace('auth/', '') : String(e.message || e)).slice(0, 80) : ''; }
  function load() {
    return Promise.all(['firebase-app', 'firebase-auth', 'firebase-firestore'].map(function (n) { return import(BASE + n + '.js'); }))
      .then(function (m) { M = { A: m[0], U: m[1], F: m[2] }; app = M.A.initializeApp(cfg); auth = M.U.getAuth(app); db = M.F.getFirestore(app); });
  }
  function onUser(u) {
    user = u;
    if (!u) { state.status = 'signed-out'; state.user = null; emit(); return; }
    var email = u.email || (u.providerData && u.providerData[0] && u.providerData[0].email) || '';
    var prov = (u.providerData && u.providerData[0] && u.providerData[0].providerId) || '';
    state.status = 'signed-in'; state.user = { uid: u.uid, name: u.displayName || '', email: email, relay: isRelayEmail(email), provider: prov };
    state.lastSync = meta().lastSync || null; emit();
    // 個人資料：Apple 轉寄信箱照樣存（寄信到轉寄信箱會轉給本人），名字只在第一次登入時由 Apple 提供
    M.F.setDoc(M.F.doc(db, 'users', u.uid), { email: email.slice(0, 320), name: (u.displayName || '').slice(0, 100), provider: prov.slice(0, 40), relay: isRelayEmail(email), updated: new Date().toISOString(), app: 'WRbeta' }, { merge: true })
      .catch(function () {});
    syncNow();
  }
  function init(h) {
    hooks = h; emit();
    if (!cfg) return;
    load().then(function () {
      M.U.onAuthStateChanged(auth, onUser);
      M.U.getRedirectResult(auth).catch(function (e) { setErr(e); emit(); });
    }).catch(function (e) { state.status = 'signed-out'; setErr({ message: '無法載入雲端模組（離線？）' }); emit(); });
  }
  function provider(p) {
    if (p === 'apple') { var a = new M.U.OAuthProvider('apple.com'); a.addScope('email'); a.addScope('name'); a.setCustomParameters({ locale: 'zh_TW' }); return a; }
    var g = new M.U.GoogleAuthProvider(); g.setCustomParameters({ prompt: 'select_account' }); return g;
  }
  function signIn(p) {
    if (!auth) return;
    setErr(null); state.status = 'loading'; emit();
    var pr = provider(p);
    M.U.signInWithPopup(auth, pr).catch(function (e) {
      if (e && /popup-blocked|operation-not-supported|web-storage-unsupported/.test(e.code || '')) return M.U.signInWithRedirect(auth, pr);
      throw e;
    }).catch(function (e) { state.status = user ? 'signed-in' : 'signed-out'; if (!/popup-closed|cancelled-popup/.test(e && e.code || '')) setErr(e); emit(); });
  }
  function signOut() { if (auth) M.U.signOut(auth).catch(function (e) { setErr(e); emit(); }); }
  function syncNow() {
    if (!user || !hooks) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; state.syncing = true; setErr(null); emit();
    var uid = user.uid, m = meta(), col = M.F.collection(db, 'users', uid, 'records');
    var q = m.lastPull ? M.F.query(col, M.F.where('updated', '>', m.lastPull)) : col;
    var startedAt = new Date().toISOString();
    return M.F.getDocs(q).then(function (snap) {
      var remote = []; snap.forEach(function (d) { remote.push(d.data()); });
      var tombs = (ls(LS_TOMB) || []).filter(validId);
      var r = mergeSessions(hooks.getSessions(), remote, tombs, m.lastPush ? Date.parse(m.lastPush) : 0);
      var ops = [], skipped = 0, now = new Date().toISOString();
      r.upload.forEach(function (s) { if (!validId(String(s.id))) { skipped++; return; } var d = toDoc(s); if (d) ops.push([s.id, d]); else skipped++; });
      r.del.forEach(function (id) { ops.push([id, { id: id, updated: now, deleted: true }]); });
      var chain = Promise.resolve();
      for (var i = 0; i < ops.length; i += 400) (function (part) {
        chain = chain.then(function () { var b = M.F.writeBatch(db); part.forEach(function (o) { b.set(M.F.doc(db, 'users', uid, 'records', o[0]), o[1]); }); return b.commit(); });
      })(ops.slice(i, i + 400));
      return chain.then(function () {
        var done = {}; tombs.forEach(function (id) { done[id] = 1; }); // 只清掉這次處理過的墓碑（同步途中又刪的保留到下次）
        ls(LS_TOMB, (ls(LS_TOMB) || []).filter(function (id) { return !done[id]; }));
        if (r.changed) hooks.setSessions(r.list);
        var maxPull = m.lastPull || ''; remote.forEach(function (d) { if (d.updated > maxPull) maxPull = d.updated; });
        ops.forEach(function (o) { if (o[1].updated > maxPull) maxPull = o[1].updated; });
        ls(LS_META, { uid: uid, lastPull: maxPull, lastPush: startedAt, lastSync: new Date().toISOString() });
        state.lastSync = new Date().toISOString();
        if (skipped) state.error = skipped + ' 筆太大或格式不符，沒有上傳';
      });
    }).catch(function (e) { setErr(e); }).then(function () {
      busy = false; state.syncing = false; emit();
      if (again) { again = false; schedule(1500); }
    });
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(syncNow, ms); }
  function markDirty() { if (user) schedule(4000); }
  function remove(id) { if (!cfg) return; var t = ls(LS_TOMB) || []; if (t.indexOf(id) < 0) t.push(id); ls(LS_TOMB, t); markDirty(); }
  root.WRCloud = { enabled: !!cfg, state: state, init: init, signIn: signIn, signOut: signOut, syncNow: syncNow, markDirty: markDirty, remove: remove, _pure: pure };
})(typeof window !== 'undefined' ? window : this);
