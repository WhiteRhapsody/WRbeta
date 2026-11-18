(function () {
  'use strict';
  // App 名稱與版本：只改這裡（標題列、說明分頁、匯出檔都讀這兩個常數）
  var APP_NAME = 'WRbeta', APP_VERSION = 'v2.0.1', APP_LABEL = 'beta v2.0.1'; // v2.0.0：畫面上顯示「beta v2.0」；v2.0.1（新圖示）顯示「beta v2.0.1」
  var C = window.BMCore, T = C.TARGETS, NS = 'http://www.w3.org/2000/svg';
  try { var _v = document.getElementById('appVer'); if (_v) _v.textContent = APP_LABEL; var _a = document.getElementById('aboutVer'); if (_a) _a.textContent = APP_LABEL + '（' + APP_VERSION + '）'; document.title = APP_NAME; } catch (e) {}
  var LS_SESS = 'bm_sessions_v1', LS_CUR = 'bm_current_v1', LS_PREF = 'bm_prefs_v1';
  var $ = function (id) { return document.getElementById(id); };
  var f1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
  var f2 = function (v) { return (Math.round(v * 100) / 100).toFixed(2); };

  // ---------- 資料 ----------
  // 安全儲存：預覽畫面／沙盒 iframe 可能禁止 localStorage，失敗時改用記憶體
  var memStore = {}, storageOK = (function () {
    try { var k = '__bm_t'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  })();
  var store = {
    get: function (k) { if (storageOK) { try { return window.localStorage.getItem(k); } catch (e) {} } return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
    set: function (k, v) { memStore[k] = String(v); if (storageOK) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } } return false; }
  };
  function loadSessions() { try { return JSON.parse(store.get(LS_SESS)) || []; } catch (e) { return []; } }
  function saveSessions(list) { var ok = store.set(LS_SESS, JSON.stringify(list)); if (!ok && storageOK) toast('儲存失敗（空間不足？）'); cloudDirty(); }
  // 雲端同步（備註4）：本機 localStorage 永遠是主要資料；登入後才在背景上傳／下載（見 cloud.js）
  function cloudDirty() { try { if (window.WRCloud && window.WRCloud.markDirty) window.WRCloud.markDirty(); } catch (e) {} }
  var prefs = (function () { try { return JSON.parse(store.get(LS_PREF)) || {}; } catch (e) { return {}; } })();
  // v1.8.0：第一次打開（還沒有任何設定）＝新使用者 → 預設主題「簡約亮色」；舊使用者照樣用上次的主題（prefs.liteTheme）
  var FRESH = !prefs || !Object.keys(prefs).length;
  function savePrefs() { store.set(LS_PREF, JSON.stringify(prefs)); }
  /* 資料格式（v2）：sessions 陣列同時放兩種紀錄
   *   預報：{ v:2, kind:'forecast', id:'s…', created ISO(UTC), name, note, targetId, preds:[{x,y,t}], actuals:[{x,y,src,conf}], calib }
   *   分析：{ v:2, kind:'analysis', id:'a…', created, tz:'Asia/Taipei', name, note, targetId,
   *           sheets:[{ id, created, shots:[{x,y,src:'auto'|'manual',conf}], calib:{mode,rms,rotDeg,at}, photo:{w,h,name} }] }
   *   座標一律 mm、靶心為原點、x 右 y 上。舊資料沒有 kind/v 視為預報。日後上傳功能直接用這個格式。 */
  var SCHEMA_V = 2;
  function isAna(s) { return s && s.kind === 'analysis'; }
  function newSession(targetId) {
    var now = new Date();
    return { v: SCHEMA_V, kind: 'forecast', id: 's' + now.getTime(), created: now.toISOString(), name: '', targetId: targetId || prefs.targetId || 'ap10', note: '', preds: [], actuals: [], calib: null };
  }
  function newAnalysis(targetId) {
    var now = new Date();
    return { v: SCHEMA_V, kind: 'analysis', id: 'a' + now.getTime() + Math.floor(Math.random() * 1000), created: now.toISOString(), tz: 'Asia/Taipei', name: '', note: '', targetId: targetId || prefs.targetId || 'ap10', sheets: [] };
  }
  function fmtTW(iso) {
    try { return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return new Date(iso).toLocaleString(); }
  }
  function anaShots(s) { var o = []; (s.sheets || []).forEach(function (sh) { o = o.concat(sh.shots); }); return o; }
  var sessions = loadSessions();
  var cur = null;
  (function initCur() {
    var id = store.get(LS_CUR);
    cur = sessions.filter(function (s) { return s.id === id && !isAna(s) && s.mode !== 'ghost'; })[0];
    if (!cur) { cur = newSession(); sessions.unshift(cur); }
  })();
  function persist(noTouch) {
    var i = sessions.findIndex(function (s) { return s.id === cur.id; });
    if (i < 0) sessions.unshift(cur); else sessions[i] = cur;
    if (!noTouch) cur.updated = new Date().toISOString();
    saveSessions(sessions); store.set(LS_CUR, cur.id);
  }
  function tgt() { return T[cur.targetId]; }

  // ---------- 靶面繪製 ----------
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function drawTarget(svg, t, zoom) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var E = t.cardSize / zoom;
    svg.setAttribute('viewBox', (-E / 2) + ' ' + (-E / 2) + ' ' + E + ' ' + E);
    svg.dataset.extent = E;
    var g = el('g', { id: 'tg' }, svg);
    el('rect', { x: -t.cardSize / 2, y: -t.cardSize / 2, width: t.cardSize, height: t.cardSize, fill: '#f4f1e8', 'class': 'tg-paper' }, g);
    el('circle', { cx: 0, cy: 0, r: t.blackDiam / 2, fill: '#141414', 'class': 'tg-black' }, g);
    var lw = t.ringLine;
    for (var n = 1; n <= 10; n++) {
      var d = t.ringDiam[n];
      var inBlack = d <= t.blackDiam + 1e-9;
      if (n === 10 && t.tenIsDot) { el('circle', { cx: 0, cy: 0, r: d / 2, fill: '#fff', 'class': 'tg-ten' }, g); continue; }
      if (Math.abs(d - t.blackDiam) < 1e-9) continue; // 黑區外緣即該環線
      el('circle', { cx: 0, cy: 0, r: d / 2, fill: 'none', stroke: inBlack ? '#fff' : '#141414', 'stroke-width': lw, 'class': 'tg-ring ' + (inBlack ? 'tg-ring-in' : 'tg-ring-out'), 'data-b': n >= 10 ? 't' : n === 9 ? 'h' : inBlack ? 'i' : 'o' }, g);
    }
    if (t.innerTen.mode === 'ring') el('circle', { cx: 0, cy: 0, r: t.innerTen.diam / 2, fill: 'none', stroke: '#fff', 'stroke-width': lw, 'class': 'tg-ring tg-ring-in tg-x', 'data-b': 't' }, g);
    // 環數數字（印在每一環計分區中間，上下左右）
    var fs = t.id === 'ap10' ? 2.0 : 1.5;
    t.printedNumbers.forEach(function (n) {
      var rm = (t.ringDiam[n] + t.ringDiam[n + 1]) / 4;
      var inBlack = t.ringDiam[n] <= t.blackDiam + 1e-9;
      [[0, -rm], [0, rm], [-rm, 0], [rm, 0]].forEach(function (p) {
        var tx = el('text', { x: p[0], y: p[1], 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: inBlack ? '#fff' : '#141414', 'font-family': 'Arial,sans-serif', 'class': 'tg-num ' + (inBlack ? 'tg-num-in' : 'tg-num-out') }, g);
        tx.textContent = n;
      });
    });
    el('g', { id: 'lines' }, svg);
    el('g', { id: 'marks' }, svg);
    el('g', { id: 'preview' }, svg);
    if (window.WRFx) try { WRFx.decorate(svg, t); } catch (e) {} // v1.6.0 主題靶面裝飾（只在賽博龐克／電子世界）
  }
  function labelSize(svg) { return Math.max(1.6, (+svg.dataset.extent) * 0.028); }
  function drawShot(g, svg, p, num, cls, pellet) {
    var gg = el('g', {}, g);
    el('circle', { cx: p.x, cy: -p.y, r: pellet / 2, 'class': cls, 'stroke-width': Math.max(0.12, (+svg.dataset.extent) * 0.003) }, gg);
    var fs = labelSize(svg);
    var tx = el('text', { x: p.x, y: -p.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', stroke: cls === 'pred-c' ? '#0b3d80' : '#7a0d0d', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
    tx.textContent = num;
  }
  function svgPoint(svg, clientX, clientY) {
    var pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    var m = svg.getScreenCTM().inverse(); var q = pt.matrixTransform(m);
    return { x: q.x, y: -q.y };
  }

  // 點擊／拖曳記錄（按下顯示預覽，移動微調，放開記錄）
  function attachTapper(svg, onPreview, onCommit, getLift) {
    var active = null;
    function pos(ev) {
      var lift = getLift && getLift() ? 60 : 0; // 螢幕上移 60px
      return svgPoint(svg, ev.clientX, ev.clientY - lift);
    }
    svg.addEventListener('pointerdown', function (ev) {
      if (!ev.isPrimary) return;
      ev.preventDefault(); active = ev.pointerId; try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      onPreview(pos(ev));
    });
    svg.addEventListener('pointermove', function (ev) { if (ev.pointerId === active) { ev.preventDefault(); onPreview(pos(ev)); } });
    svg.addEventListener('pointerup', function (ev) { if (ev.pointerId === active) { active = null; onPreview(null); onCommit(pos(ev)); } });
    svg.addEventListener('pointercancel', function () { active = null; onPreview(null); });
  }
  function previewMark(svg, p, cls, t) {
    var g = svg.querySelector('#preview'); while (g.firstChild) g.removeChild(g.firstChild);
    if (!p) return;
    var E = +svg.dataset.extent;
    el('line', { x1: p.x - E, y1: -p.y, x2: p.x + E, y2: -p.y, stroke: '#f5a623', 'stroke-width': E * 0.002 }, g);
    el('line', { x1: p.x, y1: -p.y - E, x2: p.x, y2: -p.y + E, stroke: '#f5a623', 'stroke-width': E * 0.002 }, g);
    el('circle', { cx: p.x, cy: -p.y, r: t.pellet / 2, fill: 'rgba(245,166,35,.45)', stroke: '#f5a623', 'stroke-width': E * 0.003 }, g);
  }

  // ---------- 數據面板 ----------
  function stat(k, v, s, wide, id) { return '<div class="stat' + (wide ? ' wide' : '') + '"' + (id ? ' data-mod="' + id + '" data-mod-name="' + esc(String(k)) + '"' : '') + '><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function offsetText(x, y) {
    var h = Math.abs(x) < 0.005 ? '' : (x > 0 ? '右 ' : '左 ') + f2(Math.abs(x)) + 'mm';
    var v = Math.abs(y) < 0.005 ? '' : (y > 0 ? '上 ' : '下 ') + f2(Math.abs(y)) + 'mm';
    return [h, v].filter(Boolean).join('，') || '0';
  }
  function renderStats(box, t, st) {
    if (!st.n) { box.innerHTML = '<div class="stat" data-mod="empty" data-mod-name="尚無資料"><div class="k">尚無資料</div></div>' + stat('60發預估', '—', '', false, 'p60'); return; }
    var h = '';
    h += stat('發數', st.n, '', false, 'n');
    h += stat('總分', st.total, '小數 ' + f1(st.totalDec), false, 'total');
    h += stat('平均分', f2(st.avg), '小數 ' + f2(st.avgDec), false, 'avg');
    h += stat('60發預估', st.proj60, '小數 ' + f1(st.proj60Dec), false, 'p60');
    h += stat(t.innerTen.label + '數', st.inner, t.id === 'ar10' ? '10環白點完全被打掉' : '觸及 5.0mm 內十圈', false, 'inner');
    h += stat('平均偏移', st.direction, offsetText(st.meanX, st.meanY) + '<br>距靶心平均 ' + f2(st.meanR) + 'mm', false, 'offset');
    h += stat('彈著群大小', f2(st.groupSize) + 'mm', st.groupPair ? '第' + (st.groupPair[0] + 1) + '與第' + (st.groupPair[1] + 1) + '發（中心距）' : '', false, 'group');
    h += stat('各環發數', '10：' + st.counts[10] + '　9：' + st.counts[9], '8：' + st.counts[8] + '　7：' + st.counts[7] + '　7以下：' + st.counts.below7, true, 'rings');
    if (st.series.length) h += stat('每10發小計', st.series.map(function (s) { return s.total; }).join(' / '), st.series.map(function (s) { return '第' + s.from + '–' + s.to + '發：' + s.total + '（' + f1(s.totalDec) + '）'; }).join('<br>'), true, 'series');
    box.innerHTML = h;
  }
  function shotTable(shots) {
    if (!shots.length) return '';
    var h = '<table><tr><th>#</th><th>環數</th><th>小數</th><th>內十</th><th>x(mm)</th><th>y(mm)</th><th>距中心</th></tr>';
    shots.forEach(function (q, i) { h += '<tr><td>' + (i + 1) + '</td><td>' + q.ring + '</td><td>' + f1(q.dec) + '</td><td>' + (q.inner ? '✓' : '') + '</td><td>' + f2(q.x) + '</td><td>' + f2(q.y) + '</td><td>' + f2(q.d) + '</td></tr>'; });
    return h + '</table>';
  }

  // ---------- 預報分頁（v1.5.0：與對照合併成「預報·對照」；只用雙指縮放；左上資訊框；右下玻璃圓鈕） ----------
  var predSvg = $('predSvg'), predView = null, predTid = null, predPrev = null;
  // 靶面檢視 {cx,cy,E}（SVG 座標，y 向下）；Pro 預報與對照靶面共用這套（各自一份）
  function cardBounds() { var c = tgt().cardSize; return { x0: -c / 2, y0: -c / 2, w: c, h: c }; }
  function inCard(p) { var half = tgt().cardSize / 2 + 1; return Math.abs(p.x) <= half && Math.abs(p.y) <= half; }
  function mkView(svg, fitBtn, getT, getTid) { // v1.6.0：分析頁也共用（getT／getTid 預設＝預報的 cur）
    var V = { v: null, tid: null };
    var gT = getT || tgt; getTid = getTid || function () { return cur.targetId; };
    V.reset = function () { var c = gT().cardSize; V.v = { cx: 0, cy: 0, E: c }; V.tid = getTid(); };
    V.ensure = function () { if (!V.v || V.tid !== getTid()) V.reset(); };
    V.clamp = function () { var c = gT().cardSize; zClamp(V.v, { x0: -c / 2, y0: -c / 2, w: c, h: c }, 10); };
    V.apply = function () {
      V.ensure(); var v = V.v; svg.setAttribute('viewBox', (v.cx - v.E / 2) + ' ' + (v.cy - v.E / 2) + ' ' + v.E + ' ' + v.E); svg.dataset.extent = v.E;
      var z = gT().cardSize / v.E, zoomed = z > 1.05, sp = fitBtn.querySelector('span');
      fitBtn.classList.toggle('zoomed', zoomed); sp.textContent = zoomed ? (Math.round(z * 10) / 10) + '×・全靶' : '雙指縮放';
    };
    V.zoom = function (z) { var c = gT().cardSize; V.v = { cx: 0, cy: 0, E: c / Math.max(1, z) }; V.tid = getTid(); V.clamp(); };
    return V;
  }
  var PV = mkView(predSvg, $('predFit'));
  function predInfo(p, pending) {
    var box = $('predInfo'), n = cur.preds.length;
    var q = p ? C.scoreShot(tgt(), p.x, p.y) : null, num = pending ? n + 1 : n;
    box.classList.toggle('live', !!pending); box.classList.toggle('empty', !q);
    box.innerHTML = q ? '<span class="n">第 ' + num + ' 發</span><span class="s">' + q.ring + '</span><span class="d">(' + f1(q.dec) + ')</span>' + (q.inner ? '<span class="x">內十</span>' : '')
      : '<span class="n">第 1 發</span><span class="s">—</span><span class="d">點靶面記錄</span>';
  }
  function renderPredict() {
    var t = tgt();
    drawTarget(predSvg, t, 1); PV.ensure(); PV.clamp(); PV.apply();
    var g = predSvg.querySelector('#marks');
    cur.preds.forEach(function (p, i) { drawShot(g, predSvg, p, i + 1, 'pred-c', t.pellet); });
    if (predPrev) previewMark(predSvg, predPrev, 'pred-c', t);
    var st = C.computeStats(t, cur.preds);
    renderStats($('predStats'), t, st);
    $('predList').innerHTML = shotTable(st.shots);
    if (predPrev) predInfo(predPrev, true); else predInfo(cur.preds[cur.preds.length - 1], false);
    $('undoPred').disabled = !cur.preds.length; $('clearPred').disabled = !cur.preds.length;
    renderLite();
  }
  attachZoom(predSvg, {
    active: function () { return true; },
    view: function () { PV.ensure(); return PV.v; }, clamp: PV.clamp, apply: PV.apply, render: function () { renderPredict(); },
    lift: function () { return liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) { predPrev = { x: r.x, y: -r.y }; previewMark(predSvg, predPrev, 'pred-c', tgt()); predInfo(predPrev, true); },
    up: function (r) {
      var p = { x: r.x, y: -r.y }; predPrev = null;
      if (!inCard(p)) { renderPredict(); return; }
      var q = { x: C.round(p.x, 3), y: C.round(p.y, 3), t: Date.now() }; if (cur.round > 0) q.r = cur.round; // Lite 多輪：標記目前這一輪
      cur.preds.push(q); persist(); renderPredict(); renderCompare(); vib();
    },
    cancel: function () { predPrev = null; renderPredict(); }
  });
  $('predFit').onclick = function () { PV.reset(); renderPredict(); };
  $('undoPred').onclick = function () { if (cur.preds.length) { cur.preds.pop(); persist(); renderPredict(); renderCompare(); } };
  $('clearPred').onclick = function () { if (cur.preds.length) ask('清除本組全部 ' + cur.preds.length + ' 發預報？', function () { cur.preds = []; persist(); renderAll(); }); };
  function startNew() { cur = newSession(cur.targetId); sessions.unshift(cur); persist(); photo.reset(); renderAll(); toast('已開始新的一組'); showTab('predict'); }
  $('newSession').onclick = startNew; $('newSession2').onclick = startNew;
  // 「落點上移」從預報頁移到「說明 › 介面設定」（同一個設定，Pro／Lite／鬼影共用）
  $('liftCursor').checked = !!prefs.lift; $('liftCursor').onchange = function () { prefs.lift = this.checked; savePrefs(); };

  // ---------- Lite 介面：三步驟「1 預報 → 2 拍照 → 3 結果」（資料與 Pro 共用 cur；每輪用 r 標記，見 liteflow.js） ----------
  var LF = window.BMLite;
  var liteSvg = $('liteSvg'), litePh = $('litePhotoSvg');
  var liteView = null, liteTid = null, litePreview = null; // 靶面檢視 {cx,cy,E}（SVG 座標，y 向下）
  var litePV = null, liteVMode = 'target';               // 照片檢視；第 2 步可切「靶面／照片」
  var liteSel = -1, liteUndo2 = null, liteDrag = null;   // 第 2 步：選取的彈孔（cur.actuals 索引）、復原、拖曳中
  var liteRes = 'cur', liteShotSel = -1;                 // 第 3 步：看哪一輪（'cur'、數字或 'all'）、點選的一發
  var lp = null;                                         // 本輪照片（只在記憶體，不存檔）
  function liteStep() { var s = cur.liteStep; return s === 2 || s === 3 ? s : 1; }
  function liteK() { return LF.curRound(cur); }
  function liteCard() { return tgt().cardSize; }
  function liteResetView() { var c = liteCard(); liteView = { cx: 0, cy: 0, E: c }; liteTid = cur.targetId; }
  function zClamp(v, b, div) {
    var M = Math.max(b.w, b.h); v.E = Math.max(M / (div || 10), Math.min(M, v.E));
    function cl(c, lo, len) { var h = v.E / 2; return v.E >= len ? lo + len / 2 : Math.max(lo + h, Math.min(lo + len - h, c)); }
    v.cx = cl(v.cx, b.x0, b.w); v.cy = cl(v.cy, b.y0, b.h);
  }
  function liteBounds() { var c = liteCard(); return { x0: -c / 2, y0: -c / 2, w: c, h: c }; }
  function liteClamp() { zClamp(liteView, liteBounds(), 10); }
  function photoBounds() { return { x0: 0, y0: 0, w: lp.w, h: lp.h }; }
  function liteHasPhoto() { return !!(lp && lp.sid === cur.id && lp.rk === liteK()); }
  function liteShowsPhoto() { return liteStep() === 2 && liteVMode === 'photo' && liteHasPhoto(); }
  function liteBadge(z) {
    var b = $('liteZoomBadge'); b.textContent = (Math.round(z * 10) / 10) + '×'; b.classList.toggle('show', z > 1.05);
    $('liteFit').disabled = z <= 1.05;
  }
  function liteApplyView() {
    if (liteShowsPhoto()) {
      if (!litePV) litePV = { cx: lp.w / 2, cy: lp.h / 2, E: Math.max(lp.w, lp.h) };
      var p = litePV; litePh.setAttribute('viewBox', (p.cx - p.E / 2) + ' ' + (p.cy - p.E / 2) + ' ' + p.E + ' ' + p.E); litePh.dataset.extent = p.E;
      liteBadge(Math.max(lp.w, lp.h) / p.E); return;
    }
    var v = liteView; liteSvg.setAttribute('viewBox', (v.cx - v.E / 2) + ' ' + (v.cy - v.E / 2) + ' ' + v.E + ' ' + v.E);
    liteSvg.dataset.extent = v.E; liteBadge(liteCard() / v.E);
  }
  // 分數 → 顏色：1–6 中性灰白；7→10.9 黃→橘→紅
  var SCORE_STOPS = [[7, [255, 214, 10]], [8, [255, 170, 0]], [9, [255, 112, 26]], [10, [235, 52, 40]], [10.9, [190, 18, 46]]];
  function scoreColor(dec) {
    if (dec == null) return { bg: '#3a4a5c', fg: '#ffffff', lbl: 'rgba(255,255,255,.75)' };
    if (dec < 7) return { bg: dec < 1 ? '#c9ced4' : '#e4e8ec', hi: '#ffffff', fg: '#2b3540', lbl: '#5d6b79' };
    var S = SCORE_STOPS, c = S[S.length - 1][1];
    for (var i = 0; i < S.length - 1; i++) if (dec <= S[i + 1][0]) { var k = (dec - S[i][0]) / (S[i + 1][0] - S[i][0]); c = S[i][1].map(function (v, j) { return Math.round(v + (S[i + 1][1][j] - v) * k); }); break; }
    var lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    var dark = lum > 0.6;
    var hi = c.map(function (v) { return Math.round(v + (255 - v) * 0.35); });
    return { bg: 'rgb(' + c.join(',') + ')', hi: 'rgb(' + hi.join(',') + ')', fg: dark ? '#1d1a14' : '#ffffff', lbl: dark ? 'rgba(29,26,20,.7)' : 'rgba(255,255,255,.85)' };
  }
  // v1.6.0：10 款主題（前 4 款沿用；後 6 款見 docs/theme6）。只有賽博龐克、電子世界會改畫靶面（幾何不變，見 themefx.js）
  var LITE_THEMES = ['sport', 'hud', 'light', 'glass', 'cyberpunk', 'tron', 'piano', 'racing', 'appliance', 'luxury'];
  var THEME_NAME = { sport: '運動風', hud: '戰術 HUD', light: '簡約亮色', glass: '玻璃漸層', cyberpunk: '賽博龐克', tron: '電子世界', piano: '鋼琴烤漆與霧面', racing: '賽車', appliance: '科技家電', luxury: '精密精品' };
  var THEME_META = { hud: '#050a0e', light: '#f2ecdd', sport: '#002776', glass: '#0b0221', cyberpunk: '#07050d', tron: '#000207', piano: '#050505', racing: '#0d0e10', appliance: '#0e1520', luxury: '#0c0a08' };
  // 各款外觀的方塊外形（viewBox 100×52；數字框位置固定，見 style.css .lp-c-*）
  var HEX = { big: '0,12.5 5,0.6 60.5,0.6 65.5,12.5 60.5,24.4 5,24.4', cnt: '62.2,0.6 94.6,0.6 99.6,12.5 94.6,24.4 62.2,24.4 67.2,12.5',
    est: '0.4,38.6 5.4,26.2 49.4,26.2 44.4,38.6 49.4,51 5.4,51', sum: '51.1,26.2 94.6,26.2 99.6,38.6 94.6,51 51.1,51 46.1,38.6' };
  var LITE_GEOM = {
    hud: { big: '0.8,12.5 5.6,1 60,1 64.8,12.5 60,24 5.6,24', cnt: '63.2,1 94.2,1 99,12.5 94.2,24 63.2,24 68,12.5',
      est: '1,38.6 5.8,26.6 48.6,26.6 43.8,38.6 48.6,50.6 5.8,50.6', sum: '52,26.6 94.2,26.6 99,38.6 94.2,50.6 52,50.6 47.2,38.6' },
    light: { big: '0.9,12.5 5.6,1.3 59.9,1.3 64.4,12.5 59.9,23.7 5.6,23.7', cnt: '63.6,1.3 94,1.3 98.7,12.5 94,23.7 63.6,23.7 68.1,12.5',
      est: '1.3,38.6 6,26.9 48.2,26.9 43.5,38.6 48.2,50.3 6,50.3', sum: '52.4,26.9 94,26.9 98.7,38.6 94,50.3 52.4,50.3 47.7,38.6' },
    sport: { big: '0,12.5 7,0.6 58,0.6 66,12.5 58,24.4 7,24.4', cnt: '60.5,0.6 92,0.6 99.6,12.5 92,24.4 60.5,24.4 68.5,12.5',
      est: '0.4,38.6 8,26.2 50,26.2 42.5,38.6 50,51 8,51', sum: '52,26.2 92,26.2 99.6,38.6 92,51 52,51 44.5,38.6' },
    glass: HEX
  };
  // 新 6 款的 Lite 資訊方塊外形沿用相近的舊款
  LITE_GEOM.cyberpunk = LITE_GEOM.hud; LITE_GEOM.tron = LITE_GEOM.hud; LITE_GEOM.piano = LITE_GEOM.light; LITE_GEOM.appliance = LITE_GEOM.light; LITE_GEOM.racing = LITE_GEOM.sport; LITE_GEOM.luxury = HEX;
  var liteTheme = LITE_THEMES.indexOf(prefs.liteTheme) >= 0 ? prefs.liteTheme : FRESH ? 'light' : 'sport';
  function setLiteTheme(th, quiet) {
    if (LITE_THEMES.indexOf(th) < 0) th = 'sport';
    liteTheme = th; LITE_THEMES.forEach(function (k) { document.body.classList.toggle('lt-' + k, k === th); });
    var G = LITE_GEOM[th]; ['big', 'cnt', 'est', 'sum'].forEach(function (k) {
      var K = { big: 'Big', cnt: 'Cnt', est: 'Est', sum: 'Sum' }[k];
      $('lp' + K + 'Bg').setAttribute('points', G[k]); $('lp' + K + 'Sh').setAttribute('points', G[k]);
      // 玻璃底（HTML div＋clip-path，才能用 backdrop-filter 模糊後方；SVG 元素不支援）
      $('lpG' + K).style.clipPath = 'polygon(' + G[k].split(' ').map(function (pt) { var q = pt.split(','); return q[0] + '% ' + (+q[1] / 52 * 100).toFixed(2) + '%'; }).join(',') + ')';
    });
    document.querySelectorAll('#liteThemeSheet [data-th]').forEach(function (b) { var on = b.dataset.th === th; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var sel = $('liteThemeSel'); if (sel) sel.value = th;
    var mc = document.querySelector('meta[name=theme-color]'); if (mc) mc.setAttribute('content', THEME_META[th] || '#002776');
    document.querySelectorAll('#themeGrid [data-th]').forEach(function (b) { var on = b.dataset.th === th; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    if (prefs.liteTheme !== th) { prefs.liteTheme = th; savePrefs(); }
    if (window.WRFx) WRFx.setTheme(th);
    if (!quiet) { try { renderAll(); } catch (e) { renderLite(); } }
  }
  // 大數字方塊：dec 決定顏色；txt 可以自訂顯示文字（結果頁顯示總分，顏色依平均小數分）
  var LITE_NULL = { // 新 6 款：尚無資料時的大數字方塊顏色
    cyberpunk: { bg: '#170b29', hi: '#2a1046', fg: '#f2ff3a', lbl: '#ff9ccb', edge: '#ff2b8c' },
    tron: { bg: '#031220', hi: '#062338', fg: '#bff1ff', lbl: '#7fdcff', edge: '#46d2ff' },
    piano: { bg: '#121214', hi: '#2a2a2e', fg: '#f4f4f5', lbl: '#a1a1aa' },
    racing: { bg: '#3a0a02', hi: '#6a1404', fg: '#ffd21a', lbl: '#ffb38a' },
    appliance: { bg: '#18222f', hi: '#24344a', fg: '#e8f3ff', lbl: '#9fb3c8' },
    luxury: { bg: '#1a150e', hi: '#2c2416', fg: '#efdcb0', lbl: '#b9a47c' }
  };
  function liteBig(dec, label, txt) {
    var col = scoreColor(dec), P = $('litePanel');
    if (dec == null && liteTheme === 'light') col = { bg: '#e6e2d9', hi: '#ffffff', fg: '#8a8a87', lbl: '#8a8a87' };
    if (dec == null && liteTheme === 'hud') col = { bg: '#0a141e', hi: '#0a141e', fg: '#80e8f0', lbl: '#80e8f0', edge: '#00f5ff' };
    if (dec == null && liteTheme === 'glass') col = { bg: 'rgba(255,255,255,.16)', hi: 'rgba(255,255,255,.28)', fg: '#fff', lbl: 'rgba(255,255,255,.75)' };
    if (dec == null && liteTheme === 'sport') col = { bg: '#0b2a5b', hi: '#1f4aa8', fg: '#ffffff', lbl: 'rgba(185,217,235,.85)' };
    if (dec == null && LITE_NULL[liteTheme]) col = LITE_NULL[liteTheme];
    P.style.setProperty('--score', col.bg); P.style.setProperty('--score-hi', col.hi || col.bg); P.style.setProperty('--score-fg', col.fg); P.style.setProperty('--score-lbl', col.lbl);
    P.style.setProperty('--score-edge', col.edge || col.bg);
    $('lpBig').textContent = txt != null ? txt : (dec == null ? '—' : f1(dec)); $('lpBigLbl').textContent = label;
    $('lpBigBg').dataset.score = dec == null ? '' : dec;
    liteFit($('lpBig'));
  }
  // 數字太寬時自動縮小（依實際字型量測，不猜字寬）
  function liteFit(span) {
    if (!span) return; span.style.setProperty('--fit', 1);
    var box = span.parentNode, w = span.scrollWidth, avail = box.clientWidth * 0.96;
    if (w > avail && avail > 0) span.style.setProperty('--fit', Math.max(0.4, avail / w).toFixed(3));
    liteCenterInk(span);
  }
  // 依「實際字跡」垂直置中：用 canvas 量這個字型的字身與字跡高度，算出位移（不同手機字型基線不同）
  var inkCtx = null;
  function liteCenterInk(span) {
    span.style.transform = '';
    try {
      if (!inkCtx) inkCtx = document.createElement('canvas').getContext('2d');
      var cs = getComputedStyle(span), F = parseFloat(cs.fontSize); if (!F || !span.textContent) return;
      inkCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + F + 'px ' + cs.fontFamily;
      var m = inkCtx.measureText(span.textContent);
      if (m.fontBoundingBoxAscent == null || m.actualBoundingBoxAscent == null) return;
      var lh = span.getBoundingClientRect().height || F;
      var base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
      var inkMid = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      var dy = lh / 2 - inkMid;
      if (isFinite(dy) && Math.abs(dy) < F * 0.4) span.style.transform = 'translateY(' + dy.toFixed(1) + 'px)';
    } catch (e) {}
  }
  // 依實際可用高度安排：靶面＝剩餘空間的正方形；底部步驟列固定在螢幕下緣，其餘都在文件流裡
  function liteLayout() {
    var V = $('liteView'); if (!document.body.classList.contains('lite') || !V.offsetParent) return;
    var W = V.clientWidth, P = $('litePanel'); P.style.setProperty('--pw', W + 'px');
    var top = V.getBoundingClientRect().top + (window.scrollY || 0);
    var steps = $('liteSteps').offsetHeight || 0;
    var avail = window.innerHeight - top - steps - 10;
    var fixed = 0, n = 0;
    ['.lite-bar', '#litePanel', '#liteS2', '#liteS3', '#liteVerify'].forEach(function (sel) { var e = V.querySelector(sel); if (e && e.offsetParent) { fixed += e.offsetHeight; n++; } });
    fixed += n * 8;
    var size = Math.floor(Math.max(200, Math.min(W, avail - fixed)));
    V.style.minHeight = Math.max(0, avail) + 'px';
    var tg = $('liteTg'); tg.style.width = size + 'px'; tg.style.height = size + 'px';
    ['lpBig', 'lpCount', 'lpEst', 'lpSum'].forEach(function (id) { liteFit($(id)); });
  }
  window.addEventListener('resize', liteLayout);
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { liteLayout(); }); } catch (e) {}
  if (window.ResizeObserver) try { new ResizeObserver(function () { liteLayout(); }).observe($('liteView')); } catch (e) {}

  // --- 繪製 ---
  function liteDot(g, p, num, cls, r, extra) {
    var E = +liteSvg.dataset.extent, gg = el('g', extra || {}, g);
    el('circle', { cx: p.x, cy: -p.y, r: r, 'class': cls, 'stroke-width': Math.max(0.12, E * 0.003) }, gg);
    if (num != null) {
      var fs = labelSize(liteSvg);
      var tx = el('text', { x: p.x, y: -p.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', stroke: /pred/.test(cls) ? '#0b3d80' : '#7a0d0d', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx.textContent = num;
    }
    return gg;
  }
  function liteResultSel() { return liteRes === 'all' ? 'all' : liteRes === 'cur' ? liteResRound() : liteRes; }
  function liteResRound() { // 第 3 步預設看「最近一輪有結果的」
    var k = liteK(); if (LF.pointsOf(cur.actuals, k).length) return k;
    var d = LF.doneRounds(cur); return d.length ? d[d.length - 1].k : k;
  }
  function renderLiteTarget() {
    if (!liteView || liteTid !== cur.targetId) liteResetView();
    var t = tgt(), step = liteStep(), k = liteK();
    drawTarget(liteSvg, t, 1); liteClamp(); liteApplyView();
    var g = liteSvg.querySelector('#marks'), lines = liteSvg.querySelector('#lines'), E = +liteSvg.dataset.extent, R = t.pellet / 2;
    if (step === 1) {
      cur.preds.forEach(function (p) { if (LF.roundOf(p) !== k) liteDot(g, p, null, 'pred-old', R); });
      LF.pointsOf(cur.preds, k).forEach(function (p, i) { liteDot(g, p, i + 1, 'pred-c', R); });
      if (litePreview) previewMark(liteSvg, litePreview, 'pred-c', t);
    } else if (step === 2) {
      LF.pointsOf(cur.preds, k).forEach(function (p) { liteDot(g, p, null, 'pred-ghost', R); });
      var n = 0;
      cur.actuals.forEach(function (a, i) {
        if (LF.roundOf(a) !== k) return; n++;
        var un = a.src === 'auto' && a.conf != null && a.conf < 0.5;
        var gg = liteDot(g, a, n, 'act-c' + (un ? ' act-unsure' : ''), R);
        if (i === liteSel) el('circle', { cx: a.x, cy: -a.y, r: R + E * 0.014, fill: 'none', 'class': 'lite-selring', 'stroke-width': Math.max(0.2, E * 0.006) }, gg);
      });
      if (litePreview) previewMark(liteSvg, litePreview, 'act-c', t);
    } else {
      var res = LF.result(t, cur, liteResultSel()), lab = {};
      res.cmp.pairs.forEach(function (q) {
        var p = cur.preds[q.predIdx], a = cur.actuals[q.actIdx]; lab[q.actIdx] = q.i;
        el('line', { x1: a.x, y1: -a.y, x2: p.x, y2: -p.y, 'class': 'lite-pairline', 'stroke-width': Math.max(0.1, E * 0.005) }, lines);
      });
      var ks = res.rounds, inSel = function (q) { return ks.indexOf(LF.roundOf(q)) >= 0; };
      cur.preds.forEach(function (p, i) { if (inSel(p)) liteDot(g, p, i + 1, 'pred-c', R); });
      var an = 0;
      cur.actuals.forEach(function (a, i) {
        if (!inSel(a)) return; an++;
        var gg = liteDot(g, a, res.hasForecast ? (lab[i] || '?') : an, 'act-c', R);
        if (i === liteShotSel) el('circle', { cx: a.x, cy: -a.y, r: R + E * 0.014, fill: 'none', 'class': 'lite-selring', 'stroke-width': Math.max(0.2, E * 0.006) }, gg);
      });
      if (res.st.n && res.st.advice) { // 群中心十字
        var ad = res.st.advice, cs = Math.max(1.2, E * 0.03), sw = Math.max(0.15, E * 0.005);
        el('line', { x1: ad.dx - cs, y1: -ad.dy, x2: ad.dx + cs, y2: -ad.dy, 'class': 'lite-mpi', 'stroke-width': sw * 1.6 }, lines);
        el('line', { x1: ad.dx, y1: -ad.dy - cs, x2: ad.dx, y2: -ad.dy + cs, 'class': 'lite-mpi', 'stroke-width': sw * 1.6 }, lines);
      }
    }
  }
  function renderLitePhoto() {
    var svg = litePh; while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!liteShowsPhoto()) return;
    if (!litePV) { litePV = { cx: lp.w / 2, cy: lp.h / 2, E: Math.max(lp.w, lp.h) }; }
    zClamp(litePV, photoBounds(), 12);
    var im = el('image', { x: 0, y: 0, width: lp.w, height: lp.h, preserveAspectRatio: 'none' }, svg);
    im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', lp.url); im.setAttribute('href', lp.url);
    var u = Math.max(lp.w, lp.h) / 300;
    lp.calPts.forEach(function (q) { el('circle', { cx: q.px, cy: q.py, r: u * 1.6, fill: 'none', stroke: '#00e5ff', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, svg); });
    if (lp.Tinv) {
      var Ti = lp.Tinv, t = tgt(), k = liteK();
      for (var n = 1; n <= 10; n++) el('path', { d: projCircle(Ti, t.ringDiam[n] / 2), fill: 'none', stroke: '#39ff14', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, svg);
      var RR = t.ringDiam[1] / 2 + 2;
      el('path', { d: projLine(Ti, 0, -RR, 0, RR), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
      el('path', { d: projLine(Ti, -RR, 0, RR, 0), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
      var m = 0;
      cur.actuals.forEach(function (a, i) {
        if (LF.roundOf(a) !== k) return; m++;
        var un = a.src === 'auto' && a.conf != null && a.conf < 0.5, sel = i === liteSel;
        el('path', { d: projCircle(Ti, t.pellet / 2, a.x, a.y, 24), fill: sel ? 'rgba(255,214,10,.35)' : 'rgba(255,40,40,.25)', stroke: sel ? '#ffd60a' : un ? '#ffb300' : '#ff2828', 'stroke-width': sel ? 3.5 : 2.5, 'stroke-dasharray': un && !sel ? '4 3' : '', 'vector-effect': 'non-scaling-stroke' }, svg);
        var pp = C.applyAffine(Ti, a.x, a.y);
        var tx = el('text', { x: pp.x + u * 2.4, y: pp.y - u * 2.4, 'font-size': u * 4, fill: un ? '#ffb300' : '#ffeb3b', stroke: '#000', 'stroke-width': u * 0.6, 'paint-order': 'stroke', 'font-weight': 'bold' }, svg);
        tx.textContent = m + (un ? '?' : '');
      });
    }
    liteApplyView();
  }
  // --- 主畫面 ---
  var GO_LBL = { 1: '下一步：拍照', 2: '看結果', 3: '繼續下一輪' };
  function renderLite() {
    var t = tgt(), step = liteStep(), k = liteK(), V = $('liteView');
    V.dataset.step = step;
    document.body.dataset.liteStep = step;
    var photoOn = liteShowsPhoto();
    litePh.toggleAttribute('hidden', !photoOn); liteSvg.style.visibility = photoOn ? 'hidden' : ''; // SVG 元素沒有 .hidden 屬性，要直接改 attribute
    renderLiteTarget(); renderLitePhoto();
    // 步驟列
    var rp = LF.pointsOf(cur.preds, k).length, ra = LF.pointsOf(cur.actuals, k).length, ready3 = LF.stepReady(cur, 3);
    document.querySelectorAll('#liteSteps [data-step]').forEach(function (b) {
      var s = +b.dataset.step, on = s === step && document.body.classList.contains('on-predict');
      b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false');
      b.classList.toggle('done', (s === 1 && rp > 0) || (s === 2 && ra > 0));
      b.classList.toggle('dim', s === 3 && !ready3);
    });
    $('liteRoundBadge').textContent = '第 ' + (k + 1) + ' 輪';
    $('liteRoundBadge').classList.toggle('show', k > 0 || LF.doneRounds(cur).length > 0);
    // 主按鈕
    var go = GO_LBL[step];
    if (step === 1 && !rp) go = ra ? '下一步：拍照' : '跳過預報，直接拍照';
    $('liteGoLbl').textContent = go;
    $('liteVerify').classList.toggle('soft', step === 2 && !ra);
    // 工具列
    $('liteUndo').hidden = step === 3;
    $('liteUndo').disabled = step === 1 ? !LF.canUndoPred(cur) : !liteUndo2;
    var st = C.computeStats(t, cur.preds), n = st.n;
    if (step === 1) {
      $('liteHint').textContent = (k > 0 ? '第 ' + (k + 1) + ' 輪・本輪 ' + rp + ' 發・' : '') + '點靶面記錄落點・雙指縮放';
      setPanelLabels('最新預報', '發數', '60發預估', '總分');
      // 總分與 60發預估沿用 Pro 的主數字：整數環數加總（ISSF 資格賽計分），60發預估＝整數平均×60
      $('lpCount').textContent = n; $('lpSum').textContent = n ? st.total : 0; $('lpEst').textContent = n ? st.proj60 : '—';
      if (!litePreview) { if (n) liteBig(st.shots[n - 1].dec, '第 ' + n + ' 發預報'); else liteBig(null, '最新預報'); }
    } else if (step === 2) renderLiteS2(rp, ra);
    else renderLiteS3();
    ['lpCount', 'lpEst', 'lpSum'].forEach(function (id) { liteFit($(id)); });
    liteLayout();
  }
  function setPanelLabels(b, c, e, s) { $('lpBigLbl').textContent = b; $('lpCntLbl').textContent = c; $('lpEstLbl').textContent = e; $('lpSumLbl').textContent = s; }
  function renderLiteS2(rp, ra) {
    var info = '', warn = false, has = liteHasPhoto();
    document.querySelectorAll('#liteViewSeg button').forEach(function (b) { var on = b.dataset.v === liteVMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.disabled = b.dataset.v === 'photo' && !has; });
    $('liteViewSeg').hidden = !has;
    $('liteBusy').hidden = !(has && lp.busy);
    $('liteEmpty').hidden = !!(has || ra);
    $('liteS2').classList.toggle('has-photo', !!has || ra > 0);
    if (has && lp.busy) info = '分析照片中…';
    else if (has && lp.mode === 'manual' && lp.calPts.length < 5) {
      var nm = ['靶心', '黑區邊緣的「上緣」', '黑區邊緣的「右緣」', '黑區邊緣的「下緣」', '黑區邊緣的「左緣」'];
      info = '手動校正 ' + (lp.calPts.length + 1) + '/5：在照片上點<b>' + nm[lp.calPts.length] + '</b>（可雙指放大）';
    } else if (has && !lp.T) { info = '⚠️ 自動校正失敗（' + esc(lp.info && lp.info.reason || '原因不明') + '）。按「手動校正」，或重拍一張正對、清楚的照片。'; warn = true; }
    else if (!has && !ra) info = rp ? '拍下這一輪的靶紙或電子靶螢幕（本輪預報 <b>' + rp + '</b> 發）' : '沒有預報也可以：拍照後只顯示成績分析';
    else {
      info = '偵測到 <b>' + ra + '</b> 個彈孔' + (rp ? '・本輪預報 ' + rp + ' 發' : '');
      if (rp && ra !== rp) { info += '<br>⚠️ 數量不同：重疊的彈孔可能算少，請在靶面上補點或刪除'; warn = true; }
      else info += '<br>點空白＝新增・按住彈孔可拖曳・選取後可刪除';
    }
    $('liteS2Info').innerHTML = info; $('liteS2Info').classList.toggle('warn', warn);
    $('liteHint').textContent = liteSel >= 0 ? '已選取 1 個彈孔' : liteVMode === 'photo' && has ? '綠圈要對齊靶環・紫線穿過數字' : '第 ' + (liteK() + 1) + ' 輪・實際彈著';
    $('liteDelHole').disabled = liteSel < 0;
    var hasT = has && !!lp.T;
    $('liteRotL').disabled = $('liteRotR').disabled = $('liteRedetect').disabled = !hasT;
    $('liteManual').disabled = !has;
  }
  function renderLiteS3() {
    var t = tgt(), sel = liteResultSel(), res = LF.result(t, cur, sel), st = res.st, cmp = res.cmp;
    var rl = LF.doneRounds(cur), chips = '';
    if (rl.length > 1 || (rl.length === 1 && rl[0].k !== liteK() && LF.pointsOf(cur.actuals, liteK()).length)) {
      rl.forEach(function (r) { chips += '<button type="button" data-r="' + r.k + '" class="' + (sel === r.k ? 'on' : '') + '">第 ' + (r.k + 1) + ' 輪<small>' + r.acts + '發</small></button>'; });
      chips += '<button type="button" data-r="all" class="' + (sel === 'all' ? 'on' : '') + '">全部<small>' + LF.pointsOf(cur.actuals, -1).length + '</small></button>';
    }
    $('liteRounds').innerHTML = chips; $('liteRounds').hidden = !chips;
    var tot = 0; rl.forEach(function (r) { tot += r.acts; }); var ae = $('liteRounds').querySelector('[data-r=all] small'); if (ae) ae.textContent = tot + '發';
    $('liteRounds').querySelectorAll('button').forEach(function (b) { b.onclick = function () { liteRes = b.dataset.r === 'all' ? 'all' : +b.dataset.r; liteShotSel = -1; renderLite(); }; });
    var lbl = sel === 'all' ? '全部' : '第 ' + (sel + 1) + ' 輪';
    if (!st.n) { liteBig(null, lbl + '・實際總分'); $('lpCount').textContent = 0; $('lpEst').textContent = '—'; $('lpSum').textContent = '—'; $('liteHint').textContent = '還沒有彈孔，先到「2 拍照」'; }
    else {
      liteBig(st.avgDec, lbl + '・實際總分', String(st.total));
      $('lpCount').textContent = st.n;
      if (res.hasForecast && cmp.m) {
        setPanelLabels(lbl + '・實際總分', '發數', '平均誤差 mm', '預報總分');
        $('lpEst').textContent = f1(cmp.meanErr); $('lpSum').textContent = res.pst.total;
        var lv = LF.accuracyLevel(t, cmp);
        $('liteHint').textContent = '預報' + (cmp.biasDir === '置中' ? '沒有明顯偏向' : '偏' + cmp.biasDir + ' ' + f1(cmp.biasLen) + 'mm') + '・環數對 ' + Math.round(cmp.sameRingRate * 100) + '%・' + lv.label;
      } else {
        setPanelLabels(lbl + '・實際總分', '發數', '60發預估', '小數總分');
        $('lpEst').textContent = st.proj60; $('lpSum').textContent = f1(st.totalDec);
        $('liteHint').textContent = st.advice ? '群中心 ' + (st.advice.centered ? '置中' : st.advice.offsetDir + ' ' + f1(st.advice.dist) + 'mm') + (st.n > 1 ? '・群大小 ' + f1(st.groupSize) + 'mm' : '') : '成績分析';
      }
    }
    if (liteShotSel >= 0 && cur.actuals[liteShotSel]) {
      var a = cur.actuals[liteShotSel], sa = C.scoreShot(t, a.x, a.y), pq = res.cmp.pairs.filter(function (q) { return q.actIdx === liteShotSel; })[0];
      $('liteHint').textContent = pq ? '第 ' + pq.i + ' 發：預報 ' + f1(pq.pred.dec) + ' → 實際 ' + f1(pq.act.dec) + '，差 ' + f1(pq.err) + 'mm' : '這一發：' + f1(sa.dec) + '（' + offsetText(a.x, a.y) + '）';
    }
    if (document.activeElement !== $('liteName')) $('liteName').value = cur.name || '';
    var Code = window.BMCode, rec = LF.toAnalysisRecord(cur), code = null;
    try { code = rec && Code ? Code.encode(rec) : null; } catch (e) { code = null; }
    $('liteCopyCode').disabled = !code;
    $('liteCodeInfo').textContent = code ? '紀錄碼 ' + code.length + ' 字（含全部 ' + rec.sheets.length + ' 輪的實際彈孔，不含照片）' : '';
    $('liteDetail').innerHTML = liteDetailHTML(t, res, lbl);
  }
  function liteDetailHTML(t, res, lbl) {
    var st = res.st, cmp = res.cmp, h = '', card = function (title, body) { var id = title.replace(/（.*$/, '').replace(/[\s"<>&]/g, ''); return '<div class="lite-card" data-mod="' + id + '" data-mod-name="' + id.replace(/^\W+/, '') + '"><div class="lite-ct">' + title + '</div>' + body + '</div>'; };
    if (!st.n) return '';
    var kv = function (k, v, s) { return '<div class="lite-kv"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; };
    if (res.hasForecast) {
      if (cmp.m) {
        var lv = LF.accuracyLevel(t, cmp);
        h += card('🎯 預報準不準（' + lbl + '）', '<div class="lite-acc lv' + lv.level + '">' + lv.label + '<small>平均差 ' + f1(lv.rings) + ' 個環寬</small></div>' +
          kv('平均預報誤差', f2(cmp.meanErr) + ' mm', '最大：第 ' + cmp.maxErrShot + ' 發 ' + f1(cmp.maxErr) + 'mm') +
          kv('系統性偏向', cmp.biasDir === '置中' ? '無明顯偏向' : '預報偏' + cmp.biasDir, offsetText(cmp.biasX, cmp.biasY)) +
          kv('環數判斷正確', Math.round(cmp.sameRingRate * 100) + '%', '平均小數分差 ' + f2(cmp.meanAbsDecDiff)) +
          (cmp.unpairedPred || cmp.unpairedAct ? kv('沒配對到', (cmp.unpairedPred ? '預報 ' + cmp.unpairedPred + ' 發' : '') + (cmp.unpairedAct ? ' 彈孔 ' + cmp.unpairedAct + ' 個' : ''), '預報發數和彈孔數不同') : '') +
          '<div class="lite-note">分級是 WRbeta 的練習參考（平均誤差 ≤0.5 環寬＝很準、≤1 不錯、≤2 普通），不是 ISSF 規則。照片看不出射擊順序，用「總距離最短」配對。</div>');
      } else h += card('🎯 預報準不準', '<div>這一輪沒有可配對的預報與彈孔。</div>');
    }
    h += card('📊 實際成績（' + lbl + '）', kv('總分', st.total, '小數 ' + f1(st.totalDec)) + kv('平均', f2(st.avgDec), '整數 ' + f2(st.avg)) + kv('60發預估', st.proj60, '小數 ' + f1(st.proj60Dec)) +
      kv(t.innerTen.label + '數', st.inner) + (st.n > 1 ? kv('彈著群大小', f1(st.groupSize) + ' mm') : '') +
      (st.advice ? kv('群中心', st.advice.centered ? '置中' : st.advice.offsetDir + ' ' + f1(st.advice.dist) + 'mm', esc(st.advice.text)) : '') +
      (st.n > 1 ? kv('穩定度（標準差）', f2(st.sdDec)) : ''));
    if (res.perRound.length > 1) {
      var tb = '<table class="lite-tb"><tr><th>輪</th><th>預報</th><th>彈孔</th><th>總分</th><th>小數</th></tr>';
      res.perRound.forEach(function (r) { tb += '<tr><td>' + (r.k + 1) + '</td><td>' + r.preds + '</td><td>' + r.acts + '</td><td>' + r.st.total + '</td><td>' + f1(r.st.totalDec) + '</td></tr>'; });
      h += card('🗂 每輪小計', tb + '</table>');
    }
    if (cmp.m) {
      var pt = '<table class="lite-tb"><tr><th>#</th><th>預報</th><th>實際</th><th>差距</th></tr>';
      cmp.pairs.forEach(function (q) { pt += '<tr><td>' + q.i + '</td><td>' + f1(q.pred.dec) + '</td><td>' + f1(q.act.dec) + '</td><td>' + f1(q.err) + 'mm</td></tr>'; });
      h += card('逐發對照', pt + '</table>');
    }
    return h;
  }

  // --- 觸控：單指＝點選（按住可拖曳，放開才記錄）；雙指＝縮放／平移；滾輪縮放（電腦） ---
  function attachZoom(svg, S) {
    var ptrs = {}, tapId = null, tapOk = false, pinch = null;
    function count() { return Object.keys(ptrs).length; }
    function raw(ev, lift) { var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY - (lift || 0); var q = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: q.x, y: q.y }; }
    function pinchStart() {
      var ids = Object.keys(ptrs), a = ptrs[ids[0]], b = ptrs[ids[1]], v = S.view();
      pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v: { cx: v.cx, cy: v.cy, E: v.E } };
    }
    function pinchMove() {
      var ids = Object.keys(ptrs); if (ids.length < 2 || !pinch) return;
      var a = ptrs[ids[0]], b = ptrs[ids[1]], r = svg.getBoundingClientRect(), v = S.view();
      var d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, v0 = pinch.v;
      var px = v0.cx - v0.E / 2 + (pinch.mx - r.left) * v0.E / r.width, py = v0.cy - v0.E / 2 + (pinch.my - r.top) * v0.E / r.height;
      v.E = v0.E * pinch.d / d; S.clamp(); var E = v.E;
      v.cx = px + E / 2 - (mx - r.left) * E / r.width; v.cy = py + E / 2 - (my - r.top) * E / r.height;
      S.clamp(); (S.apply || liteApplyView)();
    }
    svg.addEventListener('pointerdown', function (ev) {
      if (!S.active()) return;
      ev.preventDefault(); try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var n = count();
      if (n === 1) { tapId = ev.pointerId; tapOk = true; S.down(raw(ev, S.lift())); }
      else { if (tapOk) { tapOk = false; S.cancel(); } if (n === 2) pinchStart(); }
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!ptrs[ev.pointerId]) return; ev.preventDefault();
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (pinch) pinchMove(); else if (tapOk && ev.pointerId === tapId) S.move(raw(ev, S.lift()));
    });
    function end(ev, cancel) {
      if (!ptrs[ev.pointerId]) return;
      var commit = !cancel && tapOk && ev.pointerId === tapId && !pinch, p = commit ? raw(ev, S.lift()) : null;
      delete ptrs[ev.pointerId];
      if (ev.pointerId === tapId) { tapOk = false; tapId = null; if (!commit) S.cancel(); }
      if (count() < 2 && pinch) { pinch = null; (S.render || renderLite)(); }
      if (!count()) pinch = null;
      if (commit) S.up(p);
    }
    svg.addEventListener('pointerup', function (ev) { end(ev, false); });
    svg.addEventListener('pointercancel', function (ev) { end(ev, true); });
    svg.addEventListener('wheel', function (ev) {
      if (!S.active()) return;
      ev.preventDefault(); var r = svg.getBoundingClientRect(), v = S.view();
      var px = v.cx - v.E / 2 + (ev.clientX - r.left) * v.E / r.width, py = v.cy - v.E / 2 + (ev.clientY - r.top) * v.E / r.height;
      v.E *= ev.deltaY > 0 ? 1.15 : 1 / 1.15; S.clamp();
      v.cx = px + v.E / 2 - (ev.clientX - r.left) * v.E / r.width; v.cy = py + v.E / 2 - (ev.clientY - r.top) * v.E / r.height;
      S.clamp(); (S.render || renderLite)();
    }, { passive: false });
  }
  function vib() { if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {} }
  function liteInCard(p) { var half = liteCard() / 2 + 1; return Math.abs(p.x) <= half && Math.abs(p.y) <= half; }
  // 第 2 步編輯（靶面與照片共用，座標一律 mm）：點空白＝新增；按住彈孔＝選取＋拖曳
  var holeEdit = {
    down: function (m) {
      var k = liteK(), i = LF.nearest(cur.actuals, k, m, tgt().pellet / 2 * 1.25);
      if (i >= 0) { var a = cur.actuals[i]; liteDrag = { i: i, ox: a.x - m.x, oy: a.y - m.y, from: { x: a.x, y: a.y }, moved: false, wasSel: liteSel === i }; liteSel = i; litePreview = null; }
      else { liteDrag = null; litePreview = m; }
      renderLite();
    },
    move: function (m) {
      if (liteDrag) {
        var a = cur.actuals[liteDrag.i], nx = m.x + liteDrag.ox, ny = m.y + liteDrag.oy;
        if (!liteDrag.moved && Math.hypot(nx - liteDrag.from.x, ny - liteDrag.from.y) < 0.4) return;
        liteDrag.moved = true; a.x = C.round(nx, 3); a.y = C.round(ny, 3); a.src = 'manual'; delete a.conf;
      } else litePreview = m;
      renderLite();
    },
    up: function (m) {
      if (liteDrag) {
        var d = liteDrag; liteDrag = null;
        if (d.moved) { liteUndo2 = { op: 'move', q: cur.actuals[d.i], from: d.from }; persist(); vib(); }
        else if (d.wasSel) liteSel = -1; // 再點一次＝取消選取
        renderLite(); return;
      }
      litePreview = null;
      if (!liteInCard(m)) { renderLite(); return; }
      var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual', r: liteK() };
      cur.actuals.push(q); liteSel = cur.actuals.length - 1; liteUndo2 = { op: 'add', q: q };
      persist(); vib(); renderLite(); toast('已新增一個彈孔');
    },
    cancel: function () {
      if (liteDrag && liteDrag.moved) { var a = cur.actuals[liteDrag.i]; a.x = liteDrag.from.x; a.y = liteDrag.from.y; }
      liteDrag = null; litePreview = null; renderLite();
    }
  };
  function liftPx() { return prefs.lift ? 60 : 0; }
  attachZoom(liteSvg, {
    active: function () { return !liteShowsPhoto(); },
    view: function () { return liteView; }, clamp: liteClamp,
    lift: function () { return liteStep() === 1 ? liftPx() : 0; },
    down: function (r) { var m = { x: r.x, y: -r.y }; if (liteStep() === 1) this.move(r); else if (liteStep() === 2) holeEdit.down(m); },
    move: function (r) {
      var m = { x: r.x, y: -r.y }, step = liteStep();
      if (step === 1) { litePreview = m; previewMark(liteSvg, m, 'pred-c', tgt()); var s = C.scoreShot(tgt(), m.x, m.y); liteBig(s.dec, '第 ' + (cur.preds.length + 1) + ' 發・放開記錄'); }
      else if (step === 2) holeEdit.move(m);
    },
    up: function (r) {
      var m = { x: r.x, y: -r.y }, step = liteStep();
      if (step === 1) {
        litePreview = null;
        if (!liteInCard(m)) { renderLite(); return; }
        var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), t: Date.now() }; if (liteK() > 0) q.r = liteK();
        cur.preds.push(q); persist(); renderPredict(); renderCompare(); vib();
      } else if (step === 2) holeEdit.up(m);
      else { // 第 3 步：點一發看它的預報與實際
        var res = LF.result(tgt(), cur, liteResultSel()), bi = -1, bd = Infinity;
        cur.actuals.forEach(function (a, i) { if (res.rounds.indexOf(LF.roundOf(a)) < 0) return; var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd) { bd = d; bi = i; } });
        liteShotSel = bd <= tgt().pellet * 1.5 && bi !== liteShotSel ? bi : -1; renderLite();
      }
    },
    cancel: function () { if (liteStep() === 2) holeEdit.cancel(); else { litePreview = null; renderLite(); } }
  });
  attachZoom(litePh, {
    active: function () { return liteShowsPhoto(); },
    view: function () { return litePV; }, clamp: function () { zClamp(litePV, photoBounds(), 12); },
    lift: function () { return 0; },
    toMM: function (r) { return lp.T ? C.applyAffine(lp.T, r.x, r.y) : null; },
    down: function (r) { if (lp.busy || (lp.mode === 'manual' && lp.calPts.length < 5)) return; var m = this.toMM(r); if (m) holeEdit.down(m); },
    move: function (r) { if (lp.busy || (lp.mode === 'manual' && lp.calPts.length < 5)) return; var m = this.toMM(r); if (m) holeEdit.move(m); },
    up: function (r) {
      if (lp.busy) return;
      if (lp.mode === 'manual' && lp.calPts.length < 5) {
        var tt = C.calibTargets(tgt(), tgt().blackFromRing)[lp.calPts.length];
        lp.calPts.push({ px: r.x, py: r.y, x: tt.x, y: tt.y });
        if (lp.calPts.length === 5) { lp.T = C.fitAffine(lp.calPts); if (!lp.T) { toast('校正失敗，請重新點'); lp.calPts = []; } else { lp.rotDeg = 0; liteProcess(); return; } }
        renderLite(); return;
      }
      var m = this.toMM(r); if (m) holeEdit.up(m);
    },
    cancel: function () { holeEdit.cancel(); }
  });

  // --- 第 2 步：照片（沿用自動校正＋找彈孔；本輪的彈孔只換掉本輪） ---
  function liteLoad(file) {
    if (!file) return;
    if (!pickIsImage(file)) { pickError(file); return; }
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      if (lp && lp.url) try { URL.revokeObjectURL(lp.url); } catch (e) {}
      lp = { sid: cur.id, rk: liteK(), url: url, img: im, w: im.naturalWidth, h: im.naturalHeight, name: file.name || '', mode: 'auto', calPts: [], T: null, Tinv: null, g: null, rotDeg: 0, busy: false, info: null };
      litePV = null; liteSel = -1; liteUndo2 = null; liteVMode = 'photo';
      liteProcess();
    };
    im.onerror = function () { pickError(file); };
    im.src = url;
  }
  function liteProcess() {
    var P = lp, V = window.BMVision; if (!P) return;
    P.busy = true; renderLite();
    setTimeout(function () {
      try {
        var r = visRun(P, cur.targetId, +$('liteSens').value, false), det = r.det; // v1.7.1：共用流程
        if (r.mismatch) toast('⚠️ 這張看起來是「' + T[r.mismatch].name + '」靶紙，但目前選的是「' + tgt().name + '」，彈孔的位置和分數會算錯');
        if (P.T) {
          LF.setRoundActuals(cur, P.rk, (det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; }));
          cur.calib = { mode: P.mode, rms: C.round(P.T.rms || 0, 3), at: Date.now() };
          cur.rounds = cur.rounds || []; cur.rounds[P.rk] = { at: new Date().toISOString(), photo: { w: P.w, h: P.h, name: P.name }, calib: { mode: P.mode, rms: C.round(P.T.rms || 0, 3) } };
          persist();
          var rp = LF.pointsOf(cur.preds, P.rk).length, ra = LF.pointsOf(cur.actuals, P.rk).length;
          liteVMode = rp && ra !== rp ? 'photo' : 'target'; // 數量對得上就直接看靶面，對不上留在照片方便檢查
        }
      } catch (e) { P.T = null; P.info = { reason: '分析錯誤：' + e.message }; }
      P.busy = false; liteSel = -1; liteUndo2 = null; renderLite(); renderCompare();
    }, 30);
  }
  ['liteCam', 'litePick', 'liteFile'].forEach(function (id) { $(id).onchange = function () { liteLoad(this.files[0]); this.value = ''; }; });
  document.querySelectorAll('#liteViewSeg button').forEach(function (b) { b.onclick = function () { liteVMode = b.dataset.v; litePreview = null; renderLite(); }; });
  $('liteDelHole').onclick = function () {
    if (liteSel < 0 || !cur.actuals[liteSel]) return;
    var q = cur.actuals.splice(liteSel, 1)[0]; liteUndo2 = { op: 'del', q: q, i: liteSel }; liteSel = -1; persist(); renderLite(); renderCompare(); toast('已刪除一個彈孔');
  };
  function liteRotate(deg) {
    if (!lp || !lp.T) return;
    var th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), rms = lp.T.rms, k = lp.rk;
    lp.T = window.BMVision.rotateAffine(lp.T, th); lp.T.rms = rms; lp.Tinv = C.invertAffine(lp.T); lp.rotDeg += deg;
    cur.actuals = cur.actuals.map(function (p) { return LF.roundOf(p) === k ? Object.assign({}, p, { x: C.round(c * p.x - s * p.y, 3), y: C.round(s * p.x + c * p.y, 3) }) : p; });
    liteUndo2 = null; persist(); renderLite(); toast('已轉 ' + lp.rotDeg + '°');
  }
  $('liteRotL').onclick = function () { liteRotate(-1); }; $('liteRotR').onclick = function () { liteRotate(1); };
  $('liteRedetect').onclick = function () { if (lp && lp.T) liteProcess(); };
  $('liteSens').onchange = function () { if (lp && lp.T) liteProcess(); };
  $('liteManual').onclick = function () {
    if (!lp) return;
    if (lp.mode === 'manual' && lp.calPts.length < 5) { lp.mode = 'auto'; lp.calPts = []; liteProcess(); return; } // 再按一次＝回到自動
    lp.mode = 'manual'; lp.calPts = []; lp.T = null; lp.Tinv = null; liteVMode = 'photo'; renderLite();
  };
  // --- 共用按鈕 ---
  $('liteFit').onclick = function () { if (liteShowsPhoto()) litePV = null; else liteResetView(); renderLite(); };
  $('liteUndo').onclick = function () {
    if (liteStep() === 1) { if (LF.canUndoPred(cur)) { cur.preds.pop(); persist(); renderPredict(); renderCompare(); } return; }
    var u = liteUndo2; if (!u) return;
    if (u.op === 'add') { var i = cur.actuals.indexOf(u.q); if (i >= 0) cur.actuals.splice(i, 1); }
    else if (u.op === 'del') cur.actuals.splice(Math.min(u.i, cur.actuals.length), 0, u.q);
    else if (u.op === 'move') { u.q.x = u.from.x; u.q.y = u.from.y; }
    liteUndo2 = null; liteSel = -1; persist(); renderLite(); renderCompare();
  };
  function setLiteStep(s, quiet) {
    if (s === 3 && !LF.stepReady(cur, 3)) { toast('先在「2 拍照」拍下靶紙，才有結果'); s = 2; }
    if (cur.liteStep !== s) { cur.liteStep = s; persist(); }
    litePreview = null; liteDrag = null; if (s !== 2) liteSel = -1; if (s === 3) { liteRes = 'cur'; liteShotSel = -1; }
    if (!document.body.classList.contains('on-predict')) showTab('predict');
    renderLite(); if (!quiet) window.scrollTo(0, 0);
  }
  $('liteVerify').onclick = function () {
    var s = liteStep();
    if (s === 1) setLiteStep(2);
    else if (s === 2) { if (!LF.pointsOf(cur.actuals, liteK()).length) { toast('還沒有彈孔：先拍照，或在靶面上點實際彈著'); return; } setLiteStep(3); }
    else { var k = LF.nextRound(cur); lp = null; liteUndo2 = null; liteVMode = 'target'; liteResetView(); persist(); setLiteStep(1); toast('第 ' + (k + 1) + ' 輪開始：預報 → 拍照 → 結果'); }
  };
  document.querySelectorAll('#liteSteps [data-step]').forEach(function (b) { b.onclick = function () { setLiteStep(+b.dataset.step); }; });
  $('liteName').onchange = function () { cur.name = this.value.trim().slice(0, 60); persist(); renderLite(); toast('名稱已存'); };
  $('liteCopyCode').onclick = function () {
    var Code = window.BMCode, rec = LF.toAnalysisRecord(cur), code = rec && Code && Code.encode(rec);
    if (!code) { toast('還沒有可複製的彈孔'); return; }
    copyText(code, '已複製紀錄碼（' + code.length + ' 字）');
  };
  $('liteFinish').onclick = function () {
    var n = cur.preds.length + cur.actuals.length;
    function go() { cur.liteStep = 1; persist(); startNew(); lp = null; liteUndo2 = null; liteVMode = 'target'; cur.liteStep = 1; renderLite(); toast('已存到「紀錄」，開始新的一組'); }
    if (n) ask('這一組已自動存到「紀錄」。開始新的一組？', go); else go();
  };

  // ---------- 鬼影模式（v1.4.0；Lite 從「更多」進入、Pro 是「鬼影」分頁；邏輯在 src/ghost.js） ----------
  // 60 發＝6 輪 × 10 發，手動點靶面記錄；灰色孔＝上一次同一發、虛線圈＝下一發的鬼影。存成一般紀錄（kind:'forecast'、mode:'ghost'）。
  var G = window.BMGhost, LS_GCUR = 'bm_ghost_cur_v1';
  var ghSvg = $('ghSvg'), gcur = null, ghView = null, ghTid = null, ghPrev = null, ghOn = prefs.ghostOn !== false, ghOpen = !!prefs.ghostColl;
  function ghT() { return T[gcur.targetId] || T.ap10; }
  function ghEnsure() {
    if (gcur && sessions.indexOf(gcur) < 0 && G.countShots(gcur)) gcur = null; // 被刪掉了
    if (!gcur) {
      var id = store.get(LS_GCUR);
      gcur = sessions.filter(function (s) { return s.id === id && G.isGhost(s); })[0] || null;
      if (gcur && gcur.ghost && gcur.ghost.done) gcur = null;
    }
    if (!gcur) { gcur = G.newSession(cur.targetId); gcur.ghost.src = prefs.ghostSrc === 'round' ? 'round' : 'prev'; }
    if (!G.countShots(gcur) && gcur.targetId !== cur.targetId) { gcur.targetId = cur.targetId; ghView = null; }
    return gcur;
  }
  function ghPersist() {
    var i = sessions.indexOf(gcur);
    if (i < 0) { i = sessions.findIndex(function (s) { return s.id === gcur.id; }); }
    if (i < 0) sessions.unshift(gcur); else sessions[i] = gcur;
    gcur.updated = new Date().toISOString();
    saveSessions(sessions); store.set(LS_GCUR, gcur.id);
  }
  function ghRef() { return G.pickRef(sessions, gcur); }
  function ghSrc() { return gcur.ghost && gcur.ghost.src === 'round' ? 'round' : 'prev'; }
  function ghSlots() { return G.ghostSlots(gcur, ghRef(), ghSrc()); }
  function ghResetView() { var c = ghT().cardSize; ghView = { cx: 0, cy: 0, E: c }; ghTid = gcur.targetId; }
  function ghClamp() { var c = ghT().cardSize; zClamp(ghView, { x0: -c / 2, y0: -c / 2, w: c, h: c }, 10); }
  function ghApplyView() {
    var v = ghView; ghSvg.setAttribute('viewBox', (v.cx - v.E / 2) + ' ' + (v.cy - v.E / 2) + ' ' + v.E + ' ' + v.E); ghSvg.dataset.extent = v.E;
    var z = ghT().cardSize / v.E, b = $('ghZoomBadge'); b.textContent = (Math.round(z * 10) / 10) + '×'; b.classList.toggle('show', z > 1.05); $('ghFit').disabled = z <= 1.05;
  }
  function ghDot(g, p, num, cls, r, txtCls) {
    var E = +ghSvg.dataset.extent, gg = el('g', {}, g);
    el('circle', { cx: p.x, cy: -p.y, r: r, 'class': cls, 'stroke-width': Math.max(0.12, E * 0.003) }, gg);
    if (num != null) {
      var fs = labelSize(ghSvg) * 0.9;
      var tx = el('text', { x: p.x, y: -p.y, 'font-size': fs, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': txtCls || 'gh-num', 'stroke-width': fs * 0.18, 'paint-order': 'stroke', 'font-weight': 'bold', 'font-family': 'Arial,sans-serif' }, gg);
      tx.textContent = num;
    }
    return gg;
  }
  function ghSign(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + f2(Math.abs(v)); }
  function ghDelta(v) { return v == null ? '' : '<span class="gh-d ' + (v > 0.005 ? 'up' : v < -0.005 ? 'dn' : 'eq') + '">' + (v > 0.005 ? '▲' : v < -0.005 ? '▼' : '') + ghSign(v) + '</span>'; }
  function renderGhostTarget(gs, S) {
    if (!ghView || ghTid !== gcur.targetId) ghResetView();
    var t = ghT(), R = t.pellet / 2, k = G.curRound(gcur), n = S.next;
    drawTarget(ghSvg, t, 1); ghClamp(); ghApplyView();
    var g = ghSvg.querySelector('#marks'), lines = ghSvg.querySelector('#lines');
    if (ghOn) {
      if (prefs.ghostWhole && !document.body.classList.contains('lite')) {
        for (var i = 0; i < G.PER; i++) { var w = gs[k * G.PER + i]; if (w && k * G.PER + i !== n) ghDot(lines, w, k * G.PER + i + 1, 'gh-whole', R, 'gh-num-w'); }
      }
      var nx = n != null ? G.ghostAt(gs, n + 1) : null;
      if (nx && n + 1 < (k + 1) * G.PER) ghDot(lines, nx, null, 'gh-next', R);
      var gh = G.ghostAt(gs, n);
      if (gh) ghDot(lines, gh, n + 1, 'gh-ghost', R, 'gh-num-g');
    }
    G.roundShots(gcur, k).forEach(function (p, i) { ghDot(g, p, k * G.PER + i + 1, 'act-c', R, 'gh-num-me'); });
    if (ghPrev) previewMark(ghSvg, ghPrev, 'act-c', t);
  }
  function renderGhostRail(S, gs) {
    var lite = document.body.classList.contains('lite'), k = S.round, rr = S.rounds[k], src = ghSrc();
    var pl = src === 'round' ? '上一輪' : '上次', h = '';
    var pips = ''; for (var i = 0; i < G.ROUNDS; i++) pips += '<i class="' + (i < k || S.rounds[i].done && i !== k ? 'd' : i === k ? 'on' : '') + '"></i>';
    var prevAll = src === 'round' ? (k > 0 ? S.rounds[k - 1].cur : null) : S.prevAll;
    var tot = S.cur ? S.cur.total : 0, totD = S.cur ? f1(S.cur.totalDec) : '0.0';
    var coll = '<button type="button" class="gh-coll' + (ghOpen ? ' open' : '') + '" id="ghColl" aria-expanded="' + ghOpen + '">' + (ghOpen ?
      '總分 <b>' + tot + '</b>（' + totD + '）<br>發數 <b>' + S.shots + '</b>/60' + (S.prevAll && src === 'prev' ? '<br>上次總分 ' + S.prevAll.total + '（' + S.prevAll.n + ' 發）' : '') :
      '總分・發數<br>（點開）') + '</button>';
    if (lite) {
      h += '<div class="gh-rb"><div class="k">輪次</div><div class="v gh-rv">' + (k + 1) + '<small>/6</small></div><div class="gh-pips">' + pips + '</div></div>';
      h += '<div class="gh-rb"><div class="k">' + pl + '平均</div><div class="v gh-g">' + (prevAll ? f2(prevAll.avg) : '—') + '</div><div class="s">' + (src === 'round' ? '第 ' + k + ' 輪' : prevAll ? prevAll.n + ' 發' : '沒有紀錄') + '</div></div>';
      h += '<div class="gh-rb"><div class="k">目前平均</div><div class="v">' + (S.cur ? f2(S.cur.avg) : '—') + '</div>' + (S.diff != null ? '<div class="s">' + ghDelta(S.diff) + '<br>vs ' + pl + '同期</div>' : '<div class="s">&nbsp;</div>') + '</div>';
      h += '<div class="gh-rb gh-rnd"><div class="k">第 ' + (k + 1) + ' 輪</div><div class="gh-vs"><div><span>' + pl + '</span><b class="gh-g">' + (rr.prevSame ? f2(rr.prevSame.avg) : rr.prev ? f2(rr.prev.avg) : '—') + '</b></div><div><span>這次</span><b>' + (rr.cur ? f2(rr.cur.avg) : '—') + '</b></div></div>' + (rr.diff != null ? ghDelta(rr.diff) : '') + '</div>';
      h += coll;
    } else {
      h += '<div class="gh-cards" data-lay="ghost" data-lay-page="ghost"><div class="gh-rb" data-mod="round" data-mod-name="目前輪次"><div class="k">目前輪次</div><div class="v gh-rv">' + (k + 1) + '<small>/6</small></div><div class="gh-pips">' + pips + '</div></div>' +
        '<div class="gh-rb" data-mod="prev" data-mod-name="上次總平均"><div class="k">' + pl + '總平均</div><div class="v gh-g">' + (prevAll ? f2(prevAll.avg) : '—') + '</div><div class="s">' + (src === 'round' ? '第 ' + k + ' 輪' : prevAll ? prevAll.n + ' 發' : '沒有紀錄') + '</div></div>' +
        '<div class="gh-rb" data-mod="cur" data-mod-name="目前累積平均"><div class="k">目前累積平均</div><div class="v">' + (S.cur ? f2(S.cur.avg) : '—') + '</div><div class="s">' + (S.diff != null ? ghDelta(S.diff) + ' vs ' + pl + '同期 ' + f2(S.prevSame.avg) : '&nbsp;') + '</div></div></div>';
      var tb = '<table class="gh-tb"><tr><th>輪次</th><th>' + pl + '平均</th><th>這次平均</th><th>差</th><th class="gh-barh">對比</th></tr>';
      S.rounds.forEach(function (r) {
        var pv = src === 'round' ? (r.k > 0 ? S.rounds[r.k - 1].cur : null) : r.prev, cv = r.cur;
        var d = cv && r.prevSame ? cv.avg - r.prevSame.avg : null;
        var bw = function (v) { return v ? Math.max(4, Math.min(100, (v.avg - 7) / 3.9 * 100)).toFixed(0) : 0; };
        tb += '<tr class="' + (r.k === k ? 'on' : '') + '"><td>第 ' + (r.k + 1) + ' 輪 <small>' + (r.k * 10 + 1) + '–' + (r.k * 10 + 10) + '</small></td><td class="gh-g">' + (pv ? f2(pv.avg) : '—') + '</td><td>' + (cv ? f2(cv.avg) : '—') + '</td><td>' + (d != null ? ghDelta(d) : '') + '</td>' +
          '<td class="gh-barc"><span class="gh-bar g" style="width:' + bw(pv) + '%"></span><span class="gh-bar m" style="width:' + bw(cv) + '%"></span></td></tr>';
      });
      h += tb + '</table>' + coll;
    }
    $('ghRail').innerHTML = h; if (window.WRLayout) WRLayout.refresh();
    $('ghColl').onclick = function () { ghOpen = !ghOpen; prefs.ghostColl = ghOpen; savePrefs(); renderGhost(); };
  }
  function renderGhostStrip(S, gs) {
    var t = ghT(), k = S.round, cells = G.strip(t, gcur, gs, k), src = ghSrc();
    var h = '<div class="gh-sh"><span>第 ' + (k + 1) + ' 輪・' + (k * 10 + 1) + '–' + (k * 10 + 10) + ' 發</span><span>上排這次・下排' + (src === 'round' ? '上一輪' : '上次') + '</span></div><div class="gh-cells">';
    cells.forEach(function (c) {
      var me = c.me, col = me ? scoreColor(me.dec) : null, isCur = c.n === S.next;
      h += '<div class="gh-cell' + (isCur ? ' cur' : '') + '"><div class="n">' + (c.n + 1) + '</div>' +
        '<div class="me' + (me ? '' : isCur ? ' now' : ' empty') + '"' + (me ? ' style="background:' + col.bg + ';color:' + col.fg + '"' : '') + '>' + (me ? f1(me.dec) : isCur ? '●' : '') + '</div>' +
        '<div class="gs">' + (c.gh ? f1(c.gh.dec) : '—') + '</div></div>';
    });
    $('ghStrip').innerHTML = h + '</div>';
  }
  function renderGhostBig(S, gs) {
    var t = ghT(), n = S.next, box = $('ghBig'), src = ghSrc(), pl = src === 'round' ? '上一輪' : '上次';
    var p = ghPrev, idx = n, lbl;
    if (p) lbl = '第 ' + (n + 1) + ' 發・按住中';
    else {
      var me = G.slots(gcur), last = -1; for (var i = G.TOTAL - 1; i >= 0; i--) if (me[i]) { last = i; break; }
      if (last >= 0) { p = me[last]; idx = last; lbl = '第 ' + (last + 1) + ' 發'; }
    }
    if (!p) {
      box.className = 'gh-big empty';
      box.innerHTML = '<div class="bv">—</div><div class="bk">' + (n != null ? '第 ' + (n + 1) + ' 發：按住靶面看預估分數，放開記錄' : '這一輪 10 發已滿') + '</div>';
      return;
    }
    var s = C.scoreShot(t, p.x, p.y), col = scoreColor(s.dec), gh = G.ghostAt(gs, idx), cmp = '';
    if (gh) {
      var gsx = C.scoreShot(t, gh.x, gh.y), dd = s.dec - gsx.dec;
      cmp = '<div class="cmp">' + pl + '第 ' + (idx + 1) + ' 發 <span class="gv">' + f1(gsx.dec) + '</span><br>差 ' + (dd >= 0 ? '+' : '−') + f1(Math.abs(dd)) + '・' + offsetText(p.x - gh.x, p.y - gh.y) + '</div>';
    } else if (ghOn) cmp = '<div class="cmp">' + (S.hasGhost || src === 'round' ? pl + '沒有第 ' + (idx + 1) + ' 發' : '還沒有可對照的紀錄') + '</div>';
    box.className = 'gh-big' + (ghPrev ? ' live' : '');
    box.style.setProperty('--score', col.bg); box.style.setProperty('--score-hi', col.hi || col.bg); box.style.setProperty('--score-fg', col.fg); box.style.setProperty('--score-lbl', col.lbl);
    box.innerHTML = '<div class="bv">' + f1(s.dec) + '</div><div class="bk">' + lbl + (s.inner ? '・內十' : '') + '<br><small>環數 ' + s.ring + '</small></div>' + cmp;
  }
  function renderGhost() {
    if (!G || !$('ghostView')) return;
    ghEnsure();
    var gs = ghSlots(), t = ghT(), S = G.summary(t, gcur, gs), k = S.round, src = ghSrc(), ref = ghRef(), lite = document.body.classList.contains('lite');
    var V = $('ghostView'); V.dataset.src = src; V.classList.toggle('gh-off', !ghOn);
    renderGhostTarget(gs, S); renderGhostRail(S, gs); renderGhostStrip(S, gs); renderGhostBig(S, gs);
    // 沒有可對照的紀錄：不畫鬼影，只提示（照常可以記錄）
    var empty = $('ghEmpty'), em = '';
    if (src === 'prev' && !ref) em = '<b>還沒有上一次的紀錄</b><span>這次照常記錄；存檔後，下一次就會出現灰色的「上次同一發」。</span>';
    else if (src === 'round' && k === 0) em = '<b>第 1 輪沒有「上一輪」</b><span>完成第 1 輪後，第 2 輪開始會顯示上一輪同一發。</span>';
    empty.innerHTML = em; empty.hidden = !em || !!ghPrev || (S.shots > 0 && src === 'prev');
    var inR = G.roundShots(gcur, k).length, done = !!(gcur.ghost && gcur.ghost.done);
    $('ghHint').innerHTML = done ? '✅ 60 發完成・已存到「紀錄」' : '第 <b>' + (k + 1) + '</b> 輪・' + (S.next != null ? '第 <b>' + (S.next + 1) + '</b> 發（總 ' + S.shots + '/60）・按住靶面、放開記錄' : '本輪 10 發已滿・按「完成第 ' + (k + 1) + ' 輪」');
    $('ghFinishLbl').textContent = done ? '開始新的一組' : k >= G.ROUNDS - 1 ? '完成第 6 輪・存檔' : '完成第 ' + (k + 1) + ' 輪';
    $('ghFinishSub').textContent = done ? '60 發' : inR + '/10';
    $('ghProg').style.transform = 'scaleX(' + (done ? 1 : inR / G.PER).toFixed(2) + ')';
    $('ghFinish').classList.toggle('soft', !done && !inR);
    $('ghUndo').disabled = done || !inR;
    var tg = $('ghToggle'); tg.setAttribute('aria-checked', ghOn ? 'true' : 'false'); tg.classList.toggle('on', ghOn);
    document.querySelectorAll('#ghOpts .gh-seg button').forEach(function (b) { var on = b.dataset.src === src; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    var sel = $('ghRef'), cands = G.candidates(sessions, gcur), hs = '';
    cands.forEach(function (s, i) { hs += '<option value="' + esc(s.id) + '">' + (G.isGhost(s) ? '👻 ' : isAna(s) ? '分析 ' : '預報 ') + esc(recTitle(s)) + '・' + G.countShots(s) + ' 發' + (i === 0 ? '（最新）' : '') + '</option>'; });
    sel.innerHTML = hs || '<option value="">（沒有可對照的紀錄）</option>'; sel.disabled = !cands.length; if (ref) sel.value = ref.id;
    $('ghRefRow').classList.toggle('dim', src !== 'prev');
    $('ghWhole').checked = !!prefs.ghostWhole;
    if (!lite && !$('ghOpts').dataset.touched) $('ghOpts').open = true;
    if (document.activeElement !== $('ghName')) $('ghName').value = gcur.name || '';
    var Code = window.BMCode, rec = LF.toAnalysisRecord(gcur), code = null;
    try { code = rec && Code ? Code.encode(rec) : null; } catch (e) { code = null; }
    $('ghCopyCode').disabled = !code;
    $('ghCodeInfo').textContent = code ? '紀錄碼 ' + code.length + ' 字（' + rec.sheets.length + ' 輪的彈著，每輪＝一張靶紙）' : '';
    ghLayout();
  }
  // Lite 直向：靶面＝寬度扣掉右側 84px 資訊欄，高度不超過可用空間
  function ghLayout() {
    var V = $('ghostView'); if (!V || !V.offsetParent) return;
    var tg = $('ghTg');
    if (!document.body.classList.contains('lite')) { tg.style.width = ''; tg.style.height = ''; return; }
    var W = V.clientWidth, size = Math.floor(Math.max(180, Math.min(W - 84 - 8, window.innerHeight * 0.42)));
    tg.style.width = size + 'px'; tg.style.height = size + 'px';
  }
  window.addEventListener('resize', function () { if (document.body.classList.contains('on-ghost')) ghLayout(); });
  attachZoom(ghSvg, {
    active: function () { return true; },
    view: function () { return ghView; }, clamp: ghClamp, apply: ghApplyView, render: function () { renderGhost(); },
    lift: function () { return liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) {
      ghPrev = { x: r.x, y: -r.y }; previewMark(ghSvg, ghPrev, 'act-c', ghT());
      var S = G.summary(ghT(), gcur, ghSlots()); renderGhostBig(S, ghSlots()); $('ghEmpty').hidden = true;
    },
    up: function (r) {
      var m = { x: r.x, y: -r.y }, half = ghT().cardSize / 2 + 1; ghPrev = null;
      if (Math.abs(m.x) > half || Math.abs(m.y) > half) { renderGhost(); return; }
      if (gcur.ghost && gcur.ghost.done) { toast('60 發已完成。按「開始新的一組」'); renderGhost(); return; }
      var q = G.addShot(gcur, m);
      if (!q) { toast('第 ' + (G.curRound(gcur) + 1) + ' 輪 10 發已滿，按「完成第 ' + (G.curRound(gcur) + 1) + ' 輪」'); renderGhost(); return; }
      ghPersist(); vib(); renderGhost();
    },
    cancel: function () { ghPrev = null; renderGhost(); }
  });
  $('ghFit').onclick = function () { ghResetView(); renderGhost(); };
  $('ghUndo').onclick = function () { if (G.undo(gcur)) { ghPersist(); renderGhost(); } };
  $('ghToggle').onclick = function () { ghOn = !ghOn; prefs.ghostOn = ghOn; savePrefs(); renderGhost(); toast(ghOn ? '鬼影：開' : '鬼影：關'); };
  function ghNew() { var src = ghSrc(); gcur = G.newSession(gcur.targetId); gcur.ghost.src = src; ghView = null; ghPrev = null; store.set(LS_GCUR, gcur.id); renderGhost(); toast('新的一組：第 1 輪開始'); }
  $('ghFinish').onclick = function () {
    if (gcur.ghost && gcur.ghost.done) { ghNew(); return; }
    var k = G.curRound(gcur), inR = G.roundShots(gcur, k).length;
    function go() {
      var r = G.finishRound(gcur); ghPersist(); renderRecords();
      if (r.done) { renderGhost(); toast('60 發完成，已存到「紀錄」'); } else { renderGhost(); toast('第 ' + (r.round + 1) + ' 輪開始'); }
      window.scrollTo(0, 0);
    }
    if (!inR) { toast('這一輪還沒有彈著，先在靶面上點'); return; }
    if (inR < G.PER) ask('第 ' + (k + 1) + ' 輪只有 ' + inR + ' 發，確定完成這一輪？', go); else go();
  };
  document.querySelectorAll('#ghOpts .gh-seg button').forEach(function (b) { b.onclick = function () { gcur.ghost = gcur.ghost || {}; gcur.ghost.src = b.dataset.src; prefs.ghostSrc = b.dataset.src; savePrefs(); if (G.countShots(gcur)) ghPersist(); renderGhost(); }; });
  $('ghRef').onchange = function () { gcur.ghost = gcur.ghost || {}; gcur.ghost.ref = this.value || null; if (G.countShots(gcur)) ghPersist(); renderGhost(); toast('鬼影改用這筆紀錄'); };
  $('ghWhole').onchange = function () { prefs.ghostWhole = this.checked; savePrefs(); renderGhost(); };
  $('ghOpts').addEventListener('toggle', function () { this.dataset.touched = '1'; });
  $('ghName').onchange = function () { gcur.name = this.value.trim().slice(0, 60); if (G.countShots(gcur)) ghPersist(); toast('名稱已存'); };
  $('ghCopyCode').onclick = function () {
    var Code = window.BMCode, rec = LF.toAnalysisRecord(gcur), code = rec && Code && Code.encode(rec);
    if (!code) { toast('還沒有可複製的彈著'); return; }
    copyText(code, '已複製紀錄碼（' + code.length + ' 字）');
  };
  $('ghNew').onclick = function () { if (G.countShots(gcur) && !(gcur.ghost && gcur.ghost.done)) ask('這一組已自動存到「紀錄」。開始新的一組 60 發？', ghNew); else ghNew(); };

  // ---------- Pro / Lite 模式切換（記在 prefs，存不了就只在記憶體） ----------
  function setMode(m, quiet) {
    m = m === 'lite' ? 'lite' : 'pro';
    document.body.classList.toggle('lite', m === 'lite');
    document.querySelectorAll('#modeToggle button').forEach(function (b) { var on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    if (prefs.ui !== m) { prefs.ui = m; savePrefs(); }
    if (typeof nav !== 'undefined' && nav) nav.modeChanged(); // v1.5.0：功能列只在 Pro（Lite 有自己的步驟列）
    if (document.body.classList.contains('on-ghost')) renderGhost();
    if (!quiet) { renderPredict(); liteLayout(); toast(m === 'lite' ? '已切換到 Lite 介面' : '已切換到 Pro 介面'); }
  }
  document.querySelectorAll('#modeToggle button').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
  $('liteThemeSel').onchange = function () { setLiteTheme(this.value); toast('外觀已更換'); };
  document.querySelectorAll('#themeGrid [data-th]').forEach(function (b) { b.onclick = function () { setLiteTheme(b.dataset.th); liteLayout(); toast('主題：' + THEME_NAME[b.dataset.th]); }; });
  // 主題動畫（預設開；系統減少動態效果時一律不動）
  $('fxAnimTg').checked = prefs.fxAnim !== false; if (window.WRFx) WRFx.setEnabled(prefs.fxAnim !== false);
  $('fxAnimTg').onchange = function () { prefs.fxAnim = this.checked; savePrefs(); if (window.WRFx) WRFx.setEnabled(this.checked); toast(this.checked ? '主題動畫：開' : '主題動畫：關'); };
  // Lite 預報頁右下的調色盤按鈕 → 底部單手選單（說明分頁的下拉選單也保留）
  (function () {
    var sh = $('liteThemeSheet'), names = THEME_NAME;
    function close() { sh.hidden = true; document.body.classList.remove('lt-sheet-open'); $('liteThemeBtn').focus({ preventScroll: true }); }
    $('liteThemeBtn').onclick = function () { sh.hidden = false; document.body.classList.add('lt-sheet-open'); var b = sh.querySelector('.on') || sh.querySelector('[data-th]'); if (b) b.focus({ preventScroll: true }); };
    sh.querySelectorAll('[data-th]').forEach(function (b) { b.onclick = function () { setLiteTheme(b.dataset.th); liteLayout(); toast('外觀：' + names[b.dataset.th]); close(); }; });
    sh.querySelector('.lt-sheet-x').onclick = close;
    sh.addEventListener('click', function (e) { if (e.target === sh) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && !sh.hidden) close(); });
  })();
  // Lite 底部「更多」：外觀、紀錄、多張分析、說明與帳號、切到 Pro（Lite 隱藏上方分頁列，都從這裡進）
  (function () {
    var sh = $('liteMoreSheet');
    function close() { sh.hidden = true; }
    $('liteMoreBtn').onclick = function () { sh.hidden = false; var b = sh.querySelector('[data-act]'); if (b) b.focus({ preventScroll: true }); };
    sh.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.act; close();
        if (a === 'theme') $('liteThemeBtn').onclick();
        else if (a === 'pro') { setMode('pro'); showTab('predict'); }
        else { showTab(a); window.scrollTo(0, 0); }
      };
    });
    sh.querySelector('.lt-sheet-x').onclick = close;
    sh.addEventListener('click', function (e) { if (e.target === sh) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && !sh.hidden) close(); });
  })();

  // 選照片：「從檔案選」可以選到任何檔案，先確認是圖片；HEIC（三星「高效率相片」）Chrome 多半無法解碼，給清楚的說明
  function pickIsHeic(f) { return /heic|heif/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || ''); }
  // ---------- v1.7.1 照片判讀共用流程（Pro 分析／對照／Lite 都用這裡） ----------
  // 1) 全圖縮到 2000px 校正；2) 靶紙在照片裡偏小（手機原圖、站遠拍）→ 以黑區為中心從「原圖」裁切放大再校正一次；
  //    全圖找不到黑區時，放寬面積門檻找候選黑區、逐一裁切重試；3) 校正好後用另一種靶種也試一次，
  //    明顯比較吻合（環線內點多很多、黑區內白環也對得上）＝照片的靶種和目前選的不一樣（例：選步槍卻拍手槍靶紙→幾乎找不到彈孔）。
  // P.g／P.chroma／P.gw／P.gh＝目前用的灰階；P.k＝縮放、P.ox／P.oy＝裁切原點（原圖像素）。P.T 一律是「原圖像素 → mm」。
  var VIS_MAX = 2000;
  function visRender(img, sx, sy, sw, sh) {
    var V = window.BMVision, k = Math.min(1, VIS_MAX / Math.max(sw, sh)), cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    var d = ctx.getImageData(0, 0, cw, ch).data; cv.width = cv.height = 1; // 早點放掉畫布記憶體（手機）
    var g = V.grayFromRGBA(d, cw, ch), mn = 255, mx = 0;
    for (var i = 0; i < g.length; i += 97) { if (g[i] < mn) mn = g[i]; if (g[i] > mx) mx = g[i]; }
    if (mx - mn < 4) throw new Error('照片讀不出內容（可能太大，請改用一般解析度拍照）');
    return { g: g, chroma: V.chromaFromRGBA(d, cw, ch), w: cw, h: ch, k: cw / sw, ox: sx, oy: sy };
  }
  function visUse(P, Z) { P.g = Z.g; P.chroma = Z.chroma; P.gw = Z.w; P.gh = Z.h; P.k = Z.k; P.ox = Z.ox; P.oy = Z.oy; P.zoomed = Z.ox !== 0 || Z.oy !== 0 || Z.w !== Math.round(P.w * Z.k); }
  function visFull(P) { if (!P.full) P.full = visRender(P.img, 0, 0, P.w, P.h); return P.full; }
  function visToImg(T, Z) { return C.mapT(T, Z.k, -Z.k * Z.ox, -Z.k * Z.oy); } // 灰階座標的 T → 原圖座標的 T
  function visToG(P) { return C.mapT(P.T, 1 / P.k, P.ox || 0, P.oy || 0); }      // 原圖座標的 T → 目前灰階座標
  function visInl(r) { return r && r.ok ? (r.proj && r.proj.inliers || 0) : 0; }
  function visRings(r) { return r && r.ok && r.rings ? r.rings.length : 0; }
  function visZoom(P, F, cx, cy, R) { // 以全圖灰階上的黑區（中心、半徑）從原圖裁切；回傳 null＝不值得放大
    var half = R / F.k * 3.4, sx = Math.max(0, Math.round(cx / F.k - half)), sy = Math.max(0, Math.round(cy / F.k - half));
    var ex = Math.min(P.w, Math.round(cx / F.k + half)), ey = Math.min(P.h, Math.round(cy / F.k + half)), sw = ex - sx, sh = ey - sy;
    if (sw < 50 || sh < 50) return null;
    if (Math.min(1, VIS_MAX / Math.max(sw, sh)) < F.k * 1.25) return null; // 解析度提升不到 25%：不用放大
    return visRender(P.img, sx, sy, sw, sh);
  }
  function visCalibOne(P, t) { // 回傳 { res, Z }（Z＝校正成功時用的灰階；失敗時是全圖）
    var V = window.BMVision, F = visFull(P), res = V.calibrate(F.g, F.w, F.h, t), best = { res: res, Z: F };
    if (res.ok) {
      var Ti = C.invertAffine(res.T), c0 = C.applyAffine(Ti, 0, 0), R = res.pxPerMm * t.blackDiam / 2;
      var Z = visZoom(P, F, c0.x, c0.y, R);
      if (Z) { var r2 = V.calibrate(Z.g, Z.w, Z.h, t); if (r2.ok && visInl(r2) >= 0.8 * visInl(res)) best = { res: r2, Z: Z }; }
      return best;
    }
    var cands = V.findBlackBlobs(F.g, F.w, F.h, 0.0006).slice(0, 3);
    for (var i = 0; i < cands.length; i++) {
      var Zc = visZoom(P, F, cands[i].cx, cands[i].cy, cands[i].R) || null; if (!Zc) continue;
      var rc = V.calibrate(Zc.g, Zc.w, Zc.h, t);
      if (rc.ok && rc.proj && rc.proj.used) return { res: rc, Z: Zc };
    }
    return best;
  }
  // 自動校正：回傳 { res, Z, tid（實際採用的靶種）, mismatch（照片看起來是哪一種靶；null＝和選的一樣） }
  function visAutoCalib(P, tid) {
    var t = T[tid], a = visCalibOne(P, t), out = { res: a.res, Z: a.Z, tid: tid, mismatch: null, alt: null };
    Object.keys(T).forEach(function (oid) {
      if (oid === tid || out.mismatch) return;
      var o = T[oid], V = window.BMVision, b;
      if (a.res.ok) { var ro = V.calibrate(a.Z.g, a.Z.w, a.Z.h, o); b = { res: ro, Z: a.Z }; if (!ro.ok || visInl(ro) < 1.8 * visInl(a.res)) b = null; }
      if (!a.res.ok || b) { var full = visCalibOne(P, o); if (full.res.ok) b = full; } // 換靶種要重新決定裁切範圍
      if (!b || !b.res.ok) return;
      var ia = visInl(a.res), ib = visInl(b.res);
      if (ib >= 150 && (!a.res.ok || (ib > 1.8 * ia && visRings(b.res) >= Math.max(2, visRings(a.res) + 2)))) { out.mismatch = oid; out.alt = b; }
    });
    return out;
  }
  // 讀進來的照片跑一次「校正＋找彈孔」（mode＝auto 時自動校正；manual 時用使用者點的 P.T）
  // 回傳 { det, mismatch }；失敗時 P.T＝null、P.info.reason 有原因
  function visRun(P, tid, sens, useAlt) {
    var V = window.BMVision, t = T[tid], mism = null;
    if (P.mode === 'auto') {
      var r = P._cal && P._cal.tid === tid ? P._cal : (P._cal = visAutoCalib(P, tid)); mism = r.mismatch;
      if (useAlt && r.mismatch && r.alt) { t = T[r.mismatch]; r = { res: r.alt.res, Z: r.alt.Z }; }
      else if (P._cal) P._cal.alt = null; // 不換靶種就不用留另一種的裁切圖
      P.info = r.res; P.rotDeg = 0; visUse(P, r.Z);
      if (r.res.ok) { P.T = visToImg(r.res.T, r.Z); P.T.rms = r.res.rmsMm; } else P.T = null;
      if (P.zoomed) P.full = null; // 放大裁切成功：全圖灰階先丟掉（手機記憶體），需要時再算
    } else if (!P.g || P.zoomed) visUse(P, visFull(P)); // 手動校正：用全圖
    var det = null;
    if (P.T) { P.Tinv = C.invertAffine(P.T); det = V.detectHoles(P.g, P.gw, P.gh, visToG(P), t, sens, P.chroma); }
    P.mismatch = mism;
    return { det: det, mismatch: mism, tid: useAlt && mism ? mism : tid };
  }
  function pickIsImage(f) { return /^image\//i.test(f.type || '') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name || ''); }
  function pickError(f) {
    if (pickIsHeic(f)) alert('這張照片是 HEIC 格式（三星相機「高效率相片」），瀏覽器無法讀取。\n\n請改用其中一種方式：\n1. 相機 › 設定 › 進階圖片選項 › 關閉「高效率相片」，之後拍的都是 JPG。\n2. 在「相簿」打開這張照片 › 分享 › 選「轉換為 JPG」後儲存，再選那張。');
    else if (!pickIsImage(f)) toast('「' + (f.name || '這個檔案') + '」不是照片');
    else toast('無法讀取這張照片（' + (f.name || '') + '）');
  }

  // 照片上的疊圖：校正可能是透視投影（直接用 SVG matrix 畫不出來），所以把 mm 座標的圓／線逐點換到照片像素再畫
  function projCircle(Ti, r, cx, cy, n) {
    cx = cx || 0; cy = cy || 0; n = n || 120; var d = '';
    for (var i = 0; i <= n; i++) { var an = 2 * Math.PI * i / n, p = C.applyAffine(Ti, cx + r * Math.cos(an), cy + r * Math.sin(an)); d += (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }
    return d + 'Z';
  }
  function projLine(Ti, x1, y1, x2, y2) { var p = C.applyAffine(Ti, x1, y1), q = C.applyAffine(Ti, x2, y2); return 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + 'L' + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }

  // ---------- 對照分頁：照片校正 ----------
  var photo = (function () {
    var V = window.BMVision;
    var img = $('photoImg'), svg = $('photoSvg'), inner = $('photoInner');
    var state = { rotDeg: 0, loaded: false, w: 0, h: 0, zoom: 1, calPts: [], T: null, Tinv: null, mode: 'auto', g: null, gw: 0, gh: 0, k: 1, info: null, det: null, busy: false };
    var stepNames = ['靶心（中心點）', '上緣', '右緣', '下緣', '左緣'];
    function clearCal() { state.rotDeg = 0; state.calPts = []; state.T = null; state.Tinv = null; state.info = null; state.det = null; }
    function reset() { clearCal(); state.mode = 'auto'; img.removeAttribute('src'); state.loaded = false; state.g = null; state.full = null; state._cal = null; state.zoomed = false; draw(); hint(); }
    function ringN() { return +$('calRing').value; }
    function sens() { return +($('sensSel') ? $('sensSel').value : 1); }
    function hint() {
      var h = $('calHint');
      if (state.busy) { h.innerHTML = '分析照片中…'; return; }
      if (!state.loaded) { h.innerHTML = '拍照或選照片後，程式會<b>自動校正並找出彈孔</b>。照片請盡量正對靶紙、整張黑區要入鏡、光線平均。'; return; }
      if (state.mode === 'manual' && state.calPts.length < 5) {
        var i = state.calPts.length;
        h.innerHTML = '手動校正 ' + (i + 1) + '/5：請點 <b>' + (i === 0 ? stepNames[0] : '第 ' + ringN() + ' 環外緣的' + stepNames[i]) + '</b>（可先放大照片）';
        return;
      }
      if (!state.T) { h.innerHTML = '⚠️ 自動校正失敗（' + (state.info && state.info.reason || '原因不明') + '）。請按「手動校正」，或換一張正對、清楚的照片。'; return; }
      var n = cur.actuals.length, p = cur.preds.length;
      var calTxt = state.mode === 'auto' ? '自動校正完成（黑區擬合誤差約 ' + f2(state.info.rmsMm) + 'mm）' : '手動校正完成（誤差約 ' + f2(state.T.rms) + 'mm）';
      var warn = p && n !== p ? '<br>⚠️ <b>偵測到 ' + n + ' 個彈孔，預報有 ' + p + ' 發</b>，數量不同：重疊的彈孔可能被算少，請檢查。' : '';
      h.innerHTML = calTxt + '。綠圈應和照片的靶環對齊，不對就按「手動校正」。紫色虛線應穿過靶紙上下左右的環數數字，歪了就按「轉正」微調' + (state.rotDeg ? '（目前 ' + state.rotDeg + '°）' : '') + '。<br>偵測到 <b>' + n + '</b> 個彈孔' + (p ? '（預報 ' + p + ' 發）' : '') +
        '。<b>點紅圈＝刪除，點空白處＝新增</b>。' + warn;
    }
    function analyze() {
      if (!state.loaded) return;
      state.busy = true; hint();
      setTimeout(function () {
        try {
          state.img = img; // v1.7.1：共用流程（visRun）——放大裁切、靶種檢查
          var r = visRun(state, cur.targetId, sens(), false), det = r.det;
          if (r.mismatch) toast('⚠️ 這張看起來是「' + T[r.mismatch].name + '」靶紙，但目前選的是「' + tgt().name + '」，彈孔的位置和分數會算錯。請先在右上角換靶種。');
          if (state.T) {
            state.det = det;
            cur.actuals = (det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; });
            cur.calib = { mode: state.mode, rms: state.T.rms, at: Date.now() }; persist();
            if (cur.preds.length) $('pairMode').value = 'optimal';
          }
        } catch (e) { state.T = null; state.info = { reason: '分析錯誤：' + e.message }; }
        state.busy = false; renderCompare();
      }, 30);
    }
    function load(file) {
      if (!file) return;
      if (!pickIsImage(file)) { pickError(file); return; }
      var url = URL.createObjectURL(file);
      img.onerror = function () { pickError(file); };
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
        for (var n = 1; n <= 10; n++) el('path', { d: projCircle(Ti, t.ringDiam[n] / 2), fill: 'none', stroke: '#39ff14', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', opacity: 0.75 }, g);
        el('path', { d: projCircle(Ti, t.blackDiam / 2), fill: 'none', stroke: '#00e5ff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }, g);
        var RR = t.ringDiam[1] / 2 + 2; // 上下方向線：應穿過照片上印在正上、正下方的環數數字
        el('path', { d: projLine(Ti, 0, -RR, 0, RR), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
        el('path', { d: projLine(Ti, -RR, 0, RR, 0), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, g);
        var lab = actLabels();
        cur.actuals.forEach(function (a, i) {
          var low = a.conf != null && a.conf < 0.5;
          el('path', { d: projCircle(Ti, t.pellet / 2, a.x, a.y, 24), fill: 'rgba(255,40,40,.25)', stroke: low ? '#ffb300' : '#ff2828', 'stroke-width': 2.5, 'stroke-dasharray': low ? '4 3' : '', 'vector-effect': 'non-scaling-stroke' }, g);
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
          if (!state.T) { toast('校正失敗，請重新點'); state.calPts = []; } else { analyze(); return; }
        }
        draw(); hint(); return;
      }
      if (!state.T) return;
      var m = C.applyAffine(state.T, px, py), t = tgt();
      // 點到既有彈孔 → 刪除；否則新增
      var bi = -1, bd = Infinity;
      cur.actuals.forEach(function (a, i) { var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd) { bd = d; bi = i; } });
      if (bi >= 0 && bd <= t.pellet / 2 * 1.1) { cur.actuals.splice(bi, 1); toast('已刪除一個彈孔'); }
      else { cur.actuals.push({ x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual' }); toast('已新增一個彈孔'); }
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
      cur.actuals = cur.actuals.map(function (p) { return Object.assign({}, p, { x: C.round(c * p.x - s * p.y, 3), y: C.round(s * p.x + c * p.y, 3) }); });
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
    if (pairMode() !== 'optimal') return cur.actuals.map(function (a, i) { return i + 1; });
    var lab = cur.actuals.map(function () { return '?'; });
    C.matchOptimal(cur.preds, cur.actuals).forEach(function (q) { lab[q[1]] = q[0] + 1; });
    return lab;
  }
  function srcMode() { return document.querySelector('input[name=src]:checked').value; }
  function renderCompare() {
    var t = tgt();
    drawTarget(cmpSvg, t, 1); CV.ensure(); CV.clamp(); CV.apply();
    var lines = cmpSvg.querySelector('#lines'), g = cmpSvg.querySelector('#marks');
    var sp = $('showPred').checked, sa = $('showAct').checked;
    var E = +cmpSvg.dataset.extent;
    var cmp = C.comparePredictions(t, cur.preds, cur.actuals, pairMode());
    if (sp && sa) cmp.pairs.forEach(function (q) {
      var p = cur.preds[q.i - 1], a = cur.actuals[q.actIdx];
      el('line', { x1: a.x, y1: -a.y, x2: p.x, y2: -p.y, stroke: '#f5a623', 'stroke-width': Math.max(0.1, E * 0.004) }, lines);
    });
    var lab = actLabels();
    if (sp) cur.preds.forEach(function (p, i) { drawShot(g, cmpSvg, p, i + 1, 'pred-c', t.pellet); });
    if (sa) cur.actuals.forEach(function (p, i) { drawShot(g, cmpSvg, p, lab[i], 'act-c', t.pellet); });
    var h = '';
    if (!cmp.m) h = '<div class="stat wide" data-mod="cmpEmpty" data-mod-name="對照說明"><div class="k">需要同時有預報與實際彈著才能對照</div><div class="s">預報 ' + cur.preds.length + ' 發／實際 ' + cur.actuals.length + ' 發</div></div>';
    else {
      h += stat('已配對', cmp.m + ' 發', (pairMode() === 'optimal' ? '最近配對　' : '依順序　') + (cmp.unpairedPred ? '預報多 ' + cmp.unpairedPred + ' 發未配對' : '') + (cmp.unpairedAct ? '實際多 ' + cmp.unpairedAct + ' 發未配對' : ''), false, 'pairs');
      h += stat('平均預報誤差', f2(cmp.meanErr) + 'mm', '最大：第' + cmp.maxErrShot + '發 ' + f2(cmp.maxErr) + 'mm', false, 'err');
      h += stat('預報系統性偏差', cmp.biasDir === '置中' ? '無明顯偏向' : '預報' + cmp.biasDir, '你的預報相對實際：' + offsetText(cmp.biasX, cmp.biasY), false, 'bias');
      h += stat('環數判斷正確率', Math.round(cmp.sameRingRate * 100) + '%', '平均小數分差 ' + f2(cmp.meanAbsDecDiff), false, 'ringRate');
    }
    $('cmpSummary').innerHTML = h;
    var st = C.computeStats(t, cur.actuals);
    renderStats($('actStats'), t, st);
    var tb = '';
    if (cmp.m) {
      tb = '<table><tr><th>預報#</th><th>預報</th><th>實際</th><th>差距</th><th>預報相對實際</th></tr>';
      cmp.pairs.forEach(function (q) { tb += '<tr><td>' + q.i + '</td><td>' + q.pred.ring + '（' + f1(q.pred.dec) + '）</td><td>' + q.act.ring + '（' + f1(q.act.dec) + '）</td><td>' + f2(q.err) + 'mm</td><td>' + C.directionText(q.dx, q.dy, C.ringWidth(t) * 0.2) + '</td></tr>'; });
      tb += '</table>';
    }
    $('cmpList').innerHTML = tb + (st.n ? '<p><b>實際彈著明細</b></p>' + shotTable(st.shots) : '');
    $('photoPane').style.display = srcMode() === 'photo' ? '' : 'none';
    $('cmpReadout').innerHTML = (srcMode() === 'vector' ? '在下方靶面點實際彈著（紅）。' : '藍＝預報，紅＝實際，橘線＝配對。') +
      (pairMode() === 'optimal' ? '配對：照片看不出射擊順序，程式用「總距離最短」把預報和彈孔一一配對；紅點數字＝配到的預報編號（?＝沒配到）。' : '配對：依射擊順序（第1發對第1發）。');
    photo.draw(); photo.hint();
  }
  var CV = mkView(cmpSvg, $('cmpFit')), cmpPrev = null;
  attachZoom(cmpSvg, {
    active: function () { return true; },
    view: function () { CV.ensure(); return CV.v; }, clamp: CV.clamp, apply: CV.apply, render: function () { renderCompare(); },
    lift: function () { return liftPx(); },
    down: function (r) { this.move(r); },
    move: function (r) {
      if (srcMode() !== 'vector') return;
      cmpPrev = { x: r.x, y: -r.y }; previewMark(cmpSvg, cmpPrev, 'act-c', tgt());
      var s = C.scoreShot(tgt(), cmpPrev.x, cmpPrev.y); $('cmpReadout').innerHTML = '第 ' + (cur.actuals.length + 1) + ' 發實際：<b>' + s.ring + '（' + f1(s.dec) + '）</b>';
    },
    up: function (r) {
      cmpPrev = null; if (srcMode() !== 'vector') return;
      var p = { x: r.x, y: -r.y }; if (!inCard(p)) { renderCompare(); return; }
      cur.actuals.push({ x: C.round(p.x, 3), y: C.round(p.y, 3), src: 'vector' }); persist(); renderCompare();
    },
    cancel: function () { if (cmpPrev) { cmpPrev = null; renderCompare(); } }
  });
  $('cmpFit').onclick = function () { CV.reset(); renderCompare(); };
  document.querySelectorAll('input[name=src]').forEach(function (r) { r.onchange = renderCompare; });
  $('pairMode').onchange = function () { cur.pairMode = this.value; persist(); renderCompare(); };
  $('showPred').onchange = renderCompare; $('showAct').onchange = renderCompare;
  $('undoAct').onclick = function () { if (cur.actuals.length) { cur.actuals.pop(); persist(); renderCompare(); } };
  $('clearAct').onclick = function () { if (cur.actuals.length) ask('清除全部 ' + cur.actuals.length + ' 發實際彈著？', function () { cur.actuals = []; persist(); renderCompare(); }); };

  // ---------- 分析分頁（純分析：連續拍多張靶紙 → 自動校正＋找彈孔 → 統計） ----------
  var LS_ACUR = 'bm_acur_v1';
  var SHEET_COLORS = ['#1e6fd9', '#e8590c', '#2b8a3e', '#ae3ec9', '#c2255c', '#0c8599', '#5c940d', '#795548'];
  var acur = (function () { var id = store.get(LS_ACUR); return sessions.filter(function (s) { return s.id === id && isAna(s); })[0] || newAnalysis(); })();
  var anaSel = 'all', anaPhotos = {}, anaQueue = [], anaBusy = false;
  var anaSvg = $('anaSvg');
  function atgt() { return T[acur.targetId] || T.ap10; }
  function requestPersist() {
    if (requestPersist.done) return;
    requestPersist.done = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  }
  function persistA() {
    if (!acur.sheets.length && !acur.name) return false;
    acur.updated = new Date().toISOString();
    var i = sessions.findIndex(function (s) { return s.id === acur.id; });
    if (i < 0) sessions.unshift(acur); else sessions[i] = acur;
    saveSessions(sessions); store.set(LS_ACUR, acur.id);
    requestPersist();
    $('anaSaved').textContent = storageOK ? '✓ 已自動存' : '⚠ 此畫面無法存檔';
    return true;
  }
  function selSheet() { return anaSel === 'all' ? null : acur.sheets.filter(function (x) { return x.id === anaSel; })[0] || null; }
  function sheetNo(sh) { return acur.sheets.indexOf(sh) + 1; }
  function isUnsure(q) { return q.src === 'auto' && q.conf != null && q.conf < 0.5; }
  // --- 照片處理（每張照片的影像只留在記憶體，不存檔） ---
  function anaCalRing() { return +$('anaCalRing').value; }
  function fillAnaCalRing() {
    var t = atgt(), sel = $('anaCalRing'); sel.innerHTML = '';
    for (var n = 1; n <= 9; n++) { var o = document.createElement('option'); o.value = n; o.textContent = n + ' 環（外徑 ' + t.ringDiam[n] + 'mm）' + (t.ringDiam[n] === t.blackDiam ? '＝黑區邊緣' : ''); sel.appendChild(o); }
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
          var from = acur.targetId; acur.targetId = r.tid; AV.reset(); fillAnaCalRing(); if (curTab === 'analysis') syncTargetSel(); P.mismatch = null;
          autoSw = { sh: sh, from: from, to: r.tid };
        } else mism = r.mismatch;
        if (P.T) {
          sh.shots = (r.det && r.det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; });
          sh.calib = { mode: P.mode, rms: C.round(P.T.rms, 3), rotDeg: P.rotDeg || 0, at: new Date().toISOString() };
        } else sh.calib = { mode: 'failed', reason: P.info && P.info.reason || '', at: new Date().toISOString() };
      } catch (e) { P.T = null; P.info = { reason: '分析錯誤：' + e.message }; }
      P.busy = false; persistA(); renderAnalysis();
      if (autoSw) { var A = autoSw; toastAct('已依照片切換為' + T[A.to].name, '復原', function () { anaUndoAutoSwitch(A); }); }
      if (mism && !P._mismAsked && !anaMismOpen) { P._mismAsked = true; anaAskMismatch(sh, mism); }
      if (done) done();
    }, 30);
  }
  // 這次分析已經有別張、這張的靶種卻不一樣：問要不要把這張移到新的分析（用照片的靶種）
  // 自動換靶種的「復原」：換回原本選的靶種，用它重新分析這張（之後不再自動換，提示改成警告）
  function anaUndoAutoSwitch(A) {
    var P = anaPhotos[A.sh.id]; if (!P || acur.sheets.indexOf(A.sh) < 0 || acur.targetId !== A.to) return;
    acur.targetId = A.from; P.noAuto = true; P._mismAsked = true; AV.reset(); fillAnaCalRing(); if (curTab === 'analysis') syncTargetSel();
    anaProcess(A.sh); toast('已改回' + T[A.from].name);
  }
  var anaMismOpen = false;
  function anaAskMismatch(sh, mid) {
    anaMismOpen = true;
    ask('這張照片看起來是「' + T[mid].name + '」靶紙，但這次分析用的是「' + atgt().name + '」，彈孔的位置和分數會算錯，也可能抓不到。要把這張移到新的「' + T[mid].name + '」分析嗎？（目前這次保留在「紀錄」）', function () {
      anaMismOpen = false;
      var P = anaPhotos[sh.id], i = acur.sheets.indexOf(sh); if (!P || i < 0) return;
      acur.sheets.splice(i, 1); persistA();
      acur = newAnalysis(mid); anaPhotos = {}; anaPhotos[sh.id] = P; sh.shots = []; acur.sheets.push(sh); anaSel = sh.id; anaView = 'target';
      P.mode = 'auto'; P.calPts = []; P.mismatch = null; AV.reset(); store.set(LS_ACUR, acur.id); fillAnaCalRing(); if (curTab === 'analysis') syncTargetSel();
      anaProcess(sh); toast('已移到新的「' + T[mid].name + '」分析');
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
    im.onerror = function () { pickError(file); if (done) done(); };
    im.src = url;
  }
  function anaEnqueue(files) {
    for (var i = 0; i < files.length; i++) { if (pickIsImage(files[i])) anaQueue.push(files[i]); else pickError(files[i]); }
    if (!anaBusy) anaNext();
  }
  function anaNext() {
    var f = anaQueue.shift(); anaBusy = !!f; $('anaQueue').textContent = anaQueue.length ? '排隊中 ' + anaQueue.length + ' 張' : '';
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
    if (P.busy) { h.innerHTML = '分析照片中…'; return; }
    if (P.mode === 'manual' && P.calPts.length < 5) {
      var i = P.calPts.length, nm = ['靶心（中心點）', '上緣', '右緣', '下緣', '左緣'];
      h.innerHTML = '手動校正 ' + (i + 1) + '/5：請點 <b>' + (i === 0 ? nm[0] : '第 ' + anaCalRing() + ' 環外緣的' + nm[i]) + '</b>'; return;
    }
    if (!P.T) { h.innerHTML = '⚠️ 自動校正失敗（' + (P.info && P.info.reason || '原因不明') + '）。請按「手動校正」，或重拍一張正對、清楚的照片。'; return; }
    var un = sh.shots.filter(isUnsure).length;
    var mw = P.mismatch && T[P.mismatch] ? '<b style="color:#c62828">⚠️ 這張看起來是「' + T[P.mismatch].name + '」靶紙，和這次分析的「' + atgt().name + '」不一樣，彈孔的位置和分數會算錯，也可能抓不到。</b>請按右上角換靶種（會開新的分析）後重新選這張。<br>' : '';
    h.innerHTML = mw + '第 ' + sheetNo(sh) + ' 張：偵測到 <b>' + sh.shots.length + '</b> 個彈孔' + (un ? '，其中 <b style="color:#b26a00">' + un + ' 個不確定</b>（橘色虛線＋「?」）' : '') +
      '。<b>點紅圈＝刪除，點空白處＝新增</b>（下方靶面也可以直接點）。綠圈要對齊靶環，紫線要穿過環數數字，歪了按「轉正」。' +
      '（校正誤差約 ' + f2(P.T.rms || 0) + 'mm' + (P.rotDeg ? '，已轉 ' + P.rotDeg + '°' : '') + '）';
  }
  function anaToggleHole(sh, m) { // 一指點選：點到既有彈孔＝刪除，空白處＝新增
    var t = atgt(), bi = -1, bd = Infinity;
    sh.shots.forEach(function (a, i) { var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && bd <= t.pellet / 2 * 1.1) { var rm = sh.shots.splice(bi, 1)[0]; sh._undo = { op: 'del', q: rm, i: bi }; toast('已刪除一個彈孔'); }
    else { var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual' }; sh.shots.push(q); sh._undo = { op: 'add', q: q }; toast('已新增一個彈孔'); }
    persistA(); renderAnalysis();
  }
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
    var zoomed = z > 1.05; fb.classList.toggle('zoomed', zoomed); sp.textContent = zoomed ? (Math.round(z * 10) / 10) + '×・全靶' : '雙指縮放';
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
      if (P.calPts.length === 5) { P.T = C.fitAffine(P.calPts); if (!P.T) { toast('校正失敗，請重新點'); P.calPts = []; } else { P.rotDeg = 0; anaProcess(sh); return; } }
      renderAnalysis(); return;
    }
    if (!P.T) return;
    anaToggleHole(sh, C.applyAffine(P.T, px, py));
  });
  // --- 檢視切換：靶面｜照片（照片只在選了單張、且這次有拍照時可用；合併時停用） ---
  var anaView = 'target';
  function anaSetView(v) {
    var sh = selSheet(), P = sh && anaPhotos[sh.id];
    if (v === 'photo' && !P) { toast(sh ? '這張的照片沒有留存（照片只在本次開啟時保留），只能用靶面修改' : '合併檢視沒有照片；先在下方選一張'); v = 'target'; }
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
    $('anaDelSub').textContent = sh ? '第 ' + sheetNo(sh) + ' 張・' + sh.shots.length + ' 發' : '先在下方選一張';
    $('anaAllSub').textContent = acur.sheets.length ? '這次分析 ' + acur.sheets.length + ' 張・' + tot + ' 發' : '目前沒有紀錄';
    ['anaAutoCal', 'anaManual'].forEach(function (k) { $(k).disabled = !P || P.busy; });
    ['anaRedetect', 'anaRotL', 'anaRotR'].forEach(function (k) { $(k).disabled = !P || !P.T || P.busy; });
    $('anaCalNote').textContent = !sh ? '要先在下方選一張照片' : !P ? '這張的照片沒有留存，只能在靶面上點選修改' : P.T ? '綠圈要對齊靶環；歪了用轉正±1°' : '自動校正失敗：請按「手動校正」';
  }
  $('anaCalBtn').onclick = function (e) { e.stopPropagation(); anaPop('anaCalPop', anaPopOpen !== 'anaCalPop'); };
  $('anaClearBtn').onclick = function (e) { e.stopPropagation(); anaPop('anaClearPop', anaPopOpen !== 'anaClearPop'); };
  document.addEventListener('pointerdown', function (e) { if (anaPopOpen && !e.target.closest('.ana-pop,#anaCalBtn,#anaClearBtn')) anaPop(null, false); if (!$('anaPickHint').hidden && !e.target.closest('#anaPickHint,#anaPickInfo')) anaPickHint(false); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (anaPopOpen) anaPop(null, false); anaPickHint(false); } });
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
    persistA(); renderAnalysis(); toast('已轉 ' + P.rotDeg + '°');
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
    move: function (r) { if (!selSheet()) return; anaPrev = { x: r.x, y: -r.y }; previewMark(anaSvg, anaPrev, 'act-c', atgt()); },
    up: function (r) {
      anaPrev = null; anaPrevClear();
      var sh = selSheet(); if (!sh) { toast(acur.sheets.length ? '先在下方選一張靶紙，再點靶面修改' : '先按「拍下一張」或從相簿選照片'); return; }
      var p = { x: r.x, y: -r.y }, half = atgt().cardSize / 2 + 1; if (Math.abs(p.x) > half || Math.abs(p.y) > half) return;
      anaToggleHole(sh, p);
    },
    cancel: function () { anaPrev = null; anaPrevClear(); }
  });
  $('anaFit').onclick = function () { if (anaView === 'photo' && selSheet() && anaPhotos[selSheet().id]) { anaPZ.s = 1; anaPZApply(); } else { AV.reset(); renderAnalysis(); } };
  function anaTg(btn, cb) { btn.onclick = function () { cb.checked = !cb.checked; btn.classList.toggle('on', cb.checked); btn.setAttribute('aria-checked', cb.checked ? 'true' : 'false'); renderAnalysis(); }; }
  anaTg($('anaTgCenter'), $('anaShowCenter')); anaTg($('anaTgOut'), $('anaShowOut'));
  $('anaUndo').onclick = function () {
    var sh = selSheet(); if (!sh || !sh._undo) { toast(sh ? '這張沒有可復原的修改' : '先在下方選一張，才能復原它的修改'); return; }
    var u = sh._undo; if (u.op === 'add') { var i = sh.shots.indexOf(u.q); if (i >= 0) sh.shots.splice(i, 1); } else sh.shots.splice(Math.min(u.i, sh.shots.length), 0, u.q);
    sh._undo = null; persistA(); renderAnalysis(); toast('已復原');
  };
  $('anaDelSheet').onclick = function () {
    var sh = selSheet(); anaPop(null, false); if (!sh) return;
    ask('清除這張紀錄：第 ' + sheetNo(sh) + ' 張（' + sh.shots.length + ' 發）？', function () {
      acur.sheets = acur.sheets.filter(function (x) { return x !== sh; }); delete anaPhotos[sh.id]; anaSel = 'all'; anaSaveOrDrop(); renderAnalysis(); toast('已清除這張紀錄');
    });
  };
  // v1.6.0 清除所有紀錄：清掉這次分析的全部照片與每張紀錄（名稱、日期保留；沒有名稱就從「紀錄」移除這筆空分析）
  $('anaClearAll').onclick = function () {
    anaPop(null, false); if (!acur.sheets.length) return;
    ask('清除所有紀錄：這次分析的全部 ' + acur.sheets.length + ' 張照片、' + anaShots(acur).length + ' 發？\n清除後無法復原（其他分析不受影響）。', function () {
      Object.keys(anaPhotos).forEach(function (k) { try { URL.revokeObjectURL(anaPhotos[k].url); } catch (e) {} });
      acur.sheets = []; anaPhotos = {}; anaSel = 'all'; anaView = 'target'; anaSaveOrDrop(); renderAnalysis(); toast('已清除這次分析的所有紀錄');
    });
  };
  function anaSaveOrDrop() { // 還有資料（或有名稱）就存；變成空的未命名分析就從紀錄移除
    if (persistA()) return;
    var n = sessions.length; sessions = sessions.filter(function (x) { return x.id !== acur.id; });
    if (sessions.length !== n) saveSessions(sessions);
    store.set(LS_ACUR, acur.id);
  }
  $('anaName').oninput = function () { acur.name = this.value; persistA(); };
  function anaStartNew(tid, msg) { acur = newAnalysis(tid || acur.targetId); anaPhotos = {}; anaSel = 'all'; anaView = 'target'; AV.reset(); store.set(LS_ACUR, acur.id); fillAnaCalRing(); renderAnalysis(); if (curTab === 'analysis') syncTargetSel(); toast(msg || '已開始新的分析'); }
  $('anaNew').onclick = function () {
    if (acur.sheets.length) ask('目前的分析已存在「紀錄」。開始新的分析？', function () { anaStartNew(); }); else anaStartNew();
  };
  // 換靶種：v1.6.0 起分析頁沒有自己的選單，改用右上角共用的靶種選單（見 tsel.onchange；在分析分頁時改的是分析的靶種）
  function anaChangeTarget(id, revert) {
    if (id === acur.targetId) return;
    if (acur.sheets.length) ask('換成「' + T[id].name + '」會開始新的分析（目前這次保留在「紀錄」）。繼續？', function () { anaStartNew(id, '已換成' + T[id].name + '，開始新的分析'); }, revert);
    else { acur.targetId = id; AV.reset(); fillAnaCalRing(); renderAnalysis(); }
  }
  // --- 小圖表（SVG） ---
  function trTag(tr, upGood, extra) { // 趨勢標籤：好轉綠、變差紅、持平灰
    var cls = tr.dir === '持平' || tr.dir === '資料不足' ? 'tr-flat' : ((tr.dir === '上升') === upGood ? 'tr-good' : 'tr-bad');
    return '<b class="' + cls + '">' + tr.dir + (extra || '') + '</b>';
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
    var bw = (W - L - R) / n, s = '<svg class="ana-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="小數分分布">';
    bins.slice().reverse().forEach(function (b, i) { // 左低右高
      var h = b.n / mx * (H - Tp - B), x = L + i * bw, y = H - B - h, ten = b.lo >= 10;
      s += '<rect x="' + (x + 1.5) + '" y="' + y + '" width="' + (bw - 3) + '" height="' + Math.max(h, b.n ? 1 : 0) + '" rx="2" class="' + (ten ? 'b10' : 'blo') + '"/>';
      if (b.n) s += '<text x="' + (x + bw / 2) + '" y="' + (y - 3) + '" text-anchor="middle" class="vl">' + b.n + '</text>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (H - 9) + '" text-anchor="middle" class="ax hx">' + esc(b.label.replace('10.', '.')) + '</text>';
    });
    return s + '<text x="' + (W - R) + '" y="10" text-anchor="end" class="ax">10.x 以「.0–.9」表示</text></svg>';
  }
  // --- 繪製 ---
  function anaShotSet() { // 目前檢視的彈著與來源（第幾張）
    var sh = selSheet(), out = [];
    if (sh) sh.shots.forEach(function (q, i) { out.push({ q: q, sheet: sheetNo(sh), i: i + 1, color: SHEET_COLORS[(sheetNo(sh) - 1) % SHEET_COLORS.length] }); });
    else acur.sheets.forEach(function (s2, k) { s2.shots.forEach(function (q, i) { out.push({ q: q, sheet: k + 1, i: i + 1, color: SHEET_COLORS[k % SHEET_COLORS.length] }); }); });
    return out;
  }
  function anaExtraHTML(t, st, set, single) {
    var h = '', card = function (title, body, cls, id) { return '<div class="ana-card ' + (cls || '') + '" data-mod="' + id + '" data-mod-name="' + esc(title.replace(/^\S+\s/, '')) + '"><div class="ana-ct">' + title + '</div>' + body + '</div>'; };
    if (!st.n) return '';
    // 3 校正建議
    var a = st.advice;
    h += card('🎯 校正建議', '<div class="ana-big">' + (a.centered ? '置中' : a.offsetDir + ' ' + f1(a.dist) + 'mm') + '</div><div>' + esc(a.text) + '</div>' +
      '<div class="s">群中心＝' + (a.excluded ? '排除 ' + a.excluded + ' 發離群後的' : '') + '平均落點；小於 ' + f2(a.threshold) + 'mm 的偏差視為置中。只提供方向與 mm，各槍款每格調整量日後再加入。</div>', 'adv', 'adv');
    // 6 穩定度
    h += card('📏 穩定度', '<div class="ana-2"><div><div class="k">標準差（小數分）</div><div class="v">' + f2(st.sdDec) + '</div><div class="s">整數分 ' + f2(st.sdRing) + '</div></div>' +
      '<div><div class="k">去掉最差一發的平均</div><div class="v">' + f2(st.avgDecExWorst) + '</div><div class="s">整數 ' + f2(st.avgExWorst) + (st.worstIdx >= 0 ? '；最差：' + (set[st.worstIdx].sheet && !single ? '第' + set[st.worstIdx].sheet + '張' : '') + '#' + set[st.worstIdx].i + ' ' + f1(st.shots[st.worstIdx].dec) : '') + '</div></div></div>', '', 'stab');
    // 7 離群發
    var o = st.outliers;
    var ol = o.idx.map(function (i) { return '<li>' + (single ? '' : '第' + set[i].sheet + '張 ') + '#' + set[i].i + '：' + st.shots[i].ring + '（' + f1(st.shots[i].dec) + '），距群中心 ' + f1(o.radii[i]) + 'mm</li>'; }).join('');
    h += card('⚠️ 離群發', (o.threshold == null ? '<div>少於 ' + C.OUTLIER_RULE.minN + ' 發，不判定。</div>' : '<div class="ana-big">' + o.idx.length + ' 發</div>' + (ol ? '<ul class="ana-ol">' + ol + '</ul>' : '<div>沒有明顯離群的一發。</div>')) +
      '<div class="s">判定：到群中心（座標中位數）的距離 &gt; 門檻' + (o.threshold != null ? ' ' + f1(o.threshold) + 'mm' : '') + '。門檻取「中位距離＋3×1.4826×MAD」「2×中位距離」「半個環寬」三者最大。靶面上以紅色虛線圈標示，虛線大圓為門檻。</div>', 'out', 'out');
    // 5 趨勢
    var tb = '';
    if (!single && acur.sheets.length >= 2) {
      var sv = acur.sheets.filter(function (x) { return x.shots.length; }).map(function (x) { return C.computeStats(t, x.shots).avgDec; });
      var tr = C.trend(sv);
      tb += '<div class="k">每張平均（小數分）　趨勢：' + trTag(tr, true, tr.dir === '上升' || tr.dir === '下降' ? ' ' + (tr.change > 0 ? '+' : '') + f2(tr.change) : '') + '</div>' + lineChart(sv, sv.map(function (_, i) { return '第' + (i + 1) + '張'; }), { trend: true, title: '每張平均' });
    }
    if (st.per10.length >= 2) {
      var pv = st.per10.map(function (x) { return x.avgDec; });
      tb += '<div class="k">每10發平均（小數分）　趨勢：' + trTag(st.trend10, true) + '</div>' + lineChart(pv, st.per10.map(function (x) { return x.from + '–' + x.to; }), { trend: true, title: '每10發平均' });
    }
    h += card('📈 趨勢', tb || '<div>需要 2 張以上，或 20 發以上，才看得出趨勢。</div>', 'trend', 'trend');
    // 8 小數分分布
    h += card('📊 小數分分布', histChart(st.hist) + '<div class="s">10 環內每 0.1 一格；照片看不出射擊順序，每10發的分組依「張次＋偵測順序」。</div>', 'hist', 'hist');
    return h;
  }
  function anaInfo(t, sh, st) { // 左上資訊框：第N張 總分(小數) X發／合併 N 張・M 發・平均
    var box = $('anaInfo'), all = C.computeStats(t, anaShots(acur)), n = acur.sheets.length, h;
    box.classList.toggle('empty', !n);
    if (!n) h = '<div class="r1"><span class="n">分析</span><span class="s">—</span></div><div class="r2">拍下第一張開始</div>';
    else if (sh) {
      var s1 = C.computeStats(t, sh.shots), busy = anaPhotos[sh.id] && anaPhotos[sh.id].busy;
      h = '<div class="r1"><span class="n">第' + sheetNo(sh) + '張</span><span class="s">' + (busy ? '…' : s1.total) + '</span>' + (busy ? '' : '<span class="d">(' + f1(s1.totalDec) + ')</span>') + '<span class="x">' + sh.shots.length + '發</span></div>' +
        '<div class="r2">合併 ' + n + ' 張・' + all.n + ' 發・平均 ' + (all.n ? f2(all.avgDec) : '—') + '</div>';
    } else h = '<div class="r1"><span class="n">合併</span><span class="s">' + all.total + '</span><span class="d">(' + f1(all.totalDec) + ')</span><span class="x">' + all.n + '發</span></div>' +
      '<div class="r2">' + n + ' 張・平均 ' + (all.n ? f2(all.avgDec) : '—') + (all.n > 1 ? '・群 ' + f1(all.groupSize) + 'mm' : '') + '</div>';
    box.innerHTML = h;
  }
  function anaChipsHTML(t) {
    var ch = '', n = acur.sheets.length;
    if (n) ch += '<button type="button" role="tab" class="ana-chip all' + (anaSel === 'all' ? ' on' : '') + '" data-id="all" aria-selected="' + (anaSel === 'all') + '"><svg class="nv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5"/></svg><span class="cl"><b>合併 ' + n + ' 張</b><small>' + anaShots(acur).length + ' 發</small></span></button>';
    acur.sheets.forEach(function (x, k) {
      var un = x.shots.filter(isUnsure).length, bad = x.calib && x.calib.mode === 'failed', busy = anaPhotos[x.id] && anaPhotos[x.id].busy, on = anaSel === x.id;
      var s1 = busy ? null : C.computeStats(t, x.shots);
      ch += '<button type="button" role="tab" class="ana-chip' + (on ? ' on' : '') + '" data-id="' + x.id + '" aria-selected="' + on + '" style="--sc:' + SHEET_COLORS[k % SHEET_COLORS.length] + '"><i class="cb">' + (k + 1) + '</i><span class="cl"><b>第' + (k + 1) + '張 ' + (busy ? '…' : x.shots.length + '發') + '</b><small>' + (busy ? '分析中' : bad ? '校正失敗' : s1.total + '（' + f1(s1.totalDec) + '）') + '</small></span>' + (un ? '<em title="不確定">?' + un + '</em>' : '') + (bad ? '<em>!</em>' : '') + '</button>';
    });
    ch += '<button type="button" class="ana-chip add" data-id="add" aria-label="加入照片（相簿，可多選）"><svg class="nv-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>';
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
    if (!acur.sheets.length) $('anaSaved').textContent = storageOK ? '拍第一張後自動存' : '⚠ 此畫面無法存檔';
    else if (storageOK) $('anaSaved').textContent = '✓ 已自動存';
    // 檢視切換
    $('anaViewSeg').querySelectorAll('button').forEach(function (b) { var on = b.dataset.v === anaView; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); if (b.dataset.v === 'photo') { b.disabled = !P; b.title = P ? '' : (sh ? '這張的照片沒有留存' : '合併檢視沒有照片'); } });
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
    anaInfo(t, sh, st); anaFitLabel();
    $('anaUndo').disabled = !(sh && sh._undo); $('anaClearBtn').disabled = !acur.sheets.length; $('anaCalBtn').disabled = !acur.sheets.length;
    if (anaPopOpen) anaPopSync();
    anaSensSync();
    $('anaReadout').classList.toggle('sr', !!acur.sheets.length);
    $('anaReadout').innerHTML = !acur.sheets.length ? '按下方「拍下一張」拍靶紙，拍完一張再拍下一張，每張發數不限；也可以從「相簿」一次選多張。' :
      sh ? '第 ' + sheetNo(sh) + ' 張：' + sh.shots.length + ' 發。點靶面：點到彈孔＝刪除、空白＝新增。綠十字＝群中心。' :
      '合併 ' + acur.sheets.length + ' 張共 ' + st.n + ' 發（顏色／數字＝第幾張）。綠十字＝群中心，紅虛線圈＝離群發。';
    $('anaStatsTitle').textContent = sh ? '第 ' + sheetNo(sh) + ' 張數據' : (acur.sheets.length > 1 ? '合併 ' + acur.sheets.length + ' 張數據' : '數據');
    renderStats($('anaStats'), t, st);
    $('anaExtra').innerHTML = anaExtraHTML(t, st, set, !!sh);
    // 每張小計
    var tb = '';
    if (acur.sheets.length) {
      tb = '<table class="ana-st"><tr><th>張</th><th>發數</th><th>總分</th><th>小數</th><th>平均</th><th>群大小</th><th>不確定</th></tr>';
      acur.sheets.forEach(function (x, k) {
        var s2 = C.computeStats(t, x.shots), un = x.shots.filter(isUnsure).length;
        tb += '<tr data-id="' + x.id + '"' + (anaSel === x.id ? ' class="on"' : '') + '><td><i class="dot" style="background:' + SHEET_COLORS[k % SHEET_COLORS.length] + '"></i>' + (k + 1) + '</td><td>' + s2.n + '</td><td>' + s2.total + '</td><td>' + f1(s2.totalDec) + '</td><td>' + (s2.n ? f2(s2.avgDec) : '—') + '</td><td>' + (s2.n > 1 ? f1(s2.groupSize) + 'mm' : '—') + '</td><td>' + (un ? '<b style="color:#b26a00">' + un + '</b>' : (x.calib && x.calib.mode === 'failed' ? '校正失敗' : '0')) + '</td></tr>';
      });
      var all = C.computeStats(t, anaShots(acur));
      tb += '<tr class="sum"><td>合計</td><td>' + all.n + '</td><td>' + all.total + '</td><td>' + f1(all.totalDec) + '</td><td>' + (all.n ? f2(all.avgDec) : '—') + '</td><td>' + (all.n > 1 ? f1(all.groupSize) + 'mm' : '—') + '</td><td></td></tr></table>';
    }
    $('anaSheetTable').innerHTML = tb;
    $('anaSheetTable').querySelectorAll('tr[data-id]').forEach(function (r) { r.onclick = function () { anaSel = r.dataset.id; renderAnalysis(); }; });
    $('anaList').innerHTML = shotTable(st.shots);
    updateAnaCodeInfo();
  }
  fillAnaCalRing();

  // ---------- 分析紀錄碼 ----------
  function anaShotCount(s) {
    var n = 0, i;
    for (i = 0; i < ((s && s.sheets) || []).length; i++) n += (s.sheets[i].shots || []).length;
    return n;
  }
  function anaRecords() {
    return sessions.filter(function (s) { return isAna(s) && anaShotCount(s); }).sort(function (a, b) { return Date.parse(a.created) - Date.parse(b.created); });
  }
  function copyText(text, okMsg) {
    function done() { toast(okMsg); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('複製失敗，請改用分享或手動選取'); }
      ta.remove();
    }
  }
  function updateAnaCodeInfo() {
    var info = $('anaCodeInfo'), Code = window.BMCode, n = anaShotCount(acur), code = null;
    if (!$('anaShareCode').dataset.ready) {
      $('anaShareCode').dataset.ready = '1';
      if (navigator.share) $('anaShareCode').hidden = false;
    }
    $('anaCopyCode').disabled = !n;
    $('anaShareCode').disabled = !n;
    var all = anaRecords();
    $('anaCopyAllCodes').disabled = !all.length;
    if (!Code) { info.textContent = ''; return; }
    if (n) { try { code = Code.encode(acur); } catch (e) { code = null; } }
    if (code && all.length > 1) info.textContent = '本筆 ' + code.length + ' 字　·　已存 ' + all.length + ' 筆分析可一併複製';
    else if (code) info.textContent = '本筆 ' + code.length + ' 字';
    else if (all.length) info.textContent = '已存 ' + all.length + ' 筆分析紀錄，可複製全部或貼上還原';
    else info.textContent = '分析完成後可複製紀錄碼，下次貼上就能還原（不包含照片）';
  }
  $('anaCopyCode').onclick = function () {
    var Code = window.BMCode, code = Code && Code.encode(acur);
    if (!code) { toast('目前沒有可複製的分析'); return; }
    copyText(code, '已複製本筆紀錄碼（' + code.length + ' 字）');
  };
  $('anaShareCode').onclick = function () {
    var Code = window.BMCode, code = Code && Code.encode(acur);
    if (!code) { toast('目前沒有可分享的分析'); return; }
    try { navigator.share({ title: 'WRbeta 紀錄碼', text: code }); } catch (e) { copyText(code, '已複製本筆紀錄碼（' + code.length + ' 字）'); }
  };
  $('anaCopyAllCodes').onclick = function () {
    var Code = window.BMCode, list = anaRecords(), code = Code && Code.encodeMany(list);
    if (!code) { toast('目前沒有可複製的分析紀錄'); return; }
    copyText(code, '已複製 ' + list.length + ' 筆分析紀錄碼（' + code.length + ' 字）');
  };
  function showPasteBox(on) {
    $('anaPasteBox').hidden = !on;
    if (on) { $('anaPasteArea').value = ''; setTimeout(function () { $('anaPasteArea').focus(); }, 0); }
  }
  $('anaPasteCode').onclick = function () { showPasteBox(true); };
  $('anaPasteCancel').onclick = function () { showPasteBox(false); };
  $('anaPasteGo').onclick = function () {
    var added = restoreCodes($('anaPasteArea').value), ana;
    if (!added) return;
    ana = added.filter(isAna);
    if (ana.length) {
      acur = ana[ana.length - 1];
      anaPhotos = {}; anaSel = 'all';
      store.set(LS_ACUR, acur.id);
    }
    showPasteBox(false);
    renderAnalysis(); renderRecords();
  };
  /* v1.8.0：貼上紀錄碼還原（分析頁與紀錄頁共用）；分析、預報、鬼影都可以，重複的略過。回傳新增的紀錄（失敗＝null） */
  function restoreCodes(text) {
    var Code = window.BMCode, r, i, added, now = new Date().toISOString();
    if (!Code) { toast('無法還原'); return null; }
    if (!stripWait(text)) { toast('請先貼上紀錄碼'); return null; }
    r = Code.merge(sessions, text);
    if (!r.added.length && !r.skipped && !r.invalid) { toast('沒有讀到紀錄碼'); return null; }
    added = r.added.slice().sort(function (a, b) { return Date.parse(a.created) - Date.parse(b.created); });
    for (i = 0; i < added.length; i++) { delete added[i].hash; added[i].updated = now; sessions.unshift(added[i]); } // updated＝現在：登入雲端時會上傳
    if (added.length) { saveSessions(sessions); requestPersist(); }
    toast((added.length ? '還原 ' + added.length + ' 筆' : '沒有新增') + (r.skipped ? '，略過 ' + r.skipped + ' 筆重複' : '') + (r.invalid ? '，' + r.invalid + ' 筆無效' : ''), 3200);
    return added;
  }
  function stripWait(text) { return String(text || '').replace(/\s+/g, ''); }

  // ---------- 紀錄 ----------
  var recPick = {}; // 勾選要比較的紀錄 id
  function recShots(s) { // 比較用的彈著：分析＝全部張；預報＝有實際彈著用實際，否則用預報
    if (isAna(s)) return { shots: anaShots(s), src: '分析' };
    if (s.actuals && s.actuals.length) return { shots: s.actuals, src: '實際' };
    return { shots: s.preds || [], src: '預報' };
  }
  function recCode(s) { var Code = window.BMCode; if (!Code) return null; try { return Code.encode(s); } catch (e) { return null; } }
  function recAllCodes() { var s = '', n = 0; sessions.forEach(function (x) { var c = recCode(x); if (c) { s += c; n++; } }); return { code: s, n: n }; }
  function updateRecCodeInfo() {
    var a = recAllCodes(), info = $('recCodeInfo'); if (!info) return;
    $('recCopyAll').disabled = !a.n; $('recShareAll').disabled = !a.n;
    info.textContent = a.n ? '共 ' + a.n + ' 筆・' + a.code.length + ' 字（座標 0.01mm＋預報點＋靶種）' : '每一發相對靶心的座標（0.01mm）＋預報點＋靶種';
  }
  if (navigator.share) $('recShareAll').hidden = false;
  $('recCopyAll').onclick = function () { var a = recAllCodes(); if (!a.n) { toast('目前沒有可複製的紀錄'); return; } copyText(a.code, '已複製 ' + a.n + ' 筆紀錄碼（' + a.code.length + ' 字）'); };
  $('recShareAll').onclick = function () { var a = recAllCodes(); if (!a.n) { toast('目前沒有可分享的紀錄'); return; } try { navigator.share({ title: 'WRbeta 紀錄碼', text: a.code }); } catch (e) { copyText(a.code, '已複製 ' + a.n + ' 筆紀錄碼'); } };
  function showRecPaste(on) { $('recPasteBox').hidden = !on; if (on) { $('recPasteArea').value = ''; setTimeout(function () { $('recPasteArea').focus(); }, 0); } }
  $('recPaste').onclick = function () { showRecPaste($('recPasteBox').hidden); };
  $('recPasteCancel').onclick = function () { showRecPaste(false); };
  $('recPasteGo').onclick = function () { var added = restoreCodes($('recPasteArea').value); if (!added) return; showRecPaste(false); renderAll(); };
  /* v2.0.0：好友分享的唯讀檢視（member.js）：把一筆紀錄畫在 ISSF 靶面上（分析＝全部彈孔；預報＝實際彈著＋預報點） */
  function drawRecord(svg, s) {
    var t = T[s.targetId] || T.ap10; drawTarget(svg, t, 1);
    var g = svg.querySelector('#marks'), pel = t.pellet, shots = isAna(s) ? anaShots(s) : (s.actuals || []);
    if (!isAna(s)) (s.preds || []).forEach(function (p, i) { drawShot(g, svg, p, i + 1, 'pred-c', pel); });
    shots.forEach(function (p, i) { drawShot(g, svg, p, i + 1, 'act-c', pel); });
  }
  function recMetaHTML(s) {
    var t = T[s.targetId] || T.ap10, rs = recShots(s), st = C.analyzeShots(t, rs.shots), h = '<div class="pf-stats">';
    var box = function (k, v, u) { return '<div class="pf-st"><small>' + k + '</small><b>' + v + (u ? '<i>' + u + '</i>' : '') + '</b></div>'; };
    h += box('靶種', esc(t.name)) + box('發數', st.n, '發');
    if (st.n) h += box('總分', st.total + '<i>（' + f1(st.totalDec) + '）</i>') + box('平均', f2(st.avgDec)) + (st.n > 1 ? box('群大小', f1(st.groupSize), 'mm') : '');
    if (!isAna(s) && s.preds && s.preds.length && s.actuals && s.actuals.length) { var cmp = C.comparePredictions(t, s.preds, s.actuals, s.pairMode || 'optimal'); if (cmp.m) h += box('平均預報誤差', f2(cmp.meanErr), 'mm'); }
    return h + '</div><div class="lbl">' + (isAna(s) ? '分析・' + (s.sheets || []).length + ' 張' : G.isGhost(s) ? '鬼影訓練' : '預報（藍＝預報點、紅＝實際）') + '・資料：' + rs.src + '</div>';
  }
  function recTitle(s) { return (s.name && s.name.trim()) || (isAna(s) ? '分析' : '預報') + ' ' + fmtTW(s.created).replace(/^\d{4}\//, ''); }
  function renderRecords() {
    var box = $('recordList');
    Object.keys(recPick).forEach(function (id) { if (!sessions.some(function (x) { return x.id === id; })) delete recPick[id]; });
    updateCmpBtn(); updateRecCodeInfo();
    if (!sessions.length) { box.innerHTML = '<div class="card">尚無紀錄</div>'; return; }
    box.innerHTML = '';
    sessions.forEach(function (s) {
      var t = T[s.targetId] || T.ap10, ana = isAna(s), gho = G.isGhost(s), isCur = ana ? s.id === acur.id : gho ? !!(gcur && s.id === gcur.id) : s.id === cur.id;
      var div = document.createElement('div'); div.className = 'rec' + (isCur ? ' cur' : '') + (ana ? ' ana' : ''); div.dataset.id = s.id;
      var meta = '';
      if (ana) {
        var as = C.analyzeShots(t, anaShots(s));
        meta = (s.sheets || []).length + ' 張・' + as.n + ' 發' + (as.n ? '｜總分 ' + as.total + '（' + f1(as.totalDec) + '）｜平均 ' + f2(as.avgDec) + (as.n > 1 ? '｜群 ' + f1(as.groupSize) + 'mm' : '') : '');
      } else if (gho) {
        var gsS = C.computeStats(t, s.actuals), gr = G.curRound(s) + 1;
        meta = '60 發訓練・' + (s.ghost && s.ghost.done ? '完成' : '第 ' + gr + ' 輪') + '｜' + gsS.n + ' 發' + (gsS.n ? '｜總分 ' + gsS.total + '（' + f1(gsS.totalDec) + '）｜平均 ' + f2(gsS.avgDec) : '');
      } else {
        var ps = C.computeStats(t, s.preds), xs = C.computeStats(t, s.actuals), cmp = C.comparePredictions(t, s.preds, s.actuals, s.pairMode || 'optimal');
        meta = '預報 ' + ps.n + ' 發 ' + (ps.n ? ps.total + '（' + f1(ps.totalDec) + '）' : '') + '｜實際 ' + xs.n + ' 發 ' + (xs.n ? xs.total + '（' + f1(xs.totalDec) + '）' : '') + (cmp.m ? '｜平均預報誤差 ' + f2(cmp.meanErr) + 'mm' : '');
      }
      div.innerHTML = '<label class="rec-pick" title="勾選比較"><input type="checkbox" class="rec-chk"' + (recPick[s.id] ? ' checked' : '') + '></label>' +
        '<div class="meta"><span class="badge ' + (ana ? 'b-ana' : gho ? 'b-gh' : 'b-fc') + '">' + (ana ? '分析' : gho ? '👻 鬼影' : '預報') + '</span> <b>' + esc(fmtTW(s.created)) + '</b>　' + t.name + (isCur ? '（目前）' : '') + '<br>' + meta + '</div>';
      div.querySelector('.rec-chk').onchange = function () { if (this.checked) recPick[s.id] = 1; else delete recPick[s.id]; updateCmpBtn(); };
      var name = document.createElement('input'); name.className = 'rec-name'; name.placeholder = '自訂名稱'; name.value = s.name != null && s.name !== '' ? s.name : (s.note || ''); name.setAttribute('aria-label', '紀錄名稱');
      name.onchange = function () { s.name = name.value.trim(); s.updated = new Date().toISOString(); if (!ana) s.note = s.note || ''; if (ana && s.id === acur.id) acur.name = s.name; saveSessions(sessions); renderRecords(); toast('名稱已更新'); };
      var open = document.createElement('button'); open.textContent = '開啟';
      open.onclick = function () {
        if (ana) { acur = s; anaPhotos = {}; anaSel = 'all'; store.set(LS_ACUR, s.id); fillAnaCalRing(); renderAnalysis(); showTab('analysis'); }
        else if (gho) { gcur = s; ghView = null; ghPrev = null; store.set(LS_GCUR, s.id); showTab('ghost'); window.scrollTo(0, 0); }
        else { cur = s; store.set(LS_CUR, s.id); $('targetSel').value = s.targetId; photo.reset(); renderAll(); showTab('predict'); }
      };
      var del = document.createElement('button'); del.textContent = '刪除'; del.className = 'warn';
      del.onclick = function () {
        ask('刪除「' + recTitle(s) + '」？', function () {
          sessions = sessions.filter(function (x) { return x.id !== s.id; }); delete recPick[s.id];
          try { if (window.WRCloud && window.WRCloud.remove) window.WRCloud.remove(s.id); } catch (e) {}
          if (ana && s.id === acur.id) { acur = newAnalysis(acur.targetId); anaPhotos = {}; anaSel = 'all'; }
          if (gho && gcur && s.id === gcur.id) { gcur = null; ghView = null; }
          if (!ana && !gho && s.id === cur.id) { cur = sessions.filter(function (x) { return !isAna(x) && !G.isGhost(x); })[0] || newSession(); if (sessions.indexOf(cur) < 0) sessions.push(cur); }
          persist(); renderAll();
        });
      };
      var r = document.createElement('div'); r.className = 'row'; r.appendChild(name); r.appendChild(open); r.appendChild(del);
      div.appendChild(r);
      // v2.0.0：分享給好友（唯讀）；登入並建立會員資料後才出現
      var WM = window.WRMember;
      if (WM && WM.canShare() && recCode(s)) {
        var sr = document.createElement('div'); sr.className = 'rec-share';
        var sh = WM.sharesOf(s.id), nTo = 0; sh.forEach(function (x) { nTo += (x.to || []).length; });
        var sb = document.createElement('button'); sb.type = 'button'; sb.className = 'rc-share'; sb.innerHTML = '<svg class="nv-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.6"/><circle cx="17.5" cy="6" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="M8.3 10.8l6.9-3.6M8.3 13.2l6.9 3.6"/></svg>分享給好友';
        sb.onclick = function () { WM.shareRecord(s); };
        sr.appendChild(sb);
        if (nTo) { var si = document.createElement('span'); si.className = 'rc-shared'; si.textContent = '已分享給 ' + nTo + ' 位'; sr.appendChild(si); }
        div.appendChild(sr);
      }
      // v1.8.0：每筆紀錄都顯示自己的紀錄碼（座標系統 A），可以單獨複製
      var code = recCode(s), cl = document.createElement('div'); cl.className = 'rec-code';
      if (code) {
        cl.innerHTML = '<code>' + esc(code.slice(0, 22)) + '…</code><span class="rc-len">' + code.length + ' 字</span>';
        var cb = document.createElement('button'); cb.type = 'button'; cb.className = 'rc-copy'; cb.textContent = '複製紀錄碼';
        cb.onclick = function () { copyText(code, '已複製「' + recTitle(s) + '」的紀錄碼（' + code.length + ' 字）'); };
        cl.appendChild(cb);
      } else cl.innerHTML = '<span class="lbl">還沒有落點，沒有紀錄碼</span>';
      div.appendChild(cl); box.appendChild(div);
    });
  }
  function updateCmpBtn() {
    var n = Object.keys(recPick).length;
    $('recCmpBtn').disabled = n < 2; $('recCmpBtn').textContent = n ? '比較勾選的 ' + n + ' 筆' : '比較勾選的紀錄';
    $('recCmpInfo').textContent = n < 2 ? '勾選 2 筆以上紀錄（分析或預報）即可比較' : '';
  }
  $('recCmpClear').onclick = function () { recPick = {}; $('recCompare').innerHTML = ''; renderRecords(); };
  $('recCmpBtn').onclick = function () { renderRecCompare(); var c = $('recCompare'); if (c.scrollIntoView) c.scrollIntoView({ block: 'start' }); };
  function renderRecCompare() {
    var list = sessions.filter(function (s) { return recPick[s.id]; }).sort(function (a, b) { return a.created < b.created ? -1 : 1; });
    if (list.length < 2) { $('recCompare').innerHTML = ''; return; }
    var rows = list.map(function (s) { var t = T[s.targetId] || T.ap10, rs = recShots(s); return { s: s, t: t, src: rs.src, st: C.analyzeShots(t, rs.shots) }; });
    var mixed = rows.some(function (r) { return r.t.id !== rows[0].t.id; });
    var best = function (vals, hiGood) { var v = vals.filter(function (x) { return x != null; }); if (v.length < 2) return null; return hiGood ? Math.max.apply(null, v) : Math.min.apply(null, v); };
    var M = [
      ['類型／資料', function (r) { return (isAna(r.s) ? '分析' : '預報') + '（' + r.src + '）'; }],
      ['靶種', function (r) { return r.t.short; }],
      ['發數', function (r) { return r.st.n; }],
      ['平均（小數）', function (r) { return r.st.n ? f2(r.st.avgDec) : '—'; }, function (r) { return r.st.n ? r.st.avgDec : null; }, true],
      ['平均（整數）', function (r) { return r.st.n ? f2(r.st.avg) : '—'; }, function (r) { return r.st.n ? r.st.avg : null; }, true],
      ['60發預估', function (r) { return r.st.n ? r.st.proj60 + '<small>（' + f1(r.st.proj60Dec) + '）</small>' : '—'; }, function (r) { return r.st.n ? r.st.proj60Dec : null; }, true],
      ['內十數（比例）', function (r) { return r.st.n ? r.st.inner + '<small>（' + Math.round(r.st.inner / r.st.n * 100) + '%）</small>' : '—'; }, function (r) { return r.st.n ? r.st.inner / r.st.n : null; }, true],
      ['10環比例', function (r) { return r.st.n ? Math.round(r.st.counts[10] / r.st.n * 100) + '%' : '—'; }, function (r) { return r.st.n ? r.st.counts[10] / r.st.n : null; }, true],
      ['彈著群大小', function (r) { return r.st.n > 1 ? f1(r.st.groupSize) + 'mm' : '—'; }, function (r) { return r.st.n > 1 ? r.st.groupSize : null; }, false],
      ['平均偏移', function (r) { return r.st.n ? r.st.direction + '<small>（' + f1(Math.hypot(r.st.meanX, r.st.meanY)) + 'mm）</small>' : '—'; }, function (r) { return r.st.n ? Math.hypot(r.st.meanX, r.st.meanY) : null; }, false],
      ['距靶心平均', function (r) { return r.st.n ? f1(r.st.meanR) + 'mm' : '—'; }, function (r) { return r.st.n ? r.st.meanR : null; }, false],
      ['標準差（小數）', function (r) { return r.st.n > 1 ? f2(r.st.sdDec) : '—'; }, function (r) { return r.st.n > 1 ? r.st.sdDec : null; }, false],
      ['去最差一發平均', function (r) { return r.st.n > 1 ? f2(r.st.avgDecExWorst) : '—'; }, function (r) { return r.st.n > 1 ? r.st.avgDecExWorst : null; }, true],
      ['離群發', function (r) { return r.st.outliers.threshold == null ? '—' : r.st.outliers.idx.length; }],
      ['7 分以下', function (r) { return r.st.counts.below7; }]
    ];
    var h = '<div class="card rec-cmp"><div class="rec-cmp-h"><b>紀錄比較（' + list.length + ' 筆，依日期）</b><button id="recCmpClose" type="button">關閉</button></div>' +
      (mixed ? '<div class="hint">⚠️ 勾選的紀錄靶種不同，分數可比，mm 數值（群大小、偏移）不能直接比較。</div>' : '') +
      '<div class="rec-cmp-scroll"><table class="rec-cmp-t"><tr><th></th>' + rows.map(function (r) { return '<th><div class="rc-name">' + esc(recTitle(r.s)) + '</div><div class="rc-date">' + esc(fmtTW(r.s.created)) + '</div></th>'; }).join('') + '</tr>';
    M.forEach(function (m) {
      var vals = m[2] ? rows.map(m[2]) : null, b = vals ? best(vals, m[3]) : null;
      h += '<tr><th>' + m[0] + '</th>' + rows.map(function (r, i) { var good = b != null && vals[i] != null && Math.abs(vals[i] - b) < 1e-9; return '<td' + (good ? ' class="best"' : '') + '>' + m[1](r) + '</td>'; }).join('') + '</tr>';
    });
    h += '</table></div><div class="s">綠底＝這一列表現最好的紀錄。分析紀錄用全部靶紙；預報紀錄有實際彈著時用實際，否則用預報落點。</div>';
    var lab = rows.map(function (r) { var d = fmtTW(r.s.created); return d.slice(5, 10); });
    var avg = rows.map(function (r) { return r.st.avgDec; }), grp = rows.map(function (r) { return r.st.groupSize; }), sd = rows.map(function (r) { return r.st.sdDec; });
    var tr = C.trend(avg);
    h += '<div class="ana-card"><div class="ana-ct">📈 跨日期趨勢：平均（小數）' + trTag(tr, true) + '</div>' + lineChart(avg, lab, { trend: true, title: '平均趨勢' }) + '</div>';
    h += '<div class="ana-card"><div class="ana-ct">彈著群大小（mm，越小越好）' + trTag(C.trend(grp, 1), false) + '</div>' + lineChart(grp, lab, { trend: true, dp: 0, minSpan: 4, color: '#e8590c', title: '群大小趨勢' }) + '</div>';
    h += '<div class="ana-card"><div class="ana-ct">標準差（越小越穩）' + trTag(C.trend(sd, 0.05), false) + '</div>' + lineChart(sd, lab, { dp: 2, minSpan: 0.2, color: '#2b8a3e', title: '標準差' }) + '</div></div>';
    $('recCompare').innerHTML = h;
    $('recCmpClose').onclick = function () { $('recCompare').innerHTML = ''; };
  }
  $('exportAll').onclick = function () {
    var blob = new Blob([JSON.stringify({ app: 'WRbeta', appVersion: APP_VERSION, version: SCHEMA_V, schema: 'sessions[]: kind=forecast|analysis，座標 mm（靶心原點，x 右 y 上），時間 ISO-8601 UTC', exported: new Date().toISOString(), sessions: sessions }, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '靶面預報紀錄_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
  };
  $('importFile').onchange = function () {
    var f = this.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () {
      try { var data = JSON.parse(rd.result); var add = (data.sessions || []).filter(function (s) { return s.id && T[s.targetId] && (isAna(s) ? Array.isArray(s.sheets) : Array.isArray(s.preds)) && !sessions.some(function (x) { return x.id === s.id; }); });
        add.forEach(function (s) { if (!isAna(s)) { s.actuals = s.actuals || []; } if (!s.updated) s.updated = new Date().toISOString(); });
        sessions = sessions.concat(add); saveSessions(sessions); renderRecords(); toast('匯入 ' + add.length + ' 組'); } catch (e) { toast('檔案格式錯誤'); }
    };
    rd.readAsText(f); this.value = '';
  };

  // ---------- 說明 ----------
  function renderAbout() {
    var rows = function (t) { var h = ''; for (var n = 10; n >= 1; n--) h += '<tr><td>' + n + '</td><td>' + t.ringDiam[n] + '</td><td>' + f2(t.ringDiam[n] / 2 + t.pellet / 2) + '</td></tr>'; return h; };
    $('aboutText').innerHTML =
      '<p class="appver"><b>' + APP_NAME + '</b> 版本 ' + APP_LABEL + '（' + APP_VERSION + '）・<a href="#" class="wr-priv-link">隱私權政策</a></p>' +
      '<h3>怎麼用</h3><ol><li>上方選靶種。</li>' +
      '<li><b>切換功能</b>（Pro）：預設是畫面下方的<b>圖示列</b>（預報·對照、分析、紀錄、鬼影、設定/說明），閒置 3 秒會淡出；在靶面以外輕輕一滑（或從畫面最下方往上滑）就會出現。也可以在「設定」子標籤的「介面設定」改成 <b>B 浮動按鈕</b>（右下角圓鈕）或 <b>C 左右滑動</b>（在靶面以外左右滑）。</li>' +
      '<li><b>設定/說明</b>：上方分成「設定」與「說明」兩個子標籤，會記住你上次看的那一個。用 C 左右滑動時，在這一頁左右滑會先換子標籤；已經在「設定」再往右滑，才會回到「鬼影」。</li>' +
      '<li><b>分析頁的拍照按鈕</b>（相簿／拍下一張／檔案）：閒置 3 秒會滑到螢幕邊緣收起來，只留一顆會眨眼的小圓。點小圓、或從小圓往畫面裡滑，按鈕就會出來（滑出來的位置跟著手指）。按住任一顆按鈕拖到（或甩到）左、右、上、下任何一邊，就會改收在那一邊；按鈕組左下角的「⌂」小鈕回到預設位置。不想自動收起可在「設定 › 介面設定」關掉。</li>' +
      '<li><b>預報·對照</b>：每打一發，在靶面點你感覺的落點。按住可拖曳微調，放開才記錄；兩指縮放（右上角按一下回到全靶）。左上角顯示最新一發的分數，右下角是「新的一組／清除本組／復原」。打完往下捲就是<b>對照</b>。</li>' +
      '<li><b>對照</b>（在預報下面）：拉回靶紙後拍照，程式會<b>自動找黑區校正、自動找彈孔</b>。綠圈要對齊靶環；紫色虛線要穿過上下左右的環數數字，歪了按「轉正」。找錯的彈孔點一下刪除，漏掉的點空白處新增。自動失敗時可按「手動校正」（點靶心＋某環上右下左）。電子靶也可以改選「直接在靶面上點」。</li>' +
      '<li><b>分析</b>：不需要預報。一張打完拍一張（發數不限），程式自動校正、找彈孔並算出每張與合併數據：校正建議（群中心偏移 mm 與修正方向）、穩定度（標準差、去掉最差一發的平均）、離群發、趨勢圖、小數分分布。不確定的彈孔以橘色虛線＋「?」標示，點一下就能刪除，漏掉的點空白處新增（照片或下方靶面都可以點）。分析自動存到「紀錄」，可自訂名稱。可用「複製紀錄碼」把彈孔座標壓成一串只有本 App 讀得懂的字，貼到備忘錄或 LINE 備份，下次「貼上還原」就能畫回靶面（不含照片）。</li>' +
      '<li><b>鬼影模式</b>（Pro 功能列的「鬼影」；Lite 在「更多 → 👻 鬼影模式」）：60 發＝6 輪 × 10 發，按住靶面看預估分數、放開記錄。灰色孔＝上一次訓練的同一發，虛線圈＝下一發；右側比較上次與這次的平均。來源可改成「本次上一輪」，也可以挑別筆紀錄。存成一般紀錄，紀錄碼照常可用。</li>' +
      '<li><b>按壓十字線</b>：手指按住任何按鈕、資訊方塊或清單時，按的位置會出現十字線（跟預報同款），放開就消失；不影響點擊與捲動。</li>' +
      '<li><b>紀錄比較</b>：在「紀錄」勾選 2 筆以上（分析或預報），按「比較」看平均、群大小、偏移、標準差、內十數與跨日期趨勢。</li>' +
      '<li>照片看不出射擊順序，所以預設用「最近配對」（總距離最短的一對一配對）；直接在靶面依序點時可改成「依射擊順序」。程式會算出每發預報差距、平均誤差與預報的系統性偏向。</li><li><b>紀錄</b>：每組自動存在這台裝置，可匯出備份。</li></ol>' +
      '<h3>靶面尺寸（外徑，mm）</h3><p>來源：ISSF Rule Book 2026 Edition 2025（Third Print 10/2026，2026-10-19 生效）。畫面是依這些尺寸以向量繪製。</p>' +
      '<table><tr><th colspan="3">10米空氣手槍（6.3.4.6）</th></tr><tr><th>環</th><th>外徑</th><th>計分臨界（中心距）</th></tr>' + rows(T.ap10) +
      '</table><p>內十 5.0mm；黑區 7–10 環 = 59.5mm；數字 1–8。</p>' +
      '<table><tr><th colspan="3">10米空氣步槍（6.3.4.3）</th></tr><tr><th>環</th><th>外徑</th><th>計分臨界（中心距）</th></tr>' + rows(T.ar10) +
      '</table><p>10 環為 0.5mm 白點；黑區 4–9 環 = 30.5mm；內十＝10 環白點被完全打掉；數字 1–8。</p>' +
      '<h3>計分方式</h3><p>彈孔直徑以 4.5mm 計（空氣槍口徑，7.4.6／8.4.3.5）。彈孔只要碰到較高環的外緣就算較高分，所以「彈孔中心距 ≤ 環外半徑 + 2.25mm」即得該環分數。' +
      '小數分依 6.3.3.1 把每一環平均分成十等分：小數分 = 10 + (10環臨界 − 中心距) ÷ 環寬（手槍 8mm、步槍 2.5mm），無條件捨去到 0.1，最高 10.9。' +
      '內十：手槍＝彈孔觸及 5.0mm 內十圈（中心距 ≤ 4.75mm）；步槍＝0.5mm 白點完全在彈孔內（中心距 ≤ 2.0mm）。以上是理想幾何換算，正式判分以裁判量規與電子靶為準。</p>' +
      '<h3>測試版限制</h3><ul><li>自動找彈孔：重疊很多的彈孔群可能算少或算多，請對照預報發數檢查。黑區外（白紙上）的彈孔對比較低，比較容易漏。</li><li>照片旋轉角無法自動判斷，預設照片的上方就是靶紙上方；歪了請用「轉正」。</li><li>校正用橢圓＋仿射換算，拍得太斜（透視變形）靶心會偏約 0.5–1mm，請盡量正對拍攝。</li><li>照片不保存，只保存換算後的座標。</li></ul>';
  }

  // ---------- 共用 ----------
  function ask(msg, onYes, onNo, o) { // o（v1.8.0）：{ yes:'按鈕文字', danger:true＝紅色按鈕 }
    o = o || {};
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal' + (o.danger ? ' danger' : '') + '"><p></p><div class="row"><button class="no">取消</button><button class="primary yes">確定</button></div></div>';
    bg.querySelector('p').textContent = msg;
    if (o.yes) bg.querySelector('.yes').textContent = o.yes;
    bg.querySelector('.no').onclick = function () { bg.remove(); if (onNo) onNo(); };
    bg.querySelector('.yes').onclick = function () { bg.remove(); onYes(); };
    document.body.appendChild(bg);
  }
  function toast(msg, ms) { var t = $('toast'); t.textContent = msg; t.classList.remove('act'); t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || (String(msg).length > 24 ? 2800 : 1800)); }
  // v1.7.1：帶一顆按鈕的提示（例：「復原」）；6 秒後消失
  function toastAct(msg, label, fn) {
    toast(msg, 6000); var t = $('toast'), b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = label;
    b.onclick = function (e) { e.stopPropagation(); t.classList.remove('show', 'act'); clearTimeout(toast._t); fn(); };
    t.appendChild(document.createTextNode(' ')); t.appendChild(b); t.classList.add('act');
  }
  // showTab：v1.5.0 起「預報」與「對照」合併成「預報·對照」（Pro 在預報下面直接接對照）；showTab('compare') 仍可用＝回到預報·對照並捲到對照區
  var curTab = 'predict'; // 啟動時先畫預報（Lite 用），Pro 初始化完成後切到「分析」（v1.8.0）
  function showTab(name) {
    var toCmp = name === 'compare'; if (toCmp) name = 'predict';
    if (!$('tab-' + name)) name = 'predict';
    curTab = name;
    document.querySelectorAll('#wrNav button[data-tab]').forEach(function (b) { var on = b.dataset.tab === name; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('.tab').forEach(function (s) { s.classList.toggle('active', s.id === 'tab-' + name); });
    if (name === 'records') renderRecords();
    if (name === 'analysis') renderAnalysis();
    if (name === 'about' && stSub && stSub.cur === 'acct') { try { renderAcct(); } catch (e) {} }
    try { syncTargetSel(); } catch (e) {}
    document.body.classList.toggle('on-predict', name === 'predict');
    document.body.classList.toggle('on-ghost', name === 'ghost');
    document.body.classList.toggle('on-analysis', name === 'analysis');
    if (name !== 'ghost') { try { ghPrev = null; } catch (e) {} }
    if (name === 'ghost') renderGhost();
    if (window.WRDock) { if (name === 'analysis') WRDock.shown(); else WRDock.left(); }
    document.querySelectorAll('#liteMoreSheet [data-act]').forEach(function (b) { b.classList.toggle('on', b.dataset.act === name); });
    if (document.body.classList.contains('lite')) renderLite();
    if (name === 'predict') liteLayout();
    if (name === 'ghost') ghLayout();
    if (nav) nav.sync(name);
    if (toCmp && !document.body.classList.contains('lite')) { var hc = $('cmpHead'); if (hc && hc.scrollIntoView) hc.scrollIntoView({ block: 'start' }); }
  }

  // ---------- v1.7.0「設定/說明」子標籤：設定｜說明（記住上次看的；樣式跟主題，切換方式跟 A/B/C） ----------
  // A／B／Lite：點標籤切換（A 底線分頁、B 膠囊）；C：點標籤或在頁面上左右滑（標籤下有小圓點），規則見 nav 的 tEnd。
  var ST_SUBS = ['set', 'acct', 'help']; // v1.8.0：中間多了「帳號」
  var stSub = (function () {
    var S = $('tab-about'), P = $('stPanes'), cur = ST_SUBS.indexOf(prefs.aboutSub) >= 0 ? prefs.aboutSub : 'set', anim = 0;
    function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function set(name, o) {
      o = o || {}; if (ST_SUBS.indexOf(name) < 0) name = 'set';
      var old = cur; cur = name; S.setAttribute('data-sub', name);
      document.querySelectorAll('#stTabs [data-sub]').forEach(function (b) { var on = b.dataset.sub === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      document.querySelectorAll('#tab-about .st-dots i').forEach(function (d) { d.classList.toggle('on', d.dataset.sub === name); });
      $('stPaneSet').hidden = name !== 'set'; $('stPaneAcct').hidden = name !== 'acct'; $('stPaneHelp').hidden = name !== 'help';
      if (name === 'acct' && old !== name) { try { renderAcct(); } catch (e) {} }
      if (prefs.aboutSub !== name) { prefs.aboutSub = name; savePrefs(); }
      if (old !== name && o.dir && !reduced()) {
        clearTimeout(anim); P.style.transition = 'none'; P.style.transform = 'translateX(' + (o.dir * 22) + '%)'; P.style.opacity = '0.2'; void P.offsetWidth;
        P.style.transition = 'transform .26s cubic-bezier(.2,.8,.3,1),opacity .22s'; P.style.transform = ''; P.style.opacity = '';
        anim = setTimeout(function () { P.style.transition = ''; }, 300);
      }
      if (old !== name && !o.noScroll && curTab === 'about') { var h = $('stTabs'), top = h.getBoundingClientRect().top; if (top < 0) window.scrollTo(0, Math.max(0, window.scrollY + top - 70)); }
    }
    function canStep(dir) { var i = ST_SUBS.indexOf(cur) + dir; return i >= 0 && i < ST_SUBS.length; }
    function step(dir) { if (!canStep(dir)) return false; set(ST_SUBS[ST_SUBS.indexOf(cur) + dir], { dir: dir }); return true; }
    function drag(dx) { if (reduced()) return; P.style.transition = 'none'; P.style.transform = 'translateX(' + (dx * 0.5).toFixed(1) + 'px)'; P.style.opacity = String(1 - Math.min(0.4, Math.abs(dx) / 600)); }
    function dragEnd() { if (!P.style.transform && !P.style.opacity) return; P.style.transition = 'transform .2s cubic-bezier(.2,.8,.3,1),opacity .2s'; P.style.transform = ''; P.style.opacity = ''; clearTimeout(anim); anim = setTimeout(function () { P.style.transition = ''; }, 240); }
    document.querySelectorAll('#stTabs [data-sub]').forEach(function (b) {
      b.onclick = function () { var d = ST_SUBS.indexOf(b.dataset.sub) - ST_SUBS.indexOf(cur); set(b.dataset.sub, { dir: d }); };
      b.onkeydown = function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); if (step(e.key === 'ArrowRight' ? 1 : -1)) document.querySelector('#stTabs [data-sub="' + cur + '"]').focus(); } };
    });
    set(cur, { noScroll: true });
    return { get cur() { return cur; }, set: set, step: step, canStep: canStep, drag: drag, dragEnd: dragEnd };
  })();

  // ---------- v1.5.0 功能切換（只在 Pro；Lite 用底部步驟列）：A 底部圖示列／B 浮動按鈕／C 左右滑動 ----------
  // A（預設）：閒置 3 秒淡出（opacity 300ms，隱藏時不能按）；在靶面以外輕輕一滑（或從畫面下方往上滑）就淡入。點靶面、雙指縮放不會叫出來。
  // B：右下角浮動圓鈕，按一下往上展開 5 個功能（順序同 NAV_ORDER）。C：在靶面以外左右滑動換功能，上方小圓點顯示目前位置。
  // 設定存在 prefs.nav（'a'｜'b'｜'c'）與 prefs.navAutoHide（預設 true）。
  // v1.8.0：順序改成 預報·對照／鬼影／分析（中間）／紀錄／設定/說明；打開 App 預設在「分析」
  var NAV_ORDER = ['predict', 'ghost', 'analysis', 'records', 'about'];
  var NAV_NAME = { predict: '預報·對照', analysis: '分析', records: '紀錄', ghost: '鬼影', about: '設定/說明' };
  var nav = (function () {
    var N = $('wrNav'), H = $('wrNavHandle'), fab = $('wrFab'), scrim = $('wrFabScrim'), B = document.body, M = document.querySelector('main');
    var HIDE_MS = 3000, hideT = 0, holding = false, keyboard = false, style = 'a', autoHide = prefs.navAutoHide !== false, g = null, anim = 0;
    // 不算「滑動」的起點：靶面、照片、彈出視窗、可橫向捲動的區塊、輸入元件、功能列本身
    var NO_SWIPE = 'svg.target,svg.lite-photo,.photobox,.lt-sheet,.modal-bg,input,textarea,select,#wrNav,.wr-fab-wrap,.wr-navc,table,.ana-chips,.ana-strip,.ana-photobox,.ana-dock,.wr-pop,.lay-bar,.lay-editing [data-mod],.lite-rounds,.gh-strip,.dk-eye';
    function pro() { return !B.classList.contains('lite'); }
    function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function isHidden() { return B.classList.contains('nav-hidden'); }
    function setHidden(h) { B.classList.toggle('nav-hidden', !!h); N.setAttribute('aria-hidden', h ? 'true' : 'false'); }
    function arm() {
      clearTimeout(hideT);
      if (style !== 'a' || !autoHide) return;
      hideT = setTimeout(function () {
        if (holding || (keyboard && N.contains(document.activeElement)) || !pro()) { arm(); return; }
        setHidden(true);
      }, HIDE_MS);
    }
    function reveal() { if (style !== 'a') return; setHidden(false); arm(); }
    function openFab(o) {
      o = !!o && style === 'b';
      B.classList.toggle('fab-open', o); fab.setAttribute('aria-expanded', o ? 'true' : 'false');
      if (o) { var a = N.querySelector('button.active') || N.querySelector('button'); if (a) try { a.focus({ preventScroll: true }); } catch (e) {} }
    }
    function syncSettings() {
      document.querySelectorAll('#navStyleSeg [data-nav]').forEach(function (b) { var on = b.dataset.nav === style; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      var ah = $('navAutoHide'); if (ah) { ah.checked = autoHide; ah.disabled = style !== 'a'; }
      var row = $('navAutoHideRow'); if (row) row.classList.toggle('dim', style !== 'a');
    }
    function setStyle(st, quiet) {
      st = ['a', 'b', 'c'].indexOf(st) >= 0 ? st : 'a'; style = st; $('stTabs').setAttribute('data-nav', st);
      ['a', 'b', 'c'].forEach(function (k) { B.classList.toggle('nav-' + k, k === st); });
      openFab(false); cDragEnd(true); setHidden(false); arm(); syncSettings();
      if (prefs.nav !== st) { prefs.nav = st; savePrefs(); }
      if (!quiet) toast({ a: '功能切換：A 底部圖示列', b: '功能切換：B 浮動按鈕（右下角）', c: '功能切換：C 左右滑動' }[st]);
    }
    function setAuto(on) { autoHide = !!on; prefs.navAutoHide = autoHide; savePrefs(); syncSettings(); setHidden(false); arm(); }
    function sync(name) {
      var i = NAV_ORDER.indexOf(name); if (i < 0) return;
      var btn = N.querySelector('button[data-tab="' + name + '"]');
      // B：圓鈕顯示目前功能的圖示＋名稱
      var ic = fab.querySelector('.wr-fab-ic'), sv = btn && btn.querySelector('svg');
      if (ic && sv) ic.innerHTML = sv.outerHTML;
      $('wrFabLbl').textContent = NAV_NAME[name]; fab.setAttribute('aria-label', '功能選單（目前：' + NAV_NAME[name] + '）');
      // C：目前頁名＋兩側淡淡顯示左右鄰居
      $('navcCur').textContent = NAV_NAME[name];
      $('navcPrev').textContent = i > 0 ? '‹ ' + NAV_NAME[NAV_ORDER[i - 1]] : '';
      $('navcNext').textContent = i < NAV_ORDER.length - 1 ? NAV_NAME[NAV_ORDER[i + 1]] + ' ›' : '';
      document.querySelectorAll('#wrNavC .navc-dots button').forEach(function (d) { var on = d.dataset.tab === name; d.classList.toggle('on', on); d.setAttribute('aria-selected', on ? 'true' : 'false'); });
      if (style === 'a' && !isHidden()) arm();
    }
    function go(name) { openFab(false); var old = curTab; showTab(name); if (old !== name || name === 'predict') window.scrollTo(0, 0); }
    N.querySelectorAll('button[data-tab]').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); if (style === 'b' || style === 'c') window.scrollTo(0, 0); }; });
    document.querySelectorAll('#wrNavC .navc-dots button').forEach(function (b) { b.onclick = function () { go(b.dataset.tab); window.scrollTo(0, 0); }; });
    $('navcPrev').onclick = function () { cStep(-1); }; $('navcNext').onclick = function () { cStep(1); };
    fab.onclick = function () { openFab(!B.classList.contains('fab-open')); };
    scrim.onclick = function () { openFab(false); };
    H.onclick = function () { reveal(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Tab') keyboard = true; if (e.key === 'Escape' && B.classList.contains('fab-open')) { openFab(false); try { fab.focus({ preventScroll: true }); } catch (x) {} } });
    // 按著功能列時不要淡出；放開後重新計時
    N.addEventListener('pointerdown', function () { keyboard = false; holding = true; clearTimeout(hideT); }, { passive: true });
    document.addEventListener('pointerup', function () { if (holding) { holding = false; arm(); } }, { passive: true, capture: true });
    document.addEventListener('pointercancel', function () { if (holding) { holding = false; arm(); } }, { passive: true, capture: true });
    N.addEventListener('focusin', function () { if (style === 'a') reveal(); });
    N.addEventListener('focusout', function () { arm(); });

    // --- C：左右滑動的畫面跟手（只動 main 的 transform／opacity） ---
    function cDrag(dx) {
      if (reduced()) return;
      var i = NAV_ORDER.indexOf(curTab), edge = (dx > 0 && i === 0) || (dx < 0 && i === NAV_ORDER.length - 1);
      var d = edge ? dx * 0.18 : dx * 0.55;
      M.style.transition = 'none'; M.style.transform = 'translateX(' + d.toFixed(1) + 'px)'; M.style.opacity = String(1 - Math.min(0.35, Math.abs(d) / (window.innerWidth || 400)));
      B.classList.toggle('navc-peek-prev', dx > 24 && !edge); B.classList.toggle('navc-peek-next', dx < -24 && !edge);
    }
    function cDragEnd(instant) {
      B.classList.remove('navc-peek-prev', 'navc-peek-next');
      if (!M.style.transform && !M.style.opacity) return;
      if (instant || reduced()) { M.style.transition = ''; M.style.transform = ''; M.style.opacity = ''; return; }
      M.style.transition = 'transform .22s cubic-bezier(.2,.8,.3,1),opacity .22s'; M.style.transform = ''; M.style.opacity = '';
      clearTimeout(anim); anim = setTimeout(function () { M.style.transition = ''; }, 260);
    }
    function cStep(dir) {
      var i = NAV_ORDER.indexOf(curTab) + dir;
      if (i < 0 || i >= NAV_ORDER.length) { cDragEnd(); return false; }
      var to = NAV_ORDER[i];
      if (to === 'about') stSub.set(dir > 0 ? 'set' : 'help', { noScroll: true }); // 從左邊滑進來＝先到「設定」（最靠近的子標籤）
      B.classList.remove('navc-peek-prev', 'navc-peek-next');
      if (reduced()) { M.style.transform = ''; M.style.opacity = ''; showTab(to); window.scrollTo(0, 0); return true; }
      clearTimeout(anim);
      M.style.transition = 'transform .15s ease-in,opacity .15s ease-in'; M.style.transform = 'translateX(' + (-dir * 38) + '%)'; M.style.opacity = '0';
      anim = setTimeout(function () {
        showTab(to); window.scrollTo(0, 0);
        M.style.transition = 'none'; M.style.transform = 'translateX(' + (dir * 30) + '%)'; void M.offsetWidth;
        M.style.transition = 'transform .24s cubic-bezier(.2,.8,.3,1),opacity .24s'; M.style.transform = ''; M.style.opacity = '';
        anim = setTimeout(function () { M.style.transition = ''; }, 280);
      }, 150);
      return true;
    }

    // --- 手勢（觸控事件，全部 passive，不擋捲動與靶面縮放） ---
    function canStart(el, x) {
      if (!el || !el.closest) return false;
      if (el.closest(NO_SWIPE)) return false;
      return true;
    }
    document.addEventListener('touchstart', function (e) {
      if (!pro() || e.touches.length !== 1) { if (g && g.dir === 'h') { cDragEnd(); stSub.dragEnd(); } g = null; return; }
      var t = e.touches[0], W = window.innerWidth || 400;
      g = { x: t.clientX, y: t.clientY, t: Date.now(), ok: canStart(e.target), edge: t.clientX < 18 || t.clientX > W - 18, bottom: t.clientY > (window.innerHeight || 800) - 96, dir: null, done: false };
      // 從畫面最下方（功能列的位置）開始的一滑，即使起點剛好在別的元素上也算
      if (!g.ok && g.bottom && !(e.target.closest && e.target.closest('svg.target,svg.lite-photo,.photobox,.modal-bg,.lt-sheet'))) g.ok = true;
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!g) return;
      if (e.touches.length !== 1) { if (g.dir === 'h') { cDragEnd(); stSub.dragEnd(); } g = null; return; }
      var t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (style === 'a') {
        if (!g.done && g.ok && isHidden() && (Math.hypot(dx, dy) >= 18 || (g.bottom && dy <= -10))) { g.done = true; reveal(); }
        else if (!g.done && g.ok && !isHidden() && Math.hypot(dx, dy) >= 18) { g.done = true; arm(); }
      } else if (style === 'c' && g.ok && !g.edge) {
        if (!g.dir) { if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) g.dir = 'h'; else if (Math.abs(dy) > 12) g.dir = 'v'; }
        if (g.dir === 'h') { if (curTab === 'about' && stSub.canStep(dx < 0 ? 1 : -1)) { g.sub = true; cDragEnd(true); stSub.drag(dx); } else { if (g.sub) { g.sub = false; stSub.dragEnd(); } cDrag(dx); } }
      }
    }, { passive: true, capture: true });
    function tEnd(e) {
      if (!g) return; var G = g; g = null;
      if (style !== 'c' || G.dir !== 'h') return;
      var t = e.changedTouches && e.changedTouches[0]; if (!t || e.type === 'touchcancel') { cDragEnd(); stSub.dragEnd(); return; }
      var dx = t.clientX - G.x, dt = Math.max(1, Date.now() - G.t), W = window.innerWidth || 400;
      // v1.7.0：在「設定/說明」裡左右滑＝先換子標籤（設定 ⇄ 帳號 ⇄ 說明）；已經在最邊的子標籤再往外滑，才換到相鄰的功能頁
      if (Math.abs(dx) > Math.max(56, W * 0.2) || (Math.abs(dx) > 32 && Math.abs(dx) / dt > 0.45)) { var dir = dx < 0 ? 1 : -1; if (curTab === 'about' && stSub.step(dir)) { cDragEnd(true); return; } stSub.dragEnd(); cStep(dir); } else { cDragEnd(); stSub.dragEnd(); }
    }
    document.addEventListener('touchend', tEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', tEnd, { passive: true, capture: true });
    // 電腦（滑鼠）：滑到畫面最下方、或在靶面以外捲動滾輪＝叫出功能列
    document.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' && style === 'a' && pro() && isHidden() && e.clientY > (window.innerHeight || 800) - 56) reveal(); }, { passive: true }); // 只算真的滑鼠（觸控點擊產生的相容滑鼠事件不算）
    document.addEventListener('wheel', function (e) { if (style === 'a' && pro() && isHidden() && canStart(e.target)) reveal(); }, { passive: true });

    // 設定（設定/說明 › 設定 › 介面設定）
    document.querySelectorAll('#navStyleSeg [data-nav]').forEach(function (b) { b.onclick = function () { setStyle(b.dataset.nav); }; });
    $('navAutoHide').onchange = function () { setAuto(this.checked); toast(this.checked ? '底部圖示列：閒置自動隱藏' : '底部圖示列：一直顯示'); };
    function modeChanged() { openFab(false); cDragEnd(true); setHidden(false); arm(); setHdr(); }
    // C 的小圓點列黏在標題列下面：量一下標題列實際高度（含瀏海安全區）
    function setHdr() { var h = document.querySelector('header'); if (h) document.documentElement.style.setProperty('--hdr-h', h.offsetHeight + 'px'); }
    window.addEventListener('resize', setHdr); setHdr();
    setStyle(prefs.nav, true);
    return {
      get style() { return style; }, get hidden() { return isHidden(); }, get autoHide() { return autoHide; }, get fabOpen() { return B.classList.contains('fab-open'); },
      setStyle: setStyle, setAutoHide: setAuto, reveal: reveal, hide: function () { clearTimeout(hideT); if (style === 'a') setHidden(true); },
      openFab: openFab, sync: sync, step: cStep, modeChanged: modeChanged, go: go, HIDE_MS: HIDE_MS
    };
  })();
  function fillCalRing() {
    var t = tgt(), sel = $('calRing'); sel.innerHTML = '';
    for (var n = 1; n <= 9; n++) { var o = document.createElement('option'); o.value = n; o.textContent = n + ' 環（外徑 ' + t.ringDiam[n] + 'mm）' + (t.ringDiam[n] === t.blackDiam ? '＝黑區邊緣' : ''); sel.appendChild(o); }
    sel.value = t.blackFromRing;
  }
  var tsel = $('targetSel');
  Object.keys(T).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = T[k].name; tsel.appendChild(o); });
  // v1.6.0：右上角靶種選單會看目前分頁——在「分析」分頁改的是分析的靶種（分析頁不再有自己的選單）
  function syncTargetSel() { var ana = curTab === 'analysis'; tsel.value = ana ? acur.targetId : cur.targetId; tsel.setAttribute('aria-label', ana ? '分析的靶種' : '靶種'); tsel.title = ana ? '分析的靶種（換靶種會開始新的分析）' : '靶種'; }
  tsel.onchange = function () {
    var id = tsel.value;
    if (curTab === 'analysis') { tsel.value = acur.targetId; anaChangeTarget(id); syncTargetSel(); return; }
    function go() { prefs.targetId = id; savePrefs(); persist(); photo.reset(); PV.reset(); CV.reset(); renderAll(); }
    if (cur.preds.length || cur.actuals.length) {
      tsel.value = cur.targetId;
      ask('目前這組已有紀錄。換靶種會開始新的一組，舊的保留在「紀錄」。繼續？', function () { cur = newSession(id); sessions.unshift(cur); go(); });
    } else { cur.targetId = id; go(); }
  };
  function renderAll() { renderAnalysis(); syncTargetSel(); $('pairMode').value = cur.pairMode || (cur.actuals.some(function (a) { return a.src === 'auto'; }) ? 'optimal' : 'order'); fillCalRing(); renderPredict(); renderCompare(); renderRecords(); if (document.body.classList.contains('on-ghost')) renderGhost(); if (typeof acctState !== 'undefined' && curTab === 'about' && stSub.cur === 'acct') { try { renderAcct(); } catch (e) {} } }
  try { var nj = $('nojsNotice'); if (nj) nj.style.display = 'none'; } catch (e) {}
  if (!storageOK) { var sw = $('storageNotice'); if (sw) sw.style.display = ''; }
  setLiteTheme(liteTheme, true); setMode(prefs.ui, true); document.body.classList.add('on-predict'); nav.sync('predict'); renderAbout(); persist(true); renderAll(); liteLayout();
  if (window.WRLayout) WRLayout.init({ toast: toast, ask: ask });
  // v1.7.0：分析頁拍照按鈕自動收邊（dock.js）；設定在「設定/說明 › 設定 › 介面設定」
  if (window.WRDock) {
    WRDock.init({ enabled: prefs.dockAutoHide !== false, active: function () { return curTab === 'analysis'; }, toast: toast });
    $('dockAutoHide').checked = prefs.dockAutoHide !== false;
    $('dockAutoHide').onchange = function () { prefs.dockAutoHide = this.checked; savePrefs(); WRDock.setEnabled(this.checked); toast(this.checked ? '拍照按鈕：閒置自動收到邊緣' : '拍照按鈕：一直顯示'); };
    $('dockResetSet').onclick = function () { WRDock.home(); };
  }
  // v1.8.0：Pro 打開 App 預設在「分析」（Lite 照舊從三步驟的預報開始）
  if (!document.body.classList.contains('lite')) { showTab('analysis'); window.scrollTo(0, 0); }
  window.BMApp = { version: APP_VERSION, get cur() { return cur; }, get acur() { return acur; }, get anaSel() { return anaSel; }, set anaSel(v) { anaSel = v; renderAnalysis(); }, renderAnalysis: function () { renderAnalysis(); }, get anaPhotos() { return anaPhotos; }, get anaBusy() { return anaBusy; }, get sessions() { return sessions; }, photo: photo, renderAll: renderAll, setMode: setMode, setLiteTheme: setLiteTheme, liteLayout: liteLayout, get mode() { return document.body.classList.contains('lite') ? 'lite' : 'pro'; }, get liteView() { return liteView; }, get liteStep() { return liteStep(); }, setLiteStep: setLiteStep, get litePhoto() { return lp; }, get liteSel() { return liteSel; }, renderLite: function () { renderLite(); }, get gcur() { return gcur; }, renderGhost: function () { renderGhost(); }, showTab: function (n) { showTab(n); }, get ghostPreview() { return ghPrev; }, nav: nav, get tab() { return curTab; }, predZoom: function (z) { PV.zoom(z); renderPredict(); }, cmpZoom: function (z) { CV.zoom(z); renderCompare(); }, get predView() { return PV.v; },
    // v1.6.0
    get anaView() { return anaView; }, setAnaView: function (v) { anaSetView(v); }, anaZoom: function (z) { AV.zoom(z); renderAnalysis(); }, get anaViewBox() { return AV.v; }, get anaPZ() { return anaPZ; }, themes: LITE_THEMES.slice(), themeName: THEME_NAME, get theme() { return liteTheme; },
    // v1.7.0
    stSub: stSub, get aboutSub() { return stSub.cur; }, dock: window.WRDock,
    // v1.8.0
    renderAcct: function (st) { renderAcct(st); }, profileStats: function () { return profileStats(); }, restoreCodes: function (t) { return restoreCodes(t); },
    // v2.0.0（member.js 用）
    label: APP_LABEL, toast: toast, ask: ask, drawRecord: drawRecord, recMetaHTML: recMetaHTML, renderRecShare: function () { if (curTab === 'records') renderRecords(); }, navBulge: function () { navBulge(); } };

  // ---------- v1.8.0「設定/說明 › 帳號」：雲端帳號（Firebase Google 登入）＋個人畫面 ----------
  // 沒登入：說明＋「用 Google 帳號登入」。登入後：頭像／名字／email、我的統計（這台裝置的真實紀錄）、同步狀態、選填資料、登出、刪除帳號與雲端資料。
  // 選填資料（射手名稱／慣用槍枝／彈種）存在這台裝置（localStorage 'wr_profile_v1'）；Firestore 規則目前不收這些欄位，所以不上傳。
  var LS_PROFILE = 'wr_profile_v1';
  var PF_FIELDS = [['shooter', '射手名稱', '例：White', 30], ['gun', '慣用槍枝', '例：Steyr EVO 10', 40], ['ammo', '彈種', '例：H&N Finale Match 4.50', 40]];
  function pfLoad() { try { var v = JSON.parse(store.get(LS_PROFILE)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  var WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
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
    sessions.forEach(function (s) {
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
        ? '<div class="pf-h">雲端帳號</div><div class="lbl">雲端帳號只能在網址版使用（這個單檔版不能登入 Google）。請用 <b>whiterhapsody.github.io/WRbeta</b> 開啟，或把它加到主畫面。紀錄照樣存在這台裝置，也可以用紀錄碼備份。</div>'
        : '<div class="cloud-soon">☁️ 雲端帳號即將推出</div><div class="lbl">之後可以用 Google 帳號登入，把紀錄同步到雲端、換手機也不會不見。目前紀錄存在這台裝置（可用紀錄碼備份）。</div>';
    } else if (st.status === 'loading') h = '<div class="pf-h">雲端帳號</div><div class="lbl pf-loading">連線中…</div>';
    else if (signed && window.WRMember && window.WRMember.identityHTML(u)) h = window.WRMember.identityHTML(u); // v2.0.0：有會員資料＝會員 ID 身分卡
    else if (signed) {
      var nm = u.name || (u.email ? u.email.split('@')[0] : '已登入'), ini = (nm.trim().charAt(0) || 'W').toUpperCase();
      h = '<div class="pf-id"><span class="pf-av" aria-hidden="true">' + esc(ini) + (u.photo ? '<img class="pf-photo" src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer">' : '') + '<i class="pf-g">' + GLOGO + '</i></span>' +
        '<span class="pf-idt"><b>' + esc(nm) + '</b><small>' + esc(u.email || '') + (u.relay ? '（Apple 轉寄信箱）' : '') + '</small><small>以 ' + (u.provider === 'apple.com' ? 'Apple' : 'Google') + ' 帳號登入</small></span></div>';
    } else {
      h = '<div class="pf-h">登入雲端帳號</div><div class="lbl">登入後，紀錄會自動備份到你自己的雲端空間（只有你看得到），換手機或重裝也拿得回來。沒登入也可以照常使用，紀錄存在這台裝置。</div>' +
        (st.providers || ['google']).map(function (p) { return '<button type="button" class="cloud-in pf-gbtn" data-p="' + p + '">' + (p === 'apple' ? ' 用 Apple 登入' : '<i class="pf-gl">' + GLOGO + '</i>用 Google 帳號登入') + '</button>'; }).join('') +
        (st.error ? '<div class="lbl pf-err">⚠️ ' + esc(cloudErrText(st.error)) + '</div>' : '');
    }
    box.innerHTML = h;
    if (window.WRMember) try { window.WRMember.bindIdentity(box); } catch (e) {}
    var img = box.querySelector('.pf-photo'); if (img) img.onerror = function () { img.remove(); };
    box.querySelectorAll('.cloud-in').forEach(function (b) { b.onclick = function () { W.signIn(b.dataset.p); }; });
    // 2) 我的統計
    var S = profileStats();
    $('pfStats').innerHTML = '<div class="pf-h">我的統計<small>' + (signed ? '全部紀錄・含雲端同步' : '這台裝置的全部紀錄') + '</small></div><div class="pf-stats">' +
      '<div class="pf-st"><small>總紀錄數</small><b id="pfRecN">' + S.records.toLocaleString('en-US') + '<i>筆</i></b></div>' +
      '<div class="pf-st"><small>總發數</small><b id="pfShotN">' + S.shots.toLocaleString('en-US') + '<i>發</i></b></div>' +
      '<div class="pf-st"><small>最佳成績</small>' + (S.best ? '<b class="acc" id="pfBest">' + S.best.total + '<i>/' + (S.best.n * 10) + '</i></b><small class="pf-sub">' + esc(recTitle(S.best.s)) + '</small>' : '<b id="pfBest">—</b>') + '</div>' +
      '<div class="pf-st"><small>最近一次練習</small><b class="pf-date" id="pfLast">' + (S.last ? esc(fmtTWShort(S.last.created)) : '—') + '</b></div></div>';
    // 3) 同步狀態（登入後）
    var sy = $('pfSync'); sy.hidden = !signed;
    if (signed) {
      var pend = W.pending ? W.pending(sessions) : 0;
      sy.innerHTML = '<div class="pf-h">同步狀態</div><div class="pf-sync"><div><i class="dot' + (st.error ? ' bad' : '') + '"></i>' + (st.syncing ? '同步中…' : st.lastSync ? '上次同步 ' + esc(fmtTWShort(st.lastSync).replace(/ 週. /, ' ')) + '（台北）' : '還沒同步過') + '</div>' +
        '<div class="' + (pend ? 'pend' : 'ok') + '" id="pfPend">' + (pend ? '這台裝置待上傳 ' + pend + ' 筆' : '這台裝置的紀錄都已上傳') + '</div>' +
        (st.error ? '<div class="pf-err">⚠️ ' + esc(cloudErrText(st.error)) + '</div>' : '') + '</div>' +
        '<button type="button" id="cloudSync" class="pf-btn"' + (st.syncing ? ' disabled' : '') + '>' + SYNC_IC + (st.syncing ? '同步中…' : '立即同步') + '</button>';
      $('cloudSync').onclick = function () { W.syncNow(); };
    } else sy.innerHTML = '';
    // 4) 選填資料（這台裝置）
    var pf = pfLoad();
    $('pfExtra').innerHTML = '<div class="pf-h">選填資料<small>可不填・只存在這台裝置</small></div>' + PF_FIELDS.map(function (f) {
      var v = pf[f[0]] || ''; return '<button type="button" class="pf-row" data-f="' + f[0] + '"><span>' + f[1] + '</span><em class="' + (v ? 'set' : '') + '">' + esc(v || '未設定') + '</em>' + CHEV + '</button>';
    }).join('');
    $('pfExtra').querySelectorAll('.pf-row').forEach(function (b) { b.onclick = function () { pfEdit(b.dataset.f); }; });
    // 5) 登出／刪除帳號（登入後）
    var end = $('pfEnd'); end.hidden = !signed;
    if (signed) {
      end.innerHTML = '<button type="button" id="cloudOut" class="pf-out">登出</button>' +
        '<button type="button" id="pfDel" class="pf-del"' + (st.deleting ? ' disabled' : '') + '>' + (st.deleting ? '刪除中…' : '刪除帳號與雲端資料') + '<small>會永久刪除雲端紀錄；這台手機上的紀錄碼不受影響</small></button>';
      $('cloudOut').onclick = function () { ask('登出後紀錄仍留在這台裝置。確定登出？', function () { W.signOut(); toast('已登出'); }, null, { yes: '登出' }); };
      $('pfDel').onclick = pfDelete;
    } else end.innerHTML = '';
    // 6) v2.0.0：會員資料、好友、分享、管理員（member.js）＋隱私權政策
    if (window.WRMember) try { window.WRMember.renderCards(); } catch (e) {}
    var lg = $('pfLegal'); if (lg && !lg.firstChild) {
      lg.innerHTML = '<button type="button" class="pf-row wr-priv-link"><span class="wide">隱私權政策</span><em>收集什麼、怎麼刪除</em>' + CHEV + '</button>';
    }
  }
  function cloudErrText(e) {
    var m = { 'popup-blocked': '彈出視窗被擋住了，請允許後再試一次', 'network-request-failed': '網路連線失敗，請稍後再試', 'unauthorized-domain': '這個網址還沒有被授權登入（請回報）',
      'operation-not-allowed': 'Google 登入尚未啟用（請回報）', 'too-many-requests': '嘗試太多次，請稍後再試', 'requires-recent-login': '要先重新確認 Google 帳號，請再按一次',
      'user-mismatch': '請選擇目前登入的同一個 Google 帳號', 'permission-denied': '雲端拒絕存取（請重新登入）', 'unavailable': '雲端暫時連不上，稍後會再試', 'internal-error': '登入發生錯誤，請再試一次' };
    var k = String(e || '').replace(/^firestore\//, '');
    return m[k] || String(e || '');
  }
  function pfEdit(key) {
    var f = PF_FIELDS.filter(function (x) { return x[0] === key; })[0]; if (!f) return;
    var pf = pfLoad(), bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal pf-modal"><p class="pf-mh"></p><input type="text" class="pf-in" autocomplete="off"><div class="lbl">只存在這台裝置；留空＝不設定。</div><div class="row"><button class="no">取消</button><button class="primary yes">儲存</button></div></div>';
    bg.querySelector('.pf-mh').textContent = f[1];
    var inp = bg.querySelector('.pf-in'); inp.value = pf[key] || ''; inp.placeholder = f[2]; inp.maxLength = f[3]; inp.setAttribute('aria-label', f[1]);
    function done(save) {
      if (save) { var v = inp.value.trim().slice(0, f[3]); if (v) pf[key] = v; else delete pf[key]; store.set(LS_PROFILE, JSON.stringify(pf)); toast(f[1] + (v ? '已儲存' : '已清除')); }
      bg.remove(); renderAcct();
    }
    bg.querySelector('.no').onclick = function () { done(false); };
    bg.querySelector('.yes').onclick = function () { done(true); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
    document.body.appendChild(bg); setTimeout(function () { inp.focus(); }, 0);
  }
  function pfDelete() {
    var W = window.WRCloud;
    ask('刪除帳號與雲端資料？\n會永久刪除你在雲端的全部紀錄與帳號資料，無法復原。這台手機上的紀錄（與紀錄碼）不受影響。', function () {
      ask('最後確認：真的要永久刪除帳號與雲端資料嗎？（如果登入超過幾分鐘，會請你再選一次 Google 帳號確認）', function () {
        // 在點擊裡直接呼叫（需要重新確認時，Google 視窗才不會被擋）
        W.deleteAccount().then(function (r) { toast('帳號與雲端資料已刪除（' + r.deletedRecords + ' 筆雲端紀錄）。這台裝置的紀錄還在。', 4200); renderAcct(); })
          .catch(function (e) { var c = e && e.code ? String(e.code).replace('auth/', '') : ''; if (!/popup-closed|cancelled-popup/.test(c)) toast('刪除沒有完成：' + cloudErrText(c || (e && e.message)), 4200); renderAcct(); });
      }, null, { yes: '永久刪除', danger: true });
    }, null, { yes: '繼續', danger: true });
  }
  (function () {
    var W = window.WRCloud;
    if (W && W.init) W.init({
      getSessions: function () { return sessions; },
      setSessions: function (list) { // 雲端合併後的結果寫回本機，畫面重畫
        sessions = list; store.set(LS_SESS, JSON.stringify(sessions));
        cur = sessions.filter(function (x) { return x.id === cur.id; })[0] || cur; if (sessions.indexOf(cur) < 0) sessions.unshift(cur);
        acur = sessions.filter(function (x) { return x.id === acur.id; })[0] || acur;
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
        try { if (sessionStorage.getItem('wr_reloaded') === APP_VERSION) { toast('有新版本，點「設定/說明 › 說明 › 檢查更新」更新'); return; } sessionStorage.setItem('wr_reloaded', APP_VERSION); } catch (e) {}
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
    toast('更新中…');
    Promise.all(jobs).catch(function () {}).then(function () { var u = location.href.split('#')[0].split('?')[0]; location.replace(u + '?r=' + Date.now()); });
  }
  if ($('forceUpdate')) $('forceUpdate').onclick = forceUpdate;

  /* ---------- v2.0.0：A 圖示列的底座在中間「分析」後面往上鼓起一個圓弧（一整條連續的外框＋陰影） ----------
     做法：底座本身的背景／框線／陰影改成透明，改畫一個 SVG 路徑：
       .nv-bz-fill：同樣的背景（var(--nv-tx),var(--nv-base)＋毛玻璃），用 clip-path:path() 剪成鼓起的形狀
       .nv-bz-line：同一條路徑的框線（顏色＝主題原本的框線色）
       .nv-bz：drop-shadow 濾鏡＝主題原本的外陰影（沿著鼓起的形狀走）
     主題、字級、視窗大小、功能切換樣式改變都會重算；Lite、B、C 樣式不畫（body 沒有 nv-bulge 就跟 v1.8 一樣） */
  var NB = { sig: '', raf: 0 };
  function splitShadows(v) { var out = [], d = 0, cur = ''; for (var i = 0; i < v.length; i++) { var ch = v[i]; if (ch === '(') d++; else if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
  function shadowFilter(v) {
    if (!v || v === 'none') return '';
    return splitShadows(v).filter(function (x) { return !/\binset\b/.test(x); }).map(function (x) {
      var col = (x.match(/(rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/i) || ['rgba(0,0,0,.25)'])[0], n = x.replace(col, '').match(/-?[\d.]+px/g) || [];
      return 'drop-shadow(' + (n[0] || '0px') + ' ' + (n[1] || '0px') + ' ' + (parseFloat(n[2] || '0') * 0.6).toFixed(1) + 'px ' + col + ')';
    }).join(' ');
  }
  function bulgePath(W, H, R, cx, a, top) {
    var h = 14, f = 20, x0 = cx - a - f, x1 = cx - a + 4, x2 = cx + a - 4, x3 = cx + a + f, mx = (x0 + x1) / 2, my = (x2 + x3) / 2, o = top;
    R = Math.min(R, H / 2, W / 2);
    var r = function (v) { return Math.round(v * 10) / 10; };
    return 'M' + r(R) + ',' + o + ' L' + r(x0) + ',' + o + ' C' + r(mx) + ',' + o + ' ' + r(mx) + ',' + r(o - h) + ' ' + r(x1) + ',' + r(o - h) +
      ' Q' + r(cx) + ',' + r(o - h - 5) + ' ' + r(x2) + ',' + r(o - h) + ' C' + r(my) + ',' + r(o - h) + ' ' + r(my) + ',' + o + ' ' + r(x3) + ',' + o +
      ' L' + r(W - R) + ',' + o + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(W) + ',' + r(o + R) + ' L' + r(W) + ',' + r(o + H - R) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(W - R) + ',' + r(o + H) +
      ' L' + r(R) + ',' + r(o + H) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 0,' + r(o + H - R) + ' L0,' + r(o + R) + ' A' + r(R) + ',' + r(R) + ' 0 0 1 ' + r(R) + ',' + o + ' Z';
  }
  function navBulge() {
    NB.raf = 0;
    var Bd = document.body, inn = document.querySelector('#wrNav .wr-nav-in'), main = inn && inn.querySelector('.nv-main');
    var ok = inn && main && !Bd.classList.contains('lite') && Bd.classList.contains('nav-a') && window.CSS && CSS.supports && CSS.supports('clip-path', 'path("M0,0 L1,1 Z")');
    if (!ok) { if (Bd.classList.contains('nv-bulge')) Bd.classList.remove('nv-bulge'); NB.sig = ''; return; }
    var had = Bd.classList.contains('nv-bulge'); if (had) Bd.classList.remove('nv-bulge');
    var cs = getComputedStyle(inn), bd = cs.borderTopColor, sh = cs.boxShadow, R = parseFloat(cs.borderTopLeftRadius) || 18, rr = inn.getBoundingClientRect();
    Bd.classList.add('nv-bulge');
    var mr = main.getBoundingClientRect(), W = rr.width, H = rr.height;
    if (W < 40 || H < 20) { Bd.classList.remove('nv-bulge'); NB.sig = ''; return; }
    var cx = mr.left + mr.width / 2 - rr.left, a = mr.width / 2 + 6, sig = [Math.round(W), Math.round(H), Math.round(cx), Math.round(a), R, bd, sh].join('|');
    var bz = inn.querySelector('.nv-bz');
    if (sig === NB.sig && bz) return;
    NB.sig = sig;
    if (!bz) {
      bz = document.createElement('div'); bz.className = 'nv-bz'; bz.setAttribute('aria-hidden', 'true');
      bz.innerHTML = '<div class="nv-bz-fill"></div><svg class="nv-bz-line" xmlns="' + NS + '"><path class="nv-bz-hl"/><path class="nv-bz-bd"/></svg>';
      inn.insertBefore(bz, inn.firstChild);
    }
    var TOP = 24, d = bulgePath(W, H, R, cx, a, TOP);
    bz.style.width = W + 'px'; bz.style.height = H + 'px'; bz.style.filter = shadowFilter(sh);
    var fill = bz.firstChild, svg = bz.lastChild;
    fill.style.height = (H + TOP) + 'px'; fill.style.top = -TOP + 'px'; fill.style.clipPath = fill.style.webkitClipPath = 'path("' + d + '")';
    svg.setAttribute('width', W); svg.setAttribute('height', H + TOP); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + TOP)); svg.style.top = -TOP + 'px';
    svg.querySelector('.nv-bz-bd').setAttribute('d', d); svg.querySelector('.nv-bz-bd').setAttribute('stroke', bd);
    svg.querySelector('.nv-bz-hl').setAttribute('d', d);
  }
  function navBulgeSoon() { if (!NB.raf) NB.raf = requestAnimationFrame(navBulge); }
  (function () {
    var lastCls = '';
    var strip = function (c) { return c.replace(/\b(nav-hidden|nv-bulge|mb-[\w-]+|fab-open|nav-reveal[\w-]*|dragging[\w-]*)\b/g, '').replace(/\s+/g, ' ').trim(); };
    try { new MutationObserver(function () { var c = strip(document.body.className); if (c !== lastCls) { lastCls = c; NB.sig = ''; navBulgeSoon(); } }).observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }); } catch (e) {}
    try { var inn = document.querySelector('#wrNav .wr-nav-in'); if (inn && window.ResizeObserver) new ResizeObserver(navBulgeSoon).observe(inn); } catch (e) {}
    window.addEventListener('resize', navBulgeSoon);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(navBulgeSoon);
    navBulge(); setTimeout(navBulgeSoon, 400);
  })();
})();
