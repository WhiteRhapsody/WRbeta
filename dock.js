/* WRbeta v1.7.0 分析頁拍照按鈕（相簿／拍下一張／檔案）自動收邊（window.WRDock）；v3.0 beta 起同一套也給小白單三寶寶用（window.WRDockMake）
 * - 閒置 1.8 秒（v3.0 beta，White 2026-11-27 指定；原本 3 秒）：收到邊緣（預設往左）。有主題動畫時跑美術仔的收合動畫（FIG-18／FIG-19），否則單純滑動
 * - 收起後留下半顆小圓（主題色）＋兩隻黑眼睛：每隔幾秒眨眼、偶爾往畫面內瞄一下；點它或從它往內滑＝叫回來
 * - 按住任一顆按鈕拖曳／甩到任何一邊（左右上下）＝改停在那一邊、那個位置（存在 localStorage：分析頁 'wr_dock_v1'、小白單 'wr_dock_sius_v1'）
 *   之後從小圓往內拉出來時，按鈕出現在手指拉出的位置（左右邊＝Y，上下邊＝X）；閒置再縮回原本收起的位置；停在左右邊＝直排、上下邊＝橫排
 * - 按鈕組左下角的小「⌂」＝回到預設位置（下方中間那一排）
 * - 靶面、照片的觸控完全不碰；不跟 C 左右滑（.ana-dock／.dk-eye 在 NO_SWIPE）、編輯版面長按（按鈕不算長按）、雙指縮放衝突
 * - 主題動畫關閉或系統「減少動態效果」：只單純滑動，不眨眼、不瞄、不回彈
 * - 位移一律用 CSS 的 translate 屬性（不是 transform），不會被主題的按壓動效、呼吸動畫蓋掉
 */
