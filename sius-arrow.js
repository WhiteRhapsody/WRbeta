/* WRbeta v3.0.3 小白單方向箭頭辨識（window.WRSiusArrow；Node 也能 require）。【White 2026-11-27 12:51「開工」】
 * SIUS 小白單每一發在序號和分數中間印一個方向箭頭（官方：The arrow shows the shot position from the target centre），8 個方向。
 * Tesseract 讀不出箭頭（讀成 # & « ~ w 等雜字），所以這裡用影像自己認：
 *   1. 用 Tesseract 的字框（blocks 輸出）找到「序號」那個字，往右 0.4～2.6 個字寬的範圍就是箭頭格；
 *   2. 在箭頭格裡取最大的墨點連通塊（太小／太大／太扁都不算）；
 *   3. 方向＝主軸角度（二階矩）＋箭頭那一端（頭比尾胖：質心偏向頭）；角度貼到最近的 45°。
 * 輸出跟 OCR 的每一行對齊（lineArrows[i] = { dir: '↗', margin: 0~1 } 或 null），交給 sius-x-parse（meta.arrow）。
 * 認不出來就給 null，不影響原本的燈號。 */
(function (root) {
  'use strict';
  var DIRS = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  var CFG = { on: true, minMargin: 0.1, minShare: 0.75 };
  // Tesseract blocks → 行（文字＋字框）
  function blockLines(data) {
    var out = [];
    ((data && data.blocks) || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) {
      out.push({ text: String(l.text || '').replace(/\s+$/, ''), bbox: l.bbox, words: (l.words || []).map(function (w) { return { t: String(w.text || ''), b: w.bbox }; }) });
    }); }); });
    return out;
  }
  function otsu(vals) {
    var h = new Array(256).fill(0), n = vals.length, i; if (!n) return 128;
    for (i = 0; i < n; i++) h[vals[i]]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * h[i];
    var sb = 0, wb = 0, best = 0, th = 128;
    for (i = 0; i < 256; i++) { wb += h[i]; if (!wb) continue; var wf = n - wb; if (!wf) break; sb += i * h[i]; var mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf); if (v > best) { best = v; th = i; } }
    return th;
  }
  // 找箭頭格：回傳 { x0, y0, x1, y1, cw } 或 null
  function cellOf(line) {
    var W = line.words; if (!W || W.length < 3) return null;
    var w0 = W[0]; if (!/^[0-9TlIO|]{1,3}$/.test(w0.t)) return null;
    var tw = null; for (var i = 1; i < W.length; i++) if (/\d{1,2}\s?[:;.,-]\s?\d{2}[.,]\d/.test(W[i].t) && W[i].t.length >= 6) { tw = W[i]; break; }
    var lh = line.bbox ? line.bbox.y1 - line.bbox.y0 : (w0.b.y1 - w0.b.y0) * 1.3;
    var cw = tw ? (tw.b.x1 - tw.b.x0) / Math.max(6, tw.t.length) : lh * 0.55;
    if (!(cw > 3)) return null;
    var y0 = Math.min(w0.b.y0, line.bbox ? line.bbox.y0 : w0.b.y0), y1 = Math.max(w0.b.y1, line.bbox ? line.bbox.y1 : w0.b.y1);
    var hy = (y1 - y0); y0 -= hy * 0.12; y1 += hy * 0.12;
    return { x0: w0.b.x1 + cw * 0.35, x1: w0.b.x1 + cw * 6, y0: y0, y1: y1, cw: cw, ax: w0.b.x1 + cw * 1.5 };
  }
  // 箭頭格 → 最大連通塊的像素
  function blob(G, c) {
    var x0 = Math.max(0, Math.floor(c.x0)), x1 = Math.min(G.w, Math.ceil(c.x1)), y0 = Math.max(0, Math.floor(c.y0)), y1 = Math.min(G.h, Math.ceil(c.y1));
    var w = x1 - x0, h = y1 - y0; if (w < 4 || h < 4) return null;
    var vals = new Uint8Array(w * h), x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) vals[y * w + x] = G.g[(y0 + y) * G.w + x0 + x];
    var mn = 255, mx = 0; for (x = 0; x < vals.length; x++) { if (vals[x] < mn) mn = vals[x]; if (vals[x] > mx) mx = vals[x]; }
    if (mx - mn < 60) return null;
    var th = Math.min(otsu(vals), mn + (mx - mn) * 0.6), lab = new Int32Array(w * h), comps = [], st = [];
    for (var i = 0; i < w * h; i++) {
      if (lab[i] || vals[i] > th) continue;
      var id = comps.length + 1, px = []; lab[i] = id; st.push(i);
      while (st.length) { var j = st.pop(), jx = j % w, jy = (j / w) | 0; px.push(j);
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; var k = ny * w + nx; if (!lab[k] && vals[k] <= th) { lab[k] = id; st.push(k); } } }
      comps.push(px);
    }
    var best = null, cw = c.cw, lh = c.y1 - c.y0;
    comps.forEach(function (px) { // 箭頭＝序號右邊第一個夠大的墨塊（不能太寬、太高）
      if (px.length < cw * cw * 0.12) return;
      var bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1; px.forEach(function (j) { var a = j % w, b = (j / w) | 0; if (a < bx0) bx0 = a; if (a > bx1) bx1 = a; if (b < by0) by0 = b; if (b > by1) by1 = b; });
      var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1; if (bw > cw * 2 || bh > lh * 0.9 || bw < cw * 0.3 || bh < cw * 0.3) return;
      if (!best || bx0 < best.bx0) best = { px: px, bw: bw, bh: bh, bx0: bx0 };
    });
    if (!best || best.px.length < cw * cw * 0.12) return null;
    return { px: best.px, w: w, h: h, x0: x0, y0: y0, vals: vals, th: th, bw: best.bw, bh: best.bh };
  }
  // 連通塊 → 方向
  function classify(B) {
    var n = B.px.length, w = B.w, sx = 0, sy = 0, i;
    var P = B.px.map(function (j) { return [j % w, -((j / w) | 0)]; }); // y 往上為正
    P.forEach(function (p) { sx += p[0]; sy += p[1]; }); var mx = sx / n, my = sy / n;
    var cxx = 0, cyy = 0, cxy = 0; P.forEach(function (p) { var a = p[0] - mx, b = p[1] - my; cxx += a * a; cyy += b * b; cxy += a * b; });
    var phi = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(phi), uy = Math.sin(phi);
    var l1 = (cxx + cyy) / 2 + Math.sqrt(Math.pow((cxx - cyy) / 2, 2) + cxy * cxy), l2 = (cxx + cyy) / 2 - Math.sqrt(Math.pow((cxx - cyy) / 2, 2) + cxy * cxy);
    var umin = 1e9, umax = -1e9, m3 = 0, m2 = 0;
    P.forEach(function (p) { var u = (p[0] - mx) * ux + (p[1] - my) * uy; if (u < umin) umin = u; if (u > umax) umax = u; m2 += u * u; m3 += u * u * u; });
    m2 /= n; m3 /= n; var sk = m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0, mid = (umin + umax) / 2, off = -mid / Math.max(1e-6, (umax - umin) / 2); // 質心相對中點的偏移：>0 表示質心偏 +u 端
    var sgn = (off - sk * 0.5) >= 0 ? 1 : -1; // 頭在質心那一側（偏移為正、偏度為負）
    var ang = Math.atan2(uy * sgn, ux * sgn) * 180 / Math.PI; if (ang < 0) ang += 360;
    var k = Math.round(ang / 45) % 8, dev = Math.abs(((ang - k * 45) + 540) % 360 - 180); // dev：離扇區中心幾度
    var elong = l2 > 0 ? Math.sqrt(l1 / l2) : 9;
    var margin = Math.max(0, Math.min(1, Math.min(1, Math.abs(off - sk * 0.5) / 0.35) * Math.min(1, (elong - 1) / 0.6) * (1 - Math.max(0, dev - 12) / 15)));
    return { dir: DIRS[k], k: k, ang: Math.round(ang), margin: Math.round(margin * 100) / 100, off: Math.round(off * 100) / 100, sk: Math.round(sk * 100) / 100, el: Math.round(elong * 100) / 100, dev: Math.round(dev) };
  }
  // 連通塊 → 16×16 正規化小圖（等比例縮放置中，值＝覆蓋比例 0～1），給模板比對用
  var N16 = 16;
  function norm16(B) {
    var w = B.w, bx0 = 1e9, bx1 = -1, by0 = 1e9, by1 = -1;
    B.px.forEach(function (j) { var a = j % w, b = (j / w) | 0; if (a < bx0) bx0 = a; if (a > bx1) bx1 = a; if (b < by0) by0 = b; if (b > by1) by1 = b; });
    var bw = bx1 - bx0 + 1, bh = by1 - by0 + 1, S = Math.max(bw, bh), sc = (N16 - 2) / S, ox = (N16 - bw * sc) / 2, oy = (N16 - bh * sc) / 2;
    var o = new Float32Array(N16 * N16), SS = 4; // 每個像素切 4×4 子點累加
    B.px.forEach(function (j) { var a = j % w - bx0, b = ((j / w) | 0) - by0;
      for (var u = 0; u < SS; u++) for (var v = 0; v < SS; v++) { var X = Math.floor(ox + (a + (u + 0.5) / SS) * sc), Y = Math.floor(oy + (b + (v + 0.5) / SS) * sc); if (X >= 0 && Y >= 0 && X < N16 && Y < N16) o[Y * N16 + X] += 1 / (SS * SS); } });
    var cov = sc * sc; for (var i = 0; i < o.length; i++) o[i] = Math.min(1, o[i] / cov);
    return o;
  }
  /* G：送進 Tesseract 的那段灰階（{g,w,h}）；data：recognize 的 data（要有 blocks）。
   * 回傳跟 data.text.split('\n') 對齊的陣列：每行 { dir, margin } 或 null。opt.debug＝附上箭頭格的小圖（研究用）。 */
  function extract(G, data, opt) {
    opt = opt || {};
    var tl = String((data && data.text) || '').split('\n'), out = new Array(tl.length).fill(null), cur = 0;
    if (!CFG.on || !G || !data || !data.blocks) return out;
    blockLines(data).forEach(function (L) {
      var t = L.text.trim(); if (!t) return;
      var idx = -1; for (var i = cur; i < tl.length; i++) if (tl[i].trim() === t) { idx = i; break; }
      if (idx < 0) return; cur = idx + 1;
      try {
        var c = cellOf(L); if (!c) return;
        var B = blob(G, c); if (!B) { if (opt.debug) out[idx] = { dir: null, dbg: dbg(G, c) }; return; }
        var r = classify(B), o = { dir: r.margin >= CFG.minMargin ? r.dir : null, margin: r.margin, raw: r.dir, ang: r.ang };
        if (opt.debug) { o.dbg = dbg(G, c); o.f = r; }
        if (o.dir || opt.debug) out[idx] = o;
      } catch (e) { /* 認不出來就算了 */ }
    });
    return out;
  }
  function dbg(G, c) { var x0 = Math.max(0, Math.floor(c.x0 - c.cw * 0.3)), x1 = Math.min(G.w, Math.ceil(c.x1)), y0 = Math.max(0, Math.floor(c.y0)), y1 = Math.min(G.h, Math.ceil(c.y1)), w = x1 - x0, h = y1 - y0, s = '';
    var a = []; for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) a.push(G.g[y * G.w + x]); return { w: w, h: h, cw: Math.round(c.cw * 10) / 10, ax: Math.round(c.ax - x0), g: a.join(',') }; }
  // 多個讀法投票：rd 讀法裡的 arrow → { dir, n, of }
  function vote(list) {
    var c = {}, n = 0; (list || []).forEach(function (a) { if (a && a.dir) { c[a.dir] = (c[a.dir] || 0) + (a.margin != null ? Math.max(a.margin, 0.05) : 0.5); n++; } });
    var best = null, bv = 0, tot = 0; Object.keys(c).forEach(function (k) { tot += c[k]; if (c[k] > bv) { bv = c[k]; best = k; } });
    return best ? { dir: best, n: n, share: Math.round(bv / tot * 100) / 100 } : null;
  }
  /* 依 (x, y) 算 SIUS 會印的箭頭。實測：離軸 11.25° 以內（360/32，16 方位的一格）印上下左右，其他都印斜箭頭。
   * 依據：17 張、1,350 發人工答案，斜箭頭最小離軸 11.03°、上下左右最大 10.91°；邊界附近 3 發（11.03°、11.17°、11.09°）實際小白單上印的是
   * 上下左右（人工答案標錯），11.24° 那發印的是斜箭頭 → 門檻約 11.2°（印出來的座標只到 0.01mm，邊界前後 0.3° 兩種都算對，見 compat）。 */
  var CARD = 11.2;
  function dirOf(x, y) { if (x == null || y == null || (!x && !y)) return null; var a = Math.atan2(y, x) * 180 / Math.PI; if (a < 0) a += 360;
    var ax = Math.round(a / 90) % 4, dev = Math.abs(a - Math.round(a / 90) * 90);
    if (dev < CARD) return DIRS[ax * 2];
    return DIRS[(Math.floor(a / 90) % 4) * 2 + 1]; }
  // (x, y) 跟箭頭 dir 合不合：離靶心太近（<0.4mm）或在扇區邊界 ±0.3° 內都算合
  function compat(x, y, dir) {
    if (!dir || x == null || y == null || !isFinite(x) || !isFinite(y)) return true;
    if (Math.sqrt(x * x + y * y) < 0.4) return true;
    if (dirOf(x, y) === dir) return true;
    var a = Math.atan2(y, x), r = Math.sqrt(x * x + y * y);
    for (var k = -1; k <= 1; k += 2) { var b = a + k * 0.3 * Math.PI / 180; if (dirOf(r * Math.cos(b), r * Math.sin(b)) === dir) return true; }
    return false;
  }
  // 讀法的箭頭投票結果夠不夠有把握（加權占比 ≥ minShare）
  function sure(arw) { return !!(arw && arw.dir && arw.n >= 2 && arw.share >= CFG.minShare); } // Gemini 審查：至少 2 次讀法認出同一方向
  var api = { DIRS: DIRS, CARD: CARD, norm16: norm16, compat: compat, sure: sure, CFG: CFG, extract: extract, classify: classify, blob: blob, cellOf: cellOf, blockLines: blockLines, vote: vote, dirOf: dirOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WRSiusArrow = api;
})(typeof window !== 'undefined' ? window : this);
