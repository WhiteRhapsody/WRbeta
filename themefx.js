/* WRbeta v1.6.0 主題動畫（window.WRFx）
 * 只有「賽博龐克」與「電子世界」會改畫靶面：幾何仍是 core.js 的 ISSF 環徑，這裡只加顏色（CSS，見 themes.css）與裝飾層。
 * - 賽博龐克：隨機故障跳動（切片、RGB 分離、雜訊、抖動），每秒最多更新 15 次；RGB 分離用兩份偏移的靶面複本（不用 SVG 濾鏡，省電）
 * - 電子世界：環的脈動、沿環跑的光跡、中心漣漪（純 CSS 動畫）
 * - 按到靶面時暫停約 1.5 秒；畫面切到背景時暫停；系統「減少動態效果」或設定關閉「主題動畫」時完全不動
 * - 彈孔（#marks）、預覽與照片檢視都不受影響；自動偵測讀的是照片，不會讀到這些裝飾
 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', B = document.body;
  var FX_THEMES = { cyberpunk: 1, tron: 1 };
  var theme = 'sport', enabled = true, paused = false, pauseT = 0;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mq && mq.matches); }
  function el(n, a, p) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  // 決定性亂數（同一個時間格每次算出相同結果）
  function h(i, s) { var x = (Math.imul(i, 374761393) + Math.imul(s, 668265263)) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  function stripIds(n) { if (n.removeAttribute) { n.removeAttribute('id'); for (var c = n.firstChild; c; c = c.nextSibling) stripIds(c); } return n; }
  function active() { return enabled && !reduced() && !!FX_THEMES[theme]; }
  function syncBody() {
    var on = enabled && !reduced();
    B.classList.toggle('fx-anim', on);
    B.classList.toggle('fx-paused', paused || document.hidden);
    B.classList.toggle('fx-theme', !!FX_THEMES[theme]);
  }
  // ---------- 靶面裝飾（drawTarget 畫完後呼叫） ----------
  var svgs = [];
  function decorate(svg, t) {
    var face = svg.querySelector('#tg'); if (!face || !t) return;
    svg.classList.toggle('fx-cy', theme === 'cyberpunk'); svg.classList.toggle('fx-tr', theme === 'tron');
    hostOverlays(svg);
    if (!FX_THEMES[theme]) { svg._fx = null; return; }
    var lines = svg.querySelector('#lines'), RB = t.blackDiam / 2, R = function (n) { return t.ringDiam[n] / 2; }, lw = t.ringLine;
    // 靜態光暈層（放在靶面裡、環線下面）：同一組環換成粗而淡的線
    var black = face.querySelector('.tg-black'), glow = el('g', { 'class': 'tg-glow', 'aria-hidden': 'true' });
    face.insertBefore(glow, black ? black.nextSibling : face.firstChild);
    for (var n = 1; n <= 10; n++) if (!(n === 10 && t.tenIsDot)) el('circle', { cx: 0, cy: 0, r: R(n), 'class': 'tg-gl', 'data-b': band(t, n), 'stroke-width': lw * 4 }, glow);
    el('circle', { cx: 0, cy: 0, r: RB, 'class': 'tg-gl tg-gl-edge', 'stroke-width': lw * 6 }, glow);
    el('circle', { cx: 0, cy: 0, r: RB, 'class': 'tg-edge', 'stroke-width': lw * 1.6 }, face);
    if (theme === 'cyberpunk') {
      var tk = el('g', { 'class': 'tg-ticks' }, face), a, r0 = RB + lw * 2, i;
      for (i = 0; i < 72; i++) { a = i * Math.PI / 36; var r1 = r0 + (i % 6 ? 1 : 2) * t.cardSize * 0.008; el('line', { x1: Math.cos(a) * r0, y1: Math.sin(a) * r0, x2: Math.cos(a) * r1, y2: Math.sin(a) * r1, 'stroke-width': lw * 0.8 }, tk); }
      // 故障層：兩份偏移的靶面複本（RGB 分離）＋ 4 條切片＋雜訊；平常隱藏，由 tick() 控制
      var fx = el('g', { 'class': 'fx-glitch', 'aria-hidden': 'true', 'pointer-events': 'none' });
      svg.insertBefore(fx, lines);
      var rgbR = stripIds(face.cloneNode(true)), rgbC = stripIds(face.cloneNode(true));
      rgbR.setAttribute('class', 'fx-rgb fx-r'); rgbC.setAttribute('class', 'fx-rgb fx-c');
      fx.appendChild(rgbR); fx.appendChild(rgbC);
      var defs = el('defs', {}, fx), sl = [], uid = (svg.id || 'tg') + '-fx', c = t.cardSize;
      for (i = 0; i < 4; i++) {
        var cp = el('clipPath', { id: uid + i }, defs), cr = el('rect', { x: -c, y: 0, width: c * 2, height: 1 }, cp);
        var g = el('g', { 'clip-path': 'url(#' + uid + i + ')', 'class': 'fx-slice' + (i % 2 ? ' fx-c' : ' fx-r') }, fx);
        g.appendChild(stripIds(face.cloneNode(true)));
        sl.push({ g: g, r: cr });
      }
      var nz = el('g', { 'class': 'fx-noise' }, fx), nr = [];
      for (i = 0; i < 9; i++) nr.push(el('rect', { x: 0, y: 0, width: 1, height: 1, 'data-k': i % 4 }, nz));
      svg._fx = { svg: svg, face: face, rgb: [rgbR, rgbC], sl: sl, nz: nr, E: +svg.dataset.extent || c, c: c, st: '' };
      calm(svg._fx);
      if (svgs.indexOf(svg) < 0) svgs.push(svg);
      ensureLoop();
    } else {
      // 電子世界：脈動光暈、三道沿環跑的光跡、中心漣漪（CSS 動畫；pathLength=100 讓所有靶種用同一組 keyframes）
      var tf = el('g', { 'class': 'fx-tron', 'aria-hidden': 'true', 'pointer-events': 'none' });
      svg.insertBefore(tf, lines);
      var rr = [RB, R(9), R(Math.max(1, t.printedNumbers[0] || 3))];
      rr.forEach(function (r, k) { el('circle', { cx: 0, cy: 0, r: r, pathLength: 100, 'class': 'tr-cycle tr-c' + (k + 1), 'stroke-width': lw * (k ? 2.4 : 3.2) }, tf); });
      el('circle', { cx: 0, cy: 0, r: R(9) * 1.15, 'class': 'tr-ripple', 'stroke-width': lw * 1.2 }, tf);
      svg._fx = null;
    }
  }
  function band(t, n) { if (n >= 10) return 't'; if (n === 9) return 'h'; return t.ringDiam[n] <= t.blackDiam + 1e-9 ? 'i' : 'o'; }
  // 掃描線、警示條（賽博龐克）、地板網格（電子世界）：放在靶面外框（.svgwrap 等）裡，永遠不接收點擊
  function hostOverlays(svg) {
    var host = svg.parentElement; if (!host) return;
    var ok = host.classList.contains('svgwrap') || host.classList.contains('lite-tg') || host.classList.contains('gh-tg') || host.classList.contains('fx-host');
    if (!ok) return;
    host.classList.add('fx-host');
    var over = host.querySelector(':scope > .fx-over'), under = host.querySelector(':scope > .fx-under');
    if (!FX_THEMES[theme]) { if (over) over.remove(); if (under) under.remove(); return; }
    if (!over) { over = document.createElement('div'); over.className = 'fx-over'; over.setAttribute('aria-hidden', 'true'); host.appendChild(over); }
    if (!under) { under = document.createElement('div'); under.className = 'fx-under'; under.setAttribute('aria-hidden', 'true'); host.insertBefore(under, host.firstChild); }
    var want = theme === 'cyberpunk' ? '<i class="fx-scan"></i><i class="fx-hz t"></i><i class="fx-hz b"></i>' : '';
    if (over.dataset.th !== theme) { over.innerHTML = want; over.dataset.th = theme; }
    var wu = theme === 'tron' ? '<i class="fx-floor"></i>' : '';
    if (under.dataset.th !== theme) { under.innerHTML = wu; under.dataset.th = theme; }
  }
  // ---------- 賽博龐克故障：每秒最多 15 次 ----------
  function calm(F) {
    if (F.st === 'calm') return; F.st = 'calm'; F.svg.classList.remove('fx-hard');
    var k = F.E / 100, a = 0.16 * k;
    F.face.removeAttribute('transform');
    F.rgb[0].setAttribute('transform', 'translate(' + (-a).toFixed(3) + ' 0)'); F.rgb[1].setAttribute('transform', 'translate(' + a.toFixed(3) + ' 0)');
    F.rgb[0].style.opacity = F.rgb[1].style.opacity = '';
    F.sl.forEach(function (s) { s.g.style.display = 'none'; });
    F.nz.forEach(function (r) { r.style.display = 'none'; });
  }
  function draw(svg, ts) {
    var F = svg._fx; if (!F || !svg.isConnected) return;
    F.E = +svg.dataset.extent || F.c;
    var t = ts / 1000, win = Math.floor(t / 0.55), burst = h(win, 1) < 0.5, tick = Math.floor(t / 0.0667), hard = burst && h(tick, 2) < 0.7;
    if (!hard || !active() || paused || document.hidden) { calm(F); return; }
    if (F.st !== 'hard') F.svg.classList.add('fx-hard'); F.st = 'hard';
    var k = F.E / 100, amp = (0.5 + h(tick, 3) * 0.9) * k;
    F.rgb[0].setAttribute('transform', 'translate(' + (-amp).toFixed(3) + ' ' + (h(tick, 8) - 0.5).toFixed(2) * k * 0.3 + ')');
    F.rgb[1].setAttribute('transform', 'translate(' + amp.toFixed(3) + ' 0)');
    F.rgb[0].style.opacity = F.rgb[1].style.opacity = '.9';
    var jx = h(tick, 4) < 0.35 ? (h(tick, 5) - 0.5) * 1.6 * k : 0;
    if (jx) F.face.setAttribute('transform', 'translate(' + jx.toFixed(3) + ' 0)'); else F.face.removeAttribute('transform');
    // 切片：在目前看得到的範圍裡挑 1–4 條橫帶往左右錯開
    var vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), y0 = vb[1] || -F.c / 2, H = vb[3] || F.c, x0 = vb[0] || -F.c / 2, W = vb[2] || F.c;
    var ns = 1 + Math.floor(h(tick, 6) * 4);
    F.sl.forEach(function (s, j) {
      if (j >= ns) { s.g.style.display = 'none'; return; }
      var y = y0 + h(tick, 10 + j) * H * 0.92, hh = H * (0.012 + h(tick, 20 + j) * 0.055), dx = (h(tick, 30 + j) - 0.5) * W * 0.1;
      s.r.setAttribute('y', y.toFixed(3)); s.r.setAttribute('height', hh.toFixed(3));
      s.g.firstChild.setAttribute('transform', 'translate(' + dx.toFixed(3) + ' 0)');
      s.g.style.display = '';
    });
    var nb = 3 + Math.floor(h(tick, 7) * 6);
    F.nz.forEach(function (r, q) {
      if (q >= nb) { r.style.display = 'none'; return; }
      r.setAttribute('x', (x0 + h(tick, 50 + q) * W * 0.95).toFixed(3)); r.setAttribute('y', (y0 + h(tick, 60 + q) * H).toFixed(3));
      r.setAttribute('width', (W * (0.012 + h(tick, 70 + q) * 0.1)).toFixed(3)); r.setAttribute('height', (H * (0.004 + h(tick, 80 + q) * 0.013)).toFixed(3));
      r.style.display = '';
    });
  }
  var loopT = 0, lastTick = -1, frames = 0;
  function ensureLoop() { if (!loopT && active()) loopT = setTimeout(loop, 67); }
  function loop() {
    loopT = 0;
    svgs = svgs.filter(function (s) { return s.isConnected && s._fx; });
    if (!svgs.length || theme !== 'cyberpunk') return;
    var now = performance.now(), tk = Math.floor(now / 66.7);
    if (tk !== lastTick) { lastTick = tk; frames++; svgs.forEach(function (s) { if (s.getClientRects().length) draw(s, now); }); }
    if (active()) loopT = setTimeout(loop, 67); // 每秒最多 15 次
    else svgs.forEach(function (s) { if (s._fx) calm(s._fx); });
  }
  // ---------- 暫停：按到靶面 1.5 秒、背景分頁 ----------
  var TARGET = 'svg.target,.ana-photobox,.photobox,svg.lite-photo';
  function pauseNow() {
    if (!FX_THEMES[theme]) return;
    paused = true; syncBody(); svgs.forEach(function (s) { if (s._fx) calm(s._fx); });
    clearTimeout(pauseT); pauseT = setTimeout(function () { paused = false; syncBody(); ensureLoop(); }, 1500);
  }
  document.addEventListener('pointerdown', function (e) { if (e.target && e.target.closest && e.target.closest(TARGET)) pauseNow(); }, true);
  document.addEventListener('visibilitychange', function () { syncBody(); if (!document.hidden) ensureLoop(); });
  if (mq) { var onMq = function () { syncBody(); if (!active()) svgs.forEach(function (s) { if (s._fx) calm(s._fx); }); else ensureLoop(); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
  window.WRFx = {
    decorate: decorate,
    setTheme: function (th) { theme = th; syncBody(); ensureLoop(); },
    setEnabled: function (on) { enabled = !!on; syncBody(); if (!active()) svgs.forEach(function (s) { if (s._fx) calm(s._fx); }); else ensureLoop(); },
    get enabled() { return enabled; }, get theme() { return theme; }, get paused() { return paused || document.hidden; },
    get running() { return !!loopT; }, get frames() { return frames; },
    pause: pauseNow, reduced: reduced, FX_THEMES: FX_THEMES
  };
  syncBody();
})();
