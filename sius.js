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
  function core() { return root.BMCore || (typeof require === 'function' ? require('./core.js') : null); }
  function tgt(id) { var C = core(); return C.TARGETS[id] || C.TARGETS.ar10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function tenths(v) { return Math.round(v * 10); }
  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  var ARROWS = /[←↑→↓↖↗↘↙⇐⇑⇒⇓⬅⬆➡⬇◀▶▲▼➚➘➙➛➜➝➞➟➠➡➢➣➤➥➦➧➨]/g;
  function norm(s) {
    return String(s || '')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[＊✱∗]/g, '*').replace(/[－−–—]/g, '-').replace(/[：]/g, ':').replace(/[，]/g, ',').replace(/[．。]/g, '.').replace(/[／]/g, '/')
      .replace(ARROWS, ' ').replace(/\t/g, ' ').replace(/\u3000/g, ' ');
  }

  /* ---------- 時間 ---------- */
  // 'mm:ss.ss'、'mm:ss'、'h:mm:ss' → 秒（讀不到回傳 null）
  function secOf(t) {
    if (t == null || t === '') return null;
    var m = String(t).trim().match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,2}))?$/); if (!m) return null;
    var s = m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    if (m[3] == null && (+m[2]) > 59) return null;
    if (m[4]) s += (+m[4]) / Math.pow(10, m[4].length);
    return s;
  }
  function fmtSec(s) { if (s == null || !isFinite(s)) return '—'; s = Math.round(s); var m = Math.floor(s / 60), x = s % 60; return m + ':' + (x < 10 ? '0' : '') + x; }
  // 相鄰兩發的間隔（秒）：小白單只印分:秒，跨整點 59→00 時加 3600；倒退超過半小時才算跨整點，其他倒退＝時間讀錯（回傳 null）
  function gapSec(a, b) { if (a == null || b == null) return null; var g = b - a; if (g < -1800) g += 3600; return g > 0 && g < 1800 ? g : null; }

  /* ---------- 一行文字 → 一筆 ---------- */
  // 寬鬆規則：OCR 常把箭頭讀成數字或符號（例「8 210.6」＝8 ↗ 10.6）、把 * 讀成 % + x 4、把 / 讀成 7 ) ,、把 - 讀成 ~ =，這裡都吃。
  var RE_TAIL = /(\d{1,2})\s*[:;.]?\s*(\d{2})\s*[.,]\s*(\d{2})(?!\d)[.'°]?\s+([-~=]?)\s*(\d{1,2})\s*[.,]\s*(\d{2})(\S?)\s*([-~=]?)\s*(\d{1,2})\s*[.,]\s*(\d{2})(?!\d)/g;
  var RE_TIME = /(\d{1,2})\s*[:;.]?\s*(\d{2})\s*[.,]\s*(\d{2})(?!\d)[.,'°;:]?/g;
  var RE_NUM = /^\s*([-~=]?)\s*(\d{1,2})\s*[.,:]\s*(\d{2})(?!\d)/;
  function parseShot(raw) {
    var s = norm(raw), m, last = null, part = null;
    RE_TAIL.lastIndex = 0;
    while ((m = RE_TAIL.exec(s))) last = m;
    var o, pre;
    if (last) {
      m = last;
      o = { t: tStr(+m[1], +m[2], m[3]), x: (m[4] ? -1 : 1) * +(m[5] + '.' + m[6]), y: (m[8] ? -1 : 1) * +(m[9] + '.' + m[10]) };
      pre = s.slice(0, m.index);
    } else {
      // 只讀到一部分（紙有摺痕、Y 糊掉）：時間＋（X）也收，缺的欄位留空，畫面標紅等人補
      RE_TIME.lastIndex = 0; while ((m = RE_TIME.exec(s))) part = m;
      if (!part) return null;
      m = part; o = { t: tStr(+m[1], +m[2], m[3]), x: null, y: null, partial: true };
      var rest = s.slice(m.index + m[0].length), xm = rest.match(RE_NUM);
      if (xm) { o.x = (xm[1] ? -1 : 1) * +(xm[2] + '.' + xm[3]); var ym = rest.slice(xm[0].length).replace(/^\S?/, '').match(RE_NUM); if (ym) o.y = (ym[1] ? -1 : 1) * +(ym[2] + '.' + ym[3]); }
      pre = s.slice(0, m.index);
      if (!o.t) return null;
    }
    if ((o.x != null && Math.abs(o.x) > 99) || (o.y != null && Math.abs(o.y) > 99)) return null;
    o.n = null; o.nc = []; o.dec = null; o.star = false; o.P = false;
    // 分數：時間前面最後一個「數字.數字」；整數部分取後 2 位（>10.9 就取後 1 位，前面那位多半是箭頭）
    var pm = pre.match(/(\d{1,3})\s*[.,]\s*(\d)\s*(\S{0,3})\s*(\S{0,2})\s*$/), head = pre;
    if (pm) {
      var ip = pm[1], v = +(ip.slice(-2) + '.' + pm[2]);
      if (v > 10.9) v = +(ip.slice(-1) + '.' + pm[2]);
      o.dec = v;
      var aft = (pm[3] || '') + (pm[4] || '');
      if (/[PFp]/.test(aft)) o.P = true;
      if (aft.replace(/[PFp]/g, '').length) o.star = true;
      head = pre.slice(0, pm.index) + ' ' + ip.slice(0, ip.length - (v >= 10 ? 2 : 1));
    } else {
      // 手槍資格賽可能只印整數（尚未驗證）：時間前面最後一個 1–10 的整數（前面還要有發序）
      var im = pre.match(/(\d{1,2})\s+(\d{1,2})\s*(\*?)\s*([Pp]?)\s*$/);
      if (im && +im[2] >= 1 && +im[2] <= 10) { o.dec = +im[2]; o.decInt = true; o.star = !!im[3]; o.P = !!im[4]; head = pre.slice(0, im.index) + ' ' + im[1]; }
    }
    // v2.9.4 手槍整數分數（寬鬆，PROGRESS 第 24 項）：時間前面最後一個 1–10，後面可有 *（OCR 讀成 s x % + 4 # ¢）與 P（可黏在時間前）；
    //   中間的方向箭頭常被讀成 ~ # + » % w 等雜字，所以不要求「發序 空白 分數」。這個值只在手槍（ap10）時採用（o.iv）。
    var iv = pre.match(/(?:^|[^\d])(10|[1-9])\s*([*sx%+¢4#]?)\s*([PpF]?)\s*$/);
    if (iv) { o.iv = +iv[1]; o.istar = !!iv[2]; if (iv[3]) o.P = true; }
    if (o.partial && o.dec == null && o.iv == null) return null;
    if (/(^|[^A-Za-z])P\s*$/.test(pre)) o.P = true;
    var re = /\d+/g, k; while ((k = re.exec(head))) { var tk = k[0]; if (tk.length > 3) continue; if (tk.length === 3) { if (+tk.slice(0, 2) >= 1) o.nc.push(+tk.slice(0, 2)); if (+tk.slice(1) >= 1) o.nc.push(+tk.slice(1)); } else if (+tk >= 1) o.nc.push(+tk); }
    o.n = o.nc.length ? o.nc[0] : null;
    return o;
  }
  function tStr(mm, ss, cs) { return mm <= 59 && ss <= 59 ? (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss + '.' + cs : null; }
  function parseOther(raw) {
    var s = norm(raw), low = s.toLowerCase();
    if (/\d{1,2}\s*:\s*\d{2}\s*[.,]\s*\d{2}/.test(s)) return null;
    if (/qual\s*i?\s*f|ification/i.test(s)) return { kind: 'qual' };
    var isSub = /sub/i.test(s), isTot = !isSub && /t[o0]ta[l1)|]|total/i.test(s);
    var m = s.match(/(\d{2,3})\s*[.,]\s*(\d)\s*[-~=]?\s*(\d{1,2})(?!\d)\s*\S?/);
    if (!m && isTot) m = s.match(/(\d{3})(\d)\s*[-~=]\s*(\d{1,2})/); // 「6046-32」小數點沒讀到
    if (!m && isSub) { var m2 = s.match(/(\d{2,3})\s*[.,]\s*(\d)(\d)\b/); if (m2) m = m2; } // 「97.84」＝97.8-4
    if (m && (isSub || isTot)) { var v = +(m[1] + '.' + m[2]), n = +m[3]; if (isTot ? v <= 1100 : v <= 110) return { kind: isTot ? 'total' : 'sub', dec: v, inner: n }; }
    // v2.9.4 手槍整數小計／總分「Subtota 89-1*」「Total 349-6*」
    if (!m && (isSub || isTot)) { var mi = s.match(/(\d{2,3})\s*[-~=]\s*(\d{1,2})(?!\d)/); if (mi) { var vi = +mi[1], ni = +mi[2]; if (isTot ? vi <= 1090 : vi <= 109) return { kind: isTot ? 'total' : 'sub', dec: vi, inner: ni, int: true }; } }
    if (m && !isSub && !isTot && /^\s*\S{0,3}\s*\d{2,3}[.,]\d\s*-\s*\d{1,2}\s*\*?\s*$/.test(s)) { v = +(m[1] + '.' + m[2]); return { kind: v > 110 ? 'total' : 'sub', dec: v, inner: +m[3] }; }
    if (/\b[mhn]atch\b/i.test(s) && !/\d\.\d/.test(s)) return { kind: 'match' };
    var g = /air\s*rifle|rifle/i.test(s) ? 'ar10' : /air\s*pist|pistol/i.test(s) ? 'ap10' : null;
    if (g) { var c = s.match(/(?:rifle|pistol)\s*(\d{2})/i); return { kind: 'event', gun: g, count: c ? +c[1] : null, text: s.trim() }; }
    var d = s.match(/(\d{1,2})\.(\d{1,2})\.(20\d\d)\s+(\d{1,2}):(\d{2})/); if (d) return { kind: 'date', text: d[0] };
    void low; return null;
  }
  // 舊介面（v2.9.3 草稿、手動貼上）：一行 → { kind:'shot', shot } | { kind:'sub'|'total', dec, inner }
  function parseLine(raw) {
    var o = parseOther(raw); if (o && (o.kind === 'sub' || o.kind === 'total')) return o;
    var p = parseShot(raw); if (!p) return null;
    return { kind: 'shot', shot: { n: p.n, sighter: p.P, dec: p.dec, inner: p.star, t: p.t || '', x: p.x, y: p.y } };
  }

  /* ---------- 一次 OCR（一張照片的一種讀法）→ 依序的條目，補上「試射／比賽」與發序 ---------- */
  function XA() { return root.WRSiusXAlign || (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? (function () { try { return require('./sius-x-align.js'); } catch (e) { return null; } })() : null); }
  function parsePass(lines, la, resetT) {
    var es = [];
    lines.forEach(function (ln, li) { var p = parseShot(ln); if (p) { if (la && la[li] && la[li].dir) p.arrow = la[li]; es.push({ k: 'shot', p: p }); return; } var o = parseOther(ln); if (o) es.push({ k: o.kind, o: o }); });
    // 1) 試射／比賽：表頭 Qualification／Match、每行的 P；連兩行跟目前段落不符才換段（P 偶爾讀漏）
    var sec = null, hdr = [], segs = [], seg = null, pend0 = false;
    var nextShot = function (i) { for (var j = i + 1; j < es.length; j++) { if (es[j].k === 'shot') return es[j]; if (es[j].k === 'match' || es[j].k === 'qual') return null; } return null; };
    var newSeg = function (s2, start) { seg = { sec: s2, start: start, items: [] }; segs.push(seg); };
    es.forEach(function (e, i) {
      // v3.0.3：「Qualification」是整場的階段名稱，不是試射開始 → 只記「下一發是第 1 發」，試射／正式看 P 和 Match 行
      if (e.k === 'qual') { sec = null; pend0 = true; return; }
      if (e.k === 'match') { sec = 'M'; newSeg('M', 0); pend0 = false; return; }
      if (e.k === 'event' || e.k === 'date') { hdr.push(e.o); return; }
      if (e.k === 'sub') { if (sec !== 'M') { sec = 'M'; newSeg('M', null); } seg.items.push(e); return; }
      if (e.k === 'total') { if (!seg) newSeg('M', null); seg.items.push(e); return; }
      var p = e.p, nx = nextShot(i);
      if (sec === null) { // 開頭看這發＋後面兩發的 P 多數決
        var nP = p.P ? 1 : 0, nA = 1, j3 = i;
        while (nA < 3) { var e3 = nextShot(j3); if (!e3) break; nA++; if (e3.p.P) nP++; j3 = es.indexOf(e3); }
        sec = nP * 2 >= nA && nP > 0 ? 'Q' : 'M'; newSeg(sec, pend0 ? 0 : null); pend0 = false;
      }
      else if (sec === 'Q' && !p.P && (!nx || !nx.p.P)) { sec = 'M'; newSeg('M', null); }
      else if (sec === 'M' && p.P && nx && nx.p.P) { sec = 'Q'; newSeg('Q', null); }
      seg.items.push(e);
    });
    // 2) 發序：Viterbi——每行讀到的數字是候選；相鄰兩行通常 +1（中間漏讀 +2、+3 加成本；分段重疊造成的重讀＝往回，時間也要往回才便宜）；
    //    小計那一行前面一發要是 10 的倍數。讀到的數字裡都不合，才用推的（權重減半，畫面標「請核對」）。
    var out = [], segNo = -1;
    segs.forEach(function (sg) {
      // 開頭幾行讀不到發序（又不是緊接在表頭後面）：沒辦法定位，丟掉這幾次讀到的（別的讀法、別張照片通常有）
      if (sg.start !== 0) { var f0 = -1; sg.items.forEach(function (e, ix) { if (f0 < 0 && e.k === 'shot' && e.p.nc.length) f0 = ix; }); sg.items = sg.items.filter(function (e, ix) { return e.k !== 'shot' || f0 < 0 ? e.k !== 'shot' : ix >= f0; }); }
      var L = sg.items.filter(function (e) { return e.k === 'shot'; }); if (!L.length) { sg.items.forEach(function (e) { if (e.k === 'sub') out.push({ k: 'sub', idx: null, dec: e.o.dec, inner: e.o.inner }); else if (e.k === 'total') out.push({ k: 'total', dec: e.o.dec, inner: e.o.inner }); }); return; }
      var subAfter = []; var li = -1; sg.items.forEach(function (e) { if (e.k === 'shot') li++; else if (e.k === 'sub' && li >= 0) subAfter[li] = true; });
      var ts = L.map(function (e) { return secOf(e.p.t); });
      var INF = 1e9, layers = [];
      for (var i = 0; i < L.length; i++) {
        var cand = {}, nc = L[i].p.nc;
        nc.forEach(function (v) { if (v <= 99) cand[v] = 0; });
        if (i === 0) { if (sg.start === 0) cand[1] = cand[1] === 0 ? 0 : 1.6; for (var a = 1; a < Math.min(4, L.length); a++) L[a].p.nc.forEach(function (v) { if (v - a >= 1 && cand[v - a] == null) cand[v - a] = 1.6; }); }
        else Object.keys(layers[i - 1]).forEach(function (pv) { pv = +pv; for (var d = 1; d <= 4; d++) if (pv + d <= 99 && cand[pv + d] == null) cand[pv + d] = 1.6; });
        var lay = {};
        Object.keys(cand).forEach(function (v) {
          v = +v; var em = cand[v] + (subAfter[i] && v % 10 ? 2 : 0), best = INF, from = null, rsB = false;
          if (i === 0) { best = em + (sg.start === 0 ? (v - 1) * 0.8 : 0); }
          else Object.keys(layers[i - 1]).forEach(function (pv) {
            var P0 = layers[i - 1][pv], d = v - (+pv), tc;
            if (d >= 1 && d <= 4) tc = d - 1;
            else if (d <= 0 && d >= -7) { var back = ts[i] != null && ts[i - 1] != null && gapSec(ts[i], ts[i - 1]) != null; tc = back ? 0.6 : (d === 0 && ts[i] != null && ts[i] === ts[i - 1] ? 0.6 : 2.6); }
            else tc = 4; // 接不上（例如中間整段沒讀到）：重新起算
            var rs = false; // v3.0.3：序號跳回 1／2、時間照樣往後＝新的一組
            if (d < 0 && v <= 2 && +pv >= 3 && cand[v] === 0 && ts[i] != null && ts[i - 1] != null && gapSec(ts[i - 1], ts[i]) != null && 0.5 < tc && (!resetT || resetT[L[i].p.t])) { tc = 0.5; rs = true; }
            if (P0.c + tc + em < best) { best = P0.c + tc + em; from = +pv; rsB = rs; }
          });
          if (best < INF) lay[v] = { c: best, from: from, guess: cand[v] > 0, rs: rsB };
        });
        // 只留成本最低的 40 個
        var ks = Object.keys(lay).sort(function (x, y) { return lay[x].c - lay[y].c; }).slice(0, 40), lay2 = {}; ks.forEach(function (k2) { lay2[k2] = lay[k2]; });
        layers.push(lay2);
      }
      var lastL = layers[layers.length - 1], bk = null; Object.keys(lastL).forEach(function (k2) { if (bk == null || lastL[k2].c < lastL[bk].c) bk = k2; });
      var ns = new Array(L.length), gs = new Array(L.length), cur = +bk;
      var rsA = new Array(L.length);
      for (i = L.length - 1; i >= 0; i--) { var node = layers[i][cur]; ns[i] = cur; gs[i] = node.guess; rsA[i] = !!node.rs; cur = node.from; }
      var lbs = XA() ? XA().localBlocks(ts, rsA, gapSec) : ns.map(function () { return 0; });
      li = -1; var lastN = null; segNo++;
      sg.items.forEach(function (e) {
        if (e.k === 'shot') { li++; out.push({ k: 'shot', sec: sg.sec, n: ns[li], guess: gs[li], p: e.p, lb: lbs[li], sg: segNo, rs: rsA[li] }); lastN = ns[li]; }
        else if (e.k === 'sub') { var nxN = null; for (var j = li + 1; j < L.length; j++) { nxN = ns[j]; break; } var idx = lastN != null && lastN % 10 === 0 ? lastN / 10 - 1 : nxN != null && nxN % 10 === 1 ? (nxN - 1) / 10 - 1 : null; out.push({ k: 'sub', idx: idx, dec: e.o.dec, inner: e.o.inner }); }
        else if (e.k === 'total') out.push({ k: 'total', dec: e.o.dec, inner: e.o.inner });
      });
    });
    return { items: out, hdr: hdr };
  }

  /* ---------- 多張照片、多種讀法 → 一份資料（投票＋核對） ---------- */
  function vote(list, key) { // list：[{ v, w }] → [{ v, w }] 依票數排序
    var m = {}; list.forEach(function (o) { if (o.v == null) return; var k = key ? key(o.v) : String(o.v); if (!m[k]) m[k] = { v: o.v, w: 0 }; m[k].w += o.w; });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.w - a.w; });
  }
  // passes：[{ img, kind, lines:[…] }]；opt：{ targetId（使用者手動選的，沒有就自動） }
  function merge(passes, opt) {
    opt = opt || {};
    var groups = {}, subs = {}, totals = [], hdr = [];
    // v3.0.3：先把每次讀法解析好，算出全單一致的組號（序號跳回 1＝新的一組），再依「試射／正式＋組＋序號」分組；印的序號留在 pn
    var parseAll = function (resetT) { return passes.map(function (ps, pi) { var r = parsePass(ps.lines || [], ps.lineArrows, resetT); r.pi = pi; r.img = ps.img; return r; }); };
    var PR = parseAll(null), rsC = {}, rsAny = false; // 跳回 1 要至少 2 次讀法同一時間都這樣讀才算新的一組
    PR.forEach(function (r) { var seen = {}; r.items.forEach(function (it, ii, arr) { var nx = arr[ii + 1]; if (it.k === 'shot' && it.rs) rsAny = true; if (it.k === 'shot' && it.rs && it.p.t && !seen[it.p.t] && nx && nx.k === 'shot' && nx.sec === it.sec && nx.n === it.n + 1) { seen[it.p.t] = 1; rsC[it.p.t] = (rsC[it.p.t] || 0) + 1; rsAny = true; } }); });
    if (rsAny) { var okT = {}; Object.keys(rsC).forEach(function (t) { if (rsC[t] >= 2) okT[t] = 1; }); PR = parseAll(okT); }
    var BK = XA() ? XA().globalBlocks(PR) : { off: {} };
    PR.forEach(function (r) {
      var pi = r.pi, ps = { img: r.img };
      hdr = hdr.concat(r.hdr);
      r.items.forEach(function (it) {
        if (it.k === 'shot') { var gb = it.gb || 0, nn = (BK.off[it.sec + gb] || 0) + it.n, key = it.sec + nn; (groups[key] = groups[key] || { sec: it.sec, n: nn, pn: it.n, blk: gb, reads: [] }).reads.push({ p: it.p, w: it.guess ? 0.5 : 1, pi: pi, img: ps.img }); }
        else if (it.k === 'sub') { if (it.idx != null && it.idx >= 0 && it.idx < 20) (subs[it.idx] = subs[it.idx] || []).push({ v: f1(it.dec) + '-' + it.inner, w: 1 }); }
        else totals.push({ v: f1(it.dec) + '-' + it.inner, w: 1 });
      });
    });
    // 讀到的時間如果跟別組的多數時間完全一樣，代表發序認錯了 → 搬過去（時間 mm:ss.ss 每發都不同）
    var gk = Object.keys(groups), tmaj = {};
    gk.forEach(function (k) { var v = vote(groups[k].reads.map(function (r) { return { v: r.p.t, w: r.w }; })); if (v.length) tmaj[k] = v[0].v; });
    var byT = {}; gk.forEach(function (k) { if (tmaj[k]) byT[tmaj[k]] = byT[tmaj[k]] ? '*' : k; });
    gk.forEach(function (k) { var g = groups[k]; g.reads = g.reads.filter(function (r) { var o = r.p.t && byT[r.p.t]; if (o && o !== '*' && o !== k && r.p.t !== tmaj[k]) { groups[o].reads.push(r); return false; } return true; }); });
    // 槍種：表頭「Air Rifle／Air Pistol」投票；使用者有手動選就用手動的
    var gv = vote(hdr.filter(function (h) { return h.kind === 'event'; }).map(function (h) { return { v: h.gun, w: 1 }; }));
    var cv = vote(hdr.filter(function (h) { return h.kind === 'event' && h.count; }).map(function (h) { return { v: h.count, w: 1 }; }));
    var dv = vote(hdr.filter(function (h) { return h.kind === 'date'; }).map(function (h) { return { v: h.text, w: 1 }; }));
    // v2.9.4：表頭沒讀到（紙捲彎、手指擋住）時看格式猜：大多是整數分數＝手槍，大多是小數＝步槍。猜的不算確定（畫面會請使用者選，第 24 項）
    var nInt = 0, nDec = 0; Object.keys(groups).forEach(function (k) { groups[k].reads.forEach(function (r) { if (r.p.dec != null && !r.p.decInt) nDec++; if (r.p.iv != null) nInt++; }); });
    var fmtGuess = nInt >= 10 && nDec < nInt * 0.3 ? 'ap10' : nDec >= 10 && nDec >= nInt ? 'ar10' : null;
    var hdrId = gv.length ? gv[0].v : null;
    if (!gv.length && opt.fmtGuess !== false && fmtGuess === 'ap10') gv = [{ v: 'ap10', w: 0, fmt: true }];
    var autoId = gv.length ? gv[0].v : null, tid = opt.targetId || autoId || 'ar10', T = tgt(tid), C = core();
    var model = { v: 2, targetId: tid, gun: { id: autoId, auto: !opt.targetId && !!autoId, conflict: gv.length > 1, unverified: tid === 'ap10', header: hdrId, fmt: fmtGuess, guess: hdrId || fmtGuess, sure: !!hdrId && gv.length === 1 && (!fmtGuess || fmtGuess === hdrId) }, event: '', count: cv.length ? cv[0].v : null, date: dv.length ? dv[0].v : '', name: '', shots: [], subs: [], total: null, ocr: true };
    var ev = hdr.filter(function (h) { return h.kind === 'event' && h.gun === autoId; })[0]; if (ev) { var et = ev.text.replace(/[^\w\s.\-()/]/g, ' '), em2 = et.match(/(?:air\s*)?(?:rifle|pistol)\b.*$/i); model.event = (em2 ? em2[0] : et).replace(/\s+/g, ' ').trim(); } // v2.9.4：項目名稱前的雜字（例「vie Air Pistol 40」）拿掉
    function pickShot(g) {
      var R = g.reads;
      // 有小數的讀法優先；全部都只讀到整數（手槍資格賽，尚未驗證）才用整數
      // v2.9.4 手槍：只採用整數讀法（小數規則常把時間誤撿成分數，例「03:41.3」→8.1）
      if (tid === 'ap10') R = R.map(function (r) { if (r.p.iv == null) return r; var p2 = Object.assign({}, r.p, { dec: r.p.iv, decInt: true, star: r.p.istar }); return { p: p2, w: r.w, pi: r.pi, img: r.img }; });
      var Rd = tid === 'ap10' ? [] : R.filter(function (r) { return r.p.dec != null && !r.p.decInt; }), intMode = !Rd.length && R.some(function (r) { return r.p.decInt; });
      var Rs = intMode ? R : Rd.length ? Rd : R;
      var xs = vote(R.map(function (r) { return { v: r.p.x, w: r.w }; })), ys = vote(R.map(function (r) { return { v: r.p.y, w: r.w }; }));
      var ds = vote(Rs.map(function (r) { return { v: r.p.dec, w: r.w }; })), ts = vote(R.map(function (r) { return { v: r.p.t, w: r.w }; }));
      var tot = R.reduce(function (a, r) { return a + r.w; }, 0), best = null, NONE = [{ v: null, w: 0 }];
      (xs.length ? xs.slice(0, 4) : NONE).forEach(function (X) { (ys.length ? ys.slice(0, 4) : NONE).forEach(function (Y) { (ds.length ? ds.slice(0, 4) : NONE).forEach(function (D) {
        var sc = X.v != null && Y.v != null ? C.scoreShot(T, X.v, Y.v) : null, dd = null;
        if (sc && D.v != null) dd = Math.abs(tenths(intMode ? sc.ring : sc.dec) - tenths(D.v));
        var s2 = X.w + Y.w + D.w + (dd === 0 ? 3 * tot : dd === 1 ? 1.5 * tot : 0);
        if (!best || s2 > best.s) best = { s: s2, x: X, y: Y, d: D, sc: sc, dd: dd };
      }); }); });
      var conflict = [];
      // v2.9.4：同一欄同時讀到 v 和 −v（OCR 常漏掉負號、幾乎不會多出負號）→ 選負的；負號那方票數沒比較多（＝改判）才標黃
      var sgn = function (list, nm) { var hit = false; list.forEach(function (o) { if (o.v > 0) { var ng = list.filter(function (z) { return z.v === -o.v; })[0]; if (ng && ng.w <= o.w) hit = true; } }); if (hit) conflict.push(nm); };
      sgn(xs, 'x'); sgn(ys, 'y');
      if (best.x.v > 0 && xs.some(function (z) { return z.v === -best.x.v; })) best.x = xs.filter(function (z) { return z.v === -best.x.v; })[0];
      if (best.y.v > 0 && ys.some(function (z) { return z.v === -best.y.v; })) best.y = ys.filter(function (z) { return z.v === -best.y.v; })[0];
      var cf = function (list, chosen, nm) { if (list.length > 1 && list.some(function (o) { return o !== chosen && o.w >= chosen.w * 0.5; })) conflict.push(nm); };
      cf(xs, best.x, 'x'); cf(ys, best.y, 'y'); cf(ds, best.d, 'dec');
      conflict = conflict.filter(function (c, j) { return conflict.indexOf(c) === j; });
      if (ts.length > 1 && ts[1].w >= ts[0].w * 0.5) conflict.push('t');
      var stars = R.filter(function (r) { return r.p.star; }).length, P = R.filter(function (r) { return r.p.P; }).length;
      var AR = root.WRSiusArrow || (typeof module !== 'undefined' && module.exports ? (function () { try { return require('./sius-arrow.js'); } catch (e) { return null; } })() : null);
      var q = { n: g.n, pn: g.pn != null ? g.pn : g.n, blk: g.blk || 0, sighter: g.sec === 'Q', dec: best.d.v, inner: best.dd === 0 ? best.sc.inner : stars * 2 > R.length, t: ts.length ? ts[0].v : '', x: best.x.v, y: best.y.v,
        ocr: { reads: R.length, conflict: conflict, stars: stars, p: P, arw: AR ? AR.vote(R.map(function (r) { return r.p.arrow; })) : null, alt: { x: xs.slice(0, 3).map(function (o) { return o.v; }), y: ys.slice(0, 3).map(function (o) { return o.v; }), dec: ds.slice(0, 3).map(function (o) { return o.v; }) } } };
      if (intMode) q.decInt = true;
      return q;
    }
    var Q = [], M = [];
    Object.keys(groups).forEach(function (k) { var g = groups[k]; if (!g.reads.length) return; (g.sec === 'Q' ? Q : M).push(pickShot(g)); });
    Q.sort(function (a, b) { return a.n - b.n; }); M.sort(function (a, b) { return a.n - b.n; });
    // 沒讀到的發：留空白一行（標紅等人補），不推算
    var fill = function (list, upto, sighter) { var have = {}, out = []; list.forEach(function (q) { have[q.n] = q; }); for (var n = 1; n <= upto; n++) out.push(have[n] || { n: n, sighter: sighter, dec: null, inner: false, t: '', x: null, y: null, ocr: { reads: 0, missing: true, conflict: [] } }); list.forEach(function (q) { if (q.n > upto) out.push(q); }); return out; };
    var qMax = Q.length ? Q[Q.length - 1].n : 0, mMax = M.length ? M[M.length - 1].n : 0;
    var cnt = model.count && model.count >= mMax ? model.count : mMax;
    model.shots = fill(Q, qMax, true).concat(fill(M, cnt, false));
    var nSub = Math.ceil(cnt / 10);
    for (var k2 = 0; k2 < nSub; k2++) { var sv = vote(subs[k2] || []); if (sv.length) { var pp = sv[0].v.split('-'); model.subs.push({ dec: +pp[0], inner: +pp[1], reads: sv[0].w, conflict: sv.length > 1 && sv[1].w >= sv[0].w * 0.5 }); } else model.subs.push(null); }
    var tv = vote(totals); if (tv.length) { var tp = tv[0].v.split('-'); model.total = { dec: +tp[0], inner: +tp[1], reads: tv[0].w }; }
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

  /* ---------- 核對 ---------- */
  // 列狀態：ok｜near（請核對：只差 0.1〔座標印到 0.01mm 的四捨五入〕、多次讀到不同值、時間不連續）｜bad（差 ≥0.2、缺欄位、整行沒讀到）
  function check(model) {
    var C = core(), T = tgt(model.targetId), rows = [], series = [], mIdx = 0;
    var secs = model.shots.map(function (q) { return secOf(q.t); });
    // v2.9.4 時間整串核對：同段（試射／比賽）找「時間一路往後走」最長的一串（相鄰兩發最多隔 10 分鐘×中間幾發）；不在這串裡的＝時間跟前後對不上
    //   （例 2-43 捲起來的試射：讀到的一行被排到錯的序號，前後各一發看都正常，整串一比才露餡）。最長的一串不只一條時，只標「每一條都不在」的。
    var offChain = {};
    [true, false].forEach(function (sg) {
      var L = []; model.shots.forEach(function (q, i) { if (!!q.sighter === sg && secs[i] != null) L.push(i); });
      if (L.length < 3) return;
      var n = L.length, f = new Array(n), b = new Array(n), a, c, ok = function (x, y) { var g = gapSec(secs[L[x]], secs[L[y]]); return g != null && g <= Math.min(600 * (y - x), 1799); };
      for (a = 0; a < n; a++) { f[a] = 1; for (c = 0; c < a; c++) if (ok(c, a) && f[c] + 1 > f[a]) f[a] = f[c] + 1; }
      for (a = n - 1; a >= 0; a--) { b[a] = 1; for (c = a + 1; c < n; c++) if (ok(a, c) && b[c] + 1 > b[a]) b[a] = b[c] + 1; }
      var best = 0; for (a = 0; a < n; a++) best = Math.max(best, f[a] + b[a] - 1);
      for (a = 0; a < n; a++) if (f[a] + b[a] - 1 < best) offChain[L[a]] = true;
    });
    model.shots.forEach(function (q, i) {
      var okXY = q.x != null && q.y != null && isFinite(q.x) && isFinite(q.y), sc = okXY ? C.scoreShot(T, q.x, q.y) : null;
      var miss = [];
      if (q.dec == null || !isFinite(q.dec)) miss.push('dec');
      if (!okXY) miss.push('xy');
      if (secs[i] == null) miss.push('t');
      var cmp = sc ? (q.decInt ? sc.ring : sc.dec) : null;
      var dd = sc && q.dec != null ? Math.abs(tenths(cmp) - tenths(q.dec)) : null;
      var st = miss.indexOf('dec') >= 0 || miss.indexOf('xy') >= 0 ? 'bad' : dd >= 2 ? 'bad' : dd === 1 ? 'near' : 'ok';
      var innerOk = !sc || q.dec == null || sc.inner === !!q.inner;
      if (st === 'ok' && !innerOk) st = 'near';
      // 時間：跟同一段（試射／比賽）前一發比，要往後走（跨整點 59→00 可以）
      var tw = false, prev = -1; for (var j = i - 1; j >= 0; j--) if (!!model.shots[j].sighter === !!q.sighter && secs[j] != null) { prev = j; break; }
      if (secs[i] != null && prev >= 0 && gapSec(secs[prev], secs[i]) == null) tw = true;
      // v2.9.4 時間合理性：同段相鄰兩發隔超過 10 分鐘＝多半時間讀錯；再跟前後兩發一起比（前→後正常，夾在中間這發卻接不上＝這發讀錯，例 51:38 讀成 05:38）
      var nxt = -1; for (j = i + 1; j < model.shots.length; j++) if (!!model.shots[j].sighter === !!q.sighter && secs[j] != null) { nxt = j; break; }
      if (secs[i] != null && prev >= 0 && gapSec(secs[prev], secs[i]) > 600) tw = true;
      if (secs[i] != null && prev >= 0 && nxt >= 0) { var gpn = gapSec(secs[prev], secs[nxt]), g1 = gapSec(secs[prev], secs[i]), g2 = gapSec(secs[i], secs[nxt]); if (gpn != null && gpn <= 600 && (g1 == null || g2 == null || g1 + g2 > gpn + 1)) tw = true; }
      // 接不到下一發（倒退或隔超過 10 分鐘）也標黃：連兩發都讀錯時（例 51:14、51:38 都讀成 05:xx）前面那個規則抓不到第二發
      if (secs[i] != null && nxt >= 0) { var gn = gapSec(secs[i], secs[nxt]); if (gn == null || gn > 600) tw = true; }
      if (offChain[i]) tw = true;
      if (st === 'ok' && (miss.length || tw)) st = 'near';
      var cfl = q.ocr && q.ocr.conflict ? q.ocr.conflict.slice() : [];
      if (st === 'ok' && cfl.length) st = 'near';
      rows.push({ i: i, sighter: !!q.sighter, no: q.sighter ? null : ++mIdx, n: q.n, calc: sc ? { dec: sc.dec, ring: sc.ring, inner: sc.inner, d: sc.d } : null, diff: dd == null ? null : dd / 10, innerOk: innerOk, miss: miss, tWarn: tw, conflict: cfl, missing: !!(q.ocr && q.ocr.missing), status: st });
    });
    var match = rows.filter(function (r) { return !r.sighter; });
    for (var k = 0; k * 10 < match.length || k < model.subs.length; k++) {
      var part = match.slice(k * 10, k * 10 + 10), pr = model.subs[k] || null;
      var pSum = 0, pIn = 0, cSum = 0, cIn = 0, cOk = true;
      part.forEach(function (r) { var q = model.shots[r.i]; pSum += tenths(q.dec || 0); pIn += q.inner ? 1 : 0; if (r.calc) { cSum += tenths(q.decInt ? r.calc.ring : r.calc.dec); cIn += r.calc.inner ? 1 : 0; } else cOk = false; });
      var ok = !!pr && part.length === 10 && tenths(pr.dec) === pSum && pr.inner === pIn && cOk && cSum === pSum;
      series.push({ k: k, from: k * 10 + 1, to: k * 10 + part.length, n: part.length, rows: part.map(function (r) { return r.i; }), printed: pr, sumPrinted: { dec: pSum / 10, inner: pIn }, calc: { dec: cSum / 10, inner: cIn }, status: !pr ? (part.length ? 'nosub' : 'bad') : ok ? 'ok' : 'bad' });
    }
    var pT = 0, pTi = 0, cT = 0, cTi = 0;
    match.forEach(function (r) { var q = model.shots[r.i]; pT += tenths(q.dec || 0); pTi += q.inner ? 1 : 0; if (r.calc) { cT += tenths(q.decInt ? r.calc.ring : r.calc.dec); cTi += r.calc.inner ? 1 : 0; } });
    var tot = { printed: model.total, sumPrinted: { dec: pT / 10, inner: pTi }, calc: { dec: cT / 10, inner: cTi } };
    tot.status = !model.total ? 'nototal' : tenths(model.total.dec) === pT && model.total.inner === pTi && cT === pT ? 'ok' : 'bad';
    var bad = rows.filter(function (r) { return r.status === 'bad'; }).length + series.filter(function (s) { return s.status === 'bad'; }).length + (tot.status === 'bad' ? 1 : 0);
    var near = rows.filter(function (r) { return r.status === 'near'; }).length;
    return { rows: rows, series: series, total: tot, nSighter: rows.length - match.length, nMatch: match.length, bad: bad, near: near };
  }
  // 要使用者看的「問題」清單（依畫面順序）：bad 的列、bad 的小計、bad 的總分；near 排在後面
  function problems(model, ck) {
    ck = ck || check(model); var out = [];
    ck.rows.forEach(function (r) { if (r.status === 'bad') out.push({ type: 'row', i: r.i, lv: 'bad' }); });
    ck.series.forEach(function (s) { if (s.status === 'bad') out.push({ type: 'sub', k: s.k, lv: 'bad' }); });
    if (ck.total.status === 'bad') out.push({ type: 'total', lv: 'bad' });
    ck.rows.forEach(function (r) { if (r.status === 'near') out.push({ type: 'row', i: r.i, lv: 'near' }); });
    return out;
  }

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
    var rec = base, now = Date.now(), sg = [], mt = [], mi = 0, nxy = [];
    // 比賽發依「第幾發」分張（第 1–10 發＝第 1 張…）：中間有一發沒座標被略過，後面的發也不會跑到別張
    model.shots.forEach(function (q) {
      var at = q.sighter ? -1 : mi++;
      var sw = !!(q.ocr && q.ocr.scoreWins && !q.ed); // v3.1.0：分數跟座標對不上又反解不出來 → 分數為準，座標不進靶面/分析（留著給重新打開時參考）
      if (sw || q.x == null || q.y == null || !isFinite(q.x) || !isFinite(q.y)) { // v3.1.0：有分數、沒座標 → 不能放上靶面，但分數照算（存在 sius.noxy，重新打開時放回去）
        if (q.dec != null && isFinite(q.dec)) { var z = { s: q.sighter ? 1 : 0, pd: q.dec, t: q.t || '' }; if (q.inner) z.pi = 1; if (q.n != null) z.n = q.n; if (q.pn != null && q.pn !== q.n) z.pn = q.pn; if (q.blk) z.b = q.blk; if (q.hh != null) z.hh = q.hh; if (sw) z.sw = 1; if (q.x != null && isFinite(q.x)) z.x = r2(+q.x); if (q.y != null && isFinite(q.y)) z.y = r2(+q.y); nxy.push(z); }
        return;
      }
      var s = { x: r2(+q.x), y: r2(+q.y), src: 'sius', t: q.t || '' }; if (q.dec != null) s.pd = q.dec; if (q.inner) s.pi = 1; if (q.n != null) s.n = q.n; if (q.pn != null && q.pn !== q.n) s.pn = q.pn; if (q.blk) s.b = q.blk; if (q.hh != null) s.hh = q.hh;
      if (q.sighter) sg.push(s); else (mt[Math.floor(at / 10)] = mt[Math.floor(at / 10)] || []).push(s);
    });
    var sheets = [], k = 0, mk = function (shots, extra) { var h = { id: 'h' + now + (k++) + Math.floor(Math.random() * 1000), created: new Date(now).toISOString(), shots: shots, calib: { mode: 'sius' } }; for (var e in extra || {}) h[e] = extra[e]; return h; };
    if (sg.length) sheets.push(mk(sg, { sighter: true }));
    for (var i = 0; i < mt.length; i++) sheets.push(mk(mt[i] || []));
    rec.targetId = model.targetId; rec.sheets = sheets;
    if (model.name) rec.name = model.name;
    rec.sius = { v: 2, imported: new Date(now).toISOString(), subs: model.subs.map(function (s) { return s ? { dec: s.dec, inner: s.inner } : null; }), total: model.total ? { dec: model.total.dec, inner: model.total.inner } : null };
    if (nxy.length) rec.sius.noxy = nxy;
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
    (si.noxy || []).forEach(function (z) { // v3.1.0：沒座標的發放回原來的位置（依發序）
      var o = { n: z.n == null ? null : z.n, sighter: !!z.s, dec: z.pd, inner: !!z.pi, t: z.t || '', x: z.x == null ? null : z.x, y: z.y == null ? null : z.y }; if (z.pn != null) o.pn = z.pn; if (z.b) o.blk = z.b; if (z.hh != null) o.hh = z.hh; if (z.sw) o.ocr = { scoreWins: 1, rpXY: 1 };
      var at = m.shots.length; for (var i = 0; i < m.shots.length; i++) { var w = m.shots[i]; if (!!w.sighter === o.sighter && w.n != null && o.n != null && w.n > o.n) { at = i; break; } if (o.sighter && !w.sighter) { at = i; break; } }
      m.shots.splice(at, 0, o);
    });
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

  var api = { norm: norm, secOf: secOf, fmtSec: fmtSec, gapSec: gapSec, parseShot: parseShot, parseOther: parseOther, parseLine: parseLine, parsePass: parsePass, merge: merge, parseText: parseText, check: check, problems: problems, rhythm: rhythm, toRecord: toRecord, fromRecord: fromRecord, recName: recName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WRSius = api;
})(typeof window !== 'undefined' ? window : this);
