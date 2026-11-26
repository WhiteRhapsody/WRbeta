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

  /* ---------- 1) 單一讀法（Pass）內部分段（試射 Q／比賽 M）與 Viterbi 發序對齊 ---------- */
  function alignSinglePass(rows, passInfo) {
    var P = parser(), secOf = P.secOf, gapSec = P.gapSec;
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

    var sec = null, hdr = [], segs = [], seg = null;
    var nextShot = function (i) {
      for (var j = i + 1; j < es.length; j++) {
        if (es[j].k === 'shot') return es[j];
        if (es[j].k === 'match' || es[j].k === 'qual') return null;
      }
      return null;
    };
    var newSeg = function (s2, start) { seg = { sec: s2, start: start, items: [] }; segs.push(seg); };

    es.forEach(function (e, i) {
      if (e.k === 'qual') { sec = 'Q'; newSeg('Q', 0); return; }
      if (e.k === 'match') { sec = 'M'; newSeg('M', 0); return; }
      if (e.k === 'event' || e.k === 'date') { hdr.push(e.o); return; }
      if (e.k === 'sub') { if (sec !== 'M') { sec = 'M'; newSeg('M', null); } seg.items.push(e); return; }
      if (e.k === 'total') { if (!seg) newSeg('M', null); seg.items.push(e); return; }
      var p = e.p, nx = nextShot(i);
      if (sec === null) { sec = p.P ? 'Q' : 'M'; newSeg(sec, null); }
      else if (sec === 'Q' && !p.P && (!nx || !nx.p.P)) { sec = 'M'; newSeg('M', null); }
      else if (sec === 'M' && p.P && nx && nx.p.P) { sec = 'Q'; newSeg('Q', null); }
      seg.items.push(e);
    });

    var out = [];
    segs.forEach(function (sg) {
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
          var em = cand[v] + (subAfter[i] && v % 10 ? 2 : 0), best = INF, from = null;
          if (i === 0) {
            best = em + (sg.start === 0 ? (v - 1) * 0.8 : 0);
          } else {
            Object.keys(layers[i - 1]).forEach(function (pv) {
              var P0 = layers[i - 1][pv], d = v - (+pv), tc;
              if (d >= 1 && d <= 4) tc = d - 1;
              else if (d <= 0 && d >= -7) {
                var back = ts[i] != null && ts[i - 1] != null && gapSec(ts[i], ts[i - 1]) != null;
                tc = back ? 0.6 : (d === 0 && ts[i] != null && ts[i] === ts[i - 1] ? 0.6 : 2.6);
              } else tc = 4;
              if (P0.c + tc + em < best) { best = P0.c + tc + em; from = +pv; }
            });
          }
          if (best < INF) lay[v] = { c: best, from: from, guess: cand[v] > 0 };
        });
        var ks = Object.keys(lay).sort(function (x, y) { return lay[x].c - lay[y].c; }).slice(0, 40), lay2 = {};
        ks.forEach(function (k2) { lay2[k2] = lay[k2]; });
        layers.push(lay2);
      }

      var lastL = layers[layers.length - 1], bk = null;
      Object.keys(lastL).forEach(function (k2) { if (bk == null || lastL[k2].c < lastL[bk].c) bk = k2; });
      var ns = new Array(L.length), gs = new Array(L.length), cur = +bk;
      for (i = L.length - 1; i >= 0; i--) { var node = layers[i][cur]; ns[i] = cur; gs[i] = node.guess; cur = node.from; }

      li = -1;
      var lastN = null;
      sg.items.forEach(function (e) {
        if (e.k === 'shot') {
          li++;
          out.push({ k: 'shot', sec: sg.sec, n: ns[li], guess: gs[li], p: e.p });
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
    return { items: out, hdr: hdr };
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

  function alignPasses(passes, opt) {
    opt = opt || {};
    var P = parser();
    var passResults = (passes || []).map(function (ps, pi) {
      var rows = ps.rows || (ps.lines || []).map(function (ln, li) {
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
      var aligned = alignSinglePass(rows, ps);
      return { pi: pi, img: ps.img != null ? ps.img : 0, kind: ps.kind || 'strips', hdr: aligned.hdr, items: aligned.items };
    });

    // 自動排序照片（不依賴上傳順序）
    var photoOrder = orderPhotos(passResults);
    var orderRank = {};
    photoOrder.forEach(function (po, idx) { orderRank[po.img] = idx; });
    passResults.sort(function (a, b) {
      return (orderRank[a.img] - orderRank[b.img]) || (a.pi - b.pi);
    });

    var groups = {}, subs = {}, totals = [], hdr = [];
    passResults.forEach(function (pr) {
      var kw = passKindWeight(pr.kind);
      hdr = hdr.concat(pr.hdr);
      pr.items.forEach(function (it) {
        if (it.k === 'shot') {
          var key = it.sec + it.n;
          var baseW = it.guess ? 0.5 : 1.0;
          var ew = baseW * kw;
          if (it.p.hints && it.p.hints.xySpaced) ew *= 0.35;
          (groups[key] = groups[key] || { sec: it.sec, n: it.n, reads: [] }).reads.push({
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

    // 槍種、發數、日期投票與格式推斷
    var gv = voteWeighted(hdr.filter(function (h) { return h.kind === 'event'; }).map(function (h) { return { v: h.gun, w: 1 }; }));
    var cv = voteWeighted(hdr.filter(function (h) { return h.kind === 'event' && h.count; }).map(function (h) { return { v: h.count, w: 1 }; }));
    var dv = voteWeighted(hdr.filter(function (h) { return h.kind === 'date'; }).map(function (h) { return { v: h.text, w: 1 }; }));

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
    var matchCount = headerCount && headerCount >= mMax ? headerCount : mMax;

    // 小計與總分槽位＋缺漏小計編號（1 起算）
    var nSub = Math.ceil(matchCount / 10);
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
        missingSubtotals.push(sIdx + 1);
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
    alignPasses: alignPasses
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WRSiusXAlign = api;
})(typeof window !== 'undefined' ? window : this);
