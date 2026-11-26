/* WRbeta v2.9.6 小白單「實驗引擎」前處理（window.WRSiusXImg；Node 也能 require）。
 * 從線上版 sius-img.js 與原型 (e) 的 plan2（裁紙、依行距切段、每段校正傾斜＋彎曲、第二種切法）複製出來，另成一份；線上版 window.WRSiusImg 不動。 */
/* WRbeta v2.9.3 小白單（SIUS）照片前處理：PROGRESS.md §7 備註8。
 * 純計算、沒有畫面：瀏覽器（sius-ocr.js 用 canvas 取像素）與 Node（測試用 jpeg 解碼）共用同一套，確保測試＝實際。
 * 影像一律用「灰階 Uint8 陣列」{ g, w, h }：
 *   toGray(RGBA) → resize（雙線性）→ flatten（除以局部背景，去掉陰影／反光）→ inkMask（亮底上的深色筆畫）
 *   → mainColumn（找出小白單那一條文字欄，排除旁邊其他單據、桌面、遙控器）→ estShear／shear（每一段各自校正傾斜：紙捲彎曲時上下段斜度不同）。
 * 不做任何「猜數字」：這裡只把照片整理成比較好讀的樣子，讀字交給 OCR，對不對交給 sius.js 用小計／總分／X·Y 重算去核對。 */
