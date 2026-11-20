/* WRbeta v2.5.0 分析模塊：左上角圖示＋點圖示看說明、新模塊（潛在分數熱圖、Teiler、每發方向箭頭、散布圈）、預報對照模塊（預報→實際箭頭、預報 vs 實際群中心、預報誤差趨勢）
 * 只做畫面與文字；計算都在 core.js（Node 可測）。圖示是 index.html 裡的 <symbol id="ic-…">（顏色跟著 currentColor，所有主題通用）。
 * 解說文字在語言檔 mods.*；WRbeta 自己的經驗法則一律標「練習參考，不是 ISSF 規則」。
 */
(function (App) {
  'use strict';
  var C = App.C, $ = App.$, f1 = App.f1, f2 = App.f2, MODS_KEY = 'mods.';
  function esc(x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // 模塊 id（data-mod）→ 圖示
  var ICON = { n: 'ic-n', total: 'ic-total', avg: 'ic-avg', p60: 'ic-p60', inner: 'ic-inner', offset: 'ic-offset', group: 'ic-group', rings: 'ic-rings', series: 'ic-series',
    adv: 'ic-adv', stab: 'ic-stab', out: 'ic-out', trend: 'ic-trend', hist: 'ic-hist', sheets: 'ic-sheets', list: 'ic-list',
    heat: 'ic-heat', teiler: 'ic-teiler', dir: 'ic-dir', spread: 'ic-spread', callact: 'ic-callact', centers: 'ic-centers', calltrend: 'ic-calltrend' };
  function icon(id, cls) { return '<svg class="' + (cls || 'mod-svg') + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + ICON[id] + '"/></svg>'; }
  // 去掉標題前面的 emoji（v2.5.0 起由左上圖示取代）
  function plain(title) { return String(title).replace(/^[^\p{L}\p{N}<]+/u, ''); }

  /* ---- 圖示＋說明 ---- */
  function decorate(root) {
    if (!root) return;
    root.querySelectorAll('[data-mod]').forEach(function (m) {
      var id = m.dataset.mod; if (!ICON[id] || m.querySelector(':scope .mod-ic')) return;
      var host = m.querySelector(':scope > .ana-ct') || m.querySelector(':scope > .k') || // v2.7.0：先找卡片標題 .ana-ct（趨勢卡內文也有 .k，之前圖示被插到內文那行，沒套到凸起版）
         m.querySelector(':scope summary') || m.firstElementChild || m;
      var name = m.dataset.modName || (host.textContent || '').trim();
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mod-ic'; b.dataset.ic = id;
      b.setAttribute('aria-label', wrT('mods.what_is', [name])); b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
      b.innerHTML = '<span class="mod-ic-b">' + icon(id) + '</span>';
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); if (pop && !pop.hidden && pop.dataset.id === id && pop._btn === b) closePop(); else openPop(b, id, name); };
      host.insertBefore(b, host.firstChild); m.classList.add('has-ic');
    });
  }
  var pop = null;
  function openPop(btn, id, name) {
    closePop();
    if (!pop) {
      pop = document.createElement('div'); pop.id = 'modPop'; pop.className = 'mod-pop wr-pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
      document.body.appendChild(pop);
      document.addEventListener('pointerdown', function (e) { if (pop && !pop.hidden && !e.target.closest('#modPop,.mod-ic')) closePop(); }, true);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop && !pop.hidden) closePop(); });
      window.addEventListener('scroll', function () { if (pop && !pop.hidden) place(); }, { passive: true });
      window.addEventListener('resize', function () { if (pop && !pop.hidden) place(); });
    }
    pop.dataset.id = id; pop._btn = btn; pop.setAttribute('aria-label', name);
    pop.innerHTML = '<div class="mod-pop-h">' + icon(id, 'mod-svg sm') + '<b>' + esc(name) + '</b><button type="button" class="mod-pop-x" aria-label="' + esc(wrT('mods.close')) + '">×</button></div><div class="mod-pop-tx">' + wrT(MODS_KEY + id) + '</div>';
    pop.querySelector('.mod-pop-x').onclick = function () { closePop(); try { btn.focus({ preventScroll: true }); } catch (e) {} };
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); place();
    if (App.back) App.back.push('modpop', closePop);
  }
  function place() {
    var b = pop._btn; if (!b || !b.isConnected) { closePop(); return; }
    var r = b.getBoundingClientRect(), vw = window.innerWidth || 400, vh = window.innerHeight || 800, w = Math.min(330, vw - 20);
    pop.style.width = w + 'px';
    var left = Math.max(10, Math.min(vw - w - 10, r.left - 6)), h = pop.offsetHeight, top = r.bottom + 6;
    if (top + h > vh - 10 && r.top - h - 6 > 10) top = r.top - h - 6;
    pop.style.left = left + 'px'; pop.style.top = Math.max(10, top) + 'px';
  }
  function closePop() {
    if (!pop || pop.hidden) return;
    pop.hidden = true; if (pop._btn) pop._btn.setAttribute('aria-expanded', 'false'); pop._btn = null;
    if (App.back) App.back.drop('modpop');
  }

  /* ---- 小靶面（模塊卡片內用）：ISSF 環徑照實際尺寸畫；view＝{cx,cy,E}（mm） ---- */
  var uid = 0;
  function miniTarget(t, view, inner, label) {
    var E = view.E, x0 = view.cx - E / 2, y0 = -view.cy - E / 2, sw = E / 260, h = '';
    h += '<svg class="mod-mini" viewBox="' + [x0, y0, E, E].map(function (v) { return C.round(v, 3); }).join(' ') + '" role="img" aria-label="' + esc(label || '') + '">';
    h += '<rect x="' + x0 + '" y="' + y0 + '" width="' + E + '" height="' + E + '" class="mm-paper"/>';
    h += '<circle r="' + t.blackDiam / 2 + '" class="mm-black"/>';
    for (var n = 1; n <= 10; n++) h += '<circle r="' + t.ringDiam[n] / 2 + '" class="' + (t.ringDiam[n] <= t.blackDiam + 1e-9 ? 'mm-ring-w' : 'mm-ring') + '" stroke-width="' + sw + '"/>';
    if (t.innerTen && t.innerTen.mode === 'ring') h += '<circle r="' + t.innerTen.diam / 2 + '" class="mm-ring-w" stroke-width="' + sw + '"/>';
    return h + inner(sw, E) + '</svg>';
  }
  function fitView(t, pts, minE) { // 把所有點框進來（含彈孔半徑與邊界）
    if (!pts.length) return { cx: 0, cy: 0, E: t.cardSize };
    var a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    pts.forEach(function (p) { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.y); d = Math.max(d, p.y); });
    var E = Math.max(b - a, d - c) + t.pellet * 2.4; E = Math.max(E, minE || t.pellet * 6); E = Math.min(E, t.cardSize);
    return { cx: (a + b) / 2, cy: (c + d) / 2, E: E };
  }
  function cross(x, y, s, cls, sw) { return '<path d="M' + (x - s) + ' ' + (-y) + 'H' + (x + s) + 'M' + x + ' ' + (-y - s) + 'V' + (-y + s) + '" class="' + cls + '" stroke-width="' + sw + '"/>'; }
  function hole(t, p, cls, sw) { return '<circle cx="' + C.round(p.x, 3) + '" cy="' + C.round(-p.y, 3) + '" r="' + t.pellet / 2 + '" class="' + cls + '" stroke-width="' + sw + '"/>'; }

  /* ---- 新模塊（分析頁＋預報對照分析共用）---- */
  function lab(set, i, single) { var x = set[i]; return single || !x.sheet ? String(x.i) : x.sheet + '-' + x.i; }
  function card(id, title, body, cls) { return '<div class="ana-card mod-new ' + (cls || '') + '" data-mod="' + id + '" data-mod-name="' + esc(plain(title)) + '"><div class="ana-ct">' + esc(plain(title)) + '</div>' + body + '</div>'; }
  function teilerCard(t, shots, set, single) {
    var tl = C.teiler(t, shots); if (!tl.n) return '';
    var worst = 0; tl.list.forEach(function (v, i) { if (v > tl.list[worst]) worst = i; });
    var h = '<div class="mod-kv"><div><small>' + wrT('mods.teiler_best') + '</small><b>' + tl.best + '</b><em>' + wrT('mods.shot_no', [lab(set, tl.bestIdx, single)]) + '</em></div>'
      + '<div><small>' + wrT('mods.teiler_avg') + '</small><b>' + Math.round(tl.avg) + '</b><em>' + wrT('mods.teiler_mm', [f2(tl.avg / 100)]) + '</em></div>'
      + '<div><small>' + wrT('mods.teiler_worst') + '</small><b>' + tl.list[worst] + '</b><em>' + wrT('mods.shot_no', [lab(set, worst, single)]) + '</em></div></div>';
    h += '<div class="mod-chips">' + tl.list.map(function (v, i) { return '<span class="mod-chip' + (i === tl.bestIdx ? ' best' : '') + '"><i>' + esc(lab(set, i, single)) + '</i>' + v + '</span>'; }).join('') + '</div>';
    h += '<div class="s mod-note">' + wrT('mods.teiler_note') + '</div>';
    return card('teiler', wrT('mods.t_teiler'), h, 'lay-full');
  }
  function arrowSVG(ang, centered) {
    if (centered) return '<svg class="mod-arr" viewBox="-10 -10 20 20" aria-hidden="true"><circle r="3.2" class="ar-dot"/></svg>';
    return '<svg class="mod-arr" viewBox="-10 -10 20 20" aria-hidden="true"><g transform="rotate(' + C.round(-ang, 1) + ')"><path d="M-6.5 0H5.5M1.8 -3.8L5.8 0L1.8 3.8" class="ar-ln"/></g></svg>';
  }
  function dirCard(t, st, set, single) {
    if (!st.n) return '';
    var th = C.ringWidth(t) * 0.1; // 和校正建議同一個「置中」門檻（環寬的 1/10）
    var h = '<div class="mod-chips dir">' + st.shots.map(function (q, i) {
      var d = C.shotDir(q, th); return '<span class="mod-chip"><i>' + esc(lab(set, i, single)) + '</i>' + arrowSVG(d.angle, d.centered) + '<span class="dc">' + (d.centered ? wrT('mods.centered_short') : wrT('mods.clock', [d.clock])) + '</span><b>' + f1(q.dec) + '</b></span>';
    }).join('') + '</div>';
    h += '<div class="s mod-note">' + wrT('mods.dir_note') + '</div>';
    return card('dir', wrT('mods.t_dir'), h, 'lay-full');
  }
  function spreadCard(t, shots) {
    var sp = C.spread(shots); if (!sp) return '';
    var h = '<div class="mod-kv">'
      + '<div><small>' + wrT('mods.mean_radius') + '</small><b>' + f1(sp.meanRadius) + '<i>mm</i></b></div>'
      + '<div><small>' + wrT('mods.mec') + '</small><b>' + f1(sp.mec.r * 2) + '<i>mm</i></b><em>' + wrT('mods.diameter_center_to_center') + '</em></div>'
      + '<div><small>' + wrT('mods.h_spread') + '</small><b>' + f1(sp.width) + '<i>mm</i></b></div>'
      + '<div><small>' + wrT('mods.v_spread') + '</small><b>' + f1(sp.height) + '<i>mm</i></b></div></div>';
    if (sp.n >= 2) {
      var v = fitView(t, [{ x: sp.mec.x - sp.mec.r, y: sp.mec.y - sp.mec.r }, { x: sp.mec.x + sp.mec.r, y: sp.mec.y + sp.mec.r }], t.pellet * 5);
      h += '<div class="mod-fig">' + miniTarget(t, v, function (sw, E) {
        var g = '';
        shots.forEach(function (p) { g += hole(t, p, 'mm-hole', sw); });
        g += '<circle cx="' + sp.mec.x + '" cy="' + (-sp.mec.y) + '" r="' + sp.mec.r + '" class="mm-mec" stroke-width="' + sw * 2.2 + '"/>';
        g += '<circle cx="' + sp.mpi.x + '" cy="' + (-sp.mpi.y) + '" r="' + sp.meanRadius + '" class="mm-mr" stroke-width="' + sw * 2.2 + '" stroke-dasharray="' + E / 60 + ' ' + E / 90 + '"/>';
        g += cross(sp.mpi.x, sp.mpi.y, E / 30, 'mm-mpi', sw * 2.4);
        return g;
      }, wrT('mods.t_spread')) + '<div class="mod-legend"><span><i class="lg mr"></i>' + wrT('mods.mean_radius') + '</span><span><i class="lg mec"></i>' + wrT('mods.mec') + '</span><span><i class="lg mpi"></i>' + wrT('mods.mpi') + '</span></div></div>';
    }
    h += '<div class="s mod-note">' + wrT('mods.spread_note', [f2(sp.sdX), f2(sp.sdY)]) + '</div>';
    return card('spread', wrT('mods.t_spread'), h, 'lay-full');
  }
  // 潛在分數：先出數字，熱圖之後慢慢畫（不卡畫面）
  var potCache = {}, potKeys = [];
  function sig(t, shots) { return t.id + ':' + shots.map(function (p) { return C.round(p.x, 2) + ',' + C.round(p.y, 2); }).join(';'); }
  function cached(key, make) { if (potCache[key]) return potCache[key]; var v = make(); potCache[key] = v; potKeys.push(key); if (potKeys.length > 6) delete potCache[potKeys.shift()]; return v; }
  function heatCard(t, shots) {
    if (!shots.length) return '';
    var key = sig(t, shots), r = cached('p|' + key, function () { return C.potentialScore(t, shots); });
    var mv = r.move, near = mv.dist < C.ringWidth(t) * 0.1;
    var h = '<div class="mod-kv">'
      + '<div><small>' + wrT('mods.score_now') + '</small><b>' + f1(r.actual) + '</b></div>'
      + '<div><small>' + wrT('mods.score_potential') + '</small><b>' + f1(r.potential) + '</b><em>' + wrT('mods.of_max', [f1(r.max)]) + '</em></div>'
      + '<div class="loss"><small>' + wrT('mods.loss_center') + '</small><b>−' + f1(r.lossCenter) + '</b></div>'
      + '<div class="loss"><small>' + wrT('mods.loss_size') + '</small><b>−' + f1(r.lossSize) + '</b></div></div>';
    h += '<div class="mod-move">' + (near ? wrT('mods.move_none') : wrT('mods.move', [wrT.dir(mv.dir).replace(wrT.dir('偏'), ''), f1(mv.dist), offTxt(mv.dx, mv.dy)])) + '</div>';
    h += '<div class="mod-fig heat"><canvas class="mod-heat" width="300" height="300" data-heat="' + esc(key) + '" role="img" aria-label="' + esc(wrT('mods.t_heat')) + '"></canvas><div class="mod-heat-wait">' + wrT('mods.heat_drawing') + '</div>'
      + '<div class="mod-legend"><span><i class="lg now"></i>' + wrT('mods.legend_now') + '</span><span><i class="lg best">★</i>' + wrT('mods.legend_best') + '</span><span class="ramp"><i></i>' + wrT('mods.legend_ramp') + '</span></div></div>';
    h += '<div class="s mod-note">' + wrT('mods.heat_note') + '</div>';
    heatJobs[key] = { t: t, shots: shots.slice(), r: r };
    return card('heat', wrT('mods.t_heat'), h, 'lay-full');
  }
  function offTxt(dx, dy) {
    var p = [];
    if (Math.abs(dx) >= 0.05) p.push((dx > 0 ? wrT('core.right_2') : wrT('core.left_2')) + f1(Math.abs(dx)) + 'mm');
    if (Math.abs(dy) >= 0.05) p.push((dy > 0 ? wrT('core.up') : wrT('core.down')) + f1(Math.abs(dy)) + 'mm');
    return p.join(wrT('core.x_3'));
  }
  var heatJobs = {}, heatToken = 0, SIZE = 41;
  function idle(fn) { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 120 }); else setTimeout(fn, 16); }
  function paintHeat(cv, job, rows) {
    var g = C.potentialGrid(job.t, job.shots, SIZE), ctx = cv.getContext('2d'); if (!ctx || !g) return;
    var W = cv.width, cell = W / SIZE, lo = Infinity, hi = -Infinity;
    rows.forEach(function (row) { row.forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
    var span = Math.max(0.1, hi - lo);
    // 先畫在 41×41 的小畫布，再平滑放大（看起來像連續的熱圖；每格仍是實際算出來的分數）
    var sm = document.createElement('canvas'); sm.width = SIZE; sm.height = SIZE; var sc = sm.getContext('2d'), img = sc.createImageData(SIZE, SIZE);
    rows.forEach(function (row, j) { row.forEach(function (v, i) { var c = rampRGB((v - lo) / span), o = (j * SIZE + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }); });
    sc.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
    ctx.drawImage(sm, 0, 0, SIZE, SIZE, -cell / 2, -cell / 2, W + cell, W + cell);
    var R = g.range, X = function (x) { return (x + R) / (2 * R) * W; }, Y = function (y) { return (R - y) / (2 * R) * W; }, S = W / (2 * R);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.55)';
    for (var n = 1; n <= 10; n++) { var rr = job.t.ringDiam[n] / 2 * S; if (rr > W * 1.5) continue; ctx.beginPath(); ctx.arc(X(0), Y(0), rr, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), W); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    var m = job.r.mpi, b = job.r.best;
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(m.x), Y(m.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
    star(ctx, X(b.x), Y(b.y), 9);
  }
  function star(ctx, x, y, r) { ctx.beginPath(); for (var k = 0; k < 10; k++) { var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); }
  function rampRGB(u) { // 冷→暖：深藍、青、黃、橘、紅
    var st = [[0, [30, 40, 110]], [0.35, [20, 150, 170]], [0.65, [245, 210, 60]], [0.85, [245, 120, 30]], [1, [215, 30, 40]]];
    u = Math.max(0, Math.min(1, u));
    for (var i = 1; i < st.length; i++) if (u <= st[i][0]) { var a = st[i - 1], b = st[i], k = (u - a[0]) / (b[0] - a[0]); return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + (b[1][c] - a[1][c]) * k); }); }
    return [215, 30, 40];
  }
  function ramp(u) { return 'rgb(' + rampRGB(u).join(',') + ')'; }
  // 畫面重畫後：補上熱圖（有快取就直接畫，沒有就分段算，每次閒置算幾行）
  function after(root) {
    decorate(root);
    var cvs = root ? root.querySelectorAll('canvas[data-heat]') : []; if (!cvs.length) return;
    var token = ++heatToken;
    cvs.forEach(function (cv) {
      var key = cv.dataset.heat, job = heatJobs[key]; if (!job) return;
      var rowsKey = 'g|' + key, done = potCache[rowsKey];
      if (done) { paintHeat(cv, job, done); cv.parentNode.classList.add('ready'); return; }
      var g = C.potentialGrid(job.t, job.shots, SIZE), rows = [], j = 0;
      (function step() {
        if (token !== heatToken || !cv.isConnected) return;
        var t0 = Date.now(); while (j < SIZE && Date.now() - t0 < 12) rows.push(g.row(j++));
        if (j < SIZE) { idle(step); return; }
        cached(rowsKey, function () { return rows; }); paintHeat(cv, job, rows); cv.parentNode.classList.add('ready');
      })();
    });
  }

  /* ---- 預報對照模塊（pairs＝C.comparePredictions 的 pairs，可以是多輪合起來的）---- */
  function callactCard(t, pairs) {
    if (!pairs.length) return '';
    var pts = []; pairs.forEach(function (q) { pts.push(q.pred, q.act); });
    var v = fitView(t, pts, t.pellet * 6), mk = 'mkca' + (++uid);
    var h = '<div class="mod-fig">' + miniTarget(t, v, function (sw, E) {
      var g = '<defs><marker id="' + mk + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="mm-arrowhead"/></marker></defs>';
      pairs.forEach(function (q) { g += hole(t, q.act, 'mm-act', sw); });
      pairs.forEach(function (q) {
        g += '<circle cx="' + C.round(q.pred.x, 3) + '" cy="' + C.round(-q.pred.y, 3) + '" r="' + t.pellet / 4 + '" class="mm-pred" stroke-width="' + sw * 2 + '"/>';
        if (q.err > t.pellet / 4) g += '<line x1="' + C.round(q.pred.x, 3) + '" y1="' + C.round(-q.pred.y, 3) + '" x2="' + C.round(q.act.x, 3) + '" y2="' + C.round(-q.act.y, 3) + '" class="mm-arrow" stroke-width="' + sw * 2.4 + '" marker-end="url(#' + mk + ')"/>';
      });
      return g;
    }, wrT('mods.t_callact')) + '<div class="mod-legend"><span><i class="lg pred"></i>' + wrT('mods.legend_call') + '</span><span><i class="lg act"></i>' + wrT('mods.legend_actual') + '</span></div></div>';
    var se = 0; pairs.forEach(function (q) { se += q.err; });
    h += '<div class="s mod-note">' + wrT('mods.callact_note', [pairs.length, f2(se / pairs.length)]) + '</div>';
    return card('callact', wrT('mods.t_callact'), h, 'lay-full');
  }
  function centersCard(t, pairs) {
    var cc = C.callCenters(pairs); if (!cc) return '';
    var dir = C.directionText(cc.dx, cc.dy, C.ringWidth(t) * 0.1), v = fitView(t, [cc.pred, cc.act], t.pellet * 6);
    var h = '<div class="mod-kv"><div><small>' + wrT('mods.center_gap') + '</small><b>' + f1(cc.dist) + '<i>mm</i></b><em>' + (dir === '置中' ? wrT('mods.same_place') : wrT('mods.actual_vs_call', [wrT.dir(dir)])) + '</em></div>'
      + '<div><small>' + wrT('mods.gap_xy') + '</small><b class="sm">' + (offTxt(cc.dx, cc.dy) || '0.0mm') + '</b></div></div>';
    h += '<div class="mod-fig">' + miniTarget(t, v, function (sw, E) {
      var s = E / 18;
      return '<line x1="' + cc.pred.x + '" y1="' + (-cc.pred.y) + '" x2="' + cc.act.x + '" y2="' + (-cc.act.y) + '" class="mm-gap" stroke-width="' + sw * 2 + '" stroke-dasharray="' + E / 70 + ' ' + E / 110 + '"/>'
        + cross(cc.pred.x, cc.pred.y, s, 'mm-cpred', sw * 3) + cross(cc.act.x, cc.act.y, s, 'mm-cact', sw * 3);
    }, wrT('mods.t_centers')) + '<div class="mod-legend"><span><i class="lg cpred"></i>' + wrT('mods.legend_call_center') + '</span><span><i class="lg cact"></i>' + wrT('mods.legend_actual_center') + '</span></div></div>';
    h += '<div class="s mod-note">' + wrT('mods.centers_note') + '</div>';
    return card('centers', wrT('mods.t_centers'), h, 'lay-full');
  }
  function calltrendCard(pairs) {
    if (pairs.length < 2) return card('calltrend', wrT('mods.t_calltrend'), '<div class="s">' + wrT('mods.calltrend_need') + '</div>', 'lay-full');
    var vals = pairs.map(function (q) { return q.err; }), tr = C.trend(vals, 0.5);
    var h = '<div class="ana-k2">' + wrT('mods.calltrend_head', [App.trTag(tr, false, tr.dir === '上升' || tr.dir === '下降' ? ' ' + (tr.change > 0 ? '+' : '') + f1(tr.change) + 'mm' : '')]) + '</div>'
      + App.lineChart(vals, pairs.map(function (q, i) { return q.lab || String(i + 1); }), { trend: true, dp: 1, minSpan: 2, color: '#e8590c', title: wrT('mods.t_calltrend') });
    h += '<div class="s mod-note">' + wrT('mods.calltrend_note') + '</div>';
    return card('calltrend', wrT('mods.t_calltrend'), h, 'lay-full');
  }

  App.mods = { ICON: ICON, decorate: decorate, after: after, closePop: closePop, plain: plain, teilerCard: teilerCard, dirCard: dirCard, spreadCard: spreadCard, heatCard: heatCard,
    callactCard: callactCard, centersCard: centersCard, calltrendCard: calltrendCard, ramp: ramp };
})(window.WRApp = window.WRApp || {});
