/* WRbeta v1.6.0 模組化版面（window.WRLayout）
 * 每一頁的數據方塊（[data-lay] 容器裡的 [data-mod]）都可以：拖曳排序、隱藏（−）、半寬／全寬、從「＋ 加入方塊」加回來、恢復預設。
 * - 進入：每頁角落的「編輯版面」小按鈕（.lay-btn[data-lay-page]），或在方塊上長按約 0.5 秒（按鈕、輸入框、靶面上不算）
 * - 排序用 CSS order＋class，不搬動 DOM（App 每次重畫 innerHTML 後由 MutationObserver 重新套用）
 * - 存在 localStorage 'bm_layout_v1'：{ 容器key: { order:[id…], hidden:{id:1}, size:{id:'half'|'full'} } }
 *   新版本多出來、存檔裡沒有的方塊排在後面（1000＋原本位置）；存檔裡有、畫面上沒有的 id 保留不動（舊版／未來版互通）
 */
(function () {
  'use strict';
  var KEY = 'bm_layout_v1', LONG_MS = 500, MOVE_TOL = 8;
  var B = document.body, data = load(), editing = null, opts = { toast: function () {}, ask: function (m, y) { if (window.confirm(m)) y(); } };
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(mq && mq.matches); }
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
  function conf(key) { var c = data[key]; if (!c || typeof c !== 'object') c = data[key] = {}; if (!Array.isArray(c.order)) c.order = []; if (!c.hidden || typeof c.hidden !== 'object') c.hidden = {}; if (!c.size || typeof c.size !== 'object') c.size = {}; return c; }
  function containers(page) { return [].slice.call(document.querySelectorAll('[data-lay]' + (page ? '[data-lay-page="' + page + '"]' : ''))); }
  function items(box) { return [].slice.call(box.querySelectorAll('[data-mod]')).filter(function (m) { return m.closest('[data-lay]') === box; }); }
  function modName(m) { return m.getAttribute('data-mod-name') || (m.querySelector('.k,.ana-ct,.lite-ct,.set-h,h3') || m).textContent.trim().slice(0, 18) || m.dataset.mod; }
  function defFull(m) { return m.classList.contains('wide') || m.classList.contains('lay-full') || m.classList.contains('ana-card') || m.classList.contains('lite-card'); }
  function oneCol(box) { return box.getAttribute('data-lay-cols') === '1'; }
  // ---------- 套用（排序／隱藏／寬度） ----------
  function apply(box) {
    var key = box.dataset.lay, c = data[key], list = items(box), ed = editing && box.dataset.layPage === editing;
    box.classList.add('lay-on'); box.classList.toggle('lay-edit', !!ed);
    list.forEach(function (m, i) {
      var id = m.dataset.mod, oi = c ? c.order.indexOf(id) : -1;
      m.style.order = oi >= 0 ? oi : 1000 + i;
      var hid = !!(c && c.hidden[id]);
      m.classList.toggle('lay-hid', hid);
      var sz = c && c.size[id], full = oneCol(box) || (sz ? sz === 'full' : defFull(m));
      m.classList.toggle('lay-w-full', full); m.classList.toggle('lay-w-half', !full);
      if (ed) decorate(box, m, full); else undecorate(m);
    });
    if (ed) renderTray();
  }
  function applyAll() { containers().forEach(apply); }
  var obs = new MutationObserver(function (recs) {
    var boxes = [];
    recs.forEach(function (r) { var b = r.target.closest && r.target.closest('[data-lay]'); if (b && boxes.indexOf(b) < 0) boxes.push(b); });
    boxes.forEach(function (b) { if (!b._layBusy) { b._layBusy = true; apply(b); obs.takeRecords(); b._layBusy = false; } });
  });
  function watch(box) { if (box._layWatch) return; box._layWatch = true; obs.observe(box, { childList: true, subtree: true }); apply(box); }
  // ---------- 編輯模式 ----------
  var bar = null;
  function decorate(box, m, full) {
    var ctl = m.querySelector(':scope > .lay-ctl');
    if (!ctl) {
      ctl = document.createElement('div'); ctl.className = 'lay-ctl'; ctl.setAttribute('data-lay-ui', '1');
      ctl.innerHTML = wrT('layout.hide_btn', [esc(modName(m)), oneCol(box) ? '' : '<button type="button" class="lay-size"></button>']);
      m.appendChild(ctl);
      ctl.querySelector('.lay-hide').onclick = function (e) { e.stopPropagation(); setHidden(box, m.dataset.mod, true); };
      var sb = ctl.querySelector('.lay-size'); if (sb) sb.onclick = function (e) { e.stopPropagation(); toggleSize(box, m); };
    }
    var sb2 = ctl.querySelector('.lay-size'); if (sb2) { sb2.textContent = full ? wrT('layout.full_width') : wrT('layout.half_width'); sb2.setAttribute('aria-label', wrT('layout.is', [modName(m), full ? wrT('layout.full_width_tap_for_half') : wrT('layout.half_width_tap_for_full')])); }
    m.classList.add('lay-item');
  }
  function undecorate(m) { var c = m.querySelector(':scope > .lay-ctl'); if (c) c.remove(); m.classList.remove('lay-item', 'lay-ph'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function curOrder(box) { return items(box).slice().sort(function (a, b) { return (+a.style.order || 0) - (+b.style.order || 0); }).map(function (m) { return m.dataset.mod; }); }
  function commitOrder(box, ids) {
    var c = conf(box.dataset.lay), keep = c.order.filter(function (id) { return ids.indexOf(id) < 0; }); // 畫面上沒有的 id（例如「尚無資料」或未來版本）保留在後面
    c.order = ids.concat(keep); save();
  }
  function setHidden(box, id, on) {
    var c = conf(box.dataset.lay); commitOrder(box, curOrder(box));
    if (on) c.hidden[id] = 1; else delete c.hidden[id];
    save(); flip(box, function () { apply(box); });
    opts.toast(on ? wrT('layout.card_hidden_add_it_back') : wrT('layout.card_added_back'));
  }
  function toggleSize(box, m) {
    var c = conf(box.dataset.lay), full = m.classList.contains('lay-w-full');
    c.size[m.dataset.mod] = full ? 'half' : 'full'; commitOrder(box, curOrder(box)); save();
    flip(box, function () { apply(box); });
  }
  function enter(page) {
    if (editing === page) return; if (editing) exit();
    var boxes = containers(page); if (!boxes.length) return;
    editing = page; B.classList.add('lay-editing');
    boxes.forEach(function (b) { b.classList.add('lay-edit'); watch(b); apply(b); });
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'lay-bar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', wrT('layout.edit_layout'));
      bar.innerHTML = wrT('layout.edit_layout_drag_to_reorder');
      document.body.appendChild(bar);
      bar.querySelector('.lay-done').onclick = function () { exit(); };
      bar.querySelector('.lay-reset').onclick = function () { opts.ask(wrT('layout.reset_this_pages_cards_to'), function () { reset(editing); }); };
    }
    bar.hidden = false; renderTray();
    try { bar.querySelector('.lay-done').focus({ preventScroll: true }); } catch (e) {}
  }
  function renderTray() {
    if (!bar || !editing) return;
    var tray = bar.querySelector('.lay-tray'), h = '';
    containers(editing).forEach(function (box) {
      var c = data[box.dataset.lay]; if (!c) return;
      items(box).forEach(function (m) { if (c.hidden[m.dataset.mod]) h += wrT('layout.add_btn', [esc(box.dataset.lay), esc(m.dataset.mod), esc(modName(m))]); });
    });
    tray.innerHTML = wrT('layout.add_card', [h || wrT('layout.no_hidden_cards')]);
    tray.querySelectorAll('.lay-add').forEach(function (b) { b.onclick = function () { var box = document.querySelector('[data-lay="' + b.dataset.box + '"]'); if (box) setHidden(box, b.dataset.id, false); }; });
  }
  function exit() {
    if (!editing) return;
    var page = editing; editing = null; B.classList.remove('lay-editing');
    containers(page).forEach(function (b) { b.classList.remove('lay-edit'); apply(b); });
    if (bar) bar.hidden = true;
    endDrag(true);
  }
  function reset(page) {
    containers(page).forEach(function (b) { delete data[b.dataset.lay]; });
    save(); containers(page).forEach(function (b) { flip(b, function () { apply(b); }); });
    renderTray(); opts.toast(wrT('layout.layout_reset_to_default'));
  }
  // ---------- FLIP 動畫（排列改變時其他方塊滑過去） ----------
  function flip(box, change) {
    var list = items(box), before = list.map(function (m) { return m.getBoundingClientRect(); });
    change();
    if (reduced() || !list[0] || !list[0].animate) return;
    list.forEach(function (m, i) {
      if (m === (drag && drag.m)) return;
      var a = before[i], b = m.getBoundingClientRect(); if (!a.width || !b.width) return;
      var dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      m.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
  }
  // ---------- 拖曳（手指或滑鼠；靠近畫面上下緣自動捲動） ----------
  var drag = null;
  function startDrag(box, m, ev) {
    var r = m.getBoundingClientRect(), g = m.cloneNode(true);
    g.classList.add('lay-ghost'); g.classList.remove('lay-item'); g.removeAttribute('data-mod'); g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(function (x) { x.removeAttribute('id'); });
    g.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;margin:0;order:0;z-index:90;pointer-events:none';
    document.body.appendChild(g);
    m.classList.add('lay-ph'); m.setAttribute('data-ph', wrT('layout.drop_here'));
    drag = { box: box, m: m, g: g, dx: ev.clientX - r.left, dy: ev.clientY - r.top, x: ev.clientX, y: ev.clientY, raf: 0 };
    B.classList.add('lay-dragging');
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {}
    autoScroll();
  }
  function moveDrag(ev) {
    if (!drag) return;
    drag.x = ev.clientX; drag.y = ev.clientY;
    drag.g.style.left = (ev.clientX - drag.dx) + 'px'; drag.g.style.top = (ev.clientY - drag.dy) + 'px';
    reorderAt(ev.clientX, ev.clientY);
  }
  function reorderAt(x, y) {
    var box = drag.box, ids = curOrder(box), me = drag.m.dataset.mod, best = null;
    items(box).forEach(function (m) {
      if (m === drag.m || m.classList.contains('lay-hid')) return;
      var r = m.getBoundingClientRect(); if (!r.width) return;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) best = { m: m, after: (y - r.top) / r.height > 0.5 || (r.width < box.clientWidth * 0.75 && (x - r.left) / r.width > 0.5 && (y - r.top) / r.height > 0.2) };
    });
    if (!best) return;
    var tid = best.m.dataset.mod, cur = ids.indexOf(me), ti = ids.indexOf(tid);
    ids.splice(cur, 1); ti = ids.indexOf(tid); ids.splice(best.after ? ti + 1 : ti, 0, me);
    if (ids.join('\u0001') === curOrder(box).join('\u0001')) return;
    flip(box, function () { ids.forEach(function (id, i) { var m = box.querySelector('[data-mod="' + id + '"]'); if (m && m.closest('[data-lay]') === box) m.style.order = i; }); });
  }
  function autoScroll() {
    if (!drag) return;
    var y = drag.y, H = window.innerHeight, bh = bar && !bar.hidden ? bar.getBoundingClientRect().height : 0, top = 90, bot = H - bh - 80, v = 0;
    if (y < top) v = -Math.min(18, (top - y) / 4 + 3); else if (y > bot) v = Math.min(18, (y - bot) / 4 + 3);
    if (v) { window.scrollBy(0, v); reorderAt(drag.x, drag.y); }
    drag.raf = requestAnimationFrame(autoScroll);
  }
  function endDrag(cancel) {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    var d = drag; drag = null;
    d.g.remove(); d.m.classList.remove('lay-ph'); d.m.removeAttribute('data-ph'); B.classList.remove('lay-dragging');
    if (!cancel) { commitOrder(d.box, curOrder(d.box)); apply(d.box); }
  }
  // ---------- 指標事件：長按進入、編輯時拖曳 ----------
  var NO_LP = 'button,a,input,select,textarea,label,summary,svg.target,.ana-photobox,table tr[data-id],.lay-ctl,[contenteditable]';
  var press = null, suppressClick = false, supT = 0;
  function suppress() { suppressClick = true; clearTimeout(supT); supT = setTimeout(function () { suppressClick = false; }, 450); }
  document.addEventListener('pointerdown', function (ev) {
    if (ev.button > 0 || !ev.isPrimary) return;
    var m = ev.target.closest && ev.target.closest('[data-mod]'), box = m && m.closest('[data-lay]');
    if (!m || !box || !box.classList.contains('lay-on')) return;
    if (editing && box.dataset.layPage === editing) {
      if (ev.target.closest('.lay-ctl')) return;
      press = { box: box, m: m, x: ev.clientX, y: ev.clientY, id: ev.pointerId, drag: true };
      if (ev.pointerType !== 'mouse') ev.preventDefault();
      return;
    }
    if (ev.target.closest(NO_LP) || editing) return;
    press = { box: box, m: m, x: ev.clientX, y: ev.clientY, id: ev.pointerId, drag: false };
    press.t = setTimeout(function () {
      if (!press || press.drag) return;
      var p = press; press = null; suppress();
      enter(p.box.dataset.layPage);
      if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
      opts.toast(wrT('layout.edit_layout_drag_cards_to'));
    }, LONG_MS);
  }, true);
  document.addEventListener('pointermove', function (ev) {
    if (drag) { ev.preventDefault(); moveDrag(ev); return; }
    if (!press || ev.pointerId !== press.id) return;
    var d = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
    if (!press.drag) { if (d > MOVE_TOL) { clearTimeout(press.t); press = null; } return; } // 捲動或滑動：取消長按
    if (d > 6) { var p = press; press = null; startDrag(p.box, p.m, { clientX: p.x, clientY: p.y }); moveDrag(ev); }
  }, { capture: true, passive: false });
  function up(ev) { if (press) { clearTimeout(press.t); press = null; } if (drag) { endDrag(ev.type === 'pointercancel'); suppress(); } }
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  window.addEventListener('scroll', function () { if (press && !press.drag) { clearTimeout(press.t); press = null; } }, { passive: true, capture: true });
  document.addEventListener('click', function (ev) { if (suppressClick) { suppressClick = false; ev.stopPropagation(); ev.preventDefault(); return; } if (editing && ev.target.closest && ev.target.closest('.lay-edit [data-mod]') && !ev.target.closest('.lay-ctl')) { ev.stopPropagation(); ev.preventDefault(); } }, true);
  document.addEventListener('contextmenu', function (ev) { if (editing && ev.target.closest && ev.target.closest('.lay-edit')) ev.preventDefault(); }, true);
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && editing) exit(); });
  document.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('.lay-btn[data-lay-page]'); if (!b) return; var pg = b.getAttribute('data-lay-page'); if (editing === pg) exit(); else enter(pg); });
  window.WRLayout = {
    init: function (o) { for (var k in o) opts[k] = o[k]; containers().forEach(watch); },
    refresh: function () { containers().forEach(watch); applyAll(); },
    enter: enter, exit: exit, reset: reset,
    get editing() { return editing; }, get data() { return JSON.parse(JSON.stringify(data)); },
    reload: function () { data = load(); applyAll(); }, KEY: KEY
  };
})();
