/* WRbeta v2.9.0 首頁（White 2026-11-23 定稿＝/workspace/home_concept/v3c）
 * - 打開 App 先看到首頁：10 米空氣手槍靶紙（尺寸照 core.js TARGETS.ap10，ISSF 6.3.4.6），準心預設對準十環的「選手」。
 * - 按住靶紙瞄準、放開開槍：打出 4.5mm 彈孔（挖空靶紙，露出主題背景），打中十環 → 1.5 秒後從彈孔圓形展開進入「選手」（＝原本一打開的畫面：Pro 分析、Lite 預報第 1 步）。
 *   沒打中十環：顯示分數，準心回到十環。
 * - 白色環區四顆軟 Q 圓鈕（裁判、教練、新聞、社群）：被打到會凹下去再彈回（果凍感）＋短震；內容都還沒有，一律「即將推出」。
 * - 左上：設定（齒輪）＝直接進「設定/說明 › 設定」；資訊（i）＝「設定/說明 › 說明」。右上：beta 與版號（APP_VERSION）。
 * - 大卡片＝版本更新紀錄（內容取自 PROGRESS.md 與 git，日期＝上線日，台北時間）。
 * - 同一個分頁（sessionStorage）只在第一次打開時出現；換語言、SW 更新造成的重新載入不會再跳出來。
 *   回首頁：在最上層按返回鍵（Android 返回）或點標題列的「WRbeta」。
 * - 顏色全部用主題變數（--w-*），10 款主題都跟著變。標語顏色＝--w-camB（「拍下一張寶寶」主按鈕色）。
 */
