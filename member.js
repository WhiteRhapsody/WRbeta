/* WRbeta v2.0.0 會員（window.WRMember）
 * 1. 第一次 Google 登入 →「建立會員資料」：會員 ID（3–20 字，英文／數字／底線，不分大小寫唯一）＋頭像（上傳或不使用）
 * 2. 頭像：手機上先裁成正方形、縮到 256px、壓成 JPEG（約 20–30KB），以 data URL 存在 Firestore profiles/{uid}（規則限 60,000 字）
 *    關掉頭像＝頭像框整個拿掉，只顯示會員 ID（雲端的頭像也清掉；這台裝置留一份，重新打開不用再選）
 * 3. 標題列左上角：頭像＋會員 ID（沒登入維持原本 WRbeta 標誌）
 * 4. 好友：用會員 ID 邀請、接受／拒絕、取消、刪除；分享某一筆紀錄給好友（唯讀，最多 5 人，可收回）
 * 5. 點自己的頭像／名字 → 軟綿綿的漫畫框「點兩下跳到會員頁面」；點兩下 → 設定/說明 › 帳號
 * 6. 彩蛋：把漫畫框拖到「設定/說明」→ 輸入作弊密碼（密碼只存 SHA-256，驗證在 Firestore 規則）；管理員畫面
 * 資料結構與權限見 firestore.rules。沒有 Cloud Functions、沒有 Firebase Storage（Spark 免費方案）。
 * 後端（Firestore）包在 FirestoreBackend()；e2e 測試用 WRMember._mock(假後端, 假使用者) 換掉。 */
