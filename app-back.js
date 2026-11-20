/* WRbeta v2.5.0 上一頁：浮動「‹ 上一頁」按鈕（左上角、標題列／名字下方）＋Android 返回鍵／返回手勢（history／popstate）
 * 按一次返回＝退一步，留在 App 裡：先關最上層的視窗（對話框、全頁檢視、說明泡泡、選單、底部清單）、
 * 再離開模式（添加／消滅、唯讀檢視、編輯版面）、再回 Lite 上一步、再回上一個分頁；都沒有了才提示「再按一次返回離開」。
 * Chrome 會跳過「沒有使用者操作時」加的 history 紀錄，所以在使用者點畫面（pointerdown／keydown）時補上防護紀錄。
 */
(function (App) {
  'use strict';
  var $ = App.$, toast = App.toast, D = document, B = D.body;
  var tabs = [], fromBack = false, depth = 0, armedNoAct = false, exitAt = 0, ignorePop = 0;
  var TAB_MAX = 8, EXIT_MS = 2200;
  // 分頁歷史（showTab 會呼叫 App.onTab）
  App.onTab = function (name, prev) {
    if (fromBack || !prev) { sync(); return; }
    tabs = tabs.filter(function (t) { return t !== prev && t !== name; }); tabs.push(prev); // 每個分頁只記一次（最近的在最後）
    if (tabs.length > TAB_MAX) tabs.shift();
    sync();
  };
  // 其他模組可以登記自己的關閉方式（例如說明泡泡）：最後登記的先關
  var extra = [];
  function push(id, closer) { drop(id); extra.push({ id: id, close: closer }); sync(); }
  function drop(id) { extra = extra.filter(function (x) { return x.id !== id; }); sync(); }
  function vis(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  function top(sel) { var a = [].slice.call(D.querySelectorAll(sel)).filter(vis); return a[a.length - 1] || null; }
  function liteBackStep() { return B.classList.contains('lite') && App.curTab === 'predict' && App.liteStep && App.liteStep() > 1; }
  /* 這一步會做什麼（不做）：回傳函式或 null */
  function nextStep() {
    var m = top('.modal-bg');
    if (m) return function () { var b = m.querySelector('.no, .x, .mb-view-top .x, [data-close]'); if (b) b.click(); else m.remove(); };
    var v = top('.mb-view');
    if (v) return function () { var b = v.querySelector('.x'); if (b) b.click(); else { v.remove(); B.classList.remove('mb-view-open'); } };
    if (extra.length) { var x = extra[extra.length - 1]; return function () { extra.pop(); try { x.close(); } catch (e) {} }; }
    var sh = top('.lt-sheet');
    if (sh) return function () { var b = sh.querySelector('.lt-sheet-x'); if (b) b.click(); else sh.hidden = true; };
    if (B.classList.contains('fab-open') && App.nav) return function () { App.nav.openFab(false); };
    var pop = top('#tab-analysis .wr-pop:not([hidden])');
    if (pop && App.anaPopClose) return function () { App.anaPopClose(); };
    if (window.WRLayout && WRLayout.editing) return function () { WRLayout.exit(); };
    if (App.anaMode && App.curTab === 'analysis') return function () { App.anaSetMode(null); };
    if (App.anaRO && App.curTab === 'analysis') return function () { App.anaCloseRO(); };
    if (liteBackStep()) return function () { App.setLiteStep(App.liteStep() - 1); };
    while (tabs.length && tabs[tabs.length - 1] === App.curTab) tabs.pop();
    if (tabs.length) return function () { var t = tabs.pop(); fromBack = true; try { App.showTab(t); window.scrollTo(0, 0); } finally { fromBack = false; } };
    return null;
  }
  function back() { var f = nextStep(); if (!f) return false; f(); setTimeout(sync, 0); return true; }
  // ---------- history 防護紀錄 ----------
  function guard(hasAct) {
    try { history.pushState({ wrBack: depth + 1 }, ''); depth++; armedNoAct = !hasAct; } catch (e) {}
  }
  function onPop(e) {
    if (ignorePop) { ignorePop--; depth = (e.state && e.state.wrBack) || 0; return; }
    depth = (e.state && e.state.wrBack) || 0;
    if (back()) { exitAt = 0; if (!depth) guard(false); return; }
    // 已經在最上層：第一次提示；兩秒內再按一次＝真的離開（不再補防護紀錄）
    if (depth > 0) { ignorePop++; try { history.go(-depth); } catch (er) { ignorePop = 0; } }
    exitAt = Date.now(); toast(wrT('app.back_again_to_exit'), EXIT_MS);
  }
  function onAct() {
    if (!depth || armedNoAct) { if (exitAt && Date.now() - exitAt < 300) return; exitAt = 0; guard(true); }
    setTimeout(sync, 60);
  }
  window.addEventListener('popstate', onPop);
  D.addEventListener('pointerdown', onAct, true);
  D.addEventListener('keydown', function (e) { if (e.key !== 'Escape') onAct(); }, true);
  D.addEventListener('click', function () { setTimeout(sync, 60); }, true);
  // ---------- 浮動「‹ 上一頁」（固定在左上角，標題列／分析名稱正下方，不蓋住名字） ----------
  var btn = $('wrBack');
  function place() {
    if (!btn || btn.hidden) return;
    var top = 50, i, el, r, cands = [];
    el = D.querySelector('header');
    if (el) top = el.getBoundingClientRect().bottom;
    if (!B.classList.contains('lite')) {
      el = D.getElementById('wrNavC');
      if (el && vis(el)) cands.push(el);
    }
    if (B.classList.contains('on-analysis')) {
      el = D.querySelector('.ana-top');
      if (el && vis(el)) cands.push(el);
      el = D.getElementById('anaRoBar');
      if (el && vis(el)) cands.push(el);
    }
    for (i = 0; i < cands.length; i++) {
      r = cands[i].getBoundingClientRect();
      if (r.bottom > top) top = r.bottom;
    }
    btn.style.top = (top + 6) + 'px';
  }
  var placeR = 0;
  function placeSoon() {
    if (placeR) return;
    placeR = requestAnimationFrame(function () { placeR = 0; place(); });
  }
  function sync() {
    if (!btn) return;
    var on = !!nextStep();
    if (btn.hidden !== !on) { btn.hidden = !on; B.classList.toggle('can-back', on); }
    if (on) place();
  }
  if (btn) btn.onclick = function (e) { e.preventDefault(); back(); };
  window.addEventListener('resize', placeSoon);
  window.addEventListener('scroll', placeSoon, true);
  App.back = { push: push, drop: drop, back: back, can: function () { return !!nextStep(); }, sync: sync, get tabs() { return tabs.slice(); }, get depth() { return depth; } };
  sync();
})(window.WRApp = window.WRApp || {});
