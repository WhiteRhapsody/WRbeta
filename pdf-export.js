/* WRbeta v2.7.0 匯出 PDF（WRPdf）：White 2026-11-20 定案（設計稿 v2、選項面板 mockup 412px）。
 * 全部在手機瀏覽器裡產生，不用後端、不用付費服務、不下載字型：
 *   1. pdf-report.js 排出 A4 頁面（HTML＋SVG），放進看不到的 iframe 排版；
 *   2. 每頁用 SVG foreignObject 畫到 canvas（用手機內建字型，中文不會缺字），存成 JPEG；
 *   3. 自己寫 PDF 檔：每頁一張滿版圖，上面疊一層「看不見的文字」（render mode 3，ToUnicode），所以 PDF 可以搜尋、複製、pdftotext 讀得到。
 * 頁尾只有紀錄名稱、產生時間（台北）、版本、頁碼；不放會員 ID、uid、email、紀錄碼。
 * 入口：分析頁「匯出 PDF」卡片、紀錄頁每筆的「PDF」按鈕（App.pdfSource 決定資料）。 */
(function (App) {
  'use strict';
  var D = document, RP = function () { return window.WRPdfReport; };
  var PX_W = 793.7008, PX_H = 1122.5197, PT_W = 595.2756, PT_H = 841.8898, K = 0.75; // A4：CSS px（96dpi）→ pt
  var SCALE = 2.2; // 約 211dpi（列印 1:1 靶面夠清楚，檔案也不會太大）
  var THEME_NAMES = { light: 'pdf.th_light', hud: 'pdf.th_hud', sport: 'pdf.th_sport', glass: 'pdf.th_glass', cyberpunk: 'pdf.th_cyberpunk', tron: 'pdf.th_tron', piano: 'pdf.th_piano', racing: 'pdf.th_racing', appliance: 'pdf.th_appliance', luxury: 'pdf.th_luxury' };
  function esc(x) { return RP().esc(x); }
  function fmtGen(d) {
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d), g = {};
    p.forEach(function (x) { g[x.type] = x.value; }); return g.year + '/' + g.month + '/' + g.day + ' ' + (g.hour === '24' ? '00' : g.hour) + ':' + g.minute;
  }
  function fileName(name) {
    var n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
    return 'WRbeta_' + (n || 'report') + '.pdf';
  }
  function countShots(rec) { var n = 0; (rec.sheets || []).forEach(function (s) { n += (s.shots || []).length; }); return n; }
  function nSheets(rec) { return (rec.sheets || []).filter(function (s) { return s.shots && s.shots.length; }).length; }

  /* ---------- 1. 排版（iframe）＋ 量出每段文字的位置 ---------- */
  function layout(rep) {
    return new Promise(function (resolve, reject) {
      var f = D.createElement('iframe');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + Math.ceil(PX_W) + 'px;height:' + Math.ceil(PX_H) + 'px;border:0;opacity:0;pointer-events:none';
      D.body.appendChild(f);
      var d = f.contentDocument;
      d.open(); d.write('<!doctype html><html lang="' + rep.lang + '"><head><meta charset="utf-8"><style>' + RP().css + '\nhtml,body{margin:0;padding:0}</style></head><body class="' + rep.cls + '">' + rep.pages.join('') + '</body></html>'); d.close();
      var imgs = [].slice.call(d.images);
      Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : Promise.resolve(); }))
        .then(function () { return d.fonts && d.fonts.ready; })
        .then(function () { resolve({ frame: f, doc: d, pages: [].slice.call(d.querySelectorAll('.page')) }); }, reject);
    });
  }
  function textRuns(page) {
    var pr = page.getBoundingClientRect(), d = page.ownerDocument, w = d.createTreeWalker(page, 4, null), node, out = [], rg = d.createRange();
    while ((node = w.nextNode())) {
      var v = node.nodeValue; if (!v || !/\S/.test(v)) continue;
      if (node.parentNode.closest && node.parentNode.closest('svg')) continue;
      var cs = d.defaultView.getComputedStyle(node.parentNode), fs = parseFloat(cs.fontSize) || 10, run = null;
      for (var i = 0; i < v.length; i++) {
        var ch = v.charAt(i), cc = v.charCodeAt(i);
        if (cc >= 0xd800 && cc <= 0xdfff) continue; // 表情符號（BMP 外）不放進文字層
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        var rs = rg.getClientRects(); if (!rs.length) continue; var r = rs[0];
        if (!r.width && ch !== ' ') continue;
        if (run && Math.abs(r.top - run.top) < fs * 0.5 && r.left >= run.right - 1.5 && r.left - run.right < fs * 1.2) { run.t += ch; run.right = r.right; run.bottom = Math.max(run.bottom, r.bottom); }
        else { if (run) out.push(run); run = { t: ch, left: r.left, right: r.right, top: r.top, bottom: r.bottom, fs: fs }; }
      }
      if (run) out.push(run);
    }
    return out.map(function (r) { var t = r.t.replace(/\s+$/, ''); return { t: t, x: r.left - pr.left, y: r.top - pr.top, w: r.right - r.left, h: r.bottom - r.top, fs: r.fs }; }).filter(function (r) { return r.t; });
  }
  /* ---------- 2. 畫成圖 ---------- */
  function raster(page, rep) {
    var xml = new XMLSerializer().serializeToString(page);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(PX_W * SCALE) + '" height="' + Math.round(PX_H * SCALE) + '" viewBox="0 0 ' + PX_W + ' ' + PX_H + '"><foreignObject x="0" y="0" width="' + PX_W + '" height="' + PX_H + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="' + rep.cls + '" lang="' + rep.lang + '" style="margin:0;width:' + PX_W + 'px;height:' + PX_H + 'px"><style>' + RP().css.replace(/</g, '\\3c ') + '</style>' + xml + '</div></foreignObject></svg>';
    return new Promise(function (resolve, reject) {
      var img = new Image(), cv = D.createElement('canvas');
      cv.width = Math.round(PX_W * SCALE); cv.height = Math.round(PX_H * SCALE);
      img.onload = function () {
        try {
          var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob(function (b) { if (!b) return reject(new Error('toBlob')); b.arrayBuffer().then(function (ab) { cv.width = cv.height = 1; resolve({ jpg: new Uint8Array(ab), w: Math.round(PX_W * SCALE), h: Math.round(PX_H * SCALE) }); }, reject); }, 'image/jpeg', 0.86);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('svg image')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  /* ---------- 3. 寫 PDF ---------- */
  var enc = new TextEncoder();
  function hex4(n) { return ('000' + n.toString(16).toUpperCase()).slice(-4); }
  function utf16hex(s) { var h = 'FEFF'; for (var i = 0; i < s.length; i++) h += hex4(s.charCodeAt(i)); return '<' + h + '>'; }
  function cidHex(s) { var h = ''; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdfff) continue; h += hex4(c); } return '<' + h + '>'; }
  function n2(v) { return (Math.round(v * 100) / 100).toString(); }
  function toUnicodeCMap() {
    var r = [], hi; for (hi = 0; hi < 256; hi++) { if (hi >= 0xd8 && hi <= 0xdf) continue; var b = ('0' + hi.toString(16).toUpperCase()).slice(-2); r.push('<' + b + '00> <' + b + 'FF> <' + b + '00>'); }
    var body = ''; for (var i = 0; i < r.length; i += 100) { var part = r.slice(i, i + 100); body += part.length + ' beginbfrange\n' + part.join('\n') + '\nendbfrange\n'; }
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' + body + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  }
  function textLayer(runs) {
    var s = 'BT 3 Tr\n';
    runs.forEach(function (r) {
      var fs = r.fs * K, n = 0; for (var i = 0; i < r.t.length; i++) { var c = r.t.charCodeAt(i); if (c < 0xd800 || c > 0xdfff) n++; }
      if (!n || fs <= 0) return;
      var tz = Math.max(1, Math.min(1000, (r.w * K) / (n * fs) * 100)), x = r.x * K, base = PT_H - (r.y + r.h / 2 + r.fs * 0.35) * K;
      s += '/F1 ' + n2(fs) + ' Tf ' + n2(tz) + ' Tz 1 0 0 1 ' + n2(x) + ' ' + n2(base) + ' Tm ' + cidHex(r.t) + ' Tj\n';
    });
    return s + 'ET';
  }
  function buildPdf(pages, meta) {
    var parts = [], len = 0, offs = [];
    function put(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; }
    function obj(id, body) { offs[id] = len; put(id + ' 0 obj\n'); if (Array.isArray(body)) body.forEach(put); else put(body); put('\nendobj\n'); }
    function stream(id, dict, data) { var b = typeof data === 'string' ? enc.encode(data) : data; obj(id, ['<< ' + dict + ' /Length ' + b.length + ' >>\nstream\n', b, '\nendstream']); }
    put('%PDF-1.4\n'); put(new Uint8Array([37, 226, 227, 207, 211, 10]));
    var N = pages.length, FIRST = 8, ids = pages.map(function (_, i) { return { page: FIRST + i * 3, cont: FIRST + i * 3 + 1, img: FIRST + i * 3 + 2 }; });
    obj(1, '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>');
    obj(2, '<< /Type /Pages /Count ' + N + ' /Kids [' + ids.map(function (x) { return x.page + ' 0 R'; }).join(' ') + '] >>');
    obj(3, '<< /Type /Font /Subtype /Type0 /BaseFont /WRbetaText /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>');
    obj(4, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /WRbetaText /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /CIDToGIDMap /Identity >>');
    obj(5, '<< /Type /FontDescriptor /FontName /WRbetaText /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>');
    stream(6, '', toUnicodeCMap());
    var dt = new Date(), z = function (n) { return ('0' + n).slice(-2); }, pdfDate = 'D:' + dt.getUTCFullYear() + z(dt.getUTCMonth() + 1) + z(dt.getUTCDate()) + z(dt.getUTCHours()) + z(dt.getUTCMinutes()) + z(dt.getUTCSeconds()) + 'Z';
    obj(7, '<< /Title ' + utf16hex(meta.title) + ' /Producer ' + utf16hex('WRbeta ' + meta.label) + ' /Creator ' + utf16hex('WRbeta') + ' /CreationDate (' + pdfDate + ') >>');
    pages.forEach(function (p, i) {
      var x = ids[i];
      obj(x.page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n2(PT_W) + ' ' + n2(PT_H) + '] /Resources << /XObject << /Im0 ' + x.img + ' 0 R >> /Font << /F1 3 0 R >> >> /Contents ' + x.cont + ' 0 R >>');
      stream(x.cont, '', 'q ' + n2(PT_W) + ' 0 0 ' + n2(PT_H) + ' 0 0 cm /Im0 Do Q\n' + textLayer(p.runs));
      stream(x.img, '/Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.jpg);
    });
    var total = FIRST + N * 3, xref = len, xr = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var i = 1; i < total; i++) xr += ('000000000' + offs[i]).slice(-10) + ' 00000 n \n';
    put(xr + 'trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(parts, { type: 'application/pdf' });
  }
  /* 產生：src＝App.pdfSource()；opt＝{ theme, lang, pages:{list,one} }；onStep(i, n) 回報進度 */
  function generate(src, opt, onStep) {
    var rep = RP().build(src.rec, src.fc, { lang: opt.lang, theme: opt.theme, pages: opt.pages, label: App.APP_LABEL, gen: fmtGen(new Date()) });
    var L, out = [];
    return layout(rep).then(function (l) {
      L = l; var i = 0;
      function next() {
        if (i >= L.pages.length) return Promise.resolve();
        var pg = L.pages[i], runs = textRuns(pg); if (onStep) onStep(i + 1, L.pages.length);
        return raster(pg, rep).then(function (r) { r.runs = runs; out.push(r); i++; return new Promise(function (ok) { setTimeout(ok, 0); }).then(next); });
      }
      return next();
    }).then(function () {
      L.frame.remove();
      return { blob: buildPdf(out, { title: src.rec.name || 'WRbeta', label: App.APP_LABEL }), pages: out.length, plan: rep.plan };
    }, function (e) { if (L) L.frame.remove(); throw e; });
  }

  /* ---------- 選項面板（底部，單手：主按鈕在最下面） ---------- */
  var sheet = null, cur = null;
  function close() {
    if (!sheet) return; sheet.remove(); sheet = null; cur = null; D.body.classList.remove('pdfx-open');
    if (App.back) App.back.drop('pdf');
  }
  function open(src) {
    if (!src || !src.rec || !countShots(src.rec)) { App.toast(wrT('pdf.no_shots')); return false; }
    close();
    var rec = src.rec, T = window.BMCore.TARGETS, t = T[rec.targetId] || T.ap10, hasFc = !!(src.fc && src.fc.cmp && src.fc.cmp.pairs.length);
    cur = { src: src, theme: 'light', lang: wrT.lang() === 'en' ? 'en' : 'zh-TW', list: true, one: true, busy: false, blob: null };
    var th = RP().THEMES.map(function (k) {
      return '<button type="button" class="pdfx-th' + (k === 'light' ? ' on' : '') + '" data-th="' + k + '" aria-pressed="' + (k === 'light') + '"><i class="sw sw-' + k + '"></i><span>' + esc(wrT(THEME_NAMES[k])) + '</span>' + (k === 'light' ? '<b>' + esc(wrT('pdf.default')) + '</b>' : '') + '</button>';
    }).join('');
    var chk = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    sheet = D.createElement('div'); sheet.id = 'pdfSheet'; sheet.className = 'pdfx-bg'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', wrT('pdf.title'));
    sheet.innerHTML = '<div class="pdfx-card"><div class="pdfx-grab" aria-hidden="true"></div>' +
      '<h2 class="pdfx-h"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/></svg>' + esc(wrT('pdf.title')) + '</h2>' +
      '<div class="pdfx-rec">' + esc(rec.name) + '・' + esc(t.name) + '・' + esc(wrT('pdf.n_shots', [countShots(rec)])) + '</div>' +
      '<div class="pdfx-scroll">' +
      '<div class="pdfx-lbl">' + esc(wrT('pdf.pages')) + '</div><div class="pdfx-box">' +
      '<div class="pdfx-row lock"><span class="pdfx-ck">' + chk + '</span><span class="t">' + esc(wrT('pdf.p_always')) + '<small>' + esc(wrT('pdf.p_always_sub')) + '</small></span><span class="pill">' + esc(wrT('pdf.always')) + '</span></div>' +
      '<div class="pdfx-row lock' + (hasFc ? '' : ' off') + '" data-fc="' + (hasFc ? 1 : 0) + '"><span class="pdfx-ck">' + (hasFc ? chk : '') + '</span><span class="t">' + esc(wrT('pdf.p_cmp')) + '<small>' + esc(wrT(hasFc ? 'pdf.p_cmp_yes' : 'pdf.p_cmp_no')) + '</small></span><span class="pill">' + esc(wrT(hasFc ? 'pdf.included' : 'pdf.no_forecast')) + '</span></div>' +
      '<label class="pdfx-row"><input type="checkbox" id="pdfList" checked><span class="pdfx-ck">' + chk + '</span><span class="t">' + esc(wrT('pdf.p_list')) + '<small>' + esc(wrT('pdf.p_list_sub')) + '</small></span></label>' +
      '<label class="pdfx-row"><input type="checkbox" id="pdfOne" checked><span class="pdfx-ck">' + chk + '</span><span class="t">' + esc(wrT('pdf.p_one')) + '<small>' + esc(wrT('pdf.p_one_sub')) + '</small></span></label></div>' +
      '<div class="pdfx-lbl">' + esc(wrT('pdf.theme')) + '</div><div class="pdfx-themes" role="group" aria-label="' + esc(wrT('pdf.theme')) + '">' + th + '</div><div class="pdfx-hint">' + esc(wrT('pdf.theme_hint')) + '</div>' +
      '<div class="pdfx-lbl">' + esc(wrT('pdf.lang')) + '</div><div class="pdfx-seg" role="radiogroup" aria-label="' + esc(wrT('pdf.lang')) + '"><button type="button" role="radio" data-lang="zh-TW" lang="zh-Hant-TW">繁體中文</button><button type="button" role="radio" data-lang="en" lang="en">English</button></div>' +
      '</div>' +
      '<div class="pdfx-foot"><span id="pdfCount"></span><span id="pdfName"></span></div>' +
      '<div class="pdfx-status" id="pdfStatus" role="status" aria-live="polite"></div>' +
      '<div class="pdfx-done" id="pdfDone" hidden><button type="button" id="pdfShare" class="pdfx-btn2">' + esc(wrT('pdf.share')) + '</button><button type="button" id="pdfSave" class="pdfx-btn2">' + esc(wrT('pdf.save_again')) + '</button></div>' +
      '<button type="button" id="pdfGo" class="pdfx-go"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>' + esc(wrT('pdf.go')) + '</span></button>' +
      '<button type="button" id="pdfCancel" class="pdfx-cancel" data-close>' + esc(wrT('pdf.cancel')) + '</button></div>';
    D.body.appendChild(sheet); D.body.classList.add('pdfx-open');
    var q = function (s) { return sheet.querySelector(s); };
    function sync() {
      var n = RP().pageCount(nSheets(rec), countShots(rec), hasFc ? src.fc.cmp.pairs.length : 0, { list: cur.list, one: cur.one });
      q('#pdfCount').innerHTML = wrT('pdf.count', [n]); q('#pdfName').textContent = wrT('pdf.filename', [fileName(rec.name)]);
      sheet.querySelectorAll('.pdfx-th').forEach(function (b) { var on = b.dataset.th === cur.theme; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      sheet.querySelectorAll('.pdfx-seg button').forEach(function (b) { var on = b.dataset.lang === cur.lang; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    }
    function changed() { cur.blob = null; q('#pdfDone').hidden = true; q('#pdfStatus').textContent = ''; sync(); }
    q('#pdfList').onchange = function () { cur.list = this.checked; changed(); };
    q('#pdfOne').onchange = function () { cur.one = this.checked; changed(); };
    sheet.querySelectorAll('.pdfx-th').forEach(function (b) { b.onclick = function () { cur.theme = b.dataset.th; changed(); }; });
    sheet.querySelectorAll('.pdfx-seg button').forEach(function (b) { b.onclick = function () { cur.lang = b.dataset.lang; changed(); }; });
    q('#pdfCancel').onclick = close;
    sheet.addEventListener('click', function (e) { if (e.target === sheet && !cur.busy) close(); });
    q('#pdfGo').onclick = function () { run(); };
    q('#pdfSave').onclick = function () { if (cur && cur.blob) save(cur.blob, fileName(rec.name)); };
    q('#pdfShare').onclick = function () { if (cur && cur.blob) share(cur.blob, fileName(rec.name)); };
    if (!(navigator.canShare && window.File)) q('#pdfShare').hidden = true;
    sync();
    if (App.back) App.back.push('pdf', close);
    return true;
  }
  function run() {
    if (!cur || cur.busy) return; var c = cur, go = sheet.querySelector('#pdfGo'), st = sheet.querySelector('#pdfStatus');
    c.busy = true; go.disabled = true; sheet.classList.add('busy'); st.textContent = wrT('pdf.making');
    var name = fileName(c.src.rec.name);
    generate(c.src, { theme: c.theme, lang: c.lang, pages: { list: c.list, one: c.one } }, function (i, n) { if (cur === c) st.textContent = wrT('pdf.making_n', [i, n]); })
      .then(function (r) {
        App.pdfLast = { size: r.blob.size, pages: r.pages, plan: r.plan, name: name, theme: c.theme, lang: c.lang };
        if (cur !== c) return; c.blob = r.blob; c.busy = false; go.disabled = false; sheet.classList.remove('busy');
        st.textContent = wrT('pdf.done', [r.pages, Math.max(1, Math.round(r.blob.size / 1024))]);
        sheet.querySelector('#pdfDone').hidden = false;
        save(r.blob, name);
      }, function (e) {
        if (cur !== c) return; c.busy = false; go.disabled = false; sheet.classList.remove('busy');
        st.textContent = wrT('pdf.failed'); try { console.warn('pdf', e); } catch (x) {}
      });
  }
  function save(blob, name) {
    var a = D.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name; a.rel = 'noopener'; D.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  function share(blob, name) {
    try { var f = new File([blob], name, { type: 'application/pdf' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: name }).catch(function () {}); return; } } catch (e) {}
    save(blob, name);
  }
  var btn = D.getElementById('anaPdfBtn');
  if (btn) btn.onclick = function () { open(App.pdfSource()); };
  window.WRPdf = { open: open, close: close, generate: generate, fileName: fileName, _buildPdf: buildPdf };
  App.pdfOpen = function (s) { return open(App.pdfSource(s)); };
})(window.WRApp = window.WRApp || {});
