// WRbeta 按壓十字線（v1.4.0，Lite 與 Pro 全部分頁、選單、對話框都適用）
// 手指（或滑鼠左鍵）按住任何可按的地方，就在按下的位置顯示十字線（和預報靶面同款：橘線＋半透明橘色孔），
// 跟著手指移動，放開後淡出。讓使用者精確知道自己按在哪裡。
// - 用事件委派（document 上的 capture 監聽），之後新增的按鈕／清單項目自動適用，不需要逐一綁定。
// - 只監聽、passive、不 preventDefault；十字線圖層 pointer-events:none → 不擋點擊、捲動、雙指縮放、拖曳彈孔、輸入框。
// - 文字輸入框、textarea、滑桿（range）不顯示（會干擾游標與拖曳）。
// - 靶面：靶面自己已經畫十字線的（預報、對照、分析、Lite 第 1／2 步）維持原樣，不重複畫；
//   其他靶面／照片（Lite 第 3 步、照片校正畫面）畫一個跟著手指的全幅十字線。
// - 按鈕、資訊方塊、清單項目：十字線被裁切在該元素的框內（Lite 上方四塊用各自的多邊形外形裁切）。
// - 裁切框會再跟所有可捲動的上層容器與畫面取交集 → 不會跑出捲動區域。
// - 只用 transform／opacity 移動與淡出；系統「減少動態」時直接出現、直接消失（沒有動畫）。
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var MIN_HOLD = 110;   // 很快的點擊也至少顯示這麼久，看得到按在哪
  var FADE_MS = 200;    // 淡出長度（與 CSS 一致）
  var SKIP = 'input:not([type]),input[type=text],input[type=search],input[type=email],input[type=number],input[type=password],input[type=tel],input[type=url],' +
    'input[type=range],input[type=date],input[type=time],input[type=datetime-local],input[type=month],input[type=week],textarea,[contenteditable]:not([contenteditable=false]),[data-xh=off]';
  var TARGET = 'svg.target,svg.lite-photo,#photoSvg,#anaPhotoSvg,[data-xh=full]';
  var PRESS = 'button,a[href],select,summary,label,[role=button],[role=tab],[role=switch],[role=option],[role=menuitem],' +
    'input[type=checkbox],input[type=radio],input[type=file],input[type=button],input[type=submit],input[type=reset],input[type=color],' +
    '.rec,.stat,.ana-chip,.lite-card,[data-xh=box]';

  // 橘色（強調色）的按鈕上，橘色十字線看不清楚 → 改用深色（.alt）
  var ACCENT = '.wr-cam,.wr-seg button.on,.ana-chip.on,.lay-done,.wr-pop .pi.all,.wr-fab,.pf-btn.pri,#wrNav button.active,.navc-dots button.on,.lite-verify,.primary,.modetg button.on,.lite-steps button.on,.lite-srcbtn.lite-cam,.lite-rounds button.on,.modal .yes';
  var root = null, clip = null, hl = null, vl = null, hole = null;
  var act = null;   // { id, el, mode:'box'|'full', x, y, t0, box:{l,t,w,h}, own }
  var raf = 0, hideT = 0;

  function reduced() { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function ensure() {
    if (root && root.isConnected) return;
    root = document.createElement('div'); root.id = 'wrXh'; root.className = 'wr-xh'; root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="wr-xh-clip"><i class="wr-xh-h"></i><i class="wr-xh-v"></i><b class="wr-xh-o"><s></s></b></div>';
    (document.body || document.documentElement).appendChild(root);
    clip = root.firstChild; hl = clip.children[0]; vl = clip.children[1]; hole = clip.children[2];
  }

  // 元素可見的框＝元素框 ∩ 每一個會裁切的上層容器 ∩ 畫面
  function visibleBox(el) {
    var r = el.getBoundingClientRect();
    var l = r.left, t = r.top, R = r.right, B = r.bottom;
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.contain || '').indexOf('paint') >= 0) {
        var q = p.getBoundingClientRect();
        // 只裁到內容區（扣掉捲軸與邊框）
        var ql = q.left + p.clientLeft, qt = q.top + p.clientTop;
        l = Math.max(l, ql); t = Math.max(t, qt); R = Math.min(R, ql + (p.clientWidth || q.width)); B = Math.min(B, qt + (p.clientHeight || q.height));
      }
      if (cs.position === 'fixed') break;
    }
    l = Math.max(l, 0); t = Math.max(t, 0); R = Math.min(R, window.innerWidth); B = Math.min(B, window.innerHeight);
    return { l: l, t: t, w: Math.max(0, R - l), h: Math.max(0, B - t), full: Math.abs(l - r.left) < .5 && Math.abs(t - r.top) < .5 && Math.abs(R - r.right) < .5 && Math.abs(B - r.bottom) < .5, r: r };
  }

  // Lite 上方四個資訊方塊：用 SVG 外形（viewBox 100×52）判斷按到哪一塊，裁切成那一塊的多邊形
  function blockPoly(panel, e) {
    var r = panel.getBoundingClientRect(); if (!r.width || !r.height) return null;
    var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 52;
    var ids = ['lpBigBg', 'lpCntBg', 'lpEstBg', 'lpSumBg'];
    for (var i = 0; i < ids.length; i++) {
      var p = document.getElementById(ids[i]); if (!p) continue;
      var s = (p.getAttribute('points') || '').trim(); if (!s) continue;
      var P = s.split(/\s+/).map(function (q) { var a = q.split(','); return [+a[0], +a[1]]; });
      var c = false;
      for (var a = 0, b = P.length - 1; a < P.length; b = a++) {
        if (((P[a][1] > y) !== (P[b][1] > y)) && (x < (P[b][0] - P[a][0]) * (y - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0])) c = !c;
      }
      if (c) return { pts: P, r: r, key: ids[i].slice(2, -2).toLowerCase() };
    }
    return null;
  }

  // 找出這一下按到的是什麼：{ el, mode, poly }；不需要十字線時回傳 null
  function classify(t, e) {
    if (!t || !t.closest) return null;
    // v3.0.2（White 11:29）：小白單頁面整個停用觸碰十字線，其他頁面不動
    if (document.body.classList.contains('on-sius') || t.closest('#tab-sius,#xbDock,#xbEye,#siusEdit')) return null;
    if (t.closest(SKIP)) return null;
    if (t.closest('#wrXh')) return null;
    var tg = t.closest(TARGET);
    if (tg) {
      // 外框：靶面通常放在有圓角／裁切的容器裡
      return { el: tg, mode: 'full' };
    }
    var el = t.closest(PRESS);
    if (el) {
      // label 包著文字輸入框（例如名稱欄）＝輸入框，不畫
      if (el.tagName === 'LABEL') { var inp = el.control || el.querySelector('input,select,textarea'); if (inp && inp.matches && inp.matches(SKIP)) return null; }
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
      return { el: el, mode: 'box' };
    }
    var panel = t.closest('#litePanel');
    if (panel) { var bp = blockPoly(panel, e); if (bp) return { el: panel, mode: 'box', poly: bp }; }
    return null;
  }

  // 靶面是否已經畫了自己的十字線（#preview 有內容）
  function ownPreview(el) {
    if (!el || el.tagName.toLowerCase() !== 'svg') return false;
    var g = el.querySelector('#preview'); return !!(g && g.childElementCount);
  }

  function place() {
    raf = 0; if (!act) return;
    var b = act.box, x = act.x - b.l, y = act.y - b.t;
    hl.style.transform = 'translate3d(0,' + (y - act.lw / 2).toFixed(1) + 'px,0)';
    vl.style.transform = 'translate3d(' + (x - act.lw / 2).toFixed(1) + 'px,0,0)';
    hole.style.transform = 'translate3d(' + (x - act.hs / 2).toFixed(1) + 'px,' + (y - act.hs / 2).toFixed(1) + 'px,0)';
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(place); }

  function layout() {
    if (!act) return;
    var el = act.el, b = visibleBox(el);
    act.box = b;
    if (b.w < 1 || b.h < 1) { root.classList.remove('on'); return; }
    // 第一次與捲動時設定裁切框（只在按下／捲動時改尺寸，移動時只改 transform）
    clip.style.width = b.w + 'px'; clip.style.height = b.h + 'px';
    clip.style.transform = 'translate3d(' + b.l + 'px,' + b.t + 'px,0)';
    var cs = getComputedStyle(el);
    clip.style.borderRadius = b.full && act.mode === 'box' && !act.poly ? cs.borderRadius : act.mode === 'full' ? cs.borderRadius : '0px';
    if (act.poly) {
      var P = act.poly, pr = el.getBoundingClientRect();
      clip.style.clipPath = 'polygon(' + P.pts.map(function (q) { return (pr.left + q[0] / 100 * pr.width - b.l).toFixed(1) + 'px ' + (pr.top + q[1] / 52 * pr.height - b.t).toFixed(1) + 'px'; }).join(',') + ')';
    } else clip.style.clipPath = '';
    hl.style.width = b.w + 'px'; vl.style.height = b.h + 'px';
    place();
  }

  function show(e, info) {
    ensure();
    clearTimeout(hideT);
    var mode = info.mode, el = info.el;
    // 孔的大小：靶面＝實際彈孔（4.5mm）的畫面大小（至少 14px），按鈕＝16px（小元素縮小）
    var hs = 16;
    if (mode === 'full') {
      var E = +(el.dataset && el.dataset.extent), r = el.getBoundingClientRect();
      if (E > 0 && el.classList.contains('target')) hs = Math.max(14, Math.min(48, 4.5 * r.width / E)); else hs = 18;
    } else { var rr = el.getBoundingClientRect(); hs = Math.max(10, Math.min(18, Math.min(rr.width, rr.height) * 0.42)); }
    act = { id: e.pointerId, el: el, mode: mode, poly: info.poly || null, x: e.clientX, y: e.clientY, t0: Date.now(), hs: hs, lw: mode === 'full' ? 1.5 : 1.5 };
    root.className = 'wr-xh m-' + mode + (mode === 'box' && el.matches && el.matches(ACCENT) ? ' alt' : '');
    hole.style.width = hole.style.height = hs.toFixed(1) + 'px';
    root.style.removeProperty('--xh-c');
    layout();
    // 靶面自己會畫十字線的話，就不重複（等這一下的 pointerdown 處理完才看得出來）
    if (mode === 'full') {
      root.classList.remove('on');
      requestAnimationFrame(function () { if (act && act.el === el && !ownPreview(el)) on(); });
    } else on();
  }
  function on() {
    if (!act) return;
    root.classList.remove('out');
    if (reduced()) root.classList.add('rm'); else root.classList.remove('rm');
    // 重新觸發出現動畫
    root.classList.remove('on'); void root.offsetWidth; root.classList.add('on');
  }
  function hide(now) {
    if (!act) return;
    var a = act; act = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    var wait = now ? 0 : Math.max(0, MIN_HOLD - (Date.now() - a.t0));
    clearTimeout(hideT);
    hideT = setTimeout(function () {
      if (act) return;
      if (reduced() || now) { root.classList.remove('on', 'out'); return; }
      root.classList.add('out');
      hideT = setTimeout(function () { if (!act) root.classList.remove('on', 'out'); }, FADE_MS + 40);
    }, wait);
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) { hide(true); return; } // 第二根手指（縮放）＝收起
    var info = classify(e.target, e);
    if (!info) { if (act) hide(true); return; }
    show(e, info);
  }
  function onMove(e) {
    if (!act || e.pointerId !== act.id) return;
    act.x = e.clientX; act.y = e.clientY;
    if (act.mode === 'full' && ownPreview(act.el)) { if (root.classList.contains('on')) root.classList.remove('on'); return; }
    schedule();
  }
  function onUp(e) { if (act && (e.pointerId === act.id)) hide(e.type === 'pointercancel'); }
  function onScroll() { if (act) requestAnimationFrame(layout); }
  var opt = { passive: true, capture: true };
  document.addEventListener('pointerdown', onDown, opt);
  document.addEventListener('pointermove', onMove, opt);
  document.addEventListener('pointerup', onUp, opt);
  document.addEventListener('pointercancel', onUp, opt);
  document.addEventListener('scroll', onScroll, opt);
  window.addEventListener('resize', onScroll);
  window.addEventListener('blur', function () { hide(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) hide(true); });

  window.WRCrosshair = {
    version: 1,
    get active() { return !!act; },
    get visible() { return !!(root && root.classList.contains('on') && !root.classList.contains('out')); },
    get element() { return act && act.el; },
    get mode() { return act && act.mode; },
    get point() { return act && { x: act.x, y: act.y }; },
    // 十字中心在畫面上的位置（測試用）
    center: function () { if (!hole) return null; var r = hole.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    classify: function (el) { var r = el.getBoundingClientRect(); return classify(el, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); },
    hide: function () { hide(true); }
  };
})();
