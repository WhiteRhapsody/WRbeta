/* WRbeta v2.9.6 小白單實驗引擎 — M6 物理代數核對與可切換燈號政策模組（UMD：Node module.exports / Browser window.WRSiusXCheck）。
 * 責任：對 merge() 產出之 model 進行靶紙幾何、時間序列、小計／總分代數與 8 方向箭頭核對，並依可切換 Policy 決定 ok / near / bad 燈號。
 * 介面：check(model, policyOverride?)、problems(model, ck)、getPolicy()、setPolicy(patch)、resetPolicy()、arrowContra(dir, x, y, axisDeg?)。 */
(function (root) {
  'use strict';

  var _P = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./sius-x-parse.js') : null;
  function parser() { return _P || root.WRSiusXParse || (typeof WRSiusXParse !== 'undefined' ? WRSiusXParse : null); }
  function core() { return root.BMCore || (typeof BMCore !== 'undefined' ? BMCore : null) || (typeof require === 'function' ? require('./core.js') : null); }
  function tgt(id) { var C = core(); return C.TARGETS[id] || C.TARGETS.ar10; }
  function tenths(v) { return Math.round(v * 10); }

  // SIUS 小白單僅有 8 種方向箭頭（無正中心第 9 種符號）
  var DIR8 = {
    '→': [1, 0], '↗': [1, 1], '↑': [0, 1], '↖': [-1, 1],
    '←': [-1, 0], '↙': [-1, -1], '↓': [0, -1], '↘': [1, -1]
  };

  var DEFAULT_POLICY = {
    tLastHint: true,             // 僅「時間最後一位」沒把握／衝突時維持綠燈，於 row 標 tHint: true
    neighborFix: true,           // 時間鄰居核對跳過 bad 與時間衝突列，避免單一壞列牽連相鄰好列變黃
    maxGapSec: 600,              // 同段相鄰每發最大合理間隔秒數（上限 1799s）
    arrowCheck: true,            // 8 方向箭頭與方向字形（含第一象限對角 ↗ 字形一致性）對 (X, Y) 否決
    arrowAxisDeg: 11,            // 直向箭頭（→↑←↓）離軸角度門檻（度）
    subInnerRadiusGuard: false,  // v3.0.2 關（White 2026-11-27：內十數跟小計對不上不逐發報錯，只在小計旁輕提示）；原： 小計內十數不符時，依多算／少算方向精準標黃可疑 10 環（不連坐無關 10 環）
    subInnerMarginMm: 0.6,       // 內十臨界半徑容差帶（mm）
    subAlgebraInfer: true,       // 全單僅缺 1 個小計且 TOTAL 與其餘小計皆對上時，代數反推該組小計輔助核對
    singlePhotoLastDigit: true,  // 單一照片（無跨照重疊佐證）同一座標出現整數與十分位相同、僅百分位末碼不同之多讀值時降黃（擋 -4.08/-4.09 等）
    colSoloCoordNear: true,      // ≥3 次分段 strips 已讀出同列另一座標但漏讀此座標、僅單一 col 讀出時降黃（擋 3-22 M60）
    zeroHundredthTrunc: true,    // 座標百分位為 0（如 4.00）且同發另一讀法恰在十分位後截斷（如 4.0）時降黃（擋 3-23 Q5）
    severeNearToBad: false       // 預設關閉：不將黃燈額外升紅，守住紅燈 ≤ 90（黃燈交由畫面提示人工看一眼）
  };

  var _policy = Object.assign({}, DEFAULT_POLICY);

  function getPolicy() {
    return Object.assign({}, _policy);
  }

  function setPolicy(patch) {
    if (patch && typeof patch === 'object') {
      Object.keys(patch).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_POLICY, k)) _policy[k] = patch[k];
      });
    }
    return getPolicy();
  }

  function resetPolicy() {
    _policy = Object.assign({}, DEFAULT_POLICY);
    return getPolicy();
  }

  /* ---------- 8 方向箭頭與 (X, Y) 矛盾判定 ---------- */
  function arrowContra(dir, x, y, axisDeg) {
    var d = DIR8[dir];
    if (!d || x == null || y == null || !isFinite(x) || !isFinite(y)) return false;
    var deg = axisDeg != null ? axisDeg : 11;
    var e = 0.25;
    if (d[0] && d[1]) {
      // 斜向箭頭：X 或 Y 落入反象限（超過容差 e）即矛盾
      if (d[0] * x < -e || d[1] * y < -e) return true;
      var lo = Math.tan(Math.max(0, deg - 4) * Math.PI / 180);
      var mx = Math.max(Math.abs(x), Math.abs(y)), mn = Math.min(Math.abs(x), Math.abs(y));
      if (mx > 1.0 && mn / mx < lo) return true;
      return false;
    }
    // 直向箭頭：主軸方向相反，或偏離軸線遠超門檻（給 22° 寬鬆上限防座標微差誤殺）
    var hi = Math.tan(Math.max(deg + 11, 22) * Math.PI / 180);
    if (d[0]) return d[0] * x <= 0 || Math.abs(y) > hi * Math.abs(x) + e;
    return d[1] * y <= 0 || Math.abs(x) > hi * Math.abs(y) + e;
  }

  function checkShotArrow(q, axisDeg) {
    if (!q || q.x == null || q.y == null) return false;
    if (q.arrow && DIR8[q.arrow]) return arrowContra(q.arrow, q.x, q.y, axisDeg);
    var Rd = q.ocr && q.ocr.rd;
    if (!Rd || !Rd.length) return false;
    for (var i = 0; i < Rd.length; i++) {
      var a = Rd[i].arrow && Rd[i].arrow.dir ? Rd[i].arrow.dir : Rd[i].arrowRaw;
      if (a && DIR8[a] && arrowContra(a, q.x, q.y, axisDeg)) return true;
    }
    var toks = Rd.map(function (r) { return r.arrowRaw; }).filter(Boolean);
    if (!toks.length) return false;
    // 1) 實測 100% 向下字形（w/ww/we/e¢）：Y 必為負
    var downCnt = toks.filter(function (t) { return /^(?:w|ww|we|e¢|sw|ow)$/.test(t); }).length;
    if (downCnt >= 1 && downCnt * 2 >= toks.length && q.y > 0.25) return true;
    // 2) 實測右上 ↗ 字形（#/#&/&#）：X, Y 皆不可明顯為負
    var neCnt = toks.filter(function (t) { return /^(?:#|#&|&#)$/.test(t); }).length;
    if (neCnt >= 2 && neCnt * 2 >= toks.length && (q.x < -0.25 || q.y < -0.25)) return true;
    // 3) 第一象限明確對角區（X>1.5, Y>1.5, 14°<θ<76° 紙本必印 ↗）：若 ≥75% 讀法皆讀成左／下系箭頭雜字（« » ~ w ¢ e），代表 Y 漏負號（如 N11 Q13 印 ↘ 卻讀 +4.98）
    if (q.x > 1.5 && q.y > 1.5 && toks.length >= 3) {
      var ang = Math.atan2(q.y, q.x) * 180 / Math.PI;
      if (ang > 14 && ang < 76) {
        var nonNeCnt = toks.filter(function (t) { return /^[«»~w¢e]+$/.test(t); }).length;
        if (nonNeCnt >= Math.ceil(toks.length * 0.75)) return true;
      }
    }
    return false;
  }

  function innerTenRadius(T) {
    if (!T || !T.innerTen) return 4.75;
    var r = T.pellet / 2;
    return T.innerTen.mode === 'dotShotOut' ? (r - T.innerTen.diam / 2) : (T.innerTen.diam / 2 + r);
  }

  /* ---------- 主核對與燈號決策 ---------- */
  function check(model, policyOverride) {
    var pol = policyOverride ? Object.assign({}, _policy, policyOverride) : _policy;
    var P = parser(), secOf = P.secOf, gapSec = P.gapSec;
    var C = core(), T = tgt(model.targetId), rows = [], series = [], mIdx = 0;
    var maxGap = pol.maxGapSec || 600;
    var secs = model.shots.map(function (q) { return secOf(q.t); });

    // 1) 全域最長遞增時間鏈（抓整段錯排）
    var offChain = {};
    [true, false].forEach(function (sg) {
      var L = [];
      model.shots.forEach(function (q, i) { if (!!q.sighter === sg && secs[i] != null) L.push(i); });
      if (L.length < 3) return;
      var n = L.length, f = new Array(n), b = new Array(n), a, c;
      var ok = function (x, y) {
        var g = gapSec(secs[L[x]], secs[L[y]]);
        return g != null && g <= Math.min(maxGap * (y - x), 1799);
      };
      for (a = 0; a < n; a++) { f[a] = 1; for (c = 0; c < a; c++) if (ok(c, a) && f[c] + 1 > f[a]) f[a] = f[c] + 1; }
      for (a = n - 1; a >= 0; a--) { b[a] = 1; for (c = a + 1; c < n; c++) if (ok(a, c) && b[c] + 1 > b[a]) b[a] = b[c] + 1; }
      var best = 0;
      for (a = 0; a < n; a++) best = Math.max(best, f[a] + b[a] - 1);
      for (a = 0; a < n; a++) if (f[a] + b[a] - 1 < best) offChain[L[a]] = true;
    });

    // 2) 基礎列核對（幾何環數、內十、前後時間、OCR 衝突）
    model.shots.forEach(function (q, i) {
      var okXY = q.x != null && q.y != null && isFinite(q.x) && isFinite(q.y);
      var sc = okXY ? C.scoreShot(T, q.x, q.y) : null;
      var miss = [];
      if (q.dec == null || !isFinite(q.dec)) miss.push('dec');
      if (!okXY) miss.push('xy');
      if (secs[i] == null) miss.push('t');

      var cmp = sc ? (q.decInt ? sc.ring : sc.dec) : null;
      var dd = sc && q.dec != null ? Math.abs(tenths(cmp) - tenths(q.dec)) : null;
      var st = miss.indexOf('dec') >= 0 || miss.indexOf('xy') >= 0 ? 'bad' : dd >= 2 ? 'bad' : dd === 1 ? 'near' : 'ok';
      // v3.0.2（White 2026-11-27）：座標確定（沒有 X／Y 衝突、只有一種讀法）但分數跟單子不符 → 橘燈（near＋orange），兩個分數都列出，不擋保存
      var orange = false;
      if (st === 'bad' && dd >= 2 && okXY && q.dec != null) {
        var oc0 = q.ocr, cf0 = oc0 && oc0.conflict || [], al0 = oc0 && oc0.alt;
        var sure = cf0.indexOf('x') < 0 && cf0.indexOf('y') < 0 && !(al0 && ((al0.x && al0.x.length > 1) || (al0.y && al0.y.length > 1)));
        if (sure) { st = 'near'; orange = true; }
      }
      var innerOk = !sc || q.dec == null || sc.inner === !!q.inner;
      if (st === 'ok' && !innerOk) st = 'near';

      var tw = false, prev = -1;
      for (var j = i - 1; j >= 0; j--) if (!!model.shots[j].sighter === !!q.sighter && secs[j] != null) { prev = j; break; }
      if (secs[i] != null && prev >= 0 && gapSec(secs[prev], secs[i]) == null) tw = true;

      var nxt = -1;
      for (j = i + 1; j < model.shots.length; j++) if (!!model.shots[j].sighter === !!q.sighter && secs[j] != null) { nxt = j; break; }
      if (secs[i] != null && prev >= 0 && gapSec(secs[prev], secs[i]) > maxGap) tw = true;
      if (secs[i] != null && prev >= 0 && nxt >= 0) {
        var gpn = gapSec(secs[prev], secs[nxt]), g1 = gapSec(secs[prev], secs[i]), g2 = gapSec(secs[i], secs[nxt]);
        if (gpn != null && gpn <= maxGap && (g1 == null || g2 == null || g1 + g2 > gpn + 1)) tw = true;
      }
      if (secs[i] != null && nxt >= 0) {
        var gn = gapSec(secs[i], secs[nxt]);
        if (gn == null || gn > maxGap) tw = true;
      }
      if (offChain[i]) tw = true;

      var cfl = q.ocr && q.ocr.conflict ? q.ocr.conflict.slice() : [];
      var tHint = !!(q.ocr && q.ocr.tHint);

      // Policy: tLastHint — 只有「時間最後一位」衝突／沒把握時維持綠燈，標 tHint: true
      if (pol.tLastHint && cfl.indexOf('t') >= 0 && q.ocr && q.ocr.rd && q.t) {
        var tPrefix = q.t.slice(0, 7);
        var readTs = q.ocr.rd.map(function (x) { return x.t; }).filter(Boolean);
        if (readTs.length && readTs.every(function (tv) { return tv.slice(0, 7) === tPrefix; })) {
          cfl = cfl.filter(function (c) { return c !== 't'; });
          tHint = true;
        }
      }

      if (st === 'ok' && miss.length) st = 'near'; // v3.0.2：時間跟前一發接不上不報錯（照讀到的寫），tWarn 只留資料
      if (st === 'ok' && cfl.length) st = 'near';

      var rowObj = {
        i: i,
        sighter: !!q.sighter,
        no: q.sighter ? null : ++mIdx,
        n: q.n,
        calc: sc ? { dec: sc.dec, ring: sc.ring, inner: sc.inner, d: sc.d } : null,
        diff: dd == null ? null : dd / 10,
        innerOk: innerOk,
        miss: miss,
        tWarn: tw,
        conflict: cfl,
        missing: !!(q.ocr && q.ocr.missing),
        status: st
      };
      if (orange) rowObj.orange = true;
      if (tHint) rowObj.tHint = true;
      rows.push(rowObj);
    });

    // 3) Policy: neighborFix — 僅因 tWarn 變黃的列，改只與前後非 bad 且無時間衝突之健康列重驗時間鏈
    if (pol.neighborFix) {
      rows.forEach(function (r, ix) {
        if (r.status !== 'near' || !r.tWarn || r.miss.length || r.conflict.length || !r.innerOk || r.diff !== 0) return;
        var q = model.shots[r.i], s = secs[r.i];
        if (s == null) return;
        var healthy = function (j) {
          return !!model.shots[j].sighter === !!q.sighter &&
            secs[j] != null &&
            rows[j].status !== 'bad' &&
            rows[j].conflict.indexOf('t') < 0;
        };
        var p = -1, nx = -1, j;
        for (j = ix - 1; j >= 0; j--) if (healthy(j)) { p = j; break; }
        for (j = ix + 1; j < rows.length; j++) if (healthy(j)) { nx = j; break; }
        var tw2 = false;
        if (p >= 0) { var g1 = gapSec(secs[p], s); if (g1 == null || g1 > Math.min(maxGap * (ix - p), 1799)) tw2 = true; }
        if (nx >= 0) { var g2 = gapSec(s, secs[nx]); if (g2 == null || g2 > Math.min(maxGap * (nx - ix), 1799)) tw2 = true; }
        if (!tw2) {
          r.tWarn = false;
          r.status = 'ok';
        }
      });
    }

    // 4) Policy: singlePhotoLastDigit — 單一照片同一座標存在「同號、同整數、同十分位、僅百分位末碼不同」之候選值時降黃（擋 3-21 Q5、3-22 M45/M55、N11 M14）
    if (pol.singlePhotoLastDigit) {
      rows.forEach(function (r) {
        if (r.status !== 'ok') return;
        var q = model.shots[r.i], oc = q.ocr;
        if (!oc || oc.photoCount >= 2 || !oc.alt) return;
        var sameTenths = function (a, b) {
          return a != null && b != null && a !== b && (a * b >= 0) && Math.trunc(a * 10) === Math.trunc(b * 10);
        };
        if (oc.alt.x && oc.alt.x.some(function (v) { return sameTenths(v, q.x); })) {
          if (r.conflict.indexOf('x') < 0) r.conflict.push('x');
          r.status = 'near';
        }
        if (oc.alt.y && oc.alt.y.some(function (v) { return sameTenths(v, q.y); })) {
          if (r.conflict.indexOf('y') < 0) r.conflict.push('y');
          r.status = 'near';
        }
      });
    }

    // 5) Policy: colSoloCoordNear — ≥3 次分段 strips 已讀到同列另一座標但漏讀此座標、僅靠單一 col 讀出時降黃（擋 3-22 M60，減少誤傷）
    if (pol.colSoloCoordNear) {
      rows.forEach(function (r) {
        if (r.status !== 'ok') return;
        var q = model.shots[r.i], Rd = q.ocr && q.ocr.rd;
        if (!Rd || Rd.length < 4) return;
        var nonColX = Rd.filter(function (x) { return x.x === q.x && x.kind !== 'col'; }).length;
        var nonColY = Rd.filter(function (x) { return x.y === q.y && x.kind !== 'col'; }).length;
        var stripHasY = Rd.filter(function (x) { return x.kind !== 'col' && x.y != null; }).length;
        var stripHasX = Rd.filter(function (x) { return x.kind !== 'col' && x.x != null; }).length;
        if (nonColX === 0 && stripHasY >= 3) { if (r.conflict.indexOf('x') < 0) r.conflict.push('x'); r.status = 'near'; }
        if (nonColY === 0 && stripHasX >= 3) { if (r.conflict.indexOf('y') < 0) r.conflict.push('y'); r.status = 'near'; }
      });
    }

    // 6) Policy: zeroHundredthTrunc — 獲選座標百分位為 0（如 4.00）且另一讀法恰在十分位截斷（如 "/ 4.0"）時降黃（擋 3-23 Q5）
    if (pol.zeroHundredthTrunc) {
      rows.forEach(function (r) {
        if (r.status !== 'ok') return;
        var q = model.shots[r.i], Rd = q.ocr && q.ocr.rd;
        if (!Rd || !Rd.length) return;
        if (q.x != null && Math.round(Math.abs(q.x) * 100) % 10 === 0 && Rd.some(function (x) { return x.hints && x.hints.xTrunc && /\d[.,]\d\s*$/.test(x.hints.xTrunc); })) {
          if (r.conflict.indexOf('x') < 0) r.conflict.push('x');
          r.status = 'near';
        }
        if (q.y != null && Math.round(Math.abs(q.y) * 100) % 10 === 0 && Rd.some(function (x) { return x.hints && x.hints.yTrunc && /\d[.,]\d\s*$/.test(x.hints.yTrunc); })) {
          if (r.conflict.indexOf('y') < 0) r.conflict.push('y');
          r.status = 'near';
        }
      });
    }

    // 7) Policy: arrowCheck — 8 方向箭頭與字形象限否決
    if (pol.arrowCheck) {
      rows.forEach(function (r) {
        if (r.status !== 'ok') return;
        if (checkShotArrow(model.shots[r.i], pol.arrowAxisDeg)) {
          r.arrowWarn = true;
          r.status = 'near';
        }
      });
    }

    // 6) 每 10 發小計與總分核對
    var match = rows.filter(function (r) { return !r.sighter; });
    var subsArr = model.subs || [];
    for (var k = 0; k * 10 < match.length || k < subsArr.length; k++) {
      var part = match.slice(k * 10, k * 10 + 10), pr = subsArr[k] || null;
      var pSum = 0, pIn = 0, cSum = 0, cIn = 0, cOk = true;
      part.forEach(function (r) {
        var q = model.shots[r.i];
        pSum += tenths(q.dec || 0);
        pIn += q.inner ? 1 : 0;
        if (r.calc) {
          cSum += tenths(q.decInt ? r.calc.ring : r.calc.dec);
          cIn += r.calc.inner ? 1 : 0;
        } else cOk = false;
      });
      var ok = !!pr && part.length === 10 && tenths(pr.dec) === pSum; // v3.0.2：內十數、X/Y 重算對不上不算小計錯（逐發已有燈；小計旁輕提示）
      series.push({
        k: k,
        from: k * 10 + 1,
        to: k * 10 + part.length,
        n: part.length,
        rows: part.map(function (r) { return r.i; }),
        printed: pr,
        sumPrinted: { dec: pSum / 10, inner: pIn },
        calc: { dec: cSum / 10, inner: cIn },
        status: !pr ? (part.length ? 'nosub' : 'bad') : ok ? 'ok' : 'bad',
        innerWarn: !!pr && pr.inner !== pIn,
        calcWarn: !cOk || cSum !== pSum
      });
    }

    var pT = 0, pTi = 0, cT = 0, cTi = 0;
    match.forEach(function (r) {
      var q = model.shots[r.i];
      pT += tenths(q.dec || 0);
      pTi += q.inner ? 1 : 0;
      if (r.calc) {
        cT += tenths(q.decInt ? r.calc.ring : r.calc.dec);
        cTi += r.calc.inner ? 1 : 0;
      }
    });
    var tot = { printed: model.total, sumPrinted: { dec: pT / 10, inner: pTi }, calc: { dec: cT / 10, inner: cTi } };
    tot.status = !model.total ? 'nototal' : tenths(model.total.dec) === pT ? 'ok' : 'bad'; // v3.0.2：同小計
    tot.innerWarn = !!model.total && model.total.inner !== pTi; tot.calcWarn = cT !== pT;

    // 7) Policy: subAlgebraInfer — 全單僅缺 1 個小計且 TOTAL 與其餘小計齊全時，代數反推該組應有分數與內十數
    var nosubs = series.filter(function (s) { return s.status === 'nosub'; });
    if (pol.subAlgebraInfer && nosubs.length === 1 && model.total && series.length >= 2) {
      var missS = nosubs[0];
      var others = series.filter(function (s) { return s !== missS; });
      if (others.every(function (s) { return !!s.printed; })) {
        var oDec10 = others.reduce(function (a, s) { return a + tenths(s.printed.dec); }, 0);
        var oIn = others.reduce(function (a, s) { return a + s.printed.inner; }, 0);
        var infDec10 = tenths(model.total.dec) - oDec10;
        var infIn = model.total.inner - oIn;
        if (infDec10 >= 0 && infIn >= 0 && infIn <= 10) {
          missS.inferred = { dec: infDec10 / 10, inner: infIn };
        }
      }
    }

    // 8) Policy: subInnerRadiusGuard — 小計（含反推小計）內十數不合時，僅檢查方向吻合（多內十隻查 inner=true、少內十隻查 inner=false）之可疑 10 環
    if (pol.subInnerRadiusGuard) {
      var rIn = innerTenRadius(T), margin = pol.subInnerMarginMm != null ? pol.subInnerMarginMm : 0.6;
      series.forEach(function (s) {
        var refSub = s.printed || s.inferred;
        if (!refSub || s.n !== 10) return;
        var diffIn = s.sumPrinted.inner - refSub.inner;
        if (diffIn !== 0) {
          var wantInner = diffIn > 0;
          s.rows.forEach(function (ri) {
            var r = rows[ri], q = model.shots[ri];
            if (r.status !== 'ok' || q.dec < 10 || !!q.inner !== wantInner || q.x == null || q.y == null) return;
            var d = Math.hypot(q.x, q.y);
            var has17 = q.ocr && q.ocr.rd && q.ocr.rd.some(function (x) { return x.hints && (x.hints.xLead17 || x.hints.yLead17); });
            if (has17 || Math.abs(d - rIn) <= margin) {
              if (r.conflict.indexOf('y') < 0) r.conflict.push('y');
              r.status = 'near';
            }
          });
        }
      });
    }

    // 9) Policy: severeNearToBad — 高風險錯位／殘缺列由黃燈升為紅燈（避免不擋流程時把大偏差直接存檔）
    if (pol.severeNearToBad) {
      rows.forEach(function (r) {
        if (r.status !== 'near') return;
        var q = model.shots[r.i], Rd = (q.ocr && q.ocr.rd) || [];
        if (!q.ocr) return; // 手動輸入／parseText 不受影響
        var nR = Rd.length;
        var soloGuess = nR === 1 && Rd.every(function (x) { return (x.rawW != null ? x.rawW : x.w) < 1; });
        var soloCol = nR === 1 && Rd[0].kind === 'col';
        var twCflT = r.tWarn && r.conflict.indexOf('t') >= 0;
        var twMultiCfl = r.tWarn && r.conflict.length >= 2 && nR <= 3;
        var decCoordCfl = r.conflict.indexOf('dec') >= 0 && (r.conflict.indexOf('x') >= 0 || r.conflict.indexOf('y') >= 0) && (nR <= 3 || r.conflict.indexOf('t') >= 0);
        if (r.miss.indexOf('t') >= 0 || soloGuess || soloCol || twCflT || twMultiCfl || decCoordCfl) {
          r.status = 'bad';
        }
      });
    }

    var bad = rows.filter(function (r) { return r.status === 'bad'; }).length +
      series.filter(function (s) { return s.status === 'bad'; }).length +
      (tot.status === 'bad' ? 1 : 0);
    var near = rows.filter(function (r) { return r.status === 'near'; }).length;
    // v3.0.3：整張一個小計都沒讀到（例如練習單、只印試射）→ 不報「第 N 個小計沒拍到」
    var anySub = (model.subs || []).some(function (x) { return !!x; });
    var subMissing = anySub ? series.filter(function (x) { return x.status === 'nosub'; }).map(function (x) { return x.k + 1; }) : [];

    return {
      subMissing: subMissing,
      rows: rows,
      series: series,
      total: tot,
      nSighter: rows.length - match.length,
      nMatch: match.length,
      bad: bad,
      near: near
    };
  }

  function problems(model, ck) {
    ck = ck || check(model);
    var out = [];
    ck.rows.forEach(function (r) { if (r.status === 'bad') out.push({ type: 'row', i: r.i, lv: 'bad' }); });
    ck.series.forEach(function (s) { if (s.status === 'bad') out.push({ type: 'sub', k: s.k, lv: 'bad' }); });
    if (ck.total.status === 'bad') out.push({ type: 'total', lv: 'bad' });
    ck.rows.forEach(function (r) { if (r.status === 'near') out.push({ type: 'row', i: r.i, lv: 'near' }); });
    return out;
  }

  var api = {
    DEFAULT_POLICY: DEFAULT_POLICY,
    DIR8: DIR8,
    getPolicy: getPolicy,
    setPolicy: setPolicy,
    resetPolicy: resetPolicy,
    arrowContra: arrowContra,
    checkShotArrow: checkShotArrow,
    check: check,
    problems: problems
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WRSiusXCheck = api;
})(typeof window !== 'undefined' ? window : this);
