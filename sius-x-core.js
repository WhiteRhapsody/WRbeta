/* WRbeta v2.9.6 小白單「實驗引擎」核心（window.WRSiusXCore；Node 也能 require）。
 * 從線上版 sius.js（v2.9.4／v2.9.5）＋原型 (e) 的接縫提示複製出來，另外加：每個欄位的票數 ocr.w、每次讀到的原文 ocr.rd、
 * 以及 check() 之後的「不給綠」規則（rules，反重 Carbon 撰寫）。線上版 window.WRSius 完全不動。 */
/* WRbeta v2.9.4 小白單（SIUS 列印成績單）匯入核心：PROGRESS.md §7 備註8。
 * 這個檔案只有「資料」與「計算」，沒有畫面（畫面在 app-sius.js、照片前處理在 sius-img.js、OCR 在 sius-ocr.js）；Node 也能直接 require 來測。
 *
 * 小白單格式（White 2026-11-24 提供的 5 張照片）：
 *   表頭：Target 17/1／日期 時間／項目（Air Rifle 60、Air Pistol 60）／編號 姓名
 *   Qualification＝試射（每行尾端印 P）；Match＝正式發
 *   每行：發序 方向箭頭 分數（* 內十）［P］ mm:ss.ss X/ Y（mm，離靶心，右、上為正）；每 10 發「Subtota 101.7-6*」；最後 Total、TOTAL。
 *   時間只印分:秒，跨整點會從 59 跳回 00（rhythm 會處理）。
 *
 * 資料模型（model）：
 *   { v:2, targetId:'ar10'|'ap10', gun:{ id, auto, votes, unverified }, event:'Air Rifle 60', count:60, date:'12.11.2026 08:47', name:'',
 *     shots:[{ n, sighter, dec, inner, t, x, y, ocr? }],   // 試射在前、比賽發在後；dec＝印的分數（OCR 讀到的，不是算的）；t＝'mm:ss.ss'
 *     subs:[{ dec, inner }],                               // 印的每 10 發小計，依序對比賽 1–10、11–20…
 *     total:{ dec, inner } | null }
 *   shot.ocr（只有 OCR 來的才有）：{ reads:讀到幾次, conflict:['x','y','dec','t'] 多次讀到不同值, missing:這發整行沒讀到（欄位空白，等人補）, alt:{ x:[…], y:[…] } }
 *
 * 不杜撰數字（White 指定）：OCR 讀不到就留空並標紅；多次讀到不同值只會從「實際讀到的值」裡挑，挑法是看哪個組合能讓
 *   「印的分數＝依 X/Y 用 core.js（ISSF）重算的分數」，挑不出來就標紅讓人改。小計／總分一律拿「印的」去核對，不拿算的去填。 */
