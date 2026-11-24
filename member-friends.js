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
  MP.pruneShared = pruneShared; MP.recordDeleted = recordDeleted; MP.checkShared = checkShared;
  MP.renderFriends = renderFriends; MP.addFriend = addFriend; MP.sharesOf = sharesOf; MP.renderShares = renderShares; MP.closeView = closeView;
  MP.shareRecord = shareRecord; MP.counts = counts; MP.renderBadges = renderBadges;

  // 好友
  function renderFriends(on) {
    var c = show('mbFriends', on); if (!c || !on) return;
    var f = S.friends, n = f.incoming.length;
    var h = wrT('member.friends_invite', [f.friends.length, n ? wrT('member.new_invites', [n]) : '']);
    if (f.incoming.length) h += wrT('member.invites_received', [f.incoming.map(function (x) { return wrT('member.accept_decline', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    if (f.outgoing.length) h += wrT('member.sent_waiting_for_them_to', [f.outgoing.map(function (x) { return wrT('member.cancel', [esc(x.id), esc(x.uid), whoHTML(x.uid)]); }).join('')]);
    // v2.5.0：點好友（名字）＝看他的資料卡（公開欄位）＋分享紀錄給他
    h += wrT('member.friend_list', [f.friends.length ? f.friends.map(function (x) { return wrT('member.remove', [esc(x.id), esc(x.uid), '<button type="button" class="mb-frbtn" data-a="card" aria-label="' + esc(wrT('member.open_card', [who(x.uid)])) + '">' + whoHTML(x.uid) + ICON.chev + '</button>', esc(who(x.uid))]); }).join('') : wrT('member.no_friends_yet_enter_someones')]);
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
        else if (a === 'card') openCard(row.dataset.uid);
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
  /* 刪好友：先收回雙方分享；收回失敗就停，不刪好友 */
  function removeFriend(pid, other) {
    var jobs = [];
    S.mine.forEach(function (s) {
      if ((s.to || []).indexOf(other) < 0) return;
      var next = s.to.filter(function (u) { return u !== other; });
      jobs.push(next.length ? MP.BE.setShareTo(s.id, next) : MP.BE.deleteShare(s.id));
    });
    S.toMe.forEach(function (s) {
      if (s.owner === other) jobs.push(MP.BE.leaveShare(s.id, (s.to || []).filter(function (u) { return u !== uid(); })));
    });
    return Promise.all(jobs).then(function () { return MP.BE.deleteFriend(pid); });
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
      row.querySelectorAll('[data-u]').forEach(function (b) {
        b.onclick = function () {
          var u = b.dataset.u;
          ask(wrT('member.withdraw_share_from', [who(u)]), function () {
            var next = (s.to || []).filter(function (x) { return x !== u; });
            act(next.length ? MP.BE.setShareTo(s.id, next) : MP.BE.deleteShare(s.id), wrT('member.withdrawn'));
          }, null, { yes: wrT('member.withdraw') });
        };
      });
      row.querySelector('[data-all]').onclick = function () { ask(wrT('member.withdraw_this_share_your_friend'), function () { act(MP.BE.deleteShare(s.id), wrT('member.all_withdrawn')); }, null, { yes: wrT('member.withdraw') }); };
    });
  }
  /* v2.9.0 好友分享、保存在自己這邊的紀錄：分享清單（sharesToMe，規則只讓「還在 to 名單裡」的人查到）裡沒有了
   * ＝好友刪除紀錄、收回分享或刪帳號 → 從這邊移除（本機＋自己的雲端）。只有在清單確定讀到時才呼叫（讀失敗不動）。 */
  function pruneShared(list) {
    var A = app(); if (!A || !A.sessions || !A.removeRecords) return 0;
    var live = {}; (list || []).forEach(function (x) { live[x.id] = 1; });
    // v2.9.4 第 15 項（White 2026-11-23 同意）：v2.5～v2.8「另存成我的」留下的 copiedFrom 舊副本＝鎖住但不自動刪除（原分享消失也留著，避免丟資料）；
    //   只有 v2.9.0 起的 sharedFrom（保存的唯讀分享）照舊跟著原分享消失
    var gone = A.sessions.filter(function (x) { return x.sharedFrom && !x.copiedFrom && !live[x.sharedFrom]; }).map(function (x) { return x.id; });
    if (!gone.length) return 0;
    var n = A.removeRecords(gone); if (n) toast(wrT('member.kept_gone', [n]), 4200);
    return n;
  }
  /* 打開保存的好友紀錄前問一次：true＝還在、false＝沒了（被刪／收回）、null＝不知道（沒登入、離線）→ 照樣用本機那份打開 */
  function checkShared(sid) {
    if (!sid || !uid() || !MP.BE || !MP.BE.getShare) return Promise.resolve(null);
    return MP.BE.getShare(sid).then(function (x) { return !!(x && (x.to || []).indexOf(uid()) >= 0); }, function (e) { return e && /permission-denied|not-found/.test(e.code || '') ? false : null; });
  }
  /* v2.9.4 第 14 項：我分享出去、還存著完整紀錄碼（code）的舊分享 → 換成檢視碼（view）、刪掉 code（規則只允許擁有者這樣改）。
   * 用分享文件裡的 code 自己轉（不需要本機還有那筆紀錄）；失敗（離線、規則還沒更新）就下次再試，不影響其他功能。 */
  function upgradeShares(list) {
    var Code = root.BMCode; if (!Code || !Code.encodeShare || !MP.BE || !MP.BE.upgradeShare) return Promise.resolve(0);
    var todo = (list || []).filter(function (x) { return x && x.owner === uid() && typeof x.code === 'string' && !x.view; });
    return Promise.all(todo.map(function (x) {
      var rec = null; try { rec = Code.decodeShare(x.code, x.id); } catch (e) {}
      var v = rec && Code.encodeShare(rec, x.id); if (!v) return 0;
      return MP.BE.upgradeShare(x.id, v).then(function () { x.view = v; delete x.code; return 1; }, function () { return 0; });
    })).then(function (a) { return a.reduce(function (s, n) { return s + n; }, 0); });
  }
  MP.upgradeShares = upgradeShares;
  /* 刪掉自己的紀錄：分享出去的那幾份一起收回（擁有者可以刪自己的分享，規則不用改） */
  function recordDeleted(recId) {
    if (!uid() || !MP.BE) return;
    var mine = sharesOf(recId); if (!mine.length) return;
    Promise.all(mine.map(function (x) { return MP.BE.deleteShare(x.id).catch(function () {}); })).then(function () { return MP.refreshSocial ? MP.refreshSocial() : null; }).catch(function () {});
  }
  /* 唯讀檢視：用紀錄碼還原，畫在 ISSF 靶面上（不存進自己的紀錄） */
  function closeView(bg) { bg.remove(); if (!D.querySelector('.mb-view')) B.classList.remove('mb-view-open'); }
  function openShared(sid) {
    var s = S.toMe.filter(function (x) { return x.id === sid; })[0]; if (!s) return;
    var seen = ls(LS_SEEN) || {}; seen[sid] = 1; ls(LS_SEEN, seen); renderBadges();
    // v2.9.4 第 14 項：新分享存檢視碼 view（不是紀錄碼）；舊分享（v2.9.3 以前）還是 code，一樣讀得到
    var Code = root.BMCode, rec = null; try { rec = Code && (Code.decodeShare ? Code.decodeShare(s.view || s.code, s.id) : Code.decode(s.code).records[0]); } catch (e) {}
    // v2.5.0：打開完整的分析頁（所有模塊）唯讀檢視；可「另存成我的紀錄」（複製一份，對方的紀錄不會被改）
    var A0 = app();
    if (rec && A0 && A0.anaOpenRO) {
      D.querySelectorAll('.mb-view').forEach(function (v) { closeView(v); });
      var owner = s.ownerMid || who(s.owner);
      return A0.anaOpenRO(rec, { kind: 'friend', title: (s.name && s.name.trim()) || kindName(s), sub: wrT('app.ro_friend_sub', [owner, fmtDate(s.recCreated)]),
        // v2.9.0（§7 第 6、11 項，White 2026-11-21）不能「另存成我的」；改成保存在自己這邊唯讀檢視（sharedFrom＝分享 id），
        // 一律絕對鎖定；好友刪除紀錄或收回分享後，下次登入／重新整理好友資料時自動移除（pruneShared）。
        onSave: function (r, done) {
          var A = app(), had = A.sessions.some(function (x) { return x.sharedFrom === sid || x.copiedFrom === sid; });
          if (!had) A.anaSaveCopy(r, { sharedFrom: sid, sharedOwner: String(owner || '').slice(0, 40), name: wrT('app.ro_copy_name', [owner, (r.name && r.name.trim()) || kindName(s)]).slice(0, 120) });
          toast(wrT('app.ro_copy_saved'), 3600); done();
        },
        onClose: function () { renderCards(); } });
    }
    var bg = D.createElement('div'); bg.className = 'mb-view mb-shared'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', wrT('member.shared_record'));
    bg.innerHTML = wrT('member.back_read_only_shared_by', [whoHTML(s.owner), esc(s.name || kindName(s)), kindName(s), esc(fmtDate(s.recCreated)), rec ? '<div class="svgwrap mb-view-tg"><svg class="target mb-ro-svg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="mb-view-meta"></div>' : wrT('member.this_record_code_cant_be')]);
    D.body.appendChild(bg); B.classList.add('mb-view-open');
    if (rec) { try { var A = app(); A.drawRecord(bg.querySelector('svg'), rec); bg.querySelector('.mb-view-meta').innerHTML = A.recMetaHTML(rec); } catch (e) { bg.querySelector('.mb-view-meta').textContent = wrT('member.couldnt_draw', [e.message]); } }
    bg.querySelector('.x').onclick = function () { closeView(bg); renderCards(); };
  }
  /* v2.5.0 好友資料卡：他標「好友可看」的欄位（cards/{uid}；規則只讓好友讀）＋分享紀錄給他 */
  function openCard(u) {
    var p = MP.profOf ? MP.profOf(u) : null, A = app(), PF = (root.WRApp && root.WRApp.pf) || null;
    var bg = modal('<div class="modal pf-modal mb-card" role="dialog" aria-modal="true" aria-label="' + esc(wrT('member.friend_card')) + '"><div class="mb-card-h">' + (MP.avHTML ? MP.avHTML(p, 'mb-av lg') : '') + '<div><b>' + esc(who(u)) + '</b><small>' + wrT('member.friend_card') + '</small></div></div>'
      + '<div class="mb-card-b" aria-live="polite"><div class="lbl">' + wrT('member.loading') + '</div></div>'
      + '<div class="row"><button type="button" class="no">' + wrT('h.close') + '</button><button type="button" class="primary sh">' + wrT('member.share_a_record_to') + '</button></div></div>');
    bg.classList.add('mb-card-bg');
    var body = bg.querySelector('.mb-card-b');
    function show(c) {
      var rows = PF ? PF.KEYS.filter(function (k) { return c && typeof c[k] === 'string' && c[k]; }).map(function (k) { return '<div class="mb-card-r"><span>' + esc(PF.label(k)) + '</span><b>' + esc(PF.show(k, c[k])) + '</b></div>'; }) : [];
      body.innerHTML = rows.length ? rows.join('') : '<div class="lbl">' + wrT('member.card_empty') + '</div>';
    }
    (MP.BE.getCard ? MP.BE.getCard(u) : Promise.resolve(null)).then(show, function (e) { body.innerHTML = '<div class="lbl">' + esc(wrT('member.not_completed', [errText(e)])) + '</div>'; });
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    bg.querySelector('.sh').onclick = function () { bg.remove(); pickRecordFor(u); };
    bg.addEventListener('click', function (e) { if (e.target === bg) bg.remove(); });
    return bg;
  }
  /* 從好友資料卡分享：先選一筆紀錄，再到選好友（已勾這位） */
  function pickRecordFor(u) {
    var A = app(), list = (A.sessions || []).filter(function (s) { return s.kind === 'analysis' ? (s.sheets || []).some(function (x) { return x.shots && x.shots.length; }) : ((s.actuals || []).length || (s.preds || []).length); })
      .slice().sort(function (a, b) { return String(b.created).localeCompare(String(a.created)); }).slice(0, 40);
    if (!list.length) { toast(wrT('member.no_records_to_share')); return; }
    var bg = modal('<div class="modal pf-modal mb-recpick" role="dialog" aria-modal="true" aria-label="' + esc(wrT('member.share_a_record_to')) + '"><p class="pf-mh">' + esc(wrT('member.pick_record_for', [who(u)])) + '</p><div class="mb-recl">'
      + list.map(function (s, i) { var n = s.kind === 'analysis' ? (s.sheets || []).reduce(function (a, x) { return a + x.shots.length; }, 0) : (s.actuals || []).length;
        return '<button type="button" class="mb-rec" data-i="' + i + '"><b>' + esc((s.name && s.name.trim()) || (A.recTitle ? A.recTitle(s) : kindName(s))) + '</b><small>' + esc(kindName(s)) + '・' + esc(fmtDate(s.created)) + '・' + esc(wrT('member.n_shots', [n])) + '</small></button>'; }).join('')
      + '</div><div class="row"><button type="button" class="no">' + wrT('h.close') + '</button></div></div>');
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    bg.querySelectorAll('.mb-rec').forEach(function (b) { b.onclick = function () { bg.remove(); shareRecord(list[+b.dataset.i], u); }; });
  }
  MP.openCard = openCard;
  /* 紀錄頁「分享給好友」：選好友（最多 5 位）；pre＝先勾好的好友（從好友資料卡來的） */
  function shareRecord(s, pre) {
    if (!hasProfile()) { toast(wrT('member.sign_in_and_create_a')); return; }
    var fr = friendsList(); if (!fr.length) { toast(wrT('member.no_friends_yet_add_friends'), 3200); return; }
    var Code = root.BMCode, code = null; try { code = Code.encode(s); } catch (e) {}
    if (!code) { toast(wrT('member.this_record_has_no_shots')); return; }
    if (code.length > 20000) { toast(wrT('member.this_record_is_too_large')); return; }
    var already = {}; sharesOf(s.id).forEach(function (x) { (x.to || []).forEach(function (u) { already[u] = 1; }); });
    var bg = modal(wrT('member.share_with_friends_read_only', [SHARE_MAX, fr.map(function (u) { return '<label class="mb-pk' + (already[u] ? ' dis' : '') + '"><input type="checkbox" value="' + esc(u) + '"' + (already[u] ? ' disabled' : '') + '>' + whoHTML(u) + (already[u] ? wrT('member.shared') : '') + '</label>'; }).join('')]));
    var yes = bg.querySelector('.yes'), boxes = [].slice.call(bg.querySelectorAll('input[type=checkbox]'));
    function sel() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }); }
    if (pre) boxes.forEach(function (b) { if (b.value === pre && !b.disabled) { b.checked = true; yes.disabled = false; yes.textContent = wrT('member.share_with', [1]); } });
    boxes.forEach(function (b) { b.onchange = function () { if (sel().length > SHARE_MAX) { b.checked = false; toast(wrT('member.up_to_at_a_time', [SHARE_MAX])); } var n = sel().length; yes.disabled = !n; yes.textContent = n ? wrT('member.share_with', [n]) : wrT('member.share'); }; });
    bg.querySelector('.no').onclick = function () { bg.remove(); };
    yes.onclick = function () {
      var to = sel(); if (!to.length) return; yes.disabled = true;
      var sid = (String(uid()).slice(0, 10) + '_' + String(s.id).replace(/[^A-Za-z0-9_-]/g, '').slice(-24) + '_' + Date.now().toString(36)).slice(0, 64);
      MP.BE.createShare(sid, { ownerMid: S.profile.mid, to: to, recId: String(s.id).slice(0, 64), kind: s.kind === 'analysis' ? 'analysis' : 'forecast', targetId: String(s.targetId || 'ap10').slice(0, 16), name: String((s.name && s.name.trim()) || '').slice(0, 120), recCreated: String(s.created || '').slice(0, 40), view: Code.encodeShare(s, sid) })
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
