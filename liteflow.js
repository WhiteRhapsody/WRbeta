/* WRbeta Lite 三步驟流程（預報 → 拍照 → 結果）的純邏輯，不碰畫面，Node 測試可直接 require。
 * 一組（session）可以有很多「輪」：每輪＝預報 N 發 → 拍一張照 → 看結果 → 繼續下一輪。
 * 每一發預報／彈孔用欄位 r 記錄屬於第幾輪（0 起算；舊資料沒有 r 視為第 0 輪），
 * session.round＝目前正在進行的輪次。配對只在同一輪內做（每輪是一張靶紙／一個電子靶畫面）。 */
if (typeof wrT === 'undefined' && typeof require === 'function') { try { require('./i18n/i18n.js'); } catch (e) {} } // v2.2.0：在 Node（測試）也有 wrT（預設繁體中文）
(function (root) {
  'use strict';
  var C = root.BMCore || (typeof require !== 'undefined' ? require('./core.js') : null);

  function roundOf(p) { return p && p.r > 0 ? p.r | 0 : 0; }
  function curRound(s) { return s && s.round > 0 ? s.round | 0 : 0; }
  /* 某一輪的點（保留在原陣列的位置 i，方便刪改） */
  function itemsOf(list, k) { var o = []; (list || []).forEach(function (p, i) { if (roundOf(p) === k) o.push({ p: p, i: i }); }); return o; }
  function pointsOf(list, k) { return itemsOf(list, k).map(function (q) { return q.p; }); }
  /* 這一組有哪些輪（含目前這一輪，即使還沒資料） */
  function roundList(s) {
    var mx = curRound(s);
    (s.preds || []).concat(s.actuals || []).forEach(function (p) { mx = Math.max(mx, roundOf(p)); });
    var out = [];
    for (var k = 0; k <= mx; k++) out.push({ k: k, preds: pointsOf(s.preds, k).length, acts: pointsOf(s.actuals, k).length });
    return out;
  }
  /* 有結果（有彈孔）的輪 */
  function doneRounds(s) { return roundList(s).filter(function (r) { return r.acts > 0; }); }

  /* 把多輪的配對合在一起重新算準確度（與 core.comparePredictions 同樣的定義） */
  function aggregate(t, pairs, nPred, nAct) {
    var m = pairs.length, se = 0, bx = 0, by = 0, same = 0, ad = 0;
    pairs.forEach(function (q) { se += q.err; bx += q.dx; by += q.dy; if (q.pred.ring === q.act.ring) same++; ad += Math.abs(q.pred.dec - q.act.dec); });
    var out = { m: m, pairs: pairs, unpairedPred: nPred - m, unpairedAct: nAct - m };
    if (m) {
      out.meanErr = se / m; out.biasX = bx / m; out.biasY = by / m; out.biasLen = Math.hypot(out.biasX, out.biasY);
      out.biasDir = C.directionText(out.biasX, out.biasY, C.ringWidth(t) * 0.2);
      out.sameRingRate = same / m; out.meanAbsDecDiff = ad / m;
      var mx = 0, mi = 0; pairs.forEach(function (q) { if (q.err > mx) { mx = q.err; mi = q.i; } });
      out.maxErr = mx; out.maxErrShot = mi;
    }
    return out;
  }

  /* 一輪（k）或全部（k='all'）的結果 */
  function result(t, s, k) {
    var ks = k === 'all' ? roundList(s).map(function (r) { return r.k; }) : [k];
    var preds = [], acts = [], pairs = [], nP = 0, nA = 0, perRound = [];
    ks.forEach(function (kk) {
      var pi = itemsOf(s.preds, kk), ai = itemsOf(s.actuals, kk);
      var cmp = C.comparePredictions(t, pi.map(function (q) { return q.p; }), ai.map(function (q) { return q.p; }), 'optimal');
      // 編號換成整組的「第幾發預報」與彈孔在 actuals 的位置
      cmp.pairs.forEach(function (q) {
        pairs.push(Object.assign({}, q, { r: kk, predIdx: pi[q.i - 1].i, actIdx: ai[q.actIdx].i, i: pi[q.i - 1].i + 1 }));
      });
      nP += pi.length; nA += ai.length;
      preds = preds.concat(pi.map(function (q) { return q.p; })); acts = acts.concat(ai.map(function (q) { return q.p; }));
      if (ai.length || pi.length) perRound.push({ k: kk, preds: pi.length, acts: ai.length, st: C.computeStats(t, ai.map(function (q) { return q.p; })) });
    });
    var cmpAll = aggregate(t, pairs, nP, nA);
    var st = C.analyzeShots(t, acts), pst = C.computeStats(t, preds);
    return { k: k, rounds: ks, preds: preds, acts: acts, cmp: cmpAll, st: st, pst: pst, perRound: perRound, hasForecast: preds.length > 0 };
  }

  /* 預報準不準：用「平均預報誤差相當於幾個環寬」分級（WRbeta 自訂的練習參考，不是 ISSF 規則） */
  function accuracyLevel(t, cmp) {
    if (!cmp || !cmp.m) return null;
    var w = C.ringWidth(t), u = cmp.meanErr / w;
    var lv = u <= 0.5 ? 3 : u <= 1 ? 2 : u <= 2 ? 1 : 0;
    return { rings: u, level: lv, label: [wrT('liteflow.keep_practicing'), wrT('liteflow.fair'), wrT('liteflow.good'), wrT('liteflow.very_accurate')][lv] };
  }

  /* 拍照偵測結果寫入第 k 輪：只換掉這一輪的彈孔，其他輪不動 */
  function setRoundActuals(s, k, holes) {
    var keep = (s.actuals || []).filter(function (p) { return roundOf(p) !== k; });
    s.actuals = keep.concat((holes || []).map(function (q) { var o = Object.assign({}, q); o.r = k; return o; }));
    return s.actuals;
  }
  /* 第 k 輪最靠近 pt（mm）的點，距離 ≤ maxD 才算 */
  function nearest(list, k, pt, maxD) {
    var bi = -1, bd = Infinity;
    (list || []).forEach(function (p, i) { if (roundOf(p) !== k) return; var d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < bd) { bd = d; bi = i; } });
    return bi >= 0 && bd <= maxD ? bi : -1;
  }
  /* 復原只能撤銷「目前這一輪」的最後一發預報，不會動到已經對照完的輪 */
  function canUndoPred(s) { var p = s.preds || []; return p.length > 0 && roundOf(p[p.length - 1]) === curRound(s); }
  /* 下一步能不能按 */
  function stepReady(s, step) {
    var k = curRound(s);
    if (step === 3) return pointsOf(s.actuals, k).length > 0 || doneRounds(s).length > 0;
    return true;
  }
  /* 開始下一輪：目前這一輪要有東西才往前，避免空輪 */
  function nextRound(s) {
    var k = curRound(s);
    if (pointsOf(s.preds, k).length || pointsOf(s.actuals, k).length) s.round = k + 1;
    return curRound(s);
  }
  /* 轉成「分析」紀錄格式（每一輪＝一張靶紙），給紀錄碼與雲端同步用；只含實際彈孔 */
  function toAnalysisRecord(s) {
    var sheets = [];
    roundList(s).forEach(function (r) {
      var a = pointsOf(s.actuals, r.k);
      if (a.length) sheets.push({ id: s.id + 'r' + r.k, created: s.created, shots: a.map(function (p) { return { x: p.x, y: p.y, src: p.src || 'auto' }; }), calib: null, photo: null });
    });
    if (!sheets.length) return null;
    return { v: 2, kind: 'analysis', id: 'L' + s.id, created: s.created, tz: 'Asia/Taipei', name: s.name || '', note: '', targetId: s.targetId, sheets: sheets };
  }

  var api = { roundOf: roundOf, curRound: curRound, itemsOf: itemsOf, pointsOf: pointsOf, roundList: roundList, doneRounds: doneRounds,
    aggregate: aggregate, result: result, accuracyLevel: accuracyLevel, setRoundActuals: setRoundActuals, nearest: nearest,
    canUndoPred: canUndoPred, stepReady: stepReady, nextRound: nextRound, toAnalysisRecord: toAnalysisRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BMLite = api;
})(typeof window !== 'undefined' ? window : this);
