/* WRbeta 分析頁：多張照片、校正與找彈孔、檢視切換、右下選單、小圖表
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, $ = App.$, f1 = App.f1, f2 = App.f2, storageOK = App.storageOK, store = App.store, saveSessions = App.saveSessions,
    isAna = App.isAna, newAnalysis = App.newAnalysis, fmtTW = App.fmtTW, anaShots = App.anaShots, el = App.el, drawTarget = App.drawTarget,
    labelSize = App.labelSize, previewMark = App.previewMark, renderStats = App.renderStats, shotTable = App.shotTable, mkView = App.mkView,
    attachZoom = App.attachZoom, liftPx = App.liftPx, visRun = App.visRun, pickIsImage = App.pickIsImage, pickError = App.pickError,
    projCircle = App.projCircle, projLine = App.projLine, ask = App.ask, toast = App.toast, toastAct = App.toastAct;
  // 給其他模組用（函式）
  App.requestPersist = requestPersist; App.fillAnaCalRing = fillAnaCalRing; App.anaSetView = anaSetView; App.anaChangeTarget = anaChangeTarget;
  App.trTag = trTag; App.esc = esc; App.lineChart = lineChart; App.renderAnalysis = renderAnalysis;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'LS_ACUR', { get: function () { return LS_ACUR; }, set: function (v) { LS_ACUR = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'acur', { get: function () { return acur; }, set: function (v) { if (v === acur) return; if (ro) anaCloseRO(true); acur = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'anaRO', { get: function () { return ro; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'anaSel', { get: function () { return anaSel; }, set: function (v) { anaSel = v; }, enumerable: true, configurable: true });
  function revokePhotoUrl(P) { if (P && P.url) try { URL.revokeObjectURL(P.url); } catch (e) {} }
  function revokeAllPhotos() { Object.keys(anaPhotos).forEach(function (k) { revokePhotoUrl(anaPhotos[k]); }); }
  Object.defineProperty(App, 'anaPhotos', { get: function () { return anaPhotos; }, set: function (v) { if (v !== anaPhotos) revokeAllPhotos(); anaPhotos = v || {}; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'anaBusy', { get: function () { return anaBusy; }, set: function (v) { anaBusy = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'anaPZ', { get: function () { return anaPZ; }, set: function (v) { anaPZ = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'anaView', { get: function () { return anaView; }, set: function (v) { anaView = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'AV', { get: function () { return AV; }, set: function (v) { AV = v; }, enumerable: true, configurable: true });

  // ---------- 分析分頁（純分析：連續拍多張靶紙 → 自動校正＋找彈孔 → 統計） ----------
  var LS_ACUR = 'bm_acur_v1';
  var SHEET_COLORS = ['#1e6fd9', '#e8590c', '#2b8a3e', '#ae3ec9', '#c2255c', '#0c8599', '#5c940d', '#795548'];
  var acur = (function () { var id = store.get(LS_ACUR); return App.sessions.filter(function (s) { return s.id === id && isAna(s); })[0] || newAnalysis(); })();
  var anaSel = 'all', anaPhotos = {}, anaQueue = [], anaBusy = false;
  var ro = null, roSaved = null; // v2.5.0 唯讀檢視（見 anaOpenRO）
  var anaSvg = $('anaSvg');
  function atgt() { return T[acur.targetId] || T.ap10; }
  function requestPersist() {
    if (requestPersist.done) return;
    requestPersist.done = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  }
  function persistA() {
    if (ro) return false; // 唯讀檢視：絕不寫入（不會動到好友或原本的紀錄）
    if (!acur.sheets.length && !acur.name) return false;
    acur.updated = new Date().toISOString();
    var i = App.sessions.findIndex(function (s) { return s.id === acur.id; });
    if (i < 0) App.sessions.unshift(acur); else App.sessions[i] = acur;
    saveSessions(App.sessions); store.set(LS_ACUR, acur.id);
    requestPersist();
    $('anaSaved').textContent = storageOK ? wrT('app.saved_automatically') : wrT('app.this_view_cant_save');
    return true;
  }
  function selSheet() { return anaSel === 'all' ? null : acur.sheets.filter(function (x) { return x.id === anaSel; })[0] || null; }
  function sheetNo(sh) { return acur.sheets.indexOf(sh) + 1; }
  function isUnsure(q) { return q.src === 'auto' && q.conf != null && q.conf < 0.5; }
  // --- 照片處理（每張照片的影像只留在記憶體，不存檔） ---
  function anaCalRing() { return +$('anaCalRing').value; }
  function fillAnaCalRing() {
    var t = atgt(), sel = $('anaCalRing'); sel.innerHTML = '';
    for (var n = 1; n <= 9; n++) { var o = document.createElement('option'); o.value = n; o.textContent = wrT('app.ring_outer_diameter_mm', [n, t.ringDiam[n], t.ringDiam[n] === t.blackDiam ? wrT('app.black_edge') : '']); sel.appendChild(o); }
    sel.value = t.blackFromRing;
  }
  function anaProcess(sh, done) {
    var P = anaPhotos[sh.id]; if (!P) { if (done) done(); return; }
    P.busy = true; renderAnalysis();
    setTimeout(function () {
      var mism = null, autoSw = null;
      try {
        // v1.7.1：這次分析還沒有別張（只有這一張）時，照片的靶種和選的不一樣就直接改用照片的靶種
        var alone = acur.sheets.length === 1 && acur.sheets[0] === sh && P.mode === 'auto' && !P.noAuto;
        var r = visRun(P, acur.targetId, +$('anaSens').value, alone);
        if (alone && r.tid !== acur.targetId) {
          var from = acur.targetId; acur.targetId = r.tid; AV.reset(); fillAnaCalRing(); if (App.curTab === 'analysis') App.syncTargetSel(); P.mismatch = null;
          autoSw = { sh: sh, from: from, to: r.tid };
        } else mism = r.mismatch;
        if (P.T) {
          sh.shots = (r.det && r.det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; });
          sh.calib = { mode: P.mode, rms: C.round(P.T.rms, 3), rotDeg: P.rotDeg || 0, at: new Date().toISOString() };
        } else sh.calib = { mode: 'failed', reason: P.info && P.info.reason || '', at: new Date().toISOString() };
      } catch (e) { P.T = null; P.info = { reason: wrT('app.analysis_error', [e.message]) }; }
      P.busy = false; persistA(); renderAnalysis();
      if (autoSw) { var A = autoSw; toastAct(wrT('app.switched_to_based_on_the', [T[A.to].name]), wrT('app.undo'), function () { anaUndoAutoSwitch(A); }); }
      if (mism && !P._mismAsked && !anaMismOpen) { P._mismAsked = true; anaAskMismatch(sh, mism); }
      if (done) done();
    }, 30);
  }
  // 這次分析已經有別張、這張的靶種卻不一樣：問要不要把這張移到新的分析（用照片的靶種）
  // 自動換靶種的「復原」：換回原本選的靶種，用它重新分析這張（之後不再自動換，提示改成警告）
  function anaUndoAutoSwitch(A) {
    var P = anaPhotos[A.sh.id]; if (!P || acur.sheets.indexOf(A.sh) < 0 || acur.targetId !== A.to) return;
    acur.targetId = A.from; P.noAuto = true; P._mismAsked = true; AV.reset(); fillAnaCalRing(); if (App.curTab === 'analysis') App.syncTargetSel();
    anaProcess(A.sh); toast(wrT('app.changed_back_to', [T[A.from].name]));
  }
  var anaMismOpen = false;
  function anaAskMismatch(sh, mid) {
    anaMismOpen = true;
    ask(wrT('app.this_photo_looks_like_a', [T[mid].name, atgt().name, T[mid].name]), function () {
      anaMismOpen = false;
      var P = anaPhotos[sh.id], i = acur.sheets.indexOf(sh); if (!P || i < 0) return;
      acur.sheets.splice(i, 1); persistA();
      acur = newAnalysis(mid); anaPhotos = {}; anaPhotos[sh.id] = P; sh.shots = []; acur.sheets.push(sh); anaSel = sh.id; anaView = 'target';
      P.mode = 'auto'; P.calPts = []; P.mismatch = null; AV.reset(); store.set(LS_ACUR, acur.id); fillAnaCalRing(); if (App.curTab === 'analysis') App.syncTargetSel();
      anaProcess(sh); toast(wrT('app.moved_to_a_new_analysis', [T[mid].name]));
    }, function () { anaMismOpen = false; });
  }
  function anaLoadFile(file, done) {
    var sh = { id: 'h' + Date.now() + Math.floor(Math.random() * 1000), created: new Date().toISOString(), shots: [], calib: null, photo: { w: 0, h: 0, name: file.name || '' } };
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      acur.sheets.push(sh); anaSel = sh.id;
      anaPhotos[sh.id] = { url: url, img: im, w: im.naturalWidth, h: im.naturalHeight, mode: 'auto', calPts: [], T: null, Tinv: null, g: null, rotDeg: 0, zoom: 1, busy: false };
      sh.photo.w = im.naturalWidth; sh.photo.h = im.naturalHeight;
      anaProcess(sh, done);
    };
    im.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} pickError(file); if (done) done(); };
    im.src = url;
  }
  function anaEnqueue(files) {
    if (ro) { toast(wrT('app.ro_close_first')); return; }
    for (var i = 0; i < files.length; i++) { if (pickIsImage(files[i])) anaQueue.push(files[i]); else pickError(files[i]); }
    if (!anaBusy) anaNext();
  }
  function anaNext() {
    var f = anaQueue.shift(); anaBusy = !!f; $('anaQueue').textContent = anaQueue.length ? wrT('app.queued', [anaQueue.length]) : '';
    if (f) anaLoadFile(f, anaNext); else renderAnalysis();
  }
  $('anaCam').onchange = function () { anaEnqueue(this.files); this.value = ''; };
  $('anaPick').onchange = function () { anaEnqueue(this.files); this.value = ''; };
  $('anaFile').onchange = function () { anaEnqueue(this.files); this.value = ''; };
  function anaPhotoDraw() {
    var sh = selSheet(), P = sh && anaPhotos[sh.id], svg = $('anaPhotoSvg');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!P) return;
    var u = Math.max(P.w, P.h) / 300;
    P.calPts.forEach(function (q) { el('circle', { cx: q.px, cy: q.py, r: u * 1.6, fill: 'none', stroke: '#00e5ff', 'stroke-width': u * 0.5 }, svg); });
    if (!P.Tinv) return;
    var Ti = P.Tinv, t = atgt();
    var g = svg;
    for (var n = 1; n <= 10; n++) el('path', { d: projCircle(Ti, t.ringDiam[n] / 2), fill: 'none', stroke: '#39ff14', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, g);
    var RR = t.ringDiam[1] / 2 + 2;
    el('path', { d: projLine(Ti, 0, -RR, 0, RR), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
    el('path', { d: projLine(Ti, -RR, 0, RR, 0), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
    sh.shots.forEach(function (a, i) {
      var low = isUnsure(a);
      el('path', { d: projCircle(Ti, t.pellet / 2, a.x, a.y, 24), fill: low ? 'rgba(255,179,0,.25)' : 'rgba(255,40,40,.25)', stroke: low ? '#ffb300' : '#ff2828', 'stroke-width': low ? 3 : 2.5, 'stroke-dasharray': low ? '5 3' : '', 'vector-effect': 'non-scaling-stroke' }, g);
      var pp = C.applyAffine(Ti, a.x, a.y);
      var tx = el('text', { x: pp.x + u * 2.4, y: pp.y - u * 2.4, 'font-size': u * 4, fill: low ? '#ffb300' : '#ffeb3b', stroke: '#000', 'stroke-width': u * 0.6, 'paint-order': 'stroke', 'font-weight': 'bold' }, svg);
      tx.textContent = (i + 1) + (low ? '?' : '');
    });
  }
  function anaHint(sh, P) {
    var h = $('anaHint');
    if (P.busy) { h.innerHTML = wrT('app.analyzing_photo'); return; }
    if (P.mode === 'manual' && P.calPts.length < 5) {
      var i = P.calPts.length, nm = [wrT('app.the_center_center_point'), wrT('app.top'), wrT('app.right'), wrT('app.bottom'), wrT('app.left')];
      h.innerHTML = wrT('app.manual_calibration_5_tap', [i + 1, i === 0 ? nm[0] : wrT('app.the_of_ring_s_outer', [anaCalRing(), nm[i]])]); return;
    }
    if (!P.T) { h.innerHTML = wrT('app.auto_calibration_failed_tap_manual_3', [P.info && P.info.reason || wrT('app.unknown_reason')]); return; }
    var un = sh.shots.filter(isUnsure).length;
    var mw = P.mismatch && T[P.mismatch] ? wrT('app.this_looks_like_a_target_3', [T[P.mismatch].name, atgt().name]) : '';
    h.innerHTML = wrT('app.target_shot_holes_detected_tap', [mw, sheetNo(sh), sh.shots.length, un ? wrT('app.of_which_uncertain_orange_dashed', [un]) : '', f2(P.T.rms || 0), P.rotDeg ? wrT('app.rotated_2', [P.rotDeg]) : '']);
  }
  /* v2.5.0【White 指定】修正彈孔改成兩個模式鈕（取代舊的「點空白新增、點彈孔刪除」）：
   *   沒選模式＝點靶面不做任何事（單指可以直接捲動畫面）；添加＝每點一下加一發（疊在既有彈孔上也照加）；
   *   消滅＝每點一下刪掉最近的一發（重疊時一次只刪一發；離太遠不刪）。再按一次亮著的按鈕＝結束。 */
  var anaMode = null;
  function anaSetMode(m, quiet) {
    if (App.anaRO) m = null;
    var was = anaMode; anaMode = m === anaMode ? null : m;
    [['anaModeAdd', 'add'], ['anaModeDel', 'del']].forEach(function (x) { var b = $(x[0]), on = anaMode === x[1]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var box = $('anaBox'); box.classList.toggle('mode-add', anaMode === 'add'); box.classList.toggle('mode-del', anaMode === 'del'); $('anaWrap').classList.toggle('ana-moding', !!anaMode);
    var bar = $('anaModeBar'); bar.hidden = !anaMode; bar.className = 'ana-modebar' + (anaMode ? ' ' + anaMode : ''); bar.innerHTML = anaMode === 'add' ? wrT('app.mode_add_bar') : anaMode === 'del' ? wrT('app.mode_del_bar') : '';
    if (!anaMode) { anaPrev = null; anaPrevClear(); }
    if (!quiet && was !== anaMode) toast(anaMode === 'add' ? wrT('app.mode_add_on') : anaMode === 'del' ? wrT('app.mode_del_on') : wrT('app.mode_off'));
  }
  App.anaSetMode = anaSetMode;
  Object.defineProperty(App, 'anaMode', { get: function () { return anaMode; }, enumerable: true, configurable: true });
  function anaTapHole(sh, m, tol) { // 依目前模式加一發或刪最近的一發；tol＝刪除時可接受的距離（mm）
    var t = atgt();
    if (anaMode === 'add') { var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual' }; sh.shots.push(q); sh._undo = { op: 'add', q: q }; toast(wrT('app.shot_hole_added')); }
    else if (anaMode === 'del') {
      var bi = -1, bd = Infinity;
      sh.shots.forEach(function (a, i) { var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd - 1e-9) { bd = d; bi = i; } });
      if (bi < 0 || bd > Math.max(t.pellet / 2 * 1.1, tol || 0)) { toast(wrT('app.no_hole_here')); return; }
      var rm = sh.shots.splice(bi, 1)[0]; sh._undo = { op: 'del', q: rm, i: bi }; toast(wrT('app.shot_hole_deleted'));
    } else return;
    persistA(); renderAnalysis();
  }
  $('anaModeAdd').onclick = function () { anaSetMode('add'); };
  $('anaModeDel').onclick = function () { anaSetMode('del'); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && anaMode && App.curTab === 'analysis') anaSetMode(null); });
  // v1.6.0：照片檢視改成雙指縮放／單指平移（CSS transform；點選照片仍用 img 的實際位置換算，不受縮放影響）
  var anaPZ = { s: 1, x: 0, y: 0, bw: 0, bh: 0, sid: null, moved: 0 };
  function anaPZLayout(reset) { // 依照片比例把 inner 放進方形舞台
    var sh = selSheet(), P = sh && anaPhotos[sh.id], box = $('anaPhotoBox'), inn = $('anaPhotoInner');
    if (!P || !box.clientWidth) return;
    var W = box.clientWidth, H = box.clientHeight, k = Math.min(W / P.w, H / P.h);
    anaPZ.bw = P.w * k; anaPZ.bh = P.h * k; inn.style.width = anaPZ.bw + 'px'; inn.style.height = anaPZ.bh + 'px';
    if (reset || anaPZ.sid !== sh.id) { anaPZ.s = 1; anaPZ.sid = sh.id; }
    anaPZApply();
  }
  function anaPZApply() {
    var box = $('anaPhotoBox'), W = box.clientWidth, H = box.clientHeight, z = anaPZ;
    z.s = Math.max(1, Math.min(8, z.s));
    var cw = z.bw * z.s, chh = z.bh * z.s;
    z.x = cw <= W ? (W - cw) / 2 : Math.min(0, Math.max(W - cw, z.x));
    z.y = chh <= H ? (H - chh) / 2 : Math.min(0, Math.max(H - chh, z.y));
    $('anaPhotoInner').style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
    anaFitLabel();
  }
  function anaFitLabel() {
    var fb = $('anaFit'), sp = fb.querySelector('span'), z;
    if (anaView === 'photo' && selSheet() && anaPhotos[selSheet().id]) z = anaPZ.s; else z = atgt().cardSize / ((AV.v && AV.v.E) || atgt().cardSize);
    var zoomed = z > 1.05; fb.classList.toggle('zoomed', zoomed); sp.textContent = zoomed ? wrT('app.full_target', [Math.round(z * 10) / 10]) : wrT('app.pinch_to_zoom');
  }
  (function () {
    var box = $('anaPhotoBox'), ptrs = {}, pin = null, pan = null;
    function pts() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
    function local(x, y) { var r = box.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; }
    function zoomAt(m, s1) { var z = anaPZ, u = (m.x - z.x) / z.s, v = (m.y - z.y) / z.s; z.s = Math.max(1, Math.min(8, s1)); z.x = m.x - u * z.s; z.y = m.y - v * z.s; anaPZApply(); }
    box.addEventListener('pointerdown', function (ev) {
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var p = pts();
      if (p.length === 2) { var m = local((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2); pin = { d: Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), s: anaPZ.s, m: m, x: anaPZ.x, y: anaPZ.y }; pan = null; anaPZ.moved = Date.now(); }
      else if (p.length === 1) pan = { x: ev.clientX, y: ev.clientY, x0: anaPZ.x, y0: anaPZ.y, go: false };
    });
    box.addEventListener('pointermove', function (ev) {
      if (!ptrs[ev.pointerId]) return; ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var p = pts();
      if (pin && p.length >= 2) {
        ev.preventDefault();
        var d = Math.max(10, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), m = local((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
        var z = anaPZ, s1 = Math.max(1, Math.min(8, pin.s * d / pin.d)), u = (pin.m.x - pin.x) / pin.s, v = (pin.m.y - pin.y) / pin.s;
        z.s = s1; z.x = m.x - u * s1; z.y = m.y - v * s1; anaPZApply(); anaPZ.moved = Date.now();
      } else if (pan && anaPZ.s > 1.01) {
        var dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
        if (!pan.go && Math.hypot(dx, dy) > 6) pan.go = true;
        if (pan.go) { ev.preventDefault(); anaPZ.x = pan.x0 + dx; anaPZ.y = pan.y0 + dy; anaPZApply(); anaPZ.moved = Date.now(); }
      }
    });
    function end(ev) { delete ptrs[ev.pointerId]; if (pts().length < 2) pin = null; if (!pts().length) pan = null; }
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    box.addEventListener('wheel', function (ev) { if (!(ev.ctrlKey || anaPZ.s > 1 || ev.deltaY < 0)) return; ev.preventDefault(); zoomAt(local(ev.clientX, ev.clientY), anaPZ.s * Math.pow(1.0018, -ev.deltaY)); }, { passive: false });
    window.addEventListener('resize', function () { if (anaView === 'photo') anaPZLayout(false); });
  })();
  $('anaImg').addEventListener('click', function (ev) {
    var sh = selSheet(), P = sh && anaPhotos[sh.id]; if (!P || P.busy) return;
    if (Date.now() - anaPZ.moved < 350) return; // 剛縮放／平移完的那一下不算點選
    var r = this.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * P.w, py = (ev.clientY - r.top) / r.height * P.h;
    if (P.mode === 'manual' && P.calPts.length < 5) {
      var tt = C.calibTargets(atgt(), anaCalRing())[P.calPts.length];
      P.calPts.push({ px: px, py: py, x: tt.x, y: tt.y });
      if (P.calPts.length === 5) { P.T = C.fitAffine(P.calPts); if (!P.T) { toast(wrT('app.calibration_failed_please_tap_again')); P.calPts = []; } else { P.rotDeg = 0; anaProcess(sh); return; } }
      renderAnalysis(); return;
    }
    if (!P.T) return;
    if (!anaMode) return; // v2.5.0：沒選模式＝不做任何事
    var p1 = C.applyAffine(P.T, px, py), p2 = C.applyAffine(P.T, px + 22 / r.width * P.w, py); // 22 個螢幕像素換成 mm，給手指一點容許範圍
    anaTapHole(sh, p1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  });
  // --- 檢視切換：靶面｜照片（照片只在選了單張、且這次有拍照時可用；合併時停用） ---
  var anaView = 'target';
  function anaSetView(v) {
    var sh = selSheet(), P = sh && anaPhotos[sh.id];
    if (v === 'photo' && !P) { toast(sh ? wrT('app.this_targets_photo_wasnt_kept') : wrT('app.the_combined_view_has_no')); v = 'target'; }
    var changed = anaView !== v; anaView = v; renderAnalysis(); if (changed && v === 'photo') anaPZLayout(true);
  }
  $('anaViewSeg').querySelectorAll('button').forEach(function (b) { b.onclick = function () { anaSetView(b.dataset.v); }; });
  // --- 右下玻璃圓鈕的彈出選單（校正／清除）：同時只開一個；點外面或按 Esc 關閉 ---
  var anaPopOpen = null;
  function anaPop(id, open) {
    ['anaCalPop', 'anaClearPop'].forEach(function (k) {
      var on = open && k === id, btn = $(k === 'anaCalPop' ? 'anaCalBtn' : 'anaClearBtn');
      $(k).hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false'); btn.classList.toggle('on', on);
    });
    anaPopOpen = open ? id : null;
    if (open) anaPopSync();
  }
  function anaPopSync() {
    var sh = selSheet(), P = sh && anaPhotos[sh.id], tot = anaShots(acur).length;
    $('anaDelSheet').disabled = !sh; $('anaClearAll').disabled = !acur.sheets.length;
    $('anaDelAna').disabled = !!App.anaRO || (!anaInRecords() && !acur.sheets.length && !acur.name);
    $('anaDelAnaSub').textContent = anaInRecords() || acur.sheets.length || acur.name ? wrT('h.delete_whole_record_incl_name') : wrT('app.not_saved_yet');
    $('anaDelSub').textContent = sh ? wrT('app.target_shots', [sheetNo(sh), sh.shots.length]) : wrT('app.pick_one_below_first');
    $('anaAllSub').textContent = acur.sheets.length ? wrT('app.this_analysis_targets_shots', [acur.sheets.length, tot]) : wrT('app.no_records_yet');
    ['anaAutoCal', 'anaManual'].forEach(function (k) { $(k).disabled = !P || P.busy; });
    ['anaRedetect', 'anaRotL', 'anaRotR'].forEach(function (k) { $(k).disabled = !P || !P.T || P.busy; });
    $('anaCalNote').textContent = !sh ? wrT('app.pick_a_photo_below_first') : !P ? wrT('app.this_targets_photo_wasnt_kept_2') : P.T ? wrT('app.green_circles_should_match_the_2') : wrT('app.auto_calibration_failed_tap_manual_4');
  }
  $('anaCalBtn').onclick = function (e) { e.stopPropagation(); anaPop('anaCalPop', anaPopOpen !== 'anaCalPop'); };
  $('anaClearBtn').onclick = function (e) { e.stopPropagation(); anaPop('anaClearPop', anaPopOpen !== 'anaClearPop'); };
  document.addEventListener('pointerdown', function (e) { if (anaPopOpen && !e.target.closest('.ana-pop,#anaCalBtn,#anaClearBtn')) anaPop(null, false); if (!$('anaPickHint').hidden && !e.target.closest('#anaPickHint,#anaPickInfo')) anaPickHint(false); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (anaPopOpen) anaPop(null, false); anaPickHint(false); } });
  App.anaPopClose = function () { anaPop(null, false); anaPickHint(false); }; // v2.5.0 返回鍵
  function anaPickHint(on) { $('anaPickHint').hidden = !on; $('anaPickInfo').setAttribute('aria-expanded', on ? 'true' : 'false'); }
  $('anaPickInfo').onclick = function (e) { e.stopPropagation(); anaPickHint($('anaPickHint').hidden); };
  $('anaAutoCal').onclick = function () { var sh = selSheet(), P = sh && anaPhotos[sh.id]; anaPop(null, false); if (P) { P.mode = 'auto'; P.calPts = []; $('anaCalRingRow').style.display = 'none'; anaProcess(sh); } };
  $('anaRedetect').onclick = function () { var sh = selSheet(), P = sh && anaPhotos[sh.id]; anaPop(null, false); if (P && P.T) anaProcess(sh); };
  $('anaSens').onchange = function () { anaSensSync(); var sh = selSheet(), P = sh && anaPhotos[sh.id]; if (P && P.T) anaProcess(sh); };
  function anaSensSync() { var v = $('anaSens').value; $('anaSensSeg').querySelectorAll('button').forEach(function (b) { var on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); }); }
  $('anaSensSeg').querySelectorAll('button').forEach(function (b) { b.onclick = function () { if ($('anaSens').value === b.dataset.v) return; $('anaSens').value = b.dataset.v; $('anaSens').onchange(); }; });
  $('anaManual').onclick = function () { var sh = selSheet(), P = sh && anaPhotos[sh.id]; anaPop(null, false); if (!P) return; P.mode = 'manual'; P.calPts = []; P.T = null; P.Tinv = null; $('anaCalRingRow').style.display = ''; anaView = 'photo'; renderAnalysis(); anaPZLayout(true); };
  $('anaCalRing').onchange = function () { var sh = selSheet(), P = sh && anaPhotos[sh.id]; if (P && P.mode === 'manual') { P.calPts = []; P.T = null; P.Tinv = null; renderAnalysis(); } };
  function anaRotate(deg) {
    var sh = selSheet(), P = sh && anaPhotos[sh.id]; if (!P || !P.T) return;
    var th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), rms = P.T.rms;
    P.T = window.BMVision.rotateAffine(P.T, th); P.T.rms = rms; P.Tinv = C.invertAffine(P.T); P.rotDeg = (P.rotDeg || 0) + deg;
    sh.shots = sh.shots.map(function (q) { return Object.assign({}, q, { x: C.round(c * q.x - sn * q.y, 3), y: C.round(sn * q.x + c * q.y, 3) }); });
    if (sh.calib) sh.calib.rotDeg = P.rotDeg;
    persistA(); renderAnalysis(); toast(wrT('app.rotated', [P.rotDeg]));
  }
  $('anaRotL').onclick = function () { anaRotate(-1); }; $('anaRotR').onclick = function () { anaRotate(1); };
  // --- 向量靶面：只用雙指縮放（與預報相同的 attachZoom）；一指點選修正（沒有照片時也能改） ---
  var AV = mkView(anaSvg, $('anaFit'), atgt, function () { return acur.targetId; }), anaPrev = null;
  function anaPrevClear() { var g = anaSvg.querySelector('#preview'); if (g) while (g.firstChild) g.removeChild(g.firstChild); }
  attachZoom(anaSvg, {
    active: function () { return true; },
    view: function () { AV.ensure(); return AV.v; }, clamp: AV.clamp, apply: function () { AV.apply(); anaFitLabel(); }, render: function () { renderAnalysis(); },
    lift: function () { return liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) { if (anaMode !== 'add' || !selSheet()) return; anaPrev = { x: r.x, y: -r.y }; previewMark(anaSvg, anaPrev, 'act-c', atgt()); },
    up: function (r) {
      anaPrev = null; anaPrevClear();
      if (!anaMode) return; // v2.5.0：沒選模式＝點靶面不做任何事
      var sh = selSheet(); if (!sh) { toast(acur.sheets.length ? wrT('app.pick_a_target_below_first') : wrT('app.tap_next_photo_first_or')); return; }
      var p = { x: r.x, y: -r.y }, half = atgt().cardSize / 2 + 1; if (Math.abs(p.x) > half || Math.abs(p.y) > half) return;
      var E = (AV.v && AV.v.E) || atgt().cardSize, w = anaSvg.clientWidth || 300;
      anaTapHole(sh, p, 22 * E / w);
    },
    cancel: function () { anaPrev = null; anaPrevClear(); }
  });
  $('anaFit').onclick = function () { if (anaView === 'photo' && selSheet() && anaPhotos[selSheet().id]) { anaPZ.s = 1; anaPZApply(); } else { AV.reset(); renderAnalysis(); } };
  function anaTg(btn, cb) { btn.onclick = function () { cb.checked = !cb.checked; btn.classList.toggle('on', cb.checked); btn.setAttribute('aria-checked', cb.checked ? 'true' : 'false'); renderAnalysis(); }; }
  anaTg($('anaTgCenter'), $('anaShowCenter')); anaTg($('anaTgOut'), $('anaShowOut')); anaTg($('anaTgSpread'), $('anaShowSpread')); // v2.5.0 散布圈（預設關）
  $('anaUndo').onclick = function () {
    var sh = selSheet(); if (!sh || !sh._undo) { toast(sh ? wrT('app.nothing_to_undo_for_this') : wrT('app.pick_one_below_first_to')); return; }
    var u = sh._undo; if (u.op === 'add') { var i = sh.shots.indexOf(u.q); if (i >= 0) sh.shots.splice(i, 1); } else sh.shots.splice(Math.min(u.i, sh.shots.length), 0, u.q);
    sh._undo = null; persistA(); renderAnalysis(); toast(wrT('app.undone'));
  };
  $('anaDelSheet').onclick = function () {
    var sh = selSheet(); anaPop(null, false); if (!sh) return;
    ask(wrT('app.clear_this_target_target_shots', [sheetNo(sh), sh.shots.length]), function () {
      acur.sheets = acur.sheets.filter(function (x) { return x !== sh; }); revokePhotoUrl(anaPhotos[sh.id]); delete anaPhotos[sh.id]; anaSel = 'all'; anaSaveOrDrop(); renderAnalysis(); toast(wrT('app.target_cleared'));
    });
  };
  // v1.6.0 清除所有紀錄：清掉這次分析的全部照片與每張紀錄（名稱、日期保留；沒有名稱就從「紀錄」移除這筆空分析）
  $('anaClearAll').onclick = function () {
    anaPop(null, false); if (!acur.sheets.length) return;
    ask(wrT('app.clear_everything_all_photos_and', [acur.sheets.length, anaShots(acur).length]), function () {
      revokeAllPhotos();
      acur.sheets = []; anaPhotos = {}; anaSel = 'all'; anaView = 'target'; anaSaveOrDrop(); renderAnalysis(); toast(wrT('app.everything_in_this_analysis_cleared'));
    });
  };
  // v2.5.0 刪除目前分析：整筆（名稱、日期、全部靶紙）從紀錄刪掉，雲端也刪；之後開一個新的空分析
  function anaInRecords() { return App.sessions.some(function (x) { return x.id === acur.id; }); }
  $('anaDelAna').onclick = function () {
    anaPop(null, false); if (App.anaRO || (!anaInRecords() && !acur.sheets.length && !acur.name)) return;
    var nm = (acur.name && acur.name.trim()) || App.recTitle(acur);
    ask(wrT('app.delete_current_analysis_q', [nm, acur.sheets.length, anaShots(acur).length]), function () {
      var id = acur.id;
      App.sessions = App.sessions.filter(function (x) { return x.id !== id; }); saveSessions(App.sessions);
      try { if (window.WRCloud && window.WRCloud.remove) window.WRCloud.remove(id); } catch (e) {}
      anaStartNew(acur.targetId, wrT('app.analysis_deleted'));
      try { App.renderRecords(); } catch (e) {}
    }, null, { yes: wrT('app.delete_permanently_short'), danger: true });
  };
  function anaSaveOrDrop() { // 還有資料（或有名稱）就存；變成空的未命名分析就從紀錄移除
    if (persistA()) return;
    var n = App.sessions.length; App.sessions = App.sessions.filter(function (x) { return x.id !== acur.id; });
    if (App.sessions.length !== n) saveSessions(App.sessions);
    store.set(LS_ACUR, acur.id);
  }
  $('anaName').oninput = function () { if (ro) return; acur.name = this.value; persistA(); $('anaClearBtn').disabled = !acur.sheets.length && !anaInRecords() && !acur.name; };
  function anaStartNew(tid, msg) { anaSetMode(null, true); revokeAllPhotos(); acur = newAnalysis(tid || acur.targetId); anaPhotos = {}; anaSel = 'all'; anaView = 'target'; AV.reset(); store.set(LS_ACUR, acur.id); fillAnaCalRing(); renderAnalysis(); if (App.curTab === 'analysis') App.syncTargetSel(); toast(msg || wrT('app.new_analysis_started')); }
  $('anaNew').onclick = function () {
    if (acur.sheets.length) ask(wrT('app.the_current_analysis_is_saved'), function () { anaStartNew(); }); else anaStartNew();
  };
  // 換靶種：v1.6.0 起分析頁沒有自己的選單，改用右上角共用的靶種選單（見 tsel.onchange；在分析分頁時改的是分析的靶種）
  function anaChangeTarget(id, revert) {
    if (id === acur.targetId) return;
    if (ro) { toast(wrT('app.ro_close_first')); if (revert) revert(); App.syncTargetSel(); return; }
    if (acur.sheets.length) ask(wrT('app.switching_to_starts_a_new', [T[id].name]), function () { anaStartNew(id, wrT('app.switched_to_new_analysis_started', [T[id].name])); }, revert);
    else { acur.targetId = id; AV.reset(); fillAnaCalRing(); renderAnalysis(); }
  }
  // ---------- v2.5.0 唯讀檢視：好友分享給我的紀錄、預報對照分析 ----------
  // 用完整的分析頁（所有模塊）看「別人的／預報的」資料；暫時換掉 acur，關閉時換回自己的分析。
  // 這段期間 persistA 不寫入、不能改彈孔、不能換靶種；原本的紀錄（好友的或預報的）完全不動。
  function roPairMode(s) { return s.pairMode || ((s.actuals || []).some(function (a) { return a.src === 'auto'; }) ? 'optimal' : 'order'); }
  function hasRounds(s) { return (s.preds || []).concat(s.actuals || []).some(function (p) { return p && p.r > 0; }); }
  /* 預報紀錄 → 給分析頁看的資料：實際彈孔（有分輪就每輪一張）＋預報↔實際配對 */
  function forecastView(s, sel) {
    var t = T[s.targetId] || T.ap10, LF = window.BMLite, sheets = [], pairs = [], multi = false, cmp0 = null, preds = [], acts = [];
    if (LF && (sel != null || hasRounds(s))) {
      var res = LF.result(t, s, sel == null ? 'all' : sel); multi = res.rounds.length > 1; cmp0 = res.cmp; preds = res.preds; acts = res.acts;
      res.rounds.forEach(function (k) {
        var a = LF.pointsOf(s.actuals, k);
        if (a.length) sheets.push({ id: 'r' + k, created: s.created, shots: a.map(function (p) { return { x: p.x, y: p.y, src: p.src || 'auto' }; }), calib: null, photo: null });
      });
      var nIn = {}; // 標籤＝「第幾輪-這輪第幾發預報」
      pairs = res.cmp.pairs.slice().sort(function (a, b) { return (a.r - b.r) || (a.i - b.i); }).map(function (q) { nIn[q.r] = (nIn[q.r] || 0) + 1; return Object.assign({}, q, { lab: multi ? (q.r + 1) + '-' + nIn[q.r] : String(nIn[q.r]) }); });
    } else {
      var acts = (s.actuals || []).map(function (p) { return { x: p.x, y: p.y, src: p.src || 'auto' }; });
      if (acts.length) sheets.push({ id: 'r0', created: s.created, shots: acts, calib: null, photo: null });
      cmp0 = C.comparePredictions(t, s.preds || [], s.actuals || [], roPairMode(s)); preds = s.preds || []; acts = s.actuals || [];
      pairs = cmp0.pairs.map(function (q) { return Object.assign({}, q, { lab: String(q.i) }); });
    }
    pairs.sort(function (a, b) { return ((a.r || 0) - (b.r || 0)) || (a.i - b.i); });
    // v2.7.0 PDF：預報對照的完整結果（配對照上面的標籤與順序）
    var fc = pairs.length && cmp0 ? { cmp: Object.assign({}, cmp0, { pairs: pairs }), preds: preds, acts: acts } : null;
    return { view: { v: 2, kind: 'analysis', id: 'ro_' + s.id, created: s.created, tz: 'Asia/Taipei', name: s.name || '', note: '', targetId: s.targetId, sheets: sheets }, pairs: pairs, fc: fc };
  }
  /* o = { kind: 'friend' | 'cmp', title, sub, sel(預報的輪次), saveable, onSave, onClose } */
  function anaOpenRO(rec, o) {
    o = o || {}; if (!rec) return false;
    var v;
    if (isAna(rec)) v = { view: JSON.parse(JSON.stringify(rec)), pairs: null };
    else v = forecastView(JSON.parse(JSON.stringify(rec)), o.sel);
    v.view.id = 'ro_' + String(rec.id || 'x'); if (!T[v.view.targetId]) v.view.targetId = 'ap10';
    if (ro) anaCloseRO(true);
    anaSetMode(null, true); anaPop(null, false); anaPrevClear();
    roSaved = { acur: acur, anaPhotos: anaPhotos, anaSel: anaSel, anaView: anaView, tab: App.curTab, y: window.scrollY };
    ro = { kind: o.kind || 'friend', rec: rec, sel: o.sel, fc: v.fc || null, title: o.title || v.view.name || '', sub: o.sub || '', pairs: v.pairs, onSave: o.onSave || null, onClose: o.onClose || null, saved: false };
    acur = v.view; acur.name = ro.title; anaPhotos = {}; anaSel = 'all'; anaView = 'target'; AV.reset();
    document.body.classList.add('ana-ro'); $('anaName').readOnly = true;
    anaRoBar();
    if (App.curTab !== 'analysis') App.showTab('analysis'); else { fillAnaCalRing(); renderAnalysis(); App.syncTargetSel(); }
    fillAnaCalRing(); window.scrollTo(0, 0);
    if (App.back) App.back.push('anaro', function () { anaCloseRO(); });
    return true;
  }
  function anaRoBar() {
    $('anaRoBar').hidden = !ro; if (!ro) return;
    $('anaRoTitle').textContent = ro.title || (ro.kind === 'cmp' ? wrT('app.ro_title_cmp') : wrT('member.shared_record'));
    $('anaRoSub').textContent = ro.sub;
    $('anaRoSave').hidden = !ro.onSave; $('anaRoSave').disabled = ro.saved;
    $('anaRoSave').textContent = ro.saved ? wrT('app.ro_saved') : wrT('h.save_as_my_record');
    $('anaRoClose').textContent = ro.kind === 'cmp' ? wrT('app.ro_back_to_cmp') : wrT('h.close');
  }
  function anaCloseRO(silent) {
    if (!ro) return;
    var cb = ro.onClose, back = roSaved || {};
    ro = null; roSaved = null; anaSetMode(null, true); anaPrevClear();
    acur = back.acur || acur; anaPhotos = back.anaPhotos || {}; anaSel = back.anaSel || 'all'; anaView = back.anaView || 'target'; AV.reset();
    document.body.classList.remove('ana-ro'); $('anaName').readOnly = false; anaRoBar(); fillAnaCalRing();
    if (App.back) App.back.drop('anaro');
    if (silent) return;
    if (back.tab && back.tab !== App.curTab) App.showTab(back.tab); else { renderAnalysis(); App.syncTargetSel(); }
    try { window.scrollTo(0, back.y || 0); } catch (e) {}
    if (cb) cb(back);
  }
  $('anaRoClose').onclick = function () { anaCloseRO(); };
  $('anaRoSave').onclick = function () {
    if (!ro || !ro.onSave || ro.saved) return;
    var r = ro; ro.onSave(r.rec, function () { r.saved = true; anaRoBar(); });
  };
  /* 另存成我的紀錄：整筆深拷貝、換新的 id（之後改這份不會影響對方；對方的紀錄本來就改不到） */
  function saveCopy(rec, extra) {
    var c = JSON.parse(JSON.stringify(rec)), now = new Date();
    c.id = (isAna(c) ? 'a' : 's') + now.getTime() + Math.floor(Math.random() * 1000);
    c.updated = now.toISOString(); delete c.round;
    Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
    App.sessions.unshift(c); saveSessions(App.sessions);
    try { App.renderRecords(); } catch (e) {}
    return c;
  }
  // v2.5.0 分析頁「分享給好友」：選好友（同紀錄頁）；要先登入、建立會員
  function anaShareSync() {
    anaPdfSync();
    var M = window.WRMember, on = !ro && !!(M && M.canShare && M.canShare());
    $('anaShareCard').hidden = !on; if (!on) return;
    var n = 0; try { M.sharesOf(acur.id).forEach(function (x) { n += (x.to || []).length; }); } catch (e) {}
    $('anaShareFriends').disabled = !anaShots(acur).length;
    $('anaShareInfo').textContent = n ? wrT('app.shared_with', [n]) : '';
  }
  function anaPdfSync() { var b = $('anaPdfBtn'); if (b) b.disabled = !anaShots(acur).length; }
  $('anaShareFriends').onclick = function () {
    var M = window.WRMember; if (ro || !M || !anaShots(acur).length) return;
    persistA(); M.shareRecord(acur);
  };
  App.anaShareSync = anaShareSync;
  /* v2.7.0 匯出 PDF 的資料來源：s 省略＝分析頁目前看的（自己的分析、好友分享的唯讀、預報對照唯讀）；給 s＝紀錄頁那一筆。
   * 回傳 { rec:分析格式, fc:預報對照或 null }；只用紀錄本身的資料。 */
  App.pdfSource = function (s) {
    if (!s) {
      if (ro) return { rec: JSON.parse(JSON.stringify(acur)), fc: ro.fc || null };
      var a = JSON.parse(JSON.stringify(acur)); if (!(a.name && a.name.trim())) a.name = App.recTitle(acur); return { rec: a, fc: null };
    }
    if (isAna(s)) { var c = JSON.parse(JSON.stringify(s)); if (!(c.name && c.name.trim())) c.name = App.recTitle(s); return { rec: c, fc: null }; }
    var v = forecastView(JSON.parse(JSON.stringify(s))); v.view.name = App.recTitle(s);
    return { rec: v.view, fc: v.fc };
  };
  App.anaOpenRO = anaOpenRO; App.anaCloseRO = anaCloseRO; App.anaSaveCopy = saveCopy;
  /* 預報對照分析（Pro 對照區、Lite 第 3 步的按鈕）：s＝目前預報、sel＝Lite 的輪次（Pro 不給＝整組，跟對照區一樣的配對方式） */
  App.anaOpenCmp = function (s, sel) {
    var t = T[s.targetId] || T.ap10, v = forecastView(s, sel);
    if (!v.pairs.length) { toast(wrT('app.ro_cmp_need_pairs')); return false; }
    var lbl = sel == null || sel === 'all' ? '' : wrT('app.round', [sel + 1]) + wrT('core.x_3');
    return anaOpenRO(s, { kind: 'cmp', sel: sel, title: (s.name && s.name.trim()) || wrT('app.ro_title_cmp'),
      sub: lbl + wrT('app.ro_cmp_sub', [v.pairs.length, anaShots(v.view).length, t.name]) });
  };
  // --- 小圖表（SVG） ---
  function trTag(tr, upGood, extra) { // 趨勢標籤：好轉綠、變差紅、持平灰
    var cls = tr.dir === '持平' || tr.dir === '資料不足' ? 'tr-flat' : ((tr.dir === '上升') === upGood ? 'tr-good' : 'tr-bad');
    return '<b class="' + cls + '">' + wrT.v(tr.dir) + (extra || '') + '</b>';
  }
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function lineChart(vals, labels, opt) {
    opt = opt || {}; var W = 320, H = 136, L = 38, R = 22, Tp = 18, B = 26, n = vals.length;
    if (!n) return '';
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (opt.min != null) lo = Math.min(lo, opt.min); if (hi - lo < (opt.minSpan || 0.5)) { var mid = (hi + lo) / 2; lo = mid - (opt.minSpan || 0.5) / 2; hi = mid + (opt.minSpan || 0.5) / 2; }
    var pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    var X = function (i) { return n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1); }, Y = function (v) { return Tp + (hi - v) / (hi - lo) * (H - Tp - B); };
    var col = opt.color || 'var(--ana-acc,#1e6fd9)';
    var s = '<svg class="ana-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opt.title || '') + '">';
    for (var k = 0; k <= 3; k++) { var v = lo + (hi - lo) * k / 3, y = Y(v); s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 4) + '" y="' + (y + 3.5) + '" text-anchor="end" class="ax">' + v.toFixed(opt.dp == null ? 1 : opt.dp) + '</text>'; }
    if (n >= 2 && opt.trend) { var tr = C.trend(vals), my = vals.reduce(function (a, b) { return a + b; }, 0) / n, x0 = X(0), x1 = X(n - 1); s += '<line x1="' + x0 + '" x2="' + x1 + '" y1="' + Y(my - tr.slope * (n - 1) / 2) + '" y2="' + Y(my + tr.slope * (n - 1) / 2) + '" class="tl"/>'; }
    s += '<polyline fill="none" stroke="' + col + '" stroke-width="2.5" stroke-linejoin="round" points="' + vals.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ') + '"/>';
    vals.forEach(function (v, i) {
      s += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3.6" fill="#fff" stroke="' + col + '" stroke-width="2"/>';
      if (n <= 12) s += '<text x="' + (n > 1 && i === 0 ? X(i) + 5 : n > 1 && i === n - 1 ? X(i) - 5 : X(i)) + '" y="' + (Y(v) - 7) + '" text-anchor="' + (n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle') + '" class="vl">' + v.toFixed(opt.dp == null ? 1 : opt.dp) + '</text>';
      if (n <= 12 || i % Math.ceil(n / 8) === 0) s += '<text x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle" class="ax">' + esc(labels[i]) + '</text>';
    });
    return s + '</svg>';
  }
  function histChart(bins) {
    var W = 320, H = 130, L = 8, R = 8, Tp = 14, B = 24, n = bins.length, mx = Math.max(1, Math.max.apply(null, bins.map(function (b) { return b.n; })));
    var bw = (W - L - R) / n, s = wrT('app.x_3', [W, H]);
    bins.slice().reverse().forEach(function (b, i) { // 左低右高
      var h = b.n / mx * (H - Tp - B), x = L + i * bw, y = H - B - h, ten = b.lo >= 10;
      s += '<rect x="' + (x + 1.5) + '" y="' + y + '" width="' + (bw - 3) + '" height="' + Math.max(h, b.n ? 1 : 0) + '" rx="2" class="' + (ten ? 'b10' : 'blo') + '"/>';
      if (b.n) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 3) + '" text-anchor="middle" class="vl">' + b.n + '</text>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle" class="ax hx">' + esc(b.label.replace('10.', '.')) + '</text>';
    });
    return wrT('app.10_x_shown_as_0', [s, W - R]);
  }
  // --- 繪製 ---
  function anaShotSet() { // 目前檢視的彈著與來源（第幾張）
    var sh = selSheet(), out = [];
    if (sh) sh.shots.forEach(function (q, i) { out.push({ q: q, sheet: sheetNo(sh), i: i + 1, color: SHEET_COLORS[(sheetNo(sh) - 1) % SHEET_COLORS.length] }); });
    else acur.sheets.forEach(function (s2, k) { s2.shots.forEach(function (q, i) { out.push({ q: q, sheet: k + 1, i: i + 1, color: SHEET_COLORS[k % SHEET_COLORS.length] }); }); });
    return out;
  }
  function anaExtraHTML(t, st, set, single) {
    var M = App.mods, h = '', card = function (title, body, cls, id) { return '<div class="ana-card ' + (cls || '') + '" data-mod="' + id + '" data-mod-name="' + esc(M.plain(title)) + '"><div class="ana-ct">' + M.plain(title) + '</div>' + body + '</div>'; };
    // v2.5.0 預報對照分析（唯讀檢視）：預報專屬模塊放最前面
    var cmp = App.anaRO && App.anaRO.pairs;
    if (cmp && cmp.length) h += M.callactCard(t, cmp) + M.centersCard(t, cmp) + M.calltrendCard(cmp);
    if (!st.n) return h;
    var shots = set.map(function (x) { return x.q; });
    // 3 校正建議
    var a = st.advice;
    h += card(wrT('app.sight_correction'), wrT('app.group_center_mean_point_of', [a.centered ? wrT('core.centered') : wrT.dir(a.offsetDir) + ' ' + f1(a.dist) + 'mm', esc(a.text), a.excluded ? wrT('app.after_excluding_outliers_the', [a.excluded]) : '', f2(a.threshold)]), 'adv', 'adv');
    // v2.5.0 潛在分數熱圖（數字先出，熱圖之後補上）
    h += M.heatCard(t, shots);
    // 6 穩定度
    h += card(wrT('app.consistency'), wrT('app.std_dev_decimal_integer_avg', [f2(st.sdDec), f2(st.sdRing), f2(st.avgDecExWorst), f2(st.avgExWorst), st.worstIdx >= 0 ? wrT('app.worst', [set[st.worstIdx].sheet && !single ? wrT('app.target', [set[st.worstIdx].sheet]) : '', set[st.worstIdx].i, f1(st.shots[st.worstIdx].dec)]) : '']), '', 'stab');
    // v2.5.0 散布圈、Teiler、每發方向箭頭
    var one = single || acur.sheets.length <= 1; // 只有一張：發號不用加「第幾張-」
    h += M.spreadCard(t, shots) + M.teilerCard(t, shots, set, one) + M.dirCard(t, st, set, one);
    // 7 離群發
    var o = st.outliers;
    var ol = o.idx.map(function (i) { return wrT('app.mm_from_group_center', [single ? '' : wrT('app.target_2', [set[i].sheet]), set[i].i, st.shots[i].ring, f1(st.shots[i].dec), f1(o.radii[i])]); }).join('');
    h += card(wrT('app.outliers'), wrT('app.rule_distance_to_the_group', [o.threshold == null ? wrT('app.fewer_than_shots_not_evaluated', [C.OUTLIER_RULE.minN]) : wrT('app.shots_6', [o.idx.length, ol ? '<ul class="ana-ol">' + ol + '</ul>' : wrT('app.no_clear_outliers')]), o.threshold != null ? ' ' + f1(o.threshold) + 'mm' : '']), 'out', 'out');
    // 5 趨勢
    var tb = '';
    if (!single && acur.sheets.length >= 2) {
      var sv = acur.sheets.filter(function (x) { return x.shots.length; }).map(function (x) { return C.computeStats(t, x.shots).avgDec; });
      var tr = C.trend(sv);
      tb += wrT('app.average_per_target_decimal_trend', [trTag(tr, true, tr.dir === '上升' || tr.dir === '下降' ? ' ' + (tr.change > 0 ? '+' : '') + f2(tr.change) : ''), lineChart(sv, sv.map(function (_, i) { return wrT('app.target', [i + 1]); }), { trend: true, title: wrT('app.average_per_target') })]);
    }
    if (st.per10.length >= 2) {
      var pv = st.per10.map(function (x) { return x.avgDec; });
      tb += wrT('app.average_per_10_shots_decimal', [trTag(st.trend10, true), lineChart(pv, st.per10.map(function (x) { return x.from + '–' + x.to; }), { trend: true, title: wrT('app.average_per_10_shots') })]);
    }
    h += card(wrT('app.trend'), tb || wrT('app.a_trend_needs_2_targets'), 'trend', 'trend');
    // 8 小數分分布
    h += card(wrT('app.decimal_score_distribution'), wrT('app.one_bar_per_0_1', [histChart(st.hist)]), 'hist', 'hist');
    return h;
  }
  function anaInfo(t, sh, st) { // 左上資訊框：第N張 總分(小數) X發／合併 N 張・M 發・平均
    var box = $('anaInfo'), all = C.computeStats(t, anaShots(acur)), n = acur.sheets.length, h;
    box.classList.toggle('empty', !n);
    if (!n) h = wrT('app.analysis_take_the_first_photo');
    else if (sh) {
      var s1 = C.computeStats(t, sh.shots), busy = anaPhotos[sh.id] && anaPhotos[sh.id].busy;
      h = wrT('app.target_shots_combined_targets_shots', [sheetNo(sh), busy ? '…' : s1.total, busy ? '' : '<span class="d">(' + f1(s1.totalDec) + ')</span>', sh.shots.length, n, all.n, all.n ? f2(all.avgDec) : '—']);
    } else h = wrT('app.combined_shots_targets_avg', [all.total, f1(all.totalDec), all.n, n, all.n ? f2(all.avgDec) : '—', all.n > 1 ? wrT('app.group_mm', [f1(all.groupSize)]) : '']);
    box.innerHTML = h;
  }
  function anaChipsHTML(t) {
    var ch = '', n = acur.sheets.length;
    if (n) ch += wrT('app.all_shots', [anaSel === 'all' ? ' on' : '', anaSel === 'all', n, anaShots(acur).length]);
    acur.sheets.forEach(function (x, k) {
      var un = x.shots.filter(isUnsure).length, bad = x.calib && x.calib.mode === 'failed', busy = anaPhotos[x.id] && anaPhotos[x.id].busy, on = anaSel === x.id;
      var s1 = busy ? null : C.computeStats(t, x.shots);
      ch += wrT('app.x_4', [on ? ' on' : '', x.id, on, SHEET_COLORS[k % SHEET_COLORS.length], k + 1, k + 1, busy ? '…' : wrT('app.shots_3', [x.shots.length]), busy ? wrT('app.analyzing') : bad ? wrT('app.calibration_failed') : wrT('app.x', [s1.total, f1(s1.totalDec)]), un ? wrT('app.x_5', [un]) : '', bad ? '<em>!</em>' : '']);
    });
    ch += wrT('app.x_6');
    return ch;
  }
  function renderAnalysis() {
    var t = atgt(), sh = selSheet(), P;
    if (anaSel !== 'all' && !sh) anaSel = 'all';
    P = sh && anaPhotos[sh.id];
    if (anaView === 'photo' && !P) anaView = 'target';
    if (P && !P.busy && !P.T && anaView !== 'photo' && P._autoPhoto !== true) { anaView = 'photo'; P._autoPhoto = true; setTimeout(function () { anaPZLayout(true); }, 0); } // 校正失敗：自動切到照片
    if (document.activeElement !== $('anaName')) $('anaName').value = acur.name || '';
    $('anaWhen').textContent = fmtTW(acur.created);
    if (!acur.sheets.length) $('anaSaved').textContent = storageOK ? wrT('app.saved_automatically_after_the_first') : wrT('app.this_view_cant_save');
    else if (storageOK) $('anaSaved').textContent = wrT('app.saved_automatically');
    // 檢視切換
    $('anaViewSeg').querySelectorAll('button').forEach(function (b) { var on = b.dataset.v === anaView; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (b.dataset.v === 'photo') { b.disabled = !P; b.title = P ? '' : (sh ? wrT('app.this_targets_photo_wasnt_kept_3') : wrT('app.the_combined_view_has_no_2')); } });
    $('anaWrap').classList.toggle('photo-on', anaView === 'photo');
    $('anaPhotoCard').hidden = anaView !== 'photo';
    $('anaBusy').hidden = !(P && P.busy);
    // 靶紙晶片（可橫向捲動）
    var chips = $('anaChips'), sl = chips.scrollLeft;
    chips.innerHTML = anaChipsHTML(t); chips.scrollLeft = sl;
    chips.querySelectorAll('.ana-chip').forEach(function (b) { b.onclick = function () { if (b.dataset.id === 'add') { $('anaPick').click(); return; } anaSel = b.dataset.id; renderAnalysis(); var on = chips.querySelector('.ana-chip.on'); if (on && on.scrollIntoView) try { on.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }; });
    // 照片
    if (P) {
      var img = $('anaImg'); if (img.dataset.sid !== sh.id) { img.src = P.url; img.dataset.sid = sh.id; }
      $('anaPhotoSvg').setAttribute('viewBox', '0 0 ' + P.w + ' ' + P.h);
      $('anaCalRingRow').style.display = P.mode === 'manual' ? '' : 'none';
      anaPhotoDraw(); anaHint(sh, P);
      if (anaView === 'photo') anaPZLayout(false);
    } else $('anaCalRingRow').style.display = 'none';
    $('anaHint').hidden = !(P && anaView === 'photo');
    // 向量靶面（雙指縮放的檢視）
    drawTarget(anaSvg, t, 1); AV.ensure(); AV.clamp(); AV.apply();
    var set = anaShotSet(), shots = set.map(function (x) { return x.q; });
    var st = C.analyzeShots(t, shots), E = +anaSvg.dataset.extent, g = anaSvg.querySelector('#marks'), lines = anaSvg.querySelector('#lines');
    var showOut = $('anaShowOut').checked, outSet = {}; st.outliers.idx.forEach(function (i) { outSet[i] = 1; });
    if (showOut && st.outliers.threshold != null && st.outliers.idx.length) el('circle', { cx: st.outliers.center.x, cy: -st.outliers.center.y, r: st.outliers.threshold, fill: 'none', stroke: '#ff1744', 'stroke-width': Math.max(0.1, E * 0.003), 'stroke-dasharray': (E * 0.012) + ' ' + (E * 0.008), opacity: 0.8 }, lines);
    var fs = labelSize(anaSvg);
    set.forEach(function (x, i) {
      var q = x.q, un = isUnsure(q), gg = el('g', { 'class': 'ana-shot' }, g);
      el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2, fill: x.color, 'fill-opacity': 0.55, stroke: un ? '#ffb300' : x.color, 'stroke-width': Math.max(0.12, E * (un ? 0.006 : 0.003)), 'stroke-dasharray': un ? (E * 0.01) + ' ' + (E * 0.006) : '' }, gg);
      if (showOut && outSet[i]) el('circle', { cx: q.x, cy: -q.y, r: t.pellet / 2 + E * 0.012, fill: 'none', stroke: '#ff1744', 'stroke-width': Math.max(0.15, E * 0.005), 'stroke-dasharray': (E * 0.008) + ' ' + (E * 0.005), 'class': 'ana-out' }, gg);
      var tx = el('text', { x: q.x, y: -q.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', stroke: '#0b1a2e', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx.textContent = sh ? x.i : x.sheet;
    });
    if ($('anaShowCenter').checked && st.n && st.advice) {
      var a = st.advice, cs = Math.max(1.2, E * 0.03), sw = Math.max(0.15, E * 0.005);
      el('line', { x1: 0, y1: 0, x2: a.dx, y2: -a.dy, stroke: '#00c853', 'stroke-width': sw, 'stroke-dasharray': (E * 0.01) + ' ' + (E * 0.006) }, lines);
      el('line', { x1: a.dx - cs, y1: -a.dy, x2: a.dx + cs, y2: -a.dy, stroke: '#00c853', 'stroke-width': sw * 1.6 }, lines);
      el('line', { x1: a.dx, y1: -a.dy - cs, x2: a.dx, y2: -a.dy + cs, stroke: '#00c853', 'stroke-width': sw * 1.6 }, lines);
    }
    if ($('anaShowSpread').checked && st.n >= 2) { // v2.5.0 散布圈：平均半徑圈（虛線，綠）＋最小外接圓（紫）
      var sp = C.spread(shots), sw2 = Math.max(0.15, E * 0.005);
      el('circle', { cx: sp.mpi.x, cy: -sp.mpi.y, r: sp.meanRadius, fill: 'none', stroke: '#2fd36b', 'stroke-width': sw2, 'stroke-dasharray': (E * 0.012) + ' ' + (E * 0.007), 'class': 'ana-spr' }, lines);
      el('circle', { cx: sp.mec.x, cy: -sp.mec.y, r: sp.mec.r, fill: 'none', stroke: '#ae3ec9', 'stroke-width': sw2, 'class': 'ana-spr' }, lines);
    }
    anaInfo(t, sh, st); anaFitLabel();
    $('anaUndo').disabled = !(sh && sh._undo); $('anaClearBtn').disabled = !acur.sheets.length && !anaInRecords() && !acur.name; $('anaCalBtn').disabled = !acur.sheets.length;
    if (anaPopOpen) anaPopSync();
    anaSensSync();
    $('anaReadout').classList.toggle('sr', !!acur.sheets.length);
    $('anaReadout').innerHTML = !acur.sheets.length ? wrT('app.tap_next_photo_below_to') :
      sh ? wrT('app.target_shots_tap_the_target', [sheetNo(sh), sh.shots.length]) :
      wrT('app.combined_targets_shots_color_number', [acur.sheets.length, st.n]);
    $('anaStatsTitle').textContent = sh ? wrT('app.target_stats', [sheetNo(sh)]) : (acur.sheets.length > 1 ? wrT('app.combined_stats_targets', [acur.sheets.length]) : wrT('app.stats'));
    renderStats($('anaStats'), t, st);
    $('anaExtra').innerHTML = anaExtraHTML(t, st, set, !!sh);
    // 每張小計
    var tb = '';
    if (acur.sheets.length) {
      tb = wrT('app.target_shots_total_decimal_avg');
      acur.sheets.forEach(function (x, k) {
        var s2 = C.computeStats(t, x.shots), un = x.shots.filter(isUnsure).length;
        tb += '<tr data-id="' + x.id + '"' + (anaSel === x.id ? ' class="on"' : '') + '><td><i class="dot" style="background:' + SHEET_COLORS[k % SHEET_COLORS.length] + '"></i>' + (k + 1) + '</td><td>' + s2.n + '</td><td>' + s2.total + '</td><td>' + f1(s2.totalDec) + '</td><td>' + (s2.n ? f2(s2.avgDec) : '—') + '</td><td>' + (s2.n > 1 ? f1(s2.groupSize) + 'mm' : '—') + '</td><td>' + (un ? '<b style="color:#b26a00">' + un + '</b>' : (x.calib && x.calib.mode === 'failed' ? wrT('app.calibration_failed') : '0')) + '</td></tr>';
      });
      var all = C.computeStats(t, anaShots(acur));
      tb += wrT('app.total_2', [all.n, all.total, f1(all.totalDec), all.n ? f2(all.avgDec) : '—', all.n > 1 ? f1(all.groupSize) + 'mm' : '—']);
    }
    $('anaSheetTable').innerHTML = tb;
    $('anaSheetTable').querySelectorAll('tr[data-id]').forEach(function (r) { r.onclick = function () { anaSel = r.dataset.id; renderAnalysis(); }; });
    $('anaList').innerHTML = shotTable(st.shots);
    App.updateAnaCodeInfo();
    anaShareSync(); App.mods.after($('anaMods')); // v2.5.0：每個模塊左上角的圖示＋熱圖
  }
  fillAnaCalRing();
})(window.WRApp = window.WRApp || {});
