/* WRbeta Lite 三步驟：1 預報 → 2 拍照 → 3 結果
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, $ = App.$, f1 = App.f1, f2 = App.f2, prefs = App.prefs, FRESH = App.FRESH, savePrefs = App.savePrefs,
    persist = App.persist, tgt = App.tgt, el = App.el, drawTarget = App.drawTarget, labelSize = App.labelSize, previewMark = App.previewMark,
    offsetText = App.offsetText, renderPredict = App.renderPredict, startNew = App.startNew, attachZoom = App.attachZoom,
    renderCompare = App.renderCompare, ask = App.ask, toast = App.toast, showTab = App.showTab;
  // 給其他模組用（函式）
  App.liteStep = liteStep; App.zClamp = zClamp; App.liteApplyView = liteApplyView; App.scoreColor = scoreColor; App.setLiteTheme = setLiteTheme;
  App.liteLayout = liteLayout; App.renderLite = renderLite; App.vib = vib; App.liftPx = liftPx; App.setLiteStep = setLiteStep;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'LF', { get: function () { return LF; }, set: function (v) { LF = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'liteView', { get: function () { return liteView; }, set: function (v) { liteView = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'liteSel', { get: function () { return liteSel; }, set: function (v) { liteSel = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'lp', { get: function () { return lp; }, set: function (v) { lp = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'LITE_THEMES', { get: function () { return LITE_THEMES; }, set: function (v) { LITE_THEMES = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'THEME_NAME', { get: function () { return THEME_NAME; }, set: function (v) { THEME_NAME = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'liteTheme', { get: function () { return liteTheme; }, set: function (v) { liteTheme = v; }, enumerable: true, configurable: true });

  // ---------- Lite 介面：三步驟「1 預報 → 2 拍照 → 3 結果」（資料與 Pro 共用 cur；每輪用 r 標記，見 liteflow.js） ----------
  var LF = window.BMLite;
  var liteSvg = $('liteSvg'), litePh = $('litePhotoSvg');
  var liteView = null, liteTid = null, litePreview = null; // 靶面檢視 {cx,cy,E}（SVG 座標，y 向下）
  var litePV = null, liteVMode = 'target';               // 照片檢視；第 2 步可切「靶面／照片」
  var liteSel = -1, liteUndo2 = null, liteDrag = null;   // 第 2 步：選取的彈孔（cur.actuals 索引）、復原、拖曳中
  var liteRes = 'cur', liteShotSel = -1;                 // 第 3 步：看哪一輪（'cur'、數字或 'all'）、點選的一發
  var lp = null;                                         // 本輪照片（只在記憶體，不存檔）
  function liteStep() { var s = App.cur.liteStep; return s === 2 || s === 3 ? s : 1; }
  function liteK() { return LF.curRound(App.cur); }
  function liteCard() { return tgt().cardSize; }
  function liteResetView() { var c = liteCard(); liteView = { cx: 0, cy: 0, E: c }; liteTid = App.cur.targetId; }
  function zClamp(v, b, div) {
    var M = Math.max(b.w, b.h); v.E = Math.max(M / (div || 10), Math.min(M, v.E));
    function cl(c, lo, len) { var h = v.E / 2; return v.E >= len ? lo + len / 2 : Math.max(lo + h, Math.min(lo + len - h, c)); }
    v.cx = cl(v.cx, b.x0, b.w); v.cy = cl(v.cy, b.y0, b.h);
  }
  function liteBounds() { var c = liteCard(); return { x0: -c / 2, y0: -c / 2, w: c, h: c }; }
  function liteClamp() { zClamp(liteView, liteBounds(), 10); }
  function photoBounds() { return { x0: 0, y0: 0, w: lp.w, h: lp.h }; }
  function liteHasPhoto() { return !!(lp && lp.sid === App.cur.id && lp.rk === liteK()); }
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
  var THEME_NAME = { sport: wrT('app.sport'), hud: wrT('app.tactical_hud'), light: wrT('app.minimal_light'), glass: wrT('app.glass_gradient'), cyberpunk: wrT('app.cyberpunk'), tron: wrT('app.digital_world'), piano: wrT('app.piano_gloss_matte'), racing: wrT('app.racing'), appliance: wrT('app.tech_appliance'), luxury: wrT('app.precision_luxe') };
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
    if (!quiet) { try { App.renderAll(); } catch (e) { renderLite(); } }
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
    var k = liteK(); if (LF.pointsOf(App.cur.actuals, k).length) return k;
    var d = LF.doneRounds(App.cur); return d.length ? d[d.length - 1].k : k;
  }
  function renderLiteTarget() {
    if (!liteView || liteTid !== App.cur.targetId) liteResetView();
    var t = tgt(), step = liteStep(), k = liteK();
    drawTarget(liteSvg, t, 1); liteClamp(); liteApplyView();
    var g = liteSvg.querySelector('#marks'), lines = liteSvg.querySelector('#lines'), E = +liteSvg.dataset.extent, R = t.pellet / 2;
    if (step === 1) {
      App.cur.preds.forEach(function (p) { if (LF.roundOf(p) !== k) liteDot(g, p, null, 'pred-old', R); });
      LF.pointsOf(App.cur.preds, k).forEach(function (p, i) { liteDot(g, p, i + 1, 'pred-c', R); });
      if (litePreview) previewMark(liteSvg, litePreview, 'pred-c', t);
    } else if (step === 2) {
      LF.pointsOf(App.cur.preds, k).forEach(function (p) { liteDot(g, p, null, 'pred-ghost', R); });
      var n = 0;
      App.cur.actuals.forEach(function (a, i) {
        if (LF.roundOf(a) !== k) return; n++;
        var un = a.src === 'auto' && a.conf != null && a.conf < 0.5;
        var gg = liteDot(g, a, n, 'act-c' + (un ? ' act-unsure' : ''), R);
        if (i === liteSel) el('circle', { cx: a.x, cy: -a.y, r: R + E * 0.014, fill: 'none', 'class': 'lite-selring', 'stroke-width': Math.max(0.2, E * 0.006) }, gg);
      });
      if (litePreview) previewMark(liteSvg, litePreview, 'act-c', t);
    } else {
      var res = LF.result(t, App.cur, liteResultSel()), lab = {};
      res.cmp.pairs.forEach(function (q) {
        var p = App.cur.preds[q.predIdx], a = App.cur.actuals[q.actIdx]; lab[q.actIdx] = q.i;
        el('line', { x1: a.x, y1: -a.y, x2: p.x, y2: -p.y, 'class': 'lite-pairline', 'stroke-width': Math.max(0.1, E * 0.005) }, lines);
      });
      var ks = res.rounds, inSel = function (q) { return ks.indexOf(LF.roundOf(q)) >= 0; };
      App.cur.preds.forEach(function (p, i) { if (inSel(p)) liteDot(g, p, i + 1, 'pred-c', R); });
      var an = 0;
      App.cur.actuals.forEach(function (a, i) {
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
      for (var n = 1; n <= 10; n++) el('path', { d: App.projCircle(Ti, t.ringDiam[n] / 2), fill: 'none', stroke: '#39ff14', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', opacity: 0.7 }, svg);
      var RR = t.ringDiam[1] / 2 + 2;
      el('path', { d: App.projLine(Ti, 0, -RR, 0, RR), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
      el('path', { d: App.projLine(Ti, -RR, 0, RR, 0), stroke: '#ff00ff', 'stroke-width': 1.5, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }, svg);
      var m = 0;
      App.cur.actuals.forEach(function (a, i) {
        if (LF.roundOf(a) !== k) return; m++;
        var un = a.src === 'auto' && a.conf != null && a.conf < 0.5, sel = i === liteSel;
        el('path', { d: App.projCircle(Ti, t.pellet / 2, a.x, a.y, 24), fill: sel ? 'rgba(255,214,10,.35)' : 'rgba(255,40,40,.25)', stroke: sel ? '#ffd60a' : un ? '#ffb300' : '#ff2828', 'stroke-width': sel ? 3.5 : 2.5, 'stroke-dasharray': un && !sel ? '4 3' : '', 'vector-effect': 'non-scaling-stroke' }, svg);
        var pp = C.applyAffine(Ti, a.x, a.y);
        var tx = el('text', { x: pp.x + u * 2.4, y: pp.y - u * 2.4, 'font-size': u * 4, fill: un ? '#ffb300' : '#ffeb3b', stroke: '#000', 'stroke-width': u * 0.6, 'paint-order': 'stroke', 'font-weight': 'bold' }, svg);
        tx.textContent = m + (un ? '?' : '');
      });
    }
    liteApplyView();
  }
  // --- 主畫面 ---
  var GO_LBL = { 1: wrT('app.next_photo'), 2: wrT('app.see_results'), 3: wrT('app.next_round') };
  function renderLite() {
    var t = tgt(), step = liteStep(), k = liteK(), V = $('liteView');
    V.dataset.step = step;
    document.body.dataset.liteStep = step;
    var photoOn = liteShowsPhoto();
    litePh.toggleAttribute('hidden', !photoOn); liteSvg.style.visibility = photoOn ? 'hidden' : ''; // SVG 元素沒有 .hidden 屬性，要直接改 attribute
    renderLiteTarget(); renderLitePhoto();
    // 步驟列
    var rp = LF.pointsOf(App.cur.preds, k).length, ra = LF.pointsOf(App.cur.actuals, k).length, ready3 = LF.stepReady(App.cur, 3);
    document.querySelectorAll('#liteSteps [data-step]').forEach(function (b) {
      var s = +b.dataset.step, on = s === step && document.body.classList.contains('on-predict');
      b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false');
      b.classList.toggle('done', (s === 1 && rp > 0) || (s === 2 && ra > 0));
      b.classList.toggle('dim', s === 3 && !ready3);
    });
    $('liteRoundBadge').textContent = wrT('app.round', [k + 1]);
    $('liteRoundBadge').classList.toggle('show', k > 0 || LF.doneRounds(App.cur).length > 0);
    // 主按鈕
    var go = GO_LBL[step];
    if (step === 1 && !rp) go = ra ? wrT('app.next_photo') : wrT('app.skip_calls_take_photo');
    $('liteGoLbl').textContent = go;
    $('liteVerify').classList.toggle('soft', step === 2 && !ra);
    // 工具列
    $('liteUndo').hidden = step === 3;
    $('liteUndo').disabled = step === 1 ? !LF.canUndoPred(App.cur) : !liteUndo2;
    var st = C.computeStats(t, App.cur.preds), n = st.n;
    if (step === 1) {
      $('liteHint').textContent = wrT('app.tap_the_target_to_call', [k > 0 ? wrT('app.round_calls_this_round', [k + 1, rp]) : '']);
      setPanelLabels(wrT('app.latest_call'), wrT('app.shots'), wrT('app.60_shot_projection'), wrT('app.total'));
      // 總分與 60發預估沿用 Pro 的主數字：整數環數加總（ISSF 資格賽計分），60發預估＝整數平均×60
      $('lpCount').textContent = n; $('lpSum').textContent = n ? st.total : 0; $('lpEst').textContent = n ? st.proj60 : '—';
      if (!litePreview) { if (n) liteBig(st.shots[n - 1].dec, wrT('app.call_for_shot', [n])); else liteBig(null, wrT('app.latest_call')); }
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
    if (has && lp.busy) info = wrT('app.analyzing_photo');
    else if (has && lp.mode === 'manual' && lp.calPts.length < 5) {
      var nm = [wrT('app.the_center'), wrT('app.the_top_of_the_black'), wrT('app.the_right_of_the_black'), wrT('app.the_bottom_of_the_black'), wrT('app.the_left_of_the_black')];
      info = wrT('app.manual_calibration_5_tap_on', [lp.calPts.length + 1, nm[lp.calPts.length]]);
    } else if (has && !lp.T) { info = wrT('app.auto_calibration_failed_tap_manual', [App.esc(lp.info && lp.info.reason || wrT('app.unknown_reason'))]); warn = true; }
    else if (!has && !ra) info = rp ? wrT('app.take_a_photo_of_this', [rp]) : wrT('app.no_calls_thats_fine_after');
    else {
      info = wrT('app.shot_holes_detected', [ra, rp ? wrT('app.calls_this_round', [rp]) : '']);
      if (rp && ra !== rp) { info += wrT('app.counts_differ_overlapping_holes_may'); warn = true; }
      else info += wrT('app.tap_empty_space_add_hold');
    }
    $('liteS2Info').innerHTML = info; $('liteS2Info').classList.toggle('warn', warn);
    $('liteHint').textContent = liteSel >= 0 ? wrT('app.1_shot_hole_selected') : liteVMode === 'photo' && has ? wrT('app.green_circles_should_match_the') : wrT('app.round_actual_shots', [liteK() + 1]);
    $('liteDelHole').disabled = liteSel < 0;
    var hasT = has && !!lp.T;
    $('liteRotL').disabled = $('liteRotR').disabled = $('liteRedetect').disabled = !hasT;
    $('liteManual').disabled = !has;
  }
  function renderLiteS3() {
    var t = tgt(), sel = liteResultSel(), res = LF.result(t, App.cur, sel), st = res.st, cmp = res.cmp;
    var rl = LF.doneRounds(App.cur), chips = '';
    if (rl.length > 1 || (rl.length === 1 && rl[0].k !== liteK() && LF.pointsOf(App.cur.actuals, liteK()).length)) {
      rl.forEach(function (r) { chips += wrT('app.round_shots', [r.k, sel === r.k ? 'on' : '', r.k + 1, r.acts]); });
      chips += wrT('app.all', [sel === 'all' ? 'on' : '', LF.pointsOf(App.cur.actuals, -1).length]);
    }
    $('liteRounds').innerHTML = chips; $('liteRounds').hidden = !chips;
    var tot = 0; rl.forEach(function (r) { tot += r.acts; }); var ae = $('liteRounds').querySelector('[data-r=all] small'); if (ae) ae.textContent = wrT('app.shots_3', [tot]);
    $('liteRounds').querySelectorAll('button').forEach(function (b) { b.onclick = function () { liteRes = b.dataset.r === 'all' ? 'all' : +b.dataset.r; liteShotSel = -1; renderLite(); }; });
    var lbl = sel === 'all' ? wrT('app.all_2') : wrT('app.round', [sel + 1]);
    if (!st.n) { liteBig(null, wrT('app.actual_total', [lbl])); $('lpCount').textContent = 0; $('lpEst').textContent = '—'; $('lpSum').textContent = '—'; $('liteHint').textContent = wrT('app.no_shot_holes_yet_go'); }
    else {
      liteBig(st.avgDec, wrT('app.actual_total', [lbl]), String(st.total));
      $('lpCount').textContent = st.n;
      if (res.hasForecast && cmp.m) {
        setPanelLabels(wrT('app.actual_total', [lbl]), wrT('app.shots'), wrT('app.avg_error_mm'), wrT('app.call_total'));
        $('lpEst').textContent = f1(cmp.meanErr); $('lpSum').textContent = res.pst.total;
        var lv = LF.accuracyLevel(t, cmp);
        $('liteHint').textContent = wrT('app.calls_ring_correct', [cmp.biasDir === '置中' ? wrT('app.no_clear_bias') : wrT('app.biased_mm', [wrT.dir(cmp.biasDir), f1(cmp.biasLen)]), Math.round(cmp.sameRingRate * 100), lv.label]);
      } else {
        setPanelLabels(wrT('app.actual_total', [lbl]), wrT('app.shots'), wrT('app.60_shot_projection'), wrT('app.decimal_total'));
        $('lpEst').textContent = st.proj60; $('lpSum').textContent = f1(st.totalDec);
        $('liteHint').textContent = st.advice ? wrT('app.group_center', [st.advice.centered ? wrT('core.centered') : wrT.dir(st.advice.offsetDir) + ' ' + f1(st.advice.dist) + 'mm', st.n > 1 ? wrT('app.group_size_mm', [f1(st.groupSize)]) : '']) : wrT('app.score_analysis');
      }
    }
    if (liteShotSel >= 0 && App.cur.actuals[liteShotSel]) {
      var a = App.cur.actuals[liteShotSel], sa = C.scoreShot(t, a.x, a.y), pq = res.cmp.pairs.filter(function (q) { return q.actIdx === liteShotSel; })[0];
      $('liteHint').textContent = pq ? wrT('app.shot_call_actual_off_by', [pq.i, f1(pq.pred.dec), f1(pq.act.dec), f1(pq.err)]) : wrT('app.this_shot', [f1(sa.dec), offsetText(a.x, a.y)]);
    }
    if (document.activeElement !== $('liteName')) $('liteName').value = App.cur.name || '';
    var Code = window.BMCode, rec = LF.toAnalysisRecord(App.cur), code = null;
    try { code = rec && Code ? Code.encode(rec) : null; } catch (e) { code = null; }
    $('liteCopyCode').disabled = !code;
    $('liteCodeInfo').textContent = code ? wrT('app.record_code_characters_actual_shots', [code.length, rec.sheets.length]) : '';
    $('liteDetail').innerHTML = liteDetailHTML(t, res, lbl);
  }
  function liteDetailHTML(t, res, lbl) {
    var st = res.st, cmp = res.cmp, h = '', card = function (id, title, body) {
      var name = String(title).replace(/^[\s\S]*?([\w\u4e00-\u9fff])/, '$1').replace(/（.*$/, '').replace(/\s*\(.*$/, '').trim();
      return '<div class="lite-card" data-mod="' + id + '" data-mod-name="' + App.esc(name) + '"><div class="lite-ct">' + title + '</div>' + body + '</div>';
    };
    if (!st.n) return '';
    var kv = function (k, v, s) { return '<div class="lite-kv"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; };
    if (res.hasForecast) {
      if (cmp.m) {
        var lv = LF.accuracyLevel(t, cmp);
        h += card('accuracy', wrT('app.how_accurate_were_my_calls', [lbl]), wrT('app.avg_off_by_ring_widths', [lv.level, lv.label, f1(lv.rings), kv(wrT('app.avg_call_error'), f2(cmp.meanErr) + ' mm', wrT('app.max_shot_mm', [cmp.maxErrShot, f1(cmp.maxErr)])), kv(wrT('app.systematic_bias'), cmp.biasDir === '置中' ? wrT('app.no_clear_bias_2') : wrT('app.calls_biased', [wrT.dir(cmp.biasDir)]), offsetText(cmp.biasX, cmp.biasY)), kv(wrT('app.ring_called_correctly'), Math.round(cmp.sameRingRate * 100) + '%', wrT('app.avg_decimal_difference', [f2(cmp.meanAbsDecDiff)])), cmp.unpairedPred || cmp.unpairedAct ? kv(wrT('app.not_matched'), (cmp.unpairedPred ? wrT('app.calls', [cmp.unpairedPred]) : '') + (cmp.unpairedAct ? wrT('app.holes', [cmp.unpairedAct]) : ''), wrT('app.number_of_calls_and_holes')) : '']));
      } else h += card('accuracy', wrT('app.how_accurate_were_my_calls_2'), wrT('app.no_calls_and_shot_holes'));
    }
    h += card('score', wrT('app.actual_score', [lbl]), kv(wrT('app.total'), st.total, wrT('app.decimal', [f1(st.totalDec)])) + kv(wrT('app.average_2'), f2(st.avgDec), wrT('app.integer', [f2(st.avg)])) + kv(wrT('app.60_shot_projection'), st.proj60, wrT('app.decimal', [f1(st.proj60Dec)])) +
      kv(wrT('app.s', [t.innerTen.label]), st.inner) + (st.n > 1 ? kv(wrT('app.group_size'), f1(st.groupSize) + ' mm') : '') +
      (st.advice ? kv(wrT('app.group_center_2'), st.advice.centered ? wrT('core.centered') : wrT.dir(st.advice.offsetDir) + ' ' + f1(st.advice.dist) + 'mm', App.esc(st.advice.text)) : '') +
      (st.n > 1 ? kv(wrT('app.consistency_std_dev'), f2(st.sdDec)) : ''));
    if (res.perRound.length > 1) {
      var tb = wrT('app.round_calls_holes_total_decimal');
      res.perRound.forEach(function (r) { tb += '<tr><td>' + (r.k + 1) + '</td><td>' + r.preds + '</td><td>' + r.acts + '</td><td>' + r.st.total + '</td><td>' + f1(r.st.totalDec) + '</td></tr>'; });
      h += card('rounds', wrT('app.subtotal_per_round'), tb + '</table>');
    }
    if (cmp.m) {
      var pt = wrT('app.call_actual_diff');
      cmp.pairs.forEach(function (q) { pt += '<tr><td>' + q.i + '</td><td>' + f1(q.pred.dec) + '</td><td>' + f1(q.act.dec) + '</td><td>' + f1(q.err) + 'mm</td></tr>'; });
      h += card('shots', wrT('app.shot_by_shot'), pt + '</table>');
    }
    return h;
  }
  function vib() { if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {} }
  function liteInCard(p) { var half = liteCard() / 2 + 1; return Math.abs(p.x) <= half && Math.abs(p.y) <= half; }
  // 第 2 步編輯（靶面與照片共用，座標一律 mm）：點空白＝新增；按住彈孔＝選取＋拖曳
  var holeEdit = {
    down: function (m) {
      var k = liteK(), i = LF.nearest(App.cur.actuals, k, m, tgt().pellet / 2 * 1.25);
      if (i >= 0) { var a = App.cur.actuals[i]; liteDrag = { i: i, ox: a.x - m.x, oy: a.y - m.y, from: { x: a.x, y: a.y }, moved: false, wasSel: liteSel === i }; liteSel = i; litePreview = null; }
      else { liteDrag = null; litePreview = m; }
      renderLite();
    },
    move: function (m) {
      if (liteDrag) {
        var a = App.cur.actuals[liteDrag.i], nx = m.x + liteDrag.ox, ny = m.y + liteDrag.oy;
        if (!liteDrag.moved && Math.hypot(nx - liteDrag.from.x, ny - liteDrag.from.y) < 0.4) return;
        liteDrag.moved = true; a.x = C.round(nx, 3); a.y = C.round(ny, 3); a.src = 'manual'; delete a.conf;
      } else litePreview = m;
      renderLite();
    },
    up: function (m) {
      if (liteDrag) {
        var d = liteDrag; liteDrag = null;
        if (d.moved) { liteUndo2 = { op: 'move', q: App.cur.actuals[d.i], from: d.from }; persist(); vib(); }
        else if (d.wasSel) liteSel = -1; // 再點一次＝取消選取
        renderLite(); return;
      }
      litePreview = null;
      if (!liteInCard(m)) { renderLite(); return; }
      var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), src: 'manual', r: liteK() };
      App.cur.actuals.push(q); liteSel = App.cur.actuals.length - 1; liteUndo2 = { op: 'add', q: q };
      persist(); vib(); renderLite(); toast(wrT('app.shot_hole_added'));
    },
    cancel: function () {
      if (liteDrag && liteDrag.moved) { var a = App.cur.actuals[liteDrag.i]; a.x = liteDrag.from.x; a.y = liteDrag.from.y; }
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
      if (step === 1) { litePreview = m; previewMark(liteSvg, m, 'pred-c', tgt()); var s = C.scoreShot(tgt(), m.x, m.y); liteBig(s.dec, wrT('app.shot_release_to_record', [App.cur.preds.length + 1])); }
      else if (step === 2) holeEdit.move(m);
    },
    up: function (r) {
      var m = { x: r.x, y: -r.y }, step = liteStep();
      if (step === 1) {
        litePreview = null;
        if (!liteInCard(m)) { renderLite(); return; }
        var q = { x: C.round(m.x, 3), y: C.round(m.y, 3), t: Date.now() }; if (liteK() > 0) q.r = liteK();
        App.cur.preds.push(q); persist(); renderPredict(); renderCompare(); vib();
      } else if (step === 2) holeEdit.up(m);
      else { // 第 3 步：點一發看它的預報與實際
        var res = LF.result(tgt(), App.cur, liteResultSel()), bi = -1, bd = Infinity;
        App.cur.actuals.forEach(function (a, i) { if (res.rounds.indexOf(LF.roundOf(a)) < 0) return; var d = Math.hypot(a.x - m.x, a.y - m.y); if (d < bd) { bd = d; bi = i; } });
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
        if (lp.calPts.length === 5) { lp.T = C.fitAffine(lp.calPts); if (!lp.T) { toast(wrT('app.calibration_failed_please_tap_again')); lp.calPts = []; } else { lp.rotDeg = 0; liteProcess(); return; } }
        renderLite(); return;
      }
      var m = this.toMM(r); if (m) holeEdit.up(m);
    },
    cancel: function () { holeEdit.cancel(); }
  });

  // --- 第 2 步：照片（沿用自動校正＋找彈孔；本輪的彈孔只換掉本輪） ---
  function liteLoad(file) {
    if (!file) return;
    if (!App.pickIsImage(file)) { App.pickError(file); return; }
    var url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      if (lp && lp.url) try { URL.revokeObjectURL(lp.url); } catch (e) {}
      lp = { sid: App.cur.id, rk: liteK(), url: url, img: im, w: im.naturalWidth, h: im.naturalHeight, name: file.name || '', mode: 'auto', calPts: [], T: null, Tinv: null, g: null, rotDeg: 0, busy: false, info: null };
      litePV = null; liteSel = -1; liteUndo2 = null; liteVMode = 'photo';
      liteProcess();
    };
    im.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} App.pickError(file); };
    im.src = url;
  }
  function liteProcess() {
    var P = lp, V = window.BMVision; if (!P) return;
    P.busy = true; renderLite();
    setTimeout(function () {
      try {
        var r = App.visRun(P, App.cur.targetId, +$('liteSens').value, false), det = r.det; // v1.7.1：共用流程
        if (r.mismatch) toast(wrT('app.this_looks_like_a_target', [T[r.mismatch].name, tgt().name]));
        if (P.T) {
          LF.setRoundActuals(App.cur, P.rk, (det.holes || []).map(function (q) { return { x: C.round(q.x, 3), y: C.round(q.y, 3), src: 'auto', conf: C.round(q.conf, 2) }; }));
          App.cur.calib = { mode: P.mode, rms: C.round(P.T.rms || 0, 3), at: Date.now() };
          App.cur.rounds = App.cur.rounds || []; App.cur.rounds[P.rk] = { at: new Date().toISOString(), photo: { w: P.w, h: P.h, name: P.name }, calib: { mode: P.mode, rms: C.round(P.T.rms || 0, 3) } };
          persist();
          var rp = LF.pointsOf(App.cur.preds, P.rk).length, ra = LF.pointsOf(App.cur.actuals, P.rk).length;
          liteVMode = rp && ra !== rp ? 'photo' : 'target'; // 數量對得上就直接看靶面，對不上留在照片方便檢查
        }
      } catch (e) { P.T = null; P.info = { reason: wrT('app.analysis_error', [e.message]) }; }
      P.busy = false; liteSel = -1; liteUndo2 = null; renderLite(); renderCompare();
    }, 30);
  }
  ['liteCam', 'litePick', 'liteFile'].forEach(function (id) { $(id).onchange = function () { liteLoad(this.files[0]); this.value = ''; }; });
  document.querySelectorAll('#liteViewSeg button').forEach(function (b) { b.onclick = function () { liteVMode = b.dataset.v; litePreview = null; renderLite(); }; });
  $('liteDelHole').onclick = function () {
    if (liteSel < 0 || !App.cur.actuals[liteSel]) return;
    var q = App.cur.actuals.splice(liteSel, 1)[0]; liteUndo2 = { op: 'del', q: q, i: liteSel }; liteSel = -1; persist(); renderLite(); renderCompare(); toast(wrT('app.shot_hole_deleted'));
  };
  function liteRotate(deg) {
    if (!lp || !lp.T) return;
    var th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), rms = lp.T.rms, k = lp.rk;
    lp.T = window.BMVision.rotateAffine(lp.T, th); lp.T.rms = rms; lp.Tinv = C.invertAffine(lp.T); lp.rotDeg += deg;
    App.cur.actuals = App.cur.actuals.map(function (p) { return LF.roundOf(p) === k ? Object.assign({}, p, { x: C.round(c * p.x - s * p.y, 3), y: C.round(s * p.x + c * p.y, 3) }) : p; });
    liteUndo2 = null; persist(); renderLite(); toast(wrT('app.rotated', [lp.rotDeg]));
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
    if (liteStep() === 1) { if (LF.canUndoPred(App.cur)) { App.cur.preds.pop(); persist(); renderPredict(); renderCompare(); } return; }
    var u = liteUndo2; if (!u) return;
    if (u.op === 'add') { var i = App.cur.actuals.indexOf(u.q); if (i >= 0) App.cur.actuals.splice(i, 1); }
    else if (u.op === 'del') App.cur.actuals.splice(Math.min(u.i, App.cur.actuals.length), 0, u.q);
    else if (u.op === 'move') { u.q.x = u.from.x; u.q.y = u.from.y; }
    liteUndo2 = null; liteSel = -1; persist(); renderLite(); renderCompare();
  };
  function setLiteStep(s, quiet) {
    if (s === 3 && !LF.stepReady(App.cur, 3)) { toast(wrT('app.take_a_photo_of_the')); s = 2; }
    if (App.cur.liteStep !== s) { App.cur.liteStep = s; persist(); }
    litePreview = null; liteDrag = null; if (s !== 2) liteSel = -1; if (s === 3) { liteRes = 'cur'; liteShotSel = -1; }
    if (!document.body.classList.contains('on-predict')) showTab('predict');
    renderLite(); if (!quiet) window.scrollTo(0, 0);
  }
  $('liteVerify').onclick = function () {
    var s = liteStep();
    if (s === 1) setLiteStep(2);
    else if (s === 2) { if (!LF.pointsOf(App.cur.actuals, liteK()).length) { toast(wrT('app.no_shot_holes_yet_take')); return; } setLiteStep(3); }
    else { var k = LF.nextRound(App.cur); lp = null; liteUndo2 = null; liteVMode = 'target'; liteResetView(); persist(); setLiteStep(1); toast(wrT('app.round_started_call_photo_results', [k + 1])); }
  };
  document.querySelectorAll('#liteSteps [data-step]').forEach(function (b) { b.onclick = function () { setLiteStep(+b.dataset.step); }; });
  $('liteName').onchange = function () { App.cur.name = this.value.trim().slice(0, 60); persist(); renderLite(); toast(wrT('app.name_saved')); };
  $('liteCopyCode').onclick = function () {
    var Code = window.BMCode, rec = LF.toAnalysisRecord(App.cur), code = rec && Code && Code.encode(rec);
    if (!code) { toast(wrT('app.no_shot_holes_to_copy')); return; }
    App.copyText(code, wrT('app.record_code_copied_characters', [code.length]));
  };
  $('liteFinish').onclick = function () {
    var n = App.cur.preds.length + App.cur.actuals.length;
    function go() { App.cur.liteStep = 1; persist(); startNew(); lp = null; liteUndo2 = null; liteVMode = 'target'; App.cur.liteStep = 1; renderLite(); toast(wrT('app.saved_to_records_new_set')); }
    if (n) ask(wrT('app.this_set_has_been_saved'), go); else go();
  };
})(window.WRApp = window.WRApp || {});
