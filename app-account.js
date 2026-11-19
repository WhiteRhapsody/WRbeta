/* WRbeta「設定/說明 › 帳號」＋版本更新（service worker、強制更新）
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var APP_VERSION = App.APP_VERSION, C = App.C, T = App.T, LS_SESS = App.LS_SESS, $ = App.$, store = App.store, isAna = App.isAna, fmtTW = App.fmtTW,
    anaShots = App.anaShots, esc = App.esc, recTitle = App.recTitle, ask = App.ask, toast = App.toast, renderAll = App.renderAll;
  // 給其他模組用（函式）
  App.profileStats = profileStats; App.renderAcct = renderAcct;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'acctState', { get: function () { return acctState; }, set: function (v) { acctState = v; }, enumerable: true, configurable: true });

  // ---------- v1.8.0「設定/說明 › 帳號」：雲端帳號（Firebase Google 登入）＋個人畫面 ----------
  // 沒登入：說明＋「用 Google 帳號登入」。登入後：頭像／名字／email、我的統計（這台裝置的真實紀錄）、同步狀態、選填資料、登出、刪除帳號與雲端資料。
  // 選填資料（射手名稱／慣用槍枝／彈種；v2.5.0 加生日（只有月-日）、性別、個人簽名）存在這台裝置（localStorage 'wr_profile_v1'）。
  // v2.5.0：登入後同步到自己的 users/{uid}.pf（只有本人讀得到）；每個欄位可設「好友可看」，只有公開的欄位會放進 cards/{uid} 給好友看（member.js syncPf）。
  // 格式：{ shooter, gun, ammo, birthday:'MM-DD', gender:'m'|'f'|'x', sig, pub:[公開的欄位], updated: ISO, _uid: 最後同步的帳號 }
  var LS_PROFILE = 'wr_profile_v1';
  var PF_FIELDS = [['shooter', wrT('app.shooter_name'), wrT('app.e_g_white'), 30], ['gun', wrT('app.usual_gun'), wrT('app.e_g_steyr_evo_10'), 40], ['ammo', wrT('app.pellets'), wrT('app.e_g_h_n_finale'), 40],
    ['birthday', wrT('app.birthday'), '', 5, 'bday'], ['gender', wrT('app.gender'), '', 1, 'gender'], ['sig', wrT('app.signature'), wrT('app.e_g_signature'), 60]];
  var PF_KEYS = PF_FIELDS.map(function (f) { return f[0]; });
  var BDAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  function pfClean(v) { // 只留合法的欄位（跟 firestore.rules 的 validPf 一樣）
    var o = {}; if (!v || typeof v !== 'object') return o;
    PF_FIELDS.forEach(function (f) { var x = v[f[0]]; if (typeof x !== 'string' || !x) return; x = x.slice(0, f[3]);
      if (f[0] === 'birthday' && !BDAY_RE.test(x)) return; if (f[0] === 'gender' && ['m', 'f', 'x'].indexOf(x) < 0) return; o[f[0]] = x; });
    if (Array.isArray(v.pub)) { var pub = v.pub.filter(function (k, i) { return PF_KEYS.indexOf(k) >= 0 && v.pub.indexOf(k) === i; }); if (pub.length) o.pub = pub; }
    if (typeof v.updated === 'string' && v.updated) o.updated = v.updated.slice(0, 40);
    if (typeof v._uid === 'string') o._uid = v._uid;
    return o;
  }
  function pfLoad() { try { var v = JSON.parse(store.get(LS_PROFILE)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function pfSave(pf, quiet) { // quiet＝從雲端拿來的（不再上傳）
    var o = pfClean(pf); if (!quiet) o.updated = new Date().toISOString();
    var me = window.WRCloud && WRCloud.state && WRCloud.state.user && WRCloud.state.user.uid; if (me && !quiet) o._uid = me; else if (pf._uid) o._uid = pf._uid;
    store.set(LS_PROFILE, JSON.stringify(o));
    if (!quiet && window.WRMember && WRMember.syncPf) try { WRMember.syncPf(true); } catch (e) {}
    return o;
  }
  function pfPublic(pf) { var c = {}; (pf.pub || []).forEach(function (k) { if (pf[k]) c[k] = pf[k]; }); return c; } // 給好友看的那幾格
  function pfShow(key, v) { // 顯示用的文字
    if (!v) return '';
    if (key === 'birthday') { var m = v.split('-'); return wrT('app.bday_fmt', [+m[0], +m[1]]); }
    if (key === 'gender') return { m: wrT('app.gender_m'), f: wrT('app.gender_f'), x: wrT('app.gender_x') }[v] || '';
    return v;
  }
  App.pf = { FIELDS: PF_FIELDS, KEYS: PF_KEYS, load: function () { return pfClean(pfLoad()); }, save: pfSave, clean: pfClean, pub: pfPublic, show: pfShow, label: function (k) { var f = PF_FIELDS.filter(function (x) { return x[0] === k; })[0]; return f ? f[1] : k; } };
  var WEEK = [wrT('app.sun'), wrT('app.mon'), wrT('app.tue'), wrT('app.wed'), wrT('app.thu'), wrT('app.fri'), wrT('app.sat')];
  function fmtTWShort(iso) { // 11/18 週二 23:09（台北）
    var d = new Date(iso); if (!isFinite(d)) return '—';
    try {
      var p = {}; new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      var wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
      return p.month + '/' + p.day + ' ' + WEEK[wd] + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
    } catch (e) { return fmtTW(iso); }
  }
  /* 我的統計：全部用這台裝置的紀錄（登入後也包含從雲端同步下來的）。發數＝實際彈著（分析的彈孔、預報／鬼影的實際落點；預報點不算）。
   * 最佳成績：10 發以上的紀錄裡平均最高的那筆（沒有 10 發以上就看全部），顯示「總分 /滿分」。 */
  function profileStats() {
    var out = { records: 0, shots: 0, best: null, last: null };
    var pool = [];
    App.sessions.forEach(function (s) {
      var shots = isAna(s) ? anaShots(s) : (s.actuals || []), preds = isAna(s) ? [] : (s.preds || []);
      if (!shots.length && !preds.length) return;
      out.records++; out.shots += shots.length;
      if (!out.last || Date.parse(s.created) > Date.parse(out.last.created)) out.last = s;
      if (shots.length) { var t = T[s.targetId] || T.ap10, st = C.analyzeShots(t, shots); pool.push({ s: s, n: st.n, total: st.total, avg: st.n ? st.total / st.n : 0 }); }
    });
    var big = pool.filter(function (x) { return x.n >= 10; }), cand = big.length ? big : pool;
    cand.forEach(function (x) { if (!out.best || x.avg > out.best.avg || (x.avg === out.best.avg && x.n > out.best.n)) out.best = x; });
    return out;
  }
  var GLOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  var CHEV = '<svg class="pf-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  var SYNC_IC = '<svg class="nv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3.5v3.8h-3.8M5.5 20.5v-3.8h3.8"/></svg>';
  var acctState = null;
  function renderAcct(st) {
    var W = window.WRCloud, box = $('cloudBody'); if (!box) return;
    st = st || acctState || (W && W.state) || { status: 'off' }; acctState = st;
    var signed = st.status === 'signed-in', u = st.user || {}, h = '';
    // 1) 帳號卡
    if (!W || st.status === 'off') {
      h = st.offReason === 'file'
        ? wrT('app.cloud_account_cloud_accounts_only')
        : wrT('app.cloud_accounts_coming_soon_soon');
    } else if (st.status === 'loading') h = wrT('app.cloud_account_connecting');
    else if (signed && window.WRMember && window.WRMember.identityHTML(u)) h = window.WRMember.identityHTML(u); // v2.0.0：有會員資料＝會員 ID 身分卡
    else if (signed) {
      var nm = u.name || (u.email ? u.email.split('@')[0] : wrT('app.signed_in')), ini = (nm.trim().charAt(0) || 'W').toUpperCase();
      h = wrT('app.signed_in_with', [esc(ini), u.photo ? '<img class="pf-photo" src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer">' : '', GLOGO, esc(nm), esc(u.email || ''), u.relay ? wrT('app.apple_relay_email') : '', u.provider === 'apple.com' ? 'Apple' : 'Google']);
    } else {
      h = wrT('app.sign_in_to_the_cloud', [(st.providers || ['google']).map(function (p) { return '<button type="button" class="cloud-in pf-gbtn" data-p="' + p + '">' + (p === 'apple' ? wrT('app.sign_in_with_apple') : wrT('app.sign_in_with_google', [GLOGO])) + '</button>'; }).join(''), st.error ? '<div class="lbl pf-err">⚠️ ' + esc(cloudErrText(st.error)) + '</div>' : '']);
    }
    box.innerHTML = h;
    if (window.WRMember) try { window.WRMember.bindIdentity(box); } catch (e) {}
    var img = box.querySelector('.pf-photo'); if (img) img.onerror = function () { img.remove(); };
    box.querySelectorAll('.cloud-in').forEach(function (b) { b.onclick = function () { W.signIn(b.dataset.p); }; });
    // 2) 我的統計
    var S = profileStats();
    $('pfStats').innerHTML = wrT('app.my_stats_records_shots_best', [signed ? wrT('app.all_records_incl_cloud_sync') : wrT('app.all_records_on_this_device'), S.records.toLocaleString('en-US'), S.shots.toLocaleString('en-US'), S.best ? '<b class="acc" id="pfBest">' + S.best.total + '<i>/' + (S.best.n * 10) + '</i></b><small class="pf-sub">' + esc(recTitle(S.best.s)) + '</small>' : '<b id="pfBest">—</b>', S.last ? esc(fmtTWShort(S.last.created)) : '—']);
    // 3) 同步狀態（登入後）
    var sy = $('pfSync'); sy.hidden = !signed;
    if (signed) {
      var pend = W.pending ? W.pending(App.sessions) : 0;
      sy.innerHTML = wrT('app.sync_status', [st.error ? ' bad' : '', st.syncing ? wrT('app.syncing') : st.lastSync ? wrT('app.last_sync_taipei', [esc(fmtTWShort(st.lastSync).replace(/ (週.|[A-Z][a-z]{2}) /, ' '))]) : wrT('app.never_synced'), pend ? 'pend' : 'ok', pend ? wrT('app.records_on_this_device_waiting', [pend]) : wrT('app.all_records_on_this_device_2'), st.error ? '<div class="pf-err">⚠️ ' + esc(cloudErrText(st.error)) + '</div>' : '', st.syncing ? ' disabled' : '', SYNC_IC, st.syncing ? wrT('app.syncing') : wrT('app.sync_now')]);
      $('cloudSync').onclick = function () { W.syncNow(); };
    } else sy.innerHTML = '';
    // 4) 選填資料（這台裝置）
    var pf = pfClean(pfLoad()), pub = pf.pub || [];
    $('pfExtra').innerHTML = wrT('app.optional_info_optional_stored_only', [PF_FIELDS.map(function (f) {
      var v = pfShow(f[0], pf[f[0]]), on = pub.indexOf(f[0]) >= 0;
      return '<div class="pf-rw"><button type="button" class="pf-row" data-f="' + f[0] + '"><span>' + f[1] + '</span><em class="' + (v ? 'set' : '') + '">' + esc(v || wrT('app.not_set')) + '</em>' + CHEV + '</button>'
        + '<button type="button" class="pf-pub' + (on ? ' on' : '') + '" data-pub="' + f[0] + '" aria-pressed="' + on + '" aria-label="' + esc(wrT('app.pf_pub_aria', [f[1]])) + '">' + (on ? wrT('app.pf_pub_on') : wrT('app.pf_pub_off')) + '</button></div>';
    }).join('') + '<div class="lbl pf-pubnote">' + (signed ? wrT('app.pf_note_signed') : wrT('app.pf_note_local')) + '</div>']);
    $('pfExtra').querySelectorAll('.pf-row').forEach(function (b) { b.onclick = function () { pfEdit(b.dataset.f); }; });
    $('pfExtra').querySelectorAll('.pf-pub').forEach(function (b) { b.onclick = function () {
      var k = b.dataset.pub, p = pfClean(pfLoad()), list = (p.pub || []).filter(function (x) { return x !== k; }), on = !(b.getAttribute('aria-pressed') === 'true');
      if (on) list.push(k); p.pub = list; pfSave(p); toast(on ? wrT('app.pf_pub_toast_on', [App.pf.label(k)]) : wrT('app.pf_pub_toast_off', [App.pf.label(k)])); renderAcct();
    }; });
    // 5) 登出／刪除帳號（登入後）
    var end = $('pfEnd'); end.hidden = !signed;
    if (signed) {
      end.innerHTML = wrT('app.sign_out_permanently_deletes_your', [st.deleting ? ' disabled' : '', st.deleting ? wrT('app.deleting') : wrT('app.delete_account_and_cloud_data')]);
      $('cloudOut').onclick = function () { ask(wrT('app.your_records_stay_on_this'), function () { W.signOut(); toast(wrT('app.signed_out')); }, null, { yes: wrT('app.sign_out') }); };
      $('pfDel').onclick = pfDelete;
    } else end.innerHTML = '';
    // 6) v2.0.0：會員資料、好友、分享、管理員（member.js）＋隱私權政策
    if (window.WRMember) try { window.WRMember.renderCards(); } catch (e) {}
    var lg = $('pfLegal'); if (lg && !lg.firstChild) {
      lg.innerHTML = wrT('app.privacy_policy_what_we_collect', [CHEV]);
    }
  }
  function cloudErrText(e) {
    var m = { 'popup-blocked': wrT('app.the_pop_up_was_blocked'), 'network-request-failed': wrT('app.network_error_please_try_again'), 'unauthorized-domain': wrT('app.this_url_isnt_authorized_for'),
      'operation-not-allowed': wrT('app.google_sign_in_isnt_enabled'), 'too-many-requests': wrT('app.too_many_attempts_please_try'), 'requires-recent-login': wrT('app.please_confirm_your_google_account'),
      'user-mismatch': wrT('app.please_choose_the_same_google'), 'permission-denied': wrT('app.the_cloud_denied_access_please'), 'unavailable': wrT('app.cant_reach_the_cloud_right'), 'internal-error': wrT('app.sign_in_error_please_try'),
      'wr-suspended': wrT('cloud.suspended_cannot_delete'), 'wr-suspended-sync': wrT('cloud.suspended_cannot_sync'), 'wr-purge-failed': wrT('cloud.couldnt_finish_clearing_membership') };
    var k = String(e || '').replace(/^firestore\//, '');
    return m[k] || String(e || '');
  }
  function pfChoose(f) { // 生日（月、日兩個選單）與性別（四個按鈕）
    var pf = pfClean(pfLoad()), key = f[0], bg = document.createElement('div'); bg.className = 'modal-bg';
    var h = '<div class="modal pf-modal" role="dialog" aria-modal="true"><p class="pf-mh"></p>';
    if (key === 'birthday') {
      var cur = (pf.birthday || '').split('-'), mo = '', da = '';
      for (var m = 1; m <= 12; m++) mo += '<option value="' + (m < 10 ? '0' : '') + m + '"' + (+cur[0] === m ? ' selected' : '') + '>' + wrT('app.month_n', [m]) + '</option>';
      for (var d = 1; d <= 31; d++) da += '<option value="' + (d < 10 ? '0' : '') + d + '"' + (+cur[1] === d ? ' selected' : '') + '>' + wrT('app.day_n', [d]) + '</option>';
      h += '<div class="row pf-bday"><select class="pf-m" aria-label="' + esc(wrT('app.month')) + '"><option value="">—</option>' + mo + '</select><select class="pf-d" aria-label="' + esc(wrT('app.day')) + '"><option value="">—</option>' + da + '</select></div>'
        + '<div class="lbl">' + wrT('app.bday_note') + '</div><div class="row"><button class="no">' + wrT('app.pf_cancel') + '</button><button class="clr">' + wrT('app.pf_clear') + '</button><button class="primary yes">' + wrT('app.pf_save') + '</button></div>';
    } else {
      h += '<div class="pf-choice">' + [['m', wrT('app.gender_m')], ['f', wrT('app.gender_f')], ['x', wrT('app.gender_x')]].map(function (g) { return '<button type="button" class="pf-ch' + (pf.gender === g[0] ? ' on' : '') + '" data-v="' + g[0] + '" aria-pressed="' + (pf.gender === g[0]) + '">' + g[1] + '</button>'; }).join('')
        + '</div><div class="row"><button class="no">' + wrT('app.pf_cancel') + '</button><button class="clr">' + wrT('app.pf_clear') + '</button></div>';
    }
    bg.innerHTML = h + '</div>'; bg.querySelector('.pf-mh').textContent = f[1];
    function done(v) {
      if (v !== undefined) { var p = pfClean(pfLoad()); if (v) p[key] = v; else delete p[key]; pfSave(p); toast(f[1] + (v ? wrT('app.saved') : wrT('app.cleared'))); }
      bg.remove(); renderAcct();
    }
    bg.querySelector('.no').onclick = function () { done(); };
    bg.querySelector('.clr').onclick = function () { done(''); };
    if (key === 'birthday') bg.querySelector('.yes').onclick = function () {
      var m = bg.querySelector('.pf-m').value, d = bg.querySelector('.pf-d').value;
      if (!m || !d) { done(''); return; }
      var max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+m - 1]; if (+d > max) { toast(wrT('app.bday_bad')); return; }
      done(m + '-' + d);
    };
    else bg.querySelectorAll('.pf-ch').forEach(function (b) { b.onclick = function () { done(b.dataset.v); }; });
    document.body.appendChild(bg);
  }
  function pfEdit(key) {
    var f = PF_FIELDS.filter(function (x) { return x[0] === key; })[0]; if (!f) return;
    if (f[4]) { pfChoose(f); return; }
    var pf = pfLoad(), bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = wrT('app.stored_only_on_this_device');
    bg.querySelector('.pf-mh').textContent = f[1];
    var inp = bg.querySelector('.pf-in'); inp.value = pf[key] || ''; inp.placeholder = f[2]; inp.maxLength = f[3]; inp.setAttribute('aria-label', f[1]);
    function done(save) {
      if (save) { var v = inp.value.trim().slice(0, f[3]); pf = pfClean(pfLoad()); if (v) pf[key] = v; else delete pf[key]; pfSave(pf); toast(f[1] + (v ? wrT('app.saved') : wrT('app.cleared'))); }
      bg.remove(); renderAcct();
    }
    bg.querySelector('.no').onclick = function () { done(false); };
    bg.querySelector('.yes').onclick = function () { done(true); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
    document.body.appendChild(bg); setTimeout(function () { inp.focus(); }, 0);
  }
  function pfDelete() {
    var W = window.WRCloud;
    ask(wrT('app.delete_your_account_and_cloud'), function () {
      ask(wrT('app.final_check_permanently_delete_your'), function () {
        // 在點擊裡直接呼叫（需要重新確認時，Google 視窗才不會被擋）
        W.deleteAccount().then(function (r) { toast(wrT('app.account_and_cloud_data_deleted', [r.deletedRecords]), 4200); renderAcct(); })
          .catch(function (e) { var c = e && e.code ? String(e.code).replace('auth/', '') : ''; if (!/popup-closed|cancelled-popup/.test(c)) toast(wrT('app.deletion_not_completed', [cloudErrText(c || (e && e.message))]), 4200); renderAcct(); });
      }, null, { yes: wrT('app.delete_permanently'), danger: true });
    }, null, { yes: wrT('app.continue'), danger: true });
  }
  (function () {
    var W = window.WRCloud;
    if (W && W.init) W.init({
      getSessions: function () { return App.sessions; },
      setSessions: function (list) { // 雲端合併後的結果寫回本機，畫面重畫
        App.sessions = list; store.set(LS_SESS, JSON.stringify(App.sessions));
        App.cur = App.sessions.filter(function (x) { return x.id === App.cur.id; })[0] || App.cur; if (App.sessions.indexOf(App.cur) < 0) App.sessions.unshift(App.cur);
        App.acur = App.sessions.filter(function (x) { return x.id === App.acur.id; })[0] || App.acur;
        renderAll();
      },
      onState: function (st) { renderAcct(st); }
    });
    renderAcct();
  })();

  // ---------- 版本更新 ----------
  // 新的 service worker 接管時自動重新載入一次（同一個分頁只做一次，避免無限重整）；回到前景時也檢查更新
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:' && window.top === window.self) {
      var hadCtl = !!navigator.serviceWorker.controller, reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadCtl || reloaded) { hadCtl = true; return; }
        reloaded = true;
        try { if (sessionStorage.getItem('wr_reloaded') === APP_VERSION) { toast(wrT('app.a_new_version_is_available')); return; } sessionStorage.setItem('wr_reloaded', APP_VERSION); } catch (e) {}
        location.reload();
      });
      navigator.serviceWorker.register('sw.js?v=' + APP_VERSION, { updateViaCache: 'none' }).then(function (reg) {
        var chk = function () { try { reg.update(); } catch (e) {} };
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') chk(); });
        if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      }).catch(function () {});
    }
  } catch (e) {}
  // 說明分頁：強制更新（移除 service worker、清掉快取、重新載入；紀錄存在 localStorage，不會被清掉）
  function forceUpdate() {
    var jobs = [];
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    toast(wrT('app.updating'));
    Promise.all(jobs).catch(function () {}).then(function () { var u = location.href.split('#')[0].split('?')[0]; location.replace(u + '?r=' + Date.now()); });
  }
  if ($('forceUpdate')) $('forceUpdate').onclick = forceUpdate;
})(window.WRApp = window.WRApp || {});
