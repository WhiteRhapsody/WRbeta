/* WRbeta v3.0 beta 小白單辨識流程（window.WRSiusV3；Node 也能 require）。【White 2026-11-27 00:41 指定】
 *   主引擎＝M6b（sius-x-*.js，反重 Carbon 的 m6b，核對規則全開）；M6b 留下紅燈或沒讀到的列，才用現有引擎（sius.js／sius-ocr.js）補。
 *   燈號：綠＝讀對的把握很高；黃＝不擋存檔（照樣算分，畫面標一個可以點的小記號）；紅＝一定要改完才能存。
 *   規則（check 之後只會把綠降成黃，不會把黃／紅升成綠）：
 *     全部組合（v2.9.6 1245 發／手槍 1126 驗證過）：同一時間出現兩次、試射只讀到 1 次、小計對不上時讀到最少次的 2 發、X／Y 票數 <2、
 *       X／Y 有不同讀值、小計內十數對不上時該組 10 環；
 *     新規則 signFlip：兩個讀法只差正負號（例如 −4.44／4.44）就不給綠；
 *     v3.0.1：備援補上的列（fb）分數對得上也可以亮綠燈（White 2026-11-27 指定；fbCap 關掉）。
 *     v3.0.1：手槍資格賽（單子印整數）一律拿「X/Y 算出的分數無條件捨去」跟單上整數比（8.0–8.9＝8），決賽／步槍維持小數。
 *   每一步的耗時（毫秒）都記在 timing，畫面與回報都用得到。 */
