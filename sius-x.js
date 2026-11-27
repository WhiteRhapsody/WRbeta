/* WRbeta v2.9.6 小白單「實驗引擎」（window.WRSiusX）：跟線上版 WRSiusOCR 完全分開的一套（自己的 Tesseract worker 池）。
 * 流程：照片 → 灰階（照 EXIF 轉正）→ 自動轉正（像素橫拍／倒拍）→ 切段（原型 (e) plan2：裁紙、依行距切段、校正傾斜＋彎曲、第二種切法、整欄）
 *       → 多個 worker 同時 OCR（iPhone 2 個，其他依 CPU／記憶體 2～3 個；所有照片的所有段排成一條佇列）
 *       → 合併後還有讀不到／對不上的，再補一種讀法（0.8 倍）。合併、核對在 sius-x-core.js（WRSiusXCore）。
 * run() 回傳 { passes, n, timing:{ decode, orient, segment, ocr, total }（毫秒）, info }，timing 會顯示在畫面上給使用者看速度。 */
(function (root) {
  'use strict';
  var VENDOR = 'vendor/tesseract/', CANCEL = { cancel: true };
  var CFG = { crop: 1, pitch: 56, seg: 1, zoom: 1, norm: 1, segLines: 8, curl: 'slice', pass2: { pitch: 46, off: 0.5 }, keepCol: 1 };
  function I() { return root.WRSiusXImg; }
  function X() { return root.WRSiusXCore; }
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function quiet(p) { if (p && p.catch) p.catch(function () {}); return p; }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); }; document.head.appendChild(s); }); }
  function base() { return new URL(VENDOR, root.location.href).href; }
  // 幾個 worker：iPhone／iPad（記憶體吃緊）2 個；其他 CPU ≥8 核且記憶體 ≥6GB（或量不到）3 個；否則 2 個
  function nWorkers() {
    var ua = (root.navigator && navigator.userAgent) || '', ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && root.navigator && navigator.maxTouchPoints > 1);
    if (ios) return 2;
    var hc = (root.navigator && navigator.hardwareConcurrency) || 4, dm = root.navigator && navigator.deviceMemory;
    return hc >= 8 && (!dm || dm >= 6) ? 3 : 2;
  }
  /* ---------- worker 池（stop() 換一代：載入中的 worker 載好發現換代就直接關掉，不留在背景） ---------- */
  var gen = 0, pool = [], pending = [], libP = null;
  function lib() { if (root.Tesseract) return Promise.resolve(); if (!libP) libP = loadScript(VENDOR + 'tesseract.min.js').catch(function (e) { libP = null; throw e; }); return libP; }
  function makeWorker(my) {
    var b = base();
    var p = root.Tesseract.createWorker('eng', 1, { workerPath: b + 'worker.min.js', corePath: b, langPath: b, gzip: true, workerBlobURL: false, cacheMethod: 'write' }).then(function (w) {
      if (my !== gen) { try { quiet(w.terminate()); } catch (e) {} throw CANCEL; }
      return w.setParameters({ tessedit_pageseg_mode: '6' }).then(function () { if (my !== gen) { try { quiet(w.terminate()); } catch (e) {} throw CANCEL; } pool.push(w); return w; });
    });
    pending.push(p); quiet(p); return p;
  }
  function getPool(n) {
    var my = gen;
    return lib().then(function () {
      if (my !== gen) throw CANCEL;
      var ps = []; for (var i = pool.length + pending.length; i < n; i++) ps.push(makeWorker(my));
      return Promise.all(pending.slice()).then(function () { pending = []; if (my !== gen) throw CANCEL; return pool.slice(0, n); });
    });
  }
  /* v3.0 beta：取消不再噴「Cannot read properties of null (reading 'postMessage')」。
   * 原因：tesseract.js 的 recognize() 先非同步載入圖片、之後才送工作給 worker；在這段空檔 terminate()，它送工作時 worker 已經是 null，
   * 錯誤在 tesseract 內部變成沒人接的 rejection。做法：worker 有工作在跑時先不關，等這份工作結束（成功或失敗）再關；新的工作也不再派給要關的 worker。 */
  function track(w, img, blocks) {
    if (w._kill) return Promise.reject(CANCEL);
    w._n = (w._n || 0) + 1;
    var done = function () { w._n--; if (!w._n && w._kill === 1) { w._kill = 2; try { quiet(w.terminate()); } catch (e) {} } };
    var p; try { p = blocks ? w.recognize(img, {}, { text: true, blocks: true }) : w.recognize(img); } catch (e) { done(); return Promise.reject(e); } // 同步丟錯也要歸還計數（審查時抓到）
    p.then(done, done); return p;
  }
  function kill(w) { if (!w || w._kill) return; w._kill = 1; if (!w._n) { w._kill = 2; try { quiet(w.terminate()); } catch (e) {} } }
  function stop() { gen++; var ws = pool; pool = []; pending = []; ws.forEach(kill); }
  /* ---------- 照片 → 灰階 ---------- */
  function fileToGray(file) {
    var MAXPX = 24e6;
    var draw = function (src, w, h) {
      var k = Math.min(1, Math.sqrt(MAXPX / (w * h))), W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
      var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, W, H);
      var G = I().toGray(x.getImageData(0, 0, W, H)); c.width = c.height = 1; return G;
    };
    function viaImg() { return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { try { res(draw(im, im.naturalWidth, im.naturalHeight)); } catch (e) { rej(e); } URL.revokeObjectURL(u); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; im.src = u; }); }
    if (root.createImageBitmap) return root.createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) { var G = draw(bm, bm.width, bm.height); if (bm.close) bm.close(); return G; }).catch(function () { return viaImg(); });
    return viaImg();
  }
  function grayCanvas(G) { var c = document.createElement('canvas'); c.width = G.w; c.height = G.h; var x = c.getContext('2d'), id = x.createImageData(G.w, G.h); I().toRGBA(G, id.data); x.putImageData(id, 0, 0); return c; }
  function rec(w, G, my, blocks) { var c = grayCanvas(G); return track(w, c, blocks).then(function (r) { c.width = c.height = 1; if (my !== gen) throw CANCEL; return r; }, function (e) { c.width = c.height = 1; if (my !== gen) throw CANCEL; throw e; }); }
  /* ---------- 自動轉正（原型 (e)）：0/90/180/270 度各取中間一塊給 Tesseract 讀，依「時間、座標、Subtotal 等字」計分 ---------- */
  function rotG(G, k) { k = ((k % 4) + 4) % 4; if (!k) return G; var w = G.w, h = G.h, W = k % 2 ? h : w, H = k % 2 ? w : h, o = new Uint8ClampedArray(w * h), g = G.g, x, y;
    for (y = 0; y < h; y++) { var r = y * w; for (x = 0; x < w; x++) { var nx, ny; if (k === 1) { nx = h - 1 - y; ny = x; } else if (k === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; } o[ny * W + nx] = g[r + x]; } }
    return { g: o, w: W, h: H }; }
  function oScore(t) { return 2 * (t.match(/\d{1,2}\s?[:;]\s?\d{2}\s?[.,]\s?\d{2}/g) || []).length + (t.match(/\d{1,2}[.,]\d{2}\s*\//g) || []).length + 2 * (t.match(/Subtot|Total|Match|Qualif|Target|Pistol|Rifle/gi) || []).length; }
  var orientImpl = null; // Carbon 可以換掉：orientImpl(G, ws, rec, my) → Promise<{ k, tried }>
  function autoOrient(G, ws, my) {
    if (orientImpl) return orientImpl(G, ws, function (w, g) { return rec(w, g, my); }, { rotG: rotG, oScore: oScore, I: I() });
    var order = G.w > G.h ? [3, 1, 0, 2] : [0, 2, 3, 1], tried = [], i = 0, best = -1, bk = 0, TH = 8, w = ws[0];
    function probe(k) { var R = rotG(G, k), c = I().crop(R, R.w * 0.05, R.h * 0.3, R.w * 0.95, R.h * 0.7); if (Math.max(c.w, c.h) > 1400) c = I().resize(c, 1400 / Math.max(c.w, c.h));
      return rec(w, c, my).then(function (r) { var s = oScore(r.data.text || ''); tried.push([k * 90, s]); return s; }); }
    function next() { if (i >= order.length) return Promise.resolve({ k: bk, tried: tried }); var k = order[i++]; return probe(k).then(function (s) { if (s > best) { best = s; bk = k; } return s >= TH ? { k: bk, tried: tried } : next(); }); }
    return next();
  }
  /* ---------- 多 worker 佇列：誰空了誰拿下一段；每種讀法的文字照原順序接回 ---------- */
  // v3.0.3：分段讀法（strips*）多要 Tesseract 字框，拿來認方向箭頭（sius-arrow.js）；整欄（col）不用
  function wantArrows(kind) { var A = root.WRSiusArrow; return !!(A && A.CFG.on && /^strips/.test(kind)); }
  function readAll(ws, jobs, tick, opt, my) {
    var out = jobs.map(function (j) { return new Array(j.parts.length); }), arr = jobs.map(function (j) { return new Array(j.parts.length); }), q = [], qi = 0;
    jobs.forEach(function (j, ji) { j.parts.forEach(function (g, gi) { q.push([ji, gi]); }); });
    function lane(w) {
      if (my !== gen || (opt.cancelled && opt.cancelled())) return Promise.reject(CANCEL);
      if (qi >= q.length) return Promise.resolve();
      var it = q[qi++];
      var J = jobs[it[0]], G = J.parts[it[1]], wa = wantArrows(J.kind);
      return rec(w, G, my, wa).then(function (r) {
        var tx = r.data.text || ''; out[it[0]][it[1]] = tx;
        if (wa) { try { arr[it[0]][it[1]] = root.WRSiusArrow.extract(G, r.data, { debug: !!root.__arrDbg }); } catch (e) { arr[it[0]][it[1]] = null; } }
        tick(); return lane(w);
      });
    }
    return Promise.all(ws.map(lane)).then(function () {
      return out.map(function (a, ji) {
        var text = a.join('\n'), la = null;
        if (wantArrows(jobs[ji].kind)) { la = []; a.forEach(function (tx, gi) { var n = String(tx).split('\n').length, A = arr[ji][gi]; for (var i = 0; i < n; i++) la.push(A && A[i] || null); }); }
        return { text: text, arrows: la };
      });
    });
  }
  /* files：File[]；opt：{ onProgress(p, phase), cancelled(), imgBase, targetId } */
  function run(files, opt) {
    opt = opt || {};
    var prog = opt.onProgress || function () {}, nf = files.length, base0 = opt.imgBase || 0, my = gen, t0 = now();
    var T = { decode: 0, orient: 0, segment: 0, ocr: 0, total: 0 }, info = { workers: 0, images: [] }, passes = [], grays = [];
    var done = 0, total = 1; function tick() { done++; prog(Math.min(0.99, 0.1 + 0.88 * done / Math.max(1, total)), 'read'); }
    var chk = function () { if (my !== gen || (opt.cancelled && opt.cancelled())) throw CANCEL; };
    prog(0.02, 'load');
    var nW = nWorkers(); info.workers = nW;
    var poolP = getPool(nW); quiet(poolP); // worker 載入跟照片解碼同時進行
    var jobs = [], k = 0;
    function prep(ws) {
      if (k >= nf) return Promise.resolve();
      chk(); var idx = k++, ta = now(), G;
      return fileToGray(files[idx]).then(function (g) { chk(); G = g; T.decode += now() - ta; var tb = now();
        return autoOrient(G, ws, my).then(function (o) { chk(); T.orient += now() - tb; if (o.k) G = rotG(G, o.k); var tc = now();
          var pl = I().plan2(G, { v: CFG }); T.segment += now() - tc; grays[idx] = G;
          info.images.push({ img: base0 + idx, w: G.w, h: G.h, rot: o.k * 90, tried: o.tried, parts: pl.passes.map(function (p) { return p.kind + ':' + p.parts.length; }).join(' ') });
          pl.passes.forEach(function (p) { jobs.push({ img: base0 + idx, kind: p.kind, parts: p.parts }); });
        });
      }).then(function () { return prep(ws); });
    }
    return poolP.then(function (ws) {
      chk(); prog(0.08, 'read');
      return prep(ws).then(function () {
        chk(); total = 0; jobs.forEach(function (j) { total += j.parts.length; });
        var td = now();
        return readAll(ws, jobs, tick, opt, my).then(function (ts) {
          ts.forEach(function (t, ji) { var ps = { img: jobs[ji].img, kind: jobs[ji].kind, lines: t.text.split('\n') }; if (t.arrows) ps.lineArrows = t.arrows; passes.push(ps); });
          jobs = null;
          // 合併後還有讀不到／對不上 → 每張照片補一種讀法（0.8 倍）
          var need = false; try { var m = X().merge(passes, { targetId: opt.targetId }), ck = X().check(m); need = ck.bad > 0 || ck.rows.some(function (r) { return r.missing; }); } catch (e) { need = false; }
          if (!need) { T.ocr += now() - td; return; }
          var tm = now(), more = grays.map(function (G, idx) { var p = I().plan2(G, { v: CFG, mult: 0.8 }).passes[0]; return { img: base0 + idx, kind: 'strips08', parts: p.parts }; });
          T.segment += now() - tm; T.ocr += tm - td; var te = now();
          total += more.reduce(function (a, j) { return a + j.parts.length; }, 0);
          return readAll(ws, more, tick, opt, my).then(function (ts2) { ts2.forEach(function (t, ji) { var ps = { img: more[ji].img, kind: more[ji].kind, lines: t.text.split('\n') }; if (t.arrows) ps.lineArrows = t.arrows; passes.push(ps); }); T.ocr += now() - te; info.more = true; });
        });
      });
    }).then(function () {
      grays = null; T.total = now() - t0; for (var kk in T) T[kk] = Math.round(T[kk]); prog(1, 'done');
      return { passes: passes, n: nf, timing: T, info: info };
    }, function (e) { grays = null; jobs = null; if (my !== gen || (opt.cancelled && opt.cancelled())) throw CANCEL; throw e; });
  }
  root.WRSiusX = {
    run: run, stop: stop, nWorkers: nWorkers, fileToGray: fileToGray, rotG: rotG, oScore: oScore,
    merge: function (p, o) { return X().merge(p, o); }, check: function (m) { return X().check(m); },
    setOrient: function (f) { orientImpl = f; }, CFG: CFG
  };
})(typeof window !== 'undefined' ? window : this);
