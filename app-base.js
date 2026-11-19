/* WRbeta 共用底座：資料（sessions／cur／prefs 與儲存）、靶面繪製、數據面板、共用小工具（ask／toast／showTab／attachZoom）
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 給其他模組用（函式）
  App.saveSessions = saveSessions; App.savePrefs = savePrefs; App.isAna = isAna; App.newSession = newSession; App.newAnalysis = newAnalysis;
  App.fmtTW = fmtTW; App.anaShots = anaShots; App.persist = persist; App.tgt = tgt; App.el = el; App.drawTarget = drawTarget;
  App.labelSize = labelSize; App.drawShot = drawShot; App.previewMark = previewMark; App.stat = stat; App.offsetText = offsetText;
  App.renderStats = renderStats; App.shotTable = shotTable; App.attachZoom = attachZoom; App.ask = ask; App.toast = toast; App.toastAct = toastAct;
  App.showTab = showTab;
  // 給其他模組用（變數：一律讀寫同一份）
  Object.defineProperty(App, 'C', { get: function () { return C; }, set: function (v) { C = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'T', { get: function () { return T; }, set: function (v) { T = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'NS', { get: function () { return NS; }, set: function (v) { NS = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'LS_SESS', { get: function () { return LS_SESS; }, set: function (v) { LS_SESS = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'LS_CUR', { get: function () { return LS_CUR; }, set: function (v) { LS_CUR = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, '$', { get: function () { return $; }, set: function (v) { $ = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'f1', { get: function () { return f1; }, set: function (v) { f1 = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'f2', { get: function () { return f2; }, set: function (v) { f2 = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'storageOK', { get: function () { return storageOK; }, set: function (v) { storageOK = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'store', { get: function () { return store; }, set: function (v) { store = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'prefs', { get: function () { return prefs; }, set: function (v) { prefs = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'FRESH', { get: function () { return FRESH; }, set: function (v) { FRESH = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'SCHEMA_V', { get: function () { return SCHEMA_V; }, set: function (v) { SCHEMA_V = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'sessions', { get: function () { return sessions; }, set: function (v) { sessions = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'cur', { get: function () { return cur; }, set: function (v) { cur = v; }, enumerable: true, configurable: true });
  Object.defineProperty(App, 'curTab', { get: function () { return curTab; }, set: function (v) { curTab = v; }, enumerable: true, configurable: true });
  var C = window.BMCore, T = C.TARGETS, NS = 'http://www.w3.org/2000/svg';
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
  function saveSessions(list) { var ok = store.set(LS_SESS, JSON.stringify(list)); if (!ok && storageOK) toast(wrT('app.save_failed_out_of_storage')); cloudDirty(); }
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
    var ctm = svg && svg.getScreenCTM && svg.getScreenCTM();
    if (!ctm) return null; // 尚未畫上螢幕時忽略，不要記一發幽靈彈著
    var pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    var q = pt.matrixTransform(ctm.inverse());
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
      var p = pos(ev); if (!p) return;
      ev.preventDefault(); active = ev.pointerId; try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      onPreview(p);
    });
    svg.addEventListener('pointermove', function (ev) { if (ev.pointerId === active) { var p = pos(ev); if (!p) return; ev.preventDefault(); onPreview(p); } });
    svg.addEventListener('pointerup', function (ev) { if (ev.pointerId === active) { var p = pos(ev); active = null; onPreview(null); if (p) onCommit(p); } });
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
  function stat(k, v, s, wide, id) { return '<div class="stat' + (wide ? ' wide' : '') + '"' + (id ? ' data-mod="' + id + '" data-mod-name="' + App.esc(String(k)) + '"' : '') + '><div class="k">' + k + '</div><div class="v">' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>'; }
  function offsetText(x, y) {
    var h = Math.abs(x) < 0.005 ? '' : (x > 0 ? wrT('core.right_2') : wrT('core.left_2')) + f2(Math.abs(x)) + 'mm';
    var v = Math.abs(y) < 0.005 ? '' : (y > 0 ? wrT('core.up') : wrT('core.down')) + f2(Math.abs(y)) + 'mm';
    return [h, v].filter(Boolean).join(wrT('app.x_2')) || '0';
  }
  function renderStats(box, t, st) {
    if (!st.n) { box.innerHTML = wrT('app.no_data_yet', [stat(wrT('app.60_shot_projection'), '—', '', false, 'p60')]); return; }
    var h = '';
    h += stat(wrT('app.shots'), st.n, '', false, 'n');
    h += stat(wrT('app.total'), st.total, wrT('app.decimal', [f1(st.totalDec)]), false, 'total');
    h += stat(wrT('app.average'), f2(st.avg), wrT('app.decimal', [f2(st.avgDec)]), false, 'avg');
    h += stat(wrT('app.60_shot_projection'), st.proj60, wrT('app.decimal', [f1(st.proj60Dec)]), false, 'p60');
    h += stat(wrT('app.s', [t.innerTen.label]), st.inner, t.id === 'ar10' ? wrT('app.white_10_dot_completely_shot') : wrT('app.touches_the_5_0mm_inner'), false, 'inner');
    h += stat(wrT('app.mean_offset'), wrT.dir(st.direction), wrT('app.mean_distance_from_center_mm', [offsetText(st.meanX, st.meanY), f2(st.meanR)]), false, 'offset');
    h += stat(wrT('app.group_size'), f2(st.groupSize) + 'mm', st.groupPair ? wrT('app.shots_and_center_to_center', [st.groupPair[0] + 1, st.groupPair[1] + 1]) : '', false, 'group');
    h += stat(wrT('app.shots_per_ring'), wrT('app.10_9', [st.counts[10], st.counts[9]]), wrT('app.8_7_below_7', [st.counts[8], st.counts[7], st.counts.below7]), true, 'rings');
    if (st.series.length) h += stat(wrT('app.subtotal_per_10_shots'), st.series.map(function (s) { return s.total; }).join(' / '), st.series.map(function (s) { return wrT('app.shots_2', [s.from, s.to, s.total, f1(s.totalDec)]); }).join('<br>'), true, 'series');
    box.innerHTML = h;
  }
  function shotTable(shots) {
    if (!shots.length) return '';
    var h = wrT('app.ring_decimal_inner_10_x');
    shots.forEach(function (q, i) { h += '<tr><td>' + (i + 1) + '</td><td>' + q.ring + '</td><td>' + f1(q.dec) + '</td><td>' + (q.inner ? '✓' : '') + '</td><td>' + f2(q.x) + '</td><td>' + f2(q.y) + '</td><td>' + f2(q.d) + '</td></tr>'; });
    return h + '</table>';
  }

  // --- 觸控：單指＝點選（按住可拖曳，放開才記錄）；雙指＝縮放／平移；滾輪縮放（電腦） ---
  function attachZoom(svg, S) {
    var ptrs = {}, tapId = null, tapOk = false, pinch = null;
    function count() { return Object.keys(ptrs).length; }
    function raw(ev, lift) {
      var ctm = svg && svg.getScreenCTM && svg.getScreenCTM();
      if (!ctm) return null;
      var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY - (lift || 0); var q = pt.matrixTransform(ctm.inverse());
      return { x: q.x, y: q.y };
    }
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
      S.clamp(); (S.apply || App.liteApplyView)();
    }
    svg.addEventListener('pointerdown', function (ev) {
      if (!S.active()) return;
      ev.preventDefault(); try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var n = count();
      if (n === 1) { var p0 = raw(ev, S.lift()); if (!p0) { delete ptrs[ev.pointerId]; return; } tapId = ev.pointerId; tapOk = true; S.down(p0); }
      else { if (tapOk) { tapOk = false; S.cancel(); } if (n === 2) pinchStart(); }
    });
    svg.addEventListener('pointermove', function (ev) {
      if (!ptrs[ev.pointerId]) return; ev.preventDefault();
      ptrs[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (pinch) pinchMove(); else if (tapOk && ev.pointerId === tapId) { var pm = raw(ev, S.lift()); if (pm) S.move(pm); }
    });
    function end(ev, cancel) {
      if (!ptrs[ev.pointerId]) return;
      var p = (!cancel && tapOk && ev.pointerId === tapId && !pinch) ? raw(ev, S.lift()) : null, commit = !!(p);
      delete ptrs[ev.pointerId];
      if (ev.pointerId === tapId) { tapOk = false; tapId = null; if (!commit) S.cancel(); }
      if (count() < 2 && pinch) { pinch = null; (S.render || App.renderLite)(); }
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
      S.clamp(); (S.render || App.renderLite)();
    }, { passive: false });
  }

  // ---------- 共用 ----------
  function ask(msg, onYes, onNo, o) { // o（v1.8.0）：{ yes:'按鈕文字', danger:true＝紅色按鈕 }
    o = o || {};
    var bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = wrT('app.cancel_ok', [o.danger ? ' danger' : '']);
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
    if (name === 'records') App.renderRecords();
    if (name === 'analysis') App.renderAnalysis();
    if (name === 'about' && App.stSub && App.stSub.cur === 'acct') { try { App.renderAcct(); } catch (e) {} }
    try { App.syncTargetSel(); } catch (e) {}
    document.body.classList.toggle('on-predict', name === 'predict');
    document.body.classList.toggle('on-ghost', name === 'ghost');
    document.body.classList.toggle('on-analysis', name === 'analysis');
    if (name !== 'ghost') { try { App.ghPrev = null; } catch (e) {} }
    if (name === 'ghost') App.renderGhost();
    if (window.WRDock) { if (name === 'analysis') WRDock.shown(); else WRDock.left(); }
    document.querySelectorAll('#liteMoreSheet [data-act]').forEach(function (b) { b.classList.toggle('on', b.dataset.act === name); });
    if (document.body.classList.contains('lite')) App.renderLite();
    if (name === 'predict') App.liteLayout();
    if (name === 'ghost') App.ghLayout();
    if (App.nav) App.nav.sync(name);
    if (toCmp && !document.body.classList.contains('lite')) { var hc = $('cmpHead'); if (hc && hc.scrollIntoView) hc.scrollIntoView({ block: 'start' }); }
  }
})(window.WRApp = window.WRApp || {});