(function (root) {
  'use strict';
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function toGray(img) { // img：{ data: RGBA, width, height }
    var d = img.data, w = img.width, h = img.height, g = new Uint8ClampedArray(w * h);
    for (var i = 0, j = 0; i < w * h; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return { g: g, w: w, h: h };
  }
  function resize(G, s) {
    var W = Math.max(1, Math.round(G.w * s)), H = Math.max(1, Math.round(G.h * s)), o = new Uint8ClampedArray(W * H), gw = G.w, g = G.g;
    var xs = new Int32Array(W), xf = new Float32Array(W);
    for (var x = 0; x < W; x++) { var sx = Math.min(G.w - 1.001, Math.max(0, (x + 0.5) / s - 0.5)); xs[x] = Math.floor(sx); xf[x] = sx - xs[x]; }
    for (var y = 0; y < H; y++) {
      var sy = Math.min(G.h - 1.001, Math.max(0, (y + 0.5) / s - 0.5)), y0 = Math.floor(sy), fy = sy - y0, r0 = y0 * gw, r1 = r0 + gw;
      for (x = 0; x < W; x++) { var x0 = xs[x], fx = xf[x]; o[y * W + x] = (g[r0 + x0] * (1 - fx) + g[r0 + x0 + 1] * fx) * (1 - fy) + (g[r1 + x0] * (1 - fx) + g[r1 + x0 + 1] * fx) * fy; }
    }
    return { g: o, w: W, h: H };
  }
  // 方框模糊（積分圖，Uint32：灰階 ≤255，3400 萬像素以內不會溢位）
  function boxBlur(G, r) {
    var g = G.g, w = G.w, h = G.h, W1 = w + 1, I = new Uint32Array(W1 * (h + 1)), o = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) { var s = 0, ro = (y + 1) * W1, rp = y * W1; for (var x = 0; x < w; x++) { s += g[y * w + x]; I[ro + x + 1] = I[rp + x + 1] + s; } }
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (x = 0; x < w; x++) { var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1); o[y * w + x] = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0)); }
    }
    return { g: o, w: w, h: h };
  }
  function flatten(G, r, B) { B = B || boxBlur(G, r); var o = new Uint8ClampedArray(G.w * G.h); for (var i = 0; i < o.length; i++) o[i] = clamp8(G.g[i] / Math.max(1, B.g[i] + 8) * 235); return { g: o, w: G.w, h: G.h }; }
  function inkMask(G, r, B) { B = B || boxBlur(G, r); var m = new Uint8Array(G.w * G.h); for (var i = 0; i < m.length; i++) m[i] = B.g[i] > 120 && G.g[i] < B.g[i] * 0.72 ? 1 : 0; return m; }
  function crop(G, x0, y0, x1, y1) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(G.w, Math.round(x1)); y1 = Math.min(G.h, Math.round(y1));
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), o = new Uint8ClampedArray(w * h);
    for (var y = 0; y < h; y++) o.set(G.g.subarray((y + y0) * G.w + x0, (y + y0) * G.w + x0 + w), y * w);
    return { g: o, w: w, h: h };
  }
  // 小白單文字欄 [x0, x1]：每一欄「亮底上的墨點」加總、平滑後取墨量最多的一段（中間空隙 ≤3.5% 寬視為同一段）
  function mainColumn(G, m, y0, y1, gapPx) {
    y0 = y0 || 0; y1 = y1 || G.h; var w = G.w, col = new Float64Array(w), x, y;
    for (y = y0; y < y1; y++) { var ro = y * w; for (x = 0; x < w; x++) col[x] += m[ro + x]; }
    var R = Math.max(1, Math.round(w * 0.01)), sm = new Float64Array(w), s = 0, mx = 0;
    for (x = 0; x < w + R; x++) { if (x < w) s += col[x]; if (x - 2 * R - 1 >= 0 && x - 2 * R - 1 < w) s -= col[x - 2 * R - 1]; if (x - R >= 0 && x - R < w) { sm[x - R] = s; if (s > mx) mx = s; } }
    if (!mx) return null;
    var th = mx * 0.06, gap = gapPx || Math.round(w * 0.035), runs = [], st = -1, last = -1;
    for (x = 0; x < w; x++) if (sm[x] > th) { if (st < 0) st = x; else if (x - last > gap) { runs.push([st, last]); st = x; } last = x; }
    if (st >= 0) runs.push([st, last]);
    var best = null, bm = -1; runs.forEach(function (r) { var ms = 0; for (var k = r[0]; k <= r[1]; k++) ms += col[k]; if (ms > bm) { bm = ms; best = r; } });
    var pad = gapPx ? Math.round(gapPx * 1.5) : Math.round(w * 0.02); return [Math.max(0, best[0] - pad), Math.min(w, best[1] + pad)];
  }
  // 估計文字列的傾斜（回傳 tan）：試 ±8°，看哪個角度讓「每一列的墨點數」最集中（投影能量最大）
  // M（可省略）：同尺寸的墨點遮罩（只算亮底上的字，桌面紋路不算）
  function estShear(G, maxDeg, stepDeg, M) {
    maxDeg = maxDeg || 8; stepDeg = stepDeg || 0.4; var g = G.g, w = G.w, h = G.h, px = [], py = [], cx = w / 2;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x += 2) if (M ? M.g[y * w + x] : g[y * w + x] < 150) { px.push(x - cx); py.push(y); }
    if (px.length < 200) return 0;
    var best = 0, bs = -1, H = new Float64Array(h * 2 + 10), off = h / 2;
    for (var a = -maxDeg; a <= maxDeg + 1e-9; a += stepDeg) {
      var t = Math.tan(a * Math.PI / 180); H.fill(0);
      for (var i = 0; i < px.length; i++) { var yy = Math.round(py[i] - px[i] * t + off); if (yy >= 0 && yy < H.length) H[yy]++; }
      var sc = 0; for (i = 0; i < H.length; i++) sc += H[i] * H[i];
      if (sc > bs + 1e-6) { bs = sc; best = t; }
    }
    return Math.abs(best) < 1e-9 ? 0 : best;
  }
  function shear(G, t) {
    if (!t) return G;
    var g = G.g, w = G.w, h = G.h, cx = w / 2, pad = Math.ceil(Math.abs(t) * w / 2) + 2, H = h + pad * 2, o = new Uint8ClampedArray(w * H).fill(255);
    for (var y = 0; y < H; y++) for (var x = 0; x < w; x++) { var sy = y - pad + (x - cx) * t, y0 = Math.floor(sy), f = sy - y0; if (y0 < 0 || y0 >= h - 1) continue; o[y * w + x] = g[y0 * w + x] * (1 - f) + g[(y0 + 1) * w + x] * f; }
    return { g: o, w: w, h: H };
  }
  function toRGBA(G, out) { var d = out || new Uint8ClampedArray(G.w * G.h * 4); for (var i = 0, j = 0; i < G.w * G.h; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = G.g[i]; d[j + 3] = 255; } return d; }

  /* 整張照片 → 要給 OCR 讀的影像清單（每張附 kind）。
   * base：先把照片縮到寬 960（跟測試樣本同一個尺度）找文字欄；再依文字欄寬度決定放大倍率（讓欄寬約 900px，1.5–4 倍），
   *       從「原始解析度」裁切放大（手機原圖比較清楚，不是把小圖硬放大）。
   * 回傳 [{ kind:'strips', parts:[G…] }, { kind:'col', parts:[G] }]：strips＝每 560px 一段、各自校正傾斜（重疊 160px）；col＝整欄不分段。 */
  function plan(full, opt) {
    opt = opt || {};
    var bs = 960 / full.w, base = bs < 1 ? resize(full, bs) : full; if (bs >= 1) bs = 1;
    var bB = boxBlur(base, 15), bm = inkMask(base, 15, bB), c = mainColumn(base, bm) || [0, base.w];
    var cw = c[1] - c[0], s = Math.max(1.5, Math.min(4, 900 / Math.max(200, cw))) * (opt.mult || 1); // 相對 base 的倍率
    var k = s * bs; // 相對原圖的倍率
    var x0 = Math.max(0, c[0] / bs - 30 / bs), x1 = Math.min(full.w, c[1] / bs + 30 / bs);
    var src = crop(full, x0, 0, x1, full.h), U = resize(src, k);
    var r = Math.round(20 * s), B = boxBlur(U, r), m = inkMask(U, r, B), F = flatten(U, r, B);
    var strips = [], SH = Math.round(280 * s), ST = Math.round(200 * s), y;
    for (y = opt.offset ? -Math.round(ST * opt.offset) : 0; y < F.h; y += ST) {
      if (y < 0) { var yy1 = y + SH; var p0 = crop(F, 0, 0, F.w, yy1); strips.push(p0); continue; }
      var y1 = Math.min(F.h, y + SH), cc = mainColumn(U, m, y, y1, Math.round(34 * s)), a = 0, b = F.w;
      if (cc && cc[1] - cc[0] > 200 * s) { a = cc[0]; b = cc[1]; }
      var part = crop(F, a, y, b, y1); strips.push(shear(part, estShear(part, 8, 0.4, crop({ g: m, w: U.w, h: U.h }, a, y, b, y1))));
      if (y1 >= F.h) break;
    }
    return { scale: k, col: [x0, x1], passes: [{ kind: 'strips', parts: strips }, { kind: 'col', parts: [F] }] };
  }

  var api = { toGray: toGray, resize: resize, boxBlur: boxBlur, flatten: flatten, inkMask: inkMask, crop: crop, mainColumn: mainColumn, estShear: estShear, shear: shear, toRGBA: toRGBA, plan: plan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WRSiusXImg = api;
})(typeof window !== 'undefined' ? window : this);
/* v2.9.6 原型（scratch，不是 app 程式）：小白單前處理 plan2。
 * v.crop：先找出白紙（亮的、包住文字欄的那一塊），紙以外全部塗白，再在紙上找文字欄 → 不會把天花板／背景框進來。
 * v.seg ：依「行距」分段（每段 segLines 行、上下重疊 ovl 行），每段各自：從原圖重新裁切、依該段行距放大到 pitch px、
 *         校正傾斜＋彎曲（dy = t·x + c·x²，搜尋投影最集中的 t、c）。
 * 回傳格式跟 plan() 一樣：{ scale, col, passes:[{kind, parts}] } */
