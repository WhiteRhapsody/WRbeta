/* WRbeta v2.9.6 小白單實驗引擎 — M5 跨照排序與全域序列對齊模組（UMD：Node module.exports / Browser window.WRSiusXAlign）。
 * 輸入：多張照片、多種讀法的 M4 ParsedRowCandidate 集合。
 * 輸出：AlignedMatchSlots（含自動排序後照片資訊、試射與正式賽標準槽位、跨照獨立證據統計、小計／總分槽位與缺漏小計清單）。 */
(function (root) {
  'use strict';

  var _P = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('./sius-x-parse.js') : null;
  function parser() { return _P || root.WRSiusXParse || (typeof WRSiusXParse !== 'undefined' ? WRSiusXParse : null); }

  var KIND_WEIGHT = { strips: 1.0, strips2: 1.0, strips08: 0.95, col: 0.6, text: 1.0 };

  function passKindWeight(kind) {
    if (!kind) return 1.0;
    if (KIND_WEIGHT[kind] != null) return KIND_WEIGHT[kind];
    if (/col/i.test(kind)) return 0.65;
    if (/08/.test(kind)) return 0.95;
    return 1.0;
  }

  function medianNum(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* v3.0.3：一次讀法裡每一發屬於第幾組（0 起算）。依印出來的順序走：
   *   跳回 1 而且時間往後（rs）＝新的一組（同一時間已經開過組的＝分段重疊重讀，不重開）；
   *   時間往回（分段重疊重讀）＝回到時間最接近、不晚於它的那一發的組；其他照前一發。 */
  function localBlocks(ts, rs, gapSec) {
    var out = new Array(ts.length), seen = [], starts = [], cur = 0, lastT = null, nb = 0;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i], b = cur;
      if (t != null) {
        var exact = null; for (var j = 0; j < seen.length; j++) if (Math.abs(seen[j][0] - t) < 0.005) { exact = seen[j][1]; break; }
        if (rs[i]) {
          var st = null; for (j = 0; j < starts.length; j++) if (Math.abs(starts[j][0] - t) < 0.005) { st = starts[j][1]; break; }
          if (st != null) b = st; else if (exact != null) b = exact; else { nb++; b = nb; starts.push([t, b]); }
        } else if (exact != null) b = exact;
        else if (lastT != null && gapSec(t, lastT) != null && gapSec(t, lastT) < 900) { // 往回：找不晚於它、最接近的一發
          var bb = null, bd = 1e9; for (j = 0; j < seen.length; j++) { var g = gapSec(seen[j][0], t); if (g != null && g < bd) { bd = g; bb = seen[j][1]; } }
          if (bb != null) b = bb;
        }
        seen.push([t, b]); lastT = t;
      }
      out[i] = b; cur = b;
    }
    return out;
  }

  /* ---------- 1) 單一讀法（Pass）內部分段（試射 Q／比賽 M）與 Viterbi 發序對齊 ---------- */
  function alignSinglePass(rows, passInfo) {
    var P = parser(), secOf = P.secOf, gapSec = P.gapSec, resetT = passInfo && passInfo.resetT; // resetT：只准在這些時間開新的一組（全單確認過的）
    var es = [];
    (rows || []).forEach(function (r) {
      if (!r || r.kind === 'target') return;
      if (r.kind === 'shot') { es.push({ k: 'shot', p: r }); return; }
      var o = { kind: r.kind };
      if (r.dec != null) o.dec = r.dec;
      if (r.inner != null) o.inner = r.inner;
      if (r.int) o.int = true;
      if (r.gun) o.gun = r.gun;
      if (r.count !== undefined) o.count = r.count;
      if (r.text !== undefined) o.text = r.text;
      es.push({ k: o.kind, o: o });
    });

    var sec = null, hdr = [], segs = [], seg = null, hasMatch = false, pend0 = false;
    var nextShot = function (i) {
      for (var j = i + 1; j < es.length; j++) {
        if (es[j].k === 'shot') return es[j];
        if (es[j].k === 'match' || es[j].k === 'qual') return null;
      }
      return null;
    };
    var newSeg = function (s2, start) { seg = { sec: s2, start: start, items: [] }; segs.push(seg); };

    es.forEach(function (e, i) {
      // v3.0.3：「Qualification」是整場的階段名稱，不是試射開始（官方）→ 只記「下一發是第 1 發」，試射／正式交給 P 和 Match 行
      if (e.k === 'qual') { sec = null; pend0 = true; return; }
      if (e.k === 'match') { sec = 'M'; newSeg('M', 0); hasMatch = true; pend0 = false; return; }
      if (e.k === 'event' || e.k === 'date' || e.k === 'name' || e.k === 'target') { hdr.push(e.o); return; }
      if (e.k === 'sub') { if (sec !== 'M') { sec = 'M'; newSeg('M', null); } seg.items.push(e); return; }
      if (e.k === 'total') { if (!seg) newSeg('M', null); seg.items.push(e); return; }
      var p = e.p, nx = nextShot(i);
      if (sec === null) { // 開頭看這發＋後面兩發的 P 多數決（第 1 發的 P 讀漏不會變成正式）
        var nP = p.P ? 1 : 0, nA = 1, j3 = i;
        while (nA < 3) { var e3 = nextShot(j3); if (!e3) break; nA++; if (e3.p.P) nP++; j3 = es.indexOf(e3); }
        sec = nP * 2 >= nA && nP > 0 ? 'Q' : 'M'; newSeg(sec, pend0 ? 0 : null); pend0 = false;
      }
      else if (sec === 'Q' && !p.P && (!nx || !nx.p.P)) { sec = 'M'; newSeg('M', null); }
      else if (sec === 'M' && p.P && nx && nx.p.P) { sec = 'Q'; newSeg('Q', null); }
      seg.items.push(e);
    });

    var out = [], segNo = -1;
    segs.forEach(function (sg) {
      segNo++;
      if (sg.start !== 0) {
        var f0 = -1;
        sg.items.forEach(function (e, ix) { if (f0 < 0 && e.k === 'shot' && e.p.nc.length) f0 = ix; });
        sg.items = sg.items.filter(function (e, ix) { return e.k !== 'shot' || f0 < 0 ? e.k !== 'shot' : ix >= f0; });
      }
      var L = sg.items.filter(function (e) { return e.k === 'shot'; });
      if (!L.length) {
        sg.items.forEach(function (e) {
          if (e.k === 'sub') out.push({ k: 'sub', idx: null, dec: e.o.dec, inner: e.o.inner, int: !!e.o.int });
          else if (e.k === 'total') out.push({ k: 'total', dec: e.o.dec, inner: e.o.inner, int: !!e.o.int });
        });
        return;
      }
      var subAfter = [], li = -1;
      sg.items.forEach(function (e) { if (e.k === 'shot') li++; else if (e.k === 'sub' && li >= 0) subAfter[li] = true; });
      var ts = L.map(function (e) { return secOf(e.p.t); });
      var INF = 1e9, layers = [];

      for (var i = 0; i < L.length; i++) {
        var cand = {}, nc = L[i].p.nc;
        nc.forEach(function (v) { if (v <= 99) cand[v] = 0; });
        if (i === 0) {
          if (sg.start === 0) cand[1] = cand[1] === 0 ? 0 : 1.6;
          for (var a = 1; a < Math.min(4, L.length); a++) {
            L[a].p.nc.forEach(function (v) { if (v - a >= 1 && cand[v - a] == null) cand[v - a] = 1.6; });
          }
        } else {
          Object.keys(layers[i - 1]).forEach(function (pv) {
            pv = +pv;
            for (var d = 1; d <= 4; d++) if (pv + d <= 99 && cand[pv + d] == null) cand[pv + d] = 1.6;
          });
        }
        var lay = {};
        Object.keys(cand).forEach(function (v) {
          v = +v;
          var em = cand[v] + (subAfter[i] && v % 10 ? 2 : 0), best = INF, from = null, rsB = false;
          if (i === 0) {
            best = em + (sg.start === 0 ? (v - 1) * 0.8 : 0);
          } else {
            Object.keys(layers[i - 1]).forEach(function (pv) {
              var P0 = layers[i - 1][pv], d = v - (+pv), tc;
              var rs = false;
              if (d >= 1 && d <= 4) tc = d - 1;
              else if (d <= 0 && d >= -7) {
                var back = ts[i] != null && ts[i - 1] != null && gapSec(ts[i], ts[i - 1]) != null;
                tc = back ? 0.6 : (d === 0 && ts[i] != null && ts[i] === ts[i - 1] ? 0.6 : 2.6);
              } else tc = 4;
              // v3.0.3：序號跳回 1（或 2）、時間照樣往後走＝新的一組（官方：試射每組各自編號；正式可設定每組從 1 重編）
              if (d < 0 && v <= 2 && +pv >= 3 && cand[v] === 0 && ts[i] != null && ts[i - 1] != null && gapSec(ts[i - 1], ts[i]) != null && 0.5 < tc && (!resetT || resetT[L[i].p.t])) { tc = 0.5; rs = true; }
              if (P0.c + tc + em < best) { best = P0.c + tc + em; from = +pv; rsB = rs; }
            });
          }
          if (best < INF) lay[v] = { c: best, from: from, guess: cand[v] > 0, rs: rsB };
        });
        var ks = Object.keys(lay).sort(function (x, y) { return lay[x].c - lay[y].c; }).slice(0, 40), lay2 = {};
        ks.forEach(function (k2) { lay2[k2] = lay[k2]; });
        layers.push(lay2);
      }

      var lastL = layers[layers.length - 1], bk = null;
      Object.keys(lastL).forEach(function (k2) { if (bk == null || lastL[k2].c < lastL[bk].c) bk = k2; });
      var ns = new Array(L.length), gs = new Array(L.length), rsA = new Array(L.length), cur = +bk;
      for (i = L.length - 1; i >= 0; i--) { var node = layers[i][cur]; ns[i] = cur; gs[i] = node.guess; rsA[i] = !!node.rs; cur = node.from; }
      var lbs = localBlocks(ts, rsA, gapSec);

      li = -1;
      var lastN = null;
      sg.items.forEach(function (e) {
        if (e.k === 'shot') {
          li++;
          out.push({ k: 'shot', sec: sg.sec, n: ns[li], guess: gs[li], p: e.p, lb: lbs[li], sg: segNo, rs: rsA[li] });
          lastN = ns[li];
        } else if (e.k === 'sub') {
          var nxN = null;
          for (var j = li + 1; j < L.length; j++) { nxN = ns[j]; break; }
          var idx = lastN != null && lastN % 10 === 0 ? lastN / 10 - 1 : nxN != null && nxN % 10 === 1 ? (nxN - 1) / 10 - 1 : null;
          out.push({ k: 'sub', idx: idx, dec: e.o.dec, inner: e.o.inner, int: !!e.o.int });
        } else if (e.k === 'total') {
          out.push({ k: 'total', dec: e.o.dec, inner: e.o.inner, int: !!e.o.int });
        }
      });
    });

    void passInfo;
    return { items: out, hdr: hdr, hasMatch: hasMatch };
  }

  /* v3.0.3：每次讀法的「段＋組」對到全單的組號（0 起算），用同一個時間字串＝同一發來對；
   *   對不到：同一次讀法裡前一組的下一組（這組是跳回 1 開始的）或同一組（只是 P 讀漏被切段）；第一組對不到就接最後一組。
   *   每組的發數＝這組讀到最大的序號（不含推的）；off[sec+組號]＝前面幾組的發數加總（內部連號用）。 */
  function globalBlocks(passResults) {
    var tmap = { Q: {}, M: {} }, last = { Q: 0, M: 0 }, maxN = {}, any = { Q: false, M: false };
    passResults.forEach(function (pr) {
      var loc = [], byKey = {};
      pr.items.forEach(function (it) { if (it.k !== 'shot') return; var k = it.sec + '|' + (it.sg || 0) + '|' + (it.lb || 0); if (!byKey[k]) { byKey[k] = { sec: it.sec, items: [], rs: !!it.rs }; loc.push(byKey[k]); } byKey[k].items.push(it); });
      var prev = { Q: null, M: null };
      loc.forEach(function (L) {
        var sec = L.sec, vt = {}, best = null, bv = 0;
        L.items.forEach(function (it) { var t = it.p.t, g = t && tmap[sec][t]; if (g) Object.keys(g).forEach(function (b) { vt[b] = (vt[b] || 0) + g[b]; }); });
        Object.keys(vt).forEach(function (b) { if (vt[b] > bv) { bv = vt[b]; best = +b; } });
        var gb;
        if (best != null) gb = best;
        else if (prev[sec] != null) gb = L.rs ? prev[sec] + 1 : prev[sec];
        else gb = any[sec] ? last[sec] : 0;
        L.items.forEach(function (it) { it.gb = gb; var t = it.p.t; if (t) { var o = tmap[sec][t] = tmap[sec][t] || {}; o[gb] = (o[gb] || 0) + 1; } if (!it.guess) maxN[sec + gb] = Math.max(maxN[sec + gb] || 0, it.n); });
        prev[sec] = gb; any[sec] = true; last[sec] = Math.max(last[sec], gb);
      });
    });
    var off = {}, nBlk = { Q: last.Q + 1, M: last.M + 1 };
    ['Q', 'M'].forEach(function (sec) { var acc = 0; for (var b = 0; b <= last[sec]; b++) { off[sec + b] = acc; acc += maxN[sec + b] || 0; } });
    return { off: off, n: nBlk, maxN: maxN };
  }

  /* ---------- 2) 跨照片順序自動推斷（支援下段在前、上段在後） ---------- */
  function orderPhotos(passResults) {
    var byImg = {};
    passResults.forEach(function (pr) {
      var im = pr.img != null ? pr.img : 0;
      if (!byImg[im]) byImg[im] = { img: im, hasHdr: false, hasQual: false, hasTotal: false, mNs: [], qNs: [] };
      var b = byImg[im];
      if (pr.hdr && pr.hdr.length) b.hasHdr = true;
      pr.items.forEach(function (it) {
        if (it.k === 'total') b.hasTotal = true;
        if (it.k === 'shot') {
          if (it.sec === 'Q') { b.hasQual = true; if (!it.guess) b.qNs.push(it.n); }
          else if (!it.guess) b.mNs.push(it.n);
        }
      });
    });
    var list = Object.keys(byImg).map(function (k) {
      var b = byImg[k];
      b.medM = medianNum(b.mNs);
      b.minM = b.mNs.length ? Math.min.apply(null, b.mNs) : null;
      b.maxM = b.mNs.length ? Math.max.apply(null, b.mNs) : null;
      // 排序鍵：有表頭／試射但比賽中位數小者在前；否則依比賽發序中位數排序
      b.rank = b.medM != null ? b.medM : (b.hasHdr || b.hasQual ? -10 : (b.hasTotal ? 100 : b.img));
      return b;
    });
    list.sort(function (a, b) { return a.rank - b.rank || a.img - b.img; });
    return list;
  }

  /* ---------- 3) 多照片、多讀法全域槽位對齊（產出 AlignedMatchSlots） ---------- */
  function voteWeighted(list, keyFn) {
    var m = {};
    list.forEach(function (o) {
      if (o.v == null) return;
      var k = keyFn ? keyFn(o.v) : String(o.v);
      if (!m[k]) m[k] = { v: o.v, w: 0, rawW: 0, n: 0, imgs: {}, nonCol: 0 };
      m[k].w += o.w;
      m[k].rawW += (o.rawW != null ? o.rawW : o.w);
      m[k].n += 1;
      if (o.img != null) m[k].imgs[o.img] = true;
      if (o.kind !== 'col') m[k].nonCol += 1;
    });
    return Object.keys(m).map(function (k) {
      var x = m[k];
      x.imgCount = Object.keys(x.imgs).length;
      return x;
    }).sort(function (a, b) { return b.w - a.w || b.imgCount - a.imgCount || b.n - a.n; });
  }

  function f1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* v3.0.2：試射／正式依時間分開（White 2026-11-27 11:02「只有落在試射時間範圍內的才算試射；每一發只能配對一次」）
   * 1) 同一個時間字串＝同一發：分散在不同槽位（例如同一發被一張照片當試射、另一張當正式）的讀法全部收到同一個槽位。
   *    有正式讀法、而且時間不在試射範圍（第 1 發正式之前 25 分鐘內）或接得上正式前後發 → 歸正式；否則歸權重最大的槽位。
   * 2) 試射照發序把時間攤平（跨整點接上），晚於第 1 發正式的「試射」改成正式同一發序（只在讀到小計／總分時；只有試射的單不做）。 */
  function splitByTime(groups, P, realMatch, dedupeOnly) {
    var secOf = P.secOf, gapSec = P.gapSec, WIN = 1500, MAXG = 600;
    var majT = function (g) { var v = voteWeighted(g.reads.map(function (r) { return { v: r.p.t, w: r.ew }; })); return v.length ? v[0].v : null; };
    if (dedupeOnly) { // v3.0.3：只做「同一個時間字串＝同一發」：散在好幾格的讀法收到權重最大的那格（不跨試射／正式）
      var byT0 = {};
      Object.keys(groups).forEach(function (k) { groups[k].reads.forEach(function (r) { if (r.p.t) (byT0[r.p.t] = byT0[r.p.t] || {})[k] = (byT0[r.p.t][k] || 0) + r.ew; }); });
      Object.keys(byT0).forEach(function (t) {
        var ks = Object.keys(byT0[t]); if (ks.length < 2) return;
        ['Q', 'M'].forEach(function (sec) {
          var kk = ks.filter(function (k) { return groups[k].sec === sec; }); if (kk.length < 2) return;
          var best = kk.slice().sort(function (a, b) { return byT0[t][b] - byT0[t][a]; })[0];
          kk.forEach(function (k) { if (k === best) return; var g = groups[k], mv = g.reads.filter(function (r) { return r.p.t === t; }); g.reads = g.reads.filter(function (r) { return r.p.t !== t; }); groups[best].reads = groups[best].reads.concat(mv); });
        });
      });
      Object.keys(groups).forEach(function (k) { if (!groups[k].reads.length) delete groups[k]; });
      return;
    }
    var mList = function () { return Object.keys(groups).filter(function (k) { return groups[k].sec === 'M' && groups[k].reads.length; }).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.n - b.n; }); };
    var M = mList(), m1 = null;
    // 第 1 發正式的時間：從第 1 發往後找，要接得上下一發（第 1 發被別的發混進來、主流時間錯了也不會帶歪）
    var mts = M.map(function (g) { var t = majT(g); return t ? secOf(t) : null; });
    for (var i = 0; i < M.length && m1 == null; i++) {
      if (mts[i] == null) continue;
      var nx = null; for (var j2 = i + 1; j2 < M.length; j2++) if (mts[j2] != null) { nx = j2; break; }
      if (nx == null) { m1 = mts[i]; break; }
      var gg = gapSec(mts[i], mts[nx]); if (gg != null && gg <= Math.min(MAXG * (M[nx].n - M[i].n), 1799)) m1 = mts[i];
    }
    if (m1 == null) for (i = 0; i < M.length && m1 == null; i++) if (mts[i] != null) m1 = mts[i];
    if (m1 == null) return;
    var inWin = function (t) { var s = secOf(t); if (s == null) return true; var g = gapSec(s, m1); return g != null && g <= WIN; };
    var mT = {}; M.forEach(function (g) { var t = majT(g); if (t) mT[g.n] = secOf(t); });
    var fitsM = function (n, t) {
      var s = secOf(t); if (s == null) return false;
      if (mT[n] != null && Math.abs(mT[n] - s) < 0.005) return true;
      var a = null, b = null, k;
      var da = 0, db = 0;
      for (k = n - 1; k >= 1 && k >= n - 12; k--) if (mT[k] != null) { a = mT[k]; da = n - k; break; }
      for (k = n + 1; k <= n + 12; k++) if (mT[k] != null) { b = mT[k]; db = k - n; break; }
      if (a == null && b == null) return false;
      var ga = a == null ? 0 : gapSec(a, s), gb = b == null ? 0 : gapSec(s, b);
      return ga != null && gb != null && ga <= Math.min(MAXG * da, 1799) && gb <= Math.min(MAXG * db, 1799);
    };
    var get = function (sec, n, pn) { var k = sec + n; return groups[k] || (groups[k] = { sec: sec, n: n, pn: pn != null ? pn : n, blk: 0, reads: [] }); };
    // 0) 同一個槽位裡時間差很多的讀法要分開（例：試射 1＝6 分 44:30.00 被塞進正式 1＝9 分 50:55.06 當「其他讀法」）：
    //    槽位內依時間分群；接不上自己這一段前後發、卻接得上另一段同號前後發（而且符合試射範圍）的那一群 → 搬過去
    var secT = function (sec) { var o = {}; Object.keys(groups).forEach(function (k) { var g = groups[k]; if (g.sec !== sec) return; var t = majT(g); if (t && secOf(t) != null) o[g.n] = secOf(t); }); return o; };
    var QT = secT('Q'), MT = secT('M');
    var tdist = function (a, b) { var d = Math.abs(a - b) % 3600; return Math.min(d, 3600 - d); };
    var fitsNb = function (sec, n, sv) { // 只看前後發（不看自己那一號）
      var o = sec === 'Q' ? QT : MT, k, a = null, b = null, da = 0, db = 0;
      for (k = n - 1; k >= 1 && k >= n - 5; k--) if (o[k] != null) { a = o[k]; da = n - k; break; }
      for (k = n + 1; k <= n + 5; k++) if (o[k] != null) { b = o[k]; db = k - n; break; }
      if (a == null && b == null) return sec === 'Q' && n <= 2;
      var ga = a == null ? 0 : gapSec(a, sv), gb = b == null ? 0 : gapSec(sv, b);
      return ga != null && gb != null && ga <= Math.min(MAXG * da, 1799) && gb <= Math.min(MAXG * db, 1799);
    };
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], cl = [];
      g.reads.forEach(function (r) {
        var sv = r.p.t ? secOf(r.p.t) : null; if (sv == null) return;
        var c = cl.filter(function (x) { return tdist(x.s, sv) <= 90; })[0];
        if (c) { c.reads.push(r); c.w += r.ew; } else cl.push({ s: sv, t: r.p.t, reads: [r], w: r.ew });
      });
      if (cl.length < 2) return;
      var to = g.sec === 'M' ? 'Q' : 'M';
      cl.forEach(function (c) {
        if (fitsNb(g.sec, g.n, c.s)) return;
        var w = inWin(c.t); if (!(g.sec === 'M' ? w : !w) || !fitsNb(to, g.n, c.s)) return;
        g.reads = g.reads.filter(function (r) { return c.reads.indexOf(r) < 0; });
        var tg = get(to, g.n); tg.reads = tg.reads.concat(c.reads);
      });
    });
    // 1) 同時間＝同一發
    var byT = {};
    Object.keys(groups).forEach(function (k) { groups[k].reads.forEach(function (r) { if (r.p.t) (byT[r.p.t] = byT[r.p.t] || {})[k] = (byT[r.p.t][k] || 0) + r.ew; }); });
    Object.keys(byT).forEach(function (t) {
      var ks = Object.keys(byT[t]); if (ks.length < 2) return;
      var hasM = ks.some(function (k) { return groups[k].sec === 'M'; });
      var pool = ks;
      if (hasM) {
        var mks = ks.filter(function (k) { return groups[k].sec === 'M'; });
        var toM = !inWin(t) || mks.some(function (k) { return fitsM(groups[k].n, t); });
        if (toM) pool = mks;
      }
      var best = pool.slice().sort(function (a, b) { return byT[t][b] - byT[t][a]; })[0];
      ks.forEach(function (k) {
        if (k === best) return;
        var g = groups[k], mv = g.reads.filter(function (r) { return r.p.t === t; });
        g.reads = g.reads.filter(function (r) { return r.p.t !== t; });
        groups[best].reads = groups[best].reads.concat(mv);
      });
    });
    // 2) 試射時間範圍：試射照發序排、時間攤平（跨整點 +3600），以第一發試射為基準算出第 1 發正式的時間；
    //    晚於第 1 發正式的「試射」都是正式的發 → 搬到正式同一發序（同一發序已有讀法就合併投票，不會變成兩發）
    if (realMatch) {
      var Q = Object.keys(groups).filter(function (k) { return groups[k].sec === 'Q' && groups[k].reads.length; }).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.n - b.n; });
      var prev = null, base = null, m1u = null;
      Q.forEach(function (g) {
        var t = majT(g), sv = t ? secOf(t) : null; if (sv == null) { g._u = null; return; }
        if (base == null) { base = sv; m1u = sv + ((m1 - sv) % 3600 + 3600) % 3600; prev = sv; g._u = sv; return; }
        var d = ((sv - prev) % 3600 + 3600) % 3600, u = d > 3000 ? prev - (3600 - d) : prev + d; // 往回 10 分鐘內（讀錯／順序亂）不算跨整點
        g._u = u; prev = Math.max(prev, u);
      });
      Q.forEach(function (g) {
        var u = g._u; delete g._u;
        if (u == null || m1u == null || u <= m1u) return;
        var tg = get('M', g.n); tg.reads = tg.reads.concat(g.reads); g.reads = [];
      });
    }
    Object.keys(groups).forEach(function (k) { if (!groups[k].reads.length) delete groups[k]; });
  }

  function alignPasses(passes, opt) {
    opt = opt || {};
    var P = parser();
    var rowsOf = (passes || []).map(function (ps, pi) {
      return ps.rows || (ps.lines || []).map(function (ln, li) {
        var meta = {
          img: ps.img,
          kind: ps.kind,
          symbols: ps.lineSymbols && ps.lineSymbols[li],
          charConf: ps.lineCharConf && ps.lineCharConf[li],
          arrow: ps.lineArrows && ps.lineArrows[li],
          minusHint: ps.lineMinus && ps.lineMinus[li],
          edgeClipped: ps.edgeLines && ps.edgeLines[li]
        };
        return P.parseRow(ln, meta);
      });
    });
    var alignAll = function (resetT) { return (passes || []).map(function (ps, pi) {
      var aligned = alignSinglePass(rowsOf[pi], resetT ? Object.assign({}, ps, { resetT: resetT }) : ps);
      return { pi: pi, img: ps.img != null ? ps.img : 0, kind: ps.kind || 'strips', hdr: aligned.hdr, items: aligned.items, hasMatch: aligned.hasMatch };
    }); };
    var passResults = alignAll(null);
    // v3.0.3：「跳回 1＝新的一組」要至少 2 次讀法在同一個時間都這樣讀才算（單一次讀法把 21 讀成 1 不會開新組）；有不算數的就重排一次
    var rsC = {}, rsAny = false;
    passResults.forEach(function (pr) { var seen = {}; pr.items.forEach(function (it, ii, arr) { var nx = arr[ii + 1]; if (it.k === 'shot' && it.rs) rsAny = true; if (it.k === 'shot' && it.rs && it.p.t && !seen[it.p.t] && nx && nx.k === 'shot' && nx.sec === it.sec && nx.n === it.n + 1) { seen[it.p.t] = 1; rsC[it.p.t] = (rsC[it.p.t] || 0) + 1; rsAny = true; } }); });
    if (rsAny) { var okT = {}; Object.keys(rsC).forEach(function (t) { if (rsC[t] >= 2) okT[t] = 1; }); passResults = alignAll(okT); }

    // v3.0.3【White 2026-11-27「照單子」】試射／正式以每發的 P 和「Match」行為準（官方：正式一定要手動切換，切換處印 Match，正式不印 P，最後印 TOTAL）。
    //   整張都沒讀到 Match 行、小計、總分，而且大多數發有 P → 這張單全部是試射（練習單）：全部當試射，不開正式空格。
    var hasMatch = passResults.some(function (pr) { return pr.hasMatch; }), hasSubTot = false, nRd = 0, nP = 0;
    passResults.forEach(function (pr) { pr.items.forEach(function (it) { if (it.k === 'sub' || it.k === 'total') hasSubTot = true; else if (it.k === 'shot') { nRd++; if (it.p.P) nP++; } }); });
    var practice = !hasMatch && !hasSubTot && nRd >= 3 && nP >= nRd * 0.8; // Gemini 審查：門檻從一半提高到 8 成（避免只拍到上半張、Match 讀漏的比賽單）
    if (practice) passResults.forEach(function (pr) { pr.items.forEach(function (it) { if (it.k === 'shot') it.sec = 'Q'; }); });

    // 自動排序照片（不依賴上傳順序）
    var photoOrder = orderPhotos(passResults);
    var orderRank = {};
    photoOrder.forEach(function (po, idx) { orderRank[po.img] = idx; });
    passResults.sort(function (a, b) {
      return (orderRank[a.img] - orderRank[b.img]) || (a.pi - b.pi);
    });

    // v3.0.3：組號（序號跳回 1＝新的一組）→ 全單一致的組號 → 內部連號（印的序號留在 pn）
    var blk = globalBlocks(passResults);
    var groups = {}, subs = {}, totals = [], hdr = [];
    passResults.forEach(function (pr) {
      var kw = passKindWeight(pr.kind);
      hdr = hdr.concat(pr.hdr);
      pr.items.forEach(function (it) {
        if (it.k === 'shot') {
          var gb = it.gb || 0, pn = it.n, nn = (blk.off[it.sec + gb] || 0) + it.n;
          var key = it.sec + nn;
          var baseW = it.guess ? 0.5 : 1.0;
          var ew = baseW * kw;
          if (it.p.hints && it.p.hints.xySpaced) ew *= 0.35;
          (groups[key] = groups[key] || { sec: it.sec, n: nn, pn: pn, blk: gb, reads: [] }).reads.push({
            p: it.p,
            w: baseW,
            ew: ew,
            guess: !!it.guess,
            pi: pr.pi,
            img: pr.img,
            kind: pr.kind
          });
        } else if (it.k === 'sub') {
          if (it.idx != null && it.idx >= 0 && it.idx < 20) {
            (subs[it.idx] = subs[it.idx] || []).push({ v: f1(it.dec) + '-' + it.inner, w: kw, img: pr.img, kind: pr.kind });
          }
        } else if (it.k === 'total') {
          totals.push({ v: f1(it.dec) + '-' + it.inner, w: kw, img: pr.img, kind: pr.kind });
        }
      });
    });

    // 時間錨點重對齊：若某讀法的時間 mm:ss.ss 與另一槽位的主流時間完全相同，代表發序誤判 → 搬回正確槽位
    var gk = Object.keys(groups), tmaj = {};
    gk.forEach(function (k) {
      var v = voteWeighted(groups[k].reads.map(function (r) { return { v: r.p.t, w: r.ew, rawW: r.w, img: r.img, kind: r.kind }; }));
      if (v.length) tmaj[k] = v[0].v;
    });
    var byT = {};
    gk.forEach(function (k) { if (tmaj[k]) byT[tmaj[k]] = byT[tmaj[k]] ? '*' : k; });
    gk.forEach(function (k) {
      var g = groups[k];
      g.reads = g.reads.filter(function (r) {
        var o = r.p.t && byT[r.p.t];
        if (o && o !== '*' && o !== k && r.p.t !== tmaj[k]) {
          groups[o].reads.push(r);
          return false;
        }
        return true;
      });
    });

    // v3.0.2【White 2026-11-27 11:02】試射／正式依時間分開、每一發只配對一次
    // v3.0.3：改成備用——練習單（全 P）或序號重編成好幾組時，只做「同一時間＝同一發」，不再依時間把發搬到另一段；
    //   一般單（一組試射＋Match＋正式）仍用原本的時間修正（只修讀錯槽位的讀法，試射／正式的分界以 P、Match 為準）
    var multiBlk = Object.keys(groups).some(function (k) { return groups[k].blk > 0; });
    if (opt.splitByTime !== false) splitByTime(groups, P, Object.keys(subs).length > 0 || totals.length > 0 || Object.keys(groups).filter(function (k) { return groups[k].sec === 'M'; }).length >= 10, practice || multiBlk);

    // 槍種、發數、日期投票與格式推斷
    var gv = voteWeighted(hdr.filter(function (h) { return h.kind === 'event'; }).map(function (h) { return { v: h.gun, w: 1 }; }));
    var cv = voteWeighted(hdr.filter(function (h) { return h.kind === 'event' && h.count; }).map(function (h) { return { v: h.count, w: 1 }; }));
    var dv = voteWeighted(hdr.filter(function (h) { return h.kind === 'date'; }).map(function (h) { return { v: h.text, w: 1 }; }));
    var nv = voteWeighted(hdr.filter(function (h) { return h.kind === 'name'; }).map(function (h) { return { v: h.text, w: 1 }; })); // v3.0.3 姓名列
    var lv = voteWeighted(hdr.filter(function (h) { return h.kind === 'target'; }).map(function (h) { var m = String(h.text).match(/(\d{1,3})/); return { v: m ? m[1] : null, w: 1 }; })); // v3.0.3 靶位

    var nInt = 0, nDec = 0;
    Object.keys(groups).forEach(function (k) {
      groups[k].reads.forEach(function (r) {
        if (r.p.dec != null && !r.p.decInt) nDec++;
        if (r.p.iv != null) nInt++;
      });
    });
    var fmtGuess = nInt >= 10 && nDec < nInt * 0.3 ? 'ap10' : nDec >= 10 && nDec >= nInt ? 'ar10' : null;
    var hdrId = gv.length ? gv[0].v : null;
    if (!gv.length && opt.fmtGuess !== false && fmtGuess === 'ap10') gv = [{ v: 'ap10', w: 0, fmt: true }];
    var autoId = gv.length ? gv[0].v : null;
    var tid = opt.targetId || autoId || 'ar10';

    var ev = hdr.filter(function (h) { return h.kind === 'event' && h.gun === autoId; })[0];
    var eventText = '';
    if (ev) {
      var et = ev.text.replace(/[^\w\s.\-()/]/g, ' ');
      var em2 = et.match(/(?:air\s*)?(?:rifle|pistol)\b.*$/i);
      eventText = (em2 ? em2[0] : et).replace(/\s+/g, ' ').trim();
    }

    // 整理標準槽位清單（Q 與 M）與重疊統計
    var qSlots = [], mSlots = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (!g.reads.length) return;
      var imgs = {};
      g.reads.forEach(function (r) { if (r.img != null) imgs[r.img] = true; });
      var slot = {
        sec: g.sec,
        n: g.n,
        pn: g.pn != null ? g.pn : g.n,
        blk: g.blk || 0,
        reads: g.reads,
        photoCount: Object.keys(imgs).length,
        photos: Object.keys(imgs).map(Number)
      };
      (g.sec === 'Q' ? qSlots : mSlots).push(slot);
    });
    qSlots.sort(function (a, b) { return a.n - b.n; });
    mSlots.sort(function (a, b) { return a.n - b.n; });

    var qMax = qSlots.length ? qSlots[qSlots.length - 1].n : 0;
    var mMax = mSlots.length ? mSlots[mSlots.length - 1].n : 0;
    var headerCount = cv.length ? cv[0].v : null;
    // v3.0.3：正式有幾發照單子實際印的算（讀到的最大發序、小計組數、有 TOTAL 才信項目名的發數），「Air Pistol 60」只當提示；練習單＝0
    var subIdx = Object.keys(subs).map(Number), subN = subIdx.length ? (Math.max.apply(null, subIdx) + 1) * 10 : 0;
    var matchCount = practice ? 0 : Math.max(mMax, subN, totals.length && headerCount && headerCount >= mMax ? headerCount : 0);

    // 小計與總分槽位＋缺漏小計編號（1 起算）；整張都沒讀到小計（可能設定成不印）就不報「小計沒拍到」
    var nSub = Math.ceil(matchCount / 10), anySub = subIdx.length > 0;
    var subSlots = [], missingSubtotals = [];
    for (var sIdx = 0; sIdx < nSub; sIdx++) {
      var sv = voteWeighted(subs[sIdx] || []);
      if (sv.length) {
        var pp = sv[0].v.split('-');
        subSlots.push({
          idx: sIdx,
          dec: +pp[0],
          inner: +pp[1],
          reads: sv[0].n,
          weight: sv[0].w,
          photoCount: sv[0].imgCount,
          conflict: sv.length > 1 && sv[1].w >= sv[0].w * 0.5
        });
      } else {
        subSlots.push(null);
        if (anySub) missingSubtotals.push(sIdx + 1);
      }
    }

    var tv = voteWeighted(totals);
    var totalSlot = null;
    if (tv.length) {
      var tp = tv[0].v.split('-');
      totalSlot = { dec: +tp[0], inner: +tp[1], reads: tv[0].n, weight: tv[0].w, photoCount: tv[0].imgCount };
    }

    // 偵測多照片接縫重疊或斷層
    var seamInfo = [];
    for (var pi2 = 0; pi2 + 1 < photoOrder.length; pi2++) {
      var a = photoOrder[pi2], b = photoOrder[pi2 + 1];
      if (a.maxM != null && b.minM != null) {
        seamInfo.push({
          fromImg: a.img,
          toImg: b.img,
          overlapRows: Math.max(0, a.maxM - b.minM + 1),
          gapRows: Math.max(0, b.minM - a.maxM - 1)
        });
      }
    }

    return {
      targetId: tid,
      gun: {
        id: autoId,
        auto: !opt.targetId && !!autoId,
        conflict: gv.length > 1,
        unverified: tid === 'ap10',
        header: hdrId,
        fmt: fmtGuess,
        guess: hdrId || fmtGuess,
        sure: !!hdrId && gv.length === 1 && (!fmtGuess || fmtGuess === hdrId)
      },
      event: eventText,
      count: headerCount,
      practice: practice,
      hasMatch: hasMatch,
      athlete: nv.length ? nv[0].v : '',
      lane: lv.length ? lv[0].v : '',
      blocks: blk,
      countHint: !practice && headerCount && matchCount < headerCount ? { header: headerCount, got: matchCount } : null,
      matchCount: matchCount,
      qMax: qMax,
      date: dv.length ? dv[0].v : '',
      photoOrder: photoOrder,
      seamInfo: seamInfo,
      qualSlots: qSlots,
      matchSlots: mSlots,
      subSlots: subSlots,
      totalSlot: totalSlot,
      missingSubtotals: missingSubtotals
    };
  }

  var api = {
    KIND_WEIGHT: KIND_WEIGHT,
    passKindWeight: passKindWeight,
    alignSinglePass: alignSinglePass,
    orderPhotos: orderPhotos,
    voteWeighted: voteWeighted,
    alignPasses: alignPasses,
    localBlocks: localBlocks,
    globalBlocks: globalBlocks
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WRSiusXAlign = api;
})(typeof window !== 'undefined' ? window : this);