(function (root) {
  'use strict';
  var _P = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./sius-x-parse.js') : null;
  var _A = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./sius-x-align.js') : null;
  var _K = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./sius-x-check.js') : null;
  function parser() { return _P || root.WRSiusXParse || (typeof WRSiusXParse !== 'undefined' ? WRSiusXParse : null); }
  function aligner() { return _A || root.WRSiusXAlign || (typeof WRSiusXAlign !== 'undefined' ? WRSiusXAlign : null); }
  function checker() { return _K || root.WRSiusXCheck || (typeof WRSiusXCheck !== 'undefined' ? WRSiusXCheck : null); }
  function core() { return root.BMCore || (typeof BMCore !== 'undefined' ? BMCore : null) || (typeof require === 'function' ? require('./core.js') : null); }
  function tgt(id) { var C = core(); return C.TARGETS[id] || C.TARGETS.ar10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function tenths(v) { return Math.round(v * 10); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function norm(s) { return parser().norm(s); }

  /* ---------- 時間與單行解析（委派 M4 sius-x-parse.js） ---------- */
  function secOf(t) { return parser().secOf(t); }
  function fmtSec(s) { return parser().fmtSec(s); }
  function gapSec(a, b) { return parser().gapSec(a, b); }
  function parseShot(raw, meta, opt) { return parser().parseShot(raw, meta, opt); }
  function parseOther(raw) { return parser().parseOther(raw); }
  function parseLine(raw) { return parser().parseLine(raw); }

  /* ---------- 一次 OCR（一張照片的一種讀法）→ 依序的條目（委派 M5 sius-x-align.js） ---------- */
  function parsePass(lines, passMeta) {
    var P = parser(), A = aligner();
    var rows = (lines || []).map(function (ln, li) {
      var meta = passMeta ? {
        img: passMeta.img,
        kind: passMeta.kind,
        symbols: passMeta.lineSymbols && passMeta.lineSymbols[li],
        charConf: passMeta.lineCharConf && passMeta.lineCharConf[li],
        arrow: passMeta.lineArrows && passMeta.lineArrows[li],
        minusHint: passMeta.lineMinus && passMeta.lineMinus[li],
        edgeClipped: passMeta.edgeLines && passMeta.edgeLines[li]
      } : null;
      return P.parseRow(ln, meta);
    });
    return A.alignSinglePass(rows, passMeta);
  }

  /* ---------- 多張照片、多種讀法 → 一份資料（委派 M5 對齊槽位＋獨立/相關證據加權合併） ---------- */
  var GARBLED_DEC_RE = /(?:[-~=<]\s*[A-Za-z]|[-~=<]?\d{1,2}[.,][0-9]*[A-Za-z¢{])/;

  function merge(passes, opt) {
    opt = opt || {};
    var A = aligner(), aligned = A.alignPasses(passes || [], opt);
    var tid = aligned.targetId, T = tgt(tid), C = core();
    var isText = (passes || []).length === 1 && passes[0] && passes[0].kind === 'text';

    var model = {
      v: 2,
      targetId: tid,
      gun: aligned.gun,
      event: aligned.event,
      count: aligned.count,
      date: aligned.date,
      name: '',
      practice: !!aligned.practice,
      countHint: aligned.countHint || null,
      shots: [],
      subs: [],
      total: null,
      ocr: true,
      alignInfo: { photoOrder: aligned.photoOrder, seamInfo: aligned.seamInfo, missingSubtotals: aligned.missingSubtotals, blocks: aligned.blocks && aligned.blocks.n }
    };
    if (aligned.athlete) model.athlete = aligned.athlete; // v3.0.3 表頭姓名列（有印才有）
    if (aligned.lane) model.lane = aligned.lane;

    function pickShot(slot) {
      var R = slot.reads;
      if (tid === 'ap10') {
        R = R.map(function (r) {
          if (r.p.iv == null) return r;
          var p2 = Object.assign({}, r.p, { dec: r.p.iv, decInt: true, star: r.p.istar });
          return { p: p2, w: r.w, ew: r.ew, guess: r.guess, pi: r.pi, img: r.img, kind: r.kind };
        });
      }
      var Rd = tid === 'ap10' ? [] : R.filter(function (r) { return r.p.dec != null && !r.p.decInt; });
      var intMode = !Rd.length && R.some(function (r) { return r.p.decInt; });
      var Rs = intMode ? R : Rd.length ? Rd : R;

      var xs = A.voteWeighted(R.map(function (r) { return { v: r.p.x, w: r.ew, rawW: r.w, img: r.img, kind: r.kind }; }));
      var ys = A.voteWeighted(R.map(function (r) { return { v: r.p.y, w: r.ew, rawW: r.w, img: r.img, kind: r.kind }; }));
      var ds = A.voteWeighted(Rs.map(function (r) { return { v: r.p.dec, w: r.ew, rawW: r.w, img: r.img, kind: r.kind }; }));
      var ts = A.voteWeighted(R.map(function (r) { return { v: r.p.t, w: r.ew, rawW: r.w, img: r.img, kind: r.kind }; }));

      var tot = R.reduce(function (a, r) { return a + r.ew; }, 0);
      var best = null, NONE = [{ v: null, w: 0, rawW: 0, n: 0, imgCount: 0, nonCol: 0 }];
      (xs.length ? xs.slice(0, 4) : NONE).forEach(function (X) {
        (ys.length ? ys.slice(0, 4) : NONE).forEach(function (Y) {
          (ds.length ? ds.slice(0, 4) : NONE).forEach(function (D) {
            var sc = X.v != null && Y.v != null ? C.scoreShot(T, X.v, Y.v) : null, dd = null;
            if (sc && D.v != null) dd = Math.abs(tenths(intMode ? sc.ring : sc.dec) - tenths(D.v));
            // 跨照片獨立證據加成（兩張不同照片讀出相同座標）
            var indepBonus = (X.imgCount >= 2 ? 1.2 : 0) + (Y.imgCount >= 2 ? 1.2 : 0);
            var s2 = X.w + Y.w + D.w + indepBonus + (dd === 0 ? 3 * tot : dd === 1 ? 1.5 * tot : 0);
            if (!best || s2 > best.s) best = { s: s2, x: X, y: Y, d: D, sc: sc, dd: dd };
          });
        });
      });

      var conflict = [];
      // 同一欄同時讀到 v 和 −v → 選負號；負號票權重未大於正數票時標黃
      var sgn = function (list, nm) {
        var hit = false;
        list.forEach(function (o) {
          if (o.v > 0) {
            var ng = list.filter(function (z) { return z.v === -o.v; })[0];
            if (ng && ng.w <= o.w) hit = true;
          }
        });
        if (hit) conflict.push(nm);
      };
      sgn(xs, 'x'); sgn(ys, 'y');
      if (best.x.v > 0 && xs.some(function (z) { return z.v === -best.x.v; })) best.x = xs.filter(function (z) { return z.v === -best.x.v; })[0];
      if (best.y.v > 0 && ys.some(function (z) { return z.v === -best.y.v; })) best.y = ys.filter(function (z) { return z.v === -best.y.v; })[0];

      // 僅忽略整欄 col（o.nonCol === 0）單票且偏離 ≥2 環的框線雜訊；分段 strips/strips08 的異常讀值（如 N15 M40 的 35.68）必須保留衝突！
      var isColBadRingOutlier = function (ov, isX) {
        if (ov == null || best.d.v == null || best.dd !== 0) return false;
        var xv = isX ? ov : best.x.v, yv = isX ? best.y.v : ov;
        if (xv == null || yv == null) return false;
        var sc = C.scoreShot(T, xv, yv);
        var dd = Math.abs(tenths(intMode ? sc.ring : sc.dec) - tenths(best.d.v));
        return dd >= 20;
      };

      var checkCoord = function (list, chosen, nm, isX) {
        if (!chosen || chosen.v == null) return;
        var crossPhoto = chosen.imgCount >= 2;
        if (!isText && R.length === 1 && (chosen.rawW < 1 || chosen.nonCol === 0)) { conflict.push(nm); return; }
        for (var j = 0; j < list.length; j++) {
          var o = list[j];
          if (o === chosen) continue;
          // 獲選為負數且權重嚴格大於正數候選（+v 僅為少數讀法漏讀負號，sgn 已處理）時不重複判衝突
          if (chosen.v < 0 && o.v === -chosen.v && chosen.w > o.w) continue;
          if (crossPhoto && chosen.n >= 2 && o.n === 1 && (o.v * chosen.v > 0)) continue;
          if (o.nonCol === 0 && o.n === 1 && chosen.n >= 1 && isColBadRingOutlier(o.v, isX)) continue;
          var hasSpaced = R.some(function (r) { return (isX ? r.p.x : r.p.y) === chosen.v && r.p.hints && r.p.hints.xySpaced; });
          if (o.w >= chosen.w * 0.5 || (!crossPhoto && hasSpaced)) { conflict.push(nm); return; }
        }
      };
      checkCoord(xs, best.x, 'x', true);
      checkCoord(ys, best.y, 'y', false);
      if (ds.length > 1 && ds.some(function (o) { return o !== best.d && o.w >= best.d.w * 0.5; })) {
        if (!(best.d.imgCount >= 2 && best.d.n >= 3)) conflict.push('dec');
      }

      // 負號殘影、真實三位小數黏合（排除 X 後斜線 '/' 被讀成 '7' 的假三位小數，如 4.45/ 讀成 4.457）、以及單票併發小數亂碼
      var isReal3DecX = function (tr) {
        var m3 = tr && tr.match(/(\d{1,2}[.,]\d{2})(\d)/);
        if (!m3) return false;
        if (best.x.v != null && m3[2] === '7' && Math.abs(+m3[1].replace(',', '.') - Math.abs(best.x.v)) < 1e-6) return false;
        return true;
      };
      var isReal3DecY = function (tr) { return !!(tr && /\d{1,2}[.,]\d{3}/.test(tr)); };
      if (best.x.v > 0 && R.some(function (r) { return r.p.signHint && r.p.signHint.x < 0; })) conflict.push('x');
      if (best.y.v > 0 && R.some(function (r) { return r.p.signHint && r.p.signHint.y < 0; })) conflict.push('y');
      if (R.some(function (r) { return r.p.hints && isReal3DecX(r.p.hints.xTrunc); })) conflict.push('x');
      if (R.some(function (r) { return r.p.hints && isReal3DecY(r.p.hints.yTrunc); })) conflict.push('y');
      if (!isText && best.x.v != null && best.x.n <= 1 && R.some(function (r) { return r.p.hints && r.p.hints.xTrunc && GARBLED_DEC_RE.test(r.p.hints.xTrunc); })) conflict.push('x');
      if (!isText && best.y.v != null && best.y.n <= 1 && R.some(function (r) { return r.p.hints && r.p.hints.yTrunc && GARBLED_DEC_RE.test(r.p.hints.yTrunc); })) conflict.push('y');

      var allRepaired = function (val, fld, pick) {
        if (val == null) return false;
        var hit = R.filter(function (r) { return pick(r.p) === val; });
        return hit.length > 0 && hit.every(function (r) { return r.p.repaired && r.p.repaired.indexOf(fld) >= 0; });
      };
      if (allRepaired(best.x.v, 'x', function (p) { return p.x; })) conflict.push('x');
      if (allRepaired(best.y.v, 'y', function (p) { return p.y; })) conflict.push('y');
      if (allRepaired(best.d.v, 'dec', function (p) { return p.dec; })) conflict.push('dec');
      var chosenT = ts.length ? ts[0].v : '';
      if (chosenT && allRepaired(chosenT, 't', function (p) { return p.t; })) conflict.push('t');
      if (ts.length > 1 && ts[1].w >= ts[0].w * 0.5 && !(ts[0].imgCount >= 2 && ts[0].n >= 3)) conflict.push('t');
      conflict = conflict.filter(function (c, j) { return conflict.indexOf(c) === j; });

      var tReads = chosenT ? R.filter(function (r) { return r.p.t === chosenT; }) : [];
      var tHint = tReads.length > 0 && tReads.every(function (r) { return !!r.p.tHint; }) && conflict.indexOf('t') < 0;
      var stars = R.filter(function (r) { return r.p.star; }).length, P = R.filter(function (r) { return r.p.P; }).length;

      var AR = root.WRSiusArrow || (typeof require === 'function' ? (function () { try { return require('./sius-arrow.js'); } catch (e) { return null; } })() : null);
      var arw = AR ? AR.vote(R.map(function (r) { return r.p.arrow; })) : null; // v3.0.3：各讀法認出的方向箭頭投票
      var q = {
        n: slot.n,
        pn: slot.pn != null ? slot.pn : slot.n,
        blk: slot.blk || 0,
        sighter: slot.sec === 'Q',
        dec: best.d.v,
        inner: best.dd === 0 ? best.sc.inner : stars * 2 > R.length,
        t: chosenT,
        x: best.x.v,
        y: best.y.v,
        ocr: {
          rd: R.map(function (r) { return { img: r.img, pi: r.pi, kind: r.kind, w: r.ew, rawW: r.w, raw: r.p.raw, x: r.p.x, y: r.p.y, d: r.p.dec, t: r.p.t, star: !!r.p.star, arrowRaw: r.p.arrowRaw, signHint: r.p.signHint, hints: r.p.hints, conf: r.p.conf }; }),
          reads: R.length,
          arw: arw,
          demo: R.filter(function (r) { return r.p.demo; }).length * 2 > R.length,
          miss: R.filter(function (r) { return r.p.miss; }).length * 2 > R.length,
          photoCount: slot.photoCount,
          w: { x: best.x.w, y: best.y.w, d: best.d.w, t: ts.length ? ts[0].w : 0 },
          nVotes: { x: best.x.n, y: best.y.n, d: best.d.n, t: ts.length ? ts[0].n : 0 },
          conflict: conflict,
          tHint: tHint,
          stars: stars,
          p: P,
          alt: { x: xs.slice(0, 3).map(function (o) { return o.v; }), y: ys.slice(0, 3).map(function (o) { return o.v; }), dec: ds.slice(0, 3).map(function (o) { return o.v; }) }
        }
      };
      if (intMode) q.decInt = true;
      return q;
    }

    var Q = aligned.qualSlots.map(pickShot);
    var M = aligned.matchSlots.map(pickShot);
    var fill = function (list, upto, sighter) {
      var have = {}, out = [];
      list.forEach(function (q) { have[q.n] = q; });
      var B = aligned.blocks, sec = sighter ? 'Q' : 'M';
      var pnOf = function (n) { if (!B) return { pn: n, blk: 0 }; var b = 0; while (B.off[sec + (b + 1)] != null && B.off[sec + (b + 1)] < n) b++; return { pn: n - (B.off[sec + b] || 0), blk: b }; };
      // v3.0.3：練習單（全試射）每組最前面沒拍到的列不開空格（只拍到下半張時），記在 model.notShot 給畫面說明
      var lead = {};
      if (model.practice && sighter) { var firstRead = {}; list.forEach(function (q) { var b = pnOf(q.n).blk; if (firstRead[b] == null || q.n < firstRead[b]) firstRead[b] = q.n; });
        Object.keys(firstRead).forEach(function (b) { var st = B ? (B.off[sec + b] || 0) + 1 : 1; if (firstRead[b] > st) { for (var k = st; k < firstRead[b]; k++) lead[k] = 1; (model.notShot = model.notShot || []).push({ blk: +b, from: 1, to: firstRead[b] - st }); } }); }
      for (var n = 1; n <= upto; n++) {
        if (lead[n]) continue;
        if (!have[n]) { var pb = pnOf(n); out.push({ n: n, pn: pb.pn, blk: pb.blk, sighter: sighter, dec: null, inner: false, t: '', x: null, y: null, ocr: { reads: 0, missing: true, conflict: [] } }); }
        else out.push(have[n]);
      }
      list.forEach(function (q) { if (q.n > upto) out.push(q); });
      return out;
    };
    model.shots = fill(Q, aligned.qMax, true).concat(fill(M, aligned.matchCount, false));
    model.subs = aligned.subSlots.map(function (s) {
      return s ? { dec: s.dec, inner: s.inner, reads: s.weight, conflict: s.conflict } : null;
    });
    if (aligned.totalSlot) {
      model.total = { dec: aligned.totalSlot.dec, inner: aligned.totalSlot.inner, reads: aligned.totalSlot.weight };
    }
    return model;
  }

  /* ---------- 純文字（手動貼上、測試）→ 模型 ---------- */
  function parseText(text, opt) {
    opt = opt || {};
    var model = merge([{ img: 0, kind: 'text', lines: String(text || '').split(/\r?\n/) }], { targetId: opt.targetId });
    model.ocr = false; model.name = opt.name || ''; model.skipped = [];
    String(text || '').split(/\r?\n/).forEach(function (ln) { if (norm(ln).trim() && !parseLine(ln) && !parseOther(ln)) model.skipped.push(ln.trim()); });
    model.shots.forEach(function (q) { if (q.ocr && !q.ocr.missing) delete q.ocr; });
    return model;
  }

  /* ---------- 核對與問題清單（委派 M6 sius-x-check.js） ---------- */
  function check(model, policyOverride) { return checker().check(model, policyOverride); }
  function problems(model, ck) { return checker().problems(model, ck); }

  /* ---------- 射擊節奏 ---------- */
  // list：[{ t }]（照射擊順序）。每發和上一發的間隔（秒；第一發沒有；跨整點 59→00 自動 +60 分；讀錯造成的倒退不算）、
  // 每 10 發平均、前後半段、最長停頓、趨勢。
  function rhythm(list) {
    var s = list.map(function (q) { return secOf(q && q.t); }), gaps = [null], d = [];
    for (var i = 1; i < s.length; i++) gaps.push(gapSec(s[i - 1], s[i]));
    gaps.forEach(function (g) { if (g != null) d.push(g); });
    var n = d.length, C = core();
    if (!n) return { n: 0, gaps: gaps };
    var avg = d.reduce(function (a, b) { return a + b; }, 0) / n, per10 = [];
    for (var k = 0; k < gaps.length; k += 10) { var p = gaps.slice(k, k + 10).filter(function (g) { return g != null; }); if (p.length) per10.push({ from: k + 1, to: Math.min(gaps.length, k + 10), avg: p.reduce(function (a, b) { return a + b; }, 0) / p.length, n: p.length }); }
    var h = Math.floor(gaps.length / 2), a1 = gaps.slice(0, h).filter(function (g) { return g != null; }), a2 = gaps.slice(h).filter(function (g) { return g != null; });
    var m1 = a1.length ? a1.reduce(function (a, b) { return a + b; }, 0) / a1.length : null, m2 = a2.length ? a2.reduce(function (a, b) { return a + b; }, 0) / a2.length : null;
    var mx = 0, mi = -1; gaps.forEach(function (g, j) { if (g != null && g > mx) { mx = g; mi = j; } });
    var span = d.reduce(function (a, b) { return a + b; }, 0);
    // 前後段差 ≥10% 才算「變快／變慢」（白幻仔提議的門檻，待 White 確認；不是 ISSF 規則）
    var change = m1 && m2 ? (m2 - m1) / m1 : 0, dir = Math.abs(change) < 0.1 ? 'steady' : change < 0 ? 'faster' : 'slower';
    return { n: n, gaps: gaps, avg: avg, median: C ? C.median(d) : avg, per10: per10, firstHalf: m1, secondHalf: m2, change: change, dir: dir, longest: { sec: mx, idx: mi }, span: span, trend: C && per10.length >= 2 ? C.trend(per10.map(function (x) { return x.avg; })) : null };
  }

  /* ---------- 存成一般分析紀錄 ---------- */
  // 試射全部放一張（sighter:true，沿用 v2.9.2 試射：不算總結）；比賽每 10 發一張（第 1–10 發＝第 1 張…）。
  // 每發存 x、y（mm，座標系 A）＋來源 src:'sius'、印的分數 pd、內十 pi、時間 t、發序 n（紀錄碼只帶座標，跟一般紀錄一樣）。
  // 沒有 X/Y 的發（沒讀到又沒補）不能放上靶面 → 不存（存檔前畫面會先問）。
  function toRecord(model, base) {
    var rec = base, now = Date.now(), sg = [], mt = [], mi = 0;
    // 比賽發依「第幾發」分張（第 1–10 發＝第 1 張…）：中間有一發沒座標被略過，後面的發也不會跑到別張
    model.shots.forEach(function (q) {
      var at = q.sighter ? -1 : mi++;
      if (q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y)) return;
      var s = { x: r2(+q.x), y: r2(+q.y), src: 'sius', t: q.t || '' }; if (q.dec != null) s.pd = q.dec; if (q.inner) s.pi = 1; if (q.n != null) s.n = q.n; if (q.pn != null && q.pn !== q.n) s.pn = q.pn; if (q.blk) s.b = q.blk; if (q.hh != null) s.hh = q.hh;
      if (q.sighter) sg.push(s); else (mt[Math.floor(at / 10)] = mt[Math.floor(at / 10)] || []).push(s);
    });
    var sheets = [], k = 0, mk = function (shots, extra) { var h = { id: 'h' + now + (k++) + Math.floor(Math.random() * 1000), created: new Date(now).toISOString(), shots: shots, calib: { mode: 'sius' } }; for (var e in extra || {}) h[e] = extra[e]; return h; };
    if (sg.length) sheets.push(mk(sg, { sighter: true }));
    for (var i = 0; i < mt.length; i++) sheets.push(mk(mt[i] || []));
    rec.targetId = model.targetId; rec.sheets = sheets;
    if (model.name) rec.name = model.name;
    rec.sius = { v: 2, imported: new Date(now).toISOString(), subs: model.subs.map(function (s) { return s ? { dec: s.dec, inner: s.inner } : null; }), total: model.total ? { dec: model.total.dec, inner: model.total.inner } : null };
    if (model.practice) rec.sius.practice = true; // v3.0.3：整張都是試射（練習單）
    if (model.event) rec.sius.event = model.event;
    if (model.date) rec.sius.date = model.date;
    if (model.gun && model.gun.unverified) rec.sius.unverified = true;
    return rec;
  }
  // 紀錄 → 模型（分析頁的核對卡、重新開啟編輯用）
  function fromRecord(rec) {
    var si = rec.sius || {};
    var m = { v: 2, targetId: rec.targetId, gun: { id: rec.targetId, auto: false, unverified: !!si.unverified }, event: si.event || '', date: si.date || '', name: rec.name || '', shots: [], subs: (si.subs || []).slice(), total: si.total || null };
    (rec.sheets || []).forEach(function (sh) { (sh.shots || []).forEach(function (q) { var o = { n: q.n == null ? null : q.n, sighter: !!sh.sighter, dec: q.pd == null ? null : q.pd, inner: !!q.pi, t: q.t || '', x: q.x, y: q.y }; if (q.pn != null) o.pn = q.pn; if (q.b) o.blk = q.b; if (q.hh != null) o.hh = q.hh; m.shots.push(o); }); });
    if (si.practice) m.practice = true;
    var sg = m.shots.filter(function (q) { return q.sighter; }), mt = m.shots.filter(function (q) { return !q.sighter; }); m.shots = sg.concat(mt);
    // v3.0.3：試射有好幾組時序號會重複（每組從 1 開始）→ 內部依序重編，印的序號留在 pn
    var seenN = {}, dupN = sg.some(function (q) { if (q.n == null) return false; if (seenN[q.n]) return true; seenN[q.n] = 1; return false; });
    if (dupN) sg.forEach(function (q, i) { if (q.pn == null) q.pn = q.n; q.n = i + 1; });
    return m;
  }
  // 存檔用的紀錄名稱：「小白單 2026/11/12 08:47」（日期讀不到就用今天）
  function recName(model, prefix) {
    var d = model.date && model.date.match(/(\d{1,2})\.(\d{1,2})\.(20\d\d)\s+(\d{1,2}):(\d{2})/);
    var p = function (v) { return (v < 10 ? '0' : '') + (+v); };
    if (d) return prefix + ' ' + d[3] + '/' + p(d[2]) + '/' + p(d[1]) + ' ' + p(d[4]) + ':' + d[5];
    var n = new Date(); return prefix + ' ' + n.getFullYear() + '/' + p(n.getMonth() + 1) + '/' + p(n.getDate());
  }

  var api = {
    norm: norm, secOf: secOf, fmtSec: fmtSec, gapSec: gapSec,
    parseShot: parseShot, parseOther: parseOther, parseLine: parseLine, parsePass: parsePass,
    merge: merge, parseText: parseText, check: check, problems: problems,
    getPolicy: function () { return checker().getPolicy(); },
    setPolicy: function (p) { return checker().setPolicy(p); },
    rhythm: rhythm, toRecord: toRecord, fromRecord: fromRecord, recName: recName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WRSiusXCore = api;
})(typeof window !== 'undefined' ? window : this);
