/* 靶面-預報系統：照片自動校正與彈孔偵測（純 JS，無外部函式庫）
 * 1) 找黑色瞄準區（最大、最圓、不碰邊的暗色區塊）→ 沿射線找邊緣 → 擬合橢圓 → 仿射換算 px↔mm
 * 2) 把照片重新取樣成「以 mm 為單位」的正面靶圖 → 依黑區／白區背景找出亮（黑區內）或暗（白區）的異常
 *    → 形態學去掉環線與數字 → 連通區塊 → 依面積估計重疊發數並以 k-means 分開
 */
(function (root) {
  'use strict';

  function grayFromRGBA(data, w, h) {
    var g = new Float32Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    return g;
  }
  // 黃色度（米色紙偏黃，白色/灰色底板不黃）：(R+G)/2 − B
  function chromaFromRGBA(data, w, h) {
    var c = new Float32Array(w * h);
    for (var i = 0, j = 0; i < c.length; i++, j += 4) c[i] = (data[j] + data[j + 1]) / 2 - data[j + 2];
    return c;
  }
  function downsample(g, w, h, f) {
    var W = Math.floor(w / f), H = Math.floor(h / f), o = new Float32Array(W * H), n = f * f;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var s = 0; for (var dy = 0; dy < f; dy++) { var row = (y * f + dy) * w + x * f; for (var dx = 0; dx < f; dx++) s += g[row + dx]; }
      o[y * W + x] = s / n;
    }
    return { g: o, w: W, h: H };
  }
  function boxBlur(g, w, h, r) {
    var t = new Float32Array(w * h), o = new Float32Array(w * h), d = 2 * r + 1;
    for (var y = 0; y < h; y++) { var s = 0, row = y * w;
      for (var x = -r; x <= r; x++) s += g[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) { t[row + x] = s / d; s += g[row + Math.min(w - 1, x + r + 1)] - g[row + Math.max(0, x - r)]; } }
    for (var x2 = 0; x2 < w; x2++) { var s2 = 0;
      for (var y2 = -r; y2 <= r; y2++) s2 += t[Math.min(h - 1, Math.max(0, y2)) * w + x2];
      for (y2 = 0; y2 < h; y2++) { o[y2 * w + x2] = s2 / d; s2 += t[Math.min(h - 1, y2 + r + 1) * w + x2] - t[Math.max(0, y2 - r) * w + x2]; } }
    return o;
  }
  function otsu(g) {
    var hist = new Float64Array(256), n = g.length;
    for (var i = 0; i < n; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, thr = 128;
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break;
      sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; } }
    return thr + 0.5;
  }
  function labelComponents(mask, w, h) { // 4-連通
    var lab = new Int32Array(w * h), comps = [], stack = new Int32Array(w * h), id = 0;
    for (var p0 = 0; p0 < w * h; p0++) {
      if (!mask[p0] || lab[p0]) continue;
      id++; var c = { id: id, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, minx: w, maxx: 0, miny: h, maxy: 0, border: false, pix: null };
      var sp = 0; stack[sp++] = p0; lab[p0] = id;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        c.area++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
        if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x; if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
        if (x > 0 && mask[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !lab[p - w]) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !lab[p + w]) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      comps.push(c);
    }
    return { lab: lab, comps: comps };
  }
  function ellipseFromMoments(n, sx, sy, sxx, syy, sxy) {
    var mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    var tr = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
    return { cx: mx, cy: my, a: 2 * Math.sqrt(l1), b: 2 * Math.sqrt(l2) };
  }
  function bilinear(g, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return -1;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  }
  function median(arr) { if (!arr.length) return NaN; var a = Array.prototype.slice.call(arr).sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }

  // ---- 1. 找黑色瞄準區 ----
  // 光線不均（一側陰影、檯燈）時，整張用同一個門檻會把暗側的紙也當成黑區：
  // 先估計「紙的亮度」分布（大範圍最大值濾波＋平滑），再把每個像素除以它
  function flattenLight(g, w, h, r) {
    var t = new Float32Array(w * h), o = new Float32Array(w * h), x, y, k, m;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { m = 0; for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 2) if (g[y * w + k] > m) m = g[y * w + k]; t[y * w + x] = m; }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) { m = 0; for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 2) if (t[k * w + x] > m) m = t[k * w + x]; o[y * w + x] = m; }
    var bg = boxBlur(o, w, h, r), out = new Float32Array(w * h);
    for (var i = 0; i < w * h; i++) out[i] = Math.min(255, 200 * g[i] / Math.max(8, bg[i]));
    return out;
  }
  function findBlackBlob(g, w, h) {
    var f = Math.max(1, Math.ceil(Math.max(w, h) / 500));
    var s = downsample(g, w, h, f), sg = boxBlur(s.g, s.w, s.h, 1);
    return findBlackBlobIn(sg, s.w, s.h, f) || findBlackBlobIn(flattenLight(sg, s.w, s.h, Math.round(Math.max(s.w, s.h) / 10)), s.w, s.h, f);
  }
  // v1.7.1：列出所有候選黑區（面積門檻可調，給「靶紙在照片裡很小」時放大重試用），依分數由高到低
  function findBlackBlobs(g, w, h, minFrac) {
    var f = Math.max(1, Math.ceil(Math.max(w, h) / 500));
    var s = downsample(g, w, h, f), sg = boxBlur(s.g, s.w, s.h, 1), all = [];
    findBlackBlobIn(sg, s.w, s.h, f, minFrac, all);
    findBlackBlobIn(flattenLight(sg, s.w, s.h, Math.round(Math.max(s.w, s.h) / 10)), s.w, s.h, f, minFrac, all);
    all.sort(function (a, b) { return b.score - a.score; });
    var out = []; all.forEach(function (c) { if (!out.some(function (o) { return Math.hypot(o.cx - c.cx, o.cy - c.cy) < 0.5 * Math.min(o.R, c.R) && Math.max(o.R, c.R) < 1.4 * Math.min(o.R, c.R); })) out.push(c); });
    return out;
  }
  function findBlackBlobIn(sg, W, H, f, minFrac, list) {
    var thr = otsu(sg), mask = new Uint8Array(W * H);
    for (var i = 0; i < mask.length; i++) mask[i] = sg[i] < thr ? 1 : 0;
    var L = labelComponents(mask, W, H), best = null, mf = minFrac || 0.004;
    L.comps.forEach(function (c) {
      if (c.border || c.area < W * H * mf) return;
      // 填補內部（彈孔、白色環線造成的洞）
      var bw = c.maxx - c.minx + 3, bh = c.maxy - c.miny + 3, out = new Uint8Array(bw * bh), st = [], ox = c.minx - 1, oy = c.miny - 1;
      var inC = function (x, y) { var X = x + ox, Y = y + oy; return X >= 0 && Y >= 0 && X < W && Y < H && L.lab[Y * W + X] === c.id; };
      st.push(0); out[0] = 1;
      while (st.length) { var p = st.pop(), x = p % bw, y = (p - x) / bw;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var X = x + d[0], Y = y + d[1]; if (X < 0 || Y < 0 || X >= bw || Y >= bh) return; var q = Y * bw + X; if (!out[q] && !inC(X, Y)) { out[q] = 1; st.push(q); } }); }
      var n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (var yy = 0; yy < bh; yy++) for (var xx = 0; xx < bw; xx++) if (!out[yy * bw + xx]) { var X = xx + ox, Y = yy + oy; n++; sx += X; sy += Y; sxx += X * X; syy += Y * Y; sxy += X * Y; }
      var e = ellipseFromMoments(n, sx, sy, sxx, syy, sxy);
      var round = n / (Math.PI * e.a * e.b), axis = e.b / e.a;
      if (round < 0.85 || round > 1.12 || axis < 0.6) return;
      var dc = Math.hypot(e.cx - W / 2, e.cy - H / 2) / Math.hypot(W / 2, H / 2);
      var score = n * Math.pow(Math.min(round, 1 / round), 4) * (1 - 0.5 * dc);
      var cand = { score: score, cx: (e.cx + 0.5) * f - 0.5, cy: (e.cy + 0.5) * f - 0.5, R: Math.sqrt(e.a * e.b) * f, round: round };
      if (list) list.push(cand);
      if (!best || score > best.score) best = cand;
    });
    return best;
  }

  // 一般圓錐曲線擬合 A x² + B xy + C y² + D x + E y = 1（座標先平移到 (ox,oy)）
  function fitConic(pts, ox, oy) {
    var M = [], i, j, k;
    for (i = 0; i < 5; i++) { M.push([0, 0, 0, 0, 0, 0]); }
    pts.forEach(function (p) { var x = p[0] - ox, y = p[1] - oy, v = [x * x, x * y, y * y, x, y];
      for (i = 0; i < 5; i++) { for (j = 0; j < 5; j++) M[i][j] += v[i] * v[j]; M[i][5] += v[i]; } });
    for (i = 0; i < 5; i++) { var piv = i; for (k = i + 1; k < 5; k++) if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
      var t = M[i]; M[i] = M[piv]; M[piv] = t; if (Math.abs(M[i][i]) < 1e-18) return null;
      for (k = 0; k < 5; k++) if (k !== i) { var fct = M[k][i] / M[i][i]; for (j = i; j < 6; j++) M[k][j] -= fct * M[i][j]; } }
    var A = M[0][5] / M[0][0], B = M[1][5] / M[1][1], Cc = M[2][5] / M[2][2], D = M[3][5] / M[3][3], E = M[4][5] / M[4][4];
    var det = 4 * A * Cc - B * B; if (det <= 0) return null; // 不是橢圓
    var x0 = (B * E - 2 * Cc * D) / det, y0 = (B * D - 2 * A * E) / det;
    var kk = 1 + A * x0 * x0 + B * x0 * y0 + Cc * y0 * y0;
    if (kk <= 0) return null;
    return { cx: x0 + ox, cy: y0 + oy, N: [[A / kk, B / 2 / kk], [B / 2 / kk, Cc / kk]] }; // (p-c)ᵀN(p-c)=1
  }
  function symSqrt(N, inv) { // 2x2 對稱正定矩陣的平方根（或其反矩陣）
    var a = N[0][0], b = N[0][1], d = N[1][1], tr = a + d, disc = Math.sqrt(Math.max(0, (a - d) * (a - d) / 4 + b * b));
    var l1 = tr / 2 + disc, l2 = tr / 2 - disc; if (l2 <= 0) return null;
    var vx, vy; if (Math.abs(b) > 1e-15) { vx = l1 - d; vy = b; } else if (a >= d) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
    var nn = Math.hypot(vx, vy); vx /= nn; vy /= nn;
    var s1 = inv ? 1 / Math.sqrt(l1) : Math.sqrt(l1), s2 = inv ? 1 / Math.sqrt(l2) : Math.sqrt(l2);
    // V diag V^T，第二特徵向量 (-vy, vx)
    return [[s1 * vx * vx + s2 * vy * vy, (s1 - s2) * vx * vy], [(s1 - s2) * vx * vy, s1 * vy * vy + s2 * vx * vx]];
  }
  function ellipseRho(E, x, y) { var dx = x - E.cx, dy = y - E.cy; return Math.sqrt(E.N[0][0] * dx * dx + 2 * E.N[0][1] * dx * dy + E.N[1][1] * dy * dy); }

  // 由橢圓求 px→mm 仿射（假設照片「上」= 靶紙「上」，不另外旋轉）
  function affineFromEllipse(E, Rmm) {
    var S = symSqrt(E.N, false); if (!S) return null; // mm(x,−y) = R·S·(p−c)
    var a = Rmm * S[0][0], b = Rmm * S[0][1], d = -Rmm * S[1][0], e = -Rmm * S[1][1];
    return { a: a, b: b, c: -(a * E.cx + b * E.cy), d: d, e: e, f: -(d * E.cx + e * E.cy) };
  }

  function calibrate(g, w, h, target) {
    var blob = findBlackBlob(g, w, h);
    if (!blob) return { ok: false, reason: '找不到黑色瞄準區' };
    var R0 = blob.R, cx = blob.cx, cy = blob.cy;
    // 黑／白參考亮度
    var ins = [], outs = [];
    for (var k = 0; k < 360; k += 3) { var an = k * Math.PI / 180, co = Math.cos(an), si = Math.sin(an);
      for (var r = 0.45; r <= 0.85; r += 0.1) { var v = bilinear(g, w, h, cx + co * R0 * r, cy + si * R0 * r); if (v >= 0) ins.push(v); }
      for (r = 1.12; r <= 1.35; r += 0.06) { v = bilinear(g, w, h, cx + co * R0 * r, cy + si * R0 * r); if (v >= 0) outs.push(v); } }
    var black = median(ins), paper = median(outs), thr = (black + paper) / 2;
    if (!(paper - black > 15)) return { ok: false, reason: '黑白對比太低' };
    var pts = [], NR = 240, step = 0.5;
    for (k = 0; k < NR; k++) {
      var ang = 2 * Math.PI * k / NR, c2 = Math.cos(ang), s2 = Math.sin(ang), prof = [];
      var r0 = 0.8 * R0, r1 = 1.25 * R0;
      for (var rr = r0; rr <= r1; rr += step) prof.push(bilinear(g, w, h, cx + c2 * rr, cy + s2 * rr));
      // 從外往內找「亮→暗」交界：外側要連續亮一段、內側要連續暗一段（排除細環線與黑區內彈孔）
      var need = Math.max(3, Math.round(0.04 * R0 / step)), needDark = Math.max(3, Math.round(0.06 * R0 / step)), found = -1;
      for (var i = prof.length - need - 1; i > needDark; i--) {
        if (prof[i] < 0) { found = -2; break; }
        if (prof[i] < thr && prof[i + 1] >= thr) {
          var okRun = true, j;
          for (j = 1; j <= need; j++) if (prof[i + j] < thr) { okRun = false; break; }
          if (okRun) for (j = 0; j < needDark; j++) if (prof[i - j] >= thr) { okRun = false; break; }
          if (okRun) { found = i; break; }
        }
      }
      if (found < 0) continue;
      var t = (thr - prof[found]) / (prof[found + 1] - prof[found]), rEdge = r0 + (found + t) * step;
      pts.push([cx + c2 * rEdge, cy + s2 * rEdge]);
    }
    if (pts.length < 40) return { ok: false, reason: '黑區邊緣點太少' };
    var E = null, used = pts;
    for (var it = 0; it < 4; it++) {
      E = fitConic(used, cx, cy); if (!E) return { ok: false, reason: '橢圓擬合失敗' };
      var res = pts.map(function (p) { return Math.abs(ellipseRho(E, p[0], p[1]) - 1); });
      var md = median(res), lim = Math.max(3 * md, 0.004);
      used = pts.filter(function (p, q) { return res[q] <= lim; });
      if (used.length < 30) break;
    }
    var Rmm = target.blackDiam / 2;
    var T = affineFromEllipse(E, Rmm); if (!T) return { ok: false, reason: '仿射換算失敗' };
    // 照片旋轉角無法只從圓形判斷：假設照片「上」= 靶紙「上」，使用者可用旋轉微調修正
    var rot = { ok: false };
    var ss = 0; used.forEach(function (p) { var e = (ellipseRho(E, p[0], p[1]) - 1) * Rmm; ss += e * e; });
    // 用黑區內的白色環線修正靶心（透視時，越小的圓其中心越接近真正靶心；以 r² 外插到 r=0）
    var ref = refineCenterWithRings(g, w, h, T, target, E);
    if (ref) { E = { cx: ref.cx, cy: ref.cy, N: E.N }; T = affineFromEllipse(E, Rmm); }
    var S = symSqrt(E.N, true), axes = [Math.hypot(S[0][0], S[1][0]), Math.hypot(S[0][1], S[1][1])];
    var rms = Math.sqrt(ss / used.length);
    // 手持拍照有透視：只靠黑區邊緣（小圓）的仿射，外圈環會差到好幾 mm。用所有看得到的環線擬合透視投影。
    var proj = refineProjective(g, w, h, T, target, E.cx, E.cy, Math.sqrt(axes[0] * axes[1]));
    if (proj.ok) { T = proj.T; rms = proj.rmsMm; }
    return { ok: true, T: T, ellipse: E, rmsMm: rms, edgePts: used.length, totalPts: pts.length, proj: proj.info,
      pxPerMm: Math.sqrt(axes[0] * axes[1]) / Rmm, black: black, paper: paper, rotation: rot, rings: ref ? ref.rings : [] };
  }
  // ---- 1b. 透視校正：沿每一圈環線取點，擬合 px→mm 的 homography（8 參數），讓每點換算後半徑 = 規格環徑 ----
  // 米色區＝黑色細線（找最暗），黑區內＝白色細線（找最亮），黑區邊緣＝亮暗交界（找梯度）。
  // ISSF 環徑量到環線外緣，所以線中心對應 R − 線寬/2。由內而外、由寬到窄搜尋，避免一開始外圈偏太多抓錯線。
  function ringLineSamples(g, w, h, T, target, half, maxN, NR) {
    var Ti = invertAffine(T), out = [], lw = target.ringLine || 0.15, Rb = target.blackDiam / 2, wR = (target.ringDiam[1] - target.ringDiam[10]) / 18;
    half = Math.min(half, 0.42 * wR);
    var stp = Math.max(0.02, Math.min(0.06, wR / 160)), P = [0, 0];
    for (var n = 1; n <= maxN; n++) {
      var D = target.ringDiam[n]; if (!D || D < 4 || (n === 10 && target.tenIsDot)) continue;
      var R = D / 2, kind = Math.abs(D - target.blackDiam) < 0.3 ? 'edge' : (D < target.blackDiam ? 'bright' : 'dark');
      var Rt = kind === 'edge' ? R : R - lw / 2;
      if (kind !== 'edge' && Math.abs(R - Rb) < half + 0.4) continue; // 太靠近黑區邊緣的線不用
      for (var k = 0; k < NR; k++) {
        var an = 2 * Math.PI * (k + 0.5 * (n % 2)) / NR, co = Math.cos(an), si = Math.sin(an), prof = [], bad = false;
        for (var rr = R - half; rr <= R + half + 1e-9; rr += stp) {
          applyT(Ti, co * rr, si * rr, P); var v = bilinear(g, w, h, P[0], P[1]); if (v < 0) { bad = true; break; } prof.push(v);
        }
        if (bad || prof.length < 7) continue;
        var m = prof.length, sm = new Float32Array(m), i;
        for (i = 0; i < m; i++) sm[i] = (prof[Math.max(0, i - 1)] + prof[i] + prof[Math.min(m - 1, i + 1)]) / 3;
        var bi = -1, pos;
        if (kind === 'edge') {
          var bg = 0; for (i = 1; i < m - 1; i++) { var gr = sm[i + 1] - sm[i - 1]; if (gr > bg) { bg = gr; bi = i; } }
          if (bi < 2 || bi > m - 3 || bg < 30) continue;
          var g0 = sm[bi] - sm[bi - 2], g2 = sm[bi + 2] - sm[bi], dn = g0 - 2 * bg + g2; pos = bi + (dn ? 0.5 * (g0 - g2) / dn : 0);
        } else {
          var sgn = kind === 'dark' ? -1 : 1, best = -Infinity; for (i = 1; i < m - 1; i++) if (sgn * sm[i] > best) { best = sgn * sm[i]; bi = i; }
          if (bi < 2 || bi > m - 3) continue;
          var base = median(sm), amp = sgn * (sm[bi] - base); if (amp < 18) continue;
          // 線要細（半高寬 < 0.7mm），彈孔、數字、鉛筆圈都比較粗或不連續
          var hv = base + sgn * amp / 2, i0 = bi, i1 = bi;
          while (i0 > 0 && sgn * (sm[i0 - 1] - hv) > 0) i0--; while (i1 < m - 1 && sgn * (sm[i1 + 1] - hv) > 0) i1++;
          if ((i1 - i0 + 1) * stp > 0.7 || i0 === 0 || i1 === m - 1) continue;
          var y0 = sm[bi - 1], y1 = sm[bi], y2 = sm[bi + 1], dd = y0 - 2 * y1 + y2; pos = bi + (dd ? 0.5 * (y0 - y2) / dd : 0);
        }
        var rr2 = R - half + pos * stp; applyT(Ti, co * rr2, si * rr2, P);
        out.push([P[0], P[1], Rt]);
      }
    }
    return out;
  }
  function solveN(A, b) { // 小型線性方程（部分主元高斯消去）
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) { var p = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      var t = M[i]; M[i] = M[p]; M[p] = t; if (Math.abs(M[i][i]) < 1e-14) return null;
      for (k = i + 1; k < n; k++) { var f = M[k][i] / M[i][i]; for (j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } }
    var x = new Array(n); for (i = n - 1; i >= 0; i--) { var s2 = M[i][n]; for (j = i + 1; j < n; j++) s2 -= M[i][j] * x[j]; x[i] = s2 / M[i][i]; }
    return x;
  }
  // 參數 p（正規化像素座標 → mm）的半徑殘差
  function projResid(p, X, Y, Rt, i) { var w = p[6] * X[i] + p[7] * Y[i] + 1, u = (p[0] * X[i] + p[1] * Y[i] + p[2]) / w, v = (p[3] * X[i] + p[4] * Y[i] + p[5]) / w; return Math.hypot(u, v) - Rt[i]; }
  function fitProjective(pts, p0, cx, cy, S, iters) {
    var N = pts.length, X = new Float64Array(N), Y = new Float64Array(N), Rt = new Float64Array(N), i, j, k;
    for (i = 0; i < N; i++) { X[i] = (pts[i][0] - cx) / S; Y[i] = (pts[i][1] - cy) / S; Rt[i] = pts[i][2]; }
    var p = p0.slice(), lam = 1e-3, wts = new Float64Array(N), cost = function (q) { var c = 0; for (var t = 0; t < N; t++) { var r = projResid(q, X, Y, Rt, t); c += wts[t] * r * r; } return c; };
    for (var it = 0; it < iters; it++) {
      // IRLS：Huber 權重（0.15mm），離群點（抓到數字、彈孔、鉛筆）影響很小
      var res = []; for (i = 0; i < N; i++) res.push(Math.abs(projResid(p, X, Y, Rt, i)));
      var sc = Math.max(0.15, 1.4826 * median(res));
      for (i = 0; i < N; i++) wts[i] = res[i] > 4 * sc ? 0 : (res[i] <= sc ? 1 : sc / res[i]);
      var A = [], b = []; for (j = 0; j < 8; j++) { A.push([0, 0, 0, 0, 0, 0, 0, 0]); b.push(0); }
      for (i = 0; i < N; i++) { if (!wts[i]) continue;
        var x = X[i], y = Y[i], w = p[6] * x + p[7] * y + 1, u = (p[0] * x + p[1] * y + p[2]) / w, v = (p[3] * x + p[4] * y + p[5]) / w, r = Math.hypot(u, v) || 1e-9;
        var J = [u * x / (r * w), u * y / (r * w), u / (r * w), v * x / (r * w), v * y / (r * w), v / (r * w), -r * x / w, -r * y / w], e = r - Rt[i], wt = wts[i];
        for (j = 0; j < 8; j++) { b[j] -= wt * J[j] * e; for (k = j; k < 8; k++) A[j][k] += wt * J[j] * J[k]; } }
      for (j = 0; j < 8; j++) for (k = 0; k < j; k++) A[j][k] = A[k][j];
      var c0 = cost(p), improved = false;
      for (var tries = 0; tries < 6 && !improved; tries++) {
        var Al = A.map(function (r, q) { var rr = r.slice(); rr[q] += lam * (A[q][q] + 1e-9); return rr; }), d = solveN(Al, b);
        if (!d) { lam *= 10; continue; }
        var pn = p.map(function (v, q) { return v + d[q]; });
        if (cost(pn) <= c0) { p = pn; lam = Math.max(1e-6, lam / 3); improved = true; } else lam *= 10;
      }
      if (!improved) break;
    }
    var rs = []; for (i = 0; i < N; i++) rs.push(projResid(p, X, Y, Rt, i));
    return { p: p, res: rs };
  }
  // 正規化參數 p → 原始像素的 T，並去掉 mm 平面的旋轉自由度（只看半徑無法決定旋轉），維持「照片上＝靶紙上」
  function projToT(p, cx, cy, S, refT) {
    // 正規化：x' = (x−cx)/S → 代回
    var a = p[0] / S, b = p[1] / S, d = p[3] / S, e = p[4] / S, g = p[6] / S, h = p[7] / S;
    var c = p[2] - a * cx - b * cy, f = p[5] - d * cx - e * cy, z = 1 - g * cx - h * cy;
    var T = { a: a / z, b: b / z, c: c / z, d: d / z, e: e / z, f: f / z, g: g / z, h: h / z };
    // 旋轉：讓靶心附近的線性部分和原本仿射（同樣慣例）方向一致
    var Ti = invertAffine(T), o = applyT(Ti, 0, 0, []), eps = 1;
    var J0 = applyT(T, o[0] + eps, o[1], []), J1 = applyT(T, o[0], o[1] + eps, []);
    var ang = Math.atan2(J0[1], J0[0]) - Math.atan2(refT.d, refT.a);
    var ang2 = Math.atan2(J1[1], J1[0]) - Math.atan2(refT.e, refT.b);
    var dth = Math.atan2(Math.sin(ang) + Math.sin(ang2), Math.cos(ang) + Math.cos(ang2));
    return rotateAffine(T, -dth);
  }
  function refineProjective(g, w, h, T0, target, cx, cy, Spx) {
    var info = { used: false }, Rb = target.blackDiam / 2, S = Spx || 100;
    // 初值：仿射 T0 換到正規化座標
    var p = [T0.a * S, T0.b * S, T0.a * cx + T0.b * cy + T0.c, T0.d * S, T0.e * S, T0.d * cx + T0.e * cy + T0.f, 0, 0];
    var T = T0, nMax = 0, stages = [[2.6, 'inner'], [2.2, 'all'], [1.0, 'all'], [0.6, 'all']], pts = null, fit = null;
    // 內圈：黑區內的白線＋黑區邊緣＋黑區外兩圈
    var nInner = 1; for (var n = 1; n <= 10; n++) if (target.ringDiam[n] && target.ringDiam[n] / 2 > Rb + 0.5) nInner = n; // 黑區外最內圈的環號
    for (var st = 0; st < stages.length; st++) {
      var half = stages[st][0];
      pts = ringLineSamples(g, w, h, T, target, half, 10, 120);
      if (stages[st][1] === 'inner') { var lim = target.ringDiam[Math.max(1, nInner - 1)] / 2 + 1; pts = pts.filter(function (q) { return q[2] <= lim; }); }
      if (pts.length < 60) { info.reason = 'ring points ' + pts.length; return { ok: false, info: info }; }
      fit = fitProjective(pts, p, cx, cy, S, 8);
      p = fit.p; T = projToT(p, cx, cy, S, T0);
      // 更新正規化參數（旋轉後）
      var a = T.a, b = T.b, c = T.c, d = T.d, e = T.e, f = T.f, gg = T.g || 0, hh = T.h || 0, z = gg * cx + hh * cy + 1;
      p = [a * S / z, b * S / z, (a * cx + b * cy + c) / z, d * S / z, e * S / z, (d * cx + e * cy + f) / z, gg * S / z, hh * S / z];
    }
    var ar = fit.res.map(Math.abs), inl = ar.filter(function (r) { return r < 0.5; });
    var rms = Math.sqrt(inl.reduce(function (s2, r) { return s2 + r * r; }, 0) / Math.max(1, inl.length));
    // 和原本的仿射比較（同一批點）
    var aff = pts.map(function (q) { var m = applyT(T0, q[0], q[1], []); return Math.abs(Math.hypot(m[0], m[1]) - q[2]); });
    var affIn = aff.filter(function (r) { return r < 0.5; }), affMed = median(aff);
    // 覆蓋：至少要有 4 個象限的點、內點比例夠高
    var quad = [0, 0, 0, 0]; pts.forEach(function (q, i) { if (ar[i] < 0.5) { var m = applyT(T, q[0], q[1], []); quad[(m[0] >= 0 ? 0 : 1) + (m[1] >= 0 ? 0 : 2)]++; } });
    // 透視程度合理（分母在靶紙範圍內變化 < 40%）
    var wv = [], R1 = target.ringDiam[1] / 2, Tin = invertAffine(T);
    [[R1, 0], [-R1, 0], [0, R1], [0, -R1]].forEach(function (q) { var P = applyT(Tin, q[0], q[1], []); wv.push((T.g || 0) * P[0] + (T.h || 0) * P[1] + 1); });
    var wr = Math.max.apply(null, wv) / Math.min.apply(null, wv);
    info = { used: false, pts: pts.length, inliers: inl.length, rmsMm: rms, affMedMm: affMed, affInliers: affIn.length, quad: quad, wRatio: wr };
    if (inl.length < 150 || inl.length < 0.45 * pts.length || Math.min.apply(null, quad) < 15 || !(wr < 1.4) || !(rms < 0.35)) { info.reason = 'reject'; return { ok: false, info: info }; }
    info.used = true;
    return { ok: true, T: T, rmsMm: rms, info: info };
  }
  function refineCenterWithRings(g, w, h, T, target, Eblack) {
    var Ti = invertAffine(T), wR = (target.ringDiam[1] - target.ringDiam[10]) / 18, Rb = target.blackDiam / 2;
    var ringsD = [];
    for (var n = 1; n <= 10; n++) { var d = target.ringDiam[n]; if (d < target.blackDiam - 1 && d > 3) ringsD.push(d); }
    if (target.innerTen && target.innerTen.mode === 'ring' && target.innerTen.diam > 3) ringsD.push(target.innerTen.diam);
    var pts = { cx: [], cy: [], r2: [], wt: [] }, rings = [];
    // 黑區邊緣本身也是一個點
    pts.cx.push(Eblack.cx); pts.cy.push(Eblack.cy); pts.r2.push(Rb * Rb); pts.wt.push(1);
    var NR = 180, contrast = null;
    ringsD.forEach(function (D) {
      var R = D / 2, half = Math.min(0.35 * wR, 0.3 * R), stp = 0.04, found = [];
      for (var k = 0; k < NR; k++) {
        var an = 2 * Math.PI * k / NR, co = Math.cos(an), si = Math.sin(an), prof = [], bestV = -1, bestI = -1;
        for (var rr = R - half; rr <= R + half + 1e-9; rr += stp) {
          var x = co * rr, y = si * rr, P0 = applyT(Ti, x, y), v = bilinear(g, w, h, P0[0], P0[1]);
          prof.push(v); if (v > bestV) { bestV = v; bestI = prof.length - 1; }
        }
        if (bestV < 0 || prof.some(function (v) { return v < 0; })) continue;
        var base = median(prof), dark = Math.min.apply(null, prof);
        if (bestV - base < 25) continue;
        // 白線要細：亮度超過一半的寬度 < 0.6mm（彈孔很寬會被排除）
        var halfV = (bestV + base) / 2, i0 = bestI, i1 = bestI;
        while (i0 > 0 && prof[i0 - 1] > halfV) i0--; while (i1 < prof.length - 1 && prof[i1 + 1] > halfV) i1++;
        if ((i1 - i0 + 1) * stp > 0.6 || i0 === 0 || i1 === prof.length - 1) continue;
        // 亮度加權取次像素位置
        var sw = 0, sr = 0; for (var q = i0; q <= i1; q++) { var wt = prof[q] - halfV; sw += wt; sr += wt * q; }
        var rr2 = R - half + (sr / sw) * stp, xx = co * rr2, yy = si * rr2;
        found.push(applyT(Ti, xx, yy, []));
      }
      if (found.length < NR * 0.35) { rings.push({ d: D, n: found.length, used: false }); return; }
      var E = null, used = found;
      for (var it = 0; it < 4; it++) {
        E = fitConic(used, Eblack.cx, Eblack.cy); if (!E) break;
        var res = found.map(function (p) { return Math.abs(ellipseRho(E, p[0], p[1]) - 1); });
        var md = median(res), lim = Math.max(3 * md, 0.004);
        used = found.filter(function (p, q) { return res[q] <= lim; });
      }
      if (!E || used.length < NR * 0.3) { rings.push({ d: D, n: found.length, used: false }); return; }
      // 擬合出來的大小要和規格相符（±3%）
      var Sq = symSqrt(E.N, true), rpx = Math.sqrt(Math.hypot(Sq[0][0], Sq[1][0]) * Math.hypot(Sq[0][1], Sq[1][1]));
      var SqB = symSqrt(Eblack.N, true), rbpx = Math.sqrt(Math.hypot(SqB[0][0], SqB[1][0]) * Math.hypot(SqB[0][1], SqB[1][1]));
      var ratio = (rpx / rbpx) / (R / Rb);
      if (Math.abs(ratio - 1) > 0.03) { rings.push({ d: D, n: used.length, used: false, ratio: ratio }); return; }
      pts.cx.push(E.cx); pts.cy.push(E.cy); pts.r2.push(R * R); pts.wt.push(used.length / NR);
      rings.push({ d: D, n: used.length, used: true, ratio: ratio, cx: E.cx, cy: E.cy });
    });
    if (pts.cx.length < 2) return null;
    // 加權線性回歸：中心 = c0 + k·r²，取 r=0 的 c0
    function extrap(vals) {
      var sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var i = 0; i < vals.length; i++) { var wt = pts.wt[i], x = pts.r2[i]; sw += wt; sx += wt * x; sy += wt * vals[i]; sxx += wt * x * x; sxy += wt * x * vals[i]; }
      var den = sw * sxx - sx * sx; if (Math.abs(den) < 1e-9) return sy / sw;
      var k = (sw * sxy - sx * sy) / den; return (sy - k * sx) / sw;
    }
    var cx = extrap(pts.cx), cy = extrap(pts.cy);
    // 安全檢查：修正量不應超過 2mm
    var shift = Math.hypot(T.a * (cx - Eblack.cx) + T.b * (cy - Eblack.cy), T.d * (cx - Eblack.cx) + T.e * (cy - Eblack.cy));
    if (shift > 2) return null;
    return { cx: cx, cy: cy, rings: rings, shiftMm: shift };
  }
  function rotateAffine(T, th) { // 先 T，再把 mm 座標旋轉 th（逆時針為正）；透視投影的分母不變
    var c = Math.cos(th), s = Math.sin(th);
    var R = { a: c * T.a - s * T.d, b: c * T.b - s * T.e, c: c * T.c - s * T.f, d: s * T.a + c * T.d, e: s * T.b + c * T.e, f: s * T.c + c * T.f };
    if (T.g || T.h) { R.g = T.g || 0; R.h = T.h || 0; }
    return R;
  }
  // 用靶紙的直邊估計照片旋轉角（只能判斷 ±45° 以內）
  function estimateRotation(g, w, h, T, target) {
    var Ti = invertAffine(T), s = 2, half = target.cardSize * 0.75, n = Math.round(2 * half * s), G = new Float32Array(n * n), ok = new Uint8Array(n * n);
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var x = (i + 0.5) / s - half, y = half - (j + 0.5) / s, P1 = applyT(Ti, x, y), v = bilinear(g, w, h, P1[0], P1[1]);
      if (v >= 0) { G[j * n + i] = v; ok[j * n + i] = 1; } }
    var NB = 180, hist = new Float64Array(NB), R1 = target.ringDiam[1] / 2 + 3, tot = 0, ms = [], as = [];
    for (j = 1; j < n - 1; j++) for (i = 1; i < n - 1; i++) {
      var q = j * n + i; if (!ok[q - n - 1] || !ok[q + n + 1] || !ok[q - n + 1] || !ok[q + n - 1]) continue;
      var x2 = (i + 0.5) / s - half, y2 = half - (j + 0.5) / s; if (Math.hypot(x2, y2) < R1) continue;
      var gx = (G[q - n + 1] + 2 * G[q + 1] + G[q + n + 1]) - (G[q - n - 1] + 2 * G[q - 1] + G[q + n - 1]);
      var gy = (G[q - n - 1] + 2 * G[q - n] + G[q - n + 1]) - (G[q + n - 1] + 2 * G[q + n] + G[q + n + 1]); // y 向上
      var m = gx * gx + gy * gy; if (m < 1600) continue;
      var a = Math.atan2(gy, gx) * 180 / Math.PI; a = ((a % 90) + 135) % 90 - 45; // [-45,45)
      ms.push(m); as.push(a);
    }
    if (ms.length < 50) return { ok: false };
    // 只用最強的邊（靶紙與背景的交界），避開雜訊與 JPEG 方塊紋
    var sorted = ms.slice().sort(function (p, q2) { return p - q2; }), p99 = sorted[Math.floor(sorted.length * 0.995)], mthr = 0.15 * p99;
    for (i = 0; i < ms.length; i++) if (ms[i] >= mthr) { var bin = Math.floor((as[i] + 45) / 90 * NB) % NB; hist[bin] += 1; tot += 1; }
    if (!tot) return { ok: false };
    var sm = new Float64Array(NB); for (i = 0; i < NB; i++) for (var k = -2; k <= 2; k++) sm[i] += hist[(i + k + NB) % NB] * (3 - Math.abs(k));
    var bi = 0; for (i = 1; i < NB; i++) if (sm[i] > sm[bi]) bi = i;
    var mean = 0; for (i = 0; i < NB; i++) mean += sm[i]; mean /= NB;
    var y0 = sm[(bi + NB - 1) % NB], y1 = sm[bi], y2b = sm[(bi + 1) % NB], off = (y0 - y2b) / (2 * (y0 - 2 * y1 + y2b) || 1);
    var deg = ((bi + 0.5 + off) / NB) * 90 - 45, prom = y1 / mean;
    return { ok: prom > 3, deg: deg, prominence: prom };
  }

  // ---- 2. 彈孔偵測 ----
  function minmaxFilter(src, w, h, r, isMax) { // 方形視窗，分離式
    var t = new Uint8Array(w * h), o = new Uint8Array(w * h), x, y, k, v;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { v = isMax ? 0 : 1;
      for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { var s = src[y * w + k]; if (isMax ? s : !s) { v = isMax ? 1 : 0; break; } }
      t[y * w + x] = v; }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) { v = isMax ? 0 : 1;
      for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { var s2 = t[k * w + x]; if (isMax ? s2 : !s2) { v = isMax ? 1 : 0; break; } }
      o[y * w + x] = v; }
    return o;
  }
  function robustPlane(xs, ys, vs) { // 反覆剔除離群的平面擬合 v = p0 + p1 x + p2 y
    var idx = []; for (var i = 0; i < vs.length; i++) idx.push(i);
    var P = [median(vs), 0, 0];
    for (var it = 0; it < 4; it++) {
      var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
      idx.forEach(function (i) { var v = [1, xs[i], ys[i]]; for (var a = 0; a < 3; a++) { for (var c = 0; c < 3; c++) S[a][c] += v[a] * v[c]; b[a] += v[a] * vs[i]; } });
      var sol = solve3(S, b); if (!sol) break; P = sol;
      var res = []; for (i = 0; i < vs.length; i++) res.push(vs[i] - (P[0] + P[1] * xs[i] + P[2] * ys[i]));
      var mad = median(res.map(Math.abs)) * 1.4826 + 1;
      idx = []; for (i = 0; i < vs.length; i++) if (Math.abs(res[i]) < 2.5 * mad) idx.push(i);
      if (idx.length < 10) break;
    }
    return P;
  }
  function solve3(A, b) {
    var M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < 3; c++) { var p = c; for (var r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null; var t = M[c]; M[c] = M[p]; M[p] = t;
      for (r = 0; r < 3; r++) if (r !== c) { var f = M[r][c] / M[c][c]; for (var k = c; k < 4; k++) M[r][k] -= f * M[c][k]; } }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }
  function kmeans(px, py, k) {
    var n = px.length, cx = [px[0]], cy = [py[0]], i, j;
    // 最遠點初始化
    var c0x = 0, c0y = 0; for (i = 0; i < n; i++) { c0x += px[i]; c0y += py[i]; } c0x /= n; c0y /= n;
    var far = 0, fd = -1; for (i = 0; i < n; i++) { var d0 = Math.hypot(px[i] - c0x, py[i] - c0y); if (d0 > fd) { fd = d0; far = i; } }
    cx = [px[far]]; cy = [py[far]];
    while (cx.length < k) { var bi = 0, bd = -1; for (i = 0; i < n; i++) { var m = Infinity; for (j = 0; j < cx.length; j++) m = Math.min(m, Math.hypot(px[i] - cx[j], py[i] - cy[j])); if (m > bd) { bd = m; bi = i; } } cx.push(px[bi]); cy.push(py[bi]); }
    var asg = new Int32Array(n);
    for (var it = 0; it < 20; it++) {
      for (i = 0; i < n; i++) { var best = 0, bdd = Infinity; for (j = 0; j < k; j++) { var dd = (px[i] - cx[j]) * (px[i] - cx[j]) + (py[i] - cy[j]) * (py[i] - cy[j]); if (dd < bdd) { bdd = dd; best = j; } } asg[i] = best; }
      var sx = new Float64Array(k), sy = new Float64Array(k), sn = new Float64Array(k);
      for (i = 0; i < n; i++) { sx[asg[i]] += px[i]; sy[asg[i]] += py[i]; sn[asg[i]]++; }
      for (j = 0; j < k; j++) if (sn[j]) { cx[j] = sx[j] / sn[j]; cy[j] = sy[j] / sn[j]; }
    }
    var out = []; for (j = 0; j < k; j++) out.push([cx[j], cy[j]]); return out;
  }

  function fitBlackEdgeMm(G, valid, n, s, Rmax, Rb, thr) {
    var pts = [], step = 1 / s, need = Math.max(2, Math.round(0.5 * s));
    for (var k = 0; k < 180; k++) {
      var an = k * Math.PI / 90, co = Math.cos(an), si = Math.sin(an), prof = [];
      for (var r = Rb - 2.5; r <= Rb + 2.5; r += step) {
        var i = Math.floor((co * r + Rmax) * s), j = Math.floor((Rmax - si * r) * s), q = j * n + i;
        prof.push(i >= 0 && j >= 0 && i < n && j < n && valid[q] ? G[q] : -1);
      }
      for (var t = prof.length - need - 1; t > need; t--) {
        if (prof[t] < 0) break;
        if (prof[t] < thr && prof[t + 1] >= thr) {
          var ok = true, u; for (u = 1; u <= need; u++) if (prof[t + u] < thr) ok = false;
          for (u = 0; u < need; u++) if (prof[t - u] >= thr || prof[t - u] < 0) ok = false;
          if (ok) { var f = (thr - prof[t]) / (prof[t + 1] - prof[t] || 1), rr = Rb - 2.5 + (t + f) * step; pts.push([co * rr, si * rr]); break; }
        }
      }
    }
    var res = { ox: 0, oy: 0, R: Rb, n: pts.length };
    if (pts.length < 40) return res;
    var use = pts;
    for (var it = 0; it < 3; it++) {
      // Kasa 圓擬合：x²+y² + D x + E y + F = 0
      var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
      use.forEach(function (p) { var v = [p[0], p[1], 1], z = -(p[0] * p[0] + p[1] * p[1]); for (var a = 0; a < 3; a++) { for (var c = 0; c < 3; c++) S[a][c] += v[a] * v[c]; b[a] += v[a] * z; } });
      var sol = solve3(S, b); if (!sol) break;
      var ox = -sol[0] / 2, oy = -sol[1] / 2, R = Math.sqrt(Math.max(0, ox * ox + oy * oy - sol[2]));
      if (!(Math.abs(R - Rb) < 1.5 && Math.hypot(ox, oy) < 2)) break;
      res = { ox: ox, oy: oy, R: R, n: use.length };
      var d = pts.map(function (p) { return Math.abs(Math.hypot(p[0] - ox, p[1] - oy) - R); }), md = median(d);
      use = pts.filter(function (p, i) { return d[i] <= Math.max(3 * md, 0.1); });
      if (use.length < 30) break;
    }
    return res;
  }

  // sens: 1 = 標準；<1 較靈敏；>1 較保守
  function detectHoles(g, w, h, T, target, sens, chroma) {
    sens = sens || 1;
    var Ti = invertAffine(T), PP = [0, 0], pellet = target.pellet, Rb = target.blackDiam / 2, R1 = target.ringDiam[1] / 2;
    var s = Math.max(4, Math.min(16, 27 / pellet * (target.id === 'ar10' ? 2 : 1))); // px/mm（手槍 6、步槍 12）
    var Rmax = R1 + pellet + 2, n = Math.ceil(2 * Rmax * s), G = new Float32Array(n * n), valid = new Uint8Array(n * n), rr = new Float32Array(n * n);
    var X = new Float32Array(n * n), Y = new Float32Array(n * n), CH = chroma ? new Float32Array(n * n) : null;
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var x = (i + 0.5) / s - Rmax, y = Rmax - (j + 0.5) / s, q = j * n + i;
      X[q] = x; Y[q] = y; rr[q] = Math.hypot(x, y);
      applyT(Ti, x, y, PP); var px = PP[0], py = PP[1], v = bilinear(g, w, h, px, py);
      if (v >= 0 && rr[q] <= Rmax) { G[q] = v; valid[q] = 1; if (CH) CH[q] = bilinear(chroma, w, h, px, py); }
    }
    // 背景平面（黑區、白紙各一）
    var bx = [], by = [], bv = [], wx = [], wy = [], wv = [];
    for (q = 0; q < n * n; q += 3) { if (!valid[q]) continue;
      if (rr[q] < Rb - 1) { bx.push(X[q]); by.push(Y[q]); bv.push(G[q]); }
      else if (rr[q] > Rb + 1 && rr[q] < R1 - 0.5) { wx.push(X[q]); wy.push(Y[q]); wv.push(G[q]); } }
    if (bv.length < 50 || wv.length < 50) return { ok: false, reason: '靶面範圍不足', holes: [] };
    var PB = robustPlane(bx, by, bv), PW = robustPlane(wx, wy, wv), C = PW[0] - PB[0];
    if (C < 15) return { ok: false, reason: '黑白對比太低', holes: [] };
    // 在換算後的 mm 座標中重新量黑區邊緣（靶心以環線修正後，黑區圓心可能偏一點點）
    var EB = fitBlackEdgeMm(G, valid, n, s, Rmax, Rb, (PB[0] + PW[0]) / 2);
    var rb = new Float32Array(n * n); for (q = 0; q < n * n; q++) rb[q] = Math.hypot(X[q] - EB.ox, Y[q] - EB.oy) - (EB.R - Rb);
    // 白紙（米色紙也一樣）上的彈孔：可能比紙暗（陰影、深色底板）也可能比紙亮（白色底板）
    var pres = []; for (q = 0; q < wv.length; q++) pres.push(Math.abs(wv[q] - (PW[0] + PW[1] * wx[q] + PW[2] * wy[q])));
    var pmad = median(pres) * 1.4826;
    // 米色紙：白色底板透出的彈孔亮度和紙差不多，但「不黃」→ 用黃色度找
    var PC = null, tChroma = 0;
    if (CH) {
      var cv = []; for (q = 0; q < n * n; q += 3) if (valid[q] && rr[q] > Rb + 1 && rr[q] < R1 - 0.5) cv.push(CH[q]);
      var cx2 = [], cy2 = []; for (q = 0; q < n * n; q += 3) if (valid[q] && rr[q] > Rb + 1 && rr[q] < R1 - 0.5) { cx2.push(X[q]); cy2.push(Y[q]); }
      PC = robustPlane(cx2, cy2, cv);
      var cres = cv.map(function (v, i) { return Math.abs(v - (PC[0] + PC[1] * cx2[i] + PC[2] * cy2[i])); });
      var cmad = median(cres) * 1.4826;
      if (PC[0] > 10) tChroma = Math.max(0.4 * PC[0], 4 * cmad) * sens; else PC = null; // 紙要夠黃才用
    }
    var tIn = 0.33 * sens, tDark = Math.max(0.14, 4 * pmad / C) * sens, tBright = Math.max(0.08, 4 * pmad / C) * sens, band = 0.35, mask = new Uint8Array(n * n);
    for (q = 0; q < n * n; q++) { if (!valid[q]) continue; var r = rb[q];
      if (r < Rb - band) { if ((G[q] - (PB[0] + PB[1] * X[q] + PB[2] * Y[q])) / C > tIn) mask[q] = 1; }
      else if (r > Rb + band) { var dv = (G[q] - (PW[0] + PW[1] * X[q] + PW[2] * Y[q])) / C; if (dv < -tDark || dv > tBright) mask[q] = 1;
        else if (PC && (PC[0] + PC[1] * X[q] + PC[2] * Y[q]) - CH[q] > tChroma && G[q] > PB[0] + 0.5 * C) mask[q] = 1; } }
    // 開運算去掉環線／數字（< 約 1mm 的細節），再閉運算把跨黑白交界的彈孔接起來
    var ro = Math.max(1, Math.round(0.5 * s)), rc = Math.max(1, Math.round(0.45 * s));
    var m2 = minmaxFilter(minmaxFilter(mask, n, n, ro, false), n, n, ro, true);
    m2 = minmaxFilter(minmaxFilter(m2, n, n, rc, true), n, n, rc, false);
    if (root.__bmDebug) root.__bmDebug.det = { CH: CH, PC: PC, tChroma: tChroma, pmad: pmad, tBright: tBright, tDark: tDark, G: G, valid: valid, mask: mask, m2: m2, n: n, s: s, Rmax: Rmax, PW: PW, PB: PB, C: C };
    var L = labelComponents(m2, n, n), a1 = Math.PI * pellet * pellet / 4 * s * s;
    // 延伸到第 1 環外很遠的區塊＝紙張邊緣外（白色底板、桌面），不是彈孔（第 1 環最外的有效彈孔也只到 R1 + 彈徑）
    var offPaper = {}, rOff = R1 + pellet + 0.5;
    for (q = 0; q < n * n; q++) if (L.lab[q] && (rr[q] > rOff || (!valid[q] && m2[q]))) offPaper[L.lab[q]] = 1;
    var comps = L.comps.filter(function (c) { return c.area >= 0.35 * a1 * sens && !c.border && !offPaper[c.id]; });
    // 單發面積：用接近單發大小的區塊中位數，否則用理論值
    var singles = comps.filter(function (c) { return c.area > 0.55 * a1 && c.area < 1.45 * a1; }).map(function (c) { return c.area; });
    var aS = singles.length >= 3 ? median(singles) : a1;
    var holes = [];
    var rS = Math.sqrt(aS / Math.PI);
    comps.forEach(function (c) {
      var e = ellipseFromMoments(c.area, c.sx, c.sy, c.sxx, c.syy, c.sxy), conf;
      var guess = c.area / aS;
      if (guess < 1.35 && e.b / e.a > 0.7) { // 單發
        conf = Math.max(0.1, Math.min(1, 1 - Math.abs(1 - guess) * 0.8)) * Math.min(1, (e.b / e.a) / 0.75);
        holes.push({ x: (e.cx + 0.5) / s - Rmax, y: Rmax - (e.cy + 0.5) / s, conf: conf, group: 1 });
        return;
      }
      // 重疊：試不同發數 k，用「k 個彈孔圓的聯集」和區塊形狀比對，選最吻合的 k
      var pxs = [], pys = [], x0 = c.minx - Math.ceil(rS), y0 = c.miny - Math.ceil(rS), x1 = c.maxx + Math.ceil(rS), y1 = c.maxy + Math.ceil(rS);
      for (var yy = c.miny; yy <= c.maxy; yy++) for (var xx = c.minx; xx <= c.maxx; xx++) if (L.lab[yy * n + xx] === c.id) { pxs.push(xx); pys.push(yy); }
      var kMax = Math.min(30, Math.max(2, Math.ceil(guess * 1.8) + 1)), best = null;
      for (var k = 1; k <= kMax; k++) {
        var cs = kmeans(pxs, pys, k), bad = 0;
        for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) {
          var inBlob = xx >= 0 && yy >= 0 && xx < n && yy < n && L.lab[yy * n + xx] === c.id, inU = false;
          for (var q2 = 0; q2 < k && !inU; q2++) if ((xx - cs[q2][0]) * (xx - cs[q2][0]) + (yy - cs[q2][1]) * (yy - cs[q2][1]) <= rS * rS) inU = true;
          if (inBlob !== inU) bad++;
        }
        var score = bad / c.area + 0.04 * k; // 小懲罰，避免切太多
        if (!best || score < best.score) best = { score: score, k: k, cs: cs, mis: bad / c.area };
      }
      conf = Math.max(0.1, Math.min(0.9, 1 - best.mis * 1.5) - 0.05 * best.k);
      best.cs.forEach(function (p) { holes.push({ x: (p[0] + 0.5) / s - Rmax, y: Rmax - (p[1] + 0.5) / s, conf: conf, group: best.k }); });
    });
    // 黑區邊緣「缺口」：彈孔大部分在黑區外（米色紙上幾乎看不出來），只咬掉黑區邊緣一小塊
    var bandIn = Rb - pellet / 2 - 0.15, bm = new Uint8Array(n * n);
    for (q = 0; q < n * n; q++) if (mask[q] && rb[q] > bandIn && rb[q] < Rb - band) bm[q] = 1;
    var LB = labelComponents(bm, n, n), minA = 0.6 * s * s; // ≥ 0.6mm²
    LB.comps.forEach(function (c) {
      if (c.area < minA) return;
      var rmin = Infinity, rmaxC = -Infinity, sa = 0, ca = 0;
      for (var yy = c.miny; yy <= c.maxy; yy++) for (var xx = c.minx; xx <= c.maxx; xx++) { var q3 = yy * n + xx; if (LB.lab[q3] !== c.id) continue;
        if (rb[q3] < rmin) rmin = rb[q3]; if (rb[q3] > rmaxC) rmaxC = rb[q3]; var an = Math.atan2(Y[q3] - EB.oy, X[q3] - EB.ox); sa += Math.sin(an); ca += Math.cos(an); }
      var ang = Math.atan2(sa, ca), depth = Rb - rmin;
      // 缺口的弧長要像一個彈孔（弦長 ≈ 2·√(2.25² − (2.25−深度)²)）
      var chordMax = 2 * Math.sqrt(Math.max(0, pellet * pellet / 4 - Math.pow(pellet / 2 - depth, 2))) + 1.0;
      var span = (c.area / s / s) / Math.max(0.2, depth) * 1.5;
      // 必須連到黑區邊緣（排除印在邊緣附近的白色環數數字）
      if (depth < 0.4 || span > chordMax * 2.2 || rmaxC < Rb - band - 2 / s) return;
      var rc2 = rmin + pellet / 2 + (EB.R - Rb), hx = EB.ox + rc2 * Math.cos(ang), hy = EB.oy + rc2 * Math.sin(ang);
      if (holes.some(function (p) { return Math.hypot(p.x - hx, p.y - hy) < pellet * 0.8; })) return;
      holes.push({ x: hx, y: hy, conf: 0.45, group: 1, edgeNotch: true });
    });
    holes = holes.filter(function (p) { return Math.hypot(p.x, p.y) <= R1 + pellet / 2; });
    return { ok: true, holes: holes, contrast: C, pxPerMm: s, singleArea: aS / s / s };
  }
  // 換算 T：{a..f} 為仿射；多了 g,h 時是透視投影（homography）：
  //   X = (a x + b y + c) / (g x + h y + 1)，Y = (d x + e y + f) / (g x + h y + 1)
  function invertAffine(T) {
    var a = T.a, b = T.b, c = T.c, d = T.d, e = T.e, f = T.f, g = T.g || 0, h = T.h || 0;
    var A = e - f * h, B = -(b - c * h), Cc = b * f - c * e, D = -(d - f * g), E = a - c * g, F = -(a * f - c * d), G = d * h - e * g, H = -(a * h - b * g), I = a * e - b * d;
    if (!I) return null;
    var R = { a: A / I, b: B / I, c: Cc / I, d: D / I, e: E / I, f: F / I };
    if (g || h) { R.g = G / I; R.h = H / I; }
    return R;
  }
  function applyT(T, x, y, out) {
    var w = (T.g ? T.g * x : 0) + (T.h ? T.h * y : 0) + 1;
    out = out || [0, 0]; out[0] = (T.a * x + T.b * y + T.c) / w; out[1] = (T.d * x + T.e * y + T.f) / w; return out;
  }

  var api = { applyT: applyT, invertAffine: invertAffine, refineProjective: refineProjective, chromaFromRGBA: chromaFromRGBA, rotateAffine: rotateAffine, grayFromRGBA: grayFromRGBA, calibrate: calibrate, detectHoles: detectHoles, findBlackBlob: findBlackBlob, findBlackBlobs: findBlackBlobs, fitConic: fitConic, affineFromEllipse: affineFromEllipse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BMVision = api;
})(typeof window !== 'undefined' ? window : this);
