/* WRbeta v1.7.0 分析頁拍照按鈕（相簿／拍下一張／檔案）自動收邊（window.WRDock）
 * - 閒置 3 秒：三顆按鈕一顆接一顆滑出螢幕邊緣（預設往左；有主題動畫時帶一點預備動作與回彈）
 * - 收起後留下半顆小圓（主題色）＋兩隻黑眼睛：每隔幾秒眨眼、偶爾往畫面內瞄一下；點它或從它往內滑＝按鈕依序滑回來
 * - 按住任一顆按鈕拖曳／甩到任何一邊（左右上下）＝改停在那一邊、那個位置（存在 localStorage 'wr_dock_v1'）
 *   之後從小圓往內拉出來時，按鈕出現在手指拉出的位置（左右邊＝Y，上下邊＝X）；閒置 3 秒再縮回原本收起的位置
 * - 按鈕組左下角的小「⌂」＝回到預設位置（下方中間那一排）
 * - 靶面、照片的觸控完全不碰；不跟 C 左右滑（.ana-dock／.dk-eye 在 NO_SWIPE）、編輯版面長按（按鈕不算長按）、雙指縮放衝突
 * - 主題動畫關閉或系統「減少動態效果」：只單純滑動，不眨眼、不瞄、不回彈
 * - 位移一律用 CSS 的 translate 屬性（不是 transform），不會被主題的按壓動效、呼吸動畫蓋掉
 */