(function (root) {
  'use strict';
  var isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  function C0() { return root.BMCore || (isNode ? require('./core.js') : null); }
  function X() { return root.WRSiusXCore || (isNode ? require('./sius-x-core.js') : null); }
  function S0() { return root.WRSius || (isNode ? require('./sius.js') : null); }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  var RULES = { dupTime: 1, sighterReads: 2, subGuard: 'two', fieldW: 2, fields: ['x', 'y'], xyUnanimous: 1, innerGuard: 0, signFlip: 1, fbCap: 0 };
  function key(q) { return (q.sighter ? 'Q' : 'M') + q.n; }
  function down(r, why) { if (r._ed) return; if (r.status === 'ok') { r.status = 'near'; (r.why = r.why || []).push(why); } }
  function flip(a, b) { return a != null && b != null && a !== 0 && Math.abs(a + b) < 1e-9; }
  // check 之後的規則（只降綠）
  function rules(model, ck, opt) {
    opt = opt || RULES; var rows = ck.rows, shots = model.shots;
    rows.forEach(function (r) { if (shots[r.i] && shots[r.i].ed) r._ed = 1; }); // 使用者親手改過（或確認過）的發：規則不再降成黃燈
    if (opt.dupTime) { var m = {}; rows.forEach(function (r) { var t = shots[r.i].t; if (t) (m[t] = m[t] || []).push(r); }); Object.keys(m).forEach(function (t) { if (m[t].length > 1) m[t].forEach(function (r) { down(r, 'dupT'); }); }); }
    if (opt.sighterReads) rows.forEach(function (r) { var q = shots[r.i]; if (q.sighter && q.ocr && q.ocr.reads < opt.sighterReads) down(r, 'sReads'); });
    if (opt.fieldW) rows.forEach(function (r) { var q = shots[r.i], w = q.ocr && q.ocr.w; if (!w) return; var f = opt.fields.filter(function (k) { return w[k] < opt.fieldW; }); if (f.length) down(r, 'fieldW:' + f.join('')); });
    if (opt.subGuard) ck.series.forEach(function (s) {
      if (s.status !== 'bad' && s.status !== 'nosub') return;
      var rs = s.rows.map(function (i) { return rows.filter(function (r) { return r.i === i; })[0]; }).filter(Boolean);
      if (rs.some(function (r) { return r.status !== 'ok'; })) return;
      (opt.subGuard === 'all' ? rs : rs.slice().sort(function (a, b) { return ((shots[a.i].ocr || {}).reads || 0) - ((shots[b.i].ocr || {}).reads || 0); }).slice(0, 2)).forEach(function (r) { down(r, 'sub'); });
    });
    if (opt.xyUnanimous) rows.forEach(function (r) { var a = shots[r.i].ocr && shots[r.i].ocr.alt; if (a && ((a.x && a.x.length > 1) || (a.y && a.y.length > 1))) down(r, 'xyAlt'); });
    if (opt.innerGuard) (model.subs || []).forEach(function (sb, j) {
      if (!sb) return;
      var grp = rows.filter(function (r) { var q = shots[r.i]; return !q.sighter && q.n > j * 10 && q.n <= j * 10 + 10; });
      if (grp.filter(function (r) { return shots[r.i].inner; }).length !== sb.inner) grp.filter(function (r) { return shots[r.i].dec >= 10; }).forEach(function (r) { down(r, 'inner'); });
    });
    if (opt.signFlip) rows.forEach(function (r) {
      var q = shots[r.i], o = q.ocr; if (!o || o.xyPick) return;
      ['x', 'y'].forEach(function (f) {
        var vals = [].concat(o.alt && o.alt[f] || []); (o.rd || []).forEach(function (d) { if (d[f] != null) vals.push(d[f]); });
        if (vals.some(function (v) { return flip(v, q[f]); })) down(r, 'sign:' + f);
      });
    });
    if (opt.fbCap) rows.forEach(function (r) { if (shots[r.i].fb) down(r, 'fb'); }); // v3.0.2（White 2026-11-27 11:07）：拿掉 v3.0.1 的「備援自己也核對綠」護欄，備援列只要座標跟單上分數對得上就綠
    // v3.0.2（White 2026-11-27）：逐發編輯按「保存」＝當綠燈
    rows.forEach(function (r) { if (shots[r.i] && shots[r.i].okd) { r.status = 'ok'; r.orange = false; r.why = []; } });
    ck.bad = rows.filter(function (r) { return r.status === 'bad'; }).length + ck.series.filter(function (x) { return x.status === 'bad'; }).length + (ck.total && ck.total.status === 'bad' ? 1 : 0);
    ck.near = rows.filter(function (r) { return r.status === 'near'; }).length;
    return ck;
  }
  /* v3.0.1：整張是整數單（手槍資格賽）？大多數有分數的發是整數讀法（decInt），或重開的手槍紀錄（ap10）分數全是整數。
   * 是的話，分數空白或整數的發都標 decInt，核對時用整數環（floor）比；只在比對時用，不改存檔格式。 */
  function intSheet(model) {
    var n = 0, ni = 0, allInt = true;
    (model.shots || []).forEach(function (q) { if (q.dec == null || !isFinite(q.dec)) return; n++; if (q.decInt) ni++; if (Math.abs(q.dec - Math.round(q.dec)) > 1e-9) allInt = false; });
    return n > 0 && allInt && (ni * 2 > n || (ni === 0 && model.targetId === 'ap10'));
  }
  function stampInt(model) {
    var on = intSheet(model); model.intSheet = on;
    if (on) model.shots.forEach(function (q) { if (q.dec == null || !isFinite(q.dec) || Math.abs(q.dec - Math.round(q.dec)) < 1e-9) q.decInt = true; });
    return on;
  }
  /* v3.0.2（White 2026-11-27）：X／Y 有兩種以上讀法 → 用單上分數反推：只有一組 (X, Y) 算出來跟單上分數一樣 → 採用、不打燈；
   * 全部都一樣 → 維持現行（黃燈請核對）；全部都不一樣 → 照舊提示。使用者改過的發不動。 */
  function xyPick(model) {
    var C = C0(); if (!C || !C.TARGETS) return;
    var T = C.TARGETS[model.targetId] || C.TARGETS.ar10;
    model.shots.forEach(function (q) {
      var o = q.ocr; if (!o || !o.alt || q.ed || q.dec == null || o.xyPick) return;
      var xs = (o.alt.x && o.alt.x.length ? o.alt.x : [q.x]).filter(function (v) { return v != null; });
      var ys = (o.alt.y && o.alt.y.length ? o.alt.y : [q.y]).filter(function (v) { return v != null; });
      if (xs.length < 2 && ys.length < 2) return;
      var hit = [], n = 0;
      xs.forEach(function (x) { ys.forEach(function (y) { n++; var sc = C.scoreShot(T, x, y); var v = q.decInt ? sc.ring : sc.dec; if (Math.round(v * 10) === Math.round(q.dec * 10)) hit.push({ x: x, y: y }); }); });
      if (hit.length !== 1 || n < 2) return;
      q.x = hit[0].x; q.y = hit[0].y; o.xyPick = 1;
      o.alt = { x: [q.x], y: [q.y], dec: o.alt.dec };
      o.conflict = (o.conflict || []).filter(function (c) { return c !== 'x' && c !== 'y'; });
      if (o.w) { o.w.x = Math.max(o.w.x || 0, 2); o.w.y = Math.max(o.w.y || 0, 2); }
    });
  }
  function check(model, opt) { stampInt(model); xyPick(model); var ck = X().check(model); return rules(model, ck, opt); }
  // 紅燈（要改完才能存）：紅燈的列、對不上的小計／總分
  function blocking(ck) { return ck ? ck.bad : 0; }
  function needFallback(model, ck) { return ck.rows.some(function (r) { return r.status === 'bad' || r.orange || r.missing; }); }
  /* 備援補列：主模型裡紅燈／沒讀到的列，現有引擎有讀到而且自己核對不是紅燈 → 用它的值（標 fb；v3.0.1 起對得上就可以綠燈）。
   * 對應方式：試射／比賽＋發序相同；同一發序有好幾發時挑時間最接近的。回傳補了幾列。 */
  function fill(model, fbModel, opt) {
    if (!fbModel || !fbModel.shots || !fbModel.shots.length) return 0;
    var ck = check(model, opt), fck = S0().check(fbModel), fst = {}, n = 0, used = {};
    fck.rows.forEach(function (r) { fst[r.i] = r.status; });
    var sec = X().secOf;
    ck.rows.forEach(function (r) {
      if (!(r.status === 'bad' || r.orange || r.missing)) return;
      var q = model.shots[r.i], best = -1, bd = 1e9;
      fbModel.shots.forEach(function (f, j) {
        if (used[j] || !!f.sighter !== !!q.sighter || f.n !== q.n || fst[j] === 'bad') return;
        if (f.dec == null || f.x == null || f.y == null || !f.t) return;
        var a = sec(q.t), b = sec(f.t), d = a == null || b == null ? 0 : Math.abs(a - b);
        if (d < bd) { bd = d; best = j; }
      });
      if (best < 0) return;
      var f = fbModel.shots[best]; used[best] = 1;
      q.dec = f.dec; q.inner = !!f.inner; q.t = f.t; q.x = f.x; q.y = f.y; q.fb = true; q.fbSt = fst[best]; if (f.decInt || model.intSheet) q.decInt = true; // v3.0.1：補列也走整數比對
      q.ocr = q.ocr || {}; q.ocr.missing = false; q.ocr.conflict = []; q.ocr.alt = null; q.ocr.w = { x: 9, y: 9, d: 9, t: 9 }; q.ocr.reads = Math.max(q.ocr.reads || 0, 2); q.ocr.fbFrom = 'main';
      n++;
    });
    return n;
  }
  // 讀法 → 模型：M6b 合併；有備援讀法就補紅列
  function build(passes, fbPasses, mopt) {
    var t0 = now(), m = X().merge(passes, mopt || {}), t1 = now(), nf = 0;
    if (fbPasses && fbPasses.length) { var fm = S0().merge(fbPasses, { targetId: m.targetId }); nf = fill(m, fm); }
    m.v3 = { merge: Math.round(t1 - t0), fill: Math.round(now() - t1), filled: nf };
    return m;
  }
  /* 整套流程（瀏覽器）：M6b 讀照片 → 合併核對 → 有紅／沒讀到 → 現有引擎讀同一批照片 → 補列。
   * opt：{ onProgress(p, phase), cancelled(), imgBase, targetId, log(step, ms) }。回傳 { passes, fbPasses, timing } */
  function run(files, opt) {
    opt = opt || {};
    var XE = root.WRSiusX, OCR = root.WRSiusOCR, t0 = now(), T = { m6b: null, merge: 0, check: 0, fallback: 0, fbRun: false, total: 0 };
    var prog = opt.onProgress || function () {};
    var lg = function (k, v) { T[k] = v; if (opt.log) try { opt.log(k, v); } catch (e) {} };
    return XE.run(files, { imgBase: opt.imgBase, targetId: opt.targetId, cancelled: opt.cancelled, onProgress: function (p, ph) { prog(p * 0.8, ph); } }).then(function (r) {
      lg('m6b', r.timing || null);
      var ta = now(), m = X().merge(r.passes, { targetId: opt.targetId }), tb = now(), ck = check(m), tc = now();
      lg('merge', Math.round(tb - ta)); lg('check', Math.round(tc - tb));
      if (!OCR || !needFallback(m, ck) || (opt.cancelled && opt.cancelled())) { lg('total', Math.round(now() - t0)); return { passes: r.passes, fbPasses: [], timing: T, info: r.info }; }
      var td = now(); T.fbRun = true; prog(0.8, 'fallback');
      return OCR.run(files, { imgBase: opt.imgBase, cancelled: opt.cancelled, onProgress: function (p) { prog(0.8 + p * 0.19, 'fallback'); }, more: function (np) { try { var S = S0(), ck2 = S.check(S.merge(np, {})); return ck2.bad > 0 || ck2.rows.some(function (x) { return x.missing; }); } catch (e) { return false; } } }).then(function (r2) {
        try { OCR.stop(); } catch (e) {}
        lg('fallback', Math.round(now() - td)); lg('total', Math.round(now() - t0));
        return { passes: r.passes, fbPasses: r2.passes || [], timing: T, info: r.info };
      });
    });
  }
  function stop() { try { if (root.WRSiusX) root.WRSiusX.stop(); } catch (e) {} try { if (root.WRSiusOCR) root.WRSiusOCR.stop(); } catch (e) {} }
  var api = { RULES: RULES, intSheet: intSheet, rules: rules, check: check, blocking: blocking, needFallback: needFallback, fill: fill, build: build, run: run, stop: stop, key: key,
    problems: function (m, ck) { return X().problems(m, ck || check(m)); } };
  if (isNode) module.exports = api; else root.WRSiusV3 = api;
})(typeof window !== 'undefined' ? window : this);
