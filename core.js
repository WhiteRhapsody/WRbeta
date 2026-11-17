/* 靶面-預報系統 核心計算（可在瀏覽器與 Node 使用）
 * 尺寸來源：ISSF Rule Book 2026 Edition 2025 (Third Print 10/2026, effective 19 Oct 2026)
 *   6.3.4.3 10m Air Rifle Target / 6.3.4.6 10m Air Pistol Target
 *   彈徑 4.5mm：7.4.6 / 8.4.3.5；小數計分：6.3.3.1
 * 座標：單位 mm，原點為靶心，x 向右為正，y 向上為正。
 */
(function (root) {
  'use strict';
  var EPS = 1e-9;

  // 各環「外徑」（mm），索引 = 環數
  var TARGETS = {
    ap10: {
      id: 'ap10', name: '10米空氣手槍', short: '空手',
      rule: 'ISSF 6.3.4.6',
      ringDiam: { 10: 11.5, 9: 27.5, 8: 43.5, 7: 59.5, 6: 75.5, 5: 91.5, 4: 107.5, 3: 123.5, 2: 139.5, 1: 155.5 },
      blackDiam: 59.5,          // 7–10 環為黑色
      blackFromRing: 7,
      innerTen: { mode: 'ring', diam: 5.0, label: '內十' }, // 內十圈 5.0mm，彈孔觸及即算
      printedNumbers: [1, 2, 3, 4, 5, 6, 7, 8],             // 9、10 環不標數字
      tenIsDot: false,
      cardSize: 170,            // 最小可見靶紙 170×170mm
      pellet: 4.5,
      ringLine: 0.15            // 規定 0.1–0.2mm
    },
    ar10: {
      id: 'ar10', name: '10米空氣步槍', short: '空步',
      rule: 'ISSF 6.3.4.3',
      ringDiam: { 10: 0.5, 9: 5.5, 8: 10.5, 7: 15.5, 6: 20.5, 5: 25.5, 4: 30.5, 3: 35.5, 2: 40.5, 1: 45.5 },
      blackDiam: 30.5,          // 4–9 環為黑色
      blackFromRing: 4,
      innerTen: { mode: 'dotShotOut', diam: 0.5, label: '內十' }, // 10 環白點被完全打掉
      printedNumbers: [1, 2, 3, 4, 5, 6, 7, 8],             // 9 環不標，10 為白點
      tenIsDot: true,
      cardSize: 80,             // 最小可見靶紙 80×80mm
      pellet: 4.5,
      ringLine: 0.15
    }
    // 之後可在此加入 r50 (50m Rifle 6.3.4.2)、p25 (6.3.4.5)、rf25 (6.3.4.4)
  };

  function ringWidth(t) { // 每一環的半徑寬度（mm）
    return (t.ringDiam[1] - t.ringDiam[10]) / 2 / 9;
  }

  /* 單發計分：彈孔（直徑 4.5mm）只要觸及較高環的外緣就算較高分。
   * 等同：彈孔中心到靶心距離 d ≤ 該環外半徑 + 彈孔半徑。
   * 小數分（6.3.3.1）：把一整環的計分區平均分成十等分，
   *   dec = 10 + (R10' − d)/w，R10' = 10 環外半徑 + 彈孔半徑，w = 環寬；
   *   無條件捨去到 0.1，最高 10.9；未觸及 1 環 = 0。 */
  function scoreShot(t, x, y) {
    var r = t.pellet / 2;
    var d = Math.sqrt(x * x + y * y);
    var ring = 0;
    for (var n = 10; n >= 1; n--) {
      if (d <= t.ringDiam[n] / 2 + r + EPS) { ring = n; break; }
    }
    var dec = 0;
    if (ring > 0) {
      var R10 = t.ringDiam[10] / 2 + r;
      var w = ringWidth(t);
      var raw = 10 + (R10 - d) / w;
      dec = Math.floor(raw * 10 + 1e-7) / 10;
      if (dec > 10.9) dec = 10.9;
      if (dec < ring) dec = ring; // 防浮點誤差
    }
    var inner = false;
    if (t.innerTen.mode === 'ring') {
      inner = d <= t.innerTen.diam / 2 + r + EPS;
    } else if (t.innerTen.mode === 'dotShotOut') {
      // 10 環白點（0.5mm）完全在彈孔內：d + 0.25 ≤ 2.25 → d ≤ 2.0mm
      inner = d + t.innerTen.diam / 2 <= r + EPS;
    }
    return { x: x, y: y, d: d, ring: ring, dec: Math.round(dec * 10) / 10, inner: inner };
  }

  function round(v, k) { var m = Math.pow(10, k || 1); return Math.round(v * m) / m; }

  function directionText(dx, dy, th) {
    var h = dx > th ? '右' : (dx < -th ? '左' : '');
    var v = dy > th ? '上' : (dy < -th ? '下' : '');
    if (!h && !v) return '置中';
    return '偏' + h + v;
  }

  function computeStats(t, shots) {
    var s = shots.map(function (p) { return scoreShot(t, p.x, p.y); });
    var n = s.length;
    var res = {
      n: n, total: 0, totalDec: 0, avg: 0, avgDec: 0, inner: 0,
      counts: { 10: 0, 9: 0, 8: 0, 7: 0, below7: 0 },
      proj60: null, proj60Dec: null, meanX: 0, meanY: 0, meanR: 0, direction: '—', groupSize: 0, groupPair: null,
      series: [], shots: s
    };
    if (!n) return res;
    var sx = 0, sy = 0, sr = 0, tot = 0, totD10 = 0;
    s.forEach(function (q) {
      tot += q.ring; totD10 += Math.round(q.dec * 10);
      if (q.inner) res.inner++;
      if (q.ring >= 7) res.counts[q.ring]++; else res.counts.below7++;
      sx += q.x; sy += q.y; sr += q.d;
    });
    res.total = tot; res.totalDec = totD10 / 10;
    res.avg = tot / n; res.avgDec = totD10 / 10 / n;
    // 以目前平均換算 60 發總分
    res.proj60 = Math.round(res.avg * 60); res.proj60Dec = Math.round(res.avgDec * 60 * 10) / 10;
    res.meanX = sx / n; res.meanY = sy / n; res.meanR = sr / n;
    res.direction = directionText(res.meanX, res.meanY, ringWidth(t) * 0.2);
    // 彈著群大小：任兩發中心最大距離（中心到中心）
    for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++) {
      var g = Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y);
      if (g > res.groupSize) { res.groupSize = g; res.groupPair = [i, j]; }
    }
    for (var k = 0; k < n; k += 10) {
      var part = s.slice(k, k + 10), a = 0, b = 0;
      part.forEach(function (q) { a += q.ring; b += Math.round(q.dec * 10); });
      res.series.push({ from: k + 1, to: k + part.length, total: a, totalDec: b / 10 });
    }
    return res;
  }

  /* 最小總距離配對（匈牙利演算法），回傳 match[i] = 實際彈孔索引或 -1 */
  function hungarian(cost) { // cost: n×m，n ≤ m
    var n = cost.length, m = n ? cost[0].length : 0, INF = 1e18;
    var u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (var i = 1; i <= n; i++) {
      p[0] = i; var j0 = 0, minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true; var i0 = p[j0], delta = INF, j1 = 0;
        for (var j = 1; j <= m; j++) if (!used[j]) {
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var jj = way[j0]; p[j0] = p[jj]; j0 = jj; } while (j0);
    }
    var match = new Array(n).fill(-1);
    for (var k = 1; k <= m; k++) if (p[k]) match[p[k] - 1] = k - 1;
    return match;
  }
  function matchOptimal(preds, actuals) { // 回傳 [[predIdx, actIdx], ...]，依預報順序
    var P = preds.length, A = actuals.length; if (!P || !A) return [];
    var swap = P > A, rows = swap ? actuals : preds, cols = swap ? preds : actuals;
    var cost = rows.map(function (r) { return cols.map(function (c) { return Math.hypot(r.x - c.x, r.y - c.y); }); });
    var mt = hungarian(cost), out = [];
    mt.forEach(function (j, i) { if (j >= 0) out.push(swap ? [j, i] : [i, j]); });
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }

  /* 預報 vs 實際：mode = 'order'（依射擊順序）或 'optimal'（最小總距離配對，順序未知時用） */
  function comparePredictions(t, preds, actuals, mode) {
    var idx = [];
    if (mode === 'optimal') idx = matchOptimal(preds, actuals);
    else for (var q = 0; q < Math.min(preds.length, actuals.length); q++) idx.push([q, q]);
    var m = idx.length;
    var pairs = [], se = 0, bx = 0, by = 0, sameRing = 0, absScore = 0;
    for (var i = 0; i < m; i++) {
      var pi = idx[i][0], ai = idx[i][1];
      var p = scoreShot(t, preds[pi].x, preds[pi].y), a = scoreShot(t, actuals[ai].x, actuals[ai].y);
      var dx = p.x - a.x, dy = p.y - a.y, e = Math.hypot(dx, dy);
      pairs.push({ i: pi + 1, actIdx: ai, pred: p, act: a, dx: dx, dy: dy, err: e, ringDiff: p.ring - a.ring, decDiff: round(p.dec - a.dec, 1) });
      se += e; bx += dx; by += dy; if (p.ring === a.ring) sameRing++; absScore += Math.abs(p.dec - a.dec);
    }
    var out = { m: m, pairs: pairs, unpairedPred: preds.length - m, unpairedAct: actuals.length - m };
    if (m) {
      out.meanErr = se / m; out.biasX = bx / m; out.biasY = by / m;
      out.biasLen = Math.hypot(out.biasX, out.biasY);
      out.biasDir = directionText(out.biasX, out.biasY, ringWidth(t) * 0.2);
      out.sameRingRate = sameRing / m;
      out.meanAbsDecDiff = absScore / m;
      var maxE = 0, maxI = 0; pairs.forEach(function (q) { if (q.err > maxE) { maxE = q.err; maxI = q.i; } });
      out.maxErr = maxE; out.maxErrShot = maxI;
    }
    return out;
  }

  /* 照片校正：最小平方仿射 photo(px,py) -> mm(x,y)。需 ≥3 個不共線點。 */
  function solve3(A, b) {
    var M = [A[0].concat([b[0]]), A[1].concat([b[1]]), A[2].concat([b[2]])];
    for (var c = 0; c < 3; c++) {
      var piv = c;
      for (var r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (var r2 = 0; r2 < 3; r2++) if (r2 !== c) {
        var f = M[r2][c] / M[c][c];
        for (var k = c; k < 4; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }
  function fitAffine(pts) { // pts: [{px,py,x,y}]
    if (pts.length < 3) return null;
    var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    pts.forEach(function (q) {
      var v = [q.px, q.py, 1];
      for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) S[i][j] += v[i] * v[j]; bx[i] += v[i] * q.x; by[i] += v[i] * q.y; }
    });
    var a = solve3(S.map(function (r) { return r.slice(); }), bx);
    var b = solve3(S.map(function (r) { return r.slice(); }), by);
    if (!a || !b) return null;
    var T = { a: a[0], b: a[1], c: a[2], d: b[0], e: b[1], f: b[2] };
    var ss = 0; pts.forEach(function (q) { var m = applyAffine(T, q.px, q.py); ss += Math.pow(m.x - q.x, 2) + Math.pow(m.y - q.y, 2); });
    T.rms = Math.sqrt(ss / pts.length);
    return T;
  }
  // T 可為仿射 {a..f}，或透視投影（多 g,h：分母 g·x + h·y + 1）
  function applyAffine(T, px, py) { var w = (T.g ? T.g * px : 0) + (T.h ? T.h * py : 0) + 1; return { x: (T.a * px + T.b * py + T.c) / w, y: (T.d * px + T.e * py + T.f) / w }; }
  function invertAffine(T) {
    var a = T.a, b = T.b, c = T.c, d = T.d, e = T.e, f = T.f, g = T.g || 0, h = T.h || 0;
    var I = a * e - b * d;
    var R = { a: (e - f * h) / I, b: -(b - c * h) / I, c: (b * f - c * e) / I, d: -(d - f * g) / I, e: (a - c * g) / I, f: -(a * f - c * d) / I };
    if (g || h) { R.g = (d * h - e * g) / I; R.h = -(a * h - b * g) / I; }
    return R;
  }
  // 原圖像素 ↔ 縮小圖像素（縮放 k）：T 吃原圖座標 → 吃縮圖座標要除以 k
  function scaleT(T, k) { var R = { a: T.a * k, b: T.b * k, c: T.c, d: T.d * k, e: T.e * k, f: T.f }; if (T.g || T.h) { R.g = (T.g || 0) * k; R.h = (T.h || 0) * k; } if (T.rms != null) R.rms = T.rms; return R; }
  // 校正點對應的靶面座標：中心、上、右、下、左（選定環的外緣）
  function calibTargets(t, ringN) {
    var R = t.ringDiam[ringN] / 2;
    return [{ x: 0, y: 0 }, { x: 0, y: R }, { x: R, y: 0 }, { x: 0, y: -R }, { x: -R, y: 0 }];
  }


  /* ================= 分析用統計（純分析，不和預報比較） ================= */
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (p, q) { return p - q; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function stdev(a) { // 樣本標準差（n−1）；少於 2 發回傳 0
    var n = a.length; if (n < 2) return 0; var m = a.reduce(function (p, q) { return p + q; }, 0) / n;
    return Math.sqrt(a.reduce(function (p, q) { return p + (q - m) * (q - m); }, 0) / (n - 1));
  }
  /* 離群發判定（穩健法）：
   *   以「座標中位數」當彈著群中心（不會被離群發拉走），r_i = 各發到中心距離。
   *   σ̂ = 1.4826 × MAD(r)（MAD＝r 與其中位數之差的中位數；常態分布下 ≈ 標準差）。
   *   r_i > max( median(r) + k·σ̂ ,  ratio × median(r) ,  minMm ) 且發數 ≥ minN 才標為離群。
   *   預設 k = 3、ratio = 2、minMm = 半個環寬（避免很密的彈著群把正常發誤判）、minN = 5。 */
  var OUTLIER_RULE = { k: 3, ratio: 2, minRingFrac: 0.5, minN: 5 };
  function findOutliers(t, shots, rule) {
    rule = rule || OUTLIER_RULE; var n = shots.length;
    var cx = median(shots.map(function (p) { return p.x; })), cy = median(shots.map(function (p) { return p.y; }));
    var r = shots.map(function (p) { return Math.hypot(p.x - cx, p.y - cy); });
    var med = median(r), mad = median(r.map(function (v) { return Math.abs(v - med); })), sig = 1.4826 * mad;
    var thr = Math.max(med + rule.k * sig, rule.ratio * med, ringWidth(t) * rule.minRingFrac);
    var idx = [];
    if (n >= rule.minN) r.forEach(function (v, i) { if (v > thr + 1e-9) idx.push(i); });
    return { center: { x: cx, y: cy }, radii: r, medianR: med, sigma: sig, threshold: n >= rule.minN ? thr : null, idx: idx };
  }
  /* 小數分分布：10.9 … 10.0 各一格，再來 9.x、8.x、7.x、6.9 以下 */
  function decimalHistogram(t, shots) {
    var bins = [];
    for (var d = 109; d >= 100; d--) bins.push({ label: (d / 10).toFixed(1), lo: d / 10, hi: d / 10, n: 0 });
    bins.push({ label: '9.x', lo: 9, hi: 9.9, n: 0 }, { label: '8.x', lo: 8, hi: 8.9, n: 0 }, { label: '7.x', lo: 7, hi: 7.9, n: 0 }, { label: '≤6.9', lo: 0, hi: 6.9, n: 0 });
    shots.forEach(function (p) {
      var dec = scoreShot(t, p.x, p.y).dec;
      for (var i = 0; i < bins.length; i++) if (dec >= bins[i].lo - 1e-9 && dec <= bins[i].hi + 1e-9) { bins[i].n++; break; }
    });
    return bins;
  }
  /* 校正建議：只說「群中心偏哪裡、幾 mm」與「彈著要往哪個方向修正」，不換算成槍的格數。
   * 各槍款每格移動量日後由 CLICK_PROFILES 提供（目前為空，見 adjustClicks）。 */
  var CLICK_PROFILES = {}; // 預留：{ id: { name, mmPerClickX, mmPerClickY, note } }，資料來源需由使用者提供，勿自行假設
  function adjustClicks(profileId, dx, dy) { var pf = CLICK_PROFILES[profileId]; if (!pf) return null; return { x: -dx / pf.mmPerClickX, y: -dy / pf.mmPerClickY, profile: pf }; }
  function adjustAdvice(t, cx, cy) {
    var th = ringWidth(t) * 0.1; // 小於 1/10 環寬視為置中（手槍 0.8mm、步槍 0.25mm）
    var dist = Math.hypot(cx, cy);
    var off = directionText(cx, cy, th), fix = directionText(-cx, -cy, th);
    var parts = [];
    if (Math.abs(cx) > th) parts.push((cx < 0 ? '右 ' : '左 ') + round(Math.abs(cx), 1).toFixed(1) + 'mm');
    if (Math.abs(cy) > th) parts.push((cy < 0 ? '上 ' : '下 ') + round(Math.abs(cy), 1).toFixed(1) + 'mm');
    var centered = off === '置中';
    return { dx: cx, dy: cy, dist: dist, offsetDir: off, fixDir: centered ? '' : fix.replace('偏', ''), parts: parts, centered: centered, threshold: th,
      text: centered ? '群中心已在靶心附近（' + round(dist, 1).toFixed(1) + 'mm），不需調整' : '群中心' + off + ' ' + round(dist, 1).toFixed(1) + 'mm → 彈著需往' + fix.replace('偏', '') + '修正（' + parts.join('、') + '）' };
  }
  /* 趨勢：最小平方斜率；整段變化量 = 斜率 ×（點數−1），|變化| < eps 視為持平 */
  function trend(vals, eps) {
    var n = vals.length; eps = eps == null ? 0.15 : eps;
    if (n < 2) return { slope: 0, change: 0, dir: '資料不足' };
    var mx = (n - 1) / 2, my = vals.reduce(function (p, q) { return p + q; }, 0) / n, sxy = 0, sxx = 0;
    vals.forEach(function (v, i) { sxy += (i - mx) * (v - my); sxx += (i - mx) * (i - mx); });
    var sl = sxy / sxx, ch = sl * (n - 1);
    return { slope: sl, change: ch, dir: Math.abs(ch) < eps ? '持平' : (ch > 0 ? '上升' : '下降') };
  }
  /* 一組彈著的完整分析：computeStats ＋ 穩定度、離群、分布、校正建議、每10發平均 */
  function analyzeShots(t, shots) {
    var st = computeStats(t, shots), n = st.n;
    var decs = st.shots.map(function (q) { return q.dec; }), rings = st.shots.map(function (q) { return q.ring; });
    st.sdDec = stdev(decs); st.sdRing = stdev(rings);
    if (n >= 2) {
      var wi = 0; decs.forEach(function (v, i) { if (v < decs[wi]) wi = i; });
      st.worstIdx = wi;
      st.avgDecExWorst = (Math.round(st.totalDec * 10) - Math.round(decs[wi] * 10)) / 10 / (n - 1);
      st.avgExWorst = (st.total - rings[wi]) / (n - 1);
    } else { st.worstIdx = -1; st.avgDecExWorst = st.avgDec; st.avgExWorst = st.avg; }
    st.outliers = findOutliers(t, shots);
    st.hist = decimalHistogram(t, shots);
    // 校正建議用「排除離群發」後的群中心（偶發的大偏差不該影響瞄具調整）
    var keep = shots.filter(function (p, i) { return st.outliers.idx.indexOf(i) < 0; });
    if (n) { var ax = 0, ay = 0; keep.forEach(function (p) { ax += p.x; ay += p.y; }); st.advice = adjustAdvice(t, ax / keep.length, ay / keep.length); st.advice.excluded = n - keep.length; } else st.advice = null;
    st.per10 = st.series.map(function (s) { return { from: s.from, to: s.to, avgDec: s.totalDec / (s.to - s.from + 1), avg: s.total / (s.to - s.from + 1) }; });
    st.trend10 = trend(st.per10.map(function (s) { return s.avgDec; }));
    return st;
  }

  var api = {
    TARGETS: TARGETS, ringWidth: ringWidth, scoreShot: scoreShot, computeStats: computeStats,
    comparePredictions: comparePredictions, matchOptimal: matchOptimal, hungarian: hungarian, directionText: directionText,
    fitAffine: fitAffine, applyAffine: applyAffine, invertAffine: invertAffine, scaleT: scaleT, calibTargets: calibTargets, round: round,
    median: median, stdev: stdev, findOutliers: findOutliers, OUTLIER_RULE: OUTLIER_RULE, decimalHistogram: decimalHistogram, adjustAdvice: adjustAdvice, adjustClicks: adjustClicks, CLICK_PROFILES: CLICK_PROFILES, trend: trend, analyzeShots: analyzeShots
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BMCore = api;
})(typeof window !== 'undefined' ? window : this);
