/* WRbeta v3.0 beta 小白單（SIUS 成績單）畫面：取代主選單的「鬼影」（White 2026-11-27 指定；設計稿 v296_design/v3）。
 * 核心：sius.js（WRSius，存檔／節奏）＋ v3.0 beta 引擎 sius-v3.js（WRSiusV3：M6b 為主、全部規則開；M6b 紅燈或沒讀到的發才用現有引擎補）。
 * 【White 指定 2026-11-27】
 *   - 每 10 發一張卡：左上角「試射／正射」、右下角小計（試射寫「小計 by WR」）；試射 11 發＝10＋1 兩張。
 *   - 每一格都顯示（名字、時間、發序、環數、X、Y、依 X/Y 算的方向箭頭），沒拍到寫「未拍到」；每一格都能改。
 *   - 橫式（左右滑＋進度條）／直式（往下捲），卡片大小一樣；方向欄 8 方向（預設、不記憶）／12 點鐘。
 *   - 分析頁的分析功能這裡也有；這個畫面沒有「校正」。
 *   - 三隻寶寶（拍照／相簿／檔案）讀進來一律當小白單；兩排純按鈕（舊入口＋實驗引擎入口）拿掉，取消鍵 siusStop 保留。
 *   - 黃燈不擋：分數照算、旁邊一個可以點的小記號、可以存；紅燈要改好才能存。
 *   - 絕對不杜撰數字：沒讀到的欄位留空標「未拍到」，等使用者照單子補。 */
