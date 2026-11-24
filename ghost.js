/* WRbeta 鬼影模式（Ghost Mode）的純邏輯，不碰畫面，Node 測試可直接 require。
 * 情境：60 發訓練＝6 輪 × 10 發（1–10、11–20…51–60），手動點靶面記錄彈著點（不拍照）。
 * 鬼影＝「上一次的同一發」打在哪裡，用灰色孔顯示在靶面上：
 *   來源 'prev'（預設）：上一次存檔的 60 發訓練（可以改選別筆紀錄）的同一發（第 n 發 ↔ 第 n 發）。
 *   來源 'round'：這一次的上一輪同一發（第 3 輪第 4 發 ↔ 第 2 輪第 4 發；第 1 輪沒有鬼影）。
 * 資料：鬼影練習存成一般的「預報」紀錄（kind:'forecast'，mode:'ghost'），每一發放在 actuals，
 *   欄位 r＝第幾輪（0 起算，與 Lite 多輪相同），session.round＝目前輪次。所以紀錄、比較、紀錄碼都照常可用。
 * 分數一律用 core.js 的 ISSF 計分（scoreShot）；平均用小數分（dec）。 */
(function (root) {
  'use strict';
  var C = root.BMCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  var ROUNDS = 6, PER = 10, TOTAL = ROUNDS * PER;

  function roundOf(p) { return p && p.r > 0 ? p.r | 0 : 0; }
  function isGhost(s) { return !!(s && s.mode === 'ghost'); }
  function isAna(s) { return !!(s && s.kind === 'analysis'); }
  function curRound(s) { return s && s.round > 0 ? Math.min(ROUNDS - 1, s.round | 0) : 0; }
  function newSession(targetId, now) {
    now = now || new Date();
    return { v: 2, kind: 'forecast', mode: 'ghost', id: 'g' + now.getTime(), created: now.toISOString(), name: '', note: '', targetId: targetId || 'ap10',
      preds: [], actuals: [], calib: null, round: 0, ghost: { src: 'prev', ref: null, done: false } };
  }
  /* 第 k 輪的彈著（依記錄順序） */
  function roundShots(s, k) { return (s.actuals || []).filter(function (p) { return roundOf(p) === k; }); }
  /* 一筆紀錄 → 長度 60 的「第 n 發 → 位置」表（沒有的發＝null）
   * 鬼影／Lite 多輪紀錄：第 k 輪第 i 發 → k*10+i；分析紀錄：每一張靶紙＝一輪；舊的預報紀錄：實際彈著依順序（沒有就用預報）。 */
  function slots(s) {
    var out = []; for (var n = 0; n < TOTAL; n++) out.push(null);
    if (!s) return out;
    function put(list) { list.forEach(function (p, i) { if (i < TOTAL) out[i] = p; }); }
    if (isAna(s)) {
      var sh = (s.sheets || []).filter(function (x) { return !(x && x.sighter); }); // v2.9.2：試射的靶紙不算
      if (sh.length > 1 && sh.every(function (x) { return (x.shots || []).length <= PER; })) sh.forEach(function (x, k) { (x.shots || []).forEach(function (p, i) { if (k < ROUNDS) out[k * PER + i] = p; }); });
      else { var all = []; sh.forEach(function (x) { all = all.concat(x.shots || []); }); put(all); }
      return out;
    }
    var acts = s.actuals || [];
    var hasR = acts.some(function (p) { return p.r > 0; });
    if (isGhost(s) || hasR) {
      for (var k = 0; k < ROUNDS; k++) roundShots(s, k).forEach(function (p, i) { if (i < PER) out[k * PER + i] = p; });
      return out;
    }
    put(acts.length ? acts : (s.preds || []));
    return out;
  }
  function countShots(s) { return slots(s).filter(Boolean).length; }
  /* 目前要打的是第幾發（0 起算的全域編號 k*10+i）；這一輪 10 發已滿＝null */
  function nextIndex(s) {
    var k = curRound(s), i = roundShots(s, k).length;
    return i < PER ? k * PER + i : null;
  }
  /* 可以當鬼影的紀錄：同一靶種、有彈著、不是自己；鬼影練習排前面，各自新到舊 */
  function candidates(sessions, cur) {
    var tid = cur && cur.targetId;
    var list = (sessions || []).filter(function (s) { return s && s !== cur && (!cur || s.id !== cur.id) && (!tid || s.targetId === tid) && countShots(s) > 0; });
    list.sort(function (a, b) {
      var ga = isGhost(a) ? 1 : 0, gb = isGhost(b) ? 1 : 0; if (ga !== gb) return gb - ga;
      return String(b.created || '').localeCompare(String(a.created || ''));
    });
    return list;
  }
  /* 預設的鬼影紀錄＝最新一筆鬼影練習（沒有就最新一筆有彈著的紀錄）；使用者選過就用選的（還存在的話） */
  function pickRef(sessions, cur) {
    var c = candidates(sessions, cur), want = cur && cur.ghost && cur.ghost.ref;
    if (want) { var f = c.filter(function (s) { return s.id === want; })[0]; if (f) return f; }
    return c[0] || null;
  }
  /* 鬼影表：src 'prev'＝參考紀錄的同一發；'round'＝這一次上一輪的同一發 */
  function ghostSlots(cur, ref, src) {
    if (src === 'round') {
      var me = slots(cur), out = [];
      for (var n = 0; n < TOTAL; n++) out.push(n >= PER ? me[n - PER] : null);
      return out;
    }
    return slots(ref);
  }
  function ghostAt(gs, n) { return n == null || n < 0 || n >= TOTAL ? null : gs[n] || null; }

  function sc(t, p) { return C.scoreShot(t, p.x, p.y); }
  function avgOf(t, pts) {
    pts = pts.filter(Boolean); if (!pts.length) return null;
    var d = 0, r = 0; pts.forEach(function (p) { var s = sc(t, p); d += s.dec; r += s.ring; });
    return { n: pts.length, avg: d / pts.length, avgRing: r / pts.length, total: r, totalDec: d };
  }
  /* 右側資訊欄與 Pro 6 輪對照表需要的數字
   *   prevAll：鬼影整份的平均；cur：這一次目前累積平均；prevSame：鬼影「同樣這幾發」的平均（同期比較）；
   *   rounds[k]：這一輪這次 vs 上次（同樣的發數比，也附整輪上次平均）。 */
  function summary(t, cur, gs) {
    var me = slots(cur), k = curRound(cur), rounds = [];
    var meAll = [], ghSame = [], ghAll = gs.filter(Boolean);
    for (var n = 0; n < TOTAL; n++) if (me[n]) { meAll.push(me[n]); if (gs[n]) ghSame.push(gs[n]); }
    for (var r = 0; r < ROUNDS; r++) {
      var a = [], g = [], gfull = [];
      for (var i = 0; i < PER; i++) { var q = me[r * PER + i], h = gs[r * PER + i]; if (q) { a.push(q); if (h) g.push(h); } if (h) gfull.push(h); }
      var cA = avgOf(t, a), pS = avgOf(t, g), pF = avgOf(t, gfull);
      rounds.push({ k: r, cur: cA, prev: pF, prevSame: pS, diff: cA && pS ? cA.avg - pS.avg : null, done: r < k || a.length >= PER });
    }
    var cA2 = avgOf(t, meAll), pS2 = avgOf(t, ghSame);
    return { round: k, rounds: rounds, cur: cA2, prevAll: avgOf(t, ghAll), prevSame: pS2, diff: cA2 && pS2 ? cA2.avg - pS2.avg : null,
      shots: meAll.length, next: nextIndex(cur), hasGhost: ghAll.length > 0 };
  }
  /* 第 k 輪 10 格成績條：這次（小數分）與上次 */
  function strip(t, cur, gs, k) {
    var me = slots(cur), o = [];
    for (var i = 0; i < PER; i++) { var n = k * PER + i, q = me[n], h = gs[n]; o.push({ n: n, i: i, me: q ? sc(t, q) : null, gh: h ? sc(t, h) : null }); }
    return o;
  }
  /* 記錄一發（回傳那一發；這一輪已滿或 60 發都打完就回傳 null） */
  function addShot(s, p, now) {
    if (s.ghost && s.ghost.done) return null;
    var n = nextIndex(s); if (n == null) return null;
    var q = { x: C.round(p.x, 3), y: C.round(p.y, 3), src: 'manual', t: now || Date.now() }; var k = curRound(s); if (k > 0) q.r = k;
    s.actuals.push(q); return q;
  }
  /* 復原：只能撤銷「這一輪」的最後一發 */
  function undo(s) {
    var a = s.actuals || [], k = curRound(s);
    for (var i = a.length - 1; i >= 0; i--) if (roundOf(a[i]) === k) return a.splice(i, 1)[0];
    return null;
  }
  /* 完成這一輪：前進到下一輪；第 6 輪完成＝整組完成（done） */
  function finishRound(s) {
    var k = curRound(s);
    s.ghost = s.ghost || { src: 'prev', ref: null };
    if (k >= ROUNDS - 1) { s.ghost.done = true; return { done: true, round: k }; }
    s.round = k + 1; return { done: false, round: k + 1 };
  }

  var api = { ROUNDS: ROUNDS, PER: PER, TOTAL: TOTAL, roundOf: roundOf, isGhost: isGhost, curRound: curRound, newSession: newSession, roundShots: roundShots,
    slots: slots, countShots: countShots, nextIndex: nextIndex, candidates: candidates, pickRef: pickRef, ghostSlots: ghostSlots, ghostAt: ghostAt,
    avgOf: avgOf, summary: summary, strip: strip, addShot: addShot, undo: undo, finishRound: finishRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BMGhost = api;
})(typeof window !== 'undefined' ? window : this);