(function (App) {
  'use strict';
  var D = document, H = D.documentElement, KEY = 'wr_home_seen', NS = 'http://www.w3.org/2000/svg';
  var host = D.getElementById('wrHome'); if (!host) return;
  var TG = (App.T && App.T.ap10) || null, C = App.C; if (!TG || !C) return;
  var ENTER_MS = 1500, REVEAL_MS = 420;
  // 版本更新紀錄：[版本, 日期, 條目 key…]
  var VLOG = [
    ['v2.9.0', '2026/11/23', ['home.v290_1', 'home.v290_2', 'home.v290_3', 'home.v290_4']],
    ['v2.8.0', '2026/11/21', ['home.v280_1', 'home.v280_2', 'home.v280_3', 'home.v280_4']],
    ['v2.7.0', '2026/11/20', ['home.v270_1', 'home.v270_2', 'home.v270_3']],
    ['v2.6.1', '2026/11/20', ['home.v261_1', 'home.v261_2', 'home.v261_3']],
    ['v2.6.0', '2026/11/20', ['home.v260_1', 'home.v260_2', 'home.v260_3', 'home.v260_4']],
    ['v2.5.0', '2026/11/20', ['home.v250_1', 'home.v250_2', 'home.v250_3', 'home.v250_4']]
  ];
  var ICON = {
    judge: '<path d="M12 4v16M7.5 20h9M4.5 7.5h15"/><path d="M6.5 7.5L3.5 14h6z M17.5 7.5l-3 6.5h6z"/>',
    coach: '<rect x="5.5" y="4.5" width="13" height="16.5" rx="2"/><path d="M9.5 3h5v3h-5z M9 11h6M9 14.5h6M9 18h3.5"/>',
    news: '<rect x="3.5" y="5" width="14" height="14.5" rx="1.5"/><path d="M17.5 9h3v8.5a2 2 0 0 1-2 2h-1M6.5 9h8M6.5 12.5h8M6.5 16h5"/>',
    social: '<circle cx="9" cy="9" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="10" r="2.5"/><path d="M15.8 14.6c2.9-.2 5.2 1.6 5.2 4.6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.6.6 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>'
  };
  // 四顆圓鈕：角度（螢幕座標，0＝右、-90＝上），全部在白色環區（離靶心 50mm），避開兩條印環數的軸線
  var RB = [['judge', 'home.judge', -169, 'home.judge_desc'], ['coach', 'home.coach', -146, 'home.coach_desc'], ['news', 'home.news', -123.5, 'home.news_desc'], ['social', 'home.social', -101, 'home.social_desc']];
  var RB_MM = 50;
  function ic(n) { return '<svg class="hm-ic" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sel(tag, attrs, parent) { var e = D.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function seenSet() { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  function ver() { return App.APP_VERSION || ''; }

  var G = null;            // 目前的幾何：{ W, H, k, S, CX, CY, Cpx }
  var busy = false, aiming = false, built = false, seed = 7, enterT = 0, revealT = 0, onNow = false;
  var els = {};
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  function build() {
    host.className = 'wr-home'; host.setAttribute('role', 'region'); host.setAttribute('aria-label', wrT('home.aria'));
    var vl = VLOG.map(function (v) {
      var now = v[0] === ver();
      return '<div class="hm-ve"><div class="hm-vt"><span class="hm-ver' + (now ? '' : ' old') + '">' + v[0] + '</span><span class="hm-d">' + v[1] + '</span>' + (now ? '<span class="hm-now">' + esc(wrT('home.current')) + '</span>' : '') + '</div><ul>' +
        v[2].map(function (k) { return '<li>' + esc(wrT(k)) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    host.innerHTML = '<div class="hm-stage"><svg class="hm-tg" aria-hidden="true" focusable="false"></svg>' +
      '<div class="hm-hit" data-xh="off" role="button" tabindex="0" aria-label="' + esc(wrT('home.player_aria')) + '"></div>' +
      '<div class="hm-plbl" aria-hidden="true">' + esc(wrT('home.player')) + '</div><div class="hm-ahint" aria-hidden="true">' + esc(wrT('home.aim_hint')) + '</div>' +
      RB.map(function (b) { return '<button type="button" class="hm-rb hm-jelly" data-k="' + b[0] + '" aria-label="' + esc(wrT(b[1]) + ' · ' + wrT('home.soon')) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic(b[0]) + '<b>' + esc(wrT(b[1])) + '</b><span class="hm-soon">' + esc(wrT('home.soon')) + '</span></span></button>'; }).join('') +
      '</div>' +
      '<div class="hm-top"><div class="hm-bar"><button type="button" class="hm-gear hm-jelly" data-k="set" aria-label="' + esc(wrT('home.settings')) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic('gear') + '</span></button>' +
      '<button type="button" class="hm-gear hm-jelly" data-k="help" aria-label="' + esc(wrT('home.help')) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic('info') + '</span></button>' +
      '<span class="hm-beta">beta</span><span class="hm-vpill">' + esc(ver()) + '</span></div>' +
      '<div class="hm-brand" lang="en">White Rhapsody</div><div class="hm-tag" lang="en">' + esc(wrT('home.tagline')) + '</div>' +
      '<section class="hm-vlog" aria-label="' + esc(wrT('home.vlog')) + '"><div class="hm-vhd"><b>' + esc(wrT('home.vlog')) + '</b><span>' + esc(wrT('home.vlog_more')) + '</span></div><div class="hm-vsc" tabindex="0">' + vl + '</div></section></div>' +
      '<div class="hm-toast" role="status" aria-live="polite"></div>';
    els.svg = host.querySelector('.hm-tg'); els.hit = host.querySelector('.hm-hit'); els.lbl = host.querySelector('.hm-plbl'); els.hint = host.querySelector('.hm-ahint');
    els.toast = host.querySelector('.hm-toast'); els.vlog = host.querySelector('.hm-vlog'); els.stage = host.querySelector('.hm-stage');
    bindJelly(); bindAim();
    built = true;
  }

  // ---------- 靶紙 ----------
  function geom() {
    var W = H.clientWidth || window.innerWidth || 412, Hh = window.innerHeight || H.clientHeight || 915, k = Math.min(1.25, W / 412);
    var S = 5.55 * W / 412;                  // px/mm：黑區半徑≈0.40×寬（White 的裁切）
    return { W: W, H: Hh, k: k, S: S, CX: 0.82 * W, CY: Hh - 82 * k, Cpx: TG.cardSize * S };
  }
  function draw() {
    var g = G = geom(), svg = els.svg, S = g.S, CX = g.CX, CY = g.CY, C2 = g.Cpx / 2;
    svg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + g.H); svg.setAttribute('width', g.W); svg.setAttribute('height', g.H);
    svg.innerHTML = '';
    var defs = sel('defs', {}, svg);
    var mask = sel('mask', { id: 'hmHoles', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: g.W, height: g.H }, defs);
    sel('rect', { x: 0, y: 0, width: g.W, height: g.H, fill: '#fff' }, mask);
    sel('radialGradient', { id: 'hmDepth' }, defs).innerHTML = '<stop offset="70%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".22"/>';
    sel('clipPath', { id: 'hmPaper' }, defs).appendChild(sel('rect', { x: CX - C2, y: CY - C2, width: g.Cpx, height: g.Cpx, rx: 28 * g.k }));
    var paper = sel('g', { mask: 'url(#hmHoles)', class: 'hm-paper' }, svg);
    sel('rect', { x: CX - C2, y: CY - C2, width: g.Cpx, height: g.Cpx, rx: 28 * g.k, class: 'hm-card' }, paper);
    var lw = Math.max(TG.ringLine * S, 0.9), n;
    for (n = 1; n <= 6; n++) sel('circle', { cx: CX, cy: CY, r: TG.ringDiam[n] / 2 * S, class: n === 1 ? 'hm-rw hm-r1' : 'hm-rw', 'stroke-width': lw, 'data-ring': n }, paper);
    sel('circle', { cx: CX, cy: CY, r: TG.blackDiam / 2 * S, class: 'hm-black' }, paper);
    for (n = 8; n <= 10; n++) sel('circle', { cx: CX, cy: CY, r: TG.ringDiam[n] / 2 * S, class: 'hm-rb2', 'stroke-width': lw, 'data-ring': n }, paper);
    sel('circle', { cx: CX, cy: CY, r: TG.innerTen.diam / 2 * S, class: 'hm-rb2', 'stroke-width': lw, 'data-ring': 'x' }, paper);
    var fs = Math.max(7, 8 * S * 0.42);
    TG.printedNumbers.forEach(function (n) {
      var rr = (TG.ringDiam[n] + TG.ringDiam[n + 1]) / 4 * S;
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
        var x = CX + d[0] * rr, y = CY + d[1] * rr; if (x < -10 || x > g.W + 10 || y < -10 || y > g.H + 10) return;
        var t = sel('text', { x: x, y: y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': fs, class: n >= TG.blackFromRing ? 'hm-num b' : 'hm-num' }, paper);
        if (d[0]) t.setAttribute('transform', 'rotate(' + (d[0] * 90) + ' ' + x + ' ' + y + ')');
        t.textContent = n;
      });
    });
    els.mask = mask; els.fringe = sel('g', { mask: 'url(#hmHoles)' }, svg); els.fx = sel('g', {}, svg);
    // 準心（同 app-base.js previewMark：整條橫豎線＋4.5mm 半透明橘色孔；裁在靶紙內）
    var xh = els.xh = sel('g', { class: 'hm-xh', 'clip-path': 'url(#hmPaper)' }, svg);
    els.xhH = sel('line', {}, xh); els.xhV = sel('line', {}, xh); els.xhO = sel('circle', { r: TG.pellet / 2 * S }, xh);
    aim(CX, CY);
    // 「選手」字與提示
    var lw2 = 64 * g.k;
    els.lbl.style.cssText = 'left:' + (CX - lw2 / 2) + 'px;top:' + (CY - 8 * g.k) + 'px;width:' + lw2 + 'px;font-size:' + (15 * g.k).toFixed(1) + 'px';
    els.hint.style.cssText = 'left:0;top:' + (CY + 40 * g.k) + 'px;font-size:' + Math.max(9, 9.5 * g.k).toFixed(1) + 'px';
    var hw = els.hint.getBoundingClientRect().width; els.hint.style.left = Math.max(6, Math.min(CX - hw / 2, g.W - hw - 6)) + 'px';
    // 點擊區＝看得到的靶紙
    var top = Math.max(0, CY - C2), left = Math.max(0, CX - C2);
    els.hit.style.cssText = 'left:' + left + 'px;top:' + top + 'px;width:' + (Math.min(g.W, CX + C2) - left) + 'px;height:' + (Math.min(g.H, CY + C2) - top) + 'px';
    // 四顆圓鈕
    var d = Math.max(64, 78 * g.k);
    host.querySelectorAll('.hm-rb').forEach(function (b, i) {
      var a = RB[i][2] * Math.PI / 180, x = CX + Math.cos(a) * RB_MM * S, y = CY + Math.sin(a) * RB_MM * S;
      b.style.left = (x - d / 2) + 'px'; b.style.top = (y - d / 2) + 'px'; b.style.width = d + 'px'; b.style.height = d + 'px';
    });
    // 版本卡片：底邊不能碰到最上面那顆圓鈕
    var topBtn = Math.min.apply(null, RB.map(function (b) { var a = b[2] * Math.PI / 180; return CY + Math.sin(a) * RB_MM * S - d / 2; }));
    var vt = els.vlog.getBoundingClientRect().top, maxB = topBtn - 12;
    els.vlog.style.height = Math.max(96, Math.min(226 * g.k, maxB - vt)) + 'px';
  }
  function aim(x, y) {
    var g = G, C2 = g.Cpx / 2;
    els.xhH.setAttribute('x1', g.CX - C2); els.xhH.setAttribute('x2', g.CX + C2); els.xhH.setAttribute('y1', y); els.xhH.setAttribute('y2', y);
    els.xhV.setAttribute('y1', g.CY - C2); els.xhV.setAttribute('y2', g.CY + C2); els.xhV.setAttribute('x1', x); els.xhV.setAttribute('x2', x);
    els.xhO.setAttribute('cx', x); els.xhO.setAttribute('cy', y);
  }
  function holePath(x, y, R, amp) { var n = 48, pts = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, k = 1 + (rnd() - 0.5) * amp; if (rnd() < 0.08) k -= amp * 0.8; pts.push((x + Math.cos(a) * R * k).toFixed(2) + ',' + (y + Math.sin(a) * R * k).toFixed(2)); } return pts.join(' '); }
  // 螢幕座標 → 靶面 mm（y 往上為正，同 core.js）
  function toMm(x, y) { return { x: (x - G.CX) / G.S, y: -(y - G.CY) / G.S }; }
  function score(x, y) { var m = toMm(x, y); return C.scoreShot(TG, m.x, m.y); }
  function toast(msg, ms, cls) {
    var t = els.toast; t.className = 'hm-toast'; t.innerHTML = msg; void t.offsetWidth; t.className = 'hm-toast ' + (cls || 'show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'hm-toast'; }, ms || 1600);
  }
  function fire(x, y) {
    var g = G, sc = score(x, y), onBlack = Math.hypot(x - g.CX, y - g.CY) <= TG.blackDiam / 2 * g.S, R = TG.pellet / 2 * g.S;
    var poly = holePath(x, y, R, 0.045), org = 'transform-origin:' + x + 'px ' + y + 'px';
    var hg = sel('g', { class: 'hm-hole-in', style: org }, els.fringe);
    // 實拍參考：乾淨圓孔；黑區一圈很窄的灰白毛邊（約 0.2mm），白區幾乎沒有
    if (onBlack) sel('polygon', { points: holePath(x, y, R * 1.075, 0.06), fill: '#a9a59b', opacity: 0.9 }, hg);
    else sel('polygon', { points: holePath(x, y, R * 1.03, 0.04), fill: 'rgba(60,58,54,.22)' }, hg);
    sel('polygon', { points: poly, fill: '#000', class: 'hm-hole-in hm-hole', style: org, 'data-r': R.toFixed(3) }, els.mask);
    sel('polygon', { points: poly, fill: 'url(#hmDepth)', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 0.5, class: 'hm-hole-in', style: org }, els.fx);
    if (!reduced()) {
      var sh = sel('circle', { cx: x, cy: y, r: R, fill: 'none', stroke: '#fff', class: 'hm-shock', style: '--r0:' + R + 'px;--r1:' + (R * 6) + 'px' }, els.fx);
      var fl = sel('circle', { cx: x, cy: y, r: R * 2.2, fill: 'rgba(255,214,150,.9)', class: 'hm-flash', style: org }, els.fx);
      for (var i = 0; i < 7; i++) { var a = rnd() * Math.PI * 2, dd = (26 + rnd() * 34) * g.k; sel('rect', { x: x - 1.5, y: y - 1, width: 3 + rnd() * 2.5, height: 2 + rnd() * 2, fill: onBlack ? '#2a2a28' : '#efebe0', stroke: onBlack ? '#555' : '#bbb', 'stroke-width': 0.4, class: 'hm-chip', style: org + ';--dx:' + (Math.cos(a) * dd).toFixed(1) + 'px;--dy:' + (Math.sin(a) * dd).toFixed(1) + 'px;--rot:' + Math.round(rnd() * 540 - 270) + 'deg' }, els.fx); }
      setTimeout(function () { sh.remove(); fl.remove(); els.fx.querySelectorAll('.hm-chip').forEach(function (c) { c.remove(); }); }, 700);
      els.stage.classList.remove('hm-shake'); void els.stage.offsetWidth; els.stage.classList.add('hm-shake');
    }
    els.xh.classList.add('out'); vib(30);
    var dec = sc.dec.toFixed(1);
    if (sc.ring === 10) {
      busy = true; els.lbl.classList.add('gone'); els.hint.classList.add('gone');
      toast(wrT('home.hit', [dec]), ENTER_MS + REVEAL_MS + 200, 'hit');
      clearTimeout(enterT); enterT = setTimeout(function () { reveal(x, y); }, ENTER_MS);
    } else {
      toast(sc.ring ? wrT('home.miss_ring', [dec, sc.ring]) : wrT('home.miss_out'), 1800);
      setTimeout(function () { if (busy) return; els.xh.classList.remove('out'); aim(G.CX, G.CY); }, 900);
    }
    host.dataset.last = JSON.stringify({ x: +x.toFixed(2), y: +y.toFixed(2), ring: sc.ring, dec: sc.dec, holeD: +(2 * R).toFixed(3), pxPerMm: +g.S.toFixed(4) });
    return sc;
  }
  function reveal(x, y) {
    if (!onNow) return;
    host.style.setProperty('--hm-x', x + 'px'); host.style.setProperty('--hm-y', y + 'px');
    if (reduced()) { hide(); return; }
    host.classList.add('hm-reveal');
    clearTimeout(revealT); revealT = setTimeout(hide, REVEAL_MS + 60);
  }
  function hide(go) {
    clearTimeout(enterT); clearTimeout(revealT);
    seenSet(); onNow = false; busy = false;
    H.classList.remove('wr-home'); host.classList.remove('hm-reveal'); host.hidden = true;
    if (go) go();
    try { if (App.back) App.back.sync(); } catch (e) {}
    try { if (window.WRLayout && App.liteLayout && D.body.classList.contains('lite')) App.liteLayout(); } catch (e) {}
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  function show() {
    if (!built) build();
    onNow = true; busy = false; aiming = false; seed = 7;
    host.hidden = false; host.classList.remove('hm-reveal'); H.classList.add('wr-home');
    els.lbl.classList.remove('gone'); els.hint.classList.remove('gone'); els.toast.className = 'hm-toast';
    var sc = host.querySelector('.hm-vsc'); if (sc) sc.scrollTop = 0;
    draw(); els.xh.classList.remove('out');
    try { if (App.back) App.back.sync(); } catch (e) {}
  }

  // ---------- 瞄準與開槍 ----------
  function pt(ev) { return { x: ev.clientX, y: ev.clientY }; }
  function bindAim() {
    var hit = els.hit;
    hit.addEventListener('pointerdown', function (ev) { if (busy || !onNow) return; aiming = true; try { hit.setPointerCapture(ev.pointerId); } catch (e) {} var p = pt(ev); els.xh.classList.remove('out'); aim(p.x, p.y); });
    hit.addEventListener('pointermove', function (ev) { if (!aiming) return; var p = pt(ev); aim(p.x, p.y); });
    hit.addEventListener('pointerup', function (ev) { if (!aiming) return; aiming = false; var p = pt(ev); fire(p.x, p.y); });
    hit.addEventListener('pointercancel', function () { aiming = false; aim(G.CX, G.CY); });
    hit.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fire(G.CX, G.CY); } });
  }
  // ---------- 軟 Q 按鈕（被子彈打到的果凍感） ----------
  function bindJelly() {
    host.querySelectorAll('.hm-jelly').forEach(function (e) {
      e.addEventListener('pointerdown', function (ev) {
        if (busy) return;
        var r = e.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, sk = e.querySelector('.hm-skin'), dn = sk.querySelector('.hm-dent');
        dn.style.left = x + 'px'; dn.style.top = y + 'px';
        var rp = D.createElement('i'); rp.className = 'hm-rip'; rp.style.left = x + 'px'; rp.style.top = y + 'px'; sk.appendChild(rp); setTimeout(function () { rp.remove(); }, 520);
        e.classList.remove('boing'); e.classList.add('sq'); vib(12);
      });
      var up = function () { if (!e.classList.contains('sq')) return; e.classList.remove('sq'); void e.offsetWidth; e.classList.add('boing'); vib([0, 40, 8]); };
      e.addEventListener('pointerup', up); e.addEventListener('pointerleave', function () { e.classList.remove('sq'); }); e.addEventListener('pointercancel', function () { e.classList.remove('sq'); });
      e.addEventListener('animationend', function (a) { if (a.animationName === 'hmBoing') e.classList.remove('boing'); });
      e.addEventListener('click', function () {
        if (busy) return;
        var k = e.dataset.k;
        if (k === 'set' || k === 'help') { busy = true; setTimeout(function () { hide(function () { openAbout(k); }); }, reduced() ? 0 : 220); return; }
        var nm = RB.filter(function (b) { return b[0] === k; })[0];
        setTimeout(function () { toast(wrT('home.soon_toast', [wrT(nm[1]), wrT(nm[3])]), 2400); }, reduced() ? 0 : 140);
      });
    });
  }
  function openAbout(sub) {
    try { App.showTab('about'); if (App.stSub) App.stSub.set(sub, { noScroll: true }); window.scrollTo(0, 0); } catch (e) {}
  }
  var rsT = 0;
  window.addEventListener('resize', function () { if (!onNow || busy) return; clearTimeout(rsT); rsT = setTimeout(draw, 120); });

  // 標題列「WRbeta」＝回首頁
  var ttl = D.querySelector('header .title');
  if (ttl) {
    ttl.setAttribute('role', 'button'); ttl.tabIndex = 0; ttl.setAttribute('aria-label', wrT('home.go_home'));
    var goHome = function () { show(); };
    ttl.addEventListener('click', goHome); ttl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
  }

  App.home = {
    show: show, hide: function () { hide(); }, fire: function (x, y) { return fire(x, y); }, aim: function (x, y) { aim(x, y); },
    toast: function (m, ms) { if (built) toast(m, ms); }, get on() { return onNow; }, get geom() { return G; }, get busy() { return busy; }, ENTER_MS: ENTER_MS, REVEAL_MS: REVEAL_MS, KEY: KEY
  };
  if (H.classList.contains('wr-home')) show(); else host.hidden = true;
})(window.WRApp = window.WRApp || {});
