/* WRbeta 預報·對照：預報分頁、對照照片校正、對照向量靶面
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, $ = App.$, f1 = App.f1, f2 = App.f2, prefs = App.prefs, savePrefs = App.savePrefs, newSession = App.newSession,
    persist = App.persist, tgt = App.tgt, el = App.el, drawTarget = App.drawTarget, drawShot = App.drawShot, previewMark = App.previewMark,
    stat = App.stat, offsetText = App.offsetText, renderStats = App.renderStats, shotTable = App.shotTable, attachZoom = App.attachZoom, ask = App.ask,
    toast = App.toast, showTab = App.showTab;
  // 給其他模組用（函式）
  App.mkView = mkView; App.renderPredict = renderPredict; App.startNew = startNew; App.renderCompare = renderCompare; App.fillCalRing = fillCalRing;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'PV', { get: function () { return PV; }, set: function (v) { PV = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'photo', { get: function () { return photo; }, set: function (v) { photo = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'CV', { get: function () { return CV; }, set: function (v) { CV = v; }, enumerable: true, configurable: true });

  // ---------- 預報分頁（v1.5.0：與對照合併成「預報·對照」；只用雙指縮放；左上資訊框；右下玻璃圓鈕） ----------
  var predSvg = $('predSvg'), predView = null, predTid = null, predPrev = null;
  // 靶面檢視 {cx,cy,E}（SVG 座標，y 向下）；Pro 預報與對照靶面共用這套（各自一份）
  function cardBounds() { var c = tgt().cardSize; return { x0: -c / 2, y0: -c / 2, w: c, h: c }; }
  function inCard(p) { var half = tgt().cardSize / 2 + 1; return Math.abs(p.x) <= half && Math.abs(p.y) <= half; }
  function mkView(svg, fitBtn, getT, getTid) { // v1.6.0：分析頁也共用（getT／getTid 預設＝預報的 cur）
    var V = { v: null, tid: null };
    var gT = getT || tgt; getTid = getTid || function () { return App.cur.targetId; };
    V.reset = function () { var c = gT().cardSize; V.v = { cx: 0, cy: 0, E: c }; V.tid = getTid(); };
    V.ensure = function () { if (!V.v || V.tid !== getTid()) V.reset(); };
    V.clamp = function () { var c = gT().cardSize; App.zClamp(V.v, { x0: -c / 2, y0: -c / 2, w: c, h: c }, 10); };
    V.apply = function () {
      V.ensure(); var v = V.v; svg.setAttribute('viewBox', (v.cx - v.E / 2) + ' ' + (v.cy - v.E / 2) + ' ' + v.E + ' ' + v.E); svg.dataset.extent = v.E;
      var z = gT().cardSize / v.E, zoomed = z > 1.05, sp = fitBtn.querySelector('span');
      fitBtn.classList.toggle('zoomed', zoomed); sp.textContent = zoomed ? wrT('app.full_target', [Math.round(z * 10) / 10]) : wrT('app.pinch_to_zoom');
    };
    V.zoom = function (z) { var c = gT().cardSize; V.v = { cx: 0, cy: 0, E: c / Math.max(1, z) }; V.tid = getTid(); V.clamp(); };
    return V;
  }
  var PV = mkView(predSvg, $('predFit'));
  function predInfo(p, pending) {
    var box = $('predInfo'), n = App.cur.preds.length;
    var q = p ? C.scoreShot(tgt(), p.x, p.y) : null, num = pending ? n + 1 : n;
    box.classList.toggle('live', !!pending); box.classList.toggle('empty', !q);
    box.innerHTML = q ? wrT('app.shot', [num, q.ring, f1(q.dec), q.inner ? wrT('app.inner_10') : ''])
      : wrT('app.shot_1_tap_the_target');
  }
  function renderPredict() {
    var t = tgt();
    drawTarget(predSvg, t, 1); PV.ensure(); PV.clamp(); PV.apply();
    var g = predSvg.querySelector('#marks');
    App.cur.preds.forEach(function (p, i) { drawShot(g, predSvg, p, i + 1, 'pred-c', t.pellet); });
    if (predPrev) previewMark(predSvg, predPrev, 'pred-c', t);
    var st = C.computeStats(t, App.cur.preds);
    renderStats($('predStats'), t, st);
    $('predList').innerHTML = shotTable(st.shots);
    if (predPrev) predInfo(predPrev, true); else predInfo(App.cur.preds[App.cur.preds.length - 1], false);
    $('undoPred').disabled = !App.cur.preds.length; $('clearPred').disabled = !App.cur.preds.length;
    App.renderLite();
  }
  attachZoom(predSvg, {
    active: function () { return true; },
    view: function () { PV.ensure(); return PV.v; }, clamp: PV.clamp, apply: PV.apply, render: function () { renderPredict(); },
    lift: function () { return App.liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) { predPrev = { x: r.x, y: -r.y }; previewMark(predSvg, predPrev, 'pred-c', tgt()); predInfo(predPrev, true); },
    up: function (r) {
      var p = { x: r.x, y: -r.y }; predPrev = null;
      if (!inCard(p)) { renderPredict(); return; }
      var q = { x: C.round(p.x, 3), y: C.round(p.y, 3), t: Date.now() }; if (App.cur.round > 0) q.r = App.cur.round; // Lite 多輪：標記目前這一輪
      App.cur.preds.push(q); persist(); renderPredict(); renderCompare(); App.vib();
    },
    cancel: function () { predPrev = null; renderPredict(); }
  });
  $('predFit').onclick = function () { PV.reset(); renderPredict(); };
  $('undoPred').onclick = function () { if (App.cur.preds.length) { App.cur.preds.pop(); persist(); renderPredict(); renderCompare(); } };
  $('clearPred').onclick = function () { if (App.cur.preds.length) ask(wrT('app.clear_all_calls_in_this', [App.cur.preds.length]), function () { App.cur.preds = []; persist(); App.renderAll(); }); };
  function startNew() { App.cur = newSession(App.cur.targetId); App.sessions.unshift(App.cur); persist(); photo.reset(); App.renderAll(); toast(wrT('app.new_set_started')); showTab('predict'); }
  $('newSession').onclick = startNew; $('newSession2').onclick = startNew;
  // 「落點上移」從預報頁移到「說明 › 介面設定」（同一個設定，Pro／Lite 共用）
  $('liftCursor').checked = !!prefs.lift; $('liftCursor').onchange = function () { prefs.lift = this.checked; savePrefs(); };

  // ---------- 對照分頁：照片校正 ----------
  var photo = (function () {
    var V = window.BMVision;
    var img = $('photoImg'), svg = $('photoSvg'), inner = $('photoInner');
    var state = { rotDeg: 0, loaded: false, w: 0, h: 0, zoom: 1, calPts: [], T: null, Tinv: null, mode: 'auto', g: null, gw: 0, gh: 0, k: 1, info: null, det: null, busy: false };
    var stepNames = [wrT('app.the_center_center_point'), wrT('app.top'), wrT('app.right'), wrT('app.bottom'), wrT('app.left')];
    function clearCal() { state.rotDeg = 0; state.calPts = []; state.T = null; state.Tinv = null; state.info = null; state.det = null; }
    function reset() { clearCal(); state.mode = 'auto'; img.removeAttribute('src'); state.loaded = false; state.g = null; state.full = null; state._cal = null; state.zoomed = false; draw(); hint(); }
    function ringN() { return +$('calRing').value; }
    function sens() { return +($('sensSel') ? $('sensSel').value : 1); }
    function hint() {
      var h = $('calHint');
      if (state.busy) { h.innerHTML = wrT('app.analyzing_photo'); return; }
      if (!state.loaded) { h.innerHTML = wrT('app.after_you_take_or_pick'); return; }
      if (state.mode === 'manual' && state.calPts.length < 5) {
        var i = state.calPts.length;
        h.innerHTML = wrT('app.manual_calibration_5_tap_zoom', [i + 1, i === 0 ? stepNames[0] : wrT('app.the_of_ring_s_outer', [ringN(), stepNames[i]])]);
        return;
      }
      if (!state.T) { h.innerHTML = wrT('app.auto_calibration_failed_tap_manual_2', [state.info && state.info.reason || wrT('app.unknown_reason')]); return; }
      var n = App.cur.actuals.length, p = App.cur.preds.length;
      var calTxt = state.mode === 'auto' ? wrT('app.auto_calibration_done_black_fit', [f2(state.info.rmsMm)]) : wrT('app.manual_calibration_done_error_about', [f2(state.T.rms)]);
      var warn = p && n !== p ? wrT('app.shot_holes_detected_calls_the', [n, p]) : '';
      h.innerHTML = wrT('app.the_green_circles_should_line', [calTxt, state.rotDeg ? wrT('app.now', [state.rotDeg]) : '', n, p ? wrT('app.calls_2', [p]) : '', warn]);
    }
    function analyze() {
      if (!state.loaded) return;
      state.busy = true; hint();
      setTimeout(function () {
        try {
          state.img = img; // v1.7.1：共用流程（visRun）——放大裁切、靶種檢查
          var r = App.visRun(state, App.cur.targetId, sens(), false), det = r.det;
          if (r.mismatch) toast(wrT('app.this_looks_like_a_target_2', [T[r.mismatch].name, tgt().name]));
          if (state.T) {
            state.det = det;
            App.cur.actuals = (det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; });
            App.cur.calib = { mode: state.mode, rms: state.T.rms, at: Date.now() }; persist();
            if (App.cur.preds.length) $('pairMode').value = 'optimal';
          }
        } catch (e) { state.T = null; state.info = { reason: wrT('app.analysis_error', [e.message]) }; }
        state.busy = false; renderCompare();
      }, 30);
    }
    function load(file) {
      if (!file) return;
      if (!App.pickIsImage(file)) { App.pickError(file); return; }
      if (state._url) try { URL.revokeObjectURL(state._url); } catch (e) {}
      var url = URL.createObjectURL(file); state._url = url;
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} if (state._url === url) state._url = null; App.pickError(file); };
      img.onload = function () { state.loaded = true; state.w = img.naturalWidth; state.h = img.naturalHeight; clearCal(); state.g = null; state.full = null; state._cal = null; state.zoomed = false; state.mode = 'auto';
        svg.setAttribute('viewBox', '0 0 ' + state.w + ' ' + state.h); setZoom(1); analyze(); };
      img.src = url;
    }
    function setZoom(z) { state.zoom = z; inner.style.width = (100 * z) + '%'; document.querySelectorAll('.pzoom').forEach(function (b) { b.classList.toggle('on', +b.dataset.z === z); }); }
    function draw() {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (!state.loaded) return;
      var u = Math.max(state.w, state.h) / 300;
      state.calPts.forEach(function (q) {
        el('circle', { cx: q.px, cy: q.py, r: u * 1.6, fill: 'none', stroke: '#00e5ff', 'stroke-width': u * 0.5 }, svg);
        el('circle', { cx: q.px, cy: q.py, r: u * 0.4, fill: '#00e5ff' }, svg);
      });
      if (state.Tinv) {
        var Ti = state.Tinv, t = tgt();
        var g = svg;
        for (var n = 1; n <= 10; n++) el('path', { d: App.projCircle(Ti, t.ringDiam[n] / 2), fill: 'none', stroke: '#39ff14', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', opacity: 0.75 }, g);
        el('path', { d: App.projCircle(Ti, t.blackDiam / 2), fill: 'none', stroke: '#00e5ff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, g);
        var RR = t.ringDiam[1] / 2 + 2; // 上下方向線：應穿過照片上印在正上、正下方的環數數字
        el('path', { d: App.projLine(Ti, 0, -RR, 0, RR), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
        el('path', { d: App.projLine(Ti, -RR, 0, RR, 0), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
        var lab = actLabels();
        App.cur.actuals.forEach(function (a, i) {
          var low = a.conf != null && a.conf < 0.5;
          el('path', { d: App.projCircle(Ti, t.pellet / 2, a.x, a.y, 24), fill: 'rgba(255,40,40,.25)', stroke: low ? '#ffb300' : '#ff2828', 'stroke-width': 2.5, 'stroke-dasharray': low ? '4 3' : '', 'vector-effect': 'non-scaling-stroke' }, g);
          var pp = C.applyAffine(Ti, a.x, a.y);
          var tx = el('text', { x: pp.x + u * 2.4, y: pp.y - u * 2.4, 'font-size': u * 4, fill: '#ffeb3b', stroke: '#000', 'stroke-width': u * 0.6, 'paint-order': 'stroke', 'font-weight': 'bold' }, svg);
          tx.textContent = lab[i];
        });
      }
    }
    img.addEventListener('click', function (ev) {
      if (!state.loaded || state.busy) return;
      var r = img.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * state.w, py = (ev.clientY - r.top) / r.height * state.h;
      if (state.mode === 'manual' && state.calPts.length < 5) {
        var tt = C.calibTargets(tgt(), ringN())[state.calPts.length];
        state.calPts.push({ px: px, py: py, x: tt.x, y: tt.y });
        if (state.calPts.length === 5) {
          state.T = C.fitAffine(state.calPts);
          if (!state.T) { toast(wrT('app.calibration_failed_please_tap_again')); state.calPts = []; } else { analyze(); return; }
        }
        draw(); hint(); return;
      }
      if (!state.T) return;
      var m = C.applyAffine(state.T, px, py), t = tgt();
      // 點到既有彈孔 → 刪除；否則新增
      var bi = -1, bd = Infinity;
      App.cur.actuals.forEach(function (a, i) { var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd <= t.pellet / 2 * 1.1) { App.cur.actuals.splice(bi, 1); toast(wrT('app.shot_hole_deleted')); }
      else { App.cur.actuals.push({ x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual' }); toast(wrT('app.shot_hole_added')); }
      persist(); renderCompare();
    });
    $('photoCam').onchange = function () { load(this.files[0]); this.value = ''; };
    $('photoPick').onchange = function () { load(this.files[0]); this.value = ''; };
    $('photoFile').onchange = function () { load(this.files[0]); this.value = ''; };
    document.querySelectorAll('.pzoom').forEach(function (b) { b.onclick = function () { setZoom(+b.dataset.z); }; });
    $('recal').onclick = function () { if (!state.loaded) return; clearCal(); state.mode = 'manual'; $('calRingRow').style.display = ''; draw(); hint(); };
    $('autoCal').onclick = function () { if (!state.loaded) return; clearCal(); state.mode = 'auto'; analyze(); };
    function rotate(deg) {
      if (!state.T) return;
      var th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      var rms = state.T.rms; state.T = window.BMVision.rotateAffine(state.T, th); state.T.rms = rms; state.Tinv = C.invertAffine(state.T); state.rotDeg += deg;
      App.cur.actuals = App.cur.actuals.map(function (p) { return Object.assign({}, p, { x: C.round(c * p.x - s * p.y, 3), y: C.round(s * p.x + c * p.y, 3) }); });
      persist(); renderCompare();
    }
    $('rotL').onclick = function () { rotate(-1); }; $('rotR').onclick = function () { rotate(1); };
    $('redetect').onclick = function () { if (state.T) analyze(); };
    $('sensSel').onchange = function () { if (state.T) analyze(); };
    $('calRing').onchange = function () { if (state.mode === 'manual') { state.calPts = []; state.T = null; state.Tinv = null; draw(); hint(); } };
    return { reset: reset, draw: draw, hint: hint, state: state, analyze: analyze, rotate: rotate };
  })();

  // ---------- 對照分頁：向量靶面 ----------
  var cmpSvg = $('cmpSvg'), cmpZoom = 1;
  function pairMode() { var e = $('pairMode'); return e ? e.value : 'order'; }
  function actLabels() { // 實際彈孔標籤：依順序＝第幾發；最近配對＝配到的預報編號
    if (pairMode() !== 'optimal') return App.cur.actuals.map(function (a, i) { return i + 1; });
    var lab = App.cur.actuals.map(function () { return '?'; });
    C.matchOptimal(App.cur.preds, App.cur.actuals).forEach(function (q) { lab[q[1]] = q[0] + 1; });
    return lab;
  }
  function srcMode() { return document.querySelector('input[name=src]:checked').value; }
  function renderCompare() {
    var t = tgt();
    drawTarget(cmpSvg, t, 1); CV.ensure(); CV.clamp(); CV.apply();
    var lines = cmpSvg.querySelector('#lines'), g = cmpSvg.querySelector('#marks');
    var sp = $('showPred').checked, sa = $('showAct').checked;
    var E = +cmpSvg.dataset.extent;
    var cmp = C.comparePredictions(t, App.cur.preds, App.cur.actuals, pairMode());
    if (sp && sa) cmp.pairs.forEach(function (q) {
      var p = App.cur.preds[q.i - 1], a = App.cur.actuals[q.actIdx];
      el('line', { x1: a.x, y1: -a.y, x2: p.x, y2: -p.y, stroke: '#f5a623', 'stroke-width': Math.max(0.1, E * 0.004) }, lines);
    });
    var lab = actLabels();
    if (sp) App.cur.preds.forEach(function (p, i) { drawShot(g, cmpSvg, p, i + 1, 'pred-c', t.pellet); });
    if (sa) App.cur.actuals.forEach(function (p, i) { drawShot(g, cmpSvg, p, lab[i], 'act-c', t.pellet); });
    var h = '';
    if (!cmp.m) h = wrT('app.comparison_needs_both_calls_and', [App.cur.preds.length, App.cur.actuals.length]);
    else {
      h += stat(wrT('app.matched'), wrT('app.shots_4', [cmp.m]), (pairMode() === 'optimal' ? wrT('app.nearest_match') : wrT('app.in_order')) + (cmp.unpairedPred ? wrT('app.extra_calls_unmatched', [cmp.unpairedPred]) : '') + (cmp.unpairedAct ? wrT('app.extra_actual_shots_unmatched', [cmp.unpairedAct]) : ''), false, 'pairs');
      h += stat(wrT('app.avg_call_error'), f2(cmp.meanErr) + 'mm', wrT('app.max_shot_mm_2', [cmp.maxErrShot, f2(cmp.maxErr)]), false, 'err');
      h += stat(wrT('app.systematic_call_bias'), cmp.biasDir === '置中' ? wrT('app.no_clear_bias_2') : wrT('app.calls_3', [wrT.dir(cmp.biasDir)]), wrT('app.your_calls_relative_to_actual', [offsetText(cmp.biasX, cmp.biasY)]), false, 'bias');
      h += stat(wrT('app.ring_called_correctly_2'), Math.round(cmp.sameRingRate * 100) + '%', wrT('app.avg_decimal_difference', [f2(cmp.meanAbsDecDiff)]), false, 'ringRate');
    }
    if (cmp.m) h += '<button type="button" class="wr-pill ana-cmpana" id="cmpAnaBtn">' + wrT('h.compare_analysis_btn') + '</button>';
    $('cmpSummary').innerHTML = h;
    if ($('cmpAnaBtn')) $('cmpAnaBtn').onclick = function () { App.anaOpenCmp(App.cur); }; // v2.5.0 預報對照分析（唯讀，完整模塊）
    var st = C.computeStats(t, App.cur.actuals);
    renderStats($('actStats'), t, st);
    var tb = '';
    if (cmp.m) {
      tb = wrT('app.call_call_actual_diff_call');
      cmp.pairs.forEach(function (q) { tb += wrT('app.mm', [q.i, q.pred.ring, f1(q.pred.dec), q.act.ring, f1(q.act.dec), f2(q.err), wrT.dir(C.directionText(q.dx, q.dy, C.ringWidth(t) * 0.2))]); });
      tb += '</table>';
    }
    $('cmpList').innerHTML = tb + (st.n ? wrT('app.actual_shot_details', [shotTable(st.shots)]) : '');
    $('photoPane').style.display = srcMode() === 'photo' ? '' : 'none';
    $('cmpReadout').innerHTML = (srcMode() === 'vector' ? wrT('app.tap_the_actual_shots_red') : wrT('app.blue_call_red_actual_orange')) +
      (pairMode() === 'optimal' ? wrT('app.matching_a_photo_cant_show') : wrT('app.matching_by_shot_order_shot'));
    photo.draw(); photo.hint();
  }
  var CV = mkView(cmpSvg, $('cmpFit')), cmpPrev = null;
  attachZoom(cmpSvg, {
    active: function () { return true; },
    view: function () { CV.ensure(); return CV.v; }, clamp: CV.clamp, apply: CV.apply, render: function () { renderCompare(); },
    lift: function () { return App.liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) {
      if (srcMode() !== 'vector') return;
      cmpPrev = { x: r.x, y: -r.y }; previewMark(cmpSvg, cmpPrev, 'act-c', tgt());
      var s = C.scoreShot(tgt(), cmpPrev.x, cmpPrev.y); $('cmpReadout').innerHTML = wrT('app.shot_actual', [App.cur.actuals.length + 1, s.ring, f1(s.dec)]);
    },
    up: function (r) {
      cmpPrev = null; if (srcMode() !== 'vector') return;
      var p = { x: r.x, y: -r.y }; if (!inCard(p)) { renderCompare(); return; }
      App.cur.actuals.push({ x: C.round(p.x, 3), y: C.round(p.y, 3), src: 'vector' }); persist(); renderCompare();
    },
    cancel: function () { if (cmpPrev) { cmpPrev = null; renderCompare(); } }
  });
  $('cmpFit').onclick = function () { CV.reset(); renderCompare(); };
  document.querySelectorAll('input[name=src]').forEach(function (r) { r.onchange = renderCompare; });
  $('pairMode').onchange = function () { App.cur.pairMode = this.value; persist(); renderCompare(); };
  $('showPred').onchange = renderCompare; $('showAct').onchange = renderCompare;
  $('undoAct').onclick = function () { if (App.cur.actuals.length) { App.cur.actuals.pop(); persist(); renderCompare(); } };
  $('clearAct').onclick = function () { if (App.cur.actuals.length) ask(wrT('app.clear_all_actual_shots', [App.cur.actuals.length]), function () { App.cur.actuals = []; persist(); renderCompare(); }); };
  function fillCalRing() {
    var t = tgt(), sel = $('calRing'); sel.innerHTML = '';
    for (var n = 1; n <= 9; n++) { var o = document.createElement('option'); o.value = n; o.textContent = wrT('app.ring_outer_diameter_mm', [n, t.ringDiam[n], t.ringDiam[n] === t.blackDiam ? wrT('app.black_edge') : '']); sel.appendChild(o); }
    sel.value = t.blackFromRing;
  }
})(window.WRApp = window.WRApp || {});