if (typeof wrT === 'undefined' && typeof require === 'function') { try { require('./i18n/i18n.js'); } catch (e) {} } // v2.2.0：在 Node（測試）也有 wrT（預設繁體中文）
(function (root) {
  'use strict';
  // ---------- 純函式（Node 測試用） ----------
  var MID_RE = /^[A-Za-z0-9_]{3,20}$/, AV_MAX = 60000, SHARE_MAX = 5;
  var GROUPS = { referee: wrT('member.judge'), coach: wrT('member.coach'), staff: wrT('member.staff'), tester: wrT('member.tester') };
  function midCheck(s) {
    s = String(s == null ? '' : s);
    var r = { len: s.length, lenOk: s.length >= 3 && s.length <= 20, charsOk: /^[A-Za-z0-9_]*$/.test(s) && s.length > 0 };
    r.ok = MID_RE.test(s);
    r.msg = !s.length ? wrT('member.please_enter_a_member_id') : !r.charsOk ? wrT('member.only_letters_numbers_and_underscores') : s.length < 3 ? wrT('member.at_least_3_characters') : s.length > 20 ? wrT('member.at_most_20_characters') : '';
    return r;
  }
  function normCode(s) { // 作弊碼正規化：全形轉半形、前後空白、連續空白變一個、小寫
    s = String(s == null ? '' : s); try { s = s.normalize('NFKC'); } catch (e) {}
    return s.replace(/[\s\u3000]+/g, ' ').trim().toLowerCase();
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256(s) { // 回傳 Promise<hex>
    var c = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : (root.crypto && root.crypto.subtle ? root.crypto : null);
    if (!c) return Promise.reject(new Error('no-crypto'));
    return c.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(hex);
  }
  function codeHash(s) { return sha256(normCode(s)); }
  function pairId(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
  function parsePerks(t) { // "ghost, pro 教練" → ['ghost','pro']（只收 a-z 0-9 _ -，最多 8 個，不重複）
    var out = []; String(t || '').toLowerCase().split(/[\s,，、;；]+/).forEach(function (p) { if (/^[a-z0-9_-]{1,20}$/.test(p) && out.indexOf(p) < 0 && out.length < 8) out.push(p); });
    return out;
  }
  function parseMids(t) { var out = []; String(t || '').split(/[\s,，、;；]+/).forEach(function (m) { if (MID_RE.test(m) && out.indexOf(m) < 0 && out.length < 50) out.push(m); }); return out; }
  function avatarOk(d) { return typeof d === 'string' && d.length <= AV_MAX && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(d); }
  function friendView(docs, me) { // friendships 文件 → { friends, incoming, outgoing }（每個都有 id、uid＝對方）
    var r = { friends: [], incoming: [], outgoing: [] };
    (docs || []).forEach(function (d) {
      if (!d || !d.users || d.users.indexOf(me) < 0) return;
      var other = d.users[0] === me ? d.users[1] : d.users[0], o = { id: d.id, uid: other, status: d.status, t: d.updatedMs || 0 };
      if (d.status === 'accepted') r.friends.push(o); else if (d.to === me) r.incoming.push(o); else r.outgoing.push(o);
    });
    return r;
  }
  function perksOf(reds, perksByCode) { // 已核准（granted）的兌換 → 功能清單
    var out = []; (reds || []).forEach(function (x) { if (x.status !== 'granted') return; (perksByCode[x.code] || []).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); }); });
    return out;
  }
  function rateOk(tries, now, max, winMs) { // 輸入作弊碼的次數限制（這台裝置）：winMs 內最多 max 次
    var recent = (tries || []).filter(function (t) { return now - t < winMs; });
    return { ok: recent.length < max, recent: recent, waitMs: recent.length < max ? 0 : winMs - (now - recent[0]) };
  }
  var pure = { MID_RE: MID_RE, AV_MAX: AV_MAX, SHARE_MAX: SHARE_MAX, GROUPS: GROUPS, midCheck: midCheck, normCode: normCode, sha256: sha256, codeHash: codeHash, pairId: pairId, parsePerks: parsePerks, parseMids: parseMids, avatarOk: avatarOk, friendView: friendView, perksOf: perksOf, rateOk: rateOk };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  // ---------- 瀏覽器端 ----------
  var D = document, B = D.body;
  function $(id) { return D.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function app() { return root.BMApp || {}; }
  function toast(m, ms) { var A = app(); if (A.toast) A.toast(m, ms); }
  function ask(m, y, n, o) { var A = app(); if (A.ask) A.ask(m, y, n, o); else if (confirm(m)) y(); }
  function anim() { return B.classList.contains('fx-anim'); }
  function ls(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  var LS_AV = 'wr_member_av_v1', LS_SEEN = 'wr_member_seen_v1', LS_TRIES = 'wr_cheat_tries_v1';
  var ICON = {
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/></svg>',
    noav: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg>',
    re: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4.5 3.5"/></svg>',
    chev: '<svg class="pf-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    hchev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    g: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'
  };

  // ---------- 後端：Firestore（規則見 firestore.rules） ----------
  function FirestoreBackend() {
    function C() { var c = root.WRCloud && root.WRCloud.fb && root.WRCloud.fb(); if (!c) throw { code: 'not-signed-in' }; return c; }
    function d() { var c = C(); return c.F.doc.apply(null, [c.db].concat([].slice.call(arguments))); }
    function q(col) { var c = C(), w = [].slice.call(arguments, 1).map(function (x) { return c.F.where(x[0], x[1], x[2]); }); return c.F.getDocs(c.F.query.apply(null, [c.F.collection(c.db, col)].concat(w))); }
    function ms(t) { return t && t.toMillis ? t.toMillis() : 0; }
    function rows(snap) { var a = []; snap.forEach(function (s) { var x = s.data(); x.id = s.id; x.updatedMs = ms(x.updated); x.createdMs = ms(x.created); a.push(x); }); return a; }
    function one(p) { return C().F.getDoc(p).then(function (s) { if (!s.exists()) return null; var x = s.data(); x.id = s.id; x.createdMs = ms(x.created); return x; }); }
    function ts() { return C().F.serverTimestamp(); }
    function batch() { var c = C(); return c.F.writeBatch(c.db); }
    function chunkDelete(refs) {
      var chain = Promise.resolve();
      for (var i = 0; i < refs.length; i += 400) {
        (function (part) {
          chain = chain.then(function () {
            if (!part.length) return;
            var b = batch();
            part.forEach(function (r) { b.delete(r); });
            return b.commit();
          });
        })(refs.slice(i, i + 400));
      }
      return chain;
    }
    function P(fn) { return new Promise(function (res) { res(fn()); }); } // 同步丟出的錯誤（沒登入）也變成 rejected
    return {
      getProfile: function (uid) { return P(function () { return one(d('profiles', uid)); }); },
      nameOwner: function (lower) { return P(function () { return one(d('usernames', lower)).then(function (x) { return x ? x.uid : null; }); }); },
      createProfile: function (p) { return P(function () { var uid = C().uid, b = batch(); b.set(d('profiles', uid), { mid: p.mid, midLower: p.mid.toLowerCase(), avatarOn: !!p.avatarOn, avatar: p.avatar || '', created: ts(), updated: ts() }); b.set(d('usernames', p.mid.toLowerCase()), { uid: uid }); return b.commit(); }); },
      updateProfile: function (old, p) {
        return P(function () {
          var uid = C().uid, b = batch(), nl = p.mid.toLowerCase();
          b.update(d('profiles', uid), { mid: p.mid, midLower: nl, avatarOn: !!p.avatarOn, avatar: p.avatar || '', updated: ts() });
          if (nl !== old.midLower) { b.set(d('usernames', nl), { uid: uid }); b.delete(d('usernames', old.midLower)); }
          return b.commit();
        });
      },
      deleteProfile: function (old) { return P(function () { var uid = C().uid, b = batch(); b.delete(d('profiles', uid)); if (old && old.midLower) b.delete(d('usernames', old.midLower)); return b.commit(); }); },
      friendships: function () { return P(function () { return q('friendships', ['users', 'array-contains', C().uid]).then(rows); }); },
      getFriendship: function (pid) { return P(function () { return one(d('friendships', pid)); }); },
      requestFriend: function (to) { return P(function () { var me = C().uid; return C().F.setDoc(d('friendships', pairId(me, to)), { users: me < to ? [me, to] : [to, me], from: me, to: to, status: 'pending', created: ts(), updated: ts() }); }); },
      acceptFriend: function (pid) { return P(function () { return C().F.updateDoc(d('friendships', pid), { status: 'accepted', updated: ts() }); }); },
      deleteFriend: function (pid) { return P(function () { return C().F.deleteDoc(d('friendships', pid)); }); },
      myShares: function () { return P(function () { return q('shares', ['owner', '==', C().uid]).then(rows); }); },
      sharesToMe: function () { return P(function () { return q('shares', ['to', 'array-contains', C().uid]).then(rows); }); },
      createShare: function (sid, x) { return P(function () { return C().F.setDoc(d('shares', sid), Object.assign({}, x, { owner: C().uid, created: ts(), updated: ts() })); }); },
      setShareTo: function (sid, to) { return P(function () { return to.length ? C().F.updateDoc(d('shares', sid), { to: to, updated: ts() }) : C().F.deleteDoc(d('shares', sid)); }); },
      leaveShare: function (sid, to) { return P(function () { return C().F.updateDoc(d('shares', sid), { to: to, updated: ts() }); }); },
      deleteShare: function (sid) { return P(function () { return C().F.deleteDoc(d('shares', sid)); }); },
      isAdmin: function () { return P(function () { return one(d('admins', C().uid)).then(function (x) { return !!x; }); }); },
      myRole: function () { return P(function () { return one(d('roles', C().uid)); }); },
      deleteMyRole: function () { return P(function () { return C().F.deleteDoc(d('roles', C().uid)); }); },
      myRedemptions: function () { return P(function () { return q('redemptions', ['uid', '==', C().uid]).then(rows); }); },
      getRedemption: function (h) { return P(function () { return one(d('redemptions', C().uid + '_' + h)); }); },
      redeem: function (h, status, mid) { return P(function () { var uid = C().uid; return C().F.setDoc(d('redemptions', uid + '_' + h), { uid: uid, code: h, status: status, mid: mid, created: ts(), updated: ts() }); }); },
      deleteRedemption: function (rid) { return P(function () { return C().F.deleteDoc(d('redemptions', rid)); }); },
      getPerks: function (h) { return P(function () { return one(d('cheatperks', h)).then(function (x) { return x ? x.perks || [] : []; }); }); },
      // 管理員
      listCodes: function () { return P(function () { return C().F.getDocs(C().F.collection(C().db, 'cheatcodes')).then(rows); }); },
      getCode: function (h) { return P(function () { return one(d('cheatcodes', h)); }); },
      createCode: function (h, x) { return P(function () { var b = batch(); b.set(d('cheatcodes', h), Object.assign({}, x, { created: ts(), updated: ts(), by: C().uid })); b.set(d('cheatperks', h), { perks: x.perks }); return b.commit(); }); },
      setCodeActive: function (h, on) { return P(function () { return C().F.updateDoc(d('cheatcodes', h), { active: !!on, updated: ts(), by: C().uid }); }); },
      deleteCode: function (h) { return P(function () { var b = batch(); b.delete(d('cheatcodes', h)); b.delete(d('cheatperks', h)); return b.commit(); }); },
      listRedemptions: function (status) { return P(function () { return q('redemptions', ['status', '==', status]).then(rows); }); },
      decide: function (rid, status) { return P(function () { return C().F.updateDoc(d('redemptions', rid), { status: status, updated: ts() }); }); },
      listRoles: function () { return P(function () { return C().F.getDocs(C().F.collection(C().db, 'roles')).then(rows); }); },
      setRole: function (uid, groups, mid) { return P(function () { return groups.length ? C().F.setDoc(d('roles', uid), { groups: groups, mid: mid, updated: ts(), by: C().uid }) : C().F.deleteDoc(d('roles', uid)); }); },
      isHeld: function () { return P(function () { return one(d('suspended', C().uid)).then(function (x) { return !!x; }); }); },
      listProfiles: function () { return P(function () { return C().F.getDocs(C().F.collection(C().db, 'profiles')).then(rows); }); },
      listSuspended: function () { return P(function () { return C().F.getDocs(C().F.collection(C().db, 'suspended')).then(rows); }); },
      setSuspended: function (uid, on) { return P(function () { return on ? C().F.setDoc(d('suspended', uid), { on: true, updated: ts(), by: C().uid }) : C().F.deleteDoc(d('suspended', uid)); }); },
      adminSetMid: function (uid, oldLower, mid) {
        return P(function () {
          var nl = mid.toLowerCase(), b = batch();
          b.update(d('profiles', uid), { mid: mid, midLower: nl, updated: ts() });
          if (nl !== oldLower) { b.set(d('usernames', nl), { uid: uid }); b.delete(d('usernames', oldLower)); }
          return b.commit();
        });
      },
      revokeOwnedShares: function (uid) {
        return P(function () {
          return q('shares', ['owner', '==', uid]).then(function (snap) {
            var refs = []; snap.forEach(function (s) { refs.push(s.ref); });
            return chunkDelete(refs).then(function () { return refs.length; });
          });
        });
      },
      adminWipe: function (uid) {
        return P(function () {
          var c = C();
          function refsOf(snap) { var a = []; snap.forEach(function (s) { a.push(s.ref); }); return a; }
          return Promise.all([
            q('shares', ['owner', '==', uid]).then(refsOf),
            q('shares', ['to', 'array-contains', uid]).then(refsOf),
            q('friendships', ['users', 'array-contains', uid]).then(refsOf),
            q('redemptions', ['uid', '==', uid]).then(refsOf),
            c.F.getDocs(c.F.collection(c.db, 'users', uid, 'records')).then(refsOf)
          ]).then(function (parts) {
            var incoming = parts[1];
            var chain = chunkDelete(parts[0].concat(parts[2], parts[3], parts[4]));
            incoming.forEach(function (ref) {
              chain = chain.then(function () {
                return c.F.getDoc(ref).then(function (s) {
                  if (!s.exists()) return;
                  var to = (s.data().to || []).filter(function (u) { return u !== uid; });
                  return to.length ? c.F.updateDoc(ref, { to: to, updated: ts() }) : c.F.deleteDoc(ref);
                });
              });
            });
            chain = chain.then(function () { return c.F.deleteDoc(d('roles', uid)).catch(function () {}); });
            chain = chain.then(function () { return c.F.deleteDoc(d('users', uid)).catch(function () {}); });
            return chain.then(function () {
              return one(d('profiles', uid)).then(function (p) {
                if (!p) return;
                var b = batch();
                b.delete(d('profiles', uid));
                if (p.midLower) b.delete(d('usernames', p.midLower));
                return b.commit();
              });
            });
          });
        });
      }
    };
  }

  // ---------- 狀態 ----------
  var BE = FirestoreBackend(), mocked = false;
  var S = { status: 'off', user: null, profile: undefined, loadErr: '', friends: { friends: [], incoming: [], outgoing: [] }, profs: {}, mine: [], toMe: [], reds: [], perks: [], groups: [], admin: false, adm: null, signupOpen: false };
  function uid() { return S.user && S.user.uid; }
  function signedIn() { return S.status === 'signed-in' && !!S.user; }
  function hasProfile() { return signedIn() && !!S.profile; }
  function errCode(e) { return String((e && (e.code || e.message)) || e || '').replace(/^firestore\//, '').replace(/^auth\//, ''); }
  function errText(e) {
    var c = errCode(e);
    return { 'permission-denied': wrT('member.the_cloud_refused_already_taken'), unavailable: wrT('member.cant_reach_the_cloud_right'), 'not-signed-in': wrT('member.please_sign_in_first'), 'deadline-exceeded': wrT('member.connection_timed_out_please_try') }[c] || c || wrT('member.something_went_wrong');
  }
  function profOf(u) { return S.profs[u] || null; }
  function loadProfiles(uids) {
    var need = uids.filter(function (u, i) { return u && uids.indexOf(u) === i && !(u in S.profs); });
    return Promise.all(need.map(function (u) { return BE.getProfile(u).then(function (p) { S.profs[u] = p; }, function () { S.profs[u] = null; }); }));
  }
  function emitChange() { renderHeader(); var A0 = app(); if (A0.renderAcct) { try { A0.renderAcct(); } catch (e) { renderCards(); } } else renderCards(); renderBadges(); try { if (app().renderRecShare) app().renderRecShare(); } catch (e) {} }

  function onCloud(st) {
    if (mocked) return;
    var was = uid(), now = st && st.status === 'signed-in' && st.user ? st.user.uid : null;
    S.status = st ? st.status : 'off'; S.user = st && st.user ? st.user : null;
    if (now && now !== was) { S.profile = undefined; S.profs = {}; loadAll(true); }
    else if (!now && was) reset();
  }
  function reset() { S.profile = undefined; S.loadErr = ''; S.friends = { friends: [], incoming: [], outgoing: [] }; S.profs = {}; S.mine = []; S.toMe = []; S.reds = []; S.perks = []; S.groups = []; S.admin = false; S.adm = null; closeSignup(); hideBubble(true); emitChange(); }
  /* 登入後：讀自己的會員資料；沒有＝第一次登入 → 註冊畫面 */
  function loadAll(first) {
    if (!signedIn()) return Promise.resolve();
    var me = uid();
    return BE.getProfile(me).then(function (p) {
      if (uid() !== me) return;
      S.profile = p; S.loadErr = '';
      if (p) { S.profs[me] = p; if (p.avatarOn && p.avatar) ls(LS_AV, { uid: me, av: p.avatar }); closeSignup(); return refreshSocial(); }
      if (first) openSignup();
    }, function (e) { S.loadErr = errText(e); }).then(emitChange);
  }
  function refreshSocial() {
    if (!hasProfile()) return Promise.resolve();
    var me = uid();
    return Promise.all([
      BE.friendships().then(function (docs) { S.friends = friendView(docs, me); }).catch(function () {}),
      BE.sharesToMe().then(function (a) { S.toMe = a.sort(function (x, y) { return y.createdMs - x.createdMs; }); }).catch(function () {}),
      BE.myShares().then(function (a) { S.mine = a.sort(function (x, y) { return y.createdMs - x.createdMs; }); }).catch(function () {}),
      BE.isAdmin().then(function (a) { S.admin = a; }).catch(function () { S.admin = false; }),
      loadPerks()
    ]).then(function () {
      var f = S.friends, us = [];
      f.friends.concat(f.incoming, f.outgoing).forEach(function (x) { us.push(x.uid); });
      S.mine.forEach(function (s) { (s.to || []).forEach(function (u) { us.push(u); }); });
      S.toMe.forEach(function (s) { us.push(s.owner); });
      return loadProfiles(us);
    }).then(function () { emitChange(); if (S.admin && S.adm) return loadAdmin(); });
  }
  function loadPerks() {
    return Promise.all([
      BE.myRedemptions().then(function (reds) {
        var by = {};
        return Promise.all(reds.filter(function (r) { return r.status === 'granted'; }).map(function (r) { return BE.getPerks(r.code).then(function (p) { by[r.code] = p; }, function () {}); }))
          .then(function () { S.reds = reds; S.perks = perksOf(reds, by); });
      }).catch(function () {}),
      BE.myRole().then(function (r) { S.groups = (r && r.groups) || []; }).catch(function () { S.groups = []; })
    ]).then(function () { try { B.dispatchEvent(new CustomEvent('wr-perks', { detail: { perks: S.perks.slice(), groups: S.groups.slice() } })); } catch (e) {} });
  }

  // ---------- 頭像：裁成正方形 → 256px → JPEG（約 20–30KB） ----------
  function makeAvatar(file) {
    return new Promise(function (res, rej) {
      if (!file || (file.type && !/^image\//.test(file.type))) return rej(new Error(wrT('member.this_isnt_an_image')));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h); if (!s) throw new Error(wrT('member.couldnt_read_the_image'));
          var out = null;
          [256, 224, 192, 160].some(function (px) {
            var c = D.createElement('canvas'); c.width = c.height = px; var g = c.getContext('2d');
            g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
            g.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, px, px);
            return [0.82, 0.74, 0.66, 0.56, 0.46].some(function (qv) { var u = c.toDataURL('image/jpeg', qv); if (u.length <= 40000) { out = u; return true; } return false; });
          });
          URL.revokeObjectURL(url);
          if (!out || !avatarOk(out)) return rej(new Error(wrT('member.couldnt_shrink_the_photo_please')));
          res(out);
        } catch (e) { URL.revokeObjectURL(url); rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error(wrT('member.couldnt_read_this_photo_convert'))); };
      img.src = url;
    });
  }
  var pickHook = null; // e2e：直接給檔案
  function pickImage() {
    if (pickHook) return pickHook().then(makeAvatar);
    return new Promise(function (res, rej) {
      var i = D.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.style.display = 'none'; i.id = 'mbPick';
      i.onchange = function () { var f = i.files && i.files[0]; i.remove(); if (!f) return rej(new Error('cancel')); makeAvatar(f).then(res, rej); };
      D.body.appendChild(i); i.click();
    });
  }
  function avHTML(p, cls, me) { // 頭像關掉＝什麼都不畫（沒有框、沒有字母）
    if (!p || !p.avatarOn || !p.avatar || !avatarOk(p.avatar)) return '';
    return '<span class="' + (cls || 'mb-av') + '" style="background-image:url(&quot;' + esc(p.avatar) + '&quot;)"' + (me ? '' : ' aria-hidden="true"') + '></span>';
  }
  function who(u) { var p = profOf(u); return p ? p.mid : wrT('member.deleted_member'); }
  function whoHTML(u) { var p = profOf(u); return '<span class="mb-who">' + avHTML(p, 'mb-av sm') + '<b>' + esc(p ? p.mid : wrT('member.deleted_member')) + '</b></span>'; }

  // ---------- 1) 註冊畫面（第一次登入） ----------
  var su = null;
  function openSignup() {
    if (su || !signedIn()) return;
    S.signupOpen = true;
    var u = S.user || {}, st = { av: '', avOn: false, chk: null, seq: 0, busy: false, err: '' };
    var el = D.createElement('div'); el.className = 'su'; el.id = 'wrSignup'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'suH');
    el.innerHTML = wrT('member.cancel_sign_in_first_sign', [ICON.g, esc(u.name || wrT('app.signed_in')), esc(u.email || ''), ICON.cam, ICON.noav, ICON.re]);
    D.body.appendChild(el); su = el; B.classList.add('su-open');
    var inp = $('suMid');
    function setAv(on, data) {
      if (data !== undefined) st.av = data || '';
      st.avOn = !!on && !!st.av;
      $('suUp').classList.toggle('on', st.avOn); $('suNo').classList.toggle('on', !st.avOn);
      $('suUp').setAttribute('aria-checked', st.avOn ? 'true' : 'false'); $('suNo').setAttribute('aria-checked', st.avOn ? 'false' : 'true');
      $('suPv').hidden = !st.avOn; $('suNoTx').hidden = st.avOn;
      if (st.avOn) $('suRing').style.backgroundImage = 'url("' + st.av + '")';
    }
    function pick() { pickImage().then(function (d) { setAv(true, d); }, function (e) { if (e && e.message !== 'cancel') toast(e.message, 3200); }); }
    $('suUp').onclick = function () { if (st.av) setAv(true); else pick(); };
    $('suRe').onclick = pick;
    $('suNo').onclick = function () { setAv(false); };
    $('suPriv').onclick = function (e) { e.preventDefault(); openPrivacy(); };
    $('suCancel').onclick = function () { closeSignup(); try { if (!mocked) root.WRCloud.signOut(); else root.WRMember._mock(BE, null); } catch (e) {} toast(wrT('member.sign_in_cancelled_records_are')); };
    function paint() {
      var v = inp.value, c = midCheck(v), box = $('suInBox'), msg = $('suMsg'), bad = !!v && (!c.ok || st.chk === 'taken');
      $('suLen').textContent = v.length + '/20';
      var R = { len: c.lenOk, chars: c.charsOk, uniq: st.chk === 'ok' };
      $('suRules').querySelectorAll('li').forEach(function (li) { var k = li.dataset.r; li.classList.toggle('good', !!R[k]); li.classList.toggle('bad', !!v && !R[k] && (k !== 'uniq' || st.chk === 'taken')); });
      var ok = c.ok && st.chk === 'ok';
      box.className = 'su-in' + (ok ? ' ok' : bad ? ' bad' : '');
      $('suTick').textContent = ok ? '✓' : bad ? '!' : '';
      msg.className = 'su-ok' + (ok ? '' : ' warn');
      msg.textContent = !v ? '' : !c.ok ? c.msg : st.chk === 'checking' ? wrT('member.checking') : st.chk === 'taken' ? wrT('member.already_taken_try_another') : st.chk === 'err' ? wrT('member.couldnt_check', [st.err]) : st.chk === 'ok' ? wrT('member.available') : '';
      $('suGo').disabled = !ok || st.busy;
    }
    var tmr = 0;
    inp.oninput = function () {
      var v = inp.value; st.chk = null; clearTimeout(tmr); var my = ++st.seq;
      if (midCheck(v).ok) {
        st.chk = 'checking';
        tmr = setTimeout(function () {
          BE.nameOwner(v.toLowerCase()).then(function (o) { if (my !== st.seq) return; st.chk = !o || o === uid() ? 'ok' : 'taken'; paint(); }, function (e) { if (my !== st.seq) return; st.chk = 'err'; st.err = errText(e); paint(); });
        }, 320);
      }
      paint();
    };
    inp.onkeydown = function (e) { if (e.key === 'Enter' && !$('suGo').disabled) $('suGo').click(); };
    $('suGo').onclick = function () {
      var v = inp.value; if (!midCheck(v).ok || st.busy) return;
      st.busy = true; $('suGo').textContent = wrT('member.creating'); paint();
      BE.createProfile({ mid: v, avatarOn: st.avOn, avatar: st.avOn ? st.av : '' }).then(function () {
        if (st.avOn) ls(LS_AV, { uid: uid(), av: st.av });
        toast(wrT('member.welcome_your_member_profile_is', [v]), 3000);
        closeSignup(); return loadAll(false);
      }).catch(function (e) {
        st.busy = false; if ($('suGo')) $('suGo').textContent = wrT('member.sign_up');
        if (errCode(e) === 'permission-denied') { st.chk = 'taken'; toast(wrT('member.that_id_was_just_taken'), 3200); } else toast(wrT('member.couldnt_create', [errText(e)]), 3600);
        if (su) paint();
      });
    };
    paint(); setTimeout(function () { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 60);
  }
  function closeSignup() { if (su) { su.remove(); su = null; } S.signupOpen = false; B.classList.remove('su-open'); }

  // ---------- 2) 標題列左上角：頭像＋會員 ID ----------
  function renderHeader() {
    var hdr = D.querySelector('header'), title = hdr && hdr.querySelector('.title'); if (!title) return;
    var chip = $('mhChip'), p = hasProfile() ? S.profile : null;
    if (!p) { if (chip) chip.remove(); title.hidden = false; B.classList.remove('has-member'); return; }
    if (!chip) { chip = D.createElement('button'); chip.type = 'button'; chip.id = 'mhChip'; chip.className = 'mh-chip'; chip.setAttribute('data-me', ''); title.parentNode.insertBefore(chip, title); }
    var ver = String(app().version || '').replace(/^v(\d+)\.(\d+)\.0$/, 'v$1.$2');
    chip.innerHTML = avHTML(p, 'mh-av', true) + '<span class="mh-t"><b><span class="mh-id">' + esc(p.mid) + '</span>' + ICON.hchev + '</b><small>WRbeta<i>beta ' + esc(ver) + '</i></small></span><span class="mb-badge" hidden></span>';
    chip.setAttribute('aria-label', wrT('member.member_double_tap_for_settings', [p.mid]));
    title.hidden = true; B.classList.add('has-member');
  }

  // ---------- 3) 帳號頁：身分卡、會員資料、好友、分享、管理員 ----------
  function perkName(k) { return { ghost: wrT('app.ghost'), pro: '⭐ Pro', referee: wrT('member.judge_2'), coach: wrT('member.coach_2'), vip: '💎 VIP' }[k] || '🔓 ' + k; }
  function identityHTML(u) {
    var p = hasProfile() ? S.profile : null; if (!p) return null; u = u || S.user || {};
    var badges = S.groups.map(function (g) { return '<span class="mb-tag g">' + esc(GROUPS[g] || g) + '</span>'; }).concat(S.perks.map(function (k) { return '<span class="mb-tag">' + esc(perkName(k)) + '</span>'; })).join('');
    return wrT('member.member_id_signed_in_with', [p.avatarOn && p.avatar ? wrT('member.change', [esc(p.avatar)]) : '', esc(p.mid), esc((u.name || '') + (u.name && u.email ? '・' : '') + (u.email || '')), ICON.g, badges ? '<span class="mb-tags">' + badges + '</span>' : '']);
  }
  function bindIdentity(box) {
    var ch = box && box.querySelector('[data-act="mbAvChange"]');
    if (ch) ch.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); changeAvatar(); });
  }
  function show(id, on) { var c = $(id); if (c) c.hidden = !on; return c; }
  function renderCards() {
    var on = hasProfile();
    var m = show('mbMember', on || (signedIn() && S.profile !== undefined) || (signedIn() && !!S.loadErr));
    if (m) {
      if (on) {
        var p = S.profile, avOn = !!(p.avatarOn && p.avatar);
        m.innerHTML = wrT('member.member_profile_shown_in_forum', [esc(p.mid), ICON.chev, avOn ? wrT('member.forum_and_comments_show_avatar') : wrT('member.off_no_avatar_frame_id'), avOn ? wrT('member.change_2') : '', avOn ? wrT('member.on') : wrT('member.off'), avOn ? ' on' : '', avOn]);
        $('mbMidRow').onclick = changeMid;
        $('mbAvSw').onclick = function () { toggleAvatar(!avOn); };
        if ($('mbAvRe')) $('mbAvRe').onclick = changeAvatar;
      } else {
        m.innerHTML = wrT('member.member_profile', [S.loadErr ? wrT('member.couldnt_load_your_member_profile', [esc(S.loadErr)]) : wrT('member.no_member_profile_yet_member'), S.loadErr ? wrT('member.retry') : wrT('member.create_member_profile')]);
        $('mbSignupBtn').onclick = function () { if (S.loadErr) loadAll(true); else openSignup(); };
      }
    }
    renderFriends(on); renderShares(on); renderAdmin(on && S.admin);
  }
  function modal(html) { var bg = D.createElement('div'); bg.className = 'modal-bg mb-modal-bg'; bg.innerHTML = html; D.body.appendChild(bg); return bg; }
  function changeMid() {
    var p = S.profile; if (!p) return;
    var bg = modal(wrT('member.change_member_id_3_20'));
    var inp = bg.querySelector('#mbMidIn'), msg = bg.querySelector('#mbMidMsg'), yes = bg.querySelector('.yes'), seq = 0, t = 0;
    inp.value = p.mid;
    inp.oninput = function () {
      var v = inp.value, c = midCheck(v), my = ++seq; yes.disabled = true; clearTimeout(t);
      if (!c.ok) { msg.textContent = c.msg; return; }
      if (v === p.mid) { msg.textContent = wrT('member.thats_your_current_id'); return; }
      if (v.toLowerCase() === p.midLower) { msg.textContent = wrT('member.case_change_only'); yes.disabled = false; return; }
      msg.textContent = wrT('member.checking');
      t = setTimeout(function () { BE.nameOwner(v.toLowerCase()).then(function (o) { if (my !== seq) return; if (o && o !== uid()) msg.textContent = wrT('member.already_taken'); else { msg.textContent = wrT('member.available'); yes.disabled = false; } }, function (e) { msg.textContent = '⚠️ ' + errText(e); }); }, 300);
    };
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    yes.onclick = function () {
      var v = inp.value; yes.disabled = true;
      BE.updateProfile(p, { mid: v, avatarOn: p.avatarOn, avatar: p.avatar }).then(function () { bg.remove(); toast(wrT('member.member_id_changed_to', [v])); return loadAll(false); })
        .catch(function (e) { yes.disabled = false; msg.textContent = errCode(e) === 'permission-denied' ? wrT('member.just_taken_by_someone_else') : '⚠️ ' + errText(e); });
    };
    setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) {} }, 0);
  }
  function saveAvatar(on, data) {
    var p = S.profile; if (!p) return Promise.resolve();
    return BE.updateProfile(p, { mid: p.mid, avatarOn: on, avatar: on ? data : '' }).then(function () {
      if (on) ls(LS_AV, { uid: uid(), av: data });
      toast(on ? wrT('member.avatar_updated') : wrT('member.avatar_off_member_id_only')); return loadAll(false);
    }, function (e) { toast(wrT('member.avatar_not_updated', [errText(e)]), 3600); });
  }
  function changeAvatar() { pickImage().then(function (d) { return saveAvatar(true, d); }, function (e) { if (e && e.message !== 'cancel') toast(e.message, 3200); }); }
  function toggleAvatar(on) {
    if (!on) return saveAvatar(false, '');
    var keep = ls(LS_AV); if (keep && keep.uid === uid() && avatarOk(keep.av)) return saveAvatar(true, keep.av);
    changeAvatar();
  }

  // 好友
  function renderFriends(on) {
    var c = show('mbFriends', on); if (!c || !on) return;
    var f = S.friends, n = f.incoming.length;
    var h = wrT('member.friends_invite', [f.friends.length, n ? wrT('member.new_invites', [n]) : '']);
    if (f.incoming.length) h += wrT('member.invites_received', [f.incoming.map(function (x) { return wrT('member.accept_decline', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    if (f.outgoing.length) h += wrT('member.sent_waiting_for_them_to', [f.outgoing.map(function (x) { return wrT('member.cancel', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    h += wrT('member.friend_list', [f.friends.length ? f.friends.map(function (x) { return wrT('member.remove', [esc(x.id), esc(x.uid), whoHTML(x.uid), esc(who(x.uid))]); }).join('') : wrT('member.no_friends_yet_enter_someones')]);
    c.innerHTML = h;
    var inp = $('mbFriendIn');
    $('mbFriendGo').onclick = function () { addFriend(inp.value.trim()); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') addFriend(inp.value.trim()); };
    c.querySelectorAll('.mb-fr [data-a]').forEach(function (b) {
      var row = b.closest('.mb-fr'), pid = row.dataset.pid;
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'acc') act(BE.acceptFriend(pid), wrT('member.youre_now_friends'));
        else if (a === 'dec') act(BE.deleteFriend(pid), wrT('member.invite_declined'));
        else if (a === 'can') act(BE.deleteFriend(pid), wrT('member.invite_cancelled'));
        else if (a === 'rm') ask(wrT('member.remove_friend_records_you_shared', [who(row.dataset.uid)]), function () { act(removeFriend(pid, row.dataset.uid), wrT('member.friend_removed')); }, null, { yes: wrT('app.delete'), danger: true });
      };
    });
  }
  function act(p, ok) { return p.then(function () { if (ok) toast(ok); return refreshSocial(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); return refreshSocial(); }); }
  function addFriend(mid) {
    var c = midCheck(mid); if (!c.ok) { toast(c.msg || wrT('member.invalid_member_id_format')); return Promise.resolve(); }
    if (S.profile && mid.toLowerCase() === S.profile.midLower) { toast(wrT('member.thats_your_own_id')); return Promise.resolve(); }
    return BE.nameOwner(mid.toLowerCase()).then(function (o) {
      if (!o) { toast(wrT('member.member_not_found', [mid])); return; }
      var pid = pairId(uid(), o);
      return BE.getFriendship(pid).then(function (x) {
        if (x && x.status === 'accepted') { toast(wrT('member.youre_already_friends')); return; }
        if (x && x.to === uid()) return act(BE.acceptFriend(pid), wrT('member.they_had_invited_you_too'));
        if (x) { toast(wrT('member.already_invited_waiting_for_them')); return; }
        return act(BE.requestFriend(o), wrT('member.invite_sent_to_theyll_see', [mid])).then(function () { var i = $('mbFriendIn'); if (i) i.value = ''; });
      });
    }).catch(function (e) { toast(wrT('member.invite_failed', [errText(e)]), 3600); });
  }
  /* 刪好友：刪 friendships 文件，順便收回「我分享給他的」、把自己從「他分享給我的」移除 */
  function removeFriend(pid, other) {
    return BE.deleteFriend(pid).then(function () {
      var jobs = [];
      S.mine.forEach(function (s) { if ((s.to || []).indexOf(other) >= 0) jobs.push(BE.setShareTo(s.id, s.to.filter(function (u) { return u !== other; }))); });
      S.toMe.forEach(function (s) { if (s.owner === other) jobs.push(BE.leaveShare(s.id, (s.to || []).filter(function (u) { return u !== uid(); }))); });
      return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
    });
  }

  // 分享
  function friendsList() { return S.friends.friends.map(function (x) { return x.uid; }); }
  function sharesOf(recId) { return S.mine.filter(function (s) { return s.recId === String(recId); }); }
  function kindName(s) { return s.kind === 'analysis' ? wrT('app.analysis_2') : wrT('app.call_2'); }
  function fmtDate(iso) { var d = new Date(iso); if (!isFinite(d)) return ''; try { return new Intl.DateTimeFormat(wrT.locale(), { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch (e) { return String(iso).slice(0, 10); } }
  function renderShares(on) {
    var c = show('mbShares', on); if (!c || !on) return;
    var seen = ls(LS_SEEN) || {}, h = wrT('member.shared_with_me_read_only');
    h += S.toMe.length ? S.toMe.map(function (s) {
      return wrT('member.shared_by', [esc(s.id), !seen[s.id] ? wrT('member.x') : '', esc(s.name || kindName(s)), kindName(s), esc(s.ownerMid), esc(fmtDate(s.recCreated)), ICON.chev]);
    }).join('') : wrT('member.no_friends_have_shared_records');
    h += wrT('member.shared_by_me_can_be');
    h += S.mine.length ? S.mine.map(function (s) {
      return wrT('member.withdraw_all', [esc(s.id), esc(s.name || kindName(s)), esc(fmtDate(s.recCreated)), (s.to || []).map(function (u) { return wrT('member.x_2', [esc(who(u)), esc(u), esc(who(u))]); }).join('')]);
    }).join('') : wrT('member.on_the_records_page_tap');
    c.innerHTML = h;
    c.querySelectorAll('.mb-sh').forEach(function (b) { b.onclick = function () { openShared(b.dataset.sid); }; });
    c.querySelectorAll('.mb-mine').forEach(function (row) {
      var s = S.mine.filter(function (x) { return x.id === row.dataset.sid; })[0]; if (!s) return;
      row.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { act(BE.setShareTo(s.id, s.to.filter(function (u) { return u !== b.dataset.u; })), wrT('member.withdrawn')); }; });
      row.querySelector('[data-all]').onclick = function () { ask(wrT('member.withdraw_this_share_your_friend'), function () { act(BE.deleteShare(s.id), wrT('member.all_withdrawn')); }, null, { yes: wrT('member.withdraw') }); };
    });
  }
  /* 唯讀檢視：用紀錄碼還原，畫在 ISSF 靶面上（不存進自己的紀錄） */
  function closeView(bg) { bg.remove(); if (!D.querySelector('.mb-view')) B.classList.remove('mb-view-open'); }
  function openShared(sid) {
    var s = S.toMe.filter(function (x) { return x.id === sid; })[0]; if (!s) return;
    var seen = ls(LS_SEEN) || {}; seen[sid] = 1; ls(LS_SEEN, seen); renderBadges();
    var Code = root.BMCode, rec = null; try { rec = Code && Code.decode(s.code).records[0]; } catch (e) {}
    var bg = D.createElement('div'); bg.className = 'mb-view mb-shared'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', wrT('member.shared_record'));
    bg.innerHTML = wrT('member.back_read_only_shared_by', [whoHTML(s.owner), esc(s.name || kindName(s)), kindName(s), esc(fmtDate(s.recCreated)), rec ? '<div class="svgwrap mb-view-tg"><svg class="target mb-ro-svg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="mb-view-meta"></div>' : wrT('member.this_record_code_cant_be')]);
    D.body.appendChild(bg); B.classList.add('mb-view-open');
    if (rec) { try { var A = app(); A.drawRecord(bg.querySelector('svg'), rec); bg.querySelector('.mb-view-meta').innerHTML = A.recMetaHTML(rec); } catch (e) { bg.querySelector('.mb-view-meta').textContent = wrT('member.couldnt_draw', [e.message]); } }
    bg.querySelector('.x').onclick = function () { closeView(bg); renderCards(); };
  }
  /* 紀錄頁「分享給好友」：選好友（最多 5 位） */
  function shareRecord(s) {
    if (!hasProfile()) { toast(wrT('member.sign_in_and_create_a')); return; }
    var fr = friendsList(); if (!fr.length) { toast(wrT('member.no_friends_yet_add_friends'), 3200); return; }
    var Code = root.BMCode, code = null; try { code = Code.encode(s); } catch (e) {}
    if (!code) { toast(wrT('member.this_record_has_no_shots')); return; }
    if (code.length > 20000) { toast(wrT('member.this_record_is_too_large')); return; }
    var already = {}; sharesOf(s.id).forEach(function (x) { (x.to || []).forEach(function (u) { already[u] = 1; }); });
    var bg = modal(wrT('member.share_with_friends_read_only', [SHARE_MAX, fr.map(function (u) { return '<label class="mb-pk' + (already[u] ? ' dis' : '') + '"><input type="checkbox" value="' + esc(u) + '"' + (already[u] ? ' disabled' : '') + '>' + whoHTML(u) + (already[u] ? wrT('member.shared') : '') + '</label>'; }).join('')]));
    var yes = bg.querySelector('.yes'), boxes = [].slice.call(bg.querySelectorAll('input[type=checkbox]'));
    function sel() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
    boxes.forEach(function (b) { b.onchange = function () { if (sel().length > SHARE_MAX) { b.checked = false; toast(wrT('member.up_to_at_a_time', [SHARE_MAX])); } var n = sel().length; yes.disabled = !n; yes.textContent = n ? wrT('member.share_with', [n]) : wrT('member.share'); }; });
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    yes.onclick = function () {
      var to = sel(); if (!to.length) return; yes.disabled = true;
      var sid = (String(uid()).slice(0, 10) + '_' + String(s.id).replace(/[^A-Za-z0-9_-]/g, '').slice(-24) + '_' + Date.now().toString(36)).slice(0, 64);
      BE.createShare(sid, { ownerMid: S.profile.mid, to: to, recId: String(s.id).slice(0, 64), kind: s.kind === 'analysis' ? 'analysis' : 'forecast', targetId: String(s.targetId || 'ap10').slice(0, 16), name: String((s.name && s.name.trim()) || '').slice(0, 120), recCreated: String(s.created || '').slice(0, 40), code: code })
        .then(function () { bg.remove(); toast(wrT('member.shared_with', [to.map(who).join(wrT('core.x_3'))])); return refreshSocial(); }, function (e) { yes.disabled = false; toast(wrT('member.share_failed', [errText(e)]), 3600); });
    };
  }

  // ---------- 4) 未讀數字（打開 App 時；沒有推播） ----------
  function counts() { var seen = ls(LS_SEEN) || {}; return { req: S.friends.incoming.length, sh: S.toMe.filter(function (s) { return !seen[s.id]; }).length }; }
  function renderBadges() {
    var c = hasProfile() ? counts() : { req: 0, sh: 0 }, n = c.req + c.sh;
    [['#mhChip', 0], ['#stTabAcct', 1], ['#wrNav [data-tab="about"]', 1], ['#liteMoreBtn', 1]].forEach(function (x) {
      var host = D.querySelector(x[0]); if (!host) return;
      var b = host.querySelector(':scope > .mb-badge');
      if (!b) { b = D.createElement('span'); b.className = 'mb-badge'; host.appendChild(b); }
      b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); b.setAttribute('aria-label', wrT('member.new_notifications', [n]));
    });
  }

  // ---------- 5) 漫畫框：點一下出現、點兩下到帳號；可以拖到「設定/說明」 ----------
  var bub = null, bubT = 0, lastTap = 0, lastEl = null, drag = null;
  function goAcct() {
    hideBubble(true); var A = app();
    try { A.showTab('about'); if (A.stSub) A.stSub.set('acct'); root.scrollTo(0, 0); } catch (e) {}
  }
  function ensureBubble() {
    if (bub) return bub;
    bub = D.createElement('div'); bub.id = 'mbBubble'; bub.className = 'mb-bub'; bub.hidden = true; bub.setAttribute('role', 'status'); bub.setAttribute('aria-live', 'polite');
    bub.innerHTML = wrT('member.double_tap_to_open_your');
    D.body.appendChild(bub);
    bub.addEventListener('pointerdown', bubDown);
    bub.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return bub;
  }
  function placeBubble(anchor) {
    var r = anchor.getBoundingClientRect(), b = ensureBubble();
    b.hidden = false; b.style.translate = ''; b.style.left = '0px'; b.style.top = '0px';
    var bw = b.offsetWidth || 190, bh = b.offsetHeight || 48, ax = r.left + Math.min(r.width, 64) / 2;
    var left = Math.max(8, Math.min(innerWidth - bw - 8, ax - 28)), below = r.bottom + 14 + bh < innerHeight - 70;
    var tail = Math.max(16, Math.min(bw - 22, ax - left));
    b.style.left = left + 'px'; b.style.top = (below ? r.bottom + 12 : r.top - 12 - bh) + 'px';
    b.style.setProperty('--tail', tail + 'px'); b.classList.toggle('up', !below); b.style.transformOrigin = tail + 'px ' + (below ? '0' : '100%');
  }
  function replay(cls) { var b = bub; if (!b) return; ['pop', 'boing', 'out', 'press', 'gulp'].forEach(function (c) { b.classList.remove(c); }); void b.offsetWidth; if (cls) b.classList.add(cls); }
  function showBubble(anchor) { placeBubble(anchor); replay(anim() ? 'pop' : null); bub.classList.add('show'); armHide(); }
  function armHide(ms) { clearTimeout(bubT); bubT = setTimeout(function () { if (!drag) hideBubble(); }, ms || 2500); }
  function hideBubble(now) {
    clearTimeout(bubT); if (!bub || bub.hidden) return;
    if (now || !anim()) { bub.hidden = true; bub.classList.remove('show'); replay(null); return; }
    replay('out'); setTimeout(function () { if (bub && bub.classList.contains('out')) { bub.hidden = true; bub.classList.remove('show', 'out'); } }, 320);
  }
  D.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-me]'); if (!t || (e.target.closest('[data-act]'))) return;
    e.preventDefault(); e.stopPropagation();
    var now = Date.now();
    if (now - lastTap < 450 && lastEl === t) { lastTap = 0; goAcct(); return; }
    lastTap = now; lastEl = t; showBubble(t);
  }, true);
  D.addEventListener('dblclick', function (e) { var t = e.target.closest && e.target.closest('[data-me]'); if (t) { e.preventDefault(); goAcct(); } }, true);
  D.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-me][role=button]')) e.target.click(); });
  // 按下去軟軟凹下、放開 Q 彈回來；拖曳＝跟著手指；拖到「設定/說明」＝作弊碼
  function dropTarget(x, y) {
    var els = D.elementsFromPoint ? D.elementsFromPoint(x, y) : [D.elementFromPoint(x, y)];
    for (var i = 0; i < els.length; i++) {
      var el = els[i]; if (!el || el === bub || (bub && bub.contains(el))) continue;
      var t = el.closest && el.closest('#wrNav [data-tab="about"],.navc-dots [data-tab="about"],#liteMoreBtn');
      if (t && t.getBoundingClientRect().width > 0) return t;
    }
    return null;
  }
  function bubDown(e) {
    if (e.button > 0 || drag) return;
    e.preventDefault(); clearTimeout(bubT);
    try { bub.setPointerCapture(e.pointerId); } catch (x) {}
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, hot: null };
    replay(null); bub.classList.add('press');
    bub.addEventListener('pointermove', bubMove); bub.addEventListener('pointerup', bubUp); bub.addEventListener('pointercancel', bubUp);
  }
  function bubMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 7) {
      drag.moved = true; bub.classList.remove('press'); bub.classList.add('drag'); B.classList.add('mb-dragging');
      var N = app().nav; try { if (N) { if (N.style === 'b') N.openFab(true); else N.reveal(); } } catch (x) {}
    }
    if (!drag.moved) return;
    bub.style.translate = dx + 'px ' + dy + 'px';
    var t = dropTarget(e.clientX, e.clientY);
    if (t !== drag.hot) { if (drag.hot) drag.hot.classList.remove('mb-drop-hot'); if (t) t.classList.add('mb-drop-hot'); drag.hot = t; bub.classList.toggle('hot', !!t); }
  }
  function bubUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    bub.removeEventListener('pointermove', bubMove); bub.removeEventListener('pointerup', bubUp); bub.removeEventListener('pointercancel', bubUp);
    bub.classList.remove('press', 'drag', 'hot'); B.classList.remove('mb-dragging');
    if (d.hot) d.hot.classList.remove('mb-drop-hot');
    var N = app().nav;
    if (d.moved && d.hot && e.type === 'pointerup') { // 丟到「設定/說明」→ 作弊碼
      replay(anim() ? 'gulp' : null);
      setTimeout(function () { if (bub) { bub.hidden = true; bub.classList.remove('show', 'gulp'); bub.style.translate = ''; } }, anim() ? 280 : 0);
      try { if (N && N.style === 'b') N.openFab(false); } catch (x) {}
      openCheat(); return;
    }
    if (d.moved) { // 彈回原位
      bub.classList.add('home'); bub.style.translate = '';
      setTimeout(function () { if (bub) bub.classList.remove('home'); }, 560);
      try { if (N && N.style === 'b') N.openFab(false); } catch (x) {}
    }
    replay(anim() ? 'boing' : null); armHide();
  }

  // ---------- 6) 作弊碼 ----------
  var RATE_MAX = 5, RATE_WIN = 10 * 60 * 1000;
  var FAILS = [wrT('member.nope_think_again'), wrT('member.heh_thats_not_the_password'), wrT('member.so_close_no_idea_actually'), wrT('member.wrong_password_or_this_password'), wrT('member.beep_not_this_one')];
  function openCheat() {
    if (D.querySelector('.mb-cheat')) return;
    var bg = modal(wrT('member.enter_cheat_code_heh_you'));
    bg.classList.add('mb-cheat-bg');
    var inp = bg.querySelector('#mbCheatIn'), msg = bg.querySelector('#mbCheatMsg'), yes = bg.querySelector('.yes'), card = bg.querySelector('.mb-cheat');
    if (anim()) card.classList.add('pop');
    function say(t, cls) { msg.textContent = t; msg.className = 'mb-cheat-msg ' + (cls || ''); if (cls === 'bad' && anim()) { card.classList.remove('shake', 'pop'); void card.offsetWidth; card.classList.add('shake'); } }
    if (!hasProfile()) { say(signedIn() ? wrT('member.create_a_member_profile_first') : wrT('member.sign_in_as_a_member'), 'info'); inp.disabled = true; yes.disabled = true; }
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    function go() {
      var raw = inp.value; if (!normCode(raw)) { say(wrT('member.enter_the_code_first'), 'info'); return; }
      var r = rateOk(ls(LS_TRIES) || [], Date.now(), RATE_MAX, RATE_WIN);
      if (!r.ok) { say(wrT('member.too_many_tries_take_a', [Math.ceil(r.waitMs / 60000)]), 'bad'); return; }
      r.recent.push(Date.now()); ls(LS_TRIES, r.recent);
      yes.disabled = true; say(wrT('member.verifying'), 'info');
      redeem(raw).then(function (res) {
        yes.disabled = false;
        if (res.status === 'granted') { say('🎉 ' + (res.again ? wrT('member.already_unlocked') : wrT('member.unlocked')) + (res.perks.length ? res.perks.map(perkName).join(wrT('core.x_3')) : ''), 'good'); ls(LS_TRIES, []); }
        else if (res.status === 'pending') say(wrT('member.request_sent_it_takes_effect'), 'good');
        else if (res.status === 'rejected') say(wrT('member.the_request_for_this_code'), 'bad');
        else if (res.status === 'revoked') say(wrT('member.access_from_this_code_has'), 'bad');
        else say(FAILS[Math.floor(Math.random() * FAILS.length)], 'bad');
      }, function (e) { yes.disabled = false; say('⚠️ ' + errText(e), 'bad'); });
    }
    yes.onclick = go; inp.onkeydown = function (e) { if (e.key === 'Enter') go(); else if (e.key === 'Escape') bg.remove(); };
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 80);
  }
  /* 兌換：先看有沒有兌換過；再試「直接生效」，不行再試「申請中」；都不行＝密碼錯或不是給你的（規則不告訴你是哪一個） */
  function redeem(raw) {
    return codeHash(raw).then(function (h) {
      return BE.getRedemption(h).then(function (old) {
        if (old) return old.status === 'granted' ? BE.getPerks(h).catch(function () { return []; }).then(function (p) { return { status: 'granted', perks: p, again: true }; }) : { status: old.status, perks: [] };
        var mid = S.profile.mid;
        return BE.redeem(h, 'granted', mid).then(function () {
          return BE.getPerks(h).catch(function () { return []; }).then(function (p) { return loadPerks().then(function () { emitChange(); return { status: 'granted', perks: p }; }); });
        }, function (e) {
          if (errCode(e) !== 'permission-denied') throw e;
          return BE.redeem(h, 'pending', mid).then(function () { return loadPerks().then(function () { emitChange(); return { status: 'pending', perks: [] }; }); },
            function (e2) { if (errCode(e2) !== 'permission-denied') throw e2; return { status: 'wrong', perks: [] }; });
        });
      });
    });
  }

  // ---------- 7) 管理員畫面（admins/{uid} 存在才顯示） ----------
  function loadAdmin() {
    if (!S.admin) return Promise.resolve();
    S.adm = S.adm || { codes: [], pending: [], granted: [], roles: [] };
    return Promise.all([
      BE.listCodes().then(function (a) { S.adm.codes = a.sort(function (x, y) { return y.createdMs - x.createdMs; }); }),
      BE.listRedemptions('pending').then(function (a) { S.adm.pending = a; }),
      BE.listRedemptions('granted').then(function (a) { S.adm.granted = a; }),
      BE.listRoles().then(function (a) { S.adm.roles = a; }),
      BE.listProfiles().then(function (a) { S.adm.people = a.sort(function (x, y) { return String(x.mid).localeCompare(String(y.mid)); }); }),
      BE.listSuspended().then(function (a) { S.adm.held = a; })
    ]).catch(function (e) { toast(wrT('member.couldnt_load_admin_data', [errText(e)]), 3600); }).then(function () { renderAdmin(true); });
  }
  function codeLabel(h) { var c = S.adm && S.adm.codes.filter(function (x) { return x.id === h; })[0]; return c ? (c.label || wrT('member.no_note')) : String(h).slice(0, 8) + '…'; }
  function audText(a) { if (!a) return ''; return a.type === 'all' ? wrT('member.everyone') : a.type === 'users' ? wrT('member.specific', [(a.mids || []).join(wrT('core.x_3'))]) : wrT('member.groups', [(a.groups || []).map(function (g) { return GROUPS[g] || g; }).join(wrT('core.x_3'))]); }
  function renderAdmin(on) {
    var c = show('mbAdmin', on); if (!c || !on) return;
    if (!S.adm) { c.innerHTML = wrT('member.admin_only_you_can_see'); $('mbAdmOpen').onclick = function () { S.adm = { codes: [], pending: [], granted: [], roles: [] }; loadAdmin(); }; return; }
    var A = S.adm, gchk = function (name) { return Object.keys(GROUPS).map(function (g) { return '<label class="mb-ck"><input type="checkbox" name="' + name + '" value="' + g + '">' + GROUPS[g] + '</label>'; }).join(''); };
    // v2.3.0：標題（🛠 管理員 · 只有你看得到 · 重新整理）放最上面，會員區塊接在標題下面
    var h = wrT('member.admin_only_you_can_see_2', [gchk('admG')]), cut = h.indexOf('</div>') + 6;
    h = h.slice(0, cut) + peopleHTML() + h.slice(cut);
    h += wrT('member.pending', [A.pending.length, A.pending.length ? A.pending.map(function (r) { return wrT('member.approve_reject', [esc(r.id), esc(r.mid), esc(codeLabel(r.code))]); }).join('') : wrT('member.no_pending_requests')]);
    h += wrT('member.cheat_codes', [A.codes.length, A.codes.length ? A.codes.map(function (x) { return wrT('member.delete', [esc(x.id), esc(x.label || wrT('member.no_note')), x.active ? '' : wrT('member.disabled'), esc((x.perks || []).join(', ')), esc(audText(x.audience)), x.needsApproval ? wrT('member.needs_approval') : '', x.active ? wrT('member.disable') : wrT('member.enable')]); }).join('') : wrT('member.no_cheat_codes_yet')]);
    h += wrT('member.active', [A.granted.length, A.granted.length ? A.granted.map(function (r) { return wrT('member.revoke', [esc(r.id), esc(r.mid), esc(codeLabel(r.code))]); }).join('') : wrT('member.nobody_has_redeemed_one_yet')]);
    h += wrT('member.groups_judges_coaches_member_id', [gchk('admR'), A.roles.length ? A.roles.map(function (r) { return '<div class="mb-fr"><span class="mb-sht"><b>' + esc(r.mid || r.id) + '</b><small>' + esc((r.groups || []).map(function (g) { return GROUPS[g] || g; }).join(wrT('core.x_3'))) + '</small></span></div>'; }).join('') : '']);
    c.innerHTML = h;
    $('mbAdmReload').onclick = loadAdmin;
    $('admAud').onchange = function () { $('admMidsRow').hidden = this.value !== 'users'; $('admGrpRow').hidden = this.value !== 'groups'; };
    $('admCreate').onclick = adminCreate;
    $('admRoleSave').onclick = adminRole;
    c.querySelectorAll('[data-rid] [data-d]').forEach(function (b) { b.onclick = function () { var rid = b.closest('[data-rid]').dataset.rid; BE.decide(rid, b.dataset.d).then(function () { toast({ granted: wrT('member.approved'), rejected: wrT('member.rejected'), revoked: wrT('member.withdrawn') }[b.dataset.d]); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); }); }; });
    c.querySelectorAll('.mb-code [data-c]').forEach(function (b) {
      var h2 = b.closest('.mb-code').dataset.h, x = A.codes.filter(function (y) { return y.id === h2; })[0];
      b.onclick = function () {
        if (b.dataset.c === 'tog') BE.setCodeActive(h2, !x.active).then(function () { toast(x.active ? wrT('member.disabled_2') : wrT('member.enabled')); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); });
        else ask(wrT('member.delete_cheat_code_people_who', [x.label || '']), function () { BE.deleteCode(h2).then(function () { toast(wrT('member.deleted')); loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); }); }, null, { yes: wrT('app.delete'), danger: true });
      };
    });
    c.querySelectorAll('.mb-person').forEach(function (row) { bindPerson(row); });
  }
  function peopleHTML() {
    var list = (S.adm && S.adm.people) || [], held = {};
    ((S.adm && S.adm.held) || []).forEach(function (x) { held[x.id] = true; });
    var rows = list.map(function (p) {
      var on = !!held[p.id];
      return '<div class="mb-fr mb-person" data-uid="' + esc(p.id) + '" data-low="' + esc(p.midLower || '') + '" data-held="' + (on ? '1' : '0') + '"><span class="mb-sht"><b>' + esc(p.mid) + '</b><small>' + esc(p.id) + (on ? ' · ' + esc(wrT('member.suspended_badge')) : '') + '</small></span>'
        + '<button type="button" data-act="hold">' + esc(wrT(on ? 'member.unsuspend' : 'member.suspend')) + '</button>'
        + '<input data-act="newid" maxlength="20" placeholder="' + esc(wrT('member.new_id')) + '" aria-label="' + esc(wrT('member.new_id')) + '">'
        + '<button type="button" data-act="id">' + esc(wrT('member.change_id')) + '</button>'
        + '<button type="button" data-act="shares">' + esc(wrT('member.revoke_shares')) + '</button>'
        + '<button type="button" data-act="wipe">' + esc(wrT('member.wipe_data')) + '</button></div>';
    }).join('');
    return '<details class="mb-adm" open><summary>' + esc(wrT('member.admin_people')) + '</summary><p class="mb-note">' + esc(wrT('member.admin_console_only')) + '</p>'
      + (rows || '<p>' + esc(wrT('member.admin_no_members')) + '</p>') + '</details>';
  }
  function bindPerson(row) {
    var uid = row.dataset.uid, low = row.dataset.low, mid = (row.querySelector('b') || {}).textContent || '';
    function fail(e) { toast(wrT('member.not_completed', [msgOf(e)]), 3600); }
    row.querySelector('[data-act=hold]').onclick = function () {
      var on = row.getAttribute('data-held') !== '1';
      ask(wrT(on ? 'member.suspend_confirm' : 'member.unsuspend_confirm', [mid]), function () {
        BE.setSuspended(uid, on).then(function () { toast(wrT(on ? 'member.suspended_ok' : 'member.unsuspended_ok')); return loadAdmin(); }, fail);
      }, null, { yes: wrT(on ? 'member.suspend' : 'member.unsuspend'), danger: on });
    };
    row.querySelector('[data-act=id]').onclick = function () {
      var v = row.querySelector('[data-act=newid]').value.trim();
      if (!midCheck(v).ok) { toast(wrT('member.invalid_member_id_format')); return; }
      BE.adminSetMid(uid, low, v).then(function () { toast(wrT('member.id_changed', [v])); return loadAdmin(); }, fail);
    };
    row.querySelector('[data-act=shares]').onclick = function () {
      ask(wrT('member.revoke_confirm', [mid]), function () {
        BE.revokeOwnedShares(uid).then(function (n) { toast(wrT('member.shares_revoked', [n])); return loadAdmin(); }, fail);
      }, null, { yes: wrT('member.revoke_shares'), danger: true });
    };
    row.querySelector('[data-act=wipe]').onclick = function () {
      ask(wrT('member.wipe_confirm', [mid]), function () {
        // v2.3.0：先停權再刪（不然對方手機還登入著，同步時會把本機紀錄又傳上來）；停權保留，之後可手動解除
        var gate = row.getAttribute('data-held') === '1' ? Promise.resolve() : BE.setSuspended(uid, true);
        gate.then(function () { return BE.adminWipe(uid); }).then(function () { toast(wrT('member.wiped'), 3600); return loadAdmin(); }, function (e) { fail(e); loadAdmin(); });
      }, null, { yes: wrT('app.delete'), danger: true });
    };
  }
  function checked(name) { return [].slice.call(D.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; }); }
  function resolveMids(mids) { return Promise.all(mids.map(function (m) { return BE.nameOwner(m.toLowerCase()).then(function (u) { return { mid: m, uid: u }; }); })); }
  function msgOf(e) { return e && e.message && !e.code ? e.message : errText(e); }
  function adminCreate() {
    var raw = $('admCode').value, perks = parsePerks($('admPerks').value), aud = $('admAud').value, mids = parseMids($('admMids').value), groups = checked('admG');
    if (normCode(raw).length < 3) { toast(wrT('member.the_code_needs_at_least')); return; }
    if (!perks.length) { toast(wrT('member.enter_at_least_one_perk')); return; }
    if (aud === 'users' && !mids.length) { toast(wrT('member.please_enter_a_member_id_2')); return; }
    if (aud === 'groups' && !groups.length) { toast(wrT('member.please_check_a_group')); return; }
    var btn = $('admCreate'); btn.disabled = true;
    Promise.all([codeHash(raw), aud === 'users' ? resolveMids(mids) : Promise.resolve([])]).then(function (r) {
      var h = r[0], miss = r[1].filter(function (x) { return !x.uid; });
      if (miss.length) throw { message: wrT('member.members_not_found', [miss.map(function (x) { return x.mid; }).join(wrT('core.x_3'))]) };
      return BE.getCode(h).then(function (old) {
        if (old) throw { message: wrT('member.this_code_already_exists', [old.label || wrT('member.no_note_2')]) };
        return BE.createCode(h, { perks: perks, audience: { type: aud, uids: r[1].map(function (x) { return x.uid; }), mids: r[1].map(function (x) { return x.mid; }), groups: aud === 'groups' ? groups : [] }, needsApproval: $('admApprove').checked, active: true, label: $('admLabel').value.trim().slice(0, 60) });
      });
    }).then(function () { toast(wrT('member.cheat_code_created_the_plain'), 3600); return loadAdmin(); }, function (e) { btn.disabled = false; toast(wrT('member.not_created', [msgOf(e)]), 3600); });
  }
  function adminRole() {
    var mid = $('admRoleMid').value.trim(), groups = checked('admR');
    if (!midCheck(mid).ok) { toast(wrT('member.invalid_member_id_format')); return; }
    BE.nameOwner(mid.toLowerCase()).then(function (u) {
      if (!u) throw { message: wrT('member.member_not_found', [mid]) };
      return BE.setRole(u, groups, mid);
    }).then(function () { toast(groups.length ? wrT('member.x_3', [mid, groups.map(function (g) { return GROUPS[g]; }).join(wrT('core.x_3'))]) : wrT('member.removed_s_groups', [mid])); return loadAdmin(); }, function (e) { toast(wrT('member.not_completed', [msgOf(e)]), 3600); });
  }

  // ---------- 8) 隱私權政策（內容在 privacy.html，App 內用同一份） ----------
  var PRIV_URL = 'https://whiterhapsody.github.io/WRbeta/' + (wrT.isEn() ? 'privacy-en.html' : 'privacy.html'); // v2.2.0：英文版
  var PRIV_FILE = wrT.isEn() ? 'privacy-en.html' : 'privacy.html';
  function openPrivacy() {
    if (D.querySelector('.mb-priv')) return;
    var bg = D.createElement('div'); bg.className = 'mb-view mb-priv'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', wrT('member.privacy_policy'));
    bg.innerHTML = wrT('member.back_open_in_browser_loading', [PRIV_URL]);
    D.body.appendChild(bg); B.classList.add('mb-view-open');
    bg.querySelector('.x').onclick = function () { closeView(bg); };
    var body = bg.querySelector('#mbPrivBody');
    function fallback() { body.innerHTML = wrT('member.privacy_policy_this_version_single', [PRIV_URL, PRIV_URL]); }
    if (!/^https?:$/.test(location.protocol)) { fallback(); return; }
    fetch(PRIV_FILE, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (t) {
      var m = t.match(/<main[^>]*>([\s\S]*?)<\/main>/i); if (!m) throw 0; body.innerHTML = m[1];
    }).catch(function () { caches && caches.match ? caches.match(PRIV_FILE, { ignoreSearch: true }).then(function (r) { if (!r) throw 0; return r.text(); }).then(function (t) { var m = t.match(/<main[^>]*>([\s\S]*?)<\/main>/i); if (!m) throw 0; body.innerHTML = m[1]; }).catch(fallback) : fallback(); });
  }

  // ---------- 刪除帳號時：清掉會員相關資料（cloud.js 的 deleteAccount 呼叫） ----------
  function purge() {
    if (!signedIn()) return Promise.resolve();
    var me = uid(), soft = function (p) { return p.catch(function () {}); };
    return Promise.all([
      soft(BE.myShares().then(function (a) { return Promise.all(a.map(function (s) { return soft(BE.deleteShare(s.id)); })); })),
      soft(BE.sharesToMe().then(function (a) { return Promise.all(a.map(function (s) { return soft(BE.leaveShare(s.id, (s.to || []).filter(function (u) { return u !== me; }))); })); })),
      soft(BE.friendships().then(function (a) { return Promise.all(a.map(function (f) { return soft(BE.deleteFriend(f.id)); })); })),
      soft(BE.myRedemptions().then(function (a) { return Promise.all(a.filter(function (r) { return r.status === 'pending' || r.status === 'granted'; }).map(function (r) { return soft(BE.deleteRedemption(r.id)); })); })),
      soft(BE.deleteMyRole())
    ]).then(function () { return BE.getProfile(me); }).then(function (p) { return p ? BE.deleteProfile(p) : null; }).then(function () { ls(LS_AV, null); ls(LS_SEEN, null); S.profile = undefined; });
  }

  // ---------- 啟動 ----------
  D.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('.wr-priv-link'); if (t) { e.preventDefault(); openPrivacy(); } });
  if (root.WRCloud && root.WRCloud.on) root.WRCloud.on(onCloud);
  root.WRMember = {
    get state() { return S; }, get profile() { return S.profile; }, get perks() { return S.perks.slice(); }, get groups() { return S.groups.slice(); }, get admin() { return S.admin; },
    identityHTML: identityHTML, bindIdentity: bindIdentity, renderCards: renderCards, renderHeader: renderHeader, refresh: function () { return loadAll(false); }, refreshSocial: refreshSocial,
    shareRecord: shareRecord, sharesOf: sharesOf, canShare: function () { return hasProfile(); }, openPrivacy: openPrivacy, openCheat: openCheat, openSignup: openSignup,
    showBubble: showBubble, hideBubble: hideBubble, goAcct: goAcct, purge: purge, redeem: redeem, counts: counts, addFriend: addFriend, isHeld: function () { return BE.isHeld(); }, _pure: pure,
    /* e2e：換成假後端並模擬登入（user＝{uid,name,email}；null＝登出）；pick＝回傳 Promise<File> 的函式（代替檔案選擇器） */
    _mock: function (be, user, pick) { mocked = true; BE = be; if (pick) pickHook = pick; var was = uid(); S.status = user ? 'signed-in' : 'signed-out'; S.user = user || null; if (user) { if (user.uid !== was) S.profs = {}; return loadAll(true); } reset(); return Promise.resolve(); }
  };
})(typeof window !== 'undefined' ? window : this);
