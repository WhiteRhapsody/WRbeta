/* WRbeta v3.1.0 小白單「補讀」（window.WRSiusReread；Node 也能 require）。【White 2026-11-27 18:38「開工」】
 * 參考外部 AI 引擎 v2.2 的四招，改寫成我們的流程（Tesseract 字框＋分段灰階圖）：
 *   1. 發號只在時間欄左邊固定範圍找：補讀時把「時間欄往左超過一般發號位置」的雜訊（桌面、紙邊）塗白。
 *   2. 行距突然變大（中間像漏了一行）或一行高得像兩行黏在一起 → 那一段放大 2 倍再讀一次。
 *   3. 補讀前先把方向箭頭塗白（箭頭常被讀成 # & « 等雜字，擠壞旁邊的發號和分數）。
 *   4. 像素檢查負號：X／Y 數字框左邊有一條「中間一橫、上下空白」的短橫線 → 負號（OCR 漏掉時補上）。
 * 只產生「多一種讀法」交給原本的合併投票，不直接改值、不杜撰數字。 */
(function (root) {
  'use strict';
  function AR() { return root.WRSiusArrow || (typeof require === 'function' ? require('./sius-arrow.js') : null); }
  function P() { return root.WRSiusXParse || (typeof require === 'function' ? require('./sius-x-parse.js') : null); }
  var CFG = { minusAxes: 'y',  on: true, minus: true, gaps: true, failed: true, maxCrops: 30, zoom: 2 };
  var RT = /\d{1,2}\s?[:;.,-]\s?\d{2}[.,]\d/;
  function med(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  // Tesseract blocks → 跟 text.split('\n') 對齊的 [{ bbox, words }]
  function lineGeo(data) {
    var A = AR(), tl = String((data && data.text) || '').split('\n'), out = new Array(tl.length).fill(null), cur = 0;
    if (!A || !data || !data.blocks) return out;
    A.blockLines(data).forEach(function (L) {
      var t = L.text.trim(); if (!t) return;
      for (var i = cur; i < tl.length; i++) if (tl[i].trim() === t) { out[i] = { bbox: L.bbox, words: L.words, text: t }; cur = i + 1; return; }
    });
    return out;
  }
  function timeWord(W) { for (var i = 0; i < W.length; i++) if (RT.test(W[i].t) && W[i].t.length >= 6) return i; return -1; }
  // ---- 4. 負號像素檢查（照外部 AI has_minus_left_of_box 改寫）----
  function pct(arr, p) { if (!arr.length) return 0; var s = Array.prototype.slice.call(arr).sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p / 100)))]; }
  function region(G, x1, y1, x2, y2) { x1 = Math.max(0, Math.round(x1)); y1 = Math.max(0, Math.round(y1)); x2 = Math.min(G.w, Math.round(x2)); y2 = Math.min(G.h, Math.round(y2)); var w = x2 - x1, h = y2 - y1; if (w <= 0 || h <= 0) return null; var o = new Uint8Array(w * h); for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) o[y * w + x] = G.g[(y1 + y) * G.w + x1 + x]; return { a: o, w: w, h: h }; }
  function minusLeft(G, x, y, w, h) {
    var sw = Math.max(8, Math.round(h * 0.92)), x1 = Math.max(0, x - sw), x2 = Math.max(0, x - 1); if (x2 - x1 < 4) return false;
    var mid = region(G, x1, y + h * 0.30, x2, y + h * 0.70), top = region(G, x1, y, x2, y + h * 0.28), bot = region(G, x1, y + h * 0.72, x2, y + h), loc = region(G, x1, y - 4, x + w, y + h + 4);
    if (!mid || !top || !bot || !loc) return false;
    var th = pct(loc.a, 90) - 30, dark = function (R) { var n = 0; for (var i = 0; i < R.a.length; i++) if (R.a[i] < th) n++; return n / R.a.length; };
    var run = 0, best = 0; for (var cx = 0; cx < mid.w; cx++) { var any = false; for (var cy = 0; cy < mid.h; cy++) if (mid.a[cy * mid.w + cx] < th) { any = true; break; } if (any) { run++; if (run > best) best = run; } else run = 0; }
    var tb = new Uint8Array(top.a.length + bot.a.length); tb.set(top.a); tb.set(bot.a, top.a.length);
    return best >= Math.max(4, Math.round(h * 0.2)) && dark(top) < 0.14 && dark(bot) < 0.14 && (pct(tb, 50) - pct(mid.a, 10)) >= 22;
  }
  // 每行：{ x: true/false, y: true/false }（只看 OCR 沒讀到負號的數字）
  function minusHints(G, geo) {
    if (!CFG.on || !CFG.minus) return null;
    var out = new Array(geo.length).fill(null), any = false;
    geo.forEach(function (L, li) {
      if (!L || !L.words) return; var W = L.words, ti = timeWord(W); if (ti < 0) return;
      var boxes = [];
      for (var i = ti + 1; i < W.length && boxes.length < 2; i++) {
        var t = W[i].t, b = W[i].b, n = t.length; if (!n) continue;
        var parts = t.split('/'), off = 0;
        parts.forEach(function (pt) { if (boxes.length >= 2) return; var m = pt.match(/^([-~=<]*)(\d{1,2}[.,]\d{2})/); if (m) { var cw = (b.x1 - b.x0) / n, s = off + m[1].length; boxes.push({ neg: !!m[1], x0: b.x0 + cw * s, y0: b.y0, y1: b.y1 }); } off += pt.length + 1; });
      }
      var o = {}; ['x', 'y'].forEach(function (f, k) { var B = boxes[k]; if (CFG.minusAxes.indexOf(f) >= 0 && B && !B.neg && minusLeft(G, Math.round(B.x0), B.y0, 4, B.y1 - B.y0)) { o[f] = true; any = true; } });
      if (o.x || o.y) out[li] = o;
    });
    return any ? out : null;
  }
  // ---- 1～3. 補讀範圍 ----
  function blankArrow(G2, L, ox, oy) { // 在裁好的圖上把這行的箭頭塗白
    var A = AR(); if (!A) return; var c = A.cellOf(L); if (!c) return;
    var B = A.blob(G2, { x0: c.x0 - ox, x1: c.x1 - ox, y0: c.y0 - oy, y1: c.y1 - oy, cw: c.cw, ax: c.ax - ox }); if (!B) return;
    B.px.forEach(function (j) { var x = B.x0 + j % B.w, y = B.y0 + ((j / B.w) | 0); for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < G2.w && Y < G2.h) G2.g[Y * G2.w + X] = 255; } });
  }
  function plan(G, text, geo, I, popt) {
    popt = popt || {}; var focus = popt.focus || null; // focus：{ 發號: 1 }＝別張照片還沒綠的發，這張照片的這幾行一定補讀
    if (!CFG.on || !G || !geo) return [];
    var tl = String(text || '').split('\n'), Pp = P(), sh = [];
    geo.forEach(function (L, li) { if (L && L.bbox && RT.test(L.text)) sh.push({ li: li, L: L, cy: (L.bbox.y0 + L.bbox.y1) / 2, h: L.bbox.y1 - L.bbox.y0 }); });
    if (sh.length < 3) return [];
    var d = []; for (var i = 1; i < sh.length; i++) d.push(sh[i].cy - sh[i - 1].cy);
    var pitch = med(d.filter(function (v) { return v > 0; })), lh = med(sh.map(function (s) { return s.h; })); if (!(pitch > 4) || !(lh > 3)) return [];
    // 1. 發號範圍：時間欄左邊 →（時間 x0 − 發號 x0）的中位數 × 1.35 以外塗白
    var off = [], tx = []; sh.forEach(function (s) { var W = s.L.words || [], ti = timeWord(W); if (ti > 0 && /^[0-9TlIO|]{1,3}$/.test(W[0].t)) { off.push(W[ti].b.x0 - W[0].b.x0); tx.push(W[ti].b.x0); } });
    var cut = off.length >= 3 ? med(tx) - med(off) * 1.35 : null;
    var crops = [], add = function (y0, y1, why, ls) { if (crops.length >= CFG.maxCrops) return; y0 = Math.max(0, y0); y1 = Math.min(G.h, y1); if (y1 - y0 < lh * 0.8) return; crops.push({ y0: y0, y1: y1, why: why, ls: ls }); };
    for (i = 1; i < sh.length; i++) { // 2. 行距缺口
      if (!CFG.gaps) break; var a = sh[i - 1], b = sh[i], g = b.cy - a.cy;
      if (g > pitch * 1.6 && g < pitch * 4.5) add(a.cy + pitch * 0.45, b.cy - pitch * 0.45, 'gap', [a.L, b.L]);
    }
    sh.forEach(function (s) { // 2. 兩行黏一起；3. 讀不完整的行
      if (s.h > lh * 1.6) { add(s.L.bbox.y0 - lh * 0.15, s.L.bbox.y1 + lh * 0.15, 'tall', [s.L]); return; }
      if (!CFG.failed) return; var p = null; try { p = Pp.parseShot(tl[s.li]); } catch (e) { p = null; }
      if (!p || p.x == null || p.y == null || p.dec == null || !(p.nc && p.nc.length)) add(s.cy - pitch * 0.62, s.cy + pitch * 0.62, 'fail', [s.L]);
      else if (focus && p.nc.some(function (n) { return focus[n]; })) add(s.cy - pitch * 0.62, s.cy + pitch * 0.62, 'focus', [s.L]);
    });
    // 重疊的合併
    crops.sort(function (x, y) { return x.y0 - y.y0; }); var mg = [];
    crops.forEach(function (c) { var l = mg[mg.length - 1]; if (l && c.y0 <= l.y1) { l.y1 = Math.max(l.y1, c.y1); l.ls = l.ls.concat(c.ls); l.why += '+' + c.why; } else mg.push(c); });
    return mg.map(function (c) {
      var G2 = I.crop(G, 0, c.y0, G.w, c.y1), oy = Math.max(0, Math.round(c.y0));
      geo.forEach(function (L) { if (L && L.bbox && L.bbox.y1 > c.y0 && L.bbox.y0 < c.y1) blankArrow(G2, L, 0, oy); }); // 3. 箭頭塗白
      if (cut != null && cut > 4) for (var y = 0; y < G2.h; y++) for (var x = 0; x < Math.min(G2.w, Math.round(cut)); x++) G2.g[y * G2.w + x] = 255; // 1. 發號範圍外塗白
      var pad = Math.round(lh * 0.6), W = G2.w, H = G2.h + pad * 2, G3 = { g: new Uint8ClampedArray(W * H).fill(255), w: W, h: H }; G3.g.set(G2.g, pad * W); // 上下留白，Tesseract 比較好切行
      return { G: I.resize(G3, CFG.zoom), why: c.why, y0: c.y0, y1: c.y1 };
    });
  }
  var api = { CFG: CFG, lineGeo: lineGeo, minusLeft: minusLeft, minusHints: minusHints, plan: plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WRSiusReread = api;
})(typeof window !== 'undefined' ? window : this);
