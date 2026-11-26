/* WRbeta v3.0 beta 測試期回報（White 2026-11-27 指定）。App.siusReport
 * - 第一次用小白單時問一次要不要參加（設定 › 測試期回報 可以隨時改）；存在 localStorage 'wr_rep_consent'（'1'／'0'）。
 * - 有同意＋已登入：存小白單時自動送一份回報到 Firestore siusReports/{uid_亂數}：每一發（讀值、燈號、有沒有改）、改了什麼（從→到）、
 *   每一步花幾秒、App 版本、手機型號。不送 email、名字、uid 以外的帳號資料。
 * - 分析頁最下面的表單（小白單紀錄才有）：錯幾發（從修改紀錄自動填）、五星感覺、錯誤類型（可複選）、備註、「送出回報」。
 * - 照片上傳（Cloud Storage）：暫停。Cloud Storage 自 2024-09 起要 Blaze（付費）方案，White 指示專案 wrbeta-81118 不升級、不改帳單 → 這部分停下來回報。
 * - 規則：firestore.rules 的 siusReports（只能寫自己的；本人與管理員能讀；不公開）。規則只在模擬器測過，還沒部署。 */
(function (App) {
  'use strict';
  var KEY = 'wr_rep_consent', PHOTOS = false; // PHOTOS：照片上傳開關（Storage 需要 Blaze，暫停）
  var D = document, $ = function (id) { return D.getElementById(id); }, esc = App.esc || function (s) { return String(s); };
  var TYPES = ['dec', 'xy', 'time', 'missed', 'extra', 'order', 'gun', 'other'];
  function TNAME() { return { dec: wrT('rep.t_dec'), xy: wrT('rep.t_xy'), time: wrT('rep.t_time'), missed: wrT('rep.t_missed'), extra: wrT('rep.t_extra'), order: wrT('rep.t_order'), gun: wrT('rep.t_gun'), other: wrT('rep.t_other') }; }
  function consent() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setConsent(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} var c = $('repConsent'); if (c) c.checked = !!on; }
  function cloud() { return window.WRCloud && window.WRCloud.fb ? window.WRCloud.fb() : null; }
  function rid(uid) { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < 16; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return uid + '_' + s; }
  // 手機型號：Android 的 UA 有型號（例如「Android 14; Pixel 7」）；iPhone 只看得到「iPhone; iOS 18.1」。不送完整 UA。
  var devP = null;
  function device() {
    if (devP) return devP;
    var ua = navigator.userAgent || '', m = ua.match(/Android\s+([\d.]+);\s*([^;)]+)/), base = m ? 'Android ' + m[1] + '; ' + m[2].trim() : /iPhone|iPad/.test(ua) ? ((ua.match(/(iPhone|iPad)/) || [])[1] + '; iOS ' + ((ua.match(/OS (\d+[_\d]*)/) || [])[1] || '').replace(/_/g, '.')) : (navigator.platform || 'web');
    devP = Promise.resolve(base.slice(0, 80));
    try { if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) devP = navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']).then(function (v) { return v.model ? (navigator.userAgentData.platform + ' ' + (v.platformVersion || '') + '; ' + v.model).slice(0, 80) : base.slice(0, 80); }, function () { return base.slice(0, 80); }); } catch (e) {}
    return devP;
  }
  // 第一次用小白單：問一次
  function askOnce(then) {
    if (consent() != null) { if (then) then(); return; }
    App.ask(wrT('rep.consent_q'), function () { setConsent(true); App.toast(wrT('rep.consent_on'), 3200); if (then) then(); }, function () { setConsent(false); App.toast(wrT('rep.consent_off'), 3200); if (then) then(); }, { yes: wrT('rep.consent_yes') });
  }
  function payload(rec, extra, uid, dev) {
    var si = rec.sius || {}, rep = si.rep || {};
    // 太長時整筆丟掉尾巴的「元素」（不是切字串），送出去的一定是合法 JSON；n＝原本的發數（審查時 Carbon／Neon 抓到的錯，2026-11-27 修）
    var fit = function (arr, max) { arr = arr || []; var k = arr.length, js = JSON.stringify(arr); while (js.length > max && k > 0) { k = Math.floor(k * 0.9); js = JSON.stringify(arr.slice(0, k)); } return js; };
    var list = extra && extra.shots || (rec.sheets || []).reduce(function (a, sh) { return a.concat((sh.shots || []).map(function (q) { return { n: q.n == null ? null : q.n, s: sh.sighter ? 1 : 0, d: q.pd == null ? null : q.pd, in: q.pi ? 1 : 0, t: q.t || '', x: q.x, y: q.y }; })); }, []);
    var shots = fit(list, 60000), edits = fit(rep.log, 40000);
    var tm = JSON.stringify(rep.timing || {}); if (tm.length > 2000) tm = JSON.stringify({ total: (rep.timing || {}).total || 0, cut: 1 });
    var lt = rep.lights || {};
    var n = list.length;
    return { uid: uid, app: String(App.APP_LABEL || '').slice(0, 24), dev: dev, eng: rep.eng === 'main' ? 'main' : 'v3', gun: rec.targetId === 'ap10' ? 'ap10' : 'ar10',
      lights: { g: lt.g | 0, y: lt.y | 0, r: lt.r | 0 }, n: Math.min(200, n), shots: shots, edits: edits, timing: tm, photos: 0 };
  }
  // 存小白單時自動送（有同意＋已登入）
  function auto(rec, extra) {
    if (consent() !== '1') return Promise.resolve(null);
    var fb = cloud(); if (!fb) return Promise.resolve(null);
    var id = rid(fb.uid);
    return device().then(function (dev) {
      var d = payload(rec, extra, fb.uid, dev); d.created = fb.F.serverTimestamp();
      return fb.F.setDoc(fb.F.doc(fb.db, 'siusReports', id), d);
    }).then(function () { rec.sius.repId = id; rec.sius.repAt = new Date().toISOString(); if (App.saveSessions) App.saveSessions(App.sessions); return id; }, function (e) { try { console.warn('siusReport', e && e.code); } catch (x) {} return null; });
  }
  /* ---------- 分析頁最下面的表單 ---------- */
  var form = { stars: 0, types: {} };
  function card() {
    var box = $('anaRepCard'); if (!box) return;
    var a = App.acur, si = a && a.sius;
    if (!si || (App.anaRO && App.anaRO.on)) { box.hidden = true; box.innerHTML = ''; return; }
    var rep = si.rep || {}, sent = si.repSent;
    if (box.dataset.rec !== a.id) { form = { stars: 0, types: {} }; box.dataset.rec = a.id; }
    var wrong = rep.wrong != null ? rep.wrong : 0;
    var h = '<div class="rp-h"><b>' + esc(wrT('rep.title')) + '</b><small>' + esc(wrT('rep.sub')) + '</small></div>';
    h += '<div class="rp-row"><span>' + esc(wrT('rep.wrong')) + '</span><input type="number" id="repWrong" min="0" max="200" inputmode="numeric" value="' + wrong + '"><small class="rp-st">' + esc(wrT('rep.wrong_auto', [wrong])) + '</small></div>';
    h += '<div class="rp-row"><span>' + esc(wrT('rep.stars')) + '</span><div class="rp-stars" role="radiogroup" aria-label="' + esc(wrT('rep.stars')) + '">' + [1, 2, 3, 4, 5].map(function (k) { return '<button type="button" role="radio" data-s="' + k + '" aria-checked="' + (form.stars === k) + '" class="' + (form.stars >= k ? 'on' : '') + '" aria-label="' + esc(wrT('rep.star_n', [k])) + '">★</button>'; }).join('') + '</div></div>';
    h += '<div class="rp-row"><span>' + esc(wrT('rep.types')) + '</span><div class="rp-types">' + TYPES.map(function (k) { return '<button type="button" data-t="' + k + '" aria-pressed="' + !!form.types[k] + '">' + esc(TNAME()[k]) + '</button>'; }).join('') + '</div></div>';
    h += '<textarea id="repNote" maxlength="500" placeholder="' + esc(wrT('rep.note_ph')) + '" aria-label="' + esc(wrT('rep.note')) + '"></textarea>';
    h += '<div class="rp-go"><button type="button" class="wr-pill pri" id="repSend">' + esc(wrT('rep.send')) + '</button><span class="rp-st" id="repSt">' + esc(sent ? wrT('rep.sent_at', [new Date(sent).toLocaleString()]) : !PHOTOS ? wrT('rep.no_photo') : '') + '</span></div>';
    box.innerHTML = h; box.hidden = false;
    box.querySelectorAll('.rp-stars button').forEach(function (b) { b.onclick = function () { form.stars = +b.dataset.s; box.querySelectorAll('.rp-stars button').forEach(function (x) { var k = +x.dataset.s; x.classList.toggle('on', k <= form.stars); x.setAttribute('aria-checked', k === form.stars ? 'true' : 'false'); }); }; });
    box.querySelectorAll('.rp-types button').forEach(function (b) { b.onclick = function () { var k = b.dataset.t; form.types[k] = !form.types[k]; b.setAttribute('aria-pressed', form.types[k] ? 'true' : 'false'); }; });
    $('repSend').onclick = function () { send(a); };
  }
  function send(rec) {
    var fb = cloud();
    if (!fb) { App.toast(wrT('rep.need_login'), 4200); return; }
    var btn = $('repSend'); if (btn) btn.disabled = true;
    var st = $('repSt'); if (st) st.textContent = wrT('rep.sending');
    var w = Math.max(0, Math.min(200, parseInt(($('repWrong') || {}).value, 10) || 0)), note = String(($('repNote') || {}).value || '').trim().slice(0, 500);
    var f = { wrong: w, types: TYPES.filter(function (k) { return form.types[k]; }), note: note, sent: fb.F.serverTimestamp() };
    if (form.stars) f.stars = form.stars;
    var si = rec.sius || {}, p;
    if (si.repId && si.repId.indexOf(fb.uid + '_') === 0) p = fb.F.setDoc(fb.F.doc(fb.db, 'siusReports', si.repId), f, { merge: true }).then(function () { return si.repId; });
    else p = device().then(function (dev) { var id = rid(fb.uid), d = payload(rec, null, fb.uid, dev); for (var k in f) d[k] = f[k]; d.created = fb.F.serverTimestamp(); return fb.F.setDoc(fb.F.doc(fb.db, 'siusReports', id), d).then(function () { return id; }); });
    p.then(function (id) {
      si.repId = id; si.repSent = new Date().toISOString(); if (App.saveSessions) App.saveSessions(App.sessions);
      App.toast(wrT('rep.sent'), 3200); card();
    }, function (e) { if (btn) btn.disabled = false; if (st) st.textContent = wrT('rep.fail', [String(e && (e.code || e.message) || e).slice(0, 60)]); });
  }
  // 刪帳號時：清掉自己的回報（規則允許本人用 uid 條件列出／刪除）
  function purge() {
    var fb = cloud(); if (!fb) return Promise.resolve();
    var q = fb.F.query(fb.F.collection(fb.db, 'siusReports'), fb.F.where('uid', '==', fb.uid));
    return fb.F.getDocs(q).then(function (snap) { var ps = []; snap.forEach(function (d) { ps.push(fb.F.deleteDoc(d.ref)); }); return Promise.all(ps); }, function () {});
  }
  var c = $('repConsent');
  if (c) { c.checked = consent() === '1'; c.onchange = function () { setConsent(this.checked); App.toast(this.checked ? wrT('rep.consent_on') : wrT('rep.consent_off'), 2600); }; }
  App.siusReport = { auto: auto, card: card, askOnce: askOnce, purge: purge, consent: consent, setConsent: setConsent, payload: payload, PHOTOS: PHOTOS };
})(window.WRApp = window.WRApp || {});