(function (App) {
  'use strict';
  var S = window.WRSius; if (!S || !document.getElementById('tab-sius')) return;
  var D = document, $ = App.$, esc = App.esc, toast = App.toast, ask = App.ask, store = App.store, C = App.C;
  function T(id) { return App.T[id] || App.T.ar10; }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  // v3.0.1：手槍資格賽（整數單）→ X/Y 重算一律無條件捨去成整數（8.0–8.9＝8）、加總也是每發捨去後再加；決賽／步槍維持小數
  function intS(pis) { var m = st && st.model; return m && m.intSheet != null ? !!m.intSheet : !!pis; }
  function useInt(q, pis) { return !!(q && q.decInt) || intS(pis); }
  function fS(v, pis) { return intS(pis) ? String(Math.round(v)) : f1(v); }
  function calcTx(q, c) { return q && q.decInt ? String(c.ring) : f1(c.dec); }
  function f2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function V3() { return window.WRSiusV3 || null; }
  function XC() { return window.WRSiusXCore || null; }
  function OCR() { return window.WRSiusOCR || null; }
  function CHK(m) { return V3() && XC() ? V3().check(m) : S.check(m); }
  function PROB(m, ck) { return V3() && XC() ? V3().problems(m, ck) : S.problems(m, ck); }
  function stopAll() { if (V3()) try { V3().stop(); } catch (e) {} else if (OCR()) try { OCR().stop(); } catch (e) {} }
  var NA = function () { return '<span class="na">' + esc(wrT('sius.not_shot')) + '</span>'; };
  var PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>';
  var HAT = '<svg viewBox="0 0 22 27" aria-hidden="true"><path class="pp" d="M2 1.5h18v22.5l-3-1.8-3 1.8-3-1.8-3 1.8-3-1.8-3 1.8z"/><path class="ln" d="M5.5 6h11"/><path class="ln2" d="M5.5 10h11M5.5 13.5h11M5.5 17h7"/></svg>';
  App.siusHat = HAT;

  /* ---------- 入口：分析頁拍照按鈕列的「小白單」 → 小白單畫面（不清掉正在看的那張） ---------- */
  var btn = $('anaSiusBtn');
  if (btn) btn.onclick = function () { if (App.anaPopClose) App.anaPopClose(); App.showTab('sius'); };

  // st：{ model, ck, sel, recId, files:[File], urls:[], passes:[], fbPasses:[], tgUser, edits:{}, subEd:{}, totEd, metaEd:{}, log:[], busy, cancel, gunAsked, timing, cur, scope }
  var root = $('siusRoot'), built = false, st = null;
  var view = (function () { try { return store.get('wr_sius_view') === 'v' ? 'v' : 'h'; } catch (e) { return 'h'; } })(); // 橫式／直式：記住
  var dir8 = true; // 方向欄：8 方向（預設）／12 點鐘；不記憶（White 指定）
  var isImg = function (f) { return /^image\//i.test(f.type || '') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || ''); };
  var heic = function (f) { return App.pickIsHeic ? App.pickIsHeic(f) : /heic|heif/i.test((f.type || '') + (f.name || '')); };
  function onFiles() {
    var fs = Array.prototype.slice.call(this.files || []); this.value = '';
    var ok = fs.filter(function (f) { return isImg(f) && !heic(f); }), bad = fs.filter(function (f) { return ok.indexOf(f) < 0; });
    if (bad.length) { if (bad.some(heic)) alert(wrT('app.this_photo_is_in_heic')); else App.toast(wrT('app.is_not_a_photo', [bad[0].name || wrT('app.this_file')])); }
    if (!ok.length) return;
    if (!st) fresh();
    // 已經有一張讀好的小白單（或打開的是舊紀錄）→ 三隻寶寶＝開一張新的；還在同一張（沒存）時用「再加一張」
    if (st.model && (st.recId || !st.files.length || st.saved)) fresh();
    App.showTab('sius'); queueFiles(ok);
  }
  /* v3.1.0（White 2026-11-27 指定）：拍完→確定後先不讀，照片排在上面（可以再拍／再加、點 × 拿掉），按「開始分析」才一起讀。
   *   同一張單多拍幾次或整張＋分段拍都可以，越多張越準；最少 1 張。 */
  function queueFiles(fs) {
    build(); if (!st) fresh();
    if (st.busy || st.recId) return;
    fs.forEach(function (f) { st.files.push(f); try { st.urls.push(URL.createObjectURL(f)); } catch (e) { st.urls.push(''); } });
    st.sel = null; render();
    toast(wrT('sius.queued', [st.files.length - (st.nDone || 0)]), 2600);
  }
  function startAnalysis() { if (!st || st.busy) return; var n0 = st.nDone || 0; if (st.files.length <= n0) { toast(wrT('sius.need_photo'), 2400); return; } addFiles(null); }
  function dropPhoto(i) { if (!st || st.busy || i < (st.nDone || 0)) return; try { URL.revokeObjectURL(st.urls[i]); } catch (e) {} st.files.splice(i, 1); st.urls.splice(i, 1); render(); }
  function fresh() {
    if (st && st.busy) { st.cancel = true; stopAll(); }
    freeUrls();
    st = { model: null, ck: null, sel: null, recId: null, files: [], urls: [], passes: [], fbPasses: [], tgUser: null, edits: {}, subEd: {}, totEd: null, metaEd: {}, log: [], busy: false, cancel: false, gunAsked: false, timing: null, cur: 0, scope: 'all', t0: Date.now(), nDone: 0 };
    var a = $('siusAsk'); if (a) a.remove();
  }

  /* ---------- 畫面骨架（第一次進小白單畫面時建立） ---------- */
  function build() {
    if (built) return; built = true;
    root.innerHTML =
      '<div class="x-head"><div class="x-title"><svg class="nv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/></svg><span><b>' + esc(wrT('sius.title_short')) + '</b><small>' + esc(wrT('sius.v3_sub')) + '</small></span></div>' +
        '<span class="x-hbtn"><button type="button" class="wr-pill sius-trash" id="siusClear" hidden aria-label="' + esc(wrT('sius.clear')) + '" title="' + esc(wrT('sius.clear')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 12.2h9L17.5 7M10.3 10.5v5.6M13.7 10.5v5.6"/></svg></button>' +
        '<button type="button" class="wr-pill" id="siusNew" hidden>' + esc(wrT('sius.new')) + '</button></span></div>' +
      '<div class="sius-photos" id="siusPhotos" hidden></div>' +
      '<div class="sius-prog" id="siusProg" hidden role="status" aria-live="polite"><div class="sius-pbar"><i id="siusPbar"></i></div><span id="siusPtx"></span><button type="button" class="wr-pill" id="siusStop">' + esc(wrT('sius.ocr_cancel')) + '</button></div>' +
      '<div class="sius-gun" id="siusGun" hidden>' +
        '<div class="sius-tg wr-seg" id="siusTg" role="radiogroup" aria-label="' + esc(wrT('sius.target_type')) + '"><button type="button" role="radio" data-v="ar10">' + esc(wrT('core.10m_air_rifle')) + '</button><button type="button" role="radio" data-v="ap10">' + esc(wrT('core.10m_air_pistol')) + '</button></div>' +
        '<p class="sius-gnote" id="siusGnote"></p><p class="sius-warn" id="siusWarn" role="alert" hidden>' + esc(wrT('sius.gun_pistol_warn')) + '</p>' +
      '</div>' +
      '<div id="siusBody"></div>' +
      '<div class="sius-scrim" id="siusScrim" hidden></div><div class="sius-edit" id="siusEdit" hidden></div>' +
      '<div class="sius-bar" hidden><button type="button" class="sius-nav" id="siusPrev" aria-label="' + esc(wrT('sius.prev_problem')) + '">‹</button><span class="sius-cnt" id="siusCnt" aria-live="polite"></span><button type="button" class="sius-nav" id="siusNext" aria-label="' + esc(wrT('sius.next_problem')) + '">›</button><button type="button" class="sius-save" id="siusSave">' + esc(wrT('sius.save')) + '</button></div>';
    ['siusCam', 'siusPick', 'siusFile'].forEach(function (id) { var i = $(id); if (i) i.onchange = onFiles; });
    $('siusStop').onclick = function () { if (!st || !st.busy) return; st.cancel = true; if (st.abort) st.abort(); stopAll(); };
    $('siusClear').onclick = function () { if (!st || st.busy) return; ask(wrT('sius.clear_q'), function () { fresh(); render(); }); }; // v3.0.2：垃圾桶＝清除這次資料（先確認）
    $('siusScrim').onclick = function () { if (!st) return; st.sel = null; render(); }; // v3.0.2：點外面收回
    $('siusNew').onclick = function () { if (st && st.model && !st.recId && !st.saved) ask(wrT('sius.new_q'), function () { fresh(); render(); }); else { fresh(); render(); } };
    $('siusTg').querySelectorAll('button').forEach(function (b) { b.onclick = function () { if (st.busy) return; st.tgUser = b.dataset.v; if (st.model) { st.model.targetId = b.dataset.v; st.model.gun.unverified = b.dataset.v === 'ap10'; } recheck(); }; });
    $('siusPrev').onclick = function () { step(-1); }; $('siusNext').onclick = function () { step(1); };
    $('siusSave').onclick = save;
  }
  function defTg() { var a = App.acur; return a && (a.targetId === 'ap10' || a.targetId === 'ar10') ? a.targetId : 'ar10'; }
  function freeUrls() { if (st && st.urls) st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); }
  // open(rec)：rec＝分析頁的小白單紀錄（重新核對／修改）；沒給＝開一張新的。都會切到小白單畫面
  function open(rec) {
    build(); fresh();
    if (rec) {
      st.model = S.fromRecord(rec); st.recId = rec.id; st.tgUser = rec.targetId;
      var si = rec.sius || {}; if (si.athlete) st.model.athlete = si.athlete; if (si.lane) st.model.lane = si.lane; if (si.rep) st.rep0 = si.rep;
    }
    if (App.curTab !== 'sius') App.showTab('sius'); else recheck();
    window.scrollTo(0, 0);
  }
  function close() { if (st && st.busy) { st.cancel = true; stopAll(); } if (App.curTab === 'sius') App.showTab('analysis'); }
  function recheck() { if (!st) fresh(); st.ck = st.model ? CHK(st.model) : null; render(); }
  App.renderSius = function () { build(); if (!st) fresh(); recheck(); };

  /* ---------- 照片 → v3.0 beta 引擎（M6b＋補漏）→ 合併 ---------- */
  function addFiles(fs) {
    build(); if (!st) fresh();
    if (st.busy || st.recId) return;
    if (fs) fs.forEach(function (f) { st.files.push(f); try { st.urls.push(URL.createObjectURL(f)); } catch (e) { st.urls.push(''); } });
    var base = st.nDone || 0; fs = st.files.slice(base); if (!fs.length) return;
    st.busy = true; st.cancel = false; st.sel = null; render(); prog(0.02, 'load');
    var my = st, opt = {
      imgBase: base, targetId: st.tgUser || undefined, prior: st.passes.slice(),
      cancelled: function () { return my.cancel || st !== my; },
      onProgress: function (p, ph) { if (st === my) prog(p, ph); }
    };
    var eng = V3() && window.WRSiusX ? V3() : null, ocr = OCR();
    if (!eng && !ocr) { done(new Error('OCR')); return; }
    var fin = false; my.abort = function () { done({ cancel: true }); };
    var p = eng ? eng.run(fs, opt) : ocr.run(fs, { imgBase: base, cancelled: opt.cancelled, onProgress: prog });
    p.then(function (res) {
      if (st !== my || fin) return; fin = true; my.abort = null;
      if (my.cancel) { done({ cancel: true }); return; }
      my.passes = my.passes.concat(res.passes || []); my.fbPasses = my.fbPasses.concat(res.fbPasses || []);
      my.busy = false; stopAll(); my.nDone = my.files.length; my.skipped = res.timing && res.timing.skipped || 0;
      var tb = Date.now(), m = buildModel(my.passes, my.fbPasses);
      my.timing = res.timing ? JSON.parse(JSON.stringify(res.timing)) : null; if (my.timing) my.timing.build = Date.now() - tb; else my.timing = { total: Date.now() - my.t0 };
      my.timing.n = my.files.length;
      if (!m.shots.length) { my.files.splice(base); my.urls.splice(base).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); my.nDone = base; my.model = my.model && my.model.shots.length ? my.model : null; recheck(); toast(wrT('sius.ocr_none'), 4200); return; }
      my.model = m; my.sel = null; my.cur = 0; recheck();
      toast(my.ck.bad || my.ck.near ? wrT('sius.read_ok', [my.ck.nSighter, my.ck.nMatch, PROB(m, my.ck).length]) : wrT('sius.read_ok_all', [my.ck.nSighter, my.ck.nMatch]), 3600);
      if (!my.tgUser && !my.gunAsked && !(m.gun && m.gun.sure)) askGun(); else gunFlow();
    }, function (e) { if (st !== my) return; done(e); });
    function done(e) {
      if (fin) return; fin = true; my.abort = null;
      my.busy = false; stopAll(); // v3.1.0：取消／失敗時照片留著（還沒讀），可以再按「開始分析」
      if (st === my) render();
      if (e && e.cancel || my.cancel) toast(wrT('sius.cancelled'), 2400);
      else toast(wrT('sius.ocr_fail', [String(e && e.message || e).slice(0, 80)]), 5200);
    }
  }
  function prog(p, phase) {
    if (!built || !st) return;
    $('siusPbar').style.width = Math.round(p * 100) + '%';
    $('siusPtx').textContent = phase === 'load' ? wrT('sius.ocr_load') : phase === 'fallback' ? wrT('sius.ocr_fb', [Math.round(p * 100)]) : wrT('sius.ocr_read', [Math.round(p * 100), st.files.length]);
  }
  function keyOf(q) { return (q.sighter ? 'Q' : 'M') + q.n; }
  // 讀法合併成模型（v3.0 beta：M6b 為主＋現有引擎補紅燈／沒讀到的發），再套上使用者已經改過的地方（加照片重新合併時不會把手改的蓋掉）
  function buildModel(passes, fbPasses) {
    var m = V3() && XC() ? V3().build(passes, fbPasses || [], { targetId: st.tgUser || undefined }) : S.merge(passes, { targetId: st.tgUser || undefined });
    if (!st.tgUser && !m.gun.id) { m.targetId = defTg(); m.gun.unverified = m.targetId === 'ap10'; }
    m.shots = m.shots.filter(function (q) {
      var e = st.edits[keyOf(q)]; if (!e) return true; if (e.del) return false;
      for (var f in e) { q[f] = e[f]; q.fb = false; if (q.ocr) { q.ocr.conflict = (q.ocr.conflict || []).filter(function (c) { return c !== f; }); q.ocr.missing = false; } }
      return true;
    });
    for (var k in st.subEd) { while (m.subs.length <= +k) m.subs.push(null); m.subs[+k] = { dec: st.subEd[k].dec, inner: st.subEd[k].inner }; }
    if (st.totEd) m.total = { dec: st.totEd.dec, inner: st.totEd.inner };
    for (var f2k in st.metaEd) m[f2k] = st.metaEd[f2k];
    return m;
  }
  // 測試期回報：記下每一次修改（從什麼改成什麼）
  function logEd(what, from, to) { if (!st) return; if (st.log.length < 400) st.log.push({ k: what, from: from == null ? null : from, to: to == null ? null : to, at: Date.now() - st.t0 }); }
  function edit(q, f, v) {
    logEd((q.n != null ? keyOf(q) : '?') + '.' + f, q[f], v);
    q[f] = v; q.fb = false; q.ed = 1; q.okd = 0; // v3.0.2：改了值就要再按一次「保存」才算綠燈
    if (f === 'dec' || f === 'inner') { q.decCalc = 0; q.decSub = 0; if (q.n != null) { var kd = keyOf(q); (st.edits[kd] = st.edits[kd] || {}).decCalc = 0; st.edits[kd].decSub = 0; } } // v3.1.0：自己填的分數不再加底線
    if (q.ocr) { q.ocr.conflict = (q.ocr.conflict || []).filter(function (c) { return c !== f && !(f === 'inner' && c === 'dec'); }); q.ocr.missing = false; }
    if (q.n != null) { var k = keyOf(q); (st.edits[k] = st.edits[k] || {})[f] = v; st.edits[k].ed = 1; st.edits[k].okd = 0; }
  }

  /* ---------- 看不出是什麼靶：寶寶對話框 v1（White 2026-11-27 指定；概念圖 v296_bubble/bubble_v1.html） ----------
   * 寶寶嵌在泡泡左下角（黑眼睛、不加白色反光）、會眨眼、頭上跳紅色問號、眼睛往右上方的選項看；顏色跟目前主題。
   * 選項：10米空氣手槍／10米空氣步槍／50米步槍（50米灰色、標「施工中」、不能選）；從格式猜到的（整數＝手槍、小數＝步槍）排第一個並標「看起來像」。
   * 槍的線稿＝白幻仔自繪（照 ISSF 比賽槍型的外形特徵描，非描摹任何受版權保護的圖片）。 */
  var IGUN = {
    ap10: '<svg viewBox="0 0 100 58" aria-hidden="true"><path d="M27 13 H95 V19.5 H27 Z"/><path d="M90 13 V8.5 H93.5 V13"/><path d="M27 13 V8 H37 V13 M30.5 8 V10.5 H33.5 V8"/><path d="M46 19.5 H87 Q90.5 19.5 90.5 23.5 Q90.5 27.5 87 27.5 H46"/><path d="M82.5 19.5 V27.5"/><path d="M60 21.5 V25.5 M64 21.5 V25.5"/><path d="M27 19.5 V27 Q27 30 30 30 H46 V19.5"/><path d="M46 30 Q46 39 40 39.5 H35.5"/><path d="M40.5 30 Q41.5 33.5 39 36"/><path d="M27 21 C21 21 17.5 24.5 18 30 L15.5 49 Q15 54 19.5 54 H39 Q41.5 54 40.5 51 L37.5 49 C35.5 47 36 44.5 37 42.5 C35.6 41 35.6 39 36 37.5 L35.5 30"/><path d="M18.3 28 Q11 28.5 10.5 34 Q10.5 38 16.8 38.5"/><path d="M21.5 33 L19.8 47 M25 33 L23.5 47 M28.5 33 L27.2 47" stroke-width=".9" opacity=".55"/></svg>',
    ar10: '<svg viewBox="0 0 160 46" aria-hidden="true"><path d="M92 13.5 H146 V16.5 H92"/><path d="M145 11 H155 Q157 11 157 13 V17 Q157 19 155 19 H145 Z"/><path d="M151 11 V19" stroke-width=".9" opacity=".55"/><path d="M88 17 H137 Q141 17 141 21 Q141 25 137 25 H88"/><path d="M132 17 V25"/><path d="M58 11 H92 V19 H58 Z"/><path d="M60 11 V7 H72 V11"/><path d="M57 4 V10 M57 7 H60"/><circle cx="55.5" cy="7" r="3"/><path d="M66 19 V26 H90 V19"/><path d="M70 22.5 H86" stroke-width=".9" opacity=".55"/><path d="M58 19 L55 36 Q54.5 39 57.5 39 H63 L64.5 26 H66"/><path d="M66 26 Q72 26 72 31 Q72 34 67 34 H64"/><path d="M67.5 26 Q68.5 29 66.5 31"/><path d="M58 13 H20"/><path d="M25 13 V9 Q25 6.5 28 6.5 H44 Q48 6.5 49.5 9.5 L51 13"/><path d="M33 9.5 V13 M41 9.5 V13" stroke-width=".9" opacity=".55"/><path d="M55.5 21 H34 Q28 21 25 26 L20 33"/><path d="M17 4 Q12.5 4 12.5 9 V31 Q12.5 36 16 37.5"/><path d="M17 4 H20 V37 H16"/><path d="M20 17 H22 M20 26 H23"/></svg>',
    r50: '<svg viewBox="0 0 170 50" aria-hidden="true"><path d="M100 12 L156 13 V16.5 L100 17.5"/><path d="M155 10 H165 Q167 10 167 12 V17 Q167 19 165 19 H155 Z"/><path d="M161 10 V19" stroke-width=".9" opacity=".55"/><path d="M64 10.5 H100 V18 H64 Z"/><path d="M84 18 L87 23.5"/><circle cx="88" cy="24.5" r="1.8"/><path d="M66 10.5 V6 H78 V10.5"/><path d="M63 3 V9 M63 6 H66"/><circle cx="61.5" cy="6" r="3"/><path d="M72 18 V28 Q72 31 75 31 H118 Q122 31 122 27 V18 H100"/><path d="M80 31 V33 H116 V31"/><path d="M106 33 V39 H111 V33"/><path d="M64 18 L60 37 Q59.5 40 62.5 40 H67 L69 31 H72"/><path d="M60 22 Q54 21 51 25"/><ellipse cx="56" cy="17" rx="4.5" ry="2.6"/><path d="M70 31 Q72 35 68 37"/><path d="M64 12 H20 V27 H51"/><path d="M24 12 V8.5 Q24 6 27 6 H46 Q50 6 52 9 L54 12"/><path d="M20 27 L35 27"/><path d="M16 3 Q12 3 12 7 V31 Q12 38 18 42 Q24 45 28 44"/><path d="M16 3 H19 V33 Q19 37 23 39.5 L28 42"/><path d="M28 44 V42"/><path d="M19 13 H20 M19 24 H20"/></svg>'
  };
  function askGun() {
    var m = st.model; if (!m) return;
    st.gunAsked = true;
    var old = $('siusAsk'); if (old) old.remove();
    var guess = m.gun.guess === 'ap10' || m.gun.guess === 'ar10' ? m.gun.guess : null;
    var ord = ['ap10', 'ar10']; // 順序固定照 White 的寫法（手槍、步槍、50 米）；猜得到的那個標「比較像」
    var opts = ord.map(function (id) { return { id: id, name: wrT(id === 'ap10' ? 'sius.gun_ap10' : 'sius.gun_ar10'), like: id === guess }; }).concat([{ id: 'r50', name: wrT('sius.gun_r50'), wip: true }]);
    var bg = D.createElement('div'); bg.className = 'sius-ask'; bg.id = 'siusAsk'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-labelledby', 'siusAskQ');
    bg.innerHTML = '<div class="sius-ask-in"><div class="sius-bub"><p id="siusAskQ">' + esc(wrT('sius.gun_ask')) + '</p>' +
      '<div class="sius-ask-row"><b>' + esc(wrT('sius.gun_is')) + '</b><span>' + esc(wrT('sius.gun_tap')) + '</span></div><div class="sius-gopts">' +
      opts.map(function (o) { return '<button type="button" class="sius-gopt' + (o.like ? ' like' : '') + (o.wip ? ' wip' : '') + '" data-g="' + o.id + '"' + (o.wip ? ' aria-disabled="true"' : '') + '>' + (o.like ? '<em>' + esc(wrT('sius.gun_like')) + '</em>' : '') + (o.wip ? '<em>' + esc(wrT('coach.wip')) + '</em>' : '') + IGUN[o.id] + '<b>' + esc(o.name) + '<i>' + esc(wrT('sius.gun_qm')) + '</i></b></button>'; }).join('') +
      '</div><div class="sius-foot">' + esc(wrT('sius.gun_foot')) + '</div>' +
      '<div class="sius-baby" aria-hidden="true"><span class="sius-q">?</span><div class="eyes"><i></i><i></i></div><span class="blush l"></span><span class="blush r"></span></div></div></div>';
    D.body.appendChild(bg);
    bg.addEventListener('click', function (e) { if (e.target === bg) { /* 一定要選一個：點外面不關 */ var b = bg.querySelector('.sius-bub'); if (b && b.animate && D.body.classList.contains('fx-anim')) b.animate([{ translate: '0 0' }, { translate: '-6px 0' }, { translate: '6px 0' }, { translate: '0 0' }], { duration: 260 }); } });
    bg.querySelectorAll('.sius-gopt').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.g;
        if (g === 'r50') { toast(wrT('sius.gun_r50_wip'), 2600); return; }
        bg.remove(); pickGun(g);
      };
    });
    var f = bg.querySelector('.sius-gopt:not(.wip)'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
  }
  // 使用者選了槍種：照那個靶面重新合併（手槍只採用整數讀法）、重新核對，右上角靶種跟著換
  function pickGun(g) {
    st.tgUser = g;
    if (st.passes.length) st.model = buildModel(st.passes, st.fbPasses); else if (st.model) { st.model.targetId = g; st.model.gun.unverified = g === 'ap10'; }
    st.sel = null; recheck();
    toast(wrT('sius.gun_picked', [T(g).name]), 2600);
    gunFlow(g);
  }
  // 槍種：單子上讀到的跟分析頁目前的不一樣 → 右上角靶種跟著換（分析頁已有資料就先問）
  function gunFlow(force) {
    var m = st.model; if (!m || (!force && (st.tgUser || st.gunAsked))) return;
    var g = force || m.gun.id, a = App.acur; if (!g || !a) return;
    st.gunAsked = true;
    if (a.targetId === g) return;
    var nm = function (id) { return T(id).name; };
    var doSwitch = function () {
      if (a.sheets.length) { if (App.anaStartNew) App.anaStartNew(g, wrT('sius.gun_switched', [nm(g)])); }
      else if (!(App.isLocked && App.isLocked()) && App.anaChangeTarget) { App.anaChangeTarget(g); toast(wrT('sius.gun_switched', [nm(g)]), 3200); }
      if (App.syncTargetSel) App.syncTargetSel();
      if (App.curTab !== 'sius') App.showTab('sius'); else render();
    };
    if (a.sheets.length) ask(wrT('sius.gun_switch_q', [nm(g), nm(a.targetId)]), doSwitch, function () { st.tgUser = a.targetId; if (force && st.passes.length) st.model = m = buildModel(st.passes, st.fbPasses); m.targetId = a.targetId; m.gun.unverified = a.targetId === 'ap10'; recheck(); toast(wrT('sius.gun_kept', [nm(a.targetId)]), 3600); });
    else doSwitch();
  }

  /* ---------- 畫面 ---------- */
  var ARW = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  function g8(x, y) { var a = Math.atan2(y, x) * 180 / Math.PI; return ((Math.round(a / 45) % 8) + 8) % 8; } // 8 方向：沒有「置中」（跟小白單印的一樣）
  function dirCell(t, q) {
    if (q.x == null || q.y == null) return '–';
    if (dir8) return '<span class="a8" aria-label="' + esc(DW8(g8(q.x, q.y))) + '">' + ARW[g8(q.x, q.y)] + '</span>';
    var d = C.shotDir({ x: q.x, y: q.y }, C.ringWidth(t) * 0.1);
    return '<span class="ck">' + (d.centered ? esc(wrT('mods.centered_short')) : '<svg viewBox="-10 -10 20 20" aria-hidden="true"><g transform="rotate(' + (-d.angle).toFixed(1) + ')"><path d="M-6.5 0H5.5M1.8 -3.8L5.8 0L1.8 3.8" class="ar-ln"/></g></svg>' + esc(wrT('mods.clock', [d.clock]))) + '</span>';
  }
  function subTx(o) { return o ? f1(o.dec) + '-' + o.inner + '*' : '—'; }
  // 每 10 發一張卡：試射依序每 10 發一張（11 發＝10＋1），正射照每組（ck.series）
  function cardList() {
    var ck = st.ck, out = [], sg = ck.rows.filter(function (r) { return r.sighter; }), bl = [], cur = null;
    // v3.0.3：試射依組（序號跳回 1＝新的一組）分開，每組再每 10 發一張
    sg.forEach(function (r) { var b = st.model.shots[r.i].blk || 0; if (!cur || cur.b !== b) { cur = { b: b, rows: [] }; bl.push(cur); } cur.rows.push(r); });
    var multi = bl.length > 1;
    bl.forEach(function (B, bi) { for (var i = 0; i < B.rows.length; i += 10) out.push({ sighter: true, grp: multi ? i / 10 + 1 : out.length + 1, blk: multi ? bi + 1 : 0, rows: B.rows.slice(i, i + 10) }); });
    ck.series.forEach(function (s) { out.push({ sighter: false, grp: s.k + 1, s: s, rows: s.rows.map(function (i) { return ck.rows[i]; }).filter(Boolean) }); });
    return out;
  }
  function pnOf(q) { return q && q.pn != null ? q.pn : q && q.n; } // v3.0.3：畫面顯示單上印的序號（試射分好幾組時每組從 1 開始）
  function hasXY(q) { return q && q.x != null && q.y != null && isFinite(q.x) && isFinite(q.y); }
  function cardHTML(c, k, N, t) {
    var m = st.model, qs = c.rows.map(function (r) { return m.shots[r.i]; }), ok = qs.filter(hasXY);
    var wr = 0, wrIn = 0; var pis = t.id === 'ap10'; ok.forEach(function (q) { var sc = C.scoreShot(t, q.x, q.y); wr += useInt(q, pis) ? sc.ring : sc.dec; if (sc.inner) wrIn++; }); wr = Math.round(wr * 10) / 10;
    var miss = qs.length - ok.length + (c.s && c.s.rows.length < 10 && !c.sighter ? 10 - c.s.rows.length : 0);
    var nos = qs.map(function (q) { return pnOf(q); }).filter(function (n) { return n != null; }), a = nos[0], b = nos[nos.length - 1];
    var h = '<div class="x-card' + (c.sighter ? ' sg' : '') + (k === st.cur ? ' cur' : '') + '" data-card="' + k + '" role="group" aria-label="' + esc(wrT('sius.card_no', [k + 1, N])) + '">';
    h += '<div class="x-ch"><span>' + esc(wrT('sius.card_no', [k + 1, N])) + '</span>・<span>' + esc(c.sighter ? (c.blk ? wrT('sius.card_sgb', [c.blk, c.grp]) : wrT('sius.card_sg', [c.grp])) : wrT('sius.card_mt', [c.grp])) + '</span><span class="no">' + (a == null ? '' : esc(a === b ? wrT('sius.shot_a', [a]) : wrT('sius.shots_ab', [a, b]))) + '</span></div>';
    h += '<div class="x-tg"><svg class="target x-svg" data-xh="off" data-card="' + k + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(wrT('sius.target_aria')) + '"></svg>';
    h += '<div class="x-cat ' + (c.sighter ? 'sg' : 'mt') + '"><b>' + (c.sighter ? 'Sighting' : 'Match') + '</b>' + esc(c.sighter ? wrT('sius.cat_sg') : wrT('sius.cat_mt')) + '</div>';
    if (c.sighter) h += '<div class="x-sub"><small>' + esc(wrT('sius.sub_wr')) + '</small><b class="wr">' + fS(wr, pis) + '</b><i>' + wrIn + '*</i><span class="chk">' + esc(wrT('sius.sub_wr_n', [ok.length])) + '</span></div>';
    else {
      var s = c.s, pr = s.printed, same = pr && Math.abs(pr.dec - wr) < 0.05;
      h += '<button type="button" class="sius-gh sub x-sub' + (s.status === 'bad' ? ' bad' : s.status === 'ok' ? ' ok' : '') + (st.sel && st.sel.type === 'sub' && st.sel.k === s.k ? ' sel' : '') + '" data-sub="' + s.k + '"><small>' + esc(wrT('sius.sub_printed')) + '</small>' + (pr ? '<b>' + fS(pr.dec, pis) + '</b><i>' + pr.inner + '*</i>' : '<b class="na2">' + esc(wrT('sius.not_shot')) + '</b>') +
        '<span class="chk' + (same ? '' : ' w') + '">' + esc(same ? wrT('sius.sub_match') : wrT('sius.sub_diff', [ok.length, fS(wr, pis), pr ? fS(pr.dec - wr, pis) : '—'])) + '</span>' + (s.innerWarn && pr ? '<span class="x-iw">' + esc(wrT('sius.inner_warn', [s.sumPrinted.inner, pr.inner])) + '</span>' : '') + '</button>';
    }
    if (miss > 0) h += '<div class="x-miss">' + esc(wrT('sius.miss_n', [miss])) + '</div>';
    h += '</div>';
    h += '<div class="x-t sius-list" role="list"><div class="x-th" aria-hidden="true"><span></span><span>' + esc(wrT('sius.col_seq')) + '</span><span>' + esc(wrT('sius.col_time')) + '</span><span>' + esc(wrT('sius.col_score')) + '</span><span>X</span><span>Y</span><span>' + esc(wrT('sius.col_dir')) + '</span><span></span></div>';
    c.rows.forEach(function (r) { h += rowHTML(r, t); });
    h += '</div>';
    var stt = ok.length ? C.analyzeShots(t, ok.map(function (q) { return { x: q.x, y: q.y }; })) : null;
    h += '<div class="x-cf"><span>' + esc(wrT('sius.cf_avg')) + ' <b>' + (stt && stt.n ? f2(stt.avgDec) : '–') + '</b></span><span>' + esc(wrT('sius.cf_grp')) + ' <b>' + (stt && stt.n > 1 ? f1(stt.groupSize) + 'mm' : '–') + '</b></span><span>' + esc(wrT('sius.cf_in')) + ' <b>' + wrIn + '</b></span><span>' + esc(wrT('sius.cf_10')) + ' <b>' + ok.filter(function (q) { return C.scoreShot(t, q.x, q.y).ring >= 10; }).length + '</b></span></div>';
    return h + '</div>';
  }
  // v3.1.3（White 2026-11-27 20:46）：時間的問題不亮燈，只在時間旁打一個小時鐘記號（顏色跟主題；點那一發，編輯框會寫時間記號的原因）
  var TMK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3"/><path d="M8 4.6V8l2.4 1.6"/></svg>';
  function tMarkTx(r) { return (r.tMark || []).map(function (c) { return wrT({ tWarn: 'sius.tmk_twarn', 'miss:t': 'sius.tmk_miss', 'conflict:t': 'sius.tmk_cfl', dupT: 'sius.tmk_dup', tFix: 'sius.tmk_fix', notime: 'sius.tmk_miss' }[c] || 'sius.tmk_twarn'); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join('、'); }
  function tMarkHTML(r) { var tx = wrT('sius.tmk', [tMarkTx(r)]); return '<i class="x-tmk" role="img" title="' + esc(tx) + '" aria-label="' + esc(tx) + '">' + TMK + '</i>'; }
  function rowHTML(r, t) {
    var q = st.model.shots[r.i], sel = st.sel && st.sel.type === 'row' && st.sel.i === r.i ? ' sel' : '';
    var cf = function (f) { return r.conflict && r.conflict.indexOf(f) >= 0 ? ' cf' : ''; };
    var v = function (f, txt) { return q[f] == null || q[f] === '' ? NA() : '<span class="e">' + txt + '</span>'; };
    var lt = r.status === 'ok' ? '<i class="g"></i>' : r.status === 'near' ? '<button type="button" class="x-ym' + (r.orange ? ' o' : '') + '" data-why="' + r.i + '" aria-label="' + esc(wrT('sius.yellow_aria')) + '">!</button>' : '<i class="r"></i>';
    var lbl = wrT('sius.row_aria', [pnOf(q) == null ? '—' : pnOf(q), q.dec == null ? '—' : f1(q.dec), (r.status === 'ok' ? wrT('sius.st_ok') : r.status === 'near' ? wrT('sius.st_near') : wrT('sius.st_bad'))]);
    return '<div class="sius-row x-r ' + r.status + sel + (r.sighter ? ' sg' : '') + (r.missing ? ' miss' : '') + (q.fb ? ' fb' : '') + '" data-row="' + r.i + '" data-why="' + esc(whyCodes(r, q)) + '" role="listitem" tabindex="0" aria-label="' + esc(lbl) + '">' +
      '<span class="lt">' + lt + '</span><span class="n" data-f="n">' + (pnOf(q) == null ? '–' : pnOf(q)) + '</span>' +
      '<span class="tm' + (r.tMark ? ' tmk' : cf('t')) + '" data-f="t">' + v('t', esc(q.t)) + (r.tMark ? tMarkHTML(r) : '') + '</span>' +
      '<span class="sc' + cf('dec') + (q.decCalc || q.decSub ? ' calc' : '') + '" data-f="dec"' + (q.decCalc || q.decSub ? ' title="' + esc(wrT(q.decSub ? 'sius.why3_decsub' : 'sius.why3_deccalc')) + '"' : '') + '>' + v('dec', (q.dec == null ? '' : q.decCalc || q.decSub ? '<u>' + f1(q.dec) + '</u>' : f1(q.dec)) + (q.inner ? '*' : '') + (r.orange && r.calc ? '<small class="x-oc">' + esc(calcTx(q, r.calc)) + '</small>' : '') + (q.dec != null && !hasXY(q) ? '<small class="x-nxy">' + esc(wrT('sius.noxy_tag')) + '</small>' : '')) + '</span>' +
      '<span class="xy' + cf('x') + '" data-f="x">' + v('x', q.x == null ? '' : f2(q.x)) + '</span><span class="xy' + cf('y') + '" data-f="y">' + v('y', q.y == null ? '' : f2(q.y)) + '</span>' +
      '<span class="ar">' + dirCell(t, q) + '</span><span class="pe">' + PEN + '</span></div>';
  }
  function drawCard(svg, c, t) {
    var m = st.model, qs = c.rows.map(function (r) { return { q: m.shots[r.i], r: r }; }).filter(function (o) { return hasXY(o.q); }), mx = 0;
    qs.forEach(function (o) { mx = Math.max(mx, Math.abs(o.q.x), Math.abs(o.q.y)); });
    var E = Math.min(t.cardSize, Math.max(t.ringDiam[8] * 1.15, 2 * mx + t.pellet * 2 + 2)); // 依彈著範圍放大（靶面照 ISSF 尺寸，由 App.drawTarget 畫）
    App.drawTarget(svg, t, t.cardSize / E);
    var g = svg.querySelector('#marks'); if (!g) return;
    svg.querySelectorAll('[id]').forEach(function (e) { e.removeAttribute('id'); }); // 一個畫面好幾張靶：不留重複的 id
    var sw = E * 0.004, fs = Math.max(1.2, E * 0.032);
    if (qs.length > 1) { // 平均彈著點（綠十字）
      var cx = 0, cy = 0; qs.forEach(function (o) { cx += o.q.x; cy += o.q.y; }); cx /= qs.length; cy /= qs.length; var L = E * 0.035;
      App.el('path', { d: 'M' + (cx - L) + ' ' + (-cy) + 'H' + (cx + L) + 'M' + cx + ' ' + (-cy - L) + 'V' + (-cy + L), stroke: '#2bd16a', 'stroke-width': E * 0.009, 'stroke-linecap': 'round', fill: 'none' }, g);
    }
    qs.forEach(function (o) {
      var q = o.q, r = o.r, isSel = st.sel && st.sel.type === 'row' && st.sel.i === r.i, gg = App.el('g', { 'class': 'sius-hole' + (r.status === 'bad' ? ' bad' : r.status === 'near' ? ' near' : '') + (r.sighter ? ' sg' : '') }, g);
      App.el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2, fill: r.sighter ? 'rgba(120,120,120,.55)' : 'rgba(31,111,235,.6)', stroke: r.status === 'bad' ? '#e5192b' : r.status === 'near' ? '#ffb300' : r.sighter ? '#6b6b66' : '#1f6feb', 'stroke-width': r.status !== 'ok' || isSel ? sw * 3 : sw, 'stroke-dasharray': r.sighter ? (E * 0.012) + ' ' + (E * 0.008) : '' }, gg);
      var tx = App.el('text', { x: q.x, y: -q.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', stroke: '#0b1a2e', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx.textContent = pnOf(q) == null ? '' : pnOf(q);
      if (isSel) App.el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2 + E * 0.02, fill: 'none', stroke: '#ffb300', 'stroke-width': sw * 3, 'class': 'sius-selring' }, g);
      if (r.status === 'near') { // v3.1.0：黃燈的孔右上角加一個「!」記號
        var bx = q.x + t.pellet * 0.5, by = -q.y - t.pellet * 0.5, br = Math.max(fs * 0.62, E * 0.02);
        App.el('circle', { cx: bx, cy: by, r: br, fill: '#ffb300', stroke: '#fff', 'stroke-width': sw * 1.5, 'class': 'sius-ymk' }, gg);
        var mt = App.el('text', { x: bx, y: by, 'font-size': br * 1.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#3a2600', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg); mt.textContent = '!';
      }
    });
    // v3.1.0：只有一軸座標的發 → 依分數的環＋箭頭方向推另一軸，畫虛線「推估」孔（不是讀到的值、不算進分析）
    c.rows.forEach(function (r) {
      var q = m.shots[r.i]; if (!q || hasXY(q) || q.dec == null || !V3() || !V3().guessXY) return;
      var e = null; try { e = V3().guessXY(m, q); } catch (er) { e = null; } if (!e) return;
      var gg = App.el('g', { 'class': 'sius-hole est' }, g);
      App.el('circle', { cx: e.x, cy: -e.y, r: t.pellet / 2, fill: 'none', stroke: '#ffb300', 'stroke-width': sw * 2.5, 'stroke-dasharray': (E * 0.012) + ' ' + (E * 0.008) }, gg);
      var tx2 = App.el('text', { x: e.x, y: -e.y + t.pellet / 2 + fs * 0.75, 'font-size': fs * 0.8, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#7a4a00', stroke: '#fff', 'stroke-width': fs * 0.16, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx2.textContent = wrT('sius.est_tag', [pnOf(q) == null ? '' : pnOf(q)]);
    });
  }
  /* ---------- v3.1.0 站長工具（只有站長帳號看得到；WRSiusOwner）：保存解析檔（xx）、另存新檔（oo）、照片上傳 Drive ---------- */
  function OWN() { var o = window.WRSiusOwner; return o && o.isOwner() ? o : null; }
  function ownHTML() {
    var O = OWN(); if (!O || st.recId) return '';
    O.preload();
    var m = st.model, h = '<div class="sius-own" id="siusOwn" role="group" aria-label="' + esc(wrT('sius.own_title')) + '"><div class="sius-own-h"><b>' + esc(wrT('sius.own_title')) + '</b><small>' + esc(wrT('sius.own_only')) + '</small></div><div class="sius-own-b">';
    if (m) h += '<button type="button" class="wr-pill" id="siusOwnRaw">' + esc(wrT('sius.own_raw')) + '</button><button type="button" class="wr-pill" id="siusOwnAs">' + esc(wrT('sius.own_as')) + '</button>';
    if (m) h += '<button type="button" class="wr-pill" id="siusOwnKeep"' + (st.keeping ? ' disabled' : '') + '>' + esc(wrT(st.scanId ? 'sius.own_keep_upd' : 'sius.own_keep')) + '</button>'; // v3.1.2 原樣存檔
    if (m) h += '<button type="button" class="wr-pill" id="siusOwnRv"' + (st.rvBusy ? ' disabled' : '') + '>' + esc(wrT('sius.own_rv', [st.files.length])) + '</button>'; // v3.1.2 上傳檢視資料
    if (st.files.length) h += '<button type="button" class="wr-pill" id="siusOwnUp">' + esc(wrT('sius.own_up', [st.files.length])) + '</button>';
    if (!st.busy) h += '<button type="button" class="wr-pill" id="siusOwnList">' + esc(wrT('sius.own_list')) + '</button>';
    return h + '</div><small class="sius-own-st" id="siusOwnSt" aria-live="polite">' + esc(ownSt()) + '</small></div>';
  }
  function ownSt() { var O = OWN(); if (!O) return ''; if (st.ownMsg) return st.ownMsg; return !O.hasClient() ? wrT('sius.own_drive_pending') : O.connected() ? wrT('sius.own_drive_on', [O.ROOT_DIR + '/' + O.dirName()]) : wrT('sius.own_drive_off', [O.ROOT_DIR + '/' + O.dirName()]); }
  function ownMsg(t) { if (!st) return; st.ownMsg = t; var e = $('siusOwnSt'); if (e) e.textContent = t || ownSt(); }
  function rawModel() { // 引擎直接讀出來的結果（不套使用者改過的地方）
    if (!st.passes.length) return { m: st.model, ck: st.ck };
    var m0 = V3() && XC() ? V3().build(st.passes, st.fbPasses || [], { targetId: st.model ? st.model.targetId : st.tgUser || undefined }) : S.merge(st.passes, { targetId: st.tgUser || undefined });
    if (st.model && !m0.gun.id) m0.targetId = st.model.targetId;
    return { m: m0, ck: CHK(m0) };
  }
  function ownSave(kind) {
    var O = OWN(); if (!O || !st.model) return;
    var def = (kind === 'raw' ? 'xx' : 'oo') + O.stamp();
    O.askName(wrT(kind === 'raw' ? 'sius.own_raw_q' : 'sius.own_as_q'), def, function (nm) {
      var name = O.safeName(nm, def), r = kind === 'raw' ? rawModel() : { m: st.model, ck: st.ck };
      var txt = O.serialize(r.m, r.ck, kind === 'raw' ? 'raw' : 'edited', { app: App.APP_LABEL || '', photos: st.files.length });
      O.download(name, txt); toast(wrT('sius.own_saved', [name]), 3200);
      if (O.connected()) O.uploadText(name, txt).then(function (dir) { ownMsg(wrT('sius.own_up_file_ok', [name, dir])); }, function (e) { ownMsg(wrT('sius.own_up_fail', [String(e && e.message || e).slice(0, 60)])); });
    });
  }
  function ownUpload() {
    var O = OWN(); if (!O || !st.files.length) return;
    if (!O.hasClient()) { toast(wrT('sius.own_drive_pending'), 4200); return; }
    var files = st.files.slice(), b = $('siusOwnUp'); if (b) b.disabled = true;
    ownMsg(wrT('sius.own_connecting'));
    O.token(true).then(function () { return O.uploadPhotos(files, function (i, n) { ownMsg(wrT('sius.own_uploading', [i + 1, n])); }); }).then(function (r) {
      ownMsg(wrT('sius.own_up_ok', [r.n, r.dir])); toast(wrT('sius.own_up_ok', [r.n, r.dir]), 3600); if ($('siusOwnUp')) $('siusOwnUp').disabled = false;
    }, function (e) { var msg = String(e && e.message || e); ownMsg(wrT('sius.own_up_fail', [msg.slice(0, 60)])); if ($('siusOwnUp')) $('siusOwnUp').disabled = false; });
  }
  function bindOwn() {
    if (!$('siusOwn')) return;
    if ($('siusOwnRaw')) $('siusOwnRaw').onclick = function () { ownSave('raw'); };
    if ($('siusOwnAs')) $('siusOwnAs').onclick = function () { ownSave('as'); };
    if ($('siusOwnUp')) $('siusOwnUp').onclick = ownUpload;
    if ($('siusOwnKeep')) $('siusOwnKeep').onclick = ownKeep;
    if ($('siusOwnRv')) $('siusOwnRv').onclick = ownReview;
    if ($('siusOwnList')) $('siusOwnList').onclick = ownList;
  }
  /* ---------- v3.1.2（White 2026-11-27 20:12「把312推上去」）站長工具：原樣存檔／原樣檔清單／上傳檢視資料 ----------
   * 原樣存檔：這次掃描照原樣存在這台裝置（模型＋讀法＋手改紀錄＋照片），紅燈也可以存；之後「回小白單」繼續改、或「送分析」（有紅燈還是要先改好）。 */
  function jclone(o) { try { return JSON.parse(JSON.stringify(o == null ? null : o)); } catch (e) { return null; } }
  function scanLabel(m) { return [m.event || '', m.athlete || '', m.date || ''].filter(Boolean).join('・') || wrT('sius.title_short'); }
  function ownKeep() {
    var O = OWN(); if (!O || !st || !st.model || st.busy || st.keeping) return;
    var my = st, id = my.scanId || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), lt = lights(my.ck);
    var d = { id: id, v: 1, app: App.APP_LABEL || '', name: scanLabel(my.model), targetId: my.model.targetId, lights: lt,
      model: jclone(my.model), passes: jclone(my.passes) || [], fbPasses: jclone(my.fbPasses) || [], edits: jclone(my.edits) || {}, subEd: jclone(my.subEd) || {}, totEd: jclone(my.totEd), metaEd: jclone(my.metaEd) || {},
      tgUser: my.tgUser || null, timing: jclone(my.timing), log: jclone(my.log) || [], skipped: my.skipped || 0,
      photos: my.files.slice(0, my.nDone || my.files.length).map(function (f, i) { return { name: f.name || ('photo' + (i + 1) + '.jpg'), type: f.type || 'image/jpeg', blob: f }; }) };
    if (!d.model) { toast(wrT('sius.own_keep_fail', ['model']), 3600); return; }
    my.keeping = true; var kb = $('siusOwnKeep'); if (kb) kb.disabled = true;
    ownMsg(wrT('sius.own_keeping'));
    var fin = function () { my.keeping = false; var b = $('siusOwnKeep'); if (b && st === my) b.disabled = false; };
    O.scanPut(d).then(function () {
      my.scanId = id; fin(); toast(wrT('sius.own_kept', [lt.g, lt.y, lt.r, d.photos.length]), 3200);
      if (st !== my) return;
      ownMsg(wrT('sius.own_kept', [lt.g, lt.y, lt.r, d.photos.length]));
      var b = $('siusOwnKeep'); if (b) b.textContent = wrT('sius.own_keep_upd');
    }, function (e) { fin(); if (st === my) ownMsg(wrT('sius.own_keep_fail', [String(e && e.message || e).slice(0, 60)])); else toast(wrT('sius.own_keep_fail', [String(e && e.message || e).slice(0, 60)]), 3600); });
  }
  var openSeq = 0;
  function openScan(id, toAna) {
    var O = OWN(); if (!O || (st && st.busy)) return;
    var seq = ++openSeq;
    O.scanGet(id).then(function (d) {
      if (seq !== openSeq || (st && st.busy)) return;
      if (!d || !d.model) { toast(wrT('sius.own_scan_gone'), 3000); return; }
      build(); fresh();
      st.model = d.model; st.passes = d.passes || []; st.fbPasses = d.fbPasses || []; st.edits = d.edits || {}; st.subEd = d.subEd || {}; st.totEd = d.totEd || null; st.metaEd = d.metaEd || {};
      st.tgUser = d.tgUser || null; st.gunAsked = true; st.timing = d.timing || null; st.log = d.log || []; st.skipped = d.skipped || 0; st.scanId = d.id;
      st.files = (d.photos || []).filter(function (p) { return p && typeof Blob !== 'undefined' && p.blob instanceof Blob && p.blob.size > 0; }).map(function (p) { try { return new File([p.blob], p.name, { type: p.type }); } catch (e) { var b = p.blob; try { b.name = p.name; } catch (e2) {} return b; } });
      st.urls = st.files.map(function (f) { try { return URL.createObjectURL(f); } catch (e) { return ''; } }); st.nDone = st.files.length;
      st.ck = CHK(st.model);
      if (App.curTab !== 'sius') App.showTab('sius');
      recheck(); window.scrollTo(0, 0);
      if (toAna) save(); else toast(wrT('sius.own_reopened', [lights(st.ck).r, lights(st.ck).y]), 3000);
    }, function (e) { toast(wrT('sius.own_keep_fail', [String(e && e.message || e).slice(0, 60)]), 3600); });
  }
  function ownList() {
    var O = OWN(); if (!O) return;
    O.scanList().then(function (a) {
      var old = $('siusScans'); if (old) old.remove();
      var bg = D.createElement('div'); bg.className = 'modal-bg sius-own-bg'; bg.id = 'siusScans';
      var fmt = function (t) { var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
      var li = a.map(function (d) { var l = d.lights || {}; return '<li data-id="' + esc(d.id) + '"><b>' + esc(d.name || '') + '</b><small>' + esc(fmt(d.updated) + '・' + wrT('sius.own_scan_meta', [l.g || 0, l.y || 0, l.r || 0, (d.photos || []).length]) + (d.sent ? '・' + wrT('sius.own_scan_sent') : '')) + '</small><div class="sius-scan-b"><button type="button" class="wr-pill" data-act="open">' + esc(wrT('sius.own_scan_open')) + '</button><button type="button" class="wr-pill" data-act="ana">' + esc(wrT('sius.own_scan_ana')) + '</button><button type="button" class="wr-pill sius-scan-del" data-act="del">' + esc(wrT('sius.own_scan_del')) + '</button></div></li>'; }).join('');
      bg.innerHTML = '<div class="modal sius-own-modal sius-scans" role="dialog" aria-modal="true"><p></p><small class="sius-own-tip"></small><ul class="sius-scan-l"></ul><div class="row"><button type="button" class="no"></button></div></div>';
      bg.querySelector('p').textContent = wrT('sius.own_list_h'); bg.querySelector('.sius-own-tip').textContent = wrT('sius.own_list_tip', [O.MAX_SCANS]);
      bg.querySelector('ul').innerHTML = li || '<li class="empty">' + esc(wrT('sius.own_list_empty')) + '</li>';
      bg.querySelector('.no').textContent = wrT('h.close') || wrT('h.cancel');
      bg.querySelector('.no').onclick = function () { bg.remove(); };
      bg.addEventListener('click', function (e) {
        if (e.target === bg) { bg.remove(); return; }
        var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
        var row = b.closest('li'), id = row && row.dataset.id; if (!id) return;
        if (b.dataset.act === 'del') {
          ask(wrT('sius.own_scan_del_q'), function () {
            O.scanDel(id).then(function () {
              row.remove(); if (st && st.scanId === id) { st.scanId = null; var kb = $('siusOwnKeep'); if (kb) kb.textContent = wrT('sius.own_keep'); }
              var ul = bg.querySelector('ul'); if (ul && !ul.children.length) ul.innerHTML = '<li class="empty">' + esc(wrT('sius.own_list_empty')) + '</li>';
            }, function (e) { toast(wrT('sius.own_keep_fail', [String(e && e.message || e).slice(0, 60)]), 3600); });
          });
          return;
        }
        if (st && st.busy) return;
        var go = function () { bg.remove(); openScan(id, b.dataset.act === 'ana'); };
        if (st && st.model && !st.recId && !st.saved && (st.scanId !== id || st.log.length)) ask(wrT('sius.new_q'), go); else go();
      });
      D.body.appendChild(bg);
    }, function (e) { toast(wrT('sius.own_keep_fail', [String(e && e.message || e).slice(0, 60)]), 3600); });
  }
  // 上傳檢視資料：每發列表（JSON＋CSV）＋掃描用照片 → Drive 小白單/MMDD代號/，檔名前綴 rvMMDD_HHMMSS
  var LT = { ok: 'G', near: 'Y', bad: 'R' };
  function reviewPack(O, base) {
    var m = st.model, ck = st.ck, raw = null, rmap = {};
    try { raw = rawModel(); raw.m.shots.forEach(function (q) { if (q.n != null) rmap[keyOf(q)] = q; }); } catch (e) { raw = null; }
    var t = T(m.targetId), est = function (q) { if (hasXY(q) || q.dec == null || !V3() || !V3().guessXY) return null; try { return V3().guessXY(m, q); } catch (e) { return null; } };
    var rows = m.shots.map(function (q, i) {
      var r = ck.rows[i] || {}, o = q.ocr || {}, rq = q.n != null ? rmap[keyOf(q)] : null, e = est(q), fl = [];
      if (q.decCalc) fl.push('decCalc'); if (q.decSub) fl.push('decSub'); if (o.xyFix) fl.push('xyFix'); if (o.tFix) fl.push('tFix'); if (o.arrowFix) fl.push('arrowFix'); if (q.fb) fl.push('fb'); if (q.ed) fl.push('edited'); if (r.missing) fl.push('missing'); if (q.dec != null && !hasXY(q)) fl.push('noxy');
      return { i: i + 1, sec: q.sighter ? 'P' : 'M', blk: q.blk || 0, n: pnOf(q) == null ? '' : pnOf(q), s: q.sighter ? 1 : 0, d: q.dec == null ? '' : q.dec, in: q.inner ? 1 : 0, t: q.t || '', x: q.x == null ? '' : q.x, y: q.y == null ? '' : q.y,
        st: LT[r.status] || '', why: r.status === 'ok' ? '' : why(r, q), why_codes: whyCodes(r, q), flags: fl.join('|'), saved_st: q.lt0 || '', saved_why: q.why0 || '',
        est_x: e ? Math.round(e.x * 100) / 100 : '', est_y: e ? Math.round(e.y * 100) / 100 : '',
        raw_d: rq && rq.dec != null ? rq.dec : '', raw_t: rq ? rq.t || '' : '', raw_x: rq && rq.x != null ? rq.x : '', raw_y: rq && rq.y != null ? rq.y : '' };
    });
    var cols = ['i', 'sec', 'blk', 'n', 's', 'd', 'in', 't', 'x', 'y', 'st', 'why', 'why_codes', 'flags', 'saved_st', 'saved_why', 'est_x', 'est_y', 'raw_d', 'raw_t', 'raw_x', 'raw_y'];
    var photos = O.photoNames(base, st.files).map(function (nm, i) { return { i: i + 1, file: nm, read: i < (st.nDone || 0) - (st.skipped || 0) }; });
    var lt = lights(ck), j = { format: 'wrbeta-review', v: 1, base: base, created: new Date().toISOString(), app: App.APP_LABEL || '', engine: V3() && XC() ? 'v3' : 'main', targetId: m.targetId, target: t && t.name || '',
      event: m.event || '', date: m.date || '', lane: m.lane || '', practice: !!m.practice, intSheet: !!m.intSheet, lights: { green: lt.g, yellow: lt.y, red: lt.r },
      subs: (m.subs || []).map(function (s) { return s ? { score: s.dec, inner: s.inner } : null; }), total: m.total ? { score: m.total.dec, inner: m.total.inner } : null,
      photos: photos, skipped: st.skipped || 0, columns: cols, shots: rows, edits: (st.log || []).slice(0, 400) };
    return { json: JSON.stringify(j, null, 1), csv: O.toCsv(cols, rows) };
  }
  function ownReview() {
    var O = OWN(); if (!O || !st || !st.model || st.busy || st.rvBusy) return;
    if (!O.hasClient()) { toast(wrT('sius.own_drive_pending'), 4200); return; }
    var base = 'rv' + O.stamp(), pack, files = st.files.slice(), my = st;
    try { pack = reviewPack(O, base); } catch (e) { ownMsg(wrT('sius.own_up_fail', [String(e && e.message || e).slice(0, 60)])); return; }
    var b = $('siusOwnRv'); if (b) b.disabled = true; my.rvBusy = true;
    var fin = function () { my.rvBusy = false; if (st === my && $('siusOwnRv')) $('siusOwnRv').disabled = false; };
    ownMsg(wrT('sius.own_connecting'));
    O.token(true).then(function () { return O.uploadReview(base, pack, files, function (i, n) { if (st === my) ownMsg(wrT('sius.own_uploading', [i + 1, n])); }); }).then(function (r) {
      fin(); if (st === my) ownMsg(wrT('sius.own_rv_ok', [r.base, r.dir])); toast(wrT('sius.own_rv_ok', [r.base, r.dir]), 4200);
    }, function (e) { fin(); var t = wrT('sius.own_up_fail', [String(e && e.message || e).slice(0, 60)]); if (st === my) ownMsg(t); else toast(t, 3600); });
  }
  function metaVal(f) { var m = st.model; return m ? (m[f] || '') : ''; }
  function metaHTML(t) {
    var m = st.model, ck = st.ck, tt = ck.total, pis = t.id === 'ap10', nOk = 0, wr = 0, miss = 0;
    m.shots.forEach(function (q) { if (q.sighter) return; if (hasXY(q)) { nOk++; var sc = C.scoreShot(t, q.x, q.y); wr += useInt(q, pis) ? sc.ring : sc.dec; } else miss++; });
    wr = Math.round(wr * 10) / 10;
    var fld = function (f, lab, val, wide) { return '<button type="button" class="x-f' + (wide ? ' wide' : '') + '" data-meta="' + f + '"><small>' + esc(lab) + '</small><b>' + (val ? esc(val) : NA()) + '</b><span class="pen">' + PEN + '</span></button>'; };
    var h = '<div class="x-meta">' + fld('athlete', wrT('sius.f_athlete'), metaVal('athlete')) + fld('event', wrT('sius.f_event'), metaVal('event')) + fld('date', wrT('sius.f_date'), metaVal('date')) + fld('lane', wrT('sius.f_lane'), metaVal('lane'));
    var same = tt.printed && Math.abs(tt.printed.dec - wr) < 0.05;
    h += '<button type="button" class="x-f wide sius-gh tot' + (tt.status === 'bad' ? ' bad' : tt.status === 'ok' ? ' ok' : '') + (st.sel && st.sel.type === 'total' ? ' sel' : '') + '" data-total="1"><small>' + esc(wrT('sius.f_total')) + '</small><b>' + (tt.printed ? esc(subTx(tt.printed)) : NA()) + '　<span class="' + (same ? 'ok' : 'w') + '">' + esc(wrT('sius.f_total_wr', [nOk, fS(wr, pis)])) + (miss ? esc(wrT('sius.f_total_miss', [miss])) : '') + '</span></b><span class="pen">' + PEN + '</span></button></div>';
    return h;
  }
  function render() {
    if (!built || !st) return;
    var m = st.model, ck = st.ck;
    D.body.classList.toggle('sius-has', !!m); D.body.classList.toggle('sius-busy', !!st.busy);
    $('siusNew').hidden = !m || st.busy; $('siusClear').hidden = !(m || st.files.length) || st.busy;
    var ph = $('siusPhotos'), hp = st.files.length && !st.recId;
    ph.hidden = !hp;
    var nD = st.nDone || 0, nP = st.files.length - nD; // v3.1.0：nP＝排好還沒讀的照片
    ph.classList.toggle('pend', nP > 0 && !st.busy);
    if (hp) ph.innerHTML = '<div class="sius-pr"><span class="sius-pn">' + esc(wrT('sius.photos_n', [st.files.length])) + '</span>' + st.urls.map(function (u, i) { return u ? '<span class="sius-th' + (i >= nD ? ' new' : '') + '"><img src="' + esc(u) + '" alt="' + (i + 1) + '">' + (i >= nD && !st.busy ? '<button type="button" class="sius-thx" data-drop="' + i + '" aria-label="' + esc(wrT('sius.drop_photo', [i + 1])) + '">×</button>' : '') + '</span>' : ''; }).join('') + (st.busy ? '' : '<label class="sius-add">' + esc(wrT('sius.add_more')) + '<input type="file" id="siusAdd" accept="image/*" multiple hidden></label>') + '</div>' +
      (nP > 0 && !st.busy ? '<p class="sius-mhint">' + esc(wrT('sius.multi_hint')) + '</p><button type="button" class="sius-go" id="siusGo">' + esc(wrT(m ? 'sius.go_more' : 'sius.go', [nP])) + '</button>' : (st.skipped && !st.busy ? '<p class="sius-mhint">' + esc(wrT('sius.skipped_n', [st.skipped])) + '</p>' : ''));
    var add = ph.querySelector('.sius-add input'); if (add) add.onchange = function () { var fs = Array.prototype.slice.call(this.files || []); this.value = ''; fs = fs.filter(function (f) { return isImg(f) && !heic(f); }); if (fs.length) queueFiles(fs); };
    ph.querySelectorAll('[data-drop]').forEach(function (b) { b.onclick = function () { dropPhoto(+b.dataset.drop); }; });
    if ($('siusGo')) $('siusGo').onclick = startAnalysis;
    $('siusProg').hidden = !st.busy;
    var tg = m ? m.targetId : (st.tgUser || defTg()), t = T(tg);
    $('siusTg').querySelectorAll('button').forEach(function (b) { var o = b.dataset.v === tg; b.classList.toggle('on', o); b.setAttribute('aria-checked', o ? 'true' : 'false'); b.disabled = st.busy; });
    $('siusGun').hidden = !m;
    var gn = '';
    if (m && !st.recId) gn = m.gun.id && !st.tgUser ? wrT('sius.gun_auto', [m.event || T(m.gun.id).name]) : !m.gun.id ? wrT('sius.gun_none') : '';
    $('siusGnote').textContent = gn; $('siusGnote').hidden = !gn;
    $('siusWarn').hidden = !(m && tg === 'ap10');
    var h = '', cards = m ? cardList() : [], N = cards.length;
    if (!m && st.files.length) h = ownHTML(); // 照片排好了：上面就是「開始分析」
    else if (!m) h = st.busy ? '' : '<div class="x-empty"><span class="wrx-hat lg" aria-hidden="true">' + HAT + '</span><b>' + esc(wrT('sius.empty_h')) + '</b><p>' + esc(wrT('sius.empty_p')) + '</p><p class="s">' + esc(wrT('sius.tips')) + '</p></div>' + ownHTML(); // v3.1.2：空白時站長也能打開原樣檔
    else {
      if (st.cur >= N) st.cur = Math.max(0, N - 1);
      h += metaHTML(t);
      var nS = cards.filter(function (c) { return c.sighter; }).length;
      h += '<div class="sius-sum' + (ck.bad ? ' bad' : '') + '">' + wrT('sius.summary', [ck.nSighter, ck.nMatch, ck.bad ? '<b class="sius-bad">' + esc(wrT('sius.n_bad', [ck.bad])) + '</b>' : '<b class="sius-ok">' + esc(wrT('sius.all_ok')) + '</b>', ck.near ? '<b class="sius-near">' + esc(wrT('sius.n_near_v3', [ck.near])) + '</b>' : '']) + '</div>';
      h += ownHTML();
      if (m.practice) h += '<div class="sius-xmiss sius-prac" role="note"><b>' + esc(wrT('sius.practice_h')) + '</b><small>' + esc(wrT('sius.practice_p')) + (m.notShot && m.notShot.length ? ' ' + m.notShot.map(function (o) { return wrT(cards.some(function (c) { return c.blk; }) ? 'sius.not_shot_blk' : 'sius.not_shot_lead', [o.blk + 1, o.to]); }).join(' ') : '') + '</small></div>';
      if (m.countHint && !m.practice) h += '<div class="sius-xmiss" role="note"><small>' + esc(wrT('sius.count_hint', [m.countHint.header, m.countHint.got])) + '</small></div>';
      if (ck.subMissing && ck.subMissing.length && st.files.length >= 2) h += '<div class="sius-xmiss" role="note"><b>' + esc(ck.subMissing.map(function (n) { return wrT('sius.sub_missing', [n]); }).join(' / ')) + '</b><small>' + esc(wrT('sius.sub_missing_hint')) + '</small></div>';
      h += '<div class="x-tools"><div class="wr-seg mini" id="siusView" role="radiogroup" aria-label="' + esc(wrT('sius.view_aria')) + '"><button type="button" role="radio" data-v="h" class="' + (view === 'h' ? 'on' : '') + '" aria-checked="' + (view === 'h') + '">' + esc(wrT('sius.view_h')) + '</button><button type="button" role="radio" data-v="v" class="' + (view === 'v' ? 'on' : '') + '" aria-checked="' + (view === 'v') + '">' + esc(wrT('sius.view_v')) + '</button></div>' +
        '<span class="x-dirl">' + esc(wrT('sius.dir_lbl')) + '</span><div class="wr-seg mini" id="siusDir" role="radiogroup" aria-label="' + esc(wrT('sius.dir_lbl')) + '"><button type="button" role="radio" data-v="8" class="' + (dir8 ? 'on' : '') + '" aria-checked="' + dir8 + '">' + esc(wrT('sius.dir_8')) + '</button><button type="button" role="radio" data-v="12" class="' + (dir8 ? '' : 'on') + '" aria-checked="' + !dir8 + '">' + esc(wrT('sius.dir_12')) + '</button></div></div>';
      if (view === 'h') h += '<div class="x-prog" id="siusPg"><div class="bar">' + cards.map(function (c, i) { return '<i data-go="' + i + '" class="' + (i === st.cur ? 'on' : i < st.cur ? 'done' : c.sighter ? 'sg' : '') + (c.rows.some(function (r) { return r.status === 'bad'; }) ? ' bad' : '') + '"></i>'; }).join('') + '</div><b>' + (st.cur + 1) + ' / ' + N + '</b></div>';
      else h += '<div class="x-dh">' + esc(wrT('sius.all_cards', [N])) + '<small>' + esc(wrT('sius.v_sub', [nS, N - nS])) + '</small></div>';
      h += '<div class="x-rail" id="siusRail">' + cards.map(function (c, k) { return cardHTML(c, k, N, t); }).join('') + '</div>';
      h += view === 'h' ? '<div class="x-sw">' + esc(wrT('sius.swipe')) + '<span>' + esc(wrT('sius.tap_edit')) + '</span></div>' : '<div class="x-note">' + esc(wrT('sius.v_note')) + '</div>';
      // 分析頁的分析（統計＋分析模塊）：全部正射／這一張
      h += '<div class="card x-ana"><div class="x-anah"><b id="siusStatsTitle"></b><div class="wr-seg mini" id="siusScope" role="radiogroup"><button type="button" role="radio" data-v="all" class="' + (st.scope === 'all' ? 'on' : '') + '">' + esc(wrT('sius.scope_all')) + '</button><button type="button" role="radio" data-v="card" class="' + (st.scope === 'card' ? 'on' : '') + '">' + esc(wrT('sius.scope_card')) + '</button></div></div><div class="stats" id="siusStats"></div></div><div id="siusMods" class="ana-mods"></div>';
      if (st.timing) h += '<p class="sius-time" id="siusTime">' + esc(timingTx(st.timing)) + '</p>';
      h += '<p class="sius-foot">' + esc(wrT('sius.foot')) + '</p>';
    }
    root.classList.toggle('v', view === 'v'); root.classList.toggle('h', view !== 'v');
    $('siusBody').innerHTML = h; bindOwn();
    if (m) {
      var rail = $('siusRail');
      rail.querySelectorAll('svg.x-svg').forEach(function (svg) { var k = +svg.dataset.card; drawCard(svg, cards[k], t); });
      bindBody(cards, t);
      if (view === 'h') { var cc = rail.children[st.cur]; if (cc) rail.scrollLeft = cc.offsetLeft - (rail.clientWidth - cc.offsetWidth) / 2; }
      renderAna(cards, t);
    }
    var pr = m ? PROB(m, ck) : [];
    $('siusCnt').textContent = !m ? '' : ck.bad ? wrT('sius.red_n', [ck.bad]) : pr.length ? wrT('sius.problems_n', [pr.length]) : wrT('sius.problems_0');
    $('siusPrev').disabled = $('siusNext').disabled = !pr.length || st.busy;
    var sv = $('siusSave'); sv.disabled = !m || st.busy || !ck.nMatch && !ck.nSighter; sv.classList.toggle('blocked', !!(m && ck.bad)); sv.setAttribute('aria-disabled', m && ck.bad ? 'true' : 'false');
    root.querySelector('.sius-bar').hidden = !m;
    renderEdit();
  }
  function timingTx(tm) {
    var s = function (v) { return v == null ? '—' : (v / 1000).toFixed(1); }, x = tm.m6b || {};
    return wrT('sius.timing', [s(x.total), s(tm.fallback), s(tm.total), tm.n || 1]) + (x.total ? wrT('sius.timing_parts', [s(x.decode), s(x.orient), s(x.segment), s(x.ocr)]) : '');
  }
  function setCur(k, scroll) {
    if (k === st.cur) return; st.cur = k;
    var bar = $('siusPg'); if (bar) { bar.querySelectorAll('i').forEach(function (i, j) { i.classList.toggle('on', j === k); i.classList.toggle('done', j < k); }); bar.querySelector('b').textContent = (k + 1) + ' / ' + bar.querySelectorAll('i').length; }
    $('siusRail').querySelectorAll('.x-card').forEach(function (c, j) { c.classList.toggle('cur', j === k); });
    if (scroll) { var rail = $('siusRail'), cc = rail.children[k]; if (cc) try { rail.scrollTo({ left: cc.offsetLeft - (rail.clientWidth - cc.offsetWidth) / 2, behavior: D.body.classList.contains('fx-anim') ? 'smooth' : 'auto' }); } catch (e) { rail.scrollLeft = cc.offsetLeft; } }
    if (st.scope === 'card') renderAna(cardList(), T(st.model.targetId));
  }
  function bindBody(cards, t) {
    var body = $('siusBody');
    body.querySelectorAll('#siusView button').forEach(function (b) { b.onclick = function () { view = b.dataset.v; try { store.set('wr_sius_view', view); } catch (e) {} render(); }; });
    body.querySelectorAll('#siusDir button').forEach(function (b) { b.onclick = function () { dir8 = b.dataset.v === '8'; render(); }; });
    body.querySelectorAll('#siusScope button').forEach(function (b) { b.onclick = function () { st.scope = b.dataset.v; render(); }; });
    body.querySelectorAll('#siusPg i[data-go]').forEach(function (i) { i.onclick = function () { setCur(+i.dataset.go, true); }; });
    body.querySelectorAll('[data-row]').forEach(function (b) {
      var go = function (e) { var c = b.closest('.x-card'); if (c && view === 'h') setCur(+c.dataset.card, true); var fe = e && e.target.closest && e.target.closest('[data-f]'); pick({ type: 'row', i: +b.dataset.row, f: fe ? fe.dataset.f : null }); };
      b.onclick = function (e) { if (e.target.closest('.x-ym')) return; go(e); };
      b.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } };
    });
    body.querySelectorAll('.x-ym').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var i = +b.dataset.why, r = st.ck.rows[i]; toast(wrT('sius.yellow_tip', [why(r, st.model.shots[i])]), 4200); pick({ type: 'row', i: i }); }; });
    body.querySelectorAll('[data-sub]').forEach(function (b) { b.onclick = function () { pick({ type: 'sub', k: +b.dataset.sub }); }; });
    body.querySelectorAll('[data-total]').forEach(function (b) { b.onclick = function () { pick({ type: 'total' }); }; });
    body.querySelectorAll('[data-meta]').forEach(function (b) { b.onclick = function () { pick({ type: 'meta', f: b.dataset.meta }); }; });
    var rail = $('siusRail'), tm = null;
    if (view === 'h') rail.onscroll = function () { clearTimeout(tm); tm = setTimeout(function () { var mid = rail.scrollLeft + rail.clientWidth / 2, best = 0, bd = 1e9; [].forEach.call(rail.children, function (c, j) { var d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = j; } }); setCur(best, false); }, 90); };
    else rail.onscroll = null;
  }
  // 分析頁的分析功能（統計＋分析模塊）：全部正射或目前這一張；方向模塊跟著 8 方向／12 點鐘切換
  function DW8(i) { return [wrT('sius.dir8_0'), wrT('sius.dir8_1'), wrT('sius.dir8_2'), wrT('sius.dir8_3'), wrT('sius.dir8_4'), wrT('sius.dir8_5'), wrT('sius.dir8_6'), wrT('sius.dir8_7')][i] || ''; }
  function renderAna(cards, t) {
    var box = $('siusStats'), mods = $('siusMods'); if (!box || !mods) return;
    var m = st.model, pick2 = st.scope === 'card' && cards[st.cur] ? [cards[st.cur]] : cards.filter(function (c) { return !c.sighter; });
    if (!pick2.length && cards.length) pick2 = [cards[st.cur] || cards[0]];
    var set = [];
    pick2.forEach(function (c) { c.rows.forEach(function (r) { var q = m.shots[r.i]; if (!hasXY(q)) return; set.push({ q: { x: +q.x, y: +q.y, t: q.t || '', n: q.n }, color: c.sighter ? '#8a8a8a' : '#1f6feb', sheet: '', i: q.n == null ? set.length + 1 : q.n }); }); });
    var stt = C.analyzeShots(t, set.map(function (x) { return x.q; }));
    var one = st.scope === 'card';
    $('siusStatsTitle').textContent = one ? wrT('sius.stats_card', [st.cur + 1]) : wrT('sius.stats_all', [set.length]);
    try { App.renderStats(box, t, stt); } catch (e) { box.innerHTML = ''; }
    var h = ''; try { h = App.anaExtraHTML ? App.anaExtraHTML(t, stt, set, true) : ''; } catch (e) { h = ''; }
    mods.innerHTML = h;
    mods.querySelectorAll('[data-mod="sius"]').forEach(function (e) { e.remove(); }); // 小白單核對卡是給分析頁看的（這裡上面就是）
    var dm = mods.querySelector('[data-mod="dir"]');
    if (dm) {
      var ct = dm.querySelector('.ana-ct'); if (ct) ct.insertAdjacentHTML('beforeend', '<span class="wrx-dirtag">' + esc(dir8 ? wrT('sius.dir_8') : wrT('sius.dir_12')) + '</span>');
      if (dir8) {
        dm.querySelectorAll('.mod-chip').forEach(function (ch, k) {
          var x = stt.shots[k]; if (!x) return; var i8 = g8(x.x, x.y), svg = ch.querySelector('svg.mod-arr');
          if (svg) svg.innerHTML = '<g transform="rotate(' + (-i8 * 45) + ')"><path d="M-6.5 0H5.5M1.8 -3.8L5.8 0L1.8 3.8" class="ar-ln"/></g>';
          var dc = ch.querySelector('.dc'); if (dc) dc.textContent = DW8(i8);
        });
        var nt = dm.querySelector('.mod-note'); if (nt) nt.textContent = wrT('sius.dir8_note');
      }
    }
    try { if (App.mods && App.mods.after) App.mods.after(mods); } catch (e) {}
  }

  /* ---------- 單手修正 ---------- */
  function pick(sel) {
    st.sel = sel; render();
    var b = $('siusBody'), el = sel.type === 'row' ? b.querySelector('[data-row="' + sel.i + '"]') : sel.type === 'sub' ? b.querySelector('[data-sub="' + sel.k + '"]') : sel.type === 'meta' ? b.querySelector('[data-meta="' + sel.f + '"]') : b.querySelector('[data-total]');
    if (sel.type === 'row' && el && view === 'h') { var c = el.closest('.x-card'); if (c) setCur(+c.dataset.card, true); }
    if (sel.type === 'sub' && el && view === 'h') { var c2 = el.closest('.x-card'); if (c2) setCur(+c2.dataset.card, true); }
    if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    // v3.0.1（White 2026-11-27）：打開編輯面板不自動 focus（不跳鍵盤），使用者點欄位才叫鍵盤；上一個／下一個也一樣
  }
  function step(d) {
    if (!st || !st.model) return;
    var pr = PROB(st.model, st.ck); if (!pr.length) return;
    var key = function (p) { return p.type + ':' + (p.i != null ? p.i : p.k != null ? p.k : ''); }, cur = st.sel ? key(st.sel) : null, idx = -1;
    pr.forEach(function (p, j) { if (key(p) === cur) idx = j; });
    var nx = idx < 0 ? (d > 0 ? 0 : pr.length - 1) : (idx + d + pr.length) % pr.length;
    pick(pr[nx]);
  }
  function fld(id, label, val, mode, bad) { return '<label class="sius-f' + (bad ? ' bad' : '') + '"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(val == null ? '' : val) + '" inputmode="' + (mode || 'decimal') + '" autocomplete="off" spellcheck="false"' + (val == null || val === '' ? ' placeholder="' + esc(wrT('sius.not_shot')) + '"' : '') + '></label>'; }
  function tgl(id, label, onv) { return '<button type="button" class="sius-tglb' + (onv ? ' on' : '') + '" id="' + id + '" role="switch" aria-checked="' + (onv ? 'true' : 'false') + '">' + esc(label) + '</button>'; }
  function num(v) { v = String(v).replace(/,/g, '.').replace(/[−–—]/g, '-').replace(/\s+/g, '').trim(); return v === '' || isNaN(+v) ? null : +v; }
  // 時間輸入：「1234.56」「12:34.56」「12.34.56」都接受 → mm:ss.ss；看不懂就照原樣（會標黃）
  function normT(v) { v = String(v).trim(); var m = v.replace(/[^\d]/g, ''); if (/^\d{6}$/.test(m)) return m.slice(0, 2) + ':' + m.slice(2, 4) + '.' + m.slice(4); if (/^\d{5}$/.test(m)) return '0' + m.slice(0, 1) + ':' + m.slice(1, 3) + '.' + m.slice(3); return v; }
  var WHY3 = { dupT: 'sius.why3_dupt', sReads: 'sius.why3_sreads', fieldW: 'sius.why3_fieldw', sub: 'sius.why3_sub', xyAlt: 'sius.why3_xyalt', inner: 'sius.why3_inner', 'sign:x': 'sius.why3_sign', 'sign:y': 'sius.why3_sign', fb: 'sius.why3_fb', arrow: 'sius.why3_arrow', arrowFix: 'sius.why3_arrowfix', demo: 'sius.why3_demo', miss: 'sius.why3_miss', practiceGap: 'sius.why3_pgap', tFix: 'sius.why3_tfix', xyFix: 'sius.why3_xyfix', decSub: 'sius.why3_decsub', decCalc: 'sius.why3_deccalc', noxy: 'sius.why_noxy', scoreWins: 'sius.why3_scorewins', notime: 'sius.why3_notime', soft: 'sius.why3_soft' };
  function whyArg(w, q) { // v3.0.3：箭頭改值要列出原本讀到的
    if (w === 'arrowFix') { var o = q && q.ocr && q.ocr.arrowFix, f = o && o.from || {}; return [f.x == null ? '–' : f2(f.x), f.y == null ? '–' : f2(f.y), q.x == null ? '–' : f2(q.x), q.y == null ? '–' : f2(q.y)]; }
    if (w === 'xyFix') { var xf = q && q.ocr && q.ocr.xyFix, fr = xf && xf.from || {}; return [fr.x == null ? '–' : f2(fr.x), fr.y == null ? '–' : f2(fr.y), q.x == null ? '–' : f2(q.x), q.y == null ? '–' : f2(q.y)]; }
    if (w === 'tFix') { var tf = q && q.ocr && q.ocr.tFix; return [tf && tf.from || '–', q.t || '–']; }
    if (w === 'arrow') { var a = q && q.ocr && q.ocr.arw; var ix = a && a.dir ? ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'].indexOf(a.dir) : -1; return [ix >= 0 ? a.dir + ' ' + DW8(ix) : '?']; }
    return [w.slice(5).toUpperCase()];
  }
  function why(r, q) {
    if (r.status === 'ok') return r.cons && r.cons.length ? wrT('sius.why_cons') : wrT('sius.why_ok');
    if (r.missing) return wrT('sius.why_missing');
    if (r.miss && r.miss.indexOf('xy') >= 0) return wrT('sius.why_noxy');
    if (r.miss && r.miss.indexOf('dec') >= 0) return wrT('sius.why_nodec');
    if (r.orange && r.calc) return wrT('sius.why_orange', [q.decInt ? String(q.dec) : f1(q.dec), calcTx(q, r.calc)]); // v3.0.2 橘燈：兩個分數都列出
    if (r.diff >= 0.2) return wrT('sius.why_diff', [q.decInt ? String(q.dec) : f1(q.dec), calcTx(q, r.calc), q.decInt ? String(Math.round(r.diff)) : f1(r.diff)]);
    if (r.diff === 0.1) return wrT('sius.why_near', [f1(q.dec), calcTx(q, r.calc)]);
    if (r.innerOk === false) return wrT('sius.why_inner');
    if (r.conflict && r.conflict.length) return wrT('sius.why_conflict', [r.conflict.map(function (c) { return { x: wrT('sius.cf_x'), y: wrT('sius.cf_y'), dec: wrT('sius.cf_dec'), t: wrT('sius.cf_t') }[c] || c; }).join('、')]);
    if (r.arrowWarn && !(r.why && r.why.length)) return wrT('sius.why3_arrow', whyArg('arrow', q));
    if (r.why && r.why.length) return r.why.map(function (w) { return wrT(WHY3[w] || WHY3[String(w).split(':')[0]] || 'sius.why_time', whyArg(w, q)); }).join('；');
    if (r.miss && r.miss.indexOf('t') >= 0) return wrT('sius.why_notime');
    return wrT('sius.why_time');
  }
  function SAVEB() { return '<button type="button" class="sius-done" id="siusEDone">' + esc(wrT('sius.save_one')) + '</button>'; }
  var META = { athlete: 'sius.f_athlete', event: 'sius.f_event', date: 'sius.f_date', lane: 'sius.f_lane' };
  function renderEdit() {
    var box = $('siusEdit'), m = st && st.model, sel = st && st.sel;
    var scr0 = $('siusScrim'); if (scr0) scr0.hidden = true; document.body.classList.remove('sius-ed');
    if (!m || !sel || st.busy) { box.hidden = true; box.innerHTML = ''; D.body.classList.remove('sius-editing'); return; }
    var h = '';
    if (sel.type === 'row') {
      var r = st.ck.rows[sel.i], q = m.shots[sel.i]; if (!r) { st.sel = null; box.hidden = true; return; }
      h += '<div class="sius-eh"><b>' + esc(r.sighter ? (st.model.shots.some(function (x) { return x.sighter && x.blk; }) ? wrT('sius.edit_sighter_b', [(st.model.shots[r.i].blk || 0) + 1, pnOf(st.model.shots[r.i])]) : wrT('sius.edit_sighter', [st.ck.rows.filter(function (x) { return x.sighter && x.i <= r.i; }).length])) : wrT('sius.edit_shot', [r.no])) + '</b><small class="' + (r.orange ? 'or' : r.status) + '">' + esc(why(r, q)) + '</small>' + whyLine(r, q) + '</div>';
      var bad = function (f) { return (r.conflict || []).indexOf(f) >= 0 || (f === 'x' || f === 'y') && (r.miss || []).indexOf('xy') >= 0 && q[f] == null || f === 'dec' && q.dec == null; };
      h += '<div class="sius-fs">' + fld('siusFDec', wrT('sius.col_score'), q.dec == null ? '' : f1(q.dec), 'decimal', bad('dec')) + fld('siusFT', wrT('sius.col_time'), q.t, 'decimal', bad('t')) + fld('siusFX', 'X (mm)', q.x == null ? '' : f2(q.x), 'text', bad('x')) + fld('siusFY', 'Y (mm)', q.y == null ? '' : f2(q.y), 'text', bad('y')) + '</div>';
      var alt = q.ocr && q.ocr.alt, ah = '';
      if (alt) ['dec', 'x', 'y'].forEach(function (f) { (alt[f] || []).forEach(function (v) { if (v == null || v === q[f]) return; ah += '<button type="button" class="sius-alt" data-f="' + f + '" data-v="' + v + '">' + esc((f === 'dec' ? wrT('sius.cf_dec') : f.toUpperCase()) + ' ' + (f === 'dec' ? f1(v) : f2(v))) + '</button>'; }); });
      if (ah) h += '<div class="sius-alts"><small>' + esc(wrT('sius.alt_label')) + '</small>' + ah + '</div>';
      // v3.0.2 B 版（White 2026-11-27）：拿掉內十、刪除這發、上一個、下一個；只留「改成重算的 N」＋「保存」（保存＝當綠燈）
      h += '<div class="sius-ea">' + (r.calc && r.status !== 'ok' && (r.diff == null || r.diff > 0 || r.innerOk === false) ? '<button type="button" class="sius-use" id="siusUse">' + esc(wrT('sius.use_calc', [calcTx(q, r.calc) + (r.calc.inner ? '*' : '')])) + '</button>' : '<span></span>') + SAVEB() + '</div>';
    } else if (sel.type === 'meta') {
      h += '<div class="sius-eh"><b>' + esc(wrT(META[sel.f] || 'sius.f_event')) + '</b><small class="ok">' + esc(wrT('sius.meta_hint')) + '</small></div>';
      h += '<div class="sius-fs one">' + fld('siusFMeta', wrT(META[sel.f] || 'sius.f_event'), metaVal(sel.f), 'text') + '</div><div class="sius-ea"><span></span>' + SAVEB() + '</div>';
    } else {
      var s = sel.type === 'sub' ? st.ck.series[sel.k] : st.ck.total; if (!s) { st.sel = null; box.hidden = true; return; }
      var pr = s.printed || { dec: null, inner: null };
      h += '<div class="sius-eh"><b>' + esc(sel.type === 'sub' ? wrT('sius.series_head', [s.k + 1, s.from, s.to]) : wrT('sius.total_head')) + '</b><small class="' + (s.status === 'ok' ? 'ok' : 'bad') + '">' + esc(s.status === 'ok' ? wrT('sius.why_sub_ok') : wrT('sius.why_sub', [subTx(s.printed), subTx(s.sumPrinted), subTx(s.calc)])) + '</small></div>';
      h += '<div class="sius-fs two">' + fld('siusFSD', wrT('sius.sub_score'), pr.dec == null ? '' : f1(pr.dec)) + fld('siusFSI', wrT('sius.sub_inner'), pr.inner == null ? '' : pr.inner, 'numeric') + '</div>';
      h += '<div class="sius-ea"><button type="button" class="sius-use" id="siusUseSum">' + esc(wrT('sius.use_sum', [subTx(s.sumPrinted)])) + '</button>' + SAVEB() + '</div>';
    }
    box.className = 'sius-edit compact b'; box.innerHTML = '<i class="grab" aria-hidden="true"></i>' + h; box.hidden = false; D.body.classList.add('sius-editing');
    var scr = $('siusScrim'); if (scr) scr.hidden = false; document.body.classList.add('sius-ed'); // 編輯時寶寶先退到後面
    var re = function () { var keep = st.sel; st.ck = CHK(m); st.sel = keep; render(); };
    var bind = function (id, fn) { $(id).onchange = function (ev) { fn(this.value); if (!(ev && ev.noRender)) re(); }; $(id).onkeydown = function (e) { if (e.key === 'Enter') this.blur(); }; };
    if (sel.type === 'row') {
      var q2 = m.shots[sel.i];
      bind('siusFDec', function (v) { edit(q2, 'dec', num(v)); }); bind('siusFT', function (v) { edit(q2, 't', normT(v)); });
      bind('siusFX', function (v) { edit(q2, 'x', num(v)); }); bind('siusFY', function (v) { edit(q2, 'y', num(v)); });
      box.querySelectorAll('.sius-alt').forEach(function (b) { b.onclick = function () { edit(q2, b.dataset.f, +b.dataset.v); re(); }; });
      if ($('siusUse')) $('siusUse').onclick = function () { var c = st.ck.rows[sel.i].calc; edit(q2, 'dec', q2.decInt ? c.ring : c.dec); edit(q2, 'inner', c.inner); re(); };
    } else if (sel.type === 'meta') {
      bind('siusFMeta', function (v) { v = String(v).trim().slice(0, 60); logEd('meta.' + sel.f, m[sel.f] || '', v); m[sel.f] = v; st.metaEd[sel.f] = v; });
    } else {
      var tgtObj = function () { if (sel.type === 'sub') { while (m.subs.length <= sel.k) m.subs.push(null); if (!m.subs[sel.k]) m.subs[sel.k] = { dec: 0, inner: 0 }; return m.subs[sel.k]; } if (!m.total) m.total = { dec: 0, inner: 0 }; return m.total; };
      var keepEd = function (o, f, from) { logEd((sel.type === 'sub' ? 'S' + (sel.k + 1) : 'T') + '.' + f, from, o[f]); if (sel.type === 'sub') st.subEd[sel.k] = { dec: o.dec, inner: o.inner }; else st.totEd = { dec: o.dec, inner: o.inner }; };
      $('siusFSD').onchange = function (ev) { var o = tgtObj(), a = o.dec; o.dec = num(this.value) || 0; keepEd(o, 'dec', a); if (!(ev && ev.noRender)) re(); };
      $('siusFSI').onchange = function (ev) { var o = tgtObj(), a = o.inner; o.inner = Math.round(num(this.value) || 0); keepEd(o, 'inner', a); if (!(ev && ev.noRender)) re(); };
      $('siusUseSum').onclick = function () { var s2 = sel.type === 'sub' ? st.ck.series[sel.k] : st.ck.total, o = tgtObj(), a = o.dec; o.dec = s2.sumPrinted.dec; o.inner = s2.sumPrinted.inner; keepEd(o, 'dec', a); re(); };
    }
    // 保存：先把輸入框裡還沒送出的值套上（按下去的那一刻輸入框才失焦，不能等 change），再收起；逐發＝當綠燈（okd）
    var saved = false, doSave = function (e) {
      if (saved) return; saved = true; if (e && e.preventDefault) e.preventDefault();
      box.querySelectorAll('input').forEach(function (inp) { if (inp.value !== inp.defaultValue && inp.onchange) { var f0 = inp.onchange; inp.onchange = null; try { f0.call(inp, { noRender: 1 }); } catch (er) {} } });
      if (sel.type === 'row') { var q3 = m.shots[sel.i]; if (q3) { logEd((q3.n != null ? keyOf(q3) : '?') + '.ok', st.ck.rows[sel.i] ? st.ck.rows[sel.i].status : '', 'ok'); q3.ed = 1; q3.okd = 1; if (q3.n != null) { var k3 = keyOf(q3); (st.edits[k3] = st.edits[k3] || {}).ed = 1; st.edits[k3].okd = 1; } } }
      st.sel = null; st.ck = CHK(m); render();
    };
    $('siusEDone').onpointerdown = doSave; $('siusEDone').onclick = doSave;
  }

  /* ---------- 存成一般紀錄（分析頁）：紅燈要先改好；黃燈不擋 ---------- */
  // v3.1.2：每發亮燈原因代碼（存檔、原樣檔、上傳檢視資料都用這個）。綠燈經一致性檢查降回來的寫 cons:原本原因
  function whyCodes(r, q) {
    if (!r) return ''; var w = (r.why || []).slice();
    (r.conflict || []).forEach(function (c) { w.push('conflict:' + c); });
    (r.miss || []).forEach(function (c) { w.push('miss:' + c); });
    (r.tMark || []).forEach(function (c) { w.push(c); }); // v3.1.3：時間記號的原因
    if (r.tWarn) w.push('tWarn'); if (r.missing) w.push('missing'); if (r.innerOk === false) w.push('inner'); if (r.diff != null && r.diff > 0) w.push('diff:' + r.diff);
    if (r.orange) w.push('orange'); if (q && q.okd) w.push('userOk');
    if (r.cons && r.cons.length) w.push('cons:' + r.cons.join('+'));
    var seen = {}; return w.filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; }).join('|');
  }
  function whyLine(r, q) { // v3.1.2：編輯框裡列出原因代碼；重開的紀錄另外列存檔當時的燈號／原因
    var c = whyCodes(r, q), h = (r.tMark ? '<small class="sius-wc sius-tmk-n">' + esc(wrT('sius.tmk', [tMarkTx(r)])) + '</small>' : '') + (c ? '<small class="sius-wc">' + esc(wrT('sius.why_codes', [c])) + '</small>' : '');
    if (q && (q.lt0 || q.why0)) h += '<small class="sius-wc">' + esc(wrT('sius.why_saved', [{ g: wrT('sius.st_ok'), y: wrT('sius.st_near'), r: wrT('sius.st_bad') }[q.lt0] || '—', q.why0 || '—'])) + '</small>';
    return h;
  }
  function ltOf(r) { return r && r.status === 'ok' ? 'g' : r && r.status === 'near' ? 'y' : 'r'; }
  function lights(ck) { var g = 0, y = 0, r = 0; ck.rows.forEach(function (x) { if (x.status === 'ok') g++; else if (x.status === 'near') y++; else r++; }); return { g: g, y: y, r: r }; }
  function snapShots(m, ck) { return m.shots.map(function (q, i) { var r = ck.rows[i] || {}; return { n: q.n == null ? null : q.n, s: q.sighter ? 1 : 0, d: q.dec == null ? null : q.dec, in: q.inner ? 1 : 0, t: q.t || '', x: q.x == null ? null : q.x, y: q.y == null ? null : q.y, st: r.status || '', w: whyCodes(r, q), fb: q.fb ? 1 : 0, ed: q.ed ? 1 : 0 }; }); }
  function save() {
    var m = st && st.model; if (!m || st.busy) return;
    if (st.ck.bad) {
      toast(wrT('sius.red_block', [st.ck.bad]), 3600);
      var fr = st.ck.rows.filter(function (r) { return r.status === 'bad'; })[0]; if (fr) pick({ type: 'row', i: fr.i });
      return;
    }
    var go = function () {
      var rec, a = App.acur;
      if (st.recId) {
        rec = App.sessions.filter(function (x) { return x.id === st.recId; })[0]; if (!rec) return;
        if (App.isLocked && rec === a && App.isLocked()) { App.lockToast(); return; }
        if (rec.locked || (rec.sheets || []).some(function (x) { return x.locked; })) { toast(wrT('app.sh_has_locked'), 3600); return; }
      } else if (a && !a.sheets.length && !(App.isLocked && App.isLocked()) && !(App.isShared && App.isShared(a))) rec = a; // 分析頁是空的：直接放進目前這筆
      else rec = App.newAnalysis(m.targetId);
      if (!m.name && !rec.name) m.name = S.recName(m, wrT('sius.name_prefix'));
      var ck = st.ck, prevRep = rec.sius && rec.sius.rep;
      m.shots.forEach(function (q, i) { var r = ck.rows[i]; q.lt = r ? ltOf(r) : null; q.why = r ? whyCodes(r, q) : ''; }); // v3.1.2：每發燈號＋原因寫進存檔
      S.toRecord(m, rec); rec.updated = new Date().toISOString();
      // 試射超過 10 發：每 10 發一張（11 發＝10＋1，White 指定）
      var out = [];
      rec.sheets.forEach(function (sh) {
        if (!sh.sighter || (sh.shots.length <= 10 && !sh.shots.some(function (q) { return q.b; }))) { out.push(sh); return; }
        // v3.0.3：試射有好幾組時先依組分開，每組再每 10 發一張
        var gs = [], gc = null; sh.shots.forEach(function (q) { var b = q.b || 0; if (!gc || gc.b !== b) { gc = { b: b, a: [] }; gs.push(gc); } gc.a.push(q); });
        var ci = 0; gs.forEach(function (G) { for (var i = 0; i < G.a.length; i += 10) { var c = JSON.parse(JSON.stringify(sh)); c.id = sh.id + (ci ? '_' + ci : ''); ci++; c.shots = G.a.slice(i, i + 10); out.push(c); } });
      });
      rec.sheets = out;
      if (m.athlete) rec.sius.athlete = m.athlete; if (m.lane) rec.sius.lane = m.lane;
      // 測試期回報用（只存在這筆紀錄裡；有同意＋登入才會在存檔時送出，見 report.js）
      var rep = { v: 1, app: App.APP_LABEL || '', eng: V3() && XC() ? 'v3' : 'main', lights: lights(ck), timing: st.timing || (prevRep && prevRep.timing) || null, log: (prevRep && prevRep.log || []).concat(st.log).slice(-200) };
      rep.wrong = (function () { var k = {}; rep.log.forEach(function (e) { var id = String(e.k).split('.')[0]; if (/^[QM]\d+$/.test(id)) k[id] = 1; }); return Object.keys(k).length; })();
      rec.sius.rep = rep;
      if (App.sessions.indexOf(rec) < 0) App.sessions.unshift(rec);
      App.saveSessions(App.sessions);
      App.acur = rec; App.anaPhotos = {}; App.anaSel = 'all'; try { store.set(App.LS_ACUR, rec.id); } catch (e) {}
      // 第一次存小白單時問一次要不要參加測試期回報（之後在 設定 › 測試期回報 改）
      try { if (App.siusReport) { var _snap = snapShots(m, ck), _nf = st.files.length; App.siusReport.askOnce(function () { App.siusReport.auto(rec, { shots: _snap, files: _nf }).then(function () { if (App.curTab === 'analysis' && App.acur === rec) App.siusReport.card(); }); }); } } catch (e) {}
      st.saved = true; st.log = [];
      if (st.scanId && OWN()) try { OWN().scanMark(st.scanId, { sent: Date.now() }).catch(function () {}); } catch (e) {} // v3.1.2：原樣檔標「已送分析」
      App.showTab('analysis'); if (App.fillAnaCalRing) App.fillAnaCalRing(); App.renderAnalysis(); if (App.syncTargetSel) App.syncTargetSel(); window.scrollTo(0, 0);
      toast(wrT('sius.saved', [ck.nSighter, ck.nMatch]), 3600);
      freeUrls(); st.urls = []; fresh();
    };
    var noxy = m.shots.filter(function (q) { return !hasXY(q); }).length;
    if (noxy) ask(wrT('sius.save_noxy_q', [noxy]), go); else go();
  }
  // 測試用：addPasses 直接餵 OCR 文字（e2e 也會走真的照片 OCR）；addPasses(ps, fb) 第二個＝補漏引擎的讀法
  App.sius = { open: open, close: close, get state() { return st; }, addFiles: function (fs) { addFiles(fs); },
    addPasses: function (ps, fb) { build(); if (!st) fresh(); st.passes = st.passes.concat(ps); st.fbPasses = st.fbPasses.concat(fb || []); st.model = buildModel(st.passes, st.fbPasses); st.sel = null; recheck(); if (!st.tgUser && !st.gunAsked && !(st.model.gun && st.model.gun.sure)) askGun(); else gunFlow(); },
    pickGun: function (g) { var b = $('siusAsk'); if (b) b.remove(); pickGun(g); }, save: save, recheck: recheck, pick: pick, step: step, render: render,
    get view() { return view; }, get dir8() { return dir8; }, cards: function () { return st && st.model ? cardList() : []; },
    keepScan: ownKeep, openScan: openScan, scanList: ownList, reviewPack: function (base) { var O = window.WRSiusOwner; return O && st && st.model ? reviewPack(O, base || 'rvtest') : null; } };

  /* ---------- 小白單三寶寶：自動收邊（跟分析頁寶寶同一套 dock.js；FIG-19 收合動畫） ---------- */
  var XD = null;
  if (window.WRDockMake) {
    XD = window.WRDockMake({ key: 'wr_dock_sius_v1', idle: 1800, dock: $('xbDock'), eye: $('xbEye'), home: $('xbHome'), morph: 'xb',
      main: function () { return $('siusPickBtn'); }, base: function () { return D.querySelector('#xbDock .tr-base'); },
      acc: '.tr-bub, .tr-tag, .tr-arm',
      busy: function () { return !!(st && (st.sel || st.busy)) || !!$('siusAsk'); },
      homeMsg: function () { return wrT('sius.dock_home'); } });
    window.WRDockXB = XD;
    if (XD) XD.init({ enabled: !(App.prefs && App.prefs.dockAutoHide === false), active: function () { return App.curTab === 'sius'; }, toast: toast });
  }
  /* ---------- 分析頁：小白單核對卡＋射擊節奏卡（App.siusCards 由 app-analysis.js 的 anaExtraHTML 呼叫） ---------- */
  App.siusCards = function (t, set, single, sh) {
    var M = App.mods, acur = App.acur, h = '', card = function (title, body, cls, id) { return '<div class="ana-card ' + (cls || '') + '" data-mod="' + id + '" data-mod-name="' + esc(M.plain(title)) + '"><div class="ana-ct">' + M.plain(title) + '</div>' + body + '</div>'; };
    if (acur && acur.sius && !single) {
      var m = S.fromRecord(acur), ck = S.check(m), b = '';
      if (acur.sius.unverified || acur.targetId === 'ap10') b += '<p class="sius-samplenote">' + esc(wrT('sius.card_unverified')) + '</p>';
      b += '<p>' + wrT('sius.card_total', [subTx(ck.total.printed), subTx(ck.total.calc), ck.total.printed && Math.round(ck.total.printed.dec * 10) === Math.round(ck.total.calc.dec * 10) ? '<b class="sius-ok">✓</b>' : '<b class="sius-bad">' + esc(wrT('sius.card_diff')) + '</b>']) + '</p>';
      b += '<table class="sius-ctab"><tr><th>' + esc(wrT('sius.card_series')) + '</th><th>' + esc(wrT('sius.card_printed')) + '</th><th>' + esc(wrT('sius.card_calc')) + '</th></tr>';
      ck.series.forEach(function (s) { var same = s.printed && Math.round(s.printed.dec * 10) === Math.round(s.calc.dec * 10); b += '<tr' + (same ? '' : ' class="bad"') + '><td>' + (s.k + 1) + '</td><td>' + subTx(s.printed) + '</td><td>' + subTx(s.calc) + '</td></tr>'; });
      b += '</table><p class="sius-cnote">' + esc(wrT('sius.card_note', [ck.nSighter])) + '</p><button type="button" class="wr-pill" data-sius-edit="1">' + esc(wrT('sius.card_edit')) + '</button>';
      h += card(wrT('sius.card_title'), b, 'sius-card-ana', 'sius');
    }
    var tl = set.filter(function (x) { return x.q && x.q.t; });
    if (tl.length >= 3) {
      var rh = S.rhythm(set.map(function (x) { return x.q; }));
      if (rh.n >= 2) {
        var rb = '<p>' + wrT('sius.rh_avg', [Math.round(rh.avg), Math.round(rh.median), S.fmtSec(rh.span)]) + '</p>';
        if (rh.firstHalf != null && rh.secondHalf != null) rb += '<p>' + wrT('sius.rh_half', [Math.round(rh.firstHalf), Math.round(rh.secondHalf), '<b class="sius-rh ' + rh.dir + '">' + esc(rh.dir === 'faster' ? wrT('sius.rh_faster', [Math.abs(Math.round(rh.change * 100))]) : rh.dir === 'slower' ? wrT('sius.rh_slower', [Math.abs(Math.round(rh.change * 100))]) : wrT('sius.rh_steady')) + '</b>']) + '</p>';
        var li = rh.longest.idx, lq = li >= 0 ? set[li] : null;
        if (lq) rb += '<p>' + wrT('sius.rh_longest', [String(lq.q && lq.q.n != null ? lq.q.n : li + 1), S.fmtSec(rh.longest.sec)]) + '</p>';
        if (!single && rh.per10.length >= 2) rb += '<div class="sius-chl">' + esc(wrT('sius.rh_chart10')) + '</div>' + App.lineChart(rh.per10.map(function (x) { return Math.round(x.avg); }), rh.per10.map(function (x) { return x.from + '–' + x.to; }), { title: wrT('sius.rh_chart10') });
        else { var gv = rh.gaps.slice(1).map(function (g) { return g == null ? 0 : Math.round(g); }); if (gv.length >= 2) rb += '<div class="sius-chl">' + esc(wrT('sius.rh_chart_shot')) + '</div>' + App.lineChart(gv, gv.map(function (_, i) { return String(i + 2); }), { title: wrT('sius.rh_chart_shot') }); }
        rb += '<p class="sius-cnote">' + esc(wrT('sius.rh_note')) + '</p>';
        h += card(wrT('sius.rh_title'), rb, 'sius-rh-card', 'rhythm');
      }
    }
    return h;
  };
  D.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sius-edit]'); if (!b) return;
    var a = App.acur; if (!a || !a.sius) return;
    if (App.lockedBlock && App.lockedBlock()) return;
    open(a);
  });
})(window.WRApp = window.WRApp || {});
