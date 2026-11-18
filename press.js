// WRbeta 按壓手感（v1.3.1 起用在 Lite；v1.5.0 起 Pro 的新功能列／靶面圓鈕也有，其他 Pro 按鈕不受影響）
// - 按鈕：按下加 .pz-down，放開換成 .pz-up（回彈動畫）；樣式依主題寫在 style.css 的「v1.3.1 按壓動效」區塊。
//   CSS 也有 :active 備援（沒有 JS 事件時一樣有按下的樣子）。
// - 上方四個資訊方塊：純手感，按下時那一塊微縮（幅度比按鈕小），不觸發任何功能、不擋捲動或其他手勢。
// 只監聽、不呼叫 preventDefault，所以不影響點擊、靶面縮放、拖曳彈孔與頁面捲動。
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var MIN_HOLD = 90;      // 很快的點擊也至少「壓住」這麼久，才看得到壓下去
  var POP_MS = 520;       // 回彈動畫長度（比 CSS 動畫稍長，結束後清掉 class）
  var MOVE_CANCEL = 12;   // 手指移動超過這個距離＝在捲動，放開按壓
  var BTN_SEL = '#liteView button, #liteView .lite-srcbtn, #liteSteps button, .lt-sheet button, #ghostView button'; // v1.4.0：鬼影模式的按鈕也有
  // v1.5.0：Pro 新的功能列（A／B／C）、靶面右下圓鈕、縮放提示、介面設定的三個選項——Pro 和 Lite 都有按壓動效
  var ANY_SEL = '#wrNav button, #wrFab, .pf-btn, .pf-pinch, #wrNavC button, #navStyleSeg button';
  var BLOCKS = [['big', 'Big'], ['cnt', 'Cnt'], ['est', 'Est'], ['sum', 'Sum']];
  var CELL = { big: '.lp-c-big', cnt: '.lp-c-cnt', est: '.lp-c-est', sum: '.lp-c-sum' };

  function isLite() { return document.body && document.body.classList.contains('lite'); }
  function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // ---------- 按鈕 ----------
  var cur = null; // { el, t0, x, y, id }
  function pressable(t) {
    if (!t || !t.closest) return null;
    var el = t.closest(ANY_SEL) || (isLite() ? t.closest(BTN_SEL) : null);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
    return el;
  }
  function down(el, e) {
    if (cur && cur.el !== el) up(true);
    clearTimeout(el._pzT);
    el.classList.remove('pz-up');
    // 強制重新計算，連按時回彈動畫可以從頭再播
    void el.offsetWidth;
    el.classList.add('pz-down');
    cur = { el: el, t0: Date.now(), x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function up(cancel) {
    if (!cur) return;
    var el = cur.el, wait = cancel ? 0 : Math.max(0, MIN_HOLD - (Date.now() - cur.t0));
    cur = null;
    clearTimeout(el._pzT);
    el._pzT = setTimeout(function () {
      el.classList.remove('pz-down');
      if (reduced()) return;
      el.classList.add('pz-up');
      afterPop(el, function () { el.classList.remove('pz-up'); });
    }, wait);
  }

  // 回彈結束後清掉 .pz-up／.ib-up-*：有 CSS 動畫（運動風）就等 animationend，沒有就等 POP_MS；另有保險計時
  function afterPop(el, done, holder) {
    holder = holder || el;
    var fin = function () { el.removeEventListener('animationend', onEnd); clearTimeout(holder._pzT); done(); };
    var onEnd = function (ev) { if (ev.target === el) fin(); };
    var anim = 'none';
    try { anim = getComputedStyle(el).animationName; } catch (e) {}
    clearTimeout(holder._pzT);
    if (anim && anim !== 'none') { el.addEventListener('animationend', onEnd); holder._pzT = setTimeout(fin, 3000); }
    else holder._pzT = setTimeout(fin, POP_MS);
  }

  // ---------- 資訊方塊 ----------
  var blk = null; // { k, id, x, y, t0 }
  function pts(k) {
    var p = document.getElementById('lp' + k + 'Bg'); if (!p) return null;
    var s = (p.getAttribute('points') || '').trim(); if (!s) return null;
    return s.split(/\s+/).map(function (q) { var a = q.split(','); return [+a[0], +a[1]]; });
  }
  function inside(P, x, y) {
    var c = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  // 找出手指下的方塊（用 SVG 外形判斷，viewBox 100×52）；回傳 [key, 外形]
  function hitBlock(panel, e) {
    var r = panel.getBoundingClientRect(); if (!r.width || !r.height) return null;
    var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 52;
    for (var i = 0; i < BLOCKS.length; i++) { var P = pts(BLOCKS[i][1]); if (P && inside(P, x, y)) return [BLOCKS[i][0], P, r]; }
    return null;
  }
  // 這一塊的四個圖層（玻璃底、色塊、高光、文字）都以同一個中心點縮放，看起來是一整塊被按下
  function blockEls(panel, k) {
    var K = { big: 'Big', cnt: 'Cnt', est: 'Est', sum: 'Sum' }[k];
    return { glass: document.getElementById('lpG' + K), bg: document.getElementById('lp' + K + 'Bg'), sh: document.getElementById('lp' + K + 'Sh'), cell: panel.querySelector(CELL[k]) };
  }
  function blockDown(panel, hit, e) {
    var k = hit[0], P = hit[1], r = hit[2];
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    P.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    var cx = (x0 + x1) / 2 / 100 * panel.offsetWidth, cy = (y0 + y1) / 2 / 52 * panel.offsetHeight;
    var E = blockEls(panel, k);
    if (E.glass) E.glass.style.transformOrigin = cx.toFixed(1) + 'px ' + cy.toFixed(1) + 'px';
    if (E.cell) E.cell.style.transformOrigin = (cx - E.cell.offsetLeft).toFixed(1) + 'px ' + (cy - E.cell.offsetTop).toFixed(1) + 'px';
    // SVG 圖層用 transform-box:fill-box＋中心點（CSS 設定）；位移單位＝viewBox 單位，換算成畫面 px
    panel.style.setProperty('--pu', (100 / (panel.offsetWidth || 100)).toFixed(4));
    if (blk) blockUp(true);
    clearTimeout(panel._pzT);
    BLOCKS.forEach(function (b) { panel.classList.remove('ib-up-' + b[0], 'ib-down-' + b[0]); });
    void panel.offsetWidth;
    panel.classList.add('ib-down', 'ib-down-' + k);
    panel.dataset.ibPressed = k;
    blk = { k: k, id: e.pointerId, x: e.clientX, y: e.clientY, t0: Date.now(), panel: panel };
  }
  function blockUp(cancel) {
    if (!blk) return;
    var b = blk, wait = cancel ? 0 : Math.max(0, MIN_HOLD - (Date.now() - b.t0));
    blk = null;
    clearTimeout(b.panel._pzT);
    var fin = function () {
      b.panel.classList.remove('ib-down', 'ib-down-' + b.k);
      delete b.panel.dataset.ibPressed;
      if (reduced()) return;
      b.panel.classList.add('ib-up-' + b.k);
      var cell = b.panel.querySelector(CELL[b.k]);
      afterPop(cell || b.panel, function () { b.panel.classList.remove('ib-up-' + b.k); }, b.panel);
    };
    if (wait) b.panel._pzT = setTimeout(fin, wait); else fin();
  }

  // ---------- 事件（全部 passive，不攔截） ----------
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) { up(true); blockUp(true); return; } // 第二根手指（縮放）＝取消
    var el = pressable(e.target);
    if (el) { down(el, e); return; }
    if (!isLite()) return;
    var panel = e.target.closest && e.target.closest('#litePanel');
    if (panel) { var h = hitBlock(panel, e); if (h) blockDown(panel, h, e); }
  }
  function onMove(e) {
    if (cur && e.pointerId === cur.id && Math.hypot(e.clientX - cur.x, e.clientY - cur.y) > MOVE_CANCEL) up(true);
    if (blk && e.pointerId === blk.id && Math.hypot(e.clientX - blk.x, e.clientY - blk.y) > MOVE_CANCEL) blockUp(true);
  }
  function onUp(e) {
    if (cur && (e.pointerId === cur.id || e.type !== 'pointerup')) up(e.type !== 'pointerup');
    if (blk && (e.pointerId === blk.id || e.type !== 'pointerup')) blockUp(e.type !== 'pointerup');
  }
  function onLeave(e) {
    // 滑鼠移出按鈕＝放開（觸控的 pointerleave 發生在放開之後，交給 pointerup 處理）
    if (e.pointerType === 'mouse' && cur && e.target === cur.el) up(true);
  }
  var opt = { passive: true, capture: true };
  document.addEventListener('pointerdown', onDown, opt);
  document.addEventListener('pointermove', onMove, opt);
  document.addEventListener('pointerup', onUp, opt);
  document.addEventListener('pointercancel', onUp, opt);
  document.addEventListener('pointerleave', onLeave, opt);
  window.addEventListener('blur', function () { up(true); blockUp(true); });
  // iOS Safari：要有 touchstart 監聽 :active 才會生效（CSS 備援用）
  document.addEventListener('touchstart', function () {}, { passive: true });
  document.documentElement.classList.add('pz-js');
  window.WRPress = { version: 1, get pressedButton() { return cur && cur.el; }, get pressedBlock() { return blk && blk.k; } };
})();
