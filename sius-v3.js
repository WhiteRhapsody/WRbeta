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
  var RULES = { consist: 1, lenient: 1, dupTime: 1, sighterReads: 2, subGuard: 'two', fieldW: 2, fields: ['x', 'y'], xyUnanimous: 1, innerGuard: 0, signFlip: 1, fbCap: 0, arrow: 1, pp: 1 };
  function key(q) { return (q.sighter ? 'Q' : 'M') + q.n; }
  function down(r, why) { if (r._ed) return; r.why = r.why || []; if (r.status === 'ok') r.status = 'near'; else if (r.status !== 'near') return; if (r.why.indexOf(why) < 0) r.why.push(why); } // v3.2.0：每個原因都記（以前只記第一個）
  var CONS_OK = /^(fieldW:[xy]+|xyAlt|sign:[xy]|sReads|arrowFix|ppConf)$/; // v3.2.0 ppConf＝原引擎照片之間讀得不一樣，但 Paddle 讀到的跟目前值一樣 // v3.1.2：只代表「OCR 沒把握」的黃燈原因（arrow＝箭頭跟座標對不上，不在內）
  var TIME_W = /^(dupT|tFix|notime)$/; // v3.1.3：只跟時間有關的黃燈原因
  function flip(a, b) { return a != null && b != null && a !== 0 && Math.abs(a + b) < 1e-9; }
  // check 之後的規則（只降綠）
  function rules(model, ck, opt) {
    opt = opt || RULES; var rows = ck.rows, shots = model.shots;
    rows.forEach(function (r) { if (shots[r.i] && shots[r.i].ed) r._ed = 1; });
    // v3.2.0：Paddle 也讀到同一個值（o.ppOk）的欄位，原引擎照片之間的衝突不算（rv1127_230254 試#3、#40、#45 誤報）
    rows.forEach(function (r) { var o = shots[r.i] && shots[r.i].ocr; if (!o || !o.ppOk || r._ed || !r.conflict || !r.conflict.length) return;
      var n0 = r.conflict.length; r.conflict = r.conflict.filter(function (c) { return !o.ppOk[c]; });
      if (r.conflict.length < n0 && r.status === 'near') (r.why = r.why || []).push('ppConf'); }); // 使用者親手改過（或確認過）的發：規則不再降成黃燈
    if (opt.dupTime) { var m = {}; rows.forEach(function (r) { var t = shots[r.i].t; if (t) (m[t] = m[t] || []).push(r); }); Object.keys(m).forEach(function (t) { if (m[t].length > 1) m[t].forEach(function (r) { down(r, 'dupT'); }); }); }
    if (opt.sighterReads) rows.forEach(function (r) { var q = shots[r.i]; if (q.sighter && q.ocr && q.ocr.reads < opt.sighterReads) down(r, 'sReads'); });
    if (opt.fieldW) rows.forEach(function (r) { var q = shots[r.i], w = q.ocr && q.ocr.w; if (!w) return; var f = opt.fields.filter(function (k) { return w[k] < opt.fieldW; }); if (f.length) down(r, 'fieldW:' + f.join('')); });
    // v3.2.0（White 2026-11-28）：拿掉「小計對得上，抽查讀到最少次的 2 發」（sub）。改成：單子印的小計跟這組加總真的對不上 → 這組每一發都黃（subBad）
    if (opt.subGuard) ck.series.forEach(function (s) {
      if (s.status !== 'bad' || !s.printed) return;
      s.rows.forEach(function (i) { var r = rows.filter(function (x) { return x.i === i; })[0]; if (r && r.status !== 'bad') down(r, 'subBad'); });
    });
    // v3.2.0：原引擎整行抄別行（兩發 X、Y 一模一樣）→ 兩發都黃（dupRow）；混合引擎能用 Paddle 換掉的在 hybrid() 已經換掉
    if (opt.dupRow !== 0) { var dm = {}; rows.forEach(function (r) { var q = shots[r.i]; if (!q || q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y)) return; var k = q.x.toFixed(2) + '|' + q.y.toFixed(2); (dm[k] = dm[k] || []).push(r); });
      Object.keys(dm).forEach(function (k) { if (dm[k].length > 1) dm[k].forEach(function (r) { down(r, 'dupRow'); }); }); }
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
    // v3.2.0：很多發「分數跟座標差 ≥0.2」＝多半是靶種選錯（例：步槍單用手槍靶面算）→ 這些發維持紅燈（tgMis），不放寬成黃燈
    var nMisR = rows.filter(function (r) { var q = shots[r.i]; return r.status === 'bad' && q && q.dec != null && q.x != null && q.y != null && r.diff != null && r.diff >= 0.2; }).length;
    var tgMis = nMisR > Math.max(2, Math.floor(rows.length * 0.08)); ck.tgMis = tgMis ? nMisR : 0;
    if (opt.lenient) rows.forEach(function (r) {
      var q = shots[r.i], o = q.ocr || {};
      if (o.tFix) down(r, 'tFix');
      if (o.xyFix) { if (r.status === 'ok') r.status = 'near'; r.orange = false; (r.why = r.why || []).push('xyFix'); }
      if (o.decXY) { if (r.status === 'ok') r.status = 'near'; r.orange = false; (r.why = r.why || []).push('decXY'); }
      if (q.decSub) { r.status = 'near'; (r.why = r.why || []).push('decSub'); }
      if (q.decCalc) { var sr = ck.series.filter(function (s) { return s.rows.indexOf(r.i) >= 0; })[0]; if (!sr || sr.status !== 'ok') down(r, 'decCalc'); }
      if (r.status !== 'bad' || q.dec == null || !isFinite(q.dec)) return;
      var Rd = o.rd || [], weak = Rd.length === 1 && (Rd[0].kind === 'col' || (Rd[0].rawW != null ? Rd[0].rawW : Rd[0].w) < 1);
      if (weak && !q.decSub && !q.ed) return; // 只有一次很弱的讀法：分數本身沒把握 → 維持紅燈
      var noxy = q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y);
      if (tgMis && !noxy && r.diff != null && r.diff >= 0.2 && !q.ed) { (r.why = r.why || []).push('tgMis'); return; }
      r.status = 'near'; r.soft = 1; (r.why = r.why || []).push(noxy ? 'noxy' : (r.diff != null && r.diff >= 0.2) ? 'scoreWins' : (r.miss || []).indexOf('t') >= 0 ? 'notime' : 'soft');
      if (!noxy && r.diff != null && r.diff >= 0.2) r.orange = true;
    });
    // v3.1.2（White 2026-11-27 20:22）最後一道一致性檢查：只因 OCR 把握不足而黃（票數不一、X/Y 備選、正負號備選、箭頭、試射讀次少、soft），
    //   但分數＝座標重算（diff 0、內十相符）、時間在（同段前後接得上、不重複、不缺）、沒衝突欄位 → 降回綠燈，原本的原因留在 r.cons。
    //   （v3.1.3 起時間條件拿掉、併進下面的時間記號那段）時間不接續／重複／缺時間、分數座標不符、缺座標、單軸推估、補回的時間（tFix）、依分數改座標（xyFix）、小計反推／算出的分數、小計對不上（sub）都維持原燈號。
    // v3.1.3（White 2026-11-27 20:46 hotfix）：時間的問題（接不上 tWarn、重複 dupT、缺時間、補回的時間 tFix、時間讀法不一）一律不影響燈號，
    //   只在時間欄打記號（r.tMark＝時間原因代碼，存檔／上傳照樣帶）。燈號只看分數、座標、正負號、箭頭、小計等其他條件。
    if (opt.tMark !== 0 || opt.consist) {
      var tcnt = {}, tsec = function (q) { var v = q && q.t ? X().secOf(q.t) : null; return v == null ? null : Math.round(v * 100); };
      shots.forEach(function (q) { var k = tsec(q); if (k != null) tcnt[k] = (tcnt[k] || 0) + 1; });
      rows.forEach(function (r) {
        var q = shots[r.i]; if (!q) return; var o = q.ocr || {}, tm = [];
        if (r.tWarn) tm.push('tWarn'); if ((r.miss || []).indexOf('t') >= 0 || !q.t || tsec(q) == null) tm.push('miss:t');
        if ((r.conflict || []).indexOf('t') >= 0) tm.push('conflict:t'); if (tsec(q) != null && tcnt[tsec(q)] > 1) tm.push('dupT'); if (o.tFix) tm.push('tFix');
        (r.why || []).forEach(function (c) { if (c === 'notime') c = 'miss:t'; if (TIME_W.test(c) || c === 'miss:t') { if (tm.indexOf(c) < 0) tm.push(c); } });
        if (opt.tMark === 0) tm = []; // 關掉時間記號＝時間照舊影響燈號
        r.tMark = tm.length ? tm : null;
        r.why = (r.why || []).filter(function (c) { return !tm.length || !TIME_W.test(c); });
        if (r.status === 'ok' || !tm.length && !(opt.consist && r.why.length)) return;
        // 剩下的（非時間）原因：沒有＝只因時間而亮；只剩「OCR 沒把握」那幾種＝要通過一致性檢查（v3.1.2）
        if (r.status !== 'near' || r.orange || r.missing) return;
        if (r.soft && !tm.length) return; // soft＝原本紅燈被放寬成黃：只有跟時間有關才可能降綠（其餘照 v3.1.2 不降）
        var w = r.why;
        if (w.length && !(opt.consist && w.every(function (c) { return CONS_OK.test(c) || c === 'soft'; }))) return;
        if ((r.conflict || []).some(function (c) { return c !== 't' || !tm.length; }) || (r.miss || []).some(function (c) { return c !== 't' || !tm.length; }) || r.innerOk === false || r.tWarn && !tm.length) return;
        if (q.dec == null || !isFinite(q.dec) || q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y)) return;
        if (!r.calc || r.diff !== 0 || q.decCalc || q.decSub || o.xyFix || o.decXY || o.scoreWins || o.demo || o.miss || o.arrowBad) return;
        if (ck.series.some(function (sr) { return sr.status !== 'ok' && sr.status !== 'nosub' && sr.rows.indexOf(r.i) >= 0; })) return;
        var A0 = AR(); if (A0 && o.arw && A0.sure(o.arw) && !A0.compat(q.x, q.y, o.arw.dir)) return; // 箭頭有把握卻跟 X/Y 不同方向
        // down() 只記第一個原因，所以自己重查正負號備選：換號分數不變，要方向箭頭確定且同方向才算對得上
        var sg = !o.xyPick && ['x', 'y'].some(function (f) { var vals = [].concat(o.alt && o.alt[f] || []); (o.rd || []).forEach(function (d) { if (d[f] != null) vals.push(d[f]); }); return vals.some(function (v) { return flip(v, q[f]); }); });
        if ((sg || w.some(function (c) { return /^sign:/.test(c); })) && !(A0 && o.arw && A0.sure(o.arw) && A0.compat(q.x, q.y, o.arw.dir))) return;
        var cw = w.filter(function (c) { return c !== 'soft'; }); r.status = 'ok'; r.soft = 0; if (cw.length) r.cons = cw; r.why = [];
      });
    }
    // v3.1.4 混合引擎：原引擎跟 Paddle 讀到的值不一樣 → 一定黃燈（就算上面一致性檢查已經降回綠）；時間用了 Paddle 的 → 時間記號 ppT（不影響燈號）
    if (opt.pp !== 0) rows.forEach(function (r) {
      var q = shots[r.i], o = q && q.ocr; if (!o || r._ed) return;
      if (o.ppT && opt.tMark !== 0) { r.tMark = (r.tMark || []).concat(r.tMark && r.tMark.indexOf('ppT') >= 0 ? [] : ['ppT']); }
      if (!o.ppDiff || !o.ppDiff.length) return;
      // v3.2.0（White 2026-11-28）：一邊沒讀到、另一邊讀到而且分數座標對得上（ppFill）；小數不一樣、用 Paddle 的而且對得上（ppDec）；
      //   分數不一樣但 Paddle 的分數跟座標對不上、原引擎的對得上（ppD）→ 不因為兩套不一樣而亮黃，只打小記號（r.ppMark）
      if (o.ppGreen && o.ppGreen.length) {
        r.ppMark = o.ppGreen.slice();
        // 補進來的欄位只有 Paddle 一次讀法 → 原本會因為「這一欄讀法太少」（fieldW）亮黃；需求 2b：一邊沒讀到、另一邊讀到又對得上＝綠＋◆
        var fk = o.ppFillK || []; if (r.status === 'near' && fk.length && !r.orange && !r.missing && (r.why || []).length && r.why.every(function (c) { var m = /^fieldW:([dxy]+)$/.exec(c); return !!m && m[1].split('').every(function (f) { return fk.indexOf(f) >= 0; }); })) { r.status = 'ok'; r.why = []; }
        return;
      }
      var code = 'ocrDiff:' + o.ppDiff.join(''); r.why = (r.why || []).filter(function (c) { return !/^ocrDiff:/.test(c); }); r.why.unshift(code);
      if (r.status === 'ok') { r.status = 'near'; r.cons = null; }
      else if (r.status === 'bad' && o.ppAlt && o.ppAlt.ok && q.dec != null && isFinite(q.dec) && q.x != null && q.y != null) { r.status = 'near'; r.soft = 1; } // 只有「用了 Paddle 的值之後分數、座標重算對得上」的紅才降黃（Gemini 審查：不可一律降）
    });
    // v3.0.2（White 2026-11-27）：逐發編輯按「保存」＝當綠燈
    rows.forEach(function (r) { if (shots[r.i] && shots[r.i].okd) { r.status = 'ok'; r.orange = false; r.why = []; r.cons = null; } });
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
    // v3.2.0（換槍種不殘留）：上一次蓋上去的 decInt（decIntS）先拿掉再重算，換回步槍時不會因為自己蓋的章一直被當成整數單
    model.shots.forEach(function (q) { if (q.decIntS) { delete q.decInt; delete q.decIntS; } });
    var on = intSheet(model); model.intSheet = on;
    if (on) model.shots.forEach(function (q) { if ((q.dec == null || !isFinite(q.dec) || Math.abs(q.dec - Math.round(q.dec)) < 1e-9) && !q.decInt) { q.decInt = true; q.decIntS = 1; } });
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
  function solidF(o, k, v) { // 這一欄有把握：票數 ≥2、沒有衝突；有備選讀法時，跟目前值一樣的讀法要 ≥2 次而且至少是其他讀法的 2 倍
    var w = o.w || {}, wk = k === 'dec' ? 'd' : k; if ((w[wk] || 0) < 2 || (o.conflict || []).indexOf(k) >= 0) return false;
    if (!(o.alt && o.alt[k] && o.alt[k].length > 1)) return true;
    var rk = k === 'dec' ? 'd' : k, a = 0, b = 0; (o.rd || []).forEach(function (d) { if (d[rk] == null) return; if (v != null && Math.abs(d[rk] - v) < 0.005) a++; else b++; });
    return a >= 2 && a >= 2 * b;
  }
  function ringMargin(T, x, y, dec, decInt) { // 落點往內、往外各移 0.25 mm 分數都不變（不是壓線）；靠近中心時往內最多移到中心（審查建議：拿掉 r<0.3 一律算安全）
    var C = C0(), r = Math.sqrt(x * x + y * y), ok = true;
    [-0.25, 0.25].forEach(function (e) { var r2 = Math.max(0, r + e), px = r > 1e-9 ? x * r2 / r : r2, py = r > 1e-9 ? y * r2 / r : 0, sc = C.scoreShot(T, px, py), v = decInt ? sc.ring : sc.dec; if (Math.round(v * 10) !== Math.round(dec * 10)) ok = false; });
    [-0.01, 0.01].forEach(function (e) { var r2 = Math.max(0, r + e), px = r > 1e-9 ? x * r2 / r : r2, py = r > 1e-9 ? y * r2 / r : 0; if (!!C.scoreShot(T, px, py).inner !== !!C.scoreShot(T, x, y).inner) ok = false; }); // 內十線：座標印到 0.01 mm，±0.1 mm 內不能跨過內十線（Carbon 審查）
    return ok ? 1 : 0; }
  function misread(a, b, decInt) { // 單上分數 a、座標算的 b：差 1 環（只限整數計分；Carbon 審查）或只差一個常見誤讀的數字
    if (a == null || b == null) return false; if (decInt && Math.abs(a - b) <= 1.0001) return true;
    var sa = String(a), sb = String(b); if (sa.length !== sb.length) return false; var d = 0, okc = true;
    for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) { d++; if (!CONF[sa[i]] || CONF[sa[i]].indexOf(sb[i]) < 0) okc = false; }
    return d === 1 && okc;
  }
  function decByXY(T, q, o, sc0, rc) {
    if (q.decSub || q.decCalc || !o) return false;
    if (!solidF(o, 'x', q.x) || !solidF(o, 'y', q.y)) return false;
    var rd = (o.rd || []).filter(function (d) { return d.d != null; }), dWeak = !solidF(o, 'dec', q.dec) || rd.length < 2 || (o.alt && o.alt.dec && o.alt.dec.indexOf(rc) >= 0);
    if (!dWeak) return false;
    if (!ringMargin(T, q.x, q.y, rc, q.decInt)) return false;
    var A = AR(); if (A && A.sure(o.arw) && !A.compat(q.x, q.y, o.arw.dir)) return false;
    return misread(q.dec, rc, q.decInt);
  }
  function xyRepair(model) {
    var C = C0(), A = AR(), T = C.TARGETS[model.targetId] || C.TARGETS.ar10;
    // 很多發都對不上＝多半是靶種選錯（例：步槍單用手槍靶面算），不是個別讀錯 → 不用座標改分數（decXY），照舊標出來
    var nHas = 0, nMis = 0; model.shots.forEach(function (q) { if (q.dec == null || q.x == null || q.y == null || q.decCalc) return; nHas++; if (!fits(T, q, q.x, q.y, false)) nMis++; });
    var xyOk = nMis <= Math.max(2, Math.floor(nHas * 0.08));
    // v3.2.0（Carbon 審查）：換靶種 → 上一個靶種做的座標／分數修正還原、重新判斷（不殘留 rpXY／scoreWins／xyFix／decXY）
    model.shots.forEach(function (q) {
      var o = q.ocr; if (!o || q.ed || !o.rpTg || o.rpTg === model.targetId) return;
      if (o.xyFix && o.xyFix.from) { q.x = o.xyFix.from.x; q.y = o.xyFix.from.y; o.xyFix = null; }
      if (o.decXY) { q.dec = o.decXY.from; q.inner = !!o.decXY.inner; o.decXY = null; }
      if (!o.ppDone || o.pp == null) o.rpXY = 0; o.scoreWins = 0; o.rpTg = null;
    });
    model.shots.forEach(function (q) {
      var o = q.ocr; if (!o || q.ed || o.rpXY || q.dec == null || q.decCalc || q.x == null || q.y == null) return; o.rpXY = 1; o.rpTg = model.targetId;
      if (fits(T, q, q.x, q.y, false)) return;
      if (!xyOk) { o.scoreWins = 1; return; } // 很多發對不上（靶種多半選錯）→ 座標也不改（Carbon 審查）
      // v3.2.0（White 2026-11-28；11/13 試#11 正解 9P、-3.82／8.63，單上讀成 8）：分數跟座標對不上時不再一律以分數為準，用環距判斷哪一欄比較可信：
      //   座標兩軸都有 ≥2 次讀法支持、沒有備選／衝突，落點離環線 ≥0.25 mm（不是壓線），分數卻只有一種弱讀法或有備選，
      //   而且「單上分數 → 座標算出的環」是常見誤讀（8↔9、3↔8…或差 1 環）→ 座標比較可信：分數改成座標算的（黃燈 decXY，原本的分數留在 o.decXY.from）
      //   （先試「座標只錯一個常見數字」的修法；修不出唯一一組才考慮分數讀錯，所以 rv1127 試#64 的 Y 17.42→7.42 照舊修座標）
      var sc0 = C.scoreShot(T, q.x, q.y), rc = q.decInt ? sc0.ring : sc0.dec;
      var ad = A && A.sure(o.arw) ? o.arw.dir : null, hit = {}, add = function (x, y) { if (Math.abs(x) > 80 || Math.abs(y) > 80) return; if (!fits(T, q, x, y, true)) return; if (ad && !A.compat(x, y, ad)) return; hit[x.toFixed(2) + ',' + y.toFixed(2)] = { x: x, y: y }; };
      var xs = [q.x].concat(o.alt && o.alt.x || []), ys = [q.y].concat(o.alt && o.alt.y || []);
      xs.forEach(function (x) { ys.forEach(function (y) { if (x !== q.x || y !== q.y) add(x, y); }); }); // OCR 其他讀法
      var ex = digitEdits(q.x), ey = digitEdits(q.y);
      for (var tier = 1; tier <= 3 && !Object.keys(hit).length; tier++) { // 從最常見的誤讀開始找；同一層有兩種以上改法＝分不出來
        ex.forEach(function (e) { if (e.t === tier) add(e.v, q.y); }); ey.forEach(function (e) { if (e.t === tier) add(q.x, e.v); });
      }
      var ks = Object.keys(hit); if (ks.length !== 1) { if (xyOk && decByXY(T, q, o, sc0, rc)) { o.decXY = { from: q.dec, inner: !!q.inner }; q.dec = rc; q.inner = !!sc0.inner; return; } o.scoreWins = 1; return; }
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
  /* v3.1.4 混合引擎（White 2026-11-27 21:09「hotfix it」）：PaddleOCR（sius-pp.js，整行讀）當第二雙眼睛。
   *   逐發比對原引擎跟 Paddle 的分數（含內十）、X、Y：一致＝不動（原本的規則照舊決定燈號）；不一致＝這發黃燈（原因 ocrDiff:d／x／y），
   *   畫面顯示「用哪個值」：分數＝座標重算的組合優先（對得上的才採用）→ 箭頭方向對得上 → Paddle 的值（整行讀，比較不會整列抄到別列）。
   *   Paddle 常漏 Y（也會漏 X）的負號：原引擎是負、Paddle 是正 → 多一個「Paddle 數字＋原引擎負號」的選項。
   *   Paddle 沒讀到這一發（或某一欄）＝沒有證據，照原引擎；原引擎沒讀到的欄位 → 用 Paddle 補（黃燈）。使用者改過的發不動。 */
  var PPF = ['d', 'x', 'y'], PPSELF = 1;
  function ti(v) { return v < 0 ? Math.ceil(v) : Math.floor(v); } // ES5（沒有 Math.trunc）
  function ppKey(q) { return q.pn != null ? q.pn : q.n; }
  function near1(a, b) { var s1 = Math.abs(a).toFixed(2), s2 = Math.abs(b).toFixed(2); if (s1 === s2) return true; if (s1.length !== s2.length) return false; var d = 0; for (var i = 0; i < s1.length; i++) if (s1[i] !== s2[i]) d++; return d <= 1; }
  // v3.2.0：Paddle（另一套辨識）讀到的值跟最後用的值一樣、分數座標也對得上 → 原引擎兩張照片之間的不一致（conflict／備選讀法）算解決了
  function ppConfirm(q, o, P, T, E, fo) {
    if (!P || q.dec == null || q.x == null || q.y == null) return;
    // Carbon 審查：只有「原引擎本來就讀到、而且跟 Paddle 一樣」的欄位才算互相印證（Paddle 補進來／改過的值不能自己印證自己）；Paddle 自己幾張照片之間也不一致的欄位不算
    var selfC = function (k) { return !!(fo && (((fo.conflict || []).indexOf(k) >= 0) || (fo.alt && fo.alt[k] && fo.alt[k].length > 1))); };
    var eqE = function (k) { var ek = k === 'dec' ? 'd' : k; if (!E || E[ek] == null) return false; return k === 'dec' ? Math.round(E.d * 10) === Math.round(q.dec * 10) : Math.abs(E[k] - q[k]) < 0.005; };
    if (T && !fits(T, q, q.x, q.y, true)) return; // 分數跟座標對不上就不算解決（審查建議）
    var ok = { dec: P.d != null && Math.round(P.d * 10) === Math.round(q.dec * 10) && (q.dec < 10 || !!P.inner === !!q.inner), x: P.x != null && Math.abs(P.x - q.x) < 0.005, y: P.y != null && Math.abs(P.y - q.y) < 0.005 };
    var hit = 0; o.ppOk = {}; ['dec', 'x', 'y'].forEach(function (k) {
      if (!ok[k] || !eqE(k) || (selfC(k) && PPSELF)) return; o.ppOk[k] = 1;
      if ((o.conflict || []).indexOf(k) >= 0) { o.conflict = o.conflict.filter(function (c) { return c !== k; }); hit = 1; }
      if (o.alt && o.alt[k] && o.alt[k].length > 1) { o.alt[k] = [q[k]]; hit = 1; }
      var wk = k === 'dec' ? 'd' : k; if (o.w && (o.w[wk] || 0) < 2) { o.w[wk] = 2; hit = 1; }
    });
    if (hit) o.ppConf = 1;
  }
  function hybrid(model, ppPasses) {
    if (!ppPasses || !ppPasses.length || !model || !model.shots) return null;
    var pm; try { pm = X().merge(ppPasses, { targetId: model.targetId }); } catch (e) { return null; }
    var C = C0(), T = C.TARGETS[model.targetId] || C.TARGETS.ar10, A = AR(), sec = X().secOf, used = {}, st = { n: 0, same: 0, diff: 0, miss: 0, fill: 0 };
    stampInt(model);
    var multi = model.shots.some(function (q) { return q.blk; }) || pm.shots.some(function (f) { return f.blk; }), byT = {};
    model.shots.forEach(function (q) { if (q.t) (byT[q.t] = byT[q.t] || []).push(q); });
    // 第一輪：配對（試射／正式＋印的發號；序號重編時時間要接近）
    var match = [], orphan = []; // ES5：用 shots 的索引記配到哪一列（不用 Map）
    var idxOf = function (q) { return model.shots.indexOf(q); };
    model.shots.forEach(function (q) {
      if (q.n == null || q.ed || (q.ocr && q.ocr.ppDone)) return;
      var best = -1, bd = 1e9;
      pm.shots.forEach(function (f, j) {
        if (used[j] || (!model.practice && !!f.sighter !== !!q.sighter) || ppKey(f) !== ppKey(q) || (f.dec == null && f.x == null && f.y == null)) return; // Paddle 整行沒讀到的空列不算
        var a = sec(q.t), b = sec(f.t), d = a == null || b == null ? 0 : Math.min(Math.abs(a - b), 3600 - Math.abs(a - b));
        if (multi && a != null && b != null && d > 90) return;
        if (multi && (a == null || b == null) && (f.blk || 0) !== (q.blk || 0)) return;
        if (d < bd) { bd = d; best = j; }
      });
      if (best < 0) return;
      var f = pm.shots[best];
      // Paddle 這一列其實是原引擎另一發的那一行（時間一模一樣、X 或 Y 也一樣）→ 對錯列了：不拿來比這一發，留給真正那一發
      var own = f.t && byT[f.t] ? byT[f.t].filter(function (q2) { return q2 !== q && ((q2.x != null && f.x != null && Math.abs(Math.abs(q2.x) - Math.abs(f.x)) < 0.005) || (q2.y != null && f.y != null && Math.abs(Math.abs(q2.y) - Math.abs(f.y)) < 0.005)); }) : [];
      var own1 = own.filter(function (q2) { return model.practice || !!q2.sighter === !!f.sighter; });
      if (own.length && f.t !== q.t) { if (own1.length === 1) orphan.push({ q: own1[0], j: best }); (q.ocr = q.ocr || {}).ppMis = 1; return; }
      used[best] = 1; match[idxOf(q)] = f;
    });
    orphan.forEach(function (z) { if (!match[idxOf(z.q)] && !used[z.j] && !z.q.ed) { used[z.j] = 1; match[idxOf(z.q)] = pm.shots[z.j]; } });
    // 第二輪：逐發比對
    model.shots.forEach(function (q) {
      if (q.n == null) return; var o = q.ocr = q.ocr || {}; if (o.ppDone) return; o.ppDone = 1; st.n++;
      var f = match[idxOf(q)];
      if (!f) { o.pp = null; st.miss++; return; }
      var P = { d: f.dec != null && isFinite(f.dec) ? f.dec : null, inner: !!f.inner, x: f.x != null && isFinite(f.x) ? f.x : null, y: f.y != null && isFinite(f.y) ? f.y : null, t: f.t || null };
      var E = { d: q.dec != null && isFinite(q.dec) ? q.dec : null, inner: !!q.inner, x: q.x != null && isFinite(q.x) ? q.x : null, y: q.y != null && isFinite(q.y) ? q.y : null, t: q.t || null };
      o.pp = P; if (q.ed) return;
      // Paddle 幾張照片（或同一張幾種讀法）讀到的所有值（f.ocr.alt）裡只要有一個跟原引擎一樣 → 算一樣（兩套各自讀到同一個值＝互相印證；不讓 Paddle 某一張讀歪、或多出來的假行把對的值改掉）
      var pa = f.ocr && f.ocr.alt || {}, inAlt = function (k, v) { var l = pa[k === 'd' ? 'dec' : k]; return !!(l && l.some(function (z) { return z != null && Math.abs(z - v) < 0.005; })); };
      // v3.2.0（White 2026-11-28）：任何一欄不一樣都算不一致（以前 Paddle 其他讀法裡有原引擎的值就算一樣 → rv1127_230254 正式 #9、#10 假綠燈）
      var same = function (k) { if (k === 'd') return E.d != null && P.d != null && Math.round(E.d * 10) === Math.round(P.d * 10) && (E.d < 10 || E.inner === P.inner); return E[k] != null && P[k] != null && Math.abs(E[k] - P[k]) < 0.005; };
      var diff = PPF.filter(function (k) { return P[k] != null && !same(k); });
      if (!diff.length) { st.same++; if (P.d != null && P.x != null && P.y != null) o.ppSame = 1; else o.ppPart = 1; ppConfirm(q, o, P, T, E, f.ocr); return; } // Paddle 只讀到一部分＝不算「兩套一樣」，燈號照原引擎自己的核對
      // 每個不一樣的欄位列出選項，挑分數＝座標重算的組合
      var opts = {}; PPF.forEach(function (k) {
        if (diff.indexOf(k) < 0) { opts[k] = [{ v: E[k] != null ? E[k] : P[k], inner: E[k] != null ? E.inner : P.inner, src: E[k] != null ? 'e' : 'p' }]; return; }
        var l = []; if (E[k] != null) l.push({ v: E[k], inner: E.inner, src: 'e' }); l.push({ v: P[k], inner: P.inner, src: 'p' });
        // 正負號：兩邊數字差不多（最多差一個字）、只有一邊看到負號 → 「看到的負號」比「沒看到」可靠（兩套都會漏負號），數字用 Paddle 的
        if (k !== 'd' && E[k] != null && (E[k] < 0) !== (P[k] < 0) && near1(E[k], P[k])) { l = l.filter(function (z) { return Math.abs(z.v + Math.abs(P[k])) > 0.005; }); l.push({ v: -Math.abs(P[k]), src: 'pn' }); }
        opts[k] = l;
      });
      var ad = A && A.sure(o.arw) ? o.arw.dir : null, top = null;
      opts.d.forEach(function (od) { opts.x.forEach(function (ox) { opts.y.forEach(function (oy) {
        var qq = { dec: od.v, inner: od.inner, decInt: q.decInt }, ok = od.v != null && ox.v != null && oy.v != null && fits(T, qq, ox.v, oy.v, true);
        var arr = ad && ox.v != null && oy.v != null && A.compat(ox.v, oy.v, ad) ? 1 : 0, np = [od, ox, oy].filter(function (z) { return z.src !== 'e'; }).length, sg = [ox, oy].filter(function (z) { return z.src === 'pn'; }).length;
        var ea = [['d', od], ['x', ox], ['y', oy]].filter(function (z) { return z[1].src === 'e' && z[1].v != null && inAlt(z[0], z[1].v); }).length; // v3.2.0：原引擎的值也出現在 Paddle 的其他讀法裡＝兩套互相印證，挑值時優先（燈號仍算不一致）
        var sc = (ok ? 100 : 0) + arr * 10 + sg * 3 + np * 2 + ea * 5;
        if (!top || sc > top.sc) top = { sc: sc, d: od, x: ox, y: oy, ok: ok };
      }); }); });
      if (!top) return;
      st.diff++; o.ppDiff = diff.slice(); o.ppAlt = { e: E, p: P, ok: top.ok };
      if (E.d == null || E.x == null || E.y == null) st.fill++;
      var whole = top.d.src !== 'e' && top.x.src !== 'e' && top.y.src !== 'e';
      q.dec = top.d.v; if (top.d.src !== 'e') { q.inner = !!top.d.inner; q.decCalc = 0; q.decSub = 0; if (q.ocr) q.ocr.missing = false; }
      q.x = top.x.v; q.y = top.y.v;
      if (P.t && (!E.t || whole) && P.t !== E.t) { o.ppT = { from: E.t || null }; q.t = P.t; }
      if (top.x.src !== 'e' || top.y.src !== 'e') { o.xyPick = 1; o.rpXY = 1; o.conflict = (o.conflict || []).filter(function (c) { return c !== 'x' && c !== 'y'; }); o.alt = null; } // 已經用 Paddle 決定過 X/Y，原引擎不再拿備選讀法改回去
      if (top.d.src !== 'e') o.conflict = (o.conflict || []).filter(function (c) { return c !== 'dec'; });
      if (whole) o.conflict = (o.conflict || []).filter(function (c) { return c !== 't'; });
      // v3.2.0：哪些不一樣可以不亮黃（見 rules 的 ppGreen）
      var gr = [], fk = [], allG = top.ok && diff.every(function (k) {
        var ch = top[k], ev = E[k], pv = P[k];
        if (ev == null && ch.src === 'p' && q.x != null && q.y != null && ringMargin(T, q.x, q.y, q.dec, q.decInt)) { if (gr.indexOf('ppFill') < 0) gr.push('ppFill'); fk.push(k); return true; }
        if (k !== 'd' && ev != null && pv != null && ch.src === 'p' && (ev < 0) === (pv < 0) && ti(ev) === ti(pv) && !solidF(o, k, ev) && ringMargin(T, q.x, q.y, q.dec, q.decInt)) { if (gr.indexOf('ppDec') < 0) gr.push('ppDec'); return true; }
        // ppD：兩套 X、Y 完全一樣（或原引擎沒讀到 X、Y、用 Paddle 補的而且落點離環線 ≥0.25 mm，不是壓線），原引擎分數＝座標算的、Paddle 分數對不上座標 → 用原引擎的分數不亮黃（審查建議收緊）
        if (k === 'd' && ch.src === 'e' && ((diff.indexOf('x') < 0 && diff.indexOf('y') < 0 && E.x != null && E.y != null) || (E.x == null && E.y == null)) && pv != null && q.x != null && q.y != null && ringMargin(T, q.x, q.y, q.dec, q.decInt) && q.y != null && !fits(T, { dec: pv, inner: P.inner, decInt: q.decInt }, q.x, q.y, true)) { if (gr.indexOf('ppD') < 0) gr.push('ppD'); return true; }
        return false;
      });
      o.ppGreen = allG ? gr : null; o.ppFillK = allG ? fk : null;
      ppConfirm(q, o, P, T, E, f.ocr);
    });
    // 時間再對一次：Paddle 某一行的 X/Y 跟這一發最後的 X/Y 兩個都一模一樣 → 那一行的時間就是這一發的（合併時時間可能被隔壁行拉走）。
    // 所有這樣的行時間都一樣、跟前後發接得上、也不是別發的時間，才換成 Paddle 的，並打時間記號 ppT（時間只打記號、不影響燈號）
    var tl = []; ppPasses.forEach(function (p) { (p.lines || []).forEach(function (l) { var m = /(\d{2}:[0-5]\d\.\d{2})\D{0,4}?(-?\d{1,2}\.\d{2})\s*\/\s*(-?\d{1,2}\.\d{2})/.exec(String(l)); if (m) tl.push({ t: m[1], x: Math.abs(+m[2]), y: Math.abs(+m[3]) }); }); });
    var allT = {}; model.shots.forEach(function (q) { if (q.t) allT[q.t] = (allT[q.t] || 0) + 1; });
    model.shots.forEach(function (q, i) {
      var o = q.ocr; if (!o || !o.pp || q.ed || q.x == null || q.y == null) return;
      var ts = {}; tl.forEach(function (z) { if (Math.abs(z.x - Math.abs(q.x)) < 0.005 && Math.abs(z.y - Math.abs(q.y)) < 0.005) ts[z.t] = 1; });
      var k = Object.keys(ts); if (k.length !== 1 || k[0] === q.t || allT[k[0]]) return;
      var s0 = sec(k[0]), prv = null, nxt = null, j;
      for (j = i - 1; j >= 0; j--) { var a = model.shots[j]; if (!!a.sighter !== !!q.sighter) break; if (a.t && sec(a.t) != null) { prv = sec(a.t); break; } }
      for (j = i + 1; j < model.shots.length; j++) { var b = model.shots[j]; if (!!b.sighter !== !!q.sighter) break; if (b.t && sec(b.t) != null) { nxt = sec(b.t); break; } }
      if (s0 == null || (prv != null && s0 < prv) || (nxt != null && s0 > nxt)) return;
      if (q.t) allT[q.t]--; allT[k[0]] = 1; o.ppT = o.ppT || { from: q.t || null }; q.t = k[0];
      o.conflict = (o.conflict || []).filter(function (c) { return c !== 't'; });
    });
    model.pp = st; return st;
  }
  // 讀法 → 模型：M6b 合併；有備援讀法就補紅列
  function build(passes, fbPasses, mopt, ppPasses) {
    var t0 = now(), m = X().merge(passes, mopt || {}), t1 = now(), nf = 0;
    if (fbPasses && fbPasses.length) { var fm = S0().merge(fbPasses, { targetId: m.targetId }); nf = fill(m, fm); }
    var t2 = now(); if (ppPasses && ppPasses.length && RULES.pp) { try { hybrid(m, ppPasses); } catch (e) { m.pp = { err: String(e && e.message || e) }; } } // v3.1.4 混合引擎
    m.v3 = { merge: Math.round(t1 - t0), fill: Math.round(t2 - t1), filled: nf, pp: Math.round(now() - t2) };
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
    // v3.1.4 混合引擎：Paddle（sius-pp.js）跟原引擎同時開始讀（它在自己的 worker 裡跑，不卡畫面）；失敗／不支援＝沒有 ppPasses，照原引擎
    var PPm = root.WRSiusPP, ppP = null, tp = now();
    if (PPm && RULES.pp && opt.pp !== 0 && nf) { ppP = PPm.run(files, { imgBase: base, cancelled: opt.cancelled }).then(function (r) { lg('pp', r.timing); return r; }, function (e) { if (e && e.cancel) return { cancel: true }; lg('ppErr', String(e && e.message || e).slice(0, 80)); return { err: 1 }; }); }
    function withPP(res) {
      if (!ppP) return res;
      if (opt.cancelled && opt.cancelled()) { try { PPm.stop(); } catch (e) {} return res; } // 取消了：不等 Paddle
      prog(0.99, 'pp');
      return ppP.then(function (pr) {
        if (!pr || pr.err || pr.cancel || !pr.passes) return res;
        // 保險：原引擎轉正的角度跟 Paddle 自己判斷的不一樣 → 那張的 Paddle 讀法不用（避免整張讀歪造成一堆假黃燈）
        var rot = {}; (info && info.images || []).forEach(function (im) { rot[im.img] = im.rot; });
        var pim = {}; (pr.info && pr.info.images || []).forEach(function (im) { pim[im.img] = im.rot; });
        var lastImg = T.skipped ? base + nf - T.skipped : Infinity; // 原引擎已經全綠而跳過的照片，Paddle 的讀法也不用
        res.ppPasses = pr.passes.filter(function (p) { return p.img < lastImg; }).filter(function (p) { return rot[p.img] == null || pim[p.img] == null || ((rot[p.img] - pim[p.img]) % 360 + 360) % 360 === 0; });
        T.ppDrop = pr.passes.length - res.ppPasses.length; T.ppWait = Math.round(now() - tp); lg('total', Math.round(now() - t0));
        return res;
      });
    }
    return one(0).then(function () {
      lg('m6b', sumT);
      var ta = now(), m = X().merge(prior.concat(all), mopt), tb = now(), ck = check(m), tc = now();
      lg('merge', Math.round(tb - ta)); lg('check', Math.round(tc - tb));
      if (!OCR || !needFallback(m, ck) || (opt.cancelled && opt.cancelled())) { lg('total', Math.round(now() - t0)); return withPP({ passes: all, fbPasses: [], timing: T, info: info }); }
      var td = now(); T.fbRun = true; prog(0.8, 'fallback');
      var fbFiles = T.skipped ? files.slice(0, nf - T.skipped) : files; // 跳過的照片備援也不讀
      return OCR.run(fbFiles, { imgBase: base, cancelled: opt.cancelled, onProgress: function (p) { prog(0.8 + p * 0.19, 'fallback'); }, more: function (np) { try { var S = S0(), ck2 = S.check(S.merge(np, {})); return ck2.bad > 0 || ck2.rows.some(function (x) { return x.missing; }); } catch (e) { return false; } } }).then(function (r2) {
        try { OCR.stop(); } catch (e) {}
        lg('fallback', Math.round(now() - td)); lg('total', Math.round(now() - t0));
        return withPP({ passes: all, fbPasses: r2.passes || [], timing: T, info: info });
      });
    });
  }
  function stop() { try { if (root.WRSiusX) root.WRSiusX.stop(); } catch (e) {} try { if (root.WRSiusOCR) root.WRSiusOCR.stop(); } catch (e) {} try { if (root.WRSiusPP) root.WRSiusPP.stop(); } catch (e) {} }
  var api = { RULES: RULES, hybrid: hybrid, tFix: tFix, decFill: decFill, xyRepair: xyRepair, guessXY: guessXY, digitEdits: digitEdits, intSheet: intSheet, rules: rules, check: check, arrowFix: arrowFix, hours: hours, swap17: swap17, blocking: blocking, needFallback: needFallback, fill: fill, build: build, run: run, stop: stop, key: key,
    problems: function (m, ck) { return X().problems(m, ck || check(m)); } };
  if (isNode) module.exports = api; else root.WRSiusV3 = api;
})(typeof window !== 'undefined' ? window : this);
