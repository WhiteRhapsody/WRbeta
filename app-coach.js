/* WRbeta v2.9.4「教練」版（PROGRESS.md §7 下次更新要點第 13 項，White 2026-11-23 18:09 指定）
 * 目前所有分頁都屬於「選手」；這版加入「教練」版本的兩個空白分頁，標「施工中」。
 * 入口：首頁的「教練」軟 Q 鈕（按了離開首頁、打開教練版；以前只跳「即將推出」）。
 * 教練版是一張蓋在 App 上的全頁（不動選手的分頁、功能列、Lite），左上「首頁」回首頁、「選手」或返回鍵＝回選手的分頁。
 * 兩個分頁的名稱與內容待 White 決定（教練版之後也會有預報、分析、紀錄、設定／說明，再加教練專屬功能，細節待討論）；
 * 分頁名稱「教練分頁 1／2」是白幻仔暫定。 */
(function (App) {
  'use strict';
  var D = document, esc = App.esc || function (s) { return String(s); }, pg = null, cur = 0, KEY = 'wr_coach_tab_v1';
  function build() {
    pg = D.createElement('section'); pg.id = 'wrCoach'; pg.className = 'wr-coach'; pg.hidden = true;
    pg.setAttribute('role', 'region'); pg.setAttribute('aria-label', wrT('coach.title'));
    var tabs = [1, 2].map(function (n) { return '<button type="button" role="tab" id="coachTab' + n + '" data-i="' + (n - 1) + '" aria-controls="coachPane"><b>' + esc(wrT('coach.tab_n', [n])) + '</b><small>' + esc(wrT('coach.wip')) + '</small></button>'; }).join('');
    pg.innerHTML = '<div class="co-top"><button type="button" class="wr-homebtn co-home" id="coachHome" aria-label="' + esc(wrT('home.go_home')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2L12 4l8.5 7.2"/><path d="M6 9.6V20h4.6v-5.6h2.8V20H18V9.6"/></svg><span>' + esc(wrT('home.home_btn')) + '</span></button>' +
      '<h2 class="co-h">' + esc(wrT('coach.title')) + '</h2><button type="button" class="wr-pill co-player" id="coachPlayer">' + esc(wrT('coach.to_player')) + '</button></div>' +
      '<div class="co-tabs wr-seg" role="tablist" aria-label="' + esc(wrT('coach.title')) + '">' + tabs + '</div>' +
      '<div class="co-pane" id="coachPane" role="tabpanel"><div class="co-wip"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 52h48"/><path d="M14 52 30 14h4l16 38"/><path d="M20 38h24M24 28h16"/></svg><b id="coachWipH"></b><p>' + esc(wrT('coach.wip_note')) + '</p></div></div>';
    D.body.appendChild(pg);
    pg.querySelectorAll('[role=tab]').forEach(function (b) { b.onclick = function () { set(+b.dataset.i); }; });
    D.getElementById('coachHome').onclick = function () { close(); if (App.home) App.home.show(); };
    D.getElementById('coachPlayer').onclick = close;
  }
  function set(i) {
    cur = i === 1 ? 1 : 0; try { localStorage.setItem(KEY, String(cur)); } catch (e) {}
    pg.querySelectorAll('[role=tab]').forEach(function (b, j) { var on = j === cur; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    D.getElementById('coachPane').setAttribute('aria-labelledby', 'coachTab' + (cur + 1));
    D.getElementById('coachWipH').textContent = wrT('coach.wip_head', [cur + 1]);
  }
  function open() {
    if (!pg) build();
    var s = 0; try { s = +localStorage.getItem(KEY) || 0; } catch (e) {}
    set(s); pg.hidden = false; D.body.classList.add('coach-open');
    if (App.back) App.back.push('coach', close);
  }
  function close() {
    if (!pg || pg.hidden) return;
    pg.hidden = true; D.body.classList.remove('coach-open'); if (App.back) App.back.drop('coach');
  }
  App.coach = { open: open, close: close, get on() { return !!pg && !pg.hidden; } };
})(window.WRApp = window.WRApp || {});