(function () {
  'use strict';
  var KEY = 'wr_dock_v1', IDLE = 3000, EDGES = ['home', 'left', 'right', 'top', 'bottom'];
  var D = document.getElementById('anaDock'), E = document.getElementById('anaEye'), HB = document.getElementById('dockHome'), B = document.body;
  if (!D || !E) return;
  var opts = { enabled: true, active: function () { return true; }, toast: function () {} };
  var st = load(), hidden = false, hideT = 0, seqT = 0, holding = false, drag = null, swallow = 0, eyeP = null, raf = 0;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mq && mq.matches); }
  function lively() { return B.classList.contains('fx-anim') && !reduced(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && EDGES.indexOf(v.edge) >= 0) return { edge: v.edge, pos: isFinite(+v.pos) ? clamp(+v.pos, 0, 1) : 0.5 }; } catch (e) {} return { edge: 'home', pos: 0.5 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function items() { return [].slice.call(D.querySelectorAll(':scope > .dk-it')); }
  function W() { return window.innerWidth || document.documentElement.clientWidth || 400; }
  function H() { return window.innerHeight || document.documentElement.clientHeight || 800; }
  function hideEdge() { return st.edge === 'home' ? 'left' : st.edge; }
  function vis(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'; }
  // 可用區域：標題列（C 的小圓點列）下面、功能列（A 圖示列／Lite 步驟列）上面
  function lines() {
    var top = 0, bot = H(), hd = document.querySelector('header'), nc = document.getElementById('wrNavC'), nv = document.getElementById('wrNav'), ls = document.getElementById('liteSteps');
    if (hd) top = Math.max(top, hd.getBoundingClientRect().bottom);
    if (nc && vis(nc)) top = Math.max(top, nc.getBoundingClientRect().bottom);
    if (B.classList.contains('lite')) { if (ls && vis(ls)) bot = Math.min(bot, ls.getBoundingClientRect().top); }
    else if (B.classList.contains('nav-a') && !B.classList.contains('nav-hidden') && nv) { var r = nv.querySelector('.wr-nav-in'); if (r) bot = Math.min(bot, r.getBoundingClientRect().top); }
    return { top: top, bot: bot };
  }
  // ---------- 擺放 ----------
  function setEdgeClass(edge) {
    D.dataset.edge = edge; D.classList.toggle('dk-free', edge !== 'home');
    D.classList.toggle('dk-col', edge === 'left' || edge === 'right');
  }
  // 自由位置：pos＝按鈕組中心沿著那一邊的位置（0–1）
  var livePos = null; // 目前按鈕組實際所在的位置（拉出來時跟手指；收起時＝st.pos）
  function place(edge, pos) {
    setEdgeClass(edge); livePos = pos;
    var s = D.style; s.left = s.right = s.top = s.bottom = '';
    if (edge === 'home') return;
    var L = lines(), w = D.offsetWidth, h = D.offsetHeight, M = 6;
    if (edge === 'left' || edge === 'right') {
      s[edge] = 'calc(' + M + 'px + env(safe-area-inset-' + edge + '))';
      s.top = clamp(pos * H() - h / 2, L.top + M, Math.max(L.top + M, L.bot - h - M)) + 'px';
    } else {
      s.left = clamp(pos * W() - w / 2, M, Math.max(M, W() - w - M)) + 'px';
      if (edge === 'top') s.top = (L.top + M) + 'px'; else s.top = Math.max(L.top + M, L.bot - h - M) + 'px';
    }
  }
  // 每顆按鈕要移多遠才完全出畫面
  function curTr(el) { var m = String(el.style.translate || '').match(/(-?[\d.]+)px\s+(-?[\d.]+)px/); return m ? [+m[1], +m[2]] : [0, 0]; }
  // v2.9.4：按鈕旁邊掛著的小按鈕（.dk-att，例如拍下一張寶寶旁的小白單）也要一起算進範圍，才會整個滑出畫面
  function box(el) { var q = el.getBoundingClientRect(), r = { left: q.left, right: q.right, top: q.top, bottom: q.bottom }; [].forEach.call(el.querySelectorAll('.dk-att'), function (a) { var z0 = a.getBoundingClientRect(); if (!(z0.width > 0 && z0.height > 0) || getComputedStyle(a).display === 'none') return; /* 收起後整組 visibility:hidden，不能用 vis() */ var z = a.getBoundingClientRect(); r.left = Math.min(r.left, z.left); r.right = Math.max(r.right, z.right); r.top = Math.min(r.top, z.top); r.bottom = Math.max(r.bottom, z.bottom); }); return r; }
  function offFor(el, edge) { // 回傳「完全出畫面」時 translate 的值（扣掉目前已經有的位移）
    var q = box(el), c = curTr(el), g = 18, r = { left: q.left - c[0], right: q.right - c[0], top: q.top - c[1], bottom: q.bottom - c[1] };
    if (edge === 'left') return [-(r.right + g), 0];
    if (edge === 'right') return [W() - r.left + g, 0];
    if (edge === 'top') return [0, -(r.bottom + g)];
    return [0, H() - r.top + g];
  }
  function order(edge) { var l = items(); return edge === 'right' || edge === 'bottom' ? l.reverse() : l; } // 靠近那一邊的先走
  function tr(el, x, y) { el.style.translate = (x || y) ? (x.toFixed(1) + 'px ' + y.toFixed(1) + 'px') : ''; }
  function clearSeq() { clearTimeout(seqT); }
  // ---------- 收起／叫出 ----------
  function hide(instant) {
    clearTimeout(hideT); if (hidden && !instant) return;
    var edge = hideEdge(), live = lively(), l = order(edge), pk = document.getElementById('anaPickHint');
    if (pk && !pk.hidden) { pk.hidden = true; var qi = document.getElementById('anaPickInfo'); if (qi) qi.setAttribute('aria-expanded', 'false'); }
    if (D.contains(document.activeElement)) try { E.focus({ preventScroll: true }); } catch (e) {}
    hidden = true; B.classList.add('dk-hiding'); clearSeq();
    var dur = live ? 420 : 240, stag = live ? 80 : 0, ease = live ? 'cubic-bezier(.55,-0.38,.75,.35)' : 'ease-in';
    l.forEach(function (el, i) {
      var o = offFor(el, edge);
      el.style.transition = instant ? 'none' : 'translate ' + dur + 'ms ' + ease + ' ' + (i * stag) + 'ms,opacity ' + dur + 'ms ease ' + (i * stag) + 'ms';
      tr(el, o[0], o[1]); el.style.opacity = '0.4';
    });
    D.classList.add('dk-out'); D.setAttribute('aria-hidden', 'true'); try { D.inert = true; } catch (e) {}
    var total = instant ? 0 : dur + stag * (l.length - 1) - (live ? 120 : 60);
    seqT = setTimeout(function () { D.classList.add('dk-hidden'); B.classList.remove('dk-hiding'); if (st.edge !== 'home') livePos = st.pos; showEye(!instant); }, Math.max(0, total));
  }
  // at：手指拉出的位置（沿著那一邊，px）；沒有就用收起時的位置
  function reveal(at, instant) {
    clearTimeout(hideT); clearSeq();
    var edge = hideEdge(), live = lively();
    if (st.edge !== 'home') { var len = (edge === 'left' || edge === 'right') ? H() : W(); place(st.edge, at != null ? clamp(at / len, 0, 1) : st.pos); }
    if (!hidden) { arm(); return; }
    hidden = false; hideEye(!instant);
    D.classList.remove('dk-hidden', 'dk-out'); D.removeAttribute('aria-hidden'); try { D.inert = false; } catch (e) {}
    var l = order(edge), offs = l.map(function (el) { el.style.transition = 'none'; tr(el, 0, 0); return offFor(el, edge); });
    l.forEach(function (el, i) { tr(el, offs[i][0], offs[i][1]); el.style.opacity = '0.4'; });
    void D.offsetWidth;
    var dur = live ? 480 : 240, stag = live ? 70 : 0, ease = live ? 'cubic-bezier(.2,1.45,.42,1)' : 'ease-out';
    l.forEach(function (el, i) {
      el.style.transition = instant ? 'none' : 'translate ' + dur + 'ms ' + ease + ' ' + (i * stag) + 'ms,opacity ' + Math.round(dur * .6) + 'ms ease ' + (i * stag) + 'ms';
      tr(el, 0, 0); el.style.opacity = '';
    });
    seqT = setTimeout(function () { l.forEach(function (el) { el.style.transition = ''; }); }, instant ? 0 : dur + stag * l.length + 30);
    arm();
  }
  function arm() {
    clearTimeout(hideT);
    if (!opts.enabled || hidden) return;
    hideT = setTimeout(function () {
      var pk = document.getElementById('anaPickHint');
      if (!opts.active() || holding || drag || document.hidden || B.classList.contains('lay-editing') || (pk && !pk.hidden)) { arm(); return; }
      hide();
    }, IDLE);
  }
  // ---------- 小圓（眼睛） ----------
  function eyeSpot() {
    var edge = hideEdge(), L = lines(), r = 29, p;
    if (st.edge === 'home') { var dr = D.getBoundingClientRect(); p = dr.top + dr.height / 2 + 4; }
    else p = st.pos * ((edge === 'left' || edge === 'right') ? H() : W());
    if (edge === 'left' || edge === 'right') p = clamp(p, L.top + r + 4, Math.max(L.top + r + 4, L.bot - r - 4));
    else p = clamp(p, r + 6, W() - r - 6);
    return { edge: edge, p: p, L: L };
  }
  function placeEye() {
    var s = eyeSpot(), es = E.style; E.dataset.edge = s.edge; es.left = es.right = es.top = es.bottom = '';
    var R = 29, peek = -27; // 直徑 58px，露出約 31px
    if (s.edge === 'left' || s.edge === 'right') { es[s.edge] = 'calc(' + peek + 'px + env(safe-area-inset-' + s.edge + '))'; es.top = (s.p - R) + 'px'; }
    else { es.left = (s.p - R) + 'px'; es.top = (s.edge === 'top' ? s.L.top + peek : s.L.bot - 2 * R - peek) + 'px'; }
  }
  function showEye(anim) {
    placeEye(); E.hidden = false; E.classList.remove('dk-eye-out');
    E.classList.toggle('dk-eye-in', !!anim); if (anim) { void E.offsetWidth; }
    clearTimeout(E._t); E._t = setTimeout(function () { E.classList.remove('dk-eye-in'); }, 700);
  }
  function hideEye(anim) {
    if (E.hidden) return;
    if (!anim || !lively()) { E.hidden = true; return; }
    E.classList.add('dk-eye-out'); clearTimeout(E._t); E._t = setTimeout(function () { E.hidden = true; E.classList.remove('dk-eye-out'); }, 200);
  }
  function along(edge, x, y) { return edge === 'left' || edge === 'right' ? y : x; }
  function inward(edge, dx, dy) { return edge === 'left' ? dx : edge === 'right' ? -dx : edge === 'top' ? dy : -dy; }
  E.addEventListener('pointerdown', function (e) { if (e.button > 0) return; eyeP = { x: e.clientX, y: e.clientY, id: e.pointerId, done: false }; try { E.setPointerCapture(e.pointerId); } catch (x) {} });
  E.addEventListener('pointermove', function (e) {
    if (!eyeP || eyeP.done || e.pointerId !== eyeP.id) return;
    var edge = hideEdge(), dx = e.clientX - eyeP.x, dy = e.clientY - eyeP.y;
    if (inward(edge, dx, dy) > 14) { eyeP.done = true; swallow = Date.now(); reveal(st.edge === 'home' ? null : along(edge, e.clientX, e.clientY)); }
  });
  function eyeUp() { eyeP = null; }
  E.addEventListener('pointerup', eyeUp); E.addEventListener('pointercancel', eyeUp);
  E.addEventListener('click', function (e) { e.preventDefault(); if (Date.now() - swallow < 600) return; reveal(null); });
  // ---------- 拖曳／甩到任何一邊 ----------
  D.addEventListener('pointerdown', function (e) {
    holding = true; clearTimeout(hideT);
    if (e.button > 0 || !e.isPrimary || hidden) return;
    var it = e.target.closest('.dk-it'); if (!it || e.target.closest('.wr-qi,.dk-home,.wr-pop')) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, pts: [[e.clientX, e.clientY, performance.now()]] };
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.hypot(dx, dy) < 12) return;
      drag.on = true; D.classList.add('dk-drag'); B.classList.add('dk-dragging'); clearSeq();
      items().forEach(function (el) { el.style.transition = 'none'; });
      try { D.setPointerCapture(e.pointerId); } catch (x) {}
    }
    e.preventDefault();
    drag.pts.push([e.clientX, e.clientY, performance.now()]); if (drag.pts.length > 6) drag.pts.shift();
    items().forEach(function (el) { tr(el, dx, dy); });
  }, { passive: false, capture: true });
  function dragEnd(e) {
    holding = false;
    if (!drag || (e && e.pointerId !== drag.id)) { arm(); return; }
    var d = drag; drag = null; D.classList.remove('dk-drag'); B.classList.remove('dk-dragging');
    if (!d.on) { arm(); return; }
    swallow = Date.now();
    var last = d.pts[d.pts.length - 1], first = d.pts[0], dt = Math.max(16, last[2] - first[2]);
    var vx = (last[0] - first[0]) / dt, vy = (last[1] - first[1]) / dt; // px/ms
    var dx = last[0] - d.x, dy = last[1] - d.y, fling = Math.hypot(vx, vy) > 0.5;
    if (e && e.type === 'pointercancel' || (Math.hypot(dx, dy) < 48 && !fling)) { // 太短：彈回原位
      items().forEach(function (el) { el.style.transition = 'translate .28s cubic-bezier(.2,1.3,.4,1)'; tr(el, 0, 0); });
      arm(); return;
    }
    // 按鈕組中心＋慣性（0.15 秒）→ 決定最近的一邊；沿著那一邊的位置用放手時的位置（不加慣性，停在手放開的地方）
    var r = D.getBoundingClientRect(), x0 = r.left + r.width / 2 + dx, y0 = r.top + r.height / 2 + dy, cx = x0 + vx * 150, cy = y0 + vy * 150, L = lines();
    var dist = { left: cx, right: W() - cx, top: cy - L.top, bottom: L.bot - cy }, edge = 'left';
    Object.keys(dist).forEach(function (k) { if (dist[k] < dist[edge]) edge = k; });
    var len = (edge === 'left' || edge === 'right') ? H() : W();
    relocate(edge, clamp(along(edge, x0, y0) / len, 0, 1));
  }
  document.addEventListener('pointerup', dragEnd, true);
  document.addEventListener('pointercancel', dragEnd, true);
  D.addEventListener('click', function (e) { if (Date.now() - swallow < 500) { e.preventDefault(); e.stopPropagation(); } }, true);
  // 換位置：FLIP（從手指放開的位置接到新的位置），自動隱藏開著就順勢收進那一邊
  function relocate(edge, pos) {
    var l = items(), before = l.map(function (el) { return el.getBoundingClientRect(); });
    st = { edge: edge, pos: pos }; save();
    l.forEach(function (el) { el.style.transition = 'none'; tr(el, 0, 0); });
    place(edge, pos);
    var after = l.map(function (el) { return el.getBoundingClientRect(); });
    l.forEach(function (el, i) { tr(el, before[i].left - after[i].left, before[i].top - after[i].top); });
    void D.offsetWidth;
    // v2.9.4 第 23 項（White 指定）：拿掉「拍照按鈕收到右邊（從眼睛那裡拉出來）」提示泡泡（四個邊都不再跳）
    if (opts.enabled) { hidden = false; hide(); }
    else { var live = lively(); l.forEach(function (el, i) { el.style.transition = 'translate ' + (live ? 420 : 220) + 'ms ' + (live ? 'cubic-bezier(.2,1.3,.4,1)' : 'ease-out') + ' ' + (live ? i * 50 : 0) + 'ms'; tr(el, 0, 0); }); }
  }
  function home(quiet) {
    var wasHidden = hidden, l = items(), before = l.map(function (el) { return el.getBoundingClientRect(); });
    st = { edge: 'home', pos: 0.5 }; save();
    clearSeq(); hideEye(false); hidden = false;
    D.classList.remove('dk-hidden', 'dk-out'); D.removeAttribute('aria-hidden'); try { D.inert = false; } catch (e) {}
    l.forEach(function (el) { el.style.transition = 'none'; tr(el, 0, 0); el.style.opacity = ''; });
    place('home');
    var live = lively() && !wasHidden;
    if (live) {
      var after = l.map(function (el) { return el.getBoundingClientRect(); });
      l.forEach(function (el, i) { tr(el, before[i].left - after[i].left, before[i].top - after[i].top); });
      void D.offsetWidth;
      l.forEach(function (el, i) { el.style.transition = 'translate .46s cubic-bezier(.2,1.25,.4,1) ' + (i * 50) + 'ms'; tr(el, 0, 0); });
    }
    if (!quiet) opts.toast(wrT('dock.camera_buttons_back_to_default'));
    arm();
  }
  if (HB) HB.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); home(); });
  ['pointerup', 'focusin', 'change'].forEach(function (t) { D.addEventListener(t, function () { if (!drag) arm(); }); });
  // 捲動、轉向、功能列出現／隱藏時，小圓跟著重新對齊
  function relayout() { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { if (st.edge !== 'home' && !drag) { var keep = hidden; place(st.edge, hidden || livePos == null ? st.pos : livePos); if (keep) { items().forEach(function (el) { el.style.transition = 'none'; tr(el, 0, 0); var o = offFor(el, hideEdge()); tr(el, o[0], o[1]); }); } } if (hidden && !E.hidden) placeEye(); }); }
  window.addEventListener('resize', relayout); window.addEventListener('scroll', relayout, { passive: true });
  new MutationObserver(relayout).observe(B, { attributes: true, attributeFilter: ['class'] });
  place(st.edge, st.pos);
  window.WRDock = {
    init: function (o) { for (var k in o) opts[k] = o[k]; if (!opts.enabled) reveal(null, true); },
    setEnabled: function (on) { opts.enabled = !!on; if (!on) reveal(null, true); else arm(); },
    // 進入分析分頁：先顯示，閒置 3 秒再收
    shown: function () { place(st.edge, st.pos); if (hidden) reveal(null, true); else arm(); },
    left: function () { clearTimeout(hideT); },
    hide: function (instant) { hide(!!instant); }, reveal: function (at) { reveal(at == null ? null : at); }, home: home, relocate: relocate,
    get hidden() { return hidden; }, get state() { return { edge: st.edge, pos: st.pos }; }, get enabled() { return opts.enabled; }, IDLE: IDLE, KEY: KEY
  };
})();
