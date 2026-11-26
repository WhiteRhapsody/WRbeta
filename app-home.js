/* WRbeta v2.9.0 首頁（White 2026-11-23 定稿＝/workspace/home_concept/v3c）
 * - v2.9.1：開槍後在彈孔旁邊飄出分數（取代提示氣泡）；靶紙下移 4mm、右移 2mm；版本卡片不壓靶紙。
 * - v2.9.2（§7 第 19 項，White 指定）：上方深色區（標語＋版本更新紀錄卡片）整個往下延伸到 2 環線，可以蓋到一點靶紙。
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
    ['v3.0 beta', '2026/11/27', ['home.v300_1', 'home.v300_2', 'home.v300_3', 'home.v300_4']],
    ['v2.9.6', '2026/11/26', ['home.v296_1', 'home.v296_2']],
    ['v2.9.5', '2026/11/25', ['home.v295_1', 'home.v295_2']],
    ['v2.9.4', '2026/11/25', ['home.v294_1', 'home.v294_2', 'home.v294_3', 'home.v294_4']],
    ['v2.9.3', '2026/11/24', ['home.v293_1', 'home.v293_2', 'home.v293_3', 'home.v293_4']],
    ['v2.9.2', '2026/11/24', ['home.v292_1', 'home.v292_2', 'home.v292_3', 'home.v292_4']],
    ['v2.9.1', '2026/11/23', ['home.v291_1', 'home.v291_2', 'home.v291_3', 'home.v291_4']],
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

  // v2.9.4 第 13 項：「教練」打開教練版（兩個空白分頁，施工中，app-coach.js）；其他三顆仍是即將推出
  function soonOf(k) { return k === 'coach' && App.coach ? wrT('coach.wip') : wrT('home.soon'); }
  function build() {
    host.className = 'wr-home'; host.setAttribute('role', 'region'); host.setAttribute('aria-label', wrT('home.aria'));
    var vl = VLOG.map(function (v) {
      var now = v[0] === ver();
      return '<div class="hm-ve"><div class="hm-vt"><span class="hm-ver' + (now ? '' : ' old') + '">' + v[0] + '</span><span class="hm-d">' + v[1] + '</span>' + (now ? '<span class="hm-now">' + esc(wrT('home.current')) + '</span>' : '') + '</div><ul>' +
        v[2].map(function (k) { return '<li>' + esc(wrT(k)) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    host.innerHTML = '<div class="hm-stage"><svg class="hm-tg" aria-hidden="true" focusable="false"></svg><svg class="hm-tg hm-xtop" aria-hidden="true" focusable="false"></svg>' +
      '<div class="hm-hit" data-xh="off" role="button" tabindex="0" aria-label="' + esc(wrT('home.player_aria')) + '"></div>' +
      '<div class="hm-plbl" aria-hidden="true">' + esc(wrT('home.player')) + '</div><div class="hm-ahint" aria-hidden="true">' + esc(wrT('home.aim_hint')) + '</div>' +
      RB.map(function (b) { return '<button type="button" class="hm-rb hm-jelly" data-xh="off" data-k="' + b[0] + '" aria-label="' + esc(wrT(b[1]) + ' · ' + soonOf(b[0])) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic(b[0]) + '<b>' + esc(wrT(b[1])) + '</b><span class="hm-soon">' + esc(soonOf(b[0])) + '</span></span></button>'; }).join('') +
      '</div>' +
      '<div class="hm-band" aria-hidden="true"></div><div class="hm-top"><div class="hm-bar"><button type="button" class="hm-gear hm-jelly" data-k="set" aria-label="' + esc(wrT('home.settings')) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic('gear') + '</span></button>' +
      '<button type="button" class="hm-gear hm-jelly" data-k="help" aria-label="' + esc(wrT('home.help')) + '"><span class="hm-skin"><i class="hm-dent"></i></span><span class="hm-in">' + ic('info') + '</span></button>' +
      '<span class="hm-vpill">' + esc(ver()) + '</span><span class="hm-beta">beta</span></div>' + // v3.0 beta：版號在前、beta 在後（「v3.0 beta」）
      '<div class="hm-brand" lang="en">White Rhapsody</div><div class="hm-tag" lang="en">' + esc(wrT('home.tagline')) + '</div>' +
      '<section class="hm-vlog" aria-label="' + esc(wrT('home.vlog')) + '"><div class="hm-vhd"><b>' + esc(wrT('home.vlog')) + '</b><span>' + esc(wrT('home.vlog_more')) + '</span></div><div class="hm-vsc" tabindex="0">' + vl + '</div></section></div>' +
      '<div class="hm-toast" role="status" aria-live="polite"></div>';
    els.svg = host.querySelector('.hm-tg'); els.xtop = host.querySelector('.hm-xtop'); els.hit = host.querySelector('.hm-hit'); els.lbl = host.querySelector('.hm-plbl'); els.hint = host.querySelector('.hm-ahint');
    els.toast = host.querySelector('.hm-toast'); els.vlog = host.querySelector('.hm-vlog'); els.stage = host.querySelector('.hm-stage'); els.band = host.querySelector('.hm-band');
    bindJelly(); bindAim();
    built = true;
  }

  // ---------- 靶紙 ----------
  function geom() {
    var W = H.clientWidth || window.innerWidth || 412, Hh = window.innerHeight || H.clientHeight || 915, k = Math.min(1.25, W / 412);
    var S = 5.55 * W / 412;                  // px/mm：黑區半徑≈0.40×寬（White 的裁切）
    // v2.9.1【White 2026-11-23 #12】靶紙整體下移 22k px（≈4mm，原本 CY = H − 82k）、再往右 2mm（原本 CX = 0.82W），比例不變（環照 TARGETS.ap10）
    return { W: W, H: Hh, k: k, S: S, CX: 0.82 * W + 2 * S, CY: Hh - 60 * k, Cpx: TG.cardSize * S };
  }
  function draw() {
    var g = G = geom(), svg = els.svg, S = g.S, CX = g.CX, CY = g.CY, C2 = g.Cpx / 2;
    svg.setAttribute('viewBox', '0 0 ' + g.W + ' ' + g.H); svg.setAttribute('width', g.W); svg.setAttribute('height', g.H);
    svg.innerHTML = ''; host.classList.remove('hm-snap');
    if (els.xtop) { els.xtop.setAttribute('viewBox', '0 0 ' + g.W + ' ' + g.H); els.xtop.setAttribute('width', g.W); els.xtop.setAttribute('height', g.H); els.xtop.innerHTML = ''; }
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
    // v2.9.2【White 指定 2026-11-23 21:47，§7 第 19 項】上方深色區塊（標語＋版本更新紀錄卡片）整個往下延伸到靶紙 2 環線（可以蓋到一點靶紙）：
    //   .hm-band 下緣＝2 環線（CY − 2 環外半徑）；卡片下緣＝2 環線上方 12px（APP製作仔照 19_*.png 設計圖）。原本「卡片不壓靶紙、最高 226k」（v2.9.1 #12）取消。
    var bandB = Math.max(0, CY - TG.ringDiam[2] / 2 * S);
    els.band.style.height = bandB + 'px';
    // v2.9.2（Gemini PR #5 第 1 則）先全部量、最後只寫一次卡片高度（原本寫 → 量 → 再寫，會多一次強制排版）。
    //   條目的位置跟卡片高度無關（由內容排版決定），所以可以先用「預計的高度」算出切線。getComputedStyle 回傳 null 時用預設值（Gemini 防呆建議）。
    var vt = els.vlog.getBoundingClientRect().top, maxB = bandB - 12, h0 = Math.max(72, maxB - vt);
    var csV = getComputedStyle(els.vlog), bd = csV ? (parseFloat(csV.borderBottomWidth) || 0) : 0, lim = vt + h0 - bd - 1, cut = 0;
    // 最後一行要完整：卡片底邊切在「最後一行完整的字」的行框底下（條目之間或同一條的兩行之間），下一行的字不會露出半截；淡出只剩 6px（themes.css .hm-vsc）。
    els.vlog.querySelectorAll('.hm-vt').forEach(function (v) { var y = v.getBoundingClientRect().bottom + 2; if (y <= lim) cut = Math.max(cut, y); }); // 很矮的畫面：至少切在版本列底下
    els.vlog.querySelectorAll('.hm-ve li').forEach(function (li) {
      var r = li.getBoundingClientRect(), csL = getComputedStyle(li), lh = (csL && parseFloat(csL.lineHeight)) || 19, n = Math.max(1, Math.round(r.height / lh));
      for (var i = 1; i <= n; i++) { var y = r.top + r.height * i / n; if (y <= lim) cut = Math.max(cut, y); }
    });
    els.vlog.style.height = (cut ? Math.max(72, Math.min(maxB, cut + 1 + bd) - vt) : h0) + 'px';
  }
  function aim(x, y) {
    var g = G || (G = geom()), C2 = g.Cpx / 2;
    els.xhH.setAttribute('x1', g.CX - C2); els.xhH.setAttribute('x2', g.CX + C2); els.xhH.setAttribute('y1', y); els.xhH.setAttribute('y2', y);
    els.xhV.setAttribute('y1', g.CY - C2); els.xhV.setAttribute('y2', g.CY + C2); els.xhV.setAttribute('x1', x); els.xhV.setAttribute('x2', x);
    els.xhO.setAttribute('cx', x); els.xhO.setAttribute('cy', y);
  }
  function holePath(x, y, R, amp) { var n = 48, pts = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, k = 1 + (rnd() - 0.5) * amp; if (rnd() < 0.08) k -= amp * 0.8; pts.push((x + Math.cos(a) * R * k).toFixed(2) + ',' + (y + Math.sin(a) * R * k).toFixed(2)); } return pts.join(' '); }
  // 螢幕座標 → 靶面 mm（y 往上為正，同 core.js）
  function toMm(x, y) { var g = G || (G = geom()); return { x: (x - g.CX) / g.S, y: -(y - g.CY) / g.S }; } // v2.9.1（Gemini PR #4）防呆
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
    // v2.9.1【White 2026-11-23】不用提示氣泡，只在彈孔旁邊飄出分數（「9.2！」）；文字提示改成只給螢幕報讀（hm-toast.sr，看不見）
    popScore(x, y, dec, onBlack, sc.ring === 10);
    if (sc.ring === 10) {
      busy = true; els.lbl.classList.add('gone'); els.hint.classList.add('gone');
      toast(wrT('home.hit', [dec]), ENTER_MS + REVEAL_MS + 200, 'sr');
      clearTimeout(enterT); enterT = setTimeout(function () { reveal(x, y); }, ENTER_MS);
    } else {
      toast(sc.ring ? wrT('home.miss_ring', [dec, sc.ring]) : wrT('home.miss_out'), 1800, 'sr');
      setTimeout(function () { if (busy) return; els.xh.classList.remove('out'); unsnap(); aim(G.CX, G.CY); }, 900);
    }
    host.dataset.last = JSON.stringify({ x: +x.toFixed(2), y: +y.toFixed(2), ring: sc.ring, dec: sc.dec, holeD: +(2 * R).toFixed(3), pxPerMm: +g.S.toFixed(4) });
    return sc;
  }
  // ---------- v2.9.1 分數浮字 ----------
  // 顏色：彈孔在黑區（7–10 環）＝「拍下一張寶寶」主按鈕色（--w-camB，鋼琴烤漆用 --w-camBd）＋深色描邊；
  //       黑區外（白色環區）＝寶藍 #1f45d6＋白色描邊（APP製作仔決定，見 themes.css .hm-pop.off）。
  // 位置：彈孔右上方；右邊放不下就放左上方；不出畫面。動畫：放大彈跳 → 往上飄 → 淡出（減少動態＝靜止顯示後消失）。
  var POP_MS = 1600;
  function popScore(x, y, dec, onBlack, ten) {
    var g = G || (G = geom()), R = TG.pellet / 2 * g.S, e = D.createElement('div');
    e.className = 'hm-pop' + (onBlack ? '' : ' off') + (ten ? ' ten' : ''); e.setAttribute('aria-hidden', 'true');
    e.textContent = dec + '!';
    e.style.fontSize = ((ten ? 44 : 38) * g.k).toFixed(1) + 'px';
    els.stage.appendChild(e);
    var w = e.offsetWidth, h = e.offsetHeight, gap = R + 4 * g.k;
    var lx = x + gap; if (lx + w > g.W - 4) lx = x - gap - w; lx = Math.max(4, Math.min(lx, g.W - w - 4));
    var ty = Math.max(4, y - h * 0.95);
    e.style.left = lx.toFixed(1) + 'px'; e.style.top = ty.toFixed(1) + 'px';
    e.style.transformOrigin = (x < lx ? 0 : w) + 'px ' + h + 'px';
    var ms = ten ? ENTER_MS + REVEAL_MS : POP_MS;
    e.style.setProperty('--hm-pop-ms', ms + 'ms');
    setTimeout(function () { e.remove(); }, ms + 80);
    return e;
  }
  function reveal(x, y) {
    if (!onNow) return;
    host.style.setProperty('--hm-x', x + 'px'); host.style.setProperty('--hm-y', y + 'px');
    if (reduced()) { hide(goAna); return; }
    host.classList.add('hm-reveal');
    clearTimeout(revealT); revealT = setTimeout(function () { hide(goAna); }, REVEAL_MS + 60);
  }
  // v2.9.3【White 指定 2026-11-24】首頁點選手（打中十環進入）後一律到「分析」頁：不管之前停在哪一頁、什麼時候回首頁都一樣（Pro、Lite 都是）
  function goAna() { try { App.showTab('analysis'); window.scrollTo(0, 0); } catch (e) {} }
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
    host.querySelectorAll('.hm-pop').forEach(function (p) { p.remove(); });
    var sc = host.querySelector('.hm-vsc'); if (sc) sc.scrollTop = 0;
    draw(); els.xh.classList.remove('out');
    try { if (App.back) App.back.sync(); } catch (e) {}
  }

  // ---------- 瞄準與開槍 ----------
  // v2.9.4 第 25 項（White 指定）：瞄準到「裁判／教練／新聞／社群」按鈕時，大十字線本身吸附到按鈕中心；
  //   按鈕上不再另外冒出按壓小十字（按鈕加 data-xh="off"，crosshair.js 就不畫）。按住按鈕＝十字移到那顆中心，放開後回選手；
  //   從選手拖著瞄準滑過按鈕也一樣吸附（開槍也打在吸附的中心）。
  function rbAt(x, y) {
    var hit = null; host.querySelectorAll('.hm-rb').forEach(function (b) { if (hit) return; var r = b.getBoundingClientRect(); if (!r.width) return; var cx = r.left + r.width / 2, cy = r.top + r.height / 2; if (Math.hypot(x - cx, y - cy) <= r.width / 2) hit = { x: cx, y: cy, k: b.dataset.k }; });
    return hit;
  }
  // 吸附時把準心搬到按鈕上面那一層（.hm-xtop，z-index 在按鈕之上），沒吸附時放回靶紙那一層（在按鈕下面，跟以前一樣）
  function snap(p) { var h = rbAt(p.x, p.y); host.classList.toggle('hm-snap', !!h); var to = h ? els.xtop : els.svg; if (els.xh && to && els.xh.parentNode !== to) to.appendChild(els.xh); return h ? { x: h.x, y: h.y } : p; }
  function unsnap() { host.classList.remove('hm-snap'); if (els.xh && els.xh.parentNode !== els.svg) els.svg.appendChild(els.xh); }
  function pt(ev) { return snap({ x: ev.clientX, y: ev.clientY }); }
  function bindAim() {
    var hit = els.hit;
    hit.addEventListener('pointerdown', function (ev) { if (busy || !onNow) return; aiming = true; try { hit.setPointerCapture(ev.pointerId); } catch (e) {} var p = pt(ev); els.xh.classList.remove('out'); aim(p.x, p.y); });
    hit.addEventListener('pointermove', function (ev) { if (!aiming) return; var p = pt(ev); aim(p.x, p.y); });
    hit.addEventListener('pointerup', function (ev) { if (!aiming) return; aiming = false; var p = pt(ev); fire(p.x, p.y); });
    hit.addEventListener('pointercancel', function () { aiming = false; unsnap(); aim(G.CX, G.CY); });
    hit.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fire(G.CX, G.CY); } });
  }
  // ---------- 軟 Q 按鈕（被子彈打到的果凍感） ----------
  var rbT = 0;
  function bindJelly() {
    host.querySelectorAll('.hm-jelly').forEach(function (e) {
      e.addEventListener('pointerdown', function (ev) {
        if (busy) return;
        var r = e.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, sk = e.querySelector('.hm-skin'), dn = sk.querySelector('.hm-dent');
        dn.style.left = x + 'px'; dn.style.top = y + 'px';
        var rp = D.createElement('i'); rp.className = 'hm-rip'; rp.style.left = x + 'px'; rp.style.top = y + 'px'; sk.appendChild(rp); setTimeout(function () { rp.remove(); }, 520);
        e.classList.remove('boing'); e.classList.add('sq'); vib(12);
        if (e.classList.contains('hm-rb') && !aiming) { clearTimeout(rbT); var c = snap({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); els.xh.classList.remove('out'); aim(c.x, c.y); }
      });
      if (e.classList.contains('hm-rb')) { var back = function () { clearTimeout(rbT); rbT = setTimeout(function () { if (busy || aiming) return; unsnap(); aim(G.CX, G.CY); }, 450); }; ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { e.addEventListener(n, back); }); }
      var up = function () { if (!e.classList.contains('sq')) return; e.classList.remove('sq'); void e.offsetWidth; e.classList.add('boing'); vib([0, 40, 8]); };
      e.addEventListener('pointerup', up); e.addEventListener('pointerleave', function () { e.classList.remove('sq'); }); e.addEventListener('pointercancel', function () { e.classList.remove('sq'); });
      e.addEventListener('animationend', function (a) { if (a.animationName === 'hmBoing') e.classList.remove('boing'); });
      e.addEventListener('click', function () {
        if (busy) return;
        var k = e.dataset.k;
        if (k === 'set' || k === 'help') { busy = true; setTimeout(function () { hide(function () { openAbout(k); }); }, reduced() ? 0 : 220); return; }
        if (k === 'coach' && App.coach) { busy = true; setTimeout(function () { hide(function () { App.coach.open(); }); }, reduced() ? 0 : 220); return; }
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

  // v2.9.1【White 2026-11-23】各分頁左上角的小「首頁」按鈕（標題列最左邊；按了回靶紙首頁）
  // v2.9.2（Gemini PR #5 第 2、6 則）用 ttl.parentNode 插入（不假設 .title 一定是 header 的直接子元素）
  var hb = null;
  if (ttl && ttl.parentNode) {
    var hl = D.createElement('div'); hl.className = 'hleft'; ttl.parentNode.insertBefore(hl, ttl); hl.appendChild(ttl);
    hb = D.createElement('button'); hb.type = 'button'; hb.id = 'wrHomeBtn'; hb.className = 'wr-homebtn'; hb.setAttribute('aria-label', wrT('home.go_home'));
    hb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2L12 4l8.5 7.2"/><path d="M6 9.6V20h4.6v-5.6h2.8V20H18V9.6"/></svg><span>' + esc(wrT('home.home_btn')) + '</span>';
    hl.insertBefore(hb, ttl);
    hb.addEventListener('click', function () { show(); });
  }

  App.home = {
    show: show, hide: function () { hide(); }, fire: function (x, y) { return fire(x, y); }, aim: function (x, y) { aim(x, y); },
    toast: function (m, ms) { if (built) toast(m, ms); }, POP_MS: POP_MS, get on() { return onNow; }, get geom() { return G; }, get busy() { return busy; }, ENTER_MS: ENTER_MS, REVEAL_MS: REVEAL_MS, KEY: KEY
  };
  if (H.classList.contains('wr-home')) show(); else host.hidden = true;
})(window.WRApp = window.WRApp || {});
