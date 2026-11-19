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
  // 2026-11-19 模組分割：好友和分享（member-friends.js）、管理頁（member-admin.js）跟這個檔共用 window.WRMemberParts
  var MP = root.WRMemberParts = root.WRMemberParts || {};
  // 後面才載入的模組的函式（呼叫時才轉過去）
  function renderFriends() { return MP.renderFriends.apply(this, arguments); }
  function addFriend() { return MP.addFriend.apply(this, arguments); }
  function sharesOf() { return MP.sharesOf.apply(this, arguments); }
  function renderShares() { return MP.renderShares.apply(this, arguments); }
  function closeView() { return MP.closeView.apply(this, arguments); }
  function shareRecord() { return MP.shareRecord.apply(this, arguments); }
  function counts() { return MP.counts.apply(this, arguments); }
  function renderBadges() { return MP.renderBadges.apply(this, arguments); }
  function loadAdmin() { return MP.loadAdmin.apply(this, arguments); }
  function renderAdmin() { return MP.renderAdmin.apply(this, arguments); }
  // 給其他模組用（函式）
  MP.midCheck = midCheck; MP.normCode = normCode; MP.codeLenOk = codeLenOk; MP.codeHash = codeHash; MP.pairId = pairId; MP.parsePerks = parsePerks; MP.parseMids = parseMids;
  MP.$ = $; MP.esc = esc; MP.app = app; MP.toast = toast; MP.ask = ask; MP.ls = ls; MP.uid = uid; MP.hasProfile = hasProfile; MP.errText = errText;
  MP.refreshSocial = refreshSocial; MP.who = who; MP.whoHTML = whoHTML; MP.show = show; MP.renderCards = renderCards; MP.modal = modal; MP.profOf = profOf; MP.avHTML = avHTML;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(MP, 'SHARE_MAX', { get: function () { return SHARE_MAX; }, set: function (v) { SHARE_MAX = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'GROUPS', { get: function () { return GROUPS; }, set: function (v) { GROUPS = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'D', { get: function () { return D; }, set: function (v) { D = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'B', { get: function () { return B; }, set: function (v) { B = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'LS_SEEN', { get: function () { return LS_SEEN; }, set: function (v) { LS_SEEN = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'ICON', { get: function () { return ICON; }, set: function (v) { ICON = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'BE', { get: function () { return BE; }, set: function (v) { BE = v; }, enumerable: true, configurable: true });
  Object.defineProperty(MP, 'S', { get: function () { return S; }, set: function (v) { S = v; }, enumerable: true, configurable: true });
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
  function codeLenOk(s) { return normCode(s).length >= 3; }
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
  var pure = { MID_RE: MID_RE, AV_MAX: AV_MAX, SHARE_MAX: SHARE_MAX, GROUPS: GROUPS, midCheck: midCheck, normCode: normCode, codeLenOk: codeLenOk, sha256: sha256, codeHash: codeHash, pairId: pairId, parsePerks: parsePerks, parseMids: parseMids, avatarOk: avatarOk, friendView: friendView, perksOf: perksOf, rateOk: rateOk };
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
      // v2.5.0 選填資料：私人的 users/{uid}.pf（整份換掉＝mergeFields）、給好友看的 cards/{uid}（只有公開欄位；沒有就刪掉）
      getPrivPf: function () { return P(function () { return one(d('users', C().uid)).then(function (x) { return (x && x.pf) || null; }); }); },
      setPrivPf: function (pf) { return P(function () { return C().F.setDoc(d('users', C().uid), { pf: pf }, { mergeFields: ['pf'] }); }); },
      getCard: function (u) { return P(function () { return one(d('cards', u || C().uid)); }); },
      setCard: function (c) { return P(function () { var r = d('cards', C().uid); return c && Object.keys(c).length ? C().F.setDoc(r, Object.assign({}, c, { updated: ts() })) : C().F.deleteDoc(r); }); },
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
      setSuspended: function (uid, on) { return P(function () { if (uid === C().uid) return Promise.reject({ message: wrT('member.cant_suspend_or_wipe_yourself') }); return on ? C().F.setDoc(d('suspended', uid), { on: true, updated: ts(), by: C().uid }) : C().F.deleteDoc(d('suspended', uid)); }); },
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
          if (uid === C().uid) return Promise.reject({ message: wrT('member.cant_suspend_or_wipe_yourself') });
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
            chain = chain.then(function () { return c.F.deleteDoc(d('cards', uid)).catch(function () {}); }); // v2.5.0 好友資料卡
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
      if (p) { S.profs[me] = p; if (p.avatarOn && p.avatar) ls(LS_AV, { uid: me, av: p.avatar }); closeSignup(); syncPf(false); return refreshSocial(); }
      syncPf(false);
      if (first) openSignup();
    }, function (e) { S.loadErr = errText(e); }).then(emitChange);
  }
  /* v2.5.0 選填資料同步：本機 wr_profile_v1 ↔ users/{uid}.pf（私人）；公開的欄位 → cards/{uid}（好友看）
   * push＝剛在這台改過（本機為準）；不是 push（登入時）＝較新的一邊為準。本機資料若是別的帳號留下的（_uid 不同），不上傳、以雲端為準。 */
  var pfBusy = null, pfAgain = false;
  function sameCard(a, b) { a = a || {}; b = b || {}; var ks = ['shooter', 'gun', 'ammo', 'birthday', 'gender', 'sig']; return ks.every(function (k) { return (a[k] || '') === (b[k] || ''); }); }
  function syncPf(push) {
    var A = app(), PF = A.pf || (root.WRApp && root.WRApp.pf);
    if (!signedIn() || !BE.getPrivPf || !PF) return Promise.resolve();
    if (pfBusy) { pfAgain = pfAgain || push; return pfBusy; }
    var me = uid();
    pfBusy = BE.getPrivPf().then(function (remote) {
      if (uid() !== me) return;
      var local = PF.load(), mine = !local._uid || local._uid === me, lu = local.updated || '', ru = (remote && remote.updated) || '';
      var cur = local, up = false;
      if (remote && (!mine || (!push && ru > lu))) { cur = PF.clean(remote); cur._uid = me; ls('wr_profile_v1', cur); } // 雲端較新（或本機是別人的）
      else if (mine && (push || lu > ru || (!remote && Object.keys(PF.clean(local)).some(function (k) { return PF.KEYS.indexOf(k) >= 0; })))) up = true;
      var body = PF.clean(cur); delete body._uid;
      var jobs = [up ? BE.setPrivPf(body).then(function () { if (!local._uid) { var l = PF.load(); l._uid = me; ls('wr_profile_v1', l); } }) : null];
      if (hasProfile() && BE.setCard) { // 好友資料卡：跟現在的公開欄位不一樣才寫
        var want = PF.pub(cur);
        jobs.push(BE.getCard(me).then(function (c) { if (!sameCard(c, want) || (!Object.keys(want).length && c)) return BE.setCard(want); }));
      }
      return Promise.all(jobs).then(function () { if (!up && cur !== local) { try { if (A.renderAcct) A.renderAcct(); } catch (e) {} } });
    }).catch(function (e) { if (push) toast(wrT('member.pf_sync_failed', [errText(e)]), 3600); })
      .then(function () { pfBusy = null; if (pfAgain) { var p = pfAgain; pfAgain = false; return syncPf(p); } });
    return pfBusy;
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
    var label = app().label || ('beta ' + String(app().version || '').replace(/^v(\d+)\.(\d+)\.0$/, 'v$1.$2'));
    chip.innerHTML = avHTML(p, 'mh-av', true) + '<span class="mh-t"><b><span class="mh-id">' + esc(p.mid) + '</span>' + ICON.hchev + '</b><small>WRbeta<i>' + esc(label) + '</i></small></span><span class="mb-badge" hidden></span>';
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
      if (!codeLenOk(raw)) { say(wrT('member.the_code_needs_at_least'), 'info'); return; }
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
    if (!codeLenOk(raw)) return Promise.reject({ message: wrT('member.the_code_needs_at_least') });
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
  function gone(e) {
    var c = String((e && (e.code || e.message)) || e || '');
    return /not-found|NOT_FOUND/i.test(c);
  }
  function keep(p) { return p.catch(function (e) { if (gone(e)) return; throw e; }); }
  function purge() {
    if (!signedIn()) return Promise.resolve();
    var me = uid();
    var held = BE.isHeld ? BE.isHeld() : Promise.resolve(false);
    return held.then(function (on) {
      if (on) return Promise.reject({ code: 'wr-suspended', message: wrT('cloud.suspended_cannot_delete') });
      return BE.myShares().then(function (a) {
        return Promise.all((a || []).map(function (s) { return keep(BE.deleteShare(s.id)); }));
      }).then(function () { return BE.sharesToMe(); }).then(function (a) {
        return Promise.all((a || []).map(function (s) { return keep(BE.leaveShare(s.id, (s.to || []).filter(function (u) { return u !== me; }))); }));
      }).then(function () { return BE.friendships(); }).then(function (a) {
        return Promise.all((a || []).map(function (f) { return keep(BE.deleteFriend(f.id)); }));
      }).then(function () { return BE.myRedemptions(); }).then(function (a) {
        return Promise.all((a || []).filter(function (r) { return r.status === 'pending' || r.status === 'granted'; }).map(function (r) { return keep(BE.deleteRedemption(r.id)); }));
      }).then(function () { return keep(BE.deleteMyRole()); }).then(function () {
        return BE.setCard ? keep(BE.setCard(null)) : null; // v2.5.0 好友資料卡
      }).then(function () {
        return BE.getProfile(me);
      }).then(function (p) { return p ? BE.deleteProfile(p) : null; }).then(function () {
        ls(LS_AV, null); ls(LS_SEEN, null); S.profile = undefined;
      }).catch(function (e) {
        if (e && e.code === 'wr-suspended') throw e;
        throw { code: 'wr-purge-failed', message: wrT('cloud.couldnt_finish_clearing_membership') };
      });
    });
  }

  // ---------- 啟動 ----------
  D.addEventListener('click', function (e) { var t = e.target && e.target.closest && e.target.closest('.wr-priv-link'); if (t) { e.preventDefault(); openPrivacy(); } });
  if (root.WRCloud && root.WRCloud.on) root.WRCloud.on(onCloud);
  root.WRMember = {
    get state() { return S; }, get profile() { return S.profile; }, get perks() { return S.perks.slice(); }, get groups() { return S.groups.slice(); }, get admin() { return S.admin; },
    identityHTML: identityHTML, bindIdentity: bindIdentity, renderCards: renderCards, renderHeader: renderHeader, refresh: function () { return loadAll(false); }, refreshSocial: refreshSocial,
    shareRecord: shareRecord, sharesOf: sharesOf, canShare: function () { return hasProfile(); }, syncPf: syncPf, openPrivacy: openPrivacy, openCheat: openCheat, openSignup: openSignup,
    showBubble: showBubble, hideBubble: hideBubble, goAcct: goAcct, purge: purge, redeem: redeem, counts: counts, addFriend: addFriend, isHeld: function () { return BE.isHeld(); }, _pure: pure,
    /* e2e：換成假後端並模擬登入（user＝{uid,name,email}；null＝登出）；pick＝回傳 Promise<File> 的函式（代替檔案選擇器） */
    _mock: function (be, user, pick) { mocked = true; BE = be; if (pick) pickHook = pick; var was = uid(); S.status = user ? 'signed-in' : 'signed-out'; S.user = user || null; if (user) { if (user.uid !== was) S.profs = {}; return loadAll(true); } reset(); return Promise.resolve(); }
  };
})(typeof window !== 'undefined' ? window : this);
