/* WRbeta v3.1.4 小白單「認字層」：PaddleOCR PP-OCRv6 tiny（偵測＋辨識，ONNX）在瀏覽器裡跑（window.WRSiusPP）。【White 2026-11-27 21:09「hotfix it」】
 * 角色：混合引擎的第二雙眼睛。原本的引擎（M6b＋備援）照舊負責欄位對齊、負號／箭頭、小計反推、燈號；
 *   這裡把每張照片整行讀出來（文字＋位置框 → 依高度排成一行一行），變成跟原引擎一樣的「讀法」（pass，kind='pp'），
 *   由 sius-v3.js 的 hybrid() 逐發比對：一致才給綠燈，不一致就黃燈（原因 ocrDiff:x／y／d）。
 * 執行環境：onnxruntime-web（MIT）單執行緒 WASM（GitHub Pages 不能設 COOP／COEP，不用多執行緒）；模型與執行檔都放在自家網站
 *   vendor/ppocr/（不連外部 CDN），第一次用時下載約 21 MB，之後 service worker 快取（wrbeta-ocr-*，換版不刪），可以離線。
 * 載入失敗、手機不支援 WebAssembly SIMD、逾時 → reject，呼叫端退回原本的引擎（不影響原本流程）。
 * 授權：PP-OCRv6 tiny 權重 Apache-2.0（Baidu／PaddleOCR；ONNX 由 RapidOCR 轉檔，Apache-2.0）；onnxruntime-web MIT。全文見 licenses.html。 */
