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
  function AR() { return root.WRSiusArrow || (isNode ? (function () { try { return require('./sius-arrow.js'); } catch (e) { return null; } })() : null); }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  var RULES = { lenient: 1, dupTime: 1, sighterReads: 2, subGuard: 'two', fieldW: 2, fields: ['x', 'y'], xyUnanimous: 1, innerGuard: 0, signFlip: 1, fbCap: 0, arrow: 1 };
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
    // v3.0.3：方向箭頭。箭頭跟 X/Y 對不上、又沒辦法從備選讀法挑出唯一對得上的 → 黃燈（絕不給綠）；
    //   用箭頭＋單上分數改過的值不是 OCR 原本讀到的（例如 Y 的 1 改成 7、補負號）→ 也是黃燈請核對
    if (opt.arrow) rows.forEach(function (r) { var o = shots[r.i].ocr; if (!o) return; if (o.arrowBad) down(r, 'arrow'); else if (o.arrowFix && o.arrowFix.edits) down(r, 'arrowFix'); });
    // v3.0.3：特殊列（示範發「!」不計分、Miss 脫靶）→ 黃燈，畫面說明
    rows.forEach(function (r) { var o = shots[r.i].ocr; if (o && (o.demo || o.miss)) { if (r.status === 'bad' && shots[r.i].x == null && o.miss) r.status = 'near'; down(r, o.demo ? 'demo' : 'miss'); } });
    // v3.0.3：練習單（全試射）中間沒讀到的列 → 黃燈「沒讀到」，不擋存檔（存檔時空列略過）
    if (model.practice) rows.forEach(function (r) { var q = shots[r.i]; if (r.status === 'bad' && r.missing && q.x == null && q.dec == null) { r.status = 'near'; (r.why = r.why || []).push('practiceGap'); } });
    if (opt.fbCap) rows.forEach(function (r) { if (shots[r.i].fb) down(r, 'fb'); }); // v3.0.2（White 2026-11-27 11:07）：拿掉 v3.0.1 的「備援自己也核對綠」護欄，備援列只要座標跟單上分數對得上就綠
    // v3.1.0 紅黃燈新規則（White 2026-11-27）：紅燈＝這發沒有分數（整行沒讀到、分數讀不到也算不出來）；有分數的發最多黃燈、不擋存檔
    if (opt.lenient) rows.forEach(function (r) {
      var q = shots[r.i], o = q.ocr || {};
      if (o.tFix) down(r, 'tFix');
      if (o.xyFix) { if (r.status === 'ok') r.status = 'near'; r.orange = false; (r.why = r.why || []).push('xyFix'); }
      if (q.decSub) { r.status = 'near'; (r.why = r.why || []).push('decSub'); }
      if (q.decCalc) { var sr = ck.series.filter(function (s) { return s.rows.indexOf(r.i) >= 0; })[0]; if (!sr || sr.status !== 'ok') down(r, 'decCalc'); }
      if (r.status !== 'bad' || q.dec == null || !isFinite(q.dec)) return;
      var Rd = o.rd || [], weak = Rd.length === 1 && (Rd[0].kind === 'col' || (Rd[0].rawW != null ? Rd[0].rawW : Rd[0].w) < 1);
      if (weak && !q.decSub && !q.ed) return; // 只有一次很弱的讀法：分數本身沒把握 → 維持紅燈
      var noxy = q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y);
      r.status = 'near'; r.soft = 1; (r.why = r.why || []).push(noxy ? 'noxy' : (r.diff != null && r.diff >= 0.2) ? 'scoreWins' : (r.miss || []).indexOf('t') >= 0 ? 'notime' : 'soft');
      if (!noxy && r.diff != null && r.diff >= 0.2) r.orange = true;
    });
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
    (model.shots || []).forEach(function (q) { if (q.dec == null || !isFinite(q.dec) || q.decCalc || q.decSub) return; n++; if (q.decInt) ni++; if (Math.abs(q.dec - Math.round(q.dec)) > 1e-9) allInt = false; });
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
      var A = AR(), ad = A && A.sure(o.arw) ? o.arw.dir : null; // v3.0.3：箭頭有把握時，只挑跟箭頭合的組合
      var fits = function (x, y) { var sc = C.scoreShot(T, x, y); var v = q.decInt ? sc.ring : sc.dec; return Math.round(v * 10) === Math.round(q.dec * 10); }, nNo = 0;
      xs.forEach(function (x) { ys.forEach(function (y) { n++; if (fits(x, y)) { nNo++; if (!ad || A.compat(x, y, ad)) hit.push({ x: x, y: y }); } }); });
      if (hit.length !== 1 || n < 2) return;
      // 只靠箭頭才挑得出來時，再看 1↔7 互換：換了也跟箭頭、分數都合 → 箭頭分不出來，不挑（維持黃燈）
      if (ad && nNo > 1) { var h = hit[0], amb = false;
        swap17(h.x).forEach(function (x2) { if (fits(x2, h.y) && A.compat(x2, h.y, ad)) amb = true; });
        swap17(h.y).forEach(function (y2) { if (fits(h.x, y2) && A.compat(h.x, y2, ad)) amb = true; });
        if (amb) return; }
      q.x = hit[0].x; q.y = hit[0].y; o.xyPick = 1;
      o.alt = { x: [q.x], y: [q.y], dec: o.alt.dec };
      o.conflict = (o.conflict || []).filter(function (c) { return c !== 'x' && c !== 'y'; });
      if (o.w) { o.w.x = Math.max(o.w.x || 0, 2); o.w.y = Math.max(o.w.y || 0, 2); }
    });
  }
  /* v3.0.3：方向箭頭核對（White 2026-11-27 12:51「開工」）。各讀法認出的箭頭投票有把握（WRSiusArrow.sure）時：
   *   X/Y 跟箭頭合 → 不動；不合 → 從「OCR 讀到的其他 X/Y」＋「補負號／1↔7 互換」裡找跟箭頭合、而且算出的分數跟單上一樣的組合，
   *   改最少的那組只有一組才採用（改過的不是 OCR 原本讀到的 → 黃燈）；找不到或不只一組 → 不改、黃燈。使用者改過的發不動。 */
  function swap17(v) { var out = [], s = Math.abs(v).toFixed(2), sg = v < 0 ? -1 : 1; for (var i = 0; i < s.length; i++) { var c = s[i]; if (c === '1' || c === '7') out.push(sg * +(s.slice(0, i) + (c === '1' ? '7' : '1') + s.slice(i + 1))); } return out; }
  function arrowFix(model) {
    var A = AR(), C = C0(); if (!A || !C || !C.TARGETS) return;
    var T = C.TARGETS[model.targetId] || C.TARGETS.ar10;
    model.shots.forEach(function (q) {
      var o = q.ocr; if (!o || q.ed || o.arrowDone || !A.sure(o.arw) || q.x == null || q.y == null) return;
      o.arrowDone = 1; var dir = o.arw.dir;
      if (A.compat(q.x, q.y, dir)) return;
      if (q.dec == null) { o.arrowBad = { dir: dir, n: 0 }; return; } // 沒有分數可驗證 → 不改值，只標黃
      var cand = function (v, alts) { var m = {}; var add = function (x, e) { if (x == null || !isFinite(x)) return; var k = x.toFixed(2); if (m[k] == null || m[k].e > e) m[k] = { v: x, e: e }; };
        add(v, 0); (alts || []).forEach(function (a) { add(a, 0); }); Object.keys(m).forEach(function (k) { var b = m[k]; if (b.e) return; add(-b.v, 1); swap17(b.v).forEach(function (s2) { add(s2, 1); add(-s2, 2); }); });
        return Object.keys(m).map(function (k) { return m[k]; }); };
      var okSc = function (x, y) { var sc = C.scoreShot(T, x, y), v = q.decInt ? sc.ring : sc.dec; return Math.round(v * 10) === Math.round(q.dec * 10); };
      var xs = cand(q.x, o.alt && o.alt.x), ys = cand(q.y, o.alt && o.alt.y), hits = [], minE = 9;
      xs.forEach(function (X) { ys.forEach(function (Y) {
        if (!A.compat(X.v, Y.v, dir)) return;
        if (q.dec != null) { var sc = C.scoreShot(T, X.v, Y.v), v = q.decInt ? sc.ring : sc.dec; if (Math.round(v * 10) !== Math.round(q.dec * 10)) return; }
        var e = X.e + Y.e; if (e < minE) { minE = e; hits = []; } if (e === minE) hits.push({ x: X.v, y: Y.v, e: e });
      }); });
      if (hits.length === 1 && minE <= 1) { var hh = hits[0], amb = false; // 1↔7 互換後也跟箭頭＋分數合 → 分不出來，不改
        swap17(hh.x).forEach(function (x2) { if (A.compat(x2, hh.y, dir) && okSc(x2, hh.y)) amb = true; });
        swap17(hh.y).forEach(function (y2) { if (A.compat(hh.x, y2, dir) && okSc(hh.x, y2)) amb = true; });
        if (amb && minE === 0) { o.arrowBad = { dir: dir, n: 2 }; return; } // 只對「挑 OCR 原本讀法」的情況（改 1 處的已經是最少改動） // 只接受改 1 處（補/拿掉負號，或一個 1↔7）；要改 2 處多半是箭頭認錯 → 不改、黃燈
        o.arrowFix = { from: { x: q.x, y: q.y }, edits: minE, dir: dir };
        q.x = hits[0].x; q.y = hits[0].y;
        o.alt = { x: [q.x], y: [q.y], dec: o.alt && o.alt.dec }; o.xyPick = 1;
        o.conflict = (o.conflict || []).filter(function (c) { return c !== 'x' && c !== 'y'; });
      } else o.arrowBad = { dir: dir, n: hits.length };
    });
  }
  /* v3.0.3（第 6 項）：每發時間只印 mm:ss.cc；小時用表頭「dd.MM.yyyy HH:mm」補（表頭時間＝開始時間）。
   *   照射擊順序往後展開：分秒比前一發少超過 30 分鐘＝跨整點 → 小時 +1（讀錯造成的小倒退不算）。結果放 q.hh（0–23）、q.ta（當天第幾秒，排序用）。 */
  function hours(model) {
    var d = model && model.date && String(model.date).match(/(\d{1,2})\.(\d{1,2})\.(20\d\d)\s+(\d{1,2}):(\d{2})/), sec = X().secOf;
    var shots = (model && model.shots) || [];
    shots.forEach(function (q) { delete q.hh; delete q.ta; });
    if (!d) return;
    var H = +d[4], hm = +d[5], prev = null, first = true, day = 0;
    if (!(H >= 0 && H < 24 && hm < 60)) return;
    var S = shots.map(function (q) { return q && q.t ? sec(q.t) : null; });
    var nextS = function (i) { for (var j = i + 1; j < S.length; j++) if (S[j] != null) return S[j]; return null; };
    var next3 = function (i) { var o = []; for (var j = i + 1; j < S.length && o.length < 4; j++) if (S[j] != null) o.push(S[j]); return o; };
    var follows = function (i, s) { var o = next3(i); if (!o.length) return null; var k = o.filter(function (v) { return v >= s - 60 && v <= s + 1800; }).length; return o.length >= 4 ? k >= 3 : k * 2 > o.length; }; // 後面 4 發至少 3 發接在這發後面（不到 4 發就要過半）
    var inc = function () { H++; if (H >= 24) { H = 0; day++; } };
    var put = function (q, s) { q.hh = H; q.ta = day * 86400 + H * 3600 + s; };
    shots.forEach(function (q, i) {
      var s = S[i]; if (s == null) return;
      if (first) { if (s < hm * 60 - 300) inc(); else if (s - hm * 60 > 3000) H = (H + 23) % 24; first = false; } // 表頭 09:58、第一發 00:31 → 下一個小時；表頭 13:00、第一發 59:58 → 前一個小時
      else if (prev != null && s < prev - 1800) {
        var fw = follows(i, s); // 後面幾發大多也接在這發後面（也跨了整點）才算真的跨小時；一兩發倒退很多＝時間讀錯，不動小時
        if (fw === false) { put(q, s); return; }
        if (fw === null && !(prev >= 3000 && s <= 900)) { put(q, s); return; } // 最後一發：前一發在 50 分後、這發在 15 分前才算跨小時，不然當讀錯
        inc();
      } else if (prev != null && s > prev + 1800) { // 往前跳很多：後面幾發大多接在後面＝真的停很久；否則＝讀錯，不當基準
        if (!follows(i, s)) { put(q, s); return; }
      }
      put(q, s); prev = s;
    });
  }
  /* ===== v3.1.0（White 2026-11-27 18:38「開工」）：照單子推回來（引擎第 5、6 項＋紅黃燈新規則）=====
   *   tFix：時間只漏讀分鐘十位數（17:33.72 讀成 7:33.72）→ 用同段前後兩發的時間夾，剛好一個十位數夾得進去才補（q.ocr.tFix）。
   *   decCalc：分數沒讀到、X/Y 都有 → 用座標算分數（畫面加底線；手槍整數單用整數環）。
   *   decSub：正式一組 10 發只缺 1 發分數（連座標也沒有）、單上有小計 → 小計減其他 9 發＝這發（含內十數；畫面加底線）。
   *   xyFix：分數跟座標對不上 → 以單上分數為準：只改一個常見誤讀的數字（1↔7、3↔8、5↔6、6↔8、0↔8、8↔9、1↔4）或正負號，
   *          剛好一組讓算出來的分數（＋內十）跟單上一樣、也跟箭頭合（箭頭有把握時）才改；黃燈「已依分數修正座標」。找不到就不改座標，黃燈。
   *   使用者改過的發（q.ed）一律不動。全部只做一次（q.ocr.rp*），重複核對不會越改越多。 */
  var CONF = { '1': '74', '7': '1', '3': '8', '8': '3609', '5': '6', '6': '58', '0': '8', '9': '8', '4': '1' };
  function digitEdits(v) { // 回傳 [{ v, t }]：t＝誤讀常見程度（1＝1↔7 互換、正負號；2＝其他像的數字；3＝十位數漏讀／多讀）
    var out = [], s = Math.abs(v).toFixed(2), sg = v < 0 ? -1 : 1;
    out.push({ v: -v, t: 1 });
    for (var i = 0; i < s.length; i++) { var c = s[i], alt = CONF[c]; if (!alt) continue; for (var j = 0; j < alt.length; j++) { var nv = +(s.slice(0, i) + alt[j] + s.slice(i + 1)); if (isFinite(nv)) out.push({ v: sg * nv, t: (c === '1' && alt[j] === '7') || (c === '7' && alt[j] === '1') ? 1 : 2 }); } }
    if (s.length === 4) [1, 7].forEach(function (d) { out.push({ v: sg * +(String(d) + s), t: 3 }); }); // 十位數漏讀（17.30 → 7.30）
    if (s.length === 5 && s[0] === '1') out.push({ v: sg * +s.slice(1), t: 3 }); // 多讀一個 1
    return out;
  }
  function tFix(model) {
    var P = X(), sec = P.secOf, shots = model.shots;
    shots.forEach(function (q, i) {
      if (q.ed || !q.t || !q.ocr || q.ocr.rpT || !/^\d{2}:\d{2}\.\d{2}$/.test(q.t)) return; q.ocr.rpT = 1;
      var s = sec(q.t); if (s == null) return;
      var nb = function (d) { for (var j = i + d; j >= 0 && j < shots.length; j += d) { var o = shots[j]; if (!!o.sighter === !!q.sighter && o.t && sec(o.t) != null) return sec(o.t); } return null; };
      var a = nb(-1), b = nb(1); if (a == null || b == null) return;
      var span = P.gapSec(a, b); if (span == null || span > 900) return; // 前後兩發本身要接得上（15 分鐘內）
      var inside = function (v) { var g1 = P.gapSec(a, v), g2 = P.gapSec(v, b); return g1 != null && g2 != null && Math.abs(g1 + g2 - span) < 0.02; };
      if (inside(s)) return;
      var mm = Math.floor(s / 60), rest = s - mm * 60; if (mm >= 10) return; // 只處理分鐘只有一位數（十位數可能漏讀）
      var raw = (q.ocr.rd || []).map(function (d) { return d.raw || ''; }).join('\n'), ss = q.t.slice(3);
      if (!new RegExp('(^|[^\\d])' + mm + '\\s*[:;.]?\\s*' + ss.slice(0, 2) + '\\s*[.,]\\s*' + ss.slice(3, 5)).test(raw)) return; // OCR 原文真的是一位數分鐘
      var hit = [];
      for (var tn = 1; tn <= 5; tn++) { var v = (tn * 10 + mm) * 60 + rest; if (inside(v)) hit.push(tn * 10 + mm); }
      if (hit.length !== 1) return;
      q.ocr.tFix = { from: q.t }; q.t = (hit[0] < 10 ? '0' : '') + hit[0] + q.t.slice(2);
      q.ocr.conflict = (q.ocr.conflict || []).filter(function (c) { return c !== 't'; });
    });
  }
  function fits(T, q, x, y, inner) { var C = C0(), sc = C.scoreShot(T, x, y), v = q.decInt ? sc.ring : sc.dec; if (Math.round(v * 10) !== Math.round(q.dec * 10)) return false; return !(inner && q.dec >= 10 && !!q.inner !== sc.inner); }
  function decFill(model) {
    var C = C0(), T = C.TARGETS[model.targetId] || C.TARGETS.ar10, shots = model.shots, pis = !!model.intSheet;
    shots.forEach(function (q) { // decCalc：分數空白、座標完整
      if (q.ed || (q.dec != null && !q.decCalc) || q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y)) return;
      var sc = C.scoreShot(T, q.x, q.y); q.dec = pis || q.decInt ? sc.ring : sc.dec; q.inner = sc.inner; q.decCalc = 1; if (pis) q.decInt = true;
    });
    var M = shots.filter(function (q) { return !q.sighter; });
    for (var k = 0; k * 10 < M.length; k++) { // decSub：一組只缺一發分數
      var part = M.slice(k * 10, k * 10 + 10), pr = (model.subs || [])[k]; if (!pr || part.length !== 10 || pr.dec == null) continue;
      var no = part.filter(function (q) { return q.dec == null || !isFinite(q.dec) || (q.decSub && !q.ed); }); if (no.length !== 1 || no[0].ed) continue;
      var sum = 0, inn = 0; part.forEach(function (q) { if (q !== no[0]) { sum += Math.round(q.dec * 10); inn += q.inner ? 1 : 0; } });
      var v = (Math.round(pr.dec * 10) - sum) / 10, vi = pr.inner != null ? pr.inner - inn : null;
      var okv = pis ? v >= 0 && v <= 10 && Math.abs(v - Math.round(v)) < 1e-9 : v >= 0 && v <= 10.9;
      if (!okv || (vi != null && (vi < 0 || vi > 1)) || (vi === 1 && v < 10)) continue;
      var q0 = no[0]; q0.dec = v; q0.inner = vi === 1; q0.decSub = 1; if (pis) q0.decInt = true;
      if (q0.ocr) q0.ocr.missing = false;
    }
  }
  function xyRepair(model) {
    var C = C0(), A = AR(), T = C.TARGETS[model.targetId] || C.TARGETS.ar10;
    model.shots.forEach(function (q) {
      var o = q.ocr; if (!o || q.ed || o.rpXY || q.dec == null || q.decCalc || q.x == null || q.y == null) return; o.rpXY = 1;
      if (fits(T, q, q.x, q.y, false)) return;
      var ad = A && A.sure(o.arw) ? o.arw.dir : null, hit = {}, add = function (x, y) { if (Math.abs(x) > 80 || Math.abs(y) > 80) return; if (!fits(T, q, x, y, true)) return; if (ad && !A.compat(x, y, ad)) return; hit[x.toFixed(2) + ',' + y.toFixed(2)] = { x: x, y: y }; };
      var xs = [q.x].concat(o.alt && o.alt.x || []), ys = [q.y].concat(o.alt && o.alt.y || []);
      xs.forEach(function (x) { ys.forEach(function (y) { if (x !== q.x || y !== q.y) add(x, y); }); }); // OCR 其他讀法
      var ex = digitEdits(q.x), ey = digitEdits(q.y);
      for (var tier = 1; tier <= 3 && !Object.keys(hit).length; tier++) { // 從最常見的誤讀開始找；同一層有兩種以上改法＝分不出來
        ex.forEach(function (e) { if (e.t === tier) add(e.v, q.y); }); ey.forEach(function (e) { if (e.t === tier) add(q.x, e.v); });
      }
      var ks = Object.keys(hit); if (ks.length !== 1) { o.scoreWins = 1; return; }
      var h = hit[ks[0]]; o.xyFix = { from: { x: q.x, y: q.y } }; q.x = h.x; q.y = h.y; o.xyPick = 1;
      o.alt = { x: [q.x], y: [q.y], dec: o.alt && o.alt.dec }; o.conflict = (o.conflict || []).filter(function (c) { return c !== 'x' && c !== 'y'; });
    });
  }
  // 只有一軸座標：依分數的環（半徑範圍）＋箭頭方向推另一軸 → 只拿來在靶面畫虛線「推估」孔，不當讀到的值、不進分析
  function guessXY(model, q) {
    var C = C0(), A = AR(), T = C.TARGETS[model.targetId] || C.TARGETS.ar10; if (!C || q.dec == null || (q.x == null) === (q.y == null)) return null;
    var dir = q.ocr && A && A.sure(q.ocr.arw) ? q.ocr.arw.dir : null; if (!dir) return null;
    var k = A.DIRS.indexOf(dir), sx = [1, 1, 0, -1, -1, -1, 0, 1][k], sy = [0, 1, 1, 1, 0, -1, -1, -1][k];
    var lo = null, hi = null; for (var d = 0; d <= T.cardSize / 2; d += 0.05) { var sc = C.scoreShot(T, d, 0), v = q.decInt ? sc.ring : sc.dec; if (Math.round(v * 10) === Math.round(q.dec * 10)) { if (lo == null) lo = d; hi = d; } }
    if (lo == null) return null; var r = (lo + hi) / 2, a = q.x != null ? q.x : q.y, s2 = r * r - a * a; if (s2 < 0) return null;
    var b = Math.sqrt(s2), sg = q.x != null ? sy : sx; if (!sg) return null;
    return q.x != null ? { x: q.x, y: sg * b, est: 'y' } : { x: sg * b, y: q.y, est: 'x' };
  }
  function check(model, opt) { stampInt(model); arrowFix(model); xyPick(model); tFix(model); decFill(model); xyRepair(model); decFill(model); hours(model); var ck = X().check(model); return rules(model, ck, opt); }
  // 紅燈（要改完才能存）：紅燈的列、對不上的小計／總分
  function blocking(ck) { return ck ? ck.bad : 0; }
  function needFallback(model, ck) { return ck.rows.some(function (r) { return r.status === 'bad' || r.orange || r.missing || r.soft; }); }
  /* 備援補列：主模型裡紅燈／沒讀到的列，現有引擎有讀到而且自己核對不是紅燈 → 用它的值（標 fb；v3.0.1 起對得上就可以綠燈）。
   * 對應方式：試射／比賽＋發序相同；同一發序有好幾發時挑時間最接近的。回傳補了幾列。 */
  function fill(model, fbModel, opt) {
    if (!fbModel || !fbModel.shots || !fbModel.shots.length) return 0;
    var ck = check(model, opt), fck = S0().check(fbModel), fst = {}, n = 0, used = {};
    fck.rows.forEach(function (r) { fst[r.i] = r.status; });
    var sec = X().secOf, multi = model.shots.some(function (q) { return q.blk; }) || fbModel.shots.some(function (f) { return f.blk; }); // 序號有重編（好幾組）才要求時間接近
    ck.rows.forEach(function (r) {
      if (!(r.status === 'bad' || r.orange || r.missing || r.soft || model.shots[r.i].decSub || model.shots[r.i].decCalc || (r.why || []).indexOf('xyFix') >= 0 || (model.shots[r.i].ocr || {}).scoreWins)) return; // v3.1.0：推出來的值（小計反推／依分數修座標）備援讀到真的就換掉
      var q = model.shots[r.i], best = -1, bd = 1e9;
      fbModel.shots.forEach(function (f, j) {
        // v3.0.3：比對印的序號（pn）；序號會重編（一組一組）所以時間要接近（有時間時 ≤ 90 秒）；練習單不比試射／正式
        if (used[j] || (!model.practice && !!f.sighter !== !!q.sighter) || (f.pn != null ? f.pn : f.n) !== (q.pn != null ? q.pn : q.n) || fst[j] === 'bad') return;
        if (f.dec == null || f.x == null || f.y == null || !f.t) return;
        var a = sec(q.t), b = sec(f.t), d = a == null || b == null ? 0 : Math.min(Math.abs(a - b), 3600 - Math.abs(a - b));
        if (multi && a != null && b != null && d > 90) return;
        if (multi && (a == null || b == null) && (f.blk || 0) !== (q.blk || 0)) return; // Gemini 審查：沒有時間時不能補別組同號的發
        if (d < bd) { bd = d; best = j; }
      });
      if (best < 0) return;
      var f = fbModel.shots[best]; used[best] = 1;
      q.dec = f.dec; q.inner = !!f.inner; q.t = f.t; q.x = f.x; q.y = f.y; q.fb = true; q.decCalc = 0; q.decSub = 0; q.fbSt = fst[best]; if (f.decInt || model.intSheet) q.decInt = true; // v3.0.1：補列也走整數比對
      q.ocr = q.ocr || {}; q.ocr.missing = false; q.ocr.conflict = []; q.ocr.alt = null; q.ocr.w = { x: 9, y: 9, d: 9, t: 9 }; q.ocr.reads = Math.max(q.ocr.reads || 0, 2); q.ocr.fbFrom = 'main';
      q.ocr.arrowDone = 0; q.ocr.arrowBad = null; q.ocr.arrowFix = null; q.ocr.xyPick = 0; q.ocr.rpT = 0; q.ocr.rpXY = 0; q.ocr.tFix = null; q.ocr.xyFix = null; q.ocr.scoreWins = 0; // v3.0.3：補上來的值重新核對箭頭（箭頭用主引擎讀到的；主引擎沒讀到就用備援的）
      if (!(AR() && AR().sure(q.ocr.arw)) && f.ocr && f.ocr.arw) q.ocr.arw = f.ocr.arw;
      // v3.0.3：備援自己的讀法 X/Y 就不一致（例：Y 一次 1.26、一次 7.26，兩個分數都對）→ 帶著它的其他讀法，用分數＋箭頭挑；挑不出來就是黃燈（不給綠）
      var fc = (f.ocr && f.ocr.conflict || []).filter(function (c) { return c === 'x' || c === 'y'; });
      if (fc.length && f.ocr.alt) { q.ocr.alt = { x: (f.ocr.alt.x || []).slice(), y: (f.ocr.alt.y || []).slice(), dec: (f.ocr.alt.dec || []).slice() }; q.ocr.conflict = fc.slice(); }
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
  /* v3.1.0（White 2026-11-27 指定）：多張照片（同一張拍好幾次、或整張＋分段）→ 一張一張讀：
   *   第 1 張完整讀；讀完全部綠燈（沒有黃／紅、小計都對）→ 後面的照片直接跳過（省時間）；
   *   不然第 2 張起只用快速讀法（一種切法），再把「還沒綠的發」那幾行放大補讀，讀法全部一起投票。
   *   opt.prior：之前已經讀好的讀法（同一張單又加照片）→ 新照片都走快速＋補讀。 */
  function focusOf(passes, mopt) {
    var m = X().merge(passes, mopt), ck = check(m), f = {}, n = 0;
    ck.rows.forEach(function (r) { if (r.status !== 'ok') { var q = m.shots[r.i], k = q.pn != null ? q.pn : q.n; if (k != null) { f[k] = 1; n++; } } });
    var allOk = !n && !ck.bad && !ck.series.some(function (x) { return x.status === 'bad'; }) && ck.rows.length > 0 && !!(m.total || m.practice); // 要讀到總分（或是練習單）才算整張讀完：分段拍的後半張不能跳過
    var miss = ck.rows.filter(function (r) { return r.missing; }).length;
    // 還有整行沒讀到（例如這張只拍到前半段）或沒綠的太多 → 下一張照片要完整讀，不能只補讀
    var light = !miss && n <= Math.max(6, ck.rows.length * 0.3);
    return { focus: f, n: n, allOk: allOk, light: light, m: m, ck: ck };
  }
  function run(files, opt) {
    opt = opt || {};
    var XE = root.WRSiusX, OCR = root.WRSiusOCR, t0 = now(), T = { m6b: null, merge: 0, check: 0, fallback: 0, fbRun: false, total: 0, skipped: 0 };
    var prog = opt.onProgress || function () {}, nf = files.length, prior = opt.prior || [], all = [], info = null;
    var lg = function (k, v) { T[k] = v; if (opt.log) try { opt.log(k, v); } catch (e) {} };
    var mopt = { targetId: opt.targetId }, base = opt.imgBase || 0, sumT = null;
    var addT = function (t) { if (!t) return; if (!sumT) { sumT = JSON.parse(JSON.stringify(t)); return; } for (var k in t) if (typeof t[k] === 'number') sumT[k] = (sumT[k] || 0) + t[k]; };
    function one(i) {
      if (i >= nf || (opt.cancelled && opt.cancelled())) return Promise.resolve();
      var have = prior.concat(all), light = false, fo = null;
      if (have.length) { try { fo = focusOf(have, mopt); } catch (e) { fo = null; } if (fo && fo.allOk) { T.skipped = nf - i; return Promise.resolve(); } light = !!(fo && fo.light); } // 已經全綠：後面的照片不用讀
      var lo = i / nf, hi = (i + 1) / nf;
      return XE.run([files[i]], { imgBase: base + i, targetId: opt.targetId, cancelled: opt.cancelled, light: light, focus: light && fo ? fo.focus : null, basePasses: light ? have : null, onProgress: function (p, ph) { prog((lo + (hi - lo) * p) * 0.8, ph); } }).then(function (r) {
        all = all.concat(r.passes || []); addT(r.timing); if (!info) info = r.info; else if (r.info && r.info.images) info.images = (info.images || []).concat(r.info.images);
        return one(i + 1);
      });
    }
    return one(0).then(function () {
      lg('m6b', sumT);
      var ta = now(), m = X().merge(prior.concat(all), mopt), tb = now(), ck = check(m), tc = now();
      lg('merge', Math.round(tb - ta)); lg('check', Math.round(tc - tb));
      if (!OCR || !needFallback(m, ck) || (opt.cancelled && opt.cancelled())) { lg('total', Math.round(now() - t0)); return { passes: all, fbPasses: [], timing: T, info: info }; }
      var td = now(); T.fbRun = true; prog(0.8, 'fallback');
      var fbFiles = T.skipped ? files.slice(0, nf - T.skipped) : files; // 跳過的照片備援也不讀
      return OCR.run(fbFiles, { imgBase: base, cancelled: opt.cancelled, onProgress: function (p) { prog(0.8 + p * 0.19, 'fallback'); }, more: function (np) { try { var S = S0(), ck2 = S.check(S.merge(np, {})); return ck2.bad > 0 || ck2.rows.some(function (x) { return x.missing; }); } catch (e) { return false; } } }).then(function (r2) {
        try { OCR.stop(); } catch (e) {}
        lg('fallback', Math.round(now() - td)); lg('total', Math.round(now() - t0));
        return { passes: all, fbPasses: r2.passes || [], timing: T, info: info };
      });
    });
  }
  function stop() { try { if (root.WRSiusX) root.WRSiusX.stop(); } catch (e) {} try { if (root.WRSiusOCR) root.WRSiusOCR.stop(); } catch (e) {} }
  var api = { RULES: RULES, tFix: tFix, decFill: decFill, xyRepair: xyRepair, guessXY: guessXY, digitEdits: digitEdits, intSheet: intSheet, rules: rules, check: check, arrowFix: arrowFix, hours: hours, swap17: swap17, blocking: blocking, needFallback: needFallback, fill: fill, build: build, run: run, stop: stop, key: key,
    problems: function (m, ck) { return X().problems(m, ck || check(m)); } };
  if (isNode) module.exports = api; else root.WRSiusV3 = api;
})(typeof window !== 'undefined' ? window : this);
