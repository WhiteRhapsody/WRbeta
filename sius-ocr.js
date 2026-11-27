/* WRbeta v2.9.3 小白單（SIUS）照片辨識：PROGRESS.md §7 備註8。
 * 照片 → sius-img.js 前處理（找文字欄、去陰影、每段校正傾斜）→ Tesseract（自帶在 vendor/tesseract/，不連外部 CDN）→ 每種讀法一份文字 → sius.js merge() 投票＋核對。
 * 每張照片先做 2 種讀法（分段校正、整欄）；合併後還有沒讀到或對不上的，再自動補 1 種（縮小 0.8 倍分段）。
 * 只在使用者按「小白單」時才載入 OCR 引擎（第一次約 7 MB，之後 service worker 快取）；用完就關掉 worker 釋放記憶體。 */
(function (root) {
  'use strict';
  var I = root.WRSiusImg, VENDOR = 'vendor/tesseract/', worker = null, loading = null;
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); }; document.head.appendChild(s); }); }
  function base() { return new URL(VENDOR, root.location.href).href; }
  var gen = 0; // stop() 一次＝換一代：還在載入中的 worker 載好後發現已經換代，就直接關掉（不留在背景吃記憶體）
  function quiet(p) { if (p && p.catch) p.catch(function () {}); }
  function getWorker(onLog) {
    if (worker) return Promise.resolve(worker);
    var my = gen;
    if (!loading) loading = (root.Tesseract ? Promise.resolve() : loadScript(VENDOR + 'tesseract.min.js')).then(function () {
      var b = base();
      return root.Tesseract.createWorker('eng', 1, { workerPath: b + 'worker.min.js', corePath: b, langPath: b, gzip: true, workerBlobURL: false, cacheMethod: 'write', logger: function (m) { if (onLog) try { onLog(m); } catch (e) {} } });
    }).then(function (w) {
      if (my !== gen) { try { quiet(w.terminate()); } catch (e) {} throw { cancel: true }; }
      return w.setParameters({ tessedit_pageseg_mode: '6' }).then(function () {
        if (my !== gen) { try { quiet(w.terminate()); } catch (e) {} throw { cancel: true }; }
        worker = w; return w;
      });
    }).catch(function (e) { if (my === gen) loading = null; throw e; });
    return loading;
  }
  // 停止：關掉 worker（terminate 回傳的 promise 失敗也吞掉；重複呼叫沒關係）
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
  function stop() { gen++; var w = worker; worker = null; loading = null; kill(w); }
  // 檔案 → 原始解析度灰階（照 EXIF 方向轉正；超過 2400 萬像素先縮小，避免手機記憶體不夠）
  function fileToGray(file) {
    var MAXPX = 24e6;
    var draw = function (src, w, h) {
      var k = Math.min(1, Math.sqrt(MAXPX / (w * h))), W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
      var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, W, H);
      var G = I.toGray(x.getImageData(0, 0, W, H)); c.width = c.height = 1; return G;
    };
    if (root.createImageBitmap) return root.createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) { var G = draw(bm, bm.width, bm.height); if (bm.close) bm.close(); return G; }).catch(function () { return viaImg(); });
    return viaImg();
    function viaImg() { return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { try { res(draw(im, im.naturalWidth, im.naturalHeight)); } catch (e) { rej(e); } URL.revokeObjectURL(u); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('image')); }; im.src = u; }); }
  }
  function grayCanvas(G) { var c = document.createElement('canvas'); c.width = G.w; c.height = G.h; var x = c.getContext('2d'), id = x.createImageData(G.w, G.h); I.toRGBA(G, id.data); x.putImageData(id, 0, 0); return c; }
  // v3.0.3：分段讀法（strips*）多要 Tesseract 字框，認每一發的方向箭頭（sius-arrow.js）；回傳 { text, arrows }（arrows 跟每一行對齊）
  function readParts(w, parts, tick, opt, kind) {
    var txt = [], arr = [], i = 0, my = gen, A = root.WRSiusArrow, wa = !!(A && A.CFG.on && /^strips/.test(kind || ''));
    var next = function () {
      if (my !== gen || (opt.cancelled && opt.cancelled())) return Promise.reject(CANCEL);
      if (i >= parts.length) return Promise.resolve({ text: txt.join('\n'), arrows: wa ? arr : null });
      var G = parts[i++], c = grayCanvas(G);
      return track(w, c, wa).then(function (r) {
        var tx = r.data.text || ''; txt.push(tx);
        if (wa) { var la = null; try { la = A.extract(G, r.data); } catch (e) { la = null; } var nl = tx.split('\n').length; for (var k = 0; k < nl; k++) arr.push(la && la[k] || null); }
        c.width = c.height = 1; tick(); return next();
      }, function (e) { c.width = c.height = 1; throw my !== gen ? CANCEL : e; });
    };
    return next();
  }
  function pass(img, kind, t) { var ps = { img: img, kind: kind, lines: t.text.split('\n') }; if (t.arrows) ps.lineArrows = t.arrows; return ps; }
  var CANCEL = { cancel: true };
  /* files：File[]；opt：{ onProgress(p 0–1, phase), more(passes)→true 要補第 3 種讀法, cancelled()→true 就停, imgBase（照片編號從幾開始） }
   * 一張一張處理（記憶體只留灰階原圖給補讀用）。回傳 { passes:[{ img, kind, lines }], n }；取消時 reject { cancel:true } */
  function run(files, opt) {
    opt = opt || {}; var prog = opt.onProgress || function () {}, passes = [], grays = [], nf = files.length, base0 = opt.imgBase || 0;
    var stage = 0, nStage = nf, partDone = 0, partTotal = 1;
    var tick = function () { partDone++; prog(Math.min(0.99, 0.08 + 0.92 * (stage + partDone / Math.max(1, partTotal)) / Math.max(1, nStage)), 'read'); };
    var setStage = function (k, parts) { stage = k; partDone = 0; partTotal = parts; };
    prog(0.02, 'load');
    return getWorker(function (m) { if (m && m.status && /load|init/i.test(m.status)) prog(0.02 + 0.06 * (m.progress || 0), 'load'); }).then(function (w) {
      var k = 0;
      var go = function () {
        if (k >= nf) return Promise.resolve();
        if (opt.cancelled && opt.cancelled()) return Promise.reject(CANCEL);
        var idx = k++;
        return fileToGray(files[idx]).then(function (G) {
          grays[idx] = G; var pl = I.plan(G), j = 0, tot = 0; pl.passes.forEach(function (p) { tot += p.parts.length; }); setStage(idx, tot); prog(0.08 + 0.92 * idx / nStage, 'read');
          var one = function () { if (j >= pl.passes.length) return Promise.resolve(); var p = pl.passes[j++]; return readParts(w, p.parts, tick, opt, p.kind).then(function (t) { passes.push(pass(base0 + idx, p.kind, t)); return one(); }); };
          return one();
        }).then(go);
      };
      return go().then(function () {
        if (!opt.more || !opt.more(passes)) return;
        nStage = nf * 2; var k2 = 0;
        var go2 = function () {
          if (k2 >= nf) return Promise.resolve();
          var idx = k2++, p = I.plan(grays[idx], { mult: 0.8 }).passes[0]; setStage(nf + idx, p.parts.length);
          return readParts(w, p.parts, tick, opt, 'strips08').then(function (t) { grays[idx] = null; passes.push(pass(base0 + idx, 'strips08', t)); return go2(); });
        };
        prog(0.5, 'more');
        return go2();
      });
    }).then(function () { grays = null; prog(1, 'done'); return { passes: passes, n: nf }; }, function (e) { grays = null; throw e; });
  }
  root.WRSiusOCR = { run: run, stop: stop, getWorker: getWorker, fileToGray: fileToGray, VENDOR: VENDOR };
})(typeof window !== 'undefined' ? window : this);
