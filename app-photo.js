/* WRbeta 照片判讀共用流程（Pro 分析／對照／Lite 都用這裡）
 * 2026-11-19 模組分割（純搬移）：原本在 app.js 同一個函式裡；其他模組的共用名稱掛在 window.WRApp（App.名稱），載入順序見 index.html。
 */
(function (App) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var C = App.C, T = App.T, toast = App.toast;
  // 給其他模組用（函式）
  App.visRun = visRun; App.pickIsImage = pickIsImage; App.pickError = pickError; App.projCircle = projCircle; App.projLine = projLine;
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
    if (mx - mn < 4) throw new Error(wrT('app.couldnt_read_the_photo_it'));
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
    if (App.pickIsHeic(f)) alert(wrT('app.this_photo_is_in_heic'));
    else if (!pickIsImage(f)) toast(wrT('app.is_not_a_photo', [f.name || wrT('app.this_file')]));
    else toast(wrT('app.couldnt_read_this_photo', [f.name || '']));
  }

  // 照片上的疊圖：校正可能是透視投影（直接用 SVG matrix 畫不出來），所以把 mm 座標的圓／線逐點換到照片像素再畫
  function projCircle(Ti, r, cx, cy, n) {
    cx = cx || 0; cy = cy || 0; n = n || 120; var d = '';
    for (var i = 0; i <= n; i++) { var an = 2 * Math.PI * i / n, p = C.applyAffine(Ti, cx + r * Math.cos(an), cy + r * Math.sin(an)); d += (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }
    return d + 'Z';
  }
  function projLine(Ti, x1, y1, x2, y2) { var p = C.applyAffine(Ti, x1, y1), q = C.applyAffine(Ti, x2, y2); return 'M' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + 'L' + q.x.toFixed(1) + ' ' + q.y.toFixed(1); }
})(window.WRApp = window.WRApp || {});