(function (root) {
  'use strict';
  var VENDOR = 'vendor/ppocr/', CANCEL = { cancel: true };
  var CFG = { on: 1, proxy: 1, detMax: 3200, detPx: 3200000, detTile: 1664, detOv: 320, detMin: 736, thresh: 0.3, boxThresh: 0.5, unclip: 1.6, textScore: 0.5, recH: 48, recMinW: 320, recMaxW: 1600, batch: 8, loadTimeout: 90000 };
  var F = { det: 'PP-OCRv6_det_tiny.onnx', rec: 'PP-OCRv6_rec_tiny.onnx', keys: 'ppocrv6_tiny_keys.txt', ort: 'ort.wasm.min.js' };
  function lowMem() { try { var m = root.navigator && root.navigator.deviceMemory; return !!m && m <= 3; } catch (e) { return false; } }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function base() { return new URL(VENDOR, root.location.href).href; }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); }; document.head.appendChild(s); }); }
  // WebAssembly＋SIMD（onnxruntime-web 的 WASM 一定要 SIMD）；舊手機不支援就直接退回原引擎
  function supported() {
    try {
      if (typeof WebAssembly !== 'object' || !WebAssembly.validate) return false;
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { return false; }
  }
  var gen = 0, ld = null; // ld：{ det, rec, keys } 的 Promise（載好留著，同一次開 App 再用不必重載）
  function timeout(p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error('pp-timeout')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  function load() {
    if (ld) return ld;
    if (!CFG.on) return Promise.reject(new Error('pp-off'));
    if (!supported()) return Promise.reject(new Error('pp-unsupported'));
    var b = base(), t0 = now(), made = [], dead = 0;
    var free = function () { made.forEach(function (m) { try { m.release(); } catch (e) {} }); made = []; };
    ld = timeout((root.ort ? Promise.resolve() : loadScript(VENDOR + F.ort)).then(function () {
      var ort = root.ort; if (!ort || !ort.InferenceSession) throw new Error('pp-ort');
      ort.env.wasm.wasmPaths = b; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = CFG.proxy !== 0 && typeof Worker !== 'undefined'; ort.env.logLevel = 'error';
      var so = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      return ort.InferenceSession.create(b + F.det, so).then(function (det) {
        made.push(det);
        return ort.InferenceSession.create(b + F.rec, so).then(function (rec) {
          made.push(rec);
          return fetch(b + F.keys).then(function (r) { if (!r.ok) throw new Error('pp-keys'); return r.text(); }).then(function (t) {
            var keys = ['']; t.replace(/\r/g, '').replace(/\n+$/, '').split('\n').forEach(function (c) { keys.push(c); }); keys.push(' '); // 0＝blank，最後一個＝空白（PaddleOCR CTC 規則）
            if (dead) throw new Error('pp-timeout');
            return { det: det, rec: rec, keys: keys, ms: Math.round(now() - t0) };
          });
        });
      });
    }), CFG.loadTimeout).catch(function (e) { ld = null; dead = 1; free(); throw e; }); // 失敗／逾時：已經建好的 session 釋放掉（不留著佔手機記憶體）
    return ld;
  }
  function stop() { gen++; }
  /* ---------- 影像小工具（灰階 G＝{ g:Uint8ClampedArray, w, h }） ---------- */
  function shrink(G, k) { // 盒狀縮小 k 倍（整數）
    var w = Math.max(1, Math.floor(G.w / k)), h = Math.max(1, Math.floor(G.h / k)), o = new Uint8ClampedArray(w * h), g = G.g, W = G.w;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var s = 0; for (var j = 0; j < k; j++) { var r = (y * k + j) * W + x * k; for (var i = 0; i < k; i++) s += g[r + i]; } o[y * w + x] = s / (k * k); }
    return { g: o, w: w, h: h };
  }
  // 找紙：亮的區域（>170）裡最大的一塊，外框加一點邊（跟評測時 Python 版同一個想法）
  function paperBox(G) {
    var k = Math.max(1, Math.round(Math.max(G.w, G.h) / 600)), S = shrink(G, k), w = S.w, h = S.h, n = w * h, m = new Uint8Array(n), lab = new Int32Array(n), i;
    for (i = 0; i < n; i++) m[i] = S.g[i] > 170 ? 1 : 0;
    var best = null, st = [], id = 0;
    for (i = 0; i < n; i++) {
      if (!m[i] || lab[i]) continue; id++; var cnt = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; st.push(i); lab[i] = id;
      while (st.length) { var p = st.pop(), px = p % w, py = (p - px) / w; cnt++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        var nb = [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1];
        for (var q = 0; q < 4; q++) { var z = nb[q]; if (z >= 0 && m[z] && !lab[z]) { lab[z] = id; st.push(z); } } }
      if (!best || cnt > best.cnt) best = { cnt: cnt, x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    if (!best || (best.x1 - best.x0 + 1) * (best.y1 - best.y0 + 1) < 0.15 * n) return null;
    var pad = 20;
    return { x: Math.max(0, best.x0 * k - pad), y: Math.max(0, best.y0 * k - pad), x2: Math.min(G.w, (best.x1 + 1) * k + pad), y2: Math.min(G.h, (best.y1 + 1) * k + pad) };
  }
  function crop(G, b) { var w = b.x2 - b.x, h = b.y2 - b.y, o = new Uint8ClampedArray(w * h); for (var y = 0; y < h; y++) o.set(G.g.subarray((b.y + y) * G.w + b.x, (b.y + y) * G.w + b.x + w), y * w); return { g: o, w: w, h: h }; }
  // 方向分數（評測 Python 版 upright_score 的移植）：橫的文字列越多、紙越直長分數越高
  function uprightScore(G) {
    var k = Math.max(1, Math.ceil(Math.max(G.w, G.h) / 900)), S = k > 1 ? shrink(G, k) : G, w = S.w, h = S.h, rows = new Float64Array(h), y, x, mx = 0;
    for (y = 0; y < h; y++) { var s = 0; for (x = 0; x < w; x++) if (S.g[y * w + x] < 150) s++; rows[y] = s; if (s > mx) mx = s; }
    if (mx < 5) return 0;
    var kk = Math.max(3, Math.floor(h / 250)), sm = new Float64Array(h), smx = 0;
    for (y = 0; y < h; y++) { var a = 0, c = 0; for (var j = y - (kk >> 1); j < y - (kk >> 1) + kk; j++) if (j >= 0 && j < h) { a += rows[j]; } c = kk; sm[y] = a / c; if (sm[y] > smx) smx = sm[y]; }
    var thr = smx * 0.25, peaks = 0, on = false; for (y = 0; y < h; y++) { if (sm[y] >= thr && !on) { peaks++; on = true; } else if (sm[y] < thr) on = false; }
    return peaks + 8 * Math.min(h / Math.max(1, w), 4);
  }
  function rotG(G, k) { return root.WRSiusX && root.WRSiusX.rotG ? root.WRSiusX.rotG(G, k) : G; }
  /* ---------- 偵測（DB）：機率圖 → 連通區塊 → 旋轉外框（主軸＝二階矩）→ 外擴（unclip） ---------- */
  function detect(S, G, my) {
    var ort = root.ort, r = Math.min(1, CFG.detMax / Math.max(G.w, G.h)); if (Math.min(G.w, G.h) * r < CFG.detMin) r = Math.min(CFG.detMax / Math.max(G.w, G.h), CFG.detMin / Math.min(G.w, G.h));
    r = Math.min(r, Math.sqrt(CFG.detPx / (G.w * G.h))); // 手機記憶體：偵測圖最多約 320 萬像素（裁好的小白單本來就在這以內；沒裁到紙的整張照片才會縮）
    var W = Math.max(32, Math.round(G.w * r / 32) * 32), H = Math.max(32, Math.round(G.h * r / 32) * 32), rx = W / G.w, ry = H / G.h;
    var n = W * H, x, y;
    // v3.2.0（v3.1.4 Gemini 審查 P0：detMax 3200 在手機上一次推論太吃記憶體）：解析度不降（小字才讀得到）。
    //   切塊推論（沿長邊每塊 detTile 列、前後各多 detOv 列重疊，只取中間那段）實測會讓讀法變差（11/13 三張：正解 10/10 → 8~9/10），
    //   所以平常照舊整張一次推論；只有「記憶體小的裝置（navigator.deviceMemory ≤ 3）」或「整張推論失敗過（多半是記憶體不夠）」才改用切塊，失敗那張自動用切塊重跑。
    var tiled = !!CFG.detTile && H > CFG.detTile && (S.detTiled || lowMem());
    var TL = tiled ? CFG.detTile : H, OV = tiled ? CFG.detOv || 0 : 0, tiles = [];
    for (var t0 = 0; t0 < H; t0 += TL) { var a0 = Math.max(0, t0 - OV), a1 = Math.min(H, t0 + TL + OV); tiles.push({ k0: t0, k1: Math.min(H, t0 + TL), a0: a0, a1: Math.min(H, a0 + Math.ceil((a1 - a0) / 32) * 32) }); }
    var pr = new Float32Array(n);
    var runTile = function (tl) {
      var th = tl.a1 - tl.a0, tn = W * th, inp = new Float32Array(3 * tn);
      for (y = 0; y < th; y++) { var sy = Math.min(G.h - 1, (y + tl.a0 + 0.5) / ry - 0.5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(G.h - 1, y0 + 1), fy = Math.max(0, sy - y0);
        for (x = 0; x < W; x++) { var sx = Math.min(G.w - 1, (x + 0.5) / rx - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(G.w - 1, x0 + 1), fx = Math.max(0, sx - x0);
          var v = (G.g[y0 * G.w + x0] * (1 - fx) + G.g[y0 * G.w + x1] * fx) * (1 - fy) + (G.g[y1 * G.w + x0] * (1 - fx) + G.g[y1 * G.w + x1] * fx) * fy, z = v / 127.5 - 1, p = y * W + x;
          inp[p] = z; inp[tn + p] = z; inp[2 * tn + p] = z; } }
      var feeds = {}; feeds[S.det.inputNames[0]] = new ort.Tensor('float32', inp, [1, 3, th, W]); inp = null;
      var free = function () { if (feeds) { try { feeds[S.det.inputNames[0]].dispose(); } catch (e) {} feeds = null; } };
      return S.det.run(feeds).then(function (out) {
        free();
        var o = out[S.det.outputNames[0]];
        if (my !== gen) { try { o.dispose(); } catch (e) {} throw CANCEL; }
        var d = o.data, yy0 = tl.k0 - tl.a0, yy1 = Math.min(th, tl.k1 - tl.a0);
        pr.set(d.subarray(yy0 * W, yy1 * W), tl.k0 * W);
        try { o.dispose(); } catch (e) {}
      }, function (e) { free(); throw e; }); // 推論失敗（多半是記憶體不夠）也先放掉輸入，再改用切塊重跑（審查建議）
    };
    var chain = Promise.resolve(); tiles.forEach(function (tl) { chain = chain.then(function () { return runTile(tl); }); });
    return chain.then(function () { return 0; }, function (e) { // 整張推論失敗（記憶體不夠）→ 這張跟之後都改用切塊
      if (e === CANCEL || tiled || !CFG.detTile || H <= CFG.detTile) throw e;
      S.detTiled = true; pr = null; return 1;
    }).then(function (redo) {
      if (redo) return detect(S, G, my);
      if (my !== gen) throw CANCEL;
      var bm = new Uint8Array(n), i;
      for (i = 0; i < n; i++) if (pr[i] > CFG.thresh) bm[i] = 1;
      var dm = new Uint8Array(n); // 2×2 膨脹（use_dilation）
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { var q = y * W + x; if (bm[q] || (x > 0 && bm[q - 1]) || (y > 0 && bm[q - W]) || (x > 0 && y > 0 && bm[q - W - 1])) dm[q] = 1; }
      var lab = new Int32Array(n), boxes = [], comps = [], st = [], id = 0;
      for (i = 0; i < n; i++) {
        if (!dm[i] || lab[i]) continue; id++; st.length = 0; st.push(i); lab[i] = id; var pts = [], ps = 0;
        while (st.length) { var p = st.pop(), px = p % W, py = (p - px) / W; pts.push(px, py); ps += pr[p];
          for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; var nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; var z = ny * W + nx; if (dm[z] && !lab[z]) { lab[z] = id; st.push(z); } } }
        var np = pts.length / 2; if (np < 6) continue;
        // 分數＝外框裡機率的平均（DB 的 box_score_fast；連背景一起算，弱的雜訊框會被濾掉）
        var bx0 = W, by0 = H, bx1 = 0, by1 = 0, kq; for (kq = 0; kq < pts.length; kq += 2) { if (pts[kq] < bx0) bx0 = pts[kq]; if (pts[kq] > bx1) bx1 = pts[kq]; if (pts[kq + 1] < by0) by0 = pts[kq + 1]; if (pts[kq + 1] > by1) by1 = pts[kq + 1]; }
        var bs = 0; for (var yy = by0; yy <= by1; yy++) for (var xx = bx0; xx <= bx1; xx++) bs += pr[yy * W + xx];
        var score = bs / ((bx1 - bx0 + 1) * (by1 - by0 + 1)); if (score < CFG.boxThresh) continue;
        var mx = 0, my2 = 0, k; for (k = 0; k < pts.length; k += 2) { mx += pts[k]; my2 += pts[k + 1]; } mx /= np; my2 /= np;
        var cxx = 0, cyy = 0, cxy = 0; for (k = 0; k < pts.length; k += 2) { var ax = pts[k] - mx, ay = pts[k + 1] - my2; cxx += ax * ax; cyy += ay * ay; cxy += ax * ay; }
        var th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), el = cxx + cyy > 0 ? Math.sqrt(Math.pow(cxx - cyy, 2) + 4 * cxy * cxy) / (cxx + cyy) : 0;
        comps.push({ pts: pts, mx: mx, my: my2, th: th, el: el, score: score });
      }
      // 角度：只有夠長的框（主軸明顯）用自己的角度；短框（單一個數字，例如「9」）的主軸不可靠（會轉 90／180 度，9 讀成 6），一律用整張的角度
      var angs = comps.filter(function (c) { return c.el > 0.6 && Math.abs(c.th) < 0.35; }).map(function (c) { return c.th; }).sort(function (a, b) { return a - b; });
      var gth = angs.length ? angs[angs.length >> 1] : 0;
      comps.forEach(function (cp) {
        var th = cp.el > 0.6 && Math.abs(cp.th - gth) < 0.12 ? cp.th : gth, c = Math.cos(th), s = Math.sin(th), u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, pts = cp.pts, mx = cp.mx, my2 = cp.my, k;
        for (k = 0; k < pts.length; k += 2) { var ddx = pts[k] - mx, ddy = pts[k + 1] - my2, u = ddx * c + ddy * s, vv = -ddx * s + ddy * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (vv < v0) v0 = vv; if (vv > v1) v1 = vv; }
        var bw = u1 - u0 + 1, bh = v1 - v0 + 1; if (Math.min(bw, bh) < 3) return;
        var d = bw * bh * CFG.unclip / (2 * (bw + bh)); bw += 2 * d; bh += 2 * d; if (Math.min(bw, bh) < 5) return;
        var ucx = (u0 + u1) / 2, vcx = (v0 + v1) / 2, ccx = mx + ucx * c - vcx * s, ccy = my2 + ucx * s + vcx * c;
        // 換回原圖座標（x、y 縮放比例可能不同 → 用兩個軸向量各自換算）
        var ux = c / rx, uy = s / ry, vx = -s / rx, vy = c / ry, lu = Math.sqrt(ux * ux + uy * uy), lv = Math.sqrt(vx * vx + vy * vy);
        var box = { cx: (ccx + 0.5) / rx - 0.5, cy: (ccy + 0.5) / ry - 0.5, ux: ux / lu, uy: uy / lu, vx: vx / lv, vy: vy / lv, w: bw * lu, h: bh * lv, score: cp.score };
        if (box.h > box.w * 1.5 && bh > 2 * CFG.recH) return; // 很高的直條（不是字）：略過
        boxes.push(box);
      });
      return boxes;
    });
  }
  /* ---------- 辨識（CTC）：每個框依旋轉外框取樣成高 48 的長條 → 一批一批送 → 取最大機率、去重複與空白 ---------- */
  function px1(G, px, py) {
    var x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    if (x0 < 0 || y0 < 0 || x0 >= G.w - 1 || y0 >= G.h - 1) { var cx = Math.min(G.w - 1, Math.max(0, Math.round(px))), cy = Math.min(G.h - 1, Math.max(0, Math.round(py))); return G.g[cy * G.w + cx]; }
    return (G.g[y0 * G.w + x0] * (1 - fx) + G.g[y0 * G.w + x0 + 1] * fx) * (1 - fy) + (G.g[(y0 + 1) * G.w + x0] * (1 - fx) + G.g[(y0 + 1) * G.w + x0 + 1] * fx) * fy;
  }
  // 旋轉外框取樣成高 48 的長條；縮小時每格取 k×k 個點平均（避免鋸齒，接近 OpenCV 的 INTER_AREA）
  function sample(G, b, W) {
    var H = CFG.recH, o = new Float32Array(3 * H * W), n = H * W, sx = b.w / W, sy = b.h / H, x, y, kx = Math.max(1, Math.min(4, Math.ceil(sx))), ky = Math.max(1, Math.min(4, Math.ceil(sy)));
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var val = 0;
      for (var j = 0; j < ky; j++) for (var i = 0; i < kx; i++) {
        var u = (x + (i + 0.5) / kx) * sx - b.w / 2, v = (y + (j + 0.5) / ky) * sy - b.h / 2;
        val += px1(G, b.cx + u * b.ux + v * b.vx, b.cy + u * b.uy + v * b.vy);
      }
      var z = val / (kx * ky) / 127.5 - 1, p = y * W + x; o[p] = z; o[n + p] = z; o[2 * n + p] = z;
    }
    return o;
  }
  function recognize(S, G, boxes, my, tick) {
    var ort = root.ort, H = CFG.recH, order = boxes.map(function (b, i) { return i; }).sort(function (a, b) { return boxes[a].w / boxes[a].h - boxes[b].w / boxes[b].h; }), out = new Array(boxes.length), i = 0;
    function next() {
      if (my !== gen) return Promise.reject(CANCEL);
      if (i >= order.length) return Promise.resolve(out);
      var ids = order.slice(i, i + CFG.batch); i += ids.length;
      var mr = CFG.recMinW / H; ids.forEach(function (j) { mr = Math.max(mr, boxes[j].w / boxes[j].h); });
      var Wb = Math.min(CFG.recMaxW, Math.ceil(H * mr)), data = new Float32Array(ids.length * 3 * H * Wb);
      ids.forEach(function (j, bi) {
        var b = boxes[j], w = Math.max(8, Math.min(Wb, Math.ceil(H * b.w / b.h))), one = sample(G, b, w), plane = H * Wb;
        for (var c = 0; c < 3; c++) for (var y = 0; y < H; y++) data.set(one.subarray(c * H * w + y * w, c * H * w + y * w + w), bi * 3 * plane + c * plane + y * Wb); // 右邊補 0（＝灰）
      });
      var feeds = {}; feeds[S.rec.inputNames[0]] = new ort.Tensor('float32', data, [ids.length, 3, H, Wb]);
      return S.rec.run(feeds).then(function (r) {
        try { feeds[S.rec.inputNames[0]].dispose(); } catch (e) {} feeds = null; data = null;
        var t = r[S.rec.outputNames[0]], dims = t.dims, T = dims[1], C = dims[2], P = t.data;
        ids.forEach(function (j, bi) {
          var s = '', last = 0, sc = 0, nc = 0;
          for (var k = 0; k < T; k++) { var off = (bi * T + k) * C, bj = 0, bv = -1; for (var c = 0; c < C; c++) { var v = P[off + c]; if (v > bv) { bv = v; bj = c; } }
            if (bj && bj !== last) { s += S.keys[bj] || ''; sc += bv; nc++; } last = bj; }
          out[j] = { text: s, score: nc ? sc / nc : 0 };
        });
        if (tick) tick(i / order.length);
        return next();
      });
    }
    return next();
  }
  /* ---------- 框 → 一行一行（評測 Python 版 group_lines 的移植；先照整張的傾斜角轉正再比高度） ---------- */
  function lines(boxes, recs) {
    var its = [], angs = [];
    boxes.forEach(function (b, i) { var r = recs[i]; if (!r || !r.text.trim() || r.score < CFG.textScore) return; its.push({ b: b, t: r.text.trim(), s: r.score }); if (b.w > b.h * 3) angs.push(Math.atan2(b.uy, b.ux)); });
    angs.sort(function (a, b) { return a - b; }); var a = angs.length ? angs[angs.length >> 1] : 0, c = Math.cos(-a), s = Math.sin(-a);
    its.forEach(function (it) { it.cx = it.b.cx * c - it.b.cy * s; it.cy = it.b.cx * s + it.b.cy * c; it.h = Math.max(1, it.b.h); });
    its.sort(function (p, q) { return p.cy - q.cy || p.cx - q.cx; });
    var L = [], med = function (arr) { var v = arr.slice().sort(function (p, q) { return p - q; }); return v[v.length >> 1]; };
    its.forEach(function (it) {
      for (var k = 0; k < L.length; k++) { var ln = L[k], mc = med(ln.map(function (z) { return z.cy; })), mh = med(ln.map(function (z) { return z.h; })); if (Math.abs(it.cy - mc) <= 0.6 * Math.max(mh, it.h)) { ln.push(it); return; } }
      L.push([it]);
    });
    return L.map(function (ln) { ln.sort(function (p, q) { return p.cx - q.cx; }); return { y: med(ln.map(function (z) { return z.cy; })), text: ln.map(function (z) { return z.t; }).join(' ').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim(), score: ln.reduce(function (p, z) { return p + z.s; }, 0) / ln.length }; })
      .sort(function (p, q) { return p.y - q.y; });
  }
  /* 已知的 Paddle 讀法習慣 → 原引擎解析器看得懂的樣子：逗號當小數點（3,45 → 3.45）；內十的 * 讀成 F／Φ／×（10F → 10*）；全形符號 */
  function norm(t) {
    return String(t || '')
      .replace(/(\d),(\d)/g, '$1.$2')
      .replace(/[ΡРр]/g, 'P')
      // v3.2.0：Paddle 把內十的 * 讀成 x／×／F／Φ，常跟 P 黏在一起（「10xP」「10*xP」「10×P」「10x」）→ 10*P／10*（rv1127_230254 有 10 發分數因此讀不出來）
      .replace(/(^|[^\d.:])(10(?:\.\d)?)\s?\*?\s?[xX×FΦφ✱](?=\s?[pP]?(?:\s|$|-))/g, '$1$2*')
      .replace(/(^|\s)(\d{1,2}(?:\.\d)?\*?)\s?[pP](?=\s|$|-)/g, '$1$2P').replace(/[－−–—]/g, '-').replace(/[：]/g, ':').replace(/[／]/g, '/');
  }
  /* files：File[]；opt：{ imgBase, rot:{ img→0/90/180/270（原引擎已經轉正的角度） }, onProgress(p), cancelled() }
   * 回傳 { passes:[{ img, kind:'pp', lines, ppRaw }], timing:{ load, decode, det, rec, total }, info } */
  function run(files, opt) {
    opt = opt || {}; var my = gen, t0 = now(), T = { load: 0, decode: 0, orient: 0, det: 0, rec: 0, total: 0 }, passes = [], info = { images: [] }, nf = files.length, base0 = opt.imgBase || 0, prog = opt.onProgress || function () {};
    var chk = function () { if (my !== gen || (opt.cancelled && opt.cancelled())) throw CANCEL; };
    return load().then(function (S) {
      T.load = Math.round(now() - t0); chk();
      var k = 0;
      function one() {
        if (k >= nf) return Promise.resolve(); chk();
        var idx = k++, ta = now(), G0;
        var fg = root.WRSiusX && root.WRSiusX.fileToGray ? root.WRSiusX.fileToGray : root.WRSiusOCR.fileToGray;
        return Promise.resolve(files[idx]).then(fg).then(function (g) {
          chk(); T.decode += now() - ta; var tb = now(), rk = opt.rot && opt.rot[base0 + idx], G;
          var pb = paperBox(g); G0 = pb ? crop(g, pb) : g; g = null;
          if (rk != null) G = rotG(G0, Math.round(rk / 90));
          else { var best = null; [0, 1, 2, 3].forEach(function (q) { var R = rotG(G0, q), sc = uprightScore(R); if (!best || sc > best.s) best = { s: sc, k: q, R: R }; }); G = best.R; rk = best.k * 90; }
          G0 = null; T.orient += now() - tb; var tc = now(), given = opt.rot && opt.rot[base0 + idx] != null;
          return detect(S, G, my).then(function (boxes) {
            T.det += now() - tc; chk();
            if (given || boxes.length < 4) return boxes;
            // 投影只分得出橫／直，分不出正／倒：拿最寬的 8 個框，正著讀跟轉 180 度讀比把握，倒的比較好 → 整張轉 180 度重新偵測
            var te = now(), top = boxes.slice().sort(function (a, b) { return b.w - a.w; }).slice(0, 16), flip = top.map(function (b) { return { cx: b.cx, cy: b.cy, ux: -b.ux, uy: -b.uy, vx: -b.vx, vy: -b.vy, w: b.w, h: b.h }; });
            // 比的是「讀起來像小白單」的程度（時間 mm:ss.ss、座標 x.xx/、Subtotal 等字；跟原引擎轉正同一套 oScore），同分再比把握
            var mean = function (rs) { return rs.reduce(function (a, r) { return a + (r ? r.score : 0); }, 0) / Math.max(1, rs.length); };
            var osc = function (rs) { var t = rs.map(function (r) { return norm(r ? r.text : ''); }).join('\n'); return root.WRSiusX && root.WRSiusX.oScore ? root.WRSiusX.oScore(t) : (t.match(/\d{2}:\d{2}\.\d{2}/g) || []).length; };
            return recognize(S, G, top, my).then(function (r1) { return recognize(S, G, flip, my).then(function (r2) {
              T.orient += now() - te; var s1 = osc(r1), s2 = osc(r2); info.flip = (info.flip || []).concat([[s1, s2]]);
              if (s2 < s1 || (s2 === s1 && mean(r2) <= mean(r1) + 0.1)) return boxes;
              G = rotG(G, 2); rk = (rk + 180) % 360; var tf = now();
              return detect(S, G, my).then(function (b2) { T.det += now() - tf; return b2; });
            }); });
          }).then(function (boxes) {
            chk(); var td = now();
            return recognize(S, G, boxes, my, function (p) { prog((idx + 0.3 + 0.7 * p) / nf); }).then(function (recs) {
              T.rec += now() - td;
              var L = lines(boxes, recs);
              passes.push({ img: base0 + idx, kind: 'pp', lines: L.map(function (l) { return norm(l.text); }), ppRaw: L.map(function (l) { return l.text; }) });
              info.images.push({ img: base0 + idx, w: G.w, h: G.h, rot: rk, boxes: boxes.length, lines: L.length });
              G = null; return one();
            });
          });
        }).then(null, function (e) { // 這一張讀失敗（解碼／記憶體不夠等）→ 只丟這張，其他張照樣（取消就整批停）
          if (e === CANCEL || my !== gen || (opt.cancelled && opt.cancelled())) throw CANCEL;
          info.images.push({ img: base0 + idx, err: String(e && e.message || e).slice(0, 60) }); G0 = null; return one();
        });
      }
      return one();
    }).then(function () { for (var kk in T) T[kk] = Math.round(T[kk]); T.total = Math.round(now() - t0); prog(1); return { passes: passes, timing: T, info: info }; },
      function (e) { if (my !== gen || (opt.cancelled && opt.cancelled())) throw CANCEL; throw e; });
  }
  root.WRSiusPP = { run: run, load: load, stop: stop, supported: supported, norm: norm, lines: lines, CFG: CFG, VENDOR: VENDOR, FILES: F };
})(typeof window !== 'undefined' ? window : this);