(function (root) {
  'use strict';
  var I = (typeof module !== 'undefined' && module.exports && module.exports.toGray) ? module.exports : root.WRSiusXImg;
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }); return b[b.length >> 1]; }
  // 紙的範圍：每一列找「亮的連續段」中蓋住文字欄中心的那段 → spans[y]=[x0,x1]（base 座標）；沒有就 null
  function paperSpans(base, B, m) {
    var w = base.w, h = base.h, nb = 10, cols = [];
    for (var b = 0; b < nb; b++) { var y0 = Math.round(h * b / nb), y1 = Math.round(h * (b + 1) / nb), cc = I.mainColumn(base, m, y0, y1); if (cc) { var ink = 0; for (var y = y0; y < y1; y++) for (var x = cc[0]; x < cc[1]; x++) ink += m[y * w + x]; cols.push({ a: cc[0], b: cc[1], ink: ink, y0: y0, y1: y1 }); } }
    if (!cols.length) return null;
    var ma = median(cols.map(function (c) { return c.a; })), mb = median(cols.map(function (c) { return c.b; }));
    var good = cols.filter(function (c) { var ov = Math.min(c.b, mb) - Math.max(c.a, ma); return ov > 0.7 * (c.b - c.a); });
    if (!good.length) return null;
    var cx = median(good.map(function (c) { return (c.a + c.b) / 2; }));
    // 紙的亮度：文字欄裡模糊後亮度的中位數
    var vals = []; good.forEach(function (c) { for (var y = c.y0; y < c.y1; y += 4) for (var x = c.a; x < c.b; x += 4) vals.push(B.g[y * w + x]); });
    var T = median(vals) * 0.8;
    var spans = new Array(h), lo = Math.max(0, Math.round(ma - (mb - ma) * 0.6)), hi = Math.min(w - 1, Math.round(mb + (mb - ma) * 0.6));
    for (var y = 0; y < h; y++) {
      var ro = y * w, bestS = null, bestL = 0, s = -1;
      for (var x = 0; x <= w; x++) { var on = x < w && B.g[ro + x] >= T; if (on && s < 0) s = x; if (!on && s >= 0) { var e = x - 1; // 這段有蓋到 [ma,mb] 中段才算
          var ov = Math.min(e, mb) - Math.max(s, ma); if (ov > 0.25 * (mb - ma) && ov > bestL) { bestL = ov; bestS = [s, e]; } s = -1; } }
      spans[y] = bestS ? [Math.max(bestS[0], lo), Math.min(bestS[1], hi)] : null;
    }
    // 上下平滑：每列取前後 7 列的中位數，避免燈管貼著紙邊把範圍撐大
    var sm = new Array(h);
    for (y = 0; y < h; y++) { var A = [], Bq = []; for (var k = -7; k <= 7; k++) { var q = spans[y + k]; if (q) { A.push(q[0]); Bq.push(q[1]); } } sm[y] = A.length >= 8 && spans[y] ? [median(A), median(Bq)] : null; }
    return { spans: sm, col: [ma, mb], cx: cx, T: T };
  }
  function paperMask(base, P) { var w = base.w, o = new Uint8Array(w * base.h); for (var y = 0; y < base.h; y++) { var q = P.spans[y]; if (!q) continue; for (var x = q[0]; x <= q[1]; x++) o[y * w + x] = 1; } return o; }
  // 行距：列墨量的自相關，找 [lo,hi] 之間的最大峰
  function pitchOf(mk, w, h, lo, hi) {
    var p = new Float64Array(h), mean = 0, y, x; for (y = 0; y < h; y++) { var s = 0; for (x = 0; x < w; x++) s += mk[y * w + x]; p[y] = s; mean += s; } mean /= h; for (y = 0; y < h; y++) p[y] -= mean;
    var best = 0, bv = -Infinity, ac = []; for (var d = Math.max(2, Math.floor(lo)); d <= Math.min(h - 2, Math.ceil(hi)); d++) { var v = 0; for (y = 0; y + d < h; y++) v += p[y] * p[y + d]; v /= (h - d); ac[d] = v; if (v > bv) { bv = v; best = d; } }
    // 半倍頻檢查：如果 best/2 附近也很高（≥0.8），取比較小的那個
    var hb = Math.round(best / 2); if (hb >= lo && ac[hb] != null && ac[hb] > bv * 0.8) best = hb;
    return bv > 0 ? best : 0;
  }
  // 彎曲＋傾斜：dy(x) = t·u + c·(u²−1/3)，u = (x−cx)/(w/2)，c 以 px 計（邊緣比中間多彎 c px）
  function estWarp(G, M, maxDeg, pitch) {
    var w = G.w, h = G.h, cx = w / 2, px = [], py = [];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x += 2) if (M[y * w + x]) { px.push((x - cx) / (w / 2)); py.push(y); }
    if (px.length < 200) return { t: 0, c: 0 };
    var H = new Float64Array(h * 3 + 10), off = h, best = { t: 0, c: 0 }, bs = -1, half = w / 2;
    var cmax = Math.max(2, Math.round(pitch * 0.9)), cstep = Math.max(1, pitch / 8);
    function score(tt, c) { H.fill(0); for (var i = 0; i < px.length; i++) { var u = px[i], yy = Math.round(py[i] - u * tt * half - c * (u * u - 1 / 3) + off); if (yy >= 0 && yy < H.length) H[yy]++; } var s = 0; for (i = 0; i < H.length; i++) s += H[i] * H[i]; return s; }
    for (var a = -maxDeg; a <= maxDeg + 1e-9; a += 0.4) { var t = Math.tan(a * Math.PI / 180), sc = score(t, 0); if (sc > bs) { bs = sc; best = { t: t, c: 0 }; } }
    var t0 = best.t; for (a = -1.2; a <= 1.2 + 1e-9; a += 0.2) { t = Math.tan(Math.atan(t0) + a * Math.PI / 180); for (var c = -cmax; c <= cmax + 1e-9; c += cstep) { sc = score(t, c); if (sc > bs * 1.0005) { bs = sc; best = { t: t, c: c }; } } }
    return best;
  }
  function warp(G, W) {
    if (!W.t && !W.c) return G;
    var g = G.g, w = G.w, h = G.h, cx = w / 2, half = w / 2, pad = Math.ceil(Math.abs(W.t) * half + Math.abs(W.c)) + 2, HH = h + pad * 2, o = new Uint8ClampedArray(w * HH).fill(255);
    for (var x = 0; x < w; x++) { var u = (x - cx) / half, d = u * W.t * half + W.c * (u * u - 1 / 3); for (var y = 0; y < HH; y++) { var sy = y - pad + d, y0 = Math.floor(sy), f = sy - y0; if (y0 < 0 || y0 >= h - 1) continue; o[y * w + x] = g[y0 * w + x] * (1 - f) + g[(y0 + 1) * w + x] * f; } }
    return { g: o, w: w, h: HH };
  }
  // 分欄對齊（彎曲）：把這段切成幾條直的窄欄，每條的「列墨量」跟隔壁對齊（每次最多移 0.4 行，避免對錯行），得到每一欄要往上／下移多少 → 拉直
  function sliceDy(G, M, pitch) {
    var w = G.w, h = G.h, sw = Math.max(Math.round(pitch * 2.5), Math.round(w / 10)), n = Math.max(1, Math.floor(w / sw)), prof = [], ink = [];
    for (var j = 0; j < n; j++) { var p = new Float64Array(h), x0 = j * sw, x1 = j === n - 1 ? w : x0 + sw, tot = 0; for (var y = 0; y < h; y++) { var s = 0; for (var x = x0; x < x1; x++) s += M[y * w + x]; p[y] = s; tot += s; }
      var q = new Float64Array(h); for (y = 0; y < h; y++) { var a = 0, c = 0; for (var k = -2; k <= 2; k++) if (y + k >= 0 && y + k < h) { a += p[y + k]; c++; } q[y] = a / c; } prof.push(q); ink.push(tot); }
    var mx = Math.max.apply(null, ink), ok = ink.map(function (v) { return v > mx * 0.15; }), d = new Array(n).fill(null), ref = -1, bi = -1;
    for (j = 0; j < n; j++) if (ok[j] && ink[j] * (1 - Math.abs(j - (n - 1) / 2) / n) > bi) { bi = ink[j] * (1 - Math.abs(j - (n - 1) / 2) / n); ref = j; }
    if (ref < 0) return null; d[ref] = 0; var R = Math.max(1, Math.round(pitch * (v296R || 0.3)));
    function corr(a, b, sh) { var v = 0; for (var y = R; y < h - R; y++) { var yy = y + sh; if (yy < 0 || yy >= h) continue; v += a[y] * b[yy]; } return v; }
    // 每一欄自己的斜度（欄內字的方向）→ 預測跟隔壁差多少，再用列墨量在預測值 ±0.3 行內微調（不會跳到別行）
    var slope = []; for (j = 0; j < n; j++) { var xa = j * sw, xb = j === n - 1 ? w : xa + sw; slope[j] = ok[j] ? I.estShear({ g: new Uint8ClampedArray(0), w: xb - xa, h: h }, 20, 0.5, sub(M, w, h, xa, xb)) : 0; }
    function walk(dir) { var last = ref; for (var j = ref + dir; j >= 0 && j < n; j += dir) { if (!ok[j]) continue; var dist = (j - last) * sw, pred = (slope[last] + slope[j]) / 2 * dist, best = 0, bv = -1; for (var sh = -R; sh <= R; sh++) { var v = corr(prof[last], prof[j], Math.round(d[last] + pred) + sh); if (v > bv) { bv = v; best = sh; } } d[j] = d[last] + pred + best; last = j; } }
    walk(1); walk(-1);
    var cx = [], dv = []; for (j = 0; j < n; j++) if (d[j] != null) { cx.push(j * sw + Math.min(sw, w - j * sw) / 2); dv.push(d[j]); }
    var dy = new Float32Array(w); for (x = 0; x < w; x++) { if (x <= cx[0]) dy[x] = dv[0]; else if (x >= cx[cx.length - 1]) dy[x] = dv[dv.length - 1]; else { for (k = 1; k < cx.length; k++) if (x <= cx[k]) { var f = (x - cx[k - 1]) / (cx[k] - cx[k - 1]); dy[x] = dv[k - 1] * (1 - f) + dv[k] * f; break; } } }
    return { dy: dy, d: dv };
  }
  var v296R = 0;
  function sub(M, w, h, xa, xb) { var W = xb - xa, o = new Uint8Array(W * h); for (var y = 0; y < h; y++) for (var x = 0; x < W; x++) o[y * W + x] = M[y * w + xa + x]; return { g: o, w: W, h: h }; }
  function warpDy(G, dy) {
    var g = G.g, w = G.w, h = G.h, mn = Infinity, mxx = -Infinity, x; for (x = 0; x < w; x++) { if (dy[x] < mn) mn = dy[x]; if (dy[x] > mxx) mxx = dy[x]; }
    var top = Math.max(0, Math.ceil(mxx)) + 2, HH = h + top + Math.max(0, Math.ceil(-mn)) + 2, o = new Uint8ClampedArray(w * HH).fill(255);
    for (x = 0; x < w; x++) for (var y = 0; y < HH; y++) { var sy = y - top + dy[x], y0 = Math.floor(sy), f = sy - y0; if (y0 < 0 || y0 >= h - 1) continue; o[y * w + x] = g[y0 * w + x] * (1 - f) + g[(y0 + 1) * w + x] * f; }
    return { g: o, w: w, h: HH };
  }
  function whiten(F, mk) { var o = new Uint8ClampedArray(F.g); for (var i = 0; i < o.length; i++) if (!mk[i]) o[i] = 255; return { g: o, w: F.w, h: F.h }; }
  function upMask(pm, bw, bh, x0, y0, w, h, sc) { // base 座標的紙遮罩 → 某個裁切／縮放後的座標
    var o = new Uint8Array(w * h); for (var y = 0; y < h; y++) { var by = Math.min(bh - 1, Math.max(0, Math.floor((y + 0.5) / sc + y0))); for (var x = 0; x < w; x++) { var bx = Math.min(bw - 1, Math.max(0, Math.floor((x + 0.5) / sc + x0))); o[y * w + x] = pm[by * bw + bx]; } } return o;
  }
  function and(a, b) { var o = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] && b[i] ? 1 : 0; return o; }

  /* opt：{ v:{crop, seg, pitch(目標行距 px), segLines, ovl, curl}, mult } */
  function plan2(full, opt) {
    opt = opt || {}; var v = opt.v || {}, info = {};
    var bs = 960 / full.w, base = bs < 1 ? I.resize(full, bs) : full; if (bs >= 1) bs = 1;
    var bB = I.boxBlur(base, 15), bm = I.inkMask(base, 15, bB), P = null, pm = null;
    if (v.crop) { P = paperSpans(base, bB, bm); if (P) { pm = paperMask(base, P); bm = and(bm, pm); } }
    var c = I.mainColumn(base, bm) || [0, base.w];
    // 文字欄的上下範圍（紙上有墨的列）
    var yTop = 0, yBot = base.h;
    if (P) { var rows = []; for (var y = 0; y < base.h; y++) { var s = 0; for (var x = c[0]; x < c[1]; x++) s += bm[y * base.w + x]; rows.push(s); } var f = rows.findIndex(function (s) { return s > 0; }); var l = rows.length - 1; while (l > 0 && !rows[l]) l--; if (f >= 0) { yTop = Math.max(0, f - 12); yBot = Math.min(base.h, l + 12); } }
    var cw = c[1] - c[0], x0 = Math.max(0, c[0] / bs - 30 / bs), x1 = Math.min(full.w, c[1] / bs + 30 / bs), Y0 = yTop / bs, Y1 = yBot / bs;
    var s, k;
    if (v.pitch) { // 依行距決定倍率：先在 base 量行距
      var pb = pitchOf(bm.subarray ? cropMask(bm, base.w, c[0], Math.round(yTop + (yBot - yTop) * 0.25), c[1], Math.round(yTop + (yBot - yTop) * 0.75)) : bm, c[1] - c[0], Math.round((yBot - yTop) * 0.5), 6, 60);
      info.pitchBase = pb; s = pb ? v.pitch / pb : Math.max(1.5, Math.min(4, 900 / Math.max(200, cw))); s = Math.max(1, Math.min(6, s)) * (opt.mult || 1);
    } else s = Math.max(1.5, Math.min(4, 900 / Math.max(200, cw))) * (opt.mult || 1);
    k = s * bs; info.k = k; info.col = [x0, x1]; info.y = [Y0, Y1];
    var src = I.crop(full, x0, Y0, x1, Y1), U = I.resize(src, k);
    var r = Math.round(20 * s), B = I.boxBlur(U, r), m = I.inkMask(U, r, B), F = I.flatten(U, r, B);
    var um = null; if (pm) { um = upMask(pm, base.w, base.h, x0 * bs, Y0 * bs, U.w, U.h, s); m = and(m, um); F = whiten(F, um); }
    var strips = [], y;
    if (!v.seg) {
      var SH = Math.round(280 * s), ST = Math.round(200 * s);
      for (y = opt.offset ? -Math.round(ST * opt.offset) : 0; y < F.h; y += ST) {
        var y1 = Math.min(F.h, y + SH), cc = I.mainColumn(U, m, y, y1, Math.round(34 * s)), a = 0, b = F.w;
        if (cc && cc[1] - cc[0] > 200 * s) { a = cc[0]; b = cc[1]; }
        var part = I.crop(F, a, y, b, y1); var shp = I.shear(part, I.estShear(part, 8, 0.4, I.crop({ g: m, w: U.w, h: U.h }, a, y, b, y1))); strips.push(v.norm ? norm(shp) : shp);
        if (y1 >= F.h) break;
      }
    } else {
      var pitch = v.pitch ? v.pitch * (opt.mult || 1) : (pitchOf(m, U.w, U.h, 10 * s, 40 * s) || 19 * s), L = v.segLines || 12, O = v.ovl == null ? 2 : v.ovl;
      var SH2 = Math.round((L + O) * pitch), ST2 = Math.round(L * pitch); info.segs = [];
      for (var yL = v.segOff ? -Math.round(ST2 * v.segOff) : 0; yL < F.h; yL += ST2) { if (yL < 0 && yL + SH2 <= 0) continue; var yc = Math.max(0, yL);
        var yy1 = Math.min(F.h, yL + SH2); y = yc; /* v296 修正：不覆寫迴圈變數 */ var c2 = I.mainColumn(U, m, y, yy1, Math.round(34 * s)), a2 = 0, b2 = F.w;
        if (c2 && c2[1] - c2[0] > 150 * s) { a2 = c2[0]; b2 = c2[1]; }
        var mk = I.crop({ g: m, w: U.w, h: U.h }, a2, y, b2, yy1), part2 = I.crop(F, a2, y, b2, yy1);
        var W = v.curl === false || v.curl === 'slice' ? { t: I.estShear(part2, 12, 0.4, mk), c: 0 } : estWarp(part2, mk.g, 12, pitch);
        var out = warp(part2, W), z = 1, SD = null;
        if (v.curl === 'slice') { var mw0 = warp({ g: Uint8ClampedArray.from(mk.g, function (q) { return q ? 0 : 255; }), w: mk.w, h: mk.h }, W), mm0 = new Uint8Array(mw0.g.length); for (var i0 = 0; i0 < mm0.length; i0++) mm0[i0] = mw0.g[i0] < 128 ? 1 : 0;
          SD = sliceDy(out, mm0, pitch); if (SD) out = warpDy(out, SD.dy); }
        if (v.zoom) { // 這段自己的行距 → 放大到目標
          var mw = warp({ g: Uint8ClampedArray.from(mk.g, function (q) { return q ? 0 : 255; }), w: mk.w, h: mk.h }, W), mm = new Uint8Array(mw.g.length); for (var i = 0; i < mm.length; i++) mm[i] = mw.g[i] < 128 ? 1 : 0;
          var ps = pitchOf(mm, mw.w, mw.h, pitch * 0.6, pitch * 1.4); if (ps) { z = Math.max(1, Math.min(1.6, pitch / ps)); if (z > 1.05) { // 從原圖重新取：這段在原圖的位置
              var fx0 = x0 + a2 / k, fy0 = Y0 + y / k, fx1 = x0 + b2 / k, fy1 = Y0 + yy1 / k, kk = k * z, src2 = I.crop(full, fx0, fy0, fx1, fy1), U2 = I.resize(src2, kk), r2 = Math.round(20 * s * z), B2 = I.boxBlur(U2, r2), F2 = I.flatten(U2, r2, B2);
              if (pm) { var um2 = upMask(pm, base.w, base.h, fx0 * bs, fy0 * bs, U2.w, U2.h, s * z); F2 = whiten(F2, um2); }
              out = warp(F2, { t: W.t, c: W.c * z }); if (SD) { var dz = new Float32Array(out.w); for (var xz = 0; xz < out.w; xz++) dz[xz] = SD.dy[Math.min(SD.dy.length - 1, Math.floor(xz / z))] * z; out = warpDy(out, dz); } } else z = 1; }
        }
        if (v.norm) out = norm(out);
        info.segs.push({ y: y, h: yy1 - y, t: +W.t.toFixed(4), c: +W.c.toFixed(1), z: +z.toFixed(2), d: SD ? SD.d.map(Math.round) : null });
        strips.push(out);
        if (yy1 >= F.h) break;
      }
      info.pitch = pitch;
    }
    var second = { kind: 'col', parts: [v.norm && v.normCol ? norm(F) : F] };
    if (v.seg && v.pass2) { var v2 = {}; for (var kk in v) v2[kk] = v[kk]; v2.pitch = v.pass2.pitch; v2.segOff = v.pass2.off; v2.pass2 = null; second = { kind: 'strips2', parts: plan2(full, { v: v2, mult: opt.mult }).passes[0].parts }; }
    var col = { kind: 'col', parts: [v.norm && v.normCol ? norm(F) : F] }, ps = [{ kind: 'strips', parts: strips }, second];
    if (v.keepCol && second.kind !== 'col') ps = [ps[0], col, ps[1]]; // 原型：大張整欄放中間，3 個 worker 時它跟分段一起跑
    return { scale: k, col: [x0, x1], info: info, passes: ps };
  }
  // 對比拉開：2% 最暗 → 0、紙的亮度（60% 分位）→ 255。Tesseract 自己的二值化遇到灰底淡字會把整行讀成方塊（實測）
  function norm(G) { var hist = new Uint32Array(256), n = G.g.length, i; for (i = 0; i < n; i++) hist[G.g[i]]++; var nw = 0; for (i = 0; i < n; i++) if (G.g[i] === 255) nw++; var tot = n - nw, a = 0, lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 255; i++) { acc += hist[i]; if (!a && acc >= tot * 0.02) { lo = i; a = 1; } if (acc >= tot * 0.6) { hi = i; break; } }
    if (hi - lo < 20) return G; var o = new Uint8ClampedArray(n), sc = 255 / (hi - lo); for (i = 0; i < n; i++) o[i] = (G.g[i] - lo) * sc; return { g: o, w: G.w, h: G.h }; }
  function cropMask(m, w, x0, y0, x1, y1) { var W = x1 - x0, o = new Uint8Array(W * (y1 - y0)); for (var y = y0; y < y1; y++) o.set(m.subarray(y * w + x0, y * w + x1), (y - y0) * W); return o; }
  var api = { norm: norm, plan2: plan2, paperSpans: paperSpans, pitchOf: pitchOf, estWarp: estWarp, warp: warp };
  for (var kk in api) I[kk] = api[kk];
})(typeof window !== 'undefined' ? window : this);
