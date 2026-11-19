/* WRbeta 會員：好友和分享（好友清單／邀請、分享紀錄給好友、好友分享給我的、未讀數字）
 * 2026-11-19 模組分割（純搬移）：原本在 member.js 同一個函式裡；共用名稱掛在 window.WRMemberParts（MP.名稱），對外仍是 window.WRMember（在 member.js）。
 */
(function (MP, root) {
  'use strict';
  // 其他模組（先載入）的共用名稱
  var SHARE_MAX = MP.SHARE_MAX, midCheck = MP.midCheck, pairId = MP.pairId, D = MP.D, B = MP.B, $ = MP.$, esc = MP.esc, app = MP.app, toast = MP.toast,
    ask = MP.ask, ls = MP.ls, LS_SEEN = MP.LS_SEEN, ICON = MP.ICON, S = MP.S, uid = MP.uid, hasProfile = MP.hasProfile, errText = MP.errText,
    refreshSocial = MP.refreshSocial, who = MP.who, whoHTML = MP.whoHTML, show = MP.show, renderCards = MP.renderCards, modal = MP.modal;
  // 給其他模組用（函式）
  MP.renderFriends = renderFriends; MP.addFriend = addFriend; MP.sharesOf = sharesOf; MP.renderShares = renderShares; MP.closeView = closeView;
  MP.shareRecord = shareRecord; MP.counts = counts; MP.renderBadges = renderBadges;

  // 好友
  function renderFriends(on) {
    var c = show('mbFriends', on); if (!c || !on) return;
    var f = S.friends, n = f.incoming.length;
    var h = wrT('member.friends_invite', [f.friends.length, n ? wrT('member.new_invites', [n]) : '']);
    if (f.incoming.length) h += wrT('member.invites_received', [f.incoming.map(function (x) { return wrT('member.accept_decline', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    if (f.outgoing.length) h += wrT('member.sent_waiting_for_them_to', [f.outgoing.map(function (x) { return wrT('member.cancel', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    h += wrT('member.friend_list', [f.friends.length ? f.friends.map(function (x) { return wrT('member.remove', [esc(x.id), esc(x.uid), whoHTML(x.uid), esc(who(x.uid))]); }).join('') : wrT('member.no_friends_yet_enter_someones')]);
    c.innerHTML = h;
    var inp = $('mbFriendIn');
    $('mbFriendGo').onclick = function () { addFriend(inp.value.trim()); };
    inp.onkeydown = function (e) { if (e.key === 'Enter') addFriend(inp.value.trim()); };
    c.querySelectorAll('.mb-fr [data-a]').forEach(function (b) {
      var row = b.closest('.mb-fr'), pid = row.dataset.pid;
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'acc') act(MP.BE.acceptFriend(pid), wrT('member.youre_now_friends'));
        else if (a === 'dec') act(MP.BE.deleteFriend(pid), wrT('member.invite_declined'));
        else if (a === 'can') act(MP.BE.deleteFriend(pid), wrT('member.invite_cancelled'));
        else if (a === 'rm') ask(wrT('member.remove_friend_records_you_shared', [who(row.dataset.uid)]), function () { act(removeFriend(pid, row.dataset.uid), wrT('member.friend_removed')); }, null, { yes: wrT('app.delete'), danger: true });
      };
    });
  }
  function act(p, ok) { return p.then(function () { if (ok) toast(ok); return refreshSocial(); }, function (e) { toast(wrT('member.not_completed', [errText(e)]), 3600); return refreshSocial(); }); }
  function addFriend(mid) {
    var c = midCheck(mid); if (!c.ok) { toast(c.msg || wrT('member.invalid_member_id_format')); return Promise.resolve(); }
    if (S.profile && mid.toLowerCase() === S.profile.midLower) { toast(wrT('member.thats_your_own_id')); return Promise.resolve(); }
    return MP.BE.nameOwner(mid.toLowerCase()).then(function (o) {
      if (!o) { toast(wrT('member.member_not_found', [mid])); return; }
      var pid = pairId(uid(), o);
      return MP.BE.getFriendship(pid).then(function (x) {
        if (x && x.status === 'accepted') { toast(wrT('member.youre_already_friends')); return; }
        if (x && x.to === uid()) return act(MP.BE.acceptFriend(pid), wrT('member.they_had_invited_you_too'));
        if (x) { toast(wrT('member.already_invited_waiting_for_them')); return; }
        return act(MP.BE.requestFriend(o), wrT('member.invite_sent_to_theyll_see', [mid])).then(function () { var i = $('mbFriendIn'); if (i) i.value = ''; });
      });
    }).catch(function (e) { toast(wrT('member.invite_failed', [errText(e)]), 3600); });
  }
  /* 刪好友：刪 friendships 文件，順便收回「我分享給他的」、把自己從「他分享給我的」移除 */
  function removeFriend(pid, other) {
    return MP.BE.deleteFriend(pid).then(function () {
      var jobs = [];
      S.mine.forEach(function (s) { if ((s.to || []).indexOf(other) >= 0) jobs.push(MP.BE.setShareTo(s.id, s.to.filter(function (u) { return u !== other; }))); });
      S.toMe.forEach(function (s) { if (s.owner === other) jobs.push(MP.BE.leaveShare(s.id, (s.to || []).filter(function (u) { return u !== uid(); }))); });
      return Promise.all(jobs.map(function (j) { return j.catch(function () {}); }));
    });
  }

  // 分享
  function friendsList() { return S.friends.friends.map(function (x) { return x.uid; }); }
  function sharesOf(recId) { return S.mine.filter(function (s) { return s.recId === String(recId); }); }
  function kindName(s) { return s.kind === 'analysis' ? wrT('app.analysis_2') : wrT('app.call_2'); }
  function fmtDate(iso) { var d = new Date(iso); if (!isFinite(d)) return ''; try { return new Intl.DateTimeFormat(wrT.locale(), { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch (e) { return String(iso).slice(0, 10); } }
  function renderShares(on) {
    var c = show('mbShares', on); if (!c || !on) return;
    var seen = ls(LS_SEEN) || {}, h = wrT('member.shared_with_me_read_only');
    h += S.toMe.length ? S.toMe.map(function (s) {
      return wrT('member.shared_by', [esc(s.id), !seen[s.id] ? wrT('member.x') : '', esc(s.name || kindName(s)), kindName(s), esc(s.ownerMid), esc(fmtDate(s.recCreated)), ICON.chev]);
    }).join('') : wrT('member.no_friends_have_shared_records');
    h += wrT('member.shared_by_me_can_be');
    h += S.mine.length ? S.mine.map(function (s) {
      return wrT('member.withdraw_all', [esc(s.id), esc(s.name || kindName(s)), esc(fmtDate(s.recCreated)), (s.to || []).map(function (u) { return wrT('member.x_2', [esc(who(u)), esc(u), esc(who(u))]); }).join('')]);
    }).join('') : wrT('member.on_the_records_page_tap');
    c.innerHTML = h;
    c.querySelectorAll('.mb-sh').forEach(function (b) { b.onclick = function () { openShared(b.dataset.sid); }; });
    c.querySelectorAll('.mb-mine').forEach(function (row) {
      var s = S.mine.filter(function (x) { return x.id === row.dataset.sid; })[0]; if (!s) return;
      row.querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { act(MP.BE.setShareTo(s.id, s.to.filter(function (u) { return u !== b.dataset.u; })), wrT('member.withdrawn')); }; });
      row.querySelector('[data-all]').onclick = function () { ask(wrT('member.withdraw_this_share_your_friend'), function () { act(MP.BE.deleteShare(s.id), wrT('member.all_withdrawn')); }, null, { yes: wrT('member.withdraw') }); };
    });
  }
  /* 唯讀檢視：用紀錄碼還原，畫在 ISSF 靶面上（不存進自己的紀錄） */
  function closeView(bg) { bg.remove(); if (!D.querySelector('.mb-view')) B.classList.remove('mb-view-open'); }
  function openShared(sid) {
    var s = S.toMe.filter(function (x) { return x.id === sid; })[0]; if (!s) return;
    var seen = ls(LS_SEEN) || {}; seen[sid] = 1; ls(LS_SEEN, seen); renderBadges();
    var Code = root.BMCode, rec = null; try { rec = Code && Code.decode(s.code).records[0]; } catch (e) {}
    var bg = D.createElement('div'); bg.className = 'mb-view mb-shared'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', wrT('member.shared_record'));
    bg.innerHTML = wrT('member.back_read_only_shared_by', [whoHTML(s.owner), esc(s.name || kindName(s)), kindName(s), esc(fmtDate(s.recCreated)), rec ? '<div class="svgwrap mb-view-tg"><svg class="target mb-ro-svg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="mb-view-meta"></div>' : wrT('member.this_record_code_cant_be')]);
    D.body.appendChild(bg); B.classList.add('mb-view-open');
    if (rec) { try { var A = app(); A.drawRecord(bg.querySelector('svg'), rec); bg.querySelector('.mb-view-meta').innerHTML = A.recMetaHTML(rec); } catch (e) { bg.querySelector('.mb-view-meta').textContent = wrT('member.couldnt_draw', [e.message]); } }
    bg.querySelector('.x').onclick = function () { closeView(bg); renderCards(); };
  }
  /* 紀錄頁「分享給好友」：選好友（最多 5 位） */
  function shareRecord(s) {
    if (!hasProfile()) { toast(wrT('member.sign_in_and_create_a')); return; }
    var fr = friendsList(); if (!fr.length) { toast(wrT('member.no_friends_yet_add_friends'), 3200); return; }
    var Code = root.BMCode, code = null; try { code = Code.encode(s); } catch (e) {}
    if (!code) { toast(wrT('member.this_record_has_no_shots')); return; }
    if (code.length > 20000) { toast(wrT('member.this_record_is_too_large')); return; }
    var already = {}; sharesOf(s.id).forEach(function (x) { (x.to || []).forEach(function (u) { already[u] = 1; }); });
    var bg = modal(wrT('member.share_with_friends_read_only', [SHARE_MAX, fr.map(function (u) { return '<label class="mb-pk' + (already[u] ? ' dis' : '') + '"><input type="checkbox" value="' + esc(u) + '"' + (already[u] ? ' disabled' : '') + '>' + whoHTML(u) + (already[u] ? wrT('member.shared') : '') + '</label>'; }).join('')]));
    var yes = bg.querySelector('.yes'), boxes = [].slice.call(bg.querySelectorAll('input[type=checkbox]'));
    function sel() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
    boxes.forEach(function (b) { b.onchange = function () { if (sel().length > SHARE_MAX) { b.checked = false; toast(wrT('member.up_to_at_a_time', [SHARE_MAX])); } var n = sel().length; yes.disabled = !n; yes.textContent = n ? wrT('member.share_with', [n]) : wrT('member.share'); }; });
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    yes.onclick = function () {
      var to = sel(); if (!to.length) return; yes.disabled = true;
      var sid = (String(uid()).slice(0, 10) + '_' + String(s.id).replace(/[^A-Za-z0-9_-]/g, '').slice(-24) + '_' + Date.now().toString(36)).slice(0, 64);
      MP.BE.createShare(sid, { ownerMid: S.profile.mid, to: to, recId: String(s.id).slice(0, 64), kind: s.kind === 'analysis' ? 'analysis' : 'forecast', targetId: String(s.targetId || 'ap10').slice(0, 16), name: String((s.name && s.name.trim()) || '').slice(0, 120), recCreated: String(s.created || '').slice(0, 40), code: code })
        .then(function () { bg.remove(); toast(wrT('member.shared_with', [to.map(who).join(wrT('core.x_3'))])); return refreshSocial(); }, function (e) { yes.disabled = false; toast(wrT('member.share_failed', [errText(e)]), 3600); });
    };
  }

  // ---------- 4) 未讀數字（打開 App 時；沒有推播） ----------
  function counts() { var seen = ls(LS_SEEN) || {}; return { req: S.friends.incoming.length, sh: S.toMe.filter(function (s) { return !seen[s.id]; }).length }; }
  function renderBadges() {
    var c = hasProfile() ? counts() : { req: 0, sh: 0 }, n = c.req + c.sh;
    [['#mhChip', 0], ['#stTabAcct', 1], ['#wrNav [data-tab="about"]', 1], ['#liteMoreBtn', 1]].forEach(function (x) {
      var host = D.querySelector(x[0]); if (!host) return;
      var b = host.querySelector(':scope > .mb-badge');
      if (!b) { b = D.createElement('span'); b.className = 'mb-badge'; host.appendChild(b); }
      b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); b.setAttribute('aria-label', wrT('member.new_notifications', [n]));
    });
  }
})(window.WRMemberParts = window.WRMemberParts || {}, window);
