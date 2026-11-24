/* WRbeta v2.9.3 小白單（SIUS 成績單）：PROGRESS.md §7 備註8。核心計算在 sius.js（WRSius），影像前處理 sius-img.js，OCR sius-ocr.js。
 * 【White 指定 2026-11-24】
 *   入口＝分析頁拍照按鈕列（相簿｜拍下一張｜檔案）裡的「小白單」（校正選單的入口拿掉，不再有功能旗標）；
 *   結果直接呈現在現有分析頁：存成一般分析紀錄（試射＝灰色試射卡、比賽每 10 發一張），核對卡＋射擊節奏卡在分析頁下方。
 *   槍種依單子表頭自動判斷（Air Rifle → 10 米空氣步槍、Air Pistol → 10 米空氣手槍），右上角靶種跟著換（分析頁已有別的槍種資料時先問）；
 *   手槍單據還沒有實物比對：照樣判斷、切換，但畫面一律標「手槍單據尚未驗證，請核對」。
 *   絕對不杜撰數字：沒讀到的欄位留空標紅，等使用者照單子補。 */
(function (App) {
  'use strict';
  var S = window.WRSius; if (!S || !document.getElementById('tab-analysis')) return;
  var D = document, $ = App.$, esc = App.esc, toast = App.toast, ask = App.ask, store = App.store;
  function T(id) { return App.T[id] || App.T.ar10; }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function f2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
  function OCR() { return window.WRSiusOCR; }

  /* ---------- 入口：拍照按鈕列「小白單」 ---------- */
  var btn = $('anaSiusBtn');
  if (btn) btn.onclick = function () { if (App.anaPopClose) App.anaPopClose(); open(null); };

  /* ---------- 底部面板 ---------- */
  // st：{ model, ck, sel, recId, files:[File], urls:[], passes:[], tgUser, edits:{}, subEd:{}, totEd, busy, cancel, gunAsked }
  var sheet = null, st = null;
  var ICAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5a2 2 0 0 1 2-2h2.3l1.6-2.2h5.2l1.6 2.2h2.3a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.8"/></svg>';
  var IPIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4.5 3.5"/></svg>';
  function build() {
    sheet = D.createElement('div'); sheet.id = 'siusSheet'; sheet.className = 'sius-bg'; sheet.hidden = true;
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', wrT('sius.title'));
    sheet.innerHTML = '<div class="sius-card">' +
      '<div class="sius-top"><div class="sius-h"><b>' + esc(wrT('sius.title')) + '</b></div><button type="button" class="x sius-x" aria-label="' + esc(wrT('sius.close')) + '">✕</button></div>' +
      '<div class="sius-scroll" id="siusScroll">' +
        '<div class="sius-src" id="siusSrc">' +
          '<label class="sius-sb" id="siusCamBtn">' + ICAM + '<span><b>' + esc(wrT('sius.take')) + '</b><small>' + esc(wrT('sius.take_sub')) + '</small></span><input type="file" id="siusCam" accept="image/*" capture="environment" hidden></label>' +
          '<label class="sius-sb" id="siusPickBtn">' + IPIC + '<span><b>' + esc(wrT('sius.pick')) + '</b><small>' + esc(wrT('sius.pick_sub')) + '</small></span><input type="file" id="siusPick" accept="image/*" multiple hidden></label>' +
        '</div>' +
        '<div class="sius-photos" id="siusPhotos" hidden></div>' +
        '<div class="sius-prog" id="siusProg" hidden role="status" aria-live="polite"><div class="sius-pbar"><i id="siusPbar"></i></div><span id="siusPtx"></span><button type="button" class="wr-pill" id="siusStop">' + esc(wrT('sius.ocr_cancel')) + '</button></div>' +
        '<div class="sius-gun" id="siusGun">' +
          '<div class="sius-tg wr-seg" id="siusTg" role="radiogroup" aria-label="' + esc(wrT('sius.target_type')) + '"><button type="button" role="radio" data-v="ar10">' + esc(wrT('core.10m_air_rifle')) + '</button><button type="button" role="radio" data-v="ap10">' + esc(wrT('core.10m_air_pistol')) + '</button></div>' +
          '<p class="sius-gnote" id="siusGnote"></p><p class="sius-warn" id="siusWarn" role="alert" hidden>' + esc(wrT('sius.gun_pistol_warn')) + '</p>' +
        '</div>' +
        '<div id="siusBody"></div>' +
      '</div>' +
      '<div class="sius-edit" id="siusEdit" hidden></div>' +
      '<div class="sius-bar"><button type="button" class="sius-nav" id="siusPrev" aria-label="' + esc(wrT('sius.prev_problem')) + '">‹</button><span class="sius-cnt" id="siusCnt" aria-live="polite"></span><button type="button" class="sius-nav" id="siusNext" aria-label="' + esc(wrT('sius.next_problem')) + '">›</button><button type="button" class="sius-save" id="siusSave">' + esc(wrT('sius.save')) + '</button></div>' +
      '</div>';
    D.body.appendChild(sheet);
    sheet.querySelector('.sius-x').onclick = close;
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    var onFiles = function () { var fs = Array.prototype.slice.call(this.files || []); this.value = ''; if (fs.length) addFiles(fs); };
    $('siusCam').onchange = onFiles; $('siusPick').onchange = onFiles;
    $('siusStop').onclick = function () { if (!st.busy) return; st.cancel = true; if (OCR()) OCR().stop(); if (st.abort) st.abort(); };
    $('siusTg').querySelectorAll('button').forEach(function (b) { b.onclick = function () { if (st.busy) return; st.tgUser = b.dataset.v; if (st.model) { st.model.targetId = b.dataset.v; st.model.gun.unverified = b.dataset.v === 'ap10'; } recheck(); }; });
    $('siusPrev').onclick = function () { step(-1); }; $('siusNext').onclick = function () { step(1); };
    $('siusSave').onclick = save;
  }
  function defTg() { var a = App.acur; return a && (a.targetId === 'ap10' || a.targetId === 'ar10') ? a.targetId : 'ar10'; }
  function freeUrls() { if (st && st.urls) st.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); }
  function open(rec) {
    if (!sheet) build();
    if (st && st.busy) { st.cancel = true; if (OCR()) OCR().stop(); }
    freeUrls();
    st = { model: null, ck: null, sel: null, recId: null, files: [], urls: [], passes: [], tgUser: null, edits: {}, subEd: {}, totEd: null, busy: false, cancel: false, gunAsked: false };
    if (rec) { st.model = S.fromRecord(rec); st.recId = rec.id; st.tgUser = rec.targetId; }
    var oldAsk = $('siusAsk'); if (oldAsk) oldAsk.remove();
    sheet.hidden = false; D.body.classList.add('sius-open');
    if (App.back) App.back.push('sius', close);
    recheck(); $('siusScroll').scrollTop = 0;
  }
  function close() {
    if (!sheet || sheet.hidden) return;
    if (st && st.busy) { st.cancel = true; if (OCR()) OCR().stop(); }
    sheet.hidden = true; D.body.classList.remove('sius-open'); if (App.back) App.back.drop('sius');
  }
  function recheck() { st.ck = st.model ? S.check(st.model) : null; render(); }

  /* ---------- 照片 → OCR → 合併 ---------- */
  function addFiles(fs) {
    if (st.busy || st.recId) return;
    var base = st.files.length;
    fs.forEach(function (f) { st.files.push(f); try { st.urls.push(URL.createObjectURL(f)); } catch (e) { st.urls.push(''); } });
    st.busy = true; st.cancel = false; st.sel = null; render(); prog(0.02, 'load');
    var my = st, opt = {
      imgBase: base,
      cancelled: function () { return my.cancel || st !== my; },
      onProgress: prog,
      more: function (np) { try { var m = buildModel(my.passes.concat(np)), ck = S.check(m); return ck.bad > 0 || ck.rows.some(function (r) { return r.missing; }); } catch (e) { return false; } }
    };
    var ocr = OCR();
    if (!ocr) { done(new Error('OCR')); return; }
    var fin = false; my.abort = function () { done({ cancel: true }); };
    ocr.run(fs, opt).then(function (res) {
      if (st !== my || fin) return; fin = true; my.abort = null;
      my.passes = my.passes.concat(res.passes);
      my.busy = false; ocr.stop();
      var m = buildModel(my.passes);
      if (!m.shots.length) { my.files.splice(base); my.urls.splice(base).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); my.model = my.model && my.model.shots.length ? my.model : null; recheck(); toast(wrT('sius.ocr_none'), 4200); return; }
      my.model = m; my.sel = null; recheck();
      toast(my.ck.bad || my.ck.near ? wrT('sius.read_ok', [my.ck.nSighter, my.ck.nMatch, S.problems(m, my.ck).length]) : wrT('sius.read_ok_all', [my.ck.nSighter, my.ck.nMatch]), 3600);
      if (!my.tgUser && !my.gunAsked && !(m.gun && m.gun.sure)) askGun(); else gunFlow();
    }, function (e) { if (st !== my) return; done(e); });
    function done(e) {
      if (fin) return; fin = true; my.abort = null;
      my.busy = false; if (OCR()) OCR().stop();
      my.files.splice(base); my.urls.splice(base).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) {} });
      render();
      if (e && e.cancel || my.cancel) toast(wrT('sius.cancelled'), 2400);
      else toast(wrT('sius.ocr_fail', [String(e && e.message || e).slice(0, 80)]), 5200);
    }
  }
  function prog(p, phase) {
    if (!sheet || !st) return;
    $('siusPbar').style.width = Math.round(p * 100) + '%';
    $('siusPtx').textContent = phase === 'load' ? wrT('sius.ocr_load') : wrT('sius.ocr_read', [Math.round(p * 100), st.files.length]);
  }
  function keyOf(q) { return (q.sighter ? 'Q' : 'M') + q.n; }
  // OCR 讀法合併成模型，再套上使用者已經改過的地方（加照片重新合併時不會把手改的蓋掉）
  function buildModel(passes) {
    var m = S.merge(passes, { targetId: st.tgUser || undefined });
    if (!st.tgUser && !m.gun.id) { m.targetId = defTg(); m.gun.unverified = m.targetId === 'ap10'; }
    m.shots = m.shots.filter(function (q) {
      var e = st.edits[keyOf(q)]; if (!e) return true; if (e.del) return false;
      for (var f in e) { q[f] = e[f]; if (q.ocr) { q.ocr.conflict = (q.ocr.conflict || []).filter(function (c) { return c !== f; }); q.ocr.missing = false; } }
      return true;
    });
    for (var k in st.subEd) { while (m.subs.length <= +k) m.subs.push(null); m.subs[+k] = { dec: st.subEd[k].dec, inner: st.subEd[k].inner }; }
    if (st.totEd) m.total = { dec: st.totEd.dec, inner: st.totEd.inner };
    return m;
  }
  function edit(q, f, v) {
    q[f] = v;
    if (q.ocr) { q.ocr.conflict = (q.ocr.conflict || []).filter(function (c) { return c !== f && !(f === 'inner' && c === 'dec'); }); q.ocr.missing = false; }
    if (q.n != null) { var k = keyOf(q); (st.edits[k] = st.edits[k] || {})[f] = v; }
  }
  /* v2.9.4 第 24 項（White 指定 2026-11-25 03:05／03:09 手繪草圖）：表頭沒讀到、看不出是什麼靶 → 從左下的「拍下一張寶寶」冒出對話泡泡：
   *   「抱歉看不出來是什麼靶」＋三個可以直接點的選項：10米手槍／10米步槍／50米步槍（50米灰色、標「施工中」、不能選，WR 還沒有 50 米靶面）。
   *   白幻仔提議：從格式猜到的種類（整數分數＝手槍、小數＝步槍）排第一個並標「看起來像」；選完照那個靶面重新合併、重新核對每一發。
   *   寶寶暫時用現有的拍下一張按鈕圖（吉祥物之後另外設計）。 */
  var IGUN = {
    ap10: '<svg viewBox="0 0 48 24" aria-hidden="true"><path d="M4 6h34l2 3h4v4H22l-2 2-3 7h-6l2-9H6z"/><path d="M19 13h-4"/></svg>',
    ar10: '<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M2 9h40l4-2h14v5H44l-6 3H26l-4 7h-6l3-7H8l-6 4z"/></svg>',
    r50: '<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M2 9h44l4-2h12v4H46l-6 3H28l-5 8h-6l3-8H8l-6 4z"/><path d="M28 6v3M32 6v3"/></svg>'
  };
  function askGun() {
    var m = st.model; if (!m) return;
    st.gunAsked = true;
    var guess = m.gun.guess === 'ap10' || m.gun.guess === 'ar10' ? m.gun.guess : null;
    var ord = ['ap10', 'ar10']; if (guess === 'ar10') ord = ['ar10', 'ap10'];
    var opts = ord.map(function (id) { return { id: id, name: T(id).name, like: id === guess }; }).concat([{ id: 'r50', name: wrT('sius.gun_r50'), wip: true }]);
    var bg = D.createElement('div'); bg.className = 'sius-ask'; bg.id = 'siusAsk'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-labelledby', 'siusAskQ');
    bg.innerHTML = '<div class="sius-ask-in"><div class="sius-bub"><p id="siusAskQ">' + esc(wrT('sius.gun_ask')) + '</p><div class="sius-gopts">' +
      opts.map(function (o) { return '<button type="button" class="sius-gopt' + (o.like ? ' like' : '') + (o.wip ? ' wip' : '') + '" data-g="' + o.id + '"' + (o.wip ? ' aria-disabled="true"' : '') + '>' + IGUN[o.id] + '<span><b>' + esc(o.name) + '</b>' + (o.like ? '<em>' + esc(wrT('sius.gun_like')) + '</em>' : '') + (o.wip ? '<em>' + esc(wrT('coach.wip')) + '</em>' : '') + '</span></button>'; }).join('') +
      '</div></div><div class="sius-baby" aria-hidden="true"><i></i><i></i></div></div>';
    sheet.querySelector('.sius-card').appendChild(bg);
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
    if (st.passes.length) st.model = buildModel(st.passes); else if (st.model) { st.model.targetId = g; st.model.gun.unverified = g === 'ap10'; }
    st.sel = null; recheck();
    toast(wrT('sius.gun_picked', [T(g).name]), 2600);
    gunFlow(g);
  }
  // 槍種：單子上讀到的跟分析頁目前的不一樣 → 右上角靶種跟著換（分析頁已有資料就先問）
  // force：使用者在泡泡裡選的（v2.9.4）
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
      render();
    };
    if (a.sheets.length) ask(wrT('sius.gun_switch_q', [nm(g), nm(a.targetId)]), doSwitch, function () { st.tgUser = a.targetId; if (force && st.passes.length) st.model = m = buildModel(st.passes); m.targetId = a.targetId; m.gun.unverified = a.targetId === 'ap10'; recheck(); toast(wrT('sius.gun_kept', [nm(a.targetId)]), 3600); });
    else doSwitch();
  }

  /* ---------- 畫面 ---------- */
  function stTx(s) { return s === 'ok' ? '✓' : s === 'near' ? '≈' : '✕'; }
  function subTx(o) { return o ? f1(o.dec) + '-' + o.inner + '*' : '—'; }
  function render() {
    var m = st.model, ck = st.ck;
    // 來源（拍照／相簿）：讀進來之前大顆；重新開啟舊紀錄時不能加照片
    $('siusSrc').hidden = !!st.recId || st.busy || !!m;
    sheet.classList.toggle('has-model', !!m);
    var ph = $('siusPhotos'), hp = st.files.length && !st.recId;
    ph.hidden = !hp;
    if (hp) ph.innerHTML = '<span class="sius-pn">' + esc(wrT('sius.photos_n', [st.files.length])) + '</span>' + st.urls.map(function (u, i) { return u ? '<img src="' + esc(u) + '" alt="' + (i + 1) + '">' : ''; }).join('') + (st.busy ? '' : '<label class="sius-add">' + esc(wrT('sius.add_more')) + '<input type="file" accept="image/*" multiple hidden></label>');
    var add = ph.querySelector('.sius-add input'); if (add) add.onchange = function () { var fs = Array.prototype.slice.call(this.files || []); this.value = ''; if (fs.length) addFiles(fs); };
    $('siusProg').hidden = !st.busy;
    var tg = m ? m.targetId : (st.tgUser || defTg());
    $('siusTg').querySelectorAll('button').forEach(function (b) { var o = b.dataset.v === tg; b.classList.toggle('on', o); b.setAttribute('aria-checked', o ? 'true' : 'false'); b.disabled = st.busy; });
    $('siusGun').hidden = !m;
    var gn = '';
    if (m && !st.recId) gn = m.gun.id && !st.tgUser ? wrT('sius.gun_auto', [m.event || T(m.gun.id).name]) : !m.gun.id ? wrT('sius.gun_none') : '';
    $('siusGnote').textContent = gn; $('siusGnote').hidden = !gn;
    $('siusWarn').hidden = !(m && tg === 'ap10');
    var h = '';
    if (!m) h = st.busy ? '' : '<p class="sius-empty">' + esc(wrT('sius.tips')) + '</p>';
    else {
      h += '<div class="sius-sum' + (ck.bad ? ' bad' : '') + '">' + wrT('sius.summary', [ck.nSighter, ck.nMatch, ck.bad ? '<b class="sius-bad">' + esc(wrT('sius.n_bad', [ck.bad])) + '</b>' : '<b class="sius-ok">' + esc(wrT('sius.all_ok')) + '</b>', ck.near ? esc(wrT('sius.n_near', [ck.near])) : '']) + '</div>';
      h += '<div class="sius-tgtbox"><svg id="siusSvg" class="target sius-tgt" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(wrT('sius.target_aria')) + '"></svg><div class="sius-lg"><span><i class="lg-s"></i>' + esc(wrT('sius.lg_sighter')) + '</span><span><i class="lg-m"></i>' + esc(wrT('sius.lg_match')) + '</span><span><i class="lg-b"></i>' + esc(wrT('sius.lg_bad')) + '</span></div></div>';
      h += '<div class="sius-list" role="list">';
      h += '<div class="sius-colh" aria-hidden="true"><span>' + esc(wrT('sius.col_no')) + '</span><span>' + esc(wrT('sius.col_score')) + '</span><span>' + esc(wrT('sius.col_time')) + '</span><span>X</span><span>Y</span><span>' + esc(wrT('sius.col_calc')) + '</span></div>';
      var sg = ck.rows.filter(function (r) { return r.sighter; });
      if (sg.length) { h += '<div class="sius-gh sg" role="listitem"><b>' + esc(wrT('sius.sighters_head', [sg.length])) + '</b><small>' + esc(wrT('sius.sighters_sub')) + '</small></div>'; sg.forEach(function (r, j) { h += rowHTML(r, 'P' + (j + 1)); }); }
      ck.series.forEach(function (s) {
        var cls = s.status === 'bad' ? ' bad' : s.status === 'ok' ? ' ok' : '', sel = st.sel && st.sel.type === 'sub' && st.sel.k === s.k ? ' sel' : '';
        h += '<button type="button" class="sius-gh sub' + cls + sel + '" data-sub="' + s.k + '" role="listitem"><b>' + esc(wrT('sius.series_head', [s.k + 1, s.from, s.to])) + '</b><small>' + esc(wrT('sius.series_line', [subTx(s.printed), subTx(s.sumPrinted), subTx(s.calc)])) + '</small><em aria-hidden="true">' + (s.status === 'ok' ? '✓' : s.status === 'bad' ? '✕' : '') + '</em></button>';
        s.rows.forEach(function (i) { var r = ck.rows[i]; h += rowHTML(r, String(r.no)); });
      });
      var tt = ck.total, tcls = tt.status === 'bad' ? ' bad' : tt.status === 'ok' ? ' ok' : '';
      h += '<button type="button" class="sius-gh tot' + tcls + (st.sel && st.sel.type === 'total' ? ' sel' : '') + '" data-total="1" role="listitem"><b>' + esc(wrT('sius.total_head')) + '</b><small>' + esc(wrT('sius.series_line', [subTx(tt.printed), subTx(tt.sumPrinted), subTx(tt.calc)])) + '</small><em aria-hidden="true">' + (tt.status === 'ok' ? '✓' : tt.status === 'bad' ? '✕' : '') + '</em></button>';
      h += '</div><p class="sius-foot">' + esc(wrT('sius.foot')) + '</p>';
    }
    $('siusBody').innerHTML = h;
    if (m) {
      drawTgt();
      $('siusBody').querySelectorAll('[data-row]').forEach(function (b) { b.onclick = function () { pick({ type: 'row', i: +b.dataset.row }); }; });
      $('siusBody').querySelectorAll('[data-sub]').forEach(function (b) { b.onclick = function () { pick({ type: 'sub', k: +b.dataset.sub }); }; });
      $('siusBody').querySelectorAll('[data-total]').forEach(function (b) { b.onclick = function () { pick({ type: 'total' }); }; });
    }
    var pr = m ? S.problems(m, ck) : [];
    $('siusCnt').textContent = !m ? '' : pr.length ? wrT('sius.problems_n', [pr.length]) : wrT('sius.problems_0');
    $('siusPrev').disabled = $('siusNext').disabled = !pr.length || st.busy;
    $('siusSave').disabled = !m || st.busy || !ck.nMatch && !ck.nSighter;
    sheet.querySelector('.sius-bar').hidden = !m;
    renderEdit();
  }
  function rowHTML(r, no) {
    var q = st.model.shots[r.i], sel = st.sel && st.sel.type === 'row' && st.sel.i === r.i ? ' sel' : '';
    var calc = r.calc ? f1(r.calc.dec) + (r.calc.inner ? '*' : '') : '—';
    var cf = function (f) { return r.conflict.indexOf(f) >= 0 ? ' cf' : ''; };
    return '<button type="button" class="sius-row ' + r.status + sel + (r.sighter ? ' sg' : '') + (r.missing ? ' miss' : '') + '" data-row="' + r.i + '" role="listitem" aria-label="' + esc(wrT('sius.row_aria', [no, q.dec == null ? '—' : f1(q.dec), (r.status === 'ok' ? wrT('sius.st_ok') : r.status === 'near' ? wrT('sius.st_near') : wrT('sius.st_bad'))])) + '">' +
      '<span class="no">' + esc(no) + '</span><span class="sc' + cf('dec') + '">' + (q.dec == null ? '—' : f1(q.dec)) + (q.inner ? '<i>*</i>' : '') + '</span><span class="tm' + cf('t') + (r.tWarn ? ' cf' : '') + '">' + esc(q.t || '—') + '</span><span class="xy' + cf('x') + '">' + (q.x == null ? '—' : f2(q.x)) + '</span><span class="xy' + cf('y') + '">' + (q.y == null ? '—' : f2(q.y)) + '</span><span class="cc">' + calc + '<em aria-hidden="true">' + stTx(r.status) + '</em></span></button>';
  }
  function drawTgt() {
    var svg = $('siusSvg'), t = T(st.model.targetId), mx = 0;
    st.model.shots.forEach(function (q) { if (q.x != null && q.y != null) mx = Math.max(mx, Math.abs(q.x), Math.abs(q.y)); });
    var E = Math.min(t.cardSize, Math.max(t.ringDiam[8] * 1.15, 2 * mx + t.pellet * 2 + 2)); // 依彈著範圍放大（靶面本身照 ISSF 尺寸，由 App.drawTarget 畫）
    App.drawTarget(svg, t, t.cardSize / E);
    var g = svg.querySelector('#marks'), sw = E * 0.006;
    st.ck.rows.forEach(function (r) {
      var q = st.model.shots[r.i]; if (q.x == null || q.y == null) return;
      var isSel = st.sel && st.sel.type === 'row' && st.sel.i === r.i;
      App.el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2, fill: r.sighter ? 'rgba(150,150,150,.35)' : 'rgba(31,111,235,.55)', stroke: r.status === 'bad' ? '#e5192b' : r.sighter ? '#8a8a8a' : '#1f6feb', 'stroke-width': r.status === 'bad' || isSel ? sw * 2.4 : sw, 'stroke-dasharray': r.sighter ? (E * 0.012) + ' ' + (E * 0.008) : '', 'class': 'sius-hole' + (r.status === 'bad' ? ' bad' : '') + (r.sighter ? ' sg' : '') }, g);
      if (isSel) App.el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2 + E * 0.02, fill: 'none', stroke: '#ffb300', 'stroke-width': sw * 2.4, 'class': 'sius-selring' }, g);
    });
  }
  /* ---------- 單手修正 ---------- */
  function pick(sel) {
    st.sel = sel; render();
    var el = sel.type === 'row' ? $('siusBody').querySelector('[data-row="' + sel.i + '"]') : sel.type === 'sub' ? $('siusBody').querySelector('[data-sub="' + sel.k + '"]') : $('siusBody').querySelector('[data-total]');
    if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  }
  function step(d) {
    if (!st.model) return;
    var pr = S.problems(st.model, st.ck); if (!pr.length) return;
    var key = function (p) { return p.type + ':' + (p.i != null ? p.i : p.k != null ? p.k : ''); }, cur = st.sel ? key(st.sel) : null, idx = -1;
    pr.forEach(function (p, j) { if (key(p) === cur) idx = j; });
    var nx = idx < 0 ? (d > 0 ? 0 : pr.length - 1) : (idx + d + pr.length) % pr.length;
    pick(pr[nx]);
  }
  function fld(id, label, val, mode, bad) { return '<label class="sius-f' + (bad ? ' bad' : '') + '"><span>' + esc(label) + '</span><input id="' + id + '" value="' + esc(val == null ? '' : val) + '" inputmode="' + (mode || 'decimal') + '" autocomplete="off" spellcheck="false"></label>'; }
  function tgl(id, label, onv) { return '<button type="button" class="sius-tglb' + (onv ? ' on' : '') + '" id="' + id + '" role="switch" aria-checked="' + (onv ? 'true' : 'false') + '">' + esc(label) + '</button>'; }
  function num(v) { v = String(v).replace(/,/g, '.').replace(/[−–—]/g, '-').replace(/\s+/g, '').trim(); return v === '' || isNaN(+v) ? null : +v; }
  // 時間輸入：「1234.56」「12:34.56」「12.34.56」都接受 → mm:ss.ss；看不懂就照原樣（會標黃）
  function normT(v) { v = String(v).trim(); var m = v.replace(/[^\d]/g, ''); if (/^\d{6}$/.test(m)) return m.slice(0, 2) + ':' + m.slice(2, 4) + '.' + m.slice(4); if (/^\d{5}$/.test(m)) return '0' + m.slice(0, 1) + ':' + m.slice(1, 3) + '.' + m.slice(3); return v; }
  function why(r, q) {
    if (r.status === 'ok') return wrT('sius.why_ok');
    if (r.missing) return wrT('sius.why_missing');
    if (r.miss.indexOf('xy') >= 0) return wrT('sius.why_noxy');
    if (r.miss.indexOf('dec') >= 0) return wrT('sius.why_nodec');
    if (r.diff >= 0.2) return wrT('sius.why_diff', [f1(q.dec), f1(r.calc.dec), f1(r.diff)]);
    if (r.diff === 0.1) return wrT('sius.why_near', [f1(q.dec), f1(r.calc.dec)]);
    if (!r.innerOk) return wrT('sius.why_inner');
    if (r.conflict.length) return wrT('sius.why_conflict', [r.conflict.map(function (c) { return { x: wrT('sius.cf_x'), y: wrT('sius.cf_y'), dec: wrT('sius.cf_dec'), t: wrT('sius.cf_t') }[c] || c; }).join('、')]);
    if (r.miss.indexOf('t') >= 0) return wrT('sius.why_notime');
    return wrT('sius.why_time');
  }
  function renderEdit() {
    var box = $('siusEdit'), m = st.model, sel = st.sel;
    if (!m || !sel || st.busy) { box.hidden = true; box.innerHTML = ''; return; }
    var h = '';
    if (sel.type === 'row') {
      var r = st.ck.rows[sel.i], q = m.shots[sel.i]; if (!r) { st.sel = null; box.hidden = true; return; }
      h += '<div class="sius-eh"><b>' + esc(r.sighter ? wrT('sius.edit_sighter', [st.ck.rows.filter(function (x) { return x.sighter && x.i <= r.i; }).length]) : wrT('sius.edit_shot', [r.no])) + '</b><small class="' + r.status + '">' + esc(why(r, q)) + '</small></div>';
      var bad = function (f) { return r.conflict.indexOf(f) >= 0 || (f === 'x' || f === 'y') && r.miss.indexOf('xy') >= 0 && q[f] == null || f === 'dec' && q.dec == null; };
      h += '<div class="sius-fs">' + fld('siusFDec', wrT('sius.col_score'), q.dec == null ? '' : f1(q.dec), 'decimal', bad('dec')) + fld('siusFT', wrT('sius.col_time'), q.t, 'decimal', bad('t') || r.tWarn) + fld('siusFX', 'X (mm)', q.x == null ? '' : f2(q.x), 'text', bad('x')) + fld('siusFY', 'Y (mm)', q.y == null ? '' : f2(q.y), 'text', bad('y')) + '</div>';
      // 照片讀到的其他值（多張照片／多種讀法不一致時）：點一下換成那個值
      var alt = q.ocr && q.ocr.alt, ah = '';
      if (alt) ['dec', 'x', 'y'].forEach(function (f) { (alt[f] || []).forEach(function (v) { if (v == null || v === q[f]) return; ah += '<button type="button" class="sius-alt" data-f="' + f + '" data-v="' + v + '">' + esc((f === 'dec' ? wrT('sius.cf_dec') : f.toUpperCase()) + ' ' + (f === 'dec' ? f1(v) : f2(v))) + '</button>'; }); });
      if (ah) h += '<div class="sius-alts"><small>' + esc(wrT('sius.alt_label')) + '</small>' + ah + '</div>';
      h += '<div class="sius-ea">' + tgl('siusFIn', wrT('sius.inner'), q.inner) + (r.calc && (r.status !== 'ok') ? '<button type="button" class="sius-use" id="siusUse">' + esc(wrT('sius.use_calc', [f1(r.calc.dec) + (r.calc.inner ? '*' : '')])) + '</button>' : '') + '<button type="button" class="sius-del" id="siusDelRow">' + esc(wrT('sius.del_row')) + '</button></div>';
    } else {
      var s = sel.type === 'sub' ? st.ck.series[sel.k] : st.ck.total, pr = s.printed || { dec: null, inner: null };
      h += '<div class="sius-eh"><b>' + esc(sel.type === 'sub' ? wrT('sius.series_head', [s.k + 1, s.from, s.to]) : wrT('sius.total_head')) + '</b><small class="' + (s.status === 'ok' ? 'ok' : 'bad') + '">' + esc(s.status === 'ok' ? wrT('sius.why_sub_ok') : wrT('sius.why_sub', [subTx(s.printed), subTx(s.sumPrinted), subTx(s.calc)])) + '</small></div>';
      h += '<div class="sius-fs two">' + fld('siusFSD', wrT('sius.sub_score'), pr.dec == null ? '' : f1(pr.dec)) + fld('siusFSI', wrT('sius.sub_inner'), pr.inner == null ? '' : pr.inner, 'numeric') + '</div>';
      h += '<div class="sius-ea"><button type="button" class="sius-use" id="siusUseSum">' + esc(wrT('sius.use_sum', [subTx(s.sumPrinted)])) + '</button></div>';
    }
    h += '<div class="sius-eb"><button type="button" class="sius-nav2" id="siusEPrev">' + esc(wrT('sius.prev_item')) + '</button><button type="button" class="sius-nav2" id="siusENext">' + esc(wrT('sius.next_item')) + '</button><button type="button" class="sius-done" id="siusEDone">' + esc(wrT('sius.done')) + '</button></div>';
    box.innerHTML = h; box.hidden = false;
    var re = function () { var keep = st.sel; st.ck = S.check(m); st.sel = keep; render(); };
    if (sel.type === 'row') {
      var q2 = m.shots[sel.i];
      var bind = function (id, fn) { $(id).onchange = function () { fn(this.value); re(); }; $(id).onkeydown = function (e) { if (e.key === 'Enter') this.blur(); }; };
      bind('siusFDec', function (v) { edit(q2, 'dec', num(v)); }); bind('siusFT', function (v) { edit(q2, 't', normT(v)); });
      bind('siusFX', function (v) { edit(q2, 'x', num(v)); }); bind('siusFY', function (v) { edit(q2, 'y', num(v)); });
      $('siusFIn').onclick = function () { edit(q2, 'inner', !q2.inner); re(); };
      box.querySelectorAll('.sius-alt').forEach(function (b) { b.onclick = function () { edit(q2, b.dataset.f, +b.dataset.v); re(); }; });
      if ($('siusUse')) $('siusUse').onclick = function () { var c = st.ck.rows[sel.i].calc; edit(q2, 'dec', q2.decInt ? c.ring : c.dec); edit(q2, 'inner', c.inner); re(); };
      $('siusDelRow').onclick = function () { ask(wrT('sius.del_row_q'), function () { if (q2.n != null) st.edits[keyOf(q2)] = { del: true }; m.shots.splice(sel.i, 1); st.sel = null; recheck(); }); };
    } else {
      var tgtObj = function () { if (sel.type === 'sub') { while (m.subs.length <= sel.k) m.subs.push(null); if (!m.subs[sel.k]) m.subs[sel.k] = { dec: 0, inner: 0 }; return m.subs[sel.k]; } if (!m.total) m.total = { dec: 0, inner: 0 }; return m.total; };
      var keepEd = function (o) { if (sel.type === 'sub') st.subEd[sel.k] = { dec: o.dec, inner: o.inner }; else st.totEd = { dec: o.dec, inner: o.inner }; };
      $('siusFSD').onchange = function () { var o = tgtObj(); o.dec = num(this.value) || 0; keepEd(o); re(); };
      $('siusFSI').onchange = function () { var o = tgtObj(); o.inner = Math.round(num(this.value) || 0); keepEd(o); re(); };
      $('siusUseSum').onclick = function () { var s2 = sel.type === 'sub' ? st.ck.series[sel.k] : st.ck.total, o = tgtObj(); o.dec = s2.sumPrinted.dec; o.inner = s2.sumPrinted.inner; keepEd(o); re(); };
    }
    $('siusEDone').onclick = function () { st.sel = null; render(); };
    var seq = function (d) { // 依畫面順序：試射、每組（組頭＋10 發）、總分
      var list = []; st.ck.rows.filter(function (r) { return r.sighter; }).forEach(function (r) { list.push({ type: 'row', i: r.i }); });
      st.ck.series.forEach(function (s3) { list.push({ type: 'sub', k: s3.k }); s3.rows.forEach(function (i) { list.push({ type: 'row', i: i }); }); }); list.push({ type: 'total' });
      var cur = st.sel, j = -1; list.forEach(function (p, x) { if (p.type === cur.type && p.i === cur.i && p.k === cur.k) j = x; });
      pick(list[Math.max(0, Math.min(list.length - 1, j + d))]);
    };
    $('siusEPrev').onclick = function () { seq(-1); }; $('siusENext').onclick = function () { seq(1); };
  }

  /* ---------- 存成一般紀錄（分析頁） ---------- */
  function save() {
    var m = st.model; if (!m || st.busy) return;
    var go = function () {
      var rec, a = App.acur;
      if (st.recId) {
        rec = App.sessions.filter(function (x) { return x.id === st.recId; })[0]; if (!rec) return;
        if (App.isLocked && rec === a && App.isLocked()) { App.lockToast(); return; }
        if (rec.locked || (rec.sheets || []).some(function (x) { return x.locked; })) { toast(wrT('app.sh_has_locked'), 3600); return; }
      } else if (a && !a.sheets.length && !(App.isLocked && App.isLocked()) && !(App.isShared && App.isShared(a))) rec = a; // 分析頁是空的：直接放進目前這筆
      else rec = App.newAnalysis(m.targetId);
      if (!m.name && !rec.name) m.name = S.recName(m, wrT('sius.name_prefix'));
      S.toRecord(m, rec); rec.updated = new Date().toISOString();
      if (App.sessions.indexOf(rec) < 0) App.sessions.unshift(rec);
      App.saveSessions(App.sessions);
      App.acur = rec; App.anaPhotos = {}; App.anaSel = 'all'; try { store.set(App.LS_ACUR, rec.id); } catch (e) {}
      close(); App.showTab('analysis'); if (App.fillAnaCalRing) App.fillAnaCalRing(); App.renderAnalysis(); if (App.syncTargetSel) App.syncTargetSel(); window.scrollTo(0, 0);
      var ck = S.check(m); toast(wrT('sius.saved', [ck.nSighter, ck.nMatch]), 3600);
      freeUrls();
    };
    var noxy = m.shots.filter(function (q) { return q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y); }).length;
    var go2 = function () { if (noxy) ask(wrT('sius.save_noxy_q', [noxy]), go); else go(); };
    if (st.ck.bad) ask(wrT('sius.save_with_bad_q', [st.ck.bad]), go2); else go2();
  }
  // 測試用：addPasses 直接餵 OCR 文字（e2e 也會走真的照片 OCR）
  App.sius = { open: open, close: close, get state() { return st; }, addFiles: function (fs) { addFiles(fs); }, addPasses: function (ps) { st.passes = st.passes.concat(ps); st.model = buildModel(st.passes); st.sel = null; recheck(); if (!st.tgUser && !st.gunAsked && !(st.model.gun && st.model.gun.sure)) askGun(); else gunFlow(); }, pickGun: function (g) { var b = $('siusAsk'); if (b) b.remove(); pickGun(g); }, save: save, recheck: recheck, pick: pick, step: step };

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