(function () {
  'use strict';
  function makeDock(cfg) {
  var KEY = cfg.key, IDLE = cfg.idle || 1800, EDGES = ['home', 'left', 'right', 'top', 'bottom'];
  var D = cfg.dock, E = cfg.eye, HB = cfg.home, B = document.body;
  if (!D || !E) return null;
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
    var edge = hideEdge(), live = lively(), l = order(edge);
    if (cfg.onHide) try { cfg.onHide(); } catch (e) {}
    morphStop();
    if (D.contains(document.activeElement)) try { E.focus({ preventScroll: true }); } catch (e) {}
    hidden = true; B.classList.add('dk-hiding'); clearSeq();
    if (live && !instant && cfg.morph) { morphHide(edge, l); return; }
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
    var wasMorph = morphStop();
    hidden = false; hideEye(!instant && !wasMorph);
    if (live && !instant && cfg.morph) { morphReveal(edge, wasMorph); arm(); return; }
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
      if (!opts.active() || holding || drag || document.hidden || B.classList.contains('lay-editing') || (cfg.busy && cfg.busy())) { arm(); return; }
      hide();
    }, IDLE);
  }

  /* ---------- v3.0 beta 收合／叫回動畫（美術仔 FIG-18 分析頁寶寶、FIG-19 小白單三寶寶；White 2026-11-27 指定，閒置 1.8 秒） ----------
   * 只在 body.fx-anim 而且沒開「減少動態效果」時跑；否則照舊只單純滑動。位移一律用 translate／scale／rotate 屬性（不用 transform）。
   * 收：配件淡出 → 旁邊的按鈕／寶寶收進中間那顆 →（分析頁）中間那顆翻面變成臉／（小白單）擠一下、戴上小白單帽 → 蓄力、小弧線跳到邊邊、縮成 58px → 探頭（dkPeek）。
   * 叫回：探頭縮回（dkBye）→ 按鈕／寶寶從小圓的位置彈出來 → 配件淡入。 */
  var mAnims = [], mT = [], mEl = null;
  function ma(el, kf, o) { var a = el.animate(kf, Object.assign({ fill: 'forwards' }, o)); mAnims.push(a); return a; }
  function mLater(fn, t) { mT.push(setTimeout(fn, t)); }
  function morphStop() { // 回傳：剛剛是不是正在收（收到一半被叫回）
    var was = !!mEl || mT.length > 0;
    mT.forEach(clearTimeout); mT = []; mAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); mAnims = [];
    if (mEl) { mEl.remove(); mEl = null; }
    return was;
  }
  function ctr(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
  function eyeCtr() { var s = eyeSpot(); if (s.edge === 'left') return { x: 2, y: s.p }; if (s.edge === 'right') return { x: W() - 2, y: s.p }; if (s.edge === 'top') return { x: s.p, y: s.L.top + 2 }; return { x: s.p, y: s.L.bot - 2 }; }
  function inV(edge) { return { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] }[edge]; }
  function accs() { return cfg.acc ? [].slice.call(D.querySelectorAll(cfg.acc)) : []; }
  function puff(x, y, delay, n, kind) {
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i'); p.className = kind === 'star' ? 'dk-star' : 'dk-puff'; document.body.appendChild(p);
      var a = Math.PI * 2 * i / n + (kind === 'star' ? 0.3 : 1.1), r = kind === 'star' ? 34 : 22;
      p.style.left = (x - 8) + 'px'; p.style.top = (y - 8) + 'px';
      var an = p.animate([{ translate: '0 0', scale: .3, opacity: 0 }, { opacity: 1, offset: .25 }, { translate: (Math.cos(a) * r).toFixed(1) + 'px ' + (Math.sin(a) * r).toFixed(1) + 'px', scale: kind === 'star' ? .9 : 1.5, opacity: 0 }], { duration: kind === 'star' ? 520 : 600, delay: delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
      an.onfinish = an.oncancel = (function (q) { return function () { q.remove(); }; })(p);
    }
  }
  function morphHide(edge, l) {
    var main = cfg.main && cfg.main(); if (!main || l.indexOf(main) < 0) main = l[Math.floor(l.length / 2)];
    var xb = cfg.morph === 'xb', T = xb ? { fade: 0, gather: 360, gd: 460, swap: 600, slide: 1040, sd: 700, smoke: 1560 } : { fade: 0, gather: 180, gd: 400, swap: 1020, slide: 1720, sd: 680, smoke: 2240 };
    var mc = ctr(main), side = l.filter(function (el) { return el !== main; });
    accs().forEach(function (el) { ma(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, delay: T.fade, easing: 'cubic-bezier(.4,0,.2,1)' }); });
    if (xb && cfg.base) { var bs = cfg.base(); if (bs) ma(bs, [{ scale: '1 1', opacity: 1 }, { scale: '1.05 1.08', offset: .16 }, { scale: D.classList.contains('dk-col') ? '1 .86' : '.86 1', offset: .55 }, { scale: '.12 .6', opacity: 1, offset: .88 }, { scale: '.12 .6', opacity: 0 }], { duration: 440, delay: 40, easing: 'linear' }); }
    side.forEach(function (el, i) {
      var c = ctr(el), dx = mc.x - c.x, dy = mc.y - c.y;
      ma(el, [{ translate: '0px 0px', scale: 1, opacity: 1, easing: 'cubic-bezier(0.22,1.42,0.36,1)' }, { translate: (dx * .55).toFixed(1) + 'px ' + (dy * .55).toFixed(1) + 'px', scale: .92, opacity: 1, offset: .35, easing: 'cubic-bezier(0.22,1.42,0.36,1)' }, { translate: dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px', scale: .28, opacity: 0 }], { duration: T.gd, delay: T.gather + i * 70, easing: 'linear' });
    });
    // 臉（跟邊邊的小圓同一個樣子）：先藏在中間那顆後面，翻面／擠一下之後接手
    var M = mEl = E.cloneNode(true); M.removeAttribute('id'); M.hidden = false; M.classList.remove('dk-eye-in', 'dk-eye-out'); M.classList.add('dk-morph'); M.dataset.edge = edge; M.setAttribute('aria-hidden', 'true'); M.tabIndex = -1;
    M.style.left = (mc.x - 29) + 'px'; M.style.top = (mc.y - 29) + 'px'; M.style.opacity = '0'; M.style.right = M.style.bottom = '';
    document.body.appendChild(M);
    var k0 = Math.max(mc.w, mc.h) / 58;
    if (xb) {
      ma(main, [{ scale: '1 1', easing: 'cubic-bezier(.2,.8,.2,1)' }, { scale: '1.16 .84', offset: .32, easing: 'cubic-bezier(.2,.8,.2,1)' }, { scale: '.9 1.12', offset: .68 }, { scale: '1 1' }], { duration: 280, delay: 520, easing: 'linear' });
      ma(main, [{ opacity: 1 }, { opacity: 0 }], { duration: 60, delay: T.swap, easing: 'linear' });
      ma(M, [{ opacity: 0, scale: k0 }, { opacity: 1, scale: k0 }], { duration: 60, delay: T.swap, easing: 'linear' });
      var hat = M.querySelector('.wrx-hat'); if (hat) ma(hat, [{ opacity: 0, scale: .4 }, { opacity: 1, scale: 1.18, offset: .55, easing: 'cubic-bezier(0.32,1.28,0.44,1)' }, { opacity: 1, scale: 1 }], { duration: 320, delay: T.swap, easing: 'linear' });
      puff(mc.x, mc.y, T.swap - 40, 5, 'star');
    } else {
      // B2：中間那顆繞 Y 軸翻面（rotateY 只用在 rotate 屬性），背面就是寶寶的臉；同時吸成圓（clip-path）
      ma(main, [{ rotate: 'y 0deg', clipPath: 'circle(75% at 50% 50%)' }, { rotate: 'y 90deg', clipPath: 'circle(24px at 50% 50%)' }], { duration: 280, delay: T.swap, easing: 'cubic-bezier(.55,0,.8,.4)' });
      ma(main, [{ opacity: 1 }, { opacity: 0 }], { duration: 1, delay: T.swap + 279 });
      ma(M, [{ opacity: 0, rotate: 'y -90deg', scale: k0 }, { opacity: 1, rotate: 'y -90deg', scale: k0, offset: .01 }, { opacity: 1, rotate: 'y 0deg', scale: k0 }], { duration: 280, delay: T.swap + 280, easing: 'cubic-bezier(.2,.7,.3,1)' });
      ma(M, [{ scale: k0 }, { scale: 1 }], { duration: 140, delay: T.swap + 560, easing: 'cubic-bezier(.4,0,.2,1)', composite: 'replace' });
    }
    // C：蓄力 → 小弧線跳到邊邊（擠壓伸展）→ 停在探頭起點
    var end = eyeCtr(), iv = inV(edge), tuck = { x: end.x - iv[0] * 30, y: end.y - iv[1] * 30 }, ant = { x: mc.x + iv[0] * 16, y: mc.y + iv[1] * 16 };
    var sideE = edge === 'left' || edge === 'right', mid = { x: (mc.x + tuck.x) / 2 + (sideE ? 0 : 16), y: (mc.y + tuck.y) / 2 + (sideE ? -22 : 0) };
    var tp = function (p) { return (p.x - mc.x).toFixed(1) + 'px ' + (p.y - mc.y).toFixed(1) + 'px'; }, k1 = xb ? k0 : 1;
    mLater(function () {
      if (!mEl) return;
      ma(M, [{ translate: '0px 0px', scale: k1 + ' ' + k1, opacity: 1, easing: 'cubic-bezier(.4,0,.6,1)' }, { translate: tp(ant), scale: sideE ? (k1 * .88) + ' ' + (k1 * 1.12) : (k1 * 1.12) + ' ' + (k1 * .88), offset: .2, easing: 'cubic-bezier(.2,.7,.25,1)' },
        { translate: tp(mid), scale: sideE ? '1.18 .82' : '.82 1.18', offset: .52, easing: 'cubic-bezier(.2,.15,.2,1)' }, { translate: tp(tuck), scale: sideE ? '.9 1.1' : '1.1 .9', offset: .85, easing: 'cubic-bezier(0.32,1.28,0.44,1)' }, { translate: tp(tuck), scale: '1 1', opacity: 1 }], { duration: T.sd, easing: 'linear' });
      var hat = M.querySelector('.wrx-hat'); if (hat) ma(hat, [{ translate: '0px 0px' }, { translate: (-iv[0] * 4) + 'px ' + (-iv[1] * 4) + 'px', offset: .2 }, { translate: (iv[0] * 12) + 'px ' + (iv[1] * 12 + (sideE ? 8 : 0)) + 'px', offset: .52 }, { translate: '0px 0px' }], { duration: T.sd, easing: 'linear', composite: 'add' });
    }, T.slide);
    mLater(function () { puff(end.x, end.y, 0, 4, 'puff'); }, T.smoke);
    mLater(function () {
      morphStop();
      l.forEach(function (el) { el.style.transition = 'none'; var o = offFor(el, edge); tr(el, o[0], o[1]); el.style.opacity = '0.4'; });
      accs().forEach(function (el) { el.style.opacity = ''; });
      D.classList.add('dk-out', 'dk-hidden'); D.setAttribute('aria-hidden', 'true'); try { D.inert = true; } catch (e) {}
      B.classList.remove('dk-hiding'); if (st.edge !== 'home') livePos = st.pos;
      showEye(true);
    }, T.slide + T.sd);
    D.classList.add('dk-out'); D.setAttribute('aria-hidden', 'true'); try { D.inert = true; } catch (e) {}
  }
  function morphReveal(edge, wasMorph) {
    var from = eyeCtr(), l = order(edge), xb = cfg.morph === 'xb', d0 = wasMorph ? 0 : 200;
    D.classList.remove('dk-hidden', 'dk-out'); D.removeAttribute('aria-hidden'); try { D.inert = false; } catch (e) {}
    B.classList.remove('dk-hiding');
    l.forEach(function (el) { el.style.transition = 'none'; tr(el, 0, 0); el.style.opacity = ''; });
    if (xb && cfg.base) { var bs = cfg.base(); if (bs) ma(bs, [{ opacity: 0, scale: '.3 .8' }, { opacity: 1, scale: '1 1' }], { duration: 420, delay: d0, easing: 'cubic-bezier(0.22,1.42,0.36,1)', fill: 'backwards' }); }
    l.forEach(function (el, i) {
      var c = ctr(el), dx = from.x - c.x, dy = from.y - c.y;
      ma(el, [{ translate: dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px', scale: .45, opacity: 0 }, { opacity: 1, offset: .3 }, { translate: '0px 0px', scale: 1, opacity: 1 }], { duration: xb ? 520 : 460, delay: d0 + i * 60, easing: 'cubic-bezier(0.22,1.42,0.36,1)', fill: 'backwards' });
    });
    accs().forEach(function (el) { ma(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: d0 + (xb ? 480 : 420), easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' }); });
    mLater(function () { mAnims.forEach(function (a) { try { a.cancel(); } catch (e) {} }); mAnims = []; mT = []; }, d0 + 60 * l.length + 720);
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
    morphStop();
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
    if (!quiet) opts.toast(cfg.homeMsg ? cfg.homeMsg() : wrT('dock.camera_buttons_back_to_default'));
    arm();
  }
  if (HB) HB.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); home(); });
  ['pointerup', 'focusin', 'change'].forEach(function (t) { D.addEventListener(t, function () { if (!drag) arm(); }); });
  // 捲動、轉向、功能列出現／隱藏時，小圓跟著重新對齊
  function relayout() { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { if (st.edge !== 'home' && !drag) { var keep = hidden; place(st.edge, hidden || livePos == null ? st.pos : livePos); if (keep) { items().forEach(function (el) { el.style.transition = 'none'; tr(el, 0, 0); var o = offFor(el, hideEdge()); tr(el, o[0], o[1]); }); } } if (hidden && !E.hidden) placeEye(); }); }
  window.addEventListener('resize', relayout); window.addEventListener('scroll', relayout, { passive: true });
  new MutationObserver(relayout).observe(B, { attributes: true, attributeFilter: ['class'] });
  place(st.edge, st.pos);
  return {
    init: function (o) { for (var k in o) opts[k] = o[k]; if (!opts.enabled) reveal(null, true); },
    setEnabled: function (on) { opts.enabled = !!on; if (!on) reveal(null, true); else arm(); },
    // 進入那一頁：先顯示，閒置 1.8 秒再收
    shown: function () { place(st.edge, st.pos); if (hidden) reveal(null, true); else arm(); },
    left: function () { clearTimeout(hideT); morphStop(); },
    hide: function (instant) { hide(!!instant); }, reveal: function (at) { reveal(at == null ? null : at); }, home: home, relocate: relocate, arm: arm,
    get hidden() { return hidden; }, get morphing() { return !!mEl; }, get state() { return { edge: st.edge, pos: st.pos }; }, get enabled() { return opts.enabled; }, IDLE: IDLE, KEY: KEY
  };
  }
  window.WRDockMake = makeDock;
  window.WRDock = makeDock({ key: 'wr_dock_v1', idle: 1800, dock: document.getElementById('anaDock'), eye: document.getElementById('anaEye'), home: document.getElementById('dockHome'), morph: 'ana',
    main: function () { var c = document.getElementById('anaCamBtn'); return c && c.closest('.dk-it'); },
    acc: '.wr-side > span, .wr-cam > b, .dk-att, .wr-qi, .dk-home',
    busy: function () { var pk = document.getElementById('anaPickHint'); return !!(pk && !pk.hidden); },
    onHide: function () { var pk = document.getElementById('anaPickHint'); if (pk && !pk.hidden) { pk.hidden = true; var qi = document.getElementById('anaPickInfo'); if (qi) qi.setAttribute('aria-expanded', 'false'); } } });
})();
