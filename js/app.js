/**
 * 栖思 · 笔记整理工具 — 主控模块
 * Tab切换 / 笔记库与知识点页渲染 / 卡片详情 / 垃圾箱 / Onboarding
 */
var App = (function() {
  'use strict';

  var currentTab = 'organize';

  // ========================================================
  //  初始化
  // ========================================================
  function init() {
    if (!Storage.Onboarding.isDone()) _showOnboarding();
    Chat.init();

    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() { switchTab(this.dataset.tab); });
    });

    // 笔记生成/更新后刷新各页
    document.addEventListener('note:generated', _refreshAll);
    document.addEventListener('note:updated', _refreshAll);

    var theme = Storage.Theme.get();
    if (theme) document.body.className = theme;

    Storage.Analytics.track('app_launch', { isFirst: !Storage.Onboarding.isDone() });
    _refreshAll();
  }

  function _refreshAll() {
    _renderNotesPanel();
    Notes.renderList();
    _updateCardsPage();
    _updateProfilePage();
    _updateTrashBadge();
  }

  // ========================================================
  //  Tab 切换（支持无导航项的详情页）
  // ========================================================
  function switchTab(tab, isSubPage) {
    if (tab === currentTab) return;
    currentTab = tab;

    document.querySelectorAll('.page-section').forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById('page-' + tab);
    if (target) target.classList.add('active');

    if (!isSubPage) {
      document.querySelectorAll('.nav-item').forEach(function(n) {
        n.classList.toggle('active', n.dataset.tab === tab);
      });
    }

    Storage.Analytics.track('tab_switch', { to: tab });
    if (tab === 'notes') Notes.renderList();
    if (tab === 'cards') _updateCardsPage();
    if (tab === 'profile') _updateProfilePage();
  }

  // ========================================================
  //  Onboarding（精简版）
  // ========================================================
  function _showOnboarding() {
    var overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.add('active');
  }

  function completeOnboarding() {
    var profile = {
      nickname: (_getVal('ob-nickname') || '').trim(),
      defaultPurpose: _getSelectVal('ob-purpose', '考前复习'),
    };
    Storage.Profile.save(profile);
    Storage.Onboarding.markDone();
    document.getElementById('onboarding-overlay').classList.remove('active');
    Storage.Analytics.track('onboarding_complete', profile);
    _updateProfilePage();
  }

  function skipOnboarding() {
    Storage.Onboarding.markDone();
    document.getElementById('onboarding-overlay').classList.remove('active');
  }

  // ========================================================
  //  整理页：空状态导入
  // ========================================================
  function toggleTextImport() {
    var box = document.getElementById('textImportBox');
    if (!box) return;
    var showing = box.style.display !== 'none';
    box.style.display = showing ? 'none' : 'block';
    if (!showing) {
      var ta = document.getElementById('textImportArea');
      if (ta) setTimeout(function() { ta.focus(); }, 50);
    }
  }

  function confirmTextImport() {
    var ta = document.getElementById('textImportArea');
    if (!ta) return;
    var text = ta.value.trim();
    if (text.length < 10) {
      _showToast('多贴一点内容吧（至少10个字）');
      return;
    }
    if (text.length > 15000) text = text.substring(0, 15000);
    Storage.Analytics.track('import', { type: 'text' });
    ta.value = '';
    var box = document.getElementById('textImportBox');
    if (box) box.style.display = 'none';
    Chat.addBubble('ai', '✂️ 收到文字内容（' + text.length + '字），先看看我抓到的要点：');
    Chat.startOrganize(text, { type: 'text', files: [] });
  }

  // 「再整理一份」
  function resetOrganize() {
    Chat.clearChat();
  }

  // ========================================================
  //  整理页右侧：最新笔记
  // ========================================================
  function _renderNotesPanel() {
    var panel = document.getElementById('rightPanelNotes');
    if (!panel) return;
    var notes = Storage.Notes.load();
    panel.innerHTML = '';

    if (!notes.length) {
      panel.innerHTML = '<div class="right-panel-empty">整理完成的笔记<br>会出现在这里 ✨</div>';
      return;
    }
    notes.slice(-5).reverse().forEach(function(note) {
      var el = document.createElement('div');
      el.className = 'mini-note';
      el.style.cursor = 'pointer';
      var excerpt = (note.markdown || '').replace(/[#*`\-\[\]>\n]/g, ' ').trim().substring(0, 50);
      el.innerHTML =
        '<div class="mini-note-title">📒 ' + _esc(note.title || '未命名') + '</div>' +
        '<div class="mini-note-excerpt">' + _esc(excerpt) + '...</div>';
      el.addEventListener('click', function() { openNoteDetail(note.id); });
      panel.appendChild(el);
    });
  }

  // ========================================================
  //  复盘入口
  // ========================================================
  function startReview(noteId) {
    var note = Storage.Notes.get(noteId);
    if (!note) { _showToast('笔记不存在'); return; }
    switchTab('organize');
    Chat.refreshReviewNote();
    Chat.startReview(note);
  }

  function openNoteDetail(noteId) {
    Notes.openDetail(noteId);
  }

  // ========================================================
  //  知识点页（卡片列表 + 筛选 + 多选删除）
  // ========================================================
  var _filterDomain = 'all';
  var _filterTime = 'all';
  var _isEchoDeleteMode = false;

  function _updateCardsPage() {
    var echoes = Storage.Echoes.load();
    _buildDomainChips(echoes);
    _bindFilterEvents();
    _renderFilteredCards(echoes);
  }

  function _buildDomainChips(echoes) {
    var container = document.getElementById('domainChips');
    if (!container) return;
    var domains = {};
    echoes.forEach(function(c) {
      var d = c.domain || '未分类';
      domains[d] = (domains[d] || 0) + 1;
    });
    var customList = Storage.CustomDomains.load();
    customList.forEach(function(d) {
      if (!domains[d]) domains[d] = 0;
    });

    container.innerHTML = '';
    var allBtn = document.createElement('button');
    allBtn.className = 'filter-chip' + (_filterDomain === 'all' ? ' active' : '');
    allBtn.dataset.domain = 'all';
    allBtn.textContent = '全部';
    container.appendChild(allBtn);

    Object.keys(domains).sort().forEach(function(d) {
      var btn = document.createElement('button');
      btn.className = 'filter-chip' + (_filterDomain === d ? ' active' : '');
      btn.dataset.domain = d;
      btn.textContent = d + (domains[d] > 0 ? ' (' + domains[d] + ')' : '');
      container.appendChild(btn);
    });
  }

  function _bindFilterEvents() {
    document.querySelectorAll('#domainChips .filter-chip').forEach(function(chip) {
      chip.onclick = function() {
        _filterDomain = this.dataset.domain;
        _updateCardsPage();
      };
    });
    document.querySelectorAll('#timeChips .filter-chip').forEach(function(chip) {
      chip.onclick = function() {
        _filterTime = this.dataset.time;
        document.querySelectorAll('#timeChips .filter-chip').forEach(function(c) { c.classList.remove('active'); });
        this.classList.add('active');
        _renderFilteredCards(Storage.Echoes.load());
      };
    });
  }

  function _renderFilteredCards(echoes) {
    var grid = document.getElementById('cardsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    var filtered = echoes.filter(function(card) {
      if (_filterDomain !== 'all' && (card.domain || '未分类') !== _filterDomain) return false;
      if (_filterTime !== 'all') {
        var days = parseInt(_filterTime);
        var cardDate = new Date(card.createdAt);
        var cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        if (cardDate < cutoff) return false;
      }
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-cards">还没有知识点卡片 🌱<br>整理笔记后会自动析出</div>';
      return;
    }

    filtered.slice().reverse().forEach(function(card) {
      var el = document.createElement('div');
      el.className = 'echo-card level-' + (card.level || 1);
      if (_isEchoDeleteMode) el.classList.add('selectable');
      el.style.cursor = 'pointer';
      el.dataset.cardId = card.id;
      var dateStr = card.createdAt ? new Date(card.createdAt).toLocaleDateString('zh-CN') : '';
      el.innerHTML =
        '<div class="card-header"><span class="card-domain">' + _esc(card.domain || '未分类') + '</span><span class="card-level">L' + (card.level || 1) + '</span></div>' +
        '<div class="card-insight">' + _esc(card.insight || '') + '</div>' +
        (card.action ? '<div class="card-action">📌 ' + _esc(card.action) + '</div>' : '') +
        '<div class="card-date">' + dateStr + '</div>';
      el.addEventListener('click', function() {
        if (_isEchoDeleteMode) {
          el.classList.toggle('selected');
          _updateEchoDeleteCount();
        } else {
          openCardDetail(card);
        }
      });
      grid.appendChild(el);
    });
  }

  // ===== 多选删除 =====
  function enterEchoDeleteMode() {
    var echoes = Storage.Echoes.load();
    if (!echoes.length) { _showToast('没有可删除的卡片'); return; }
    _isEchoDeleteMode = true;
    var grid = document.getElementById('cardsGrid');
    if (grid) {
      grid.querySelectorAll('.echo-card').forEach(function(el) { el.classList.add('selectable'); });
    }
    var bar = document.getElementById('echoDeleteBar');
    if (bar) bar.classList.add('active');
    _updateEchoDeleteCount();
    var selectAll = document.getElementById('echoSelectAll');
    if (selectAll) {
      selectAll.checked = false;
      selectAll.onchange = function() {
        grid.querySelectorAll('.echo-card.selectable').forEach(function(el) {
          el.classList.toggle('selected', selectAll.checked);
        });
        _updateEchoDeleteCount();
      };
    }
  }

  function _updateEchoDeleteCount() {
    var count = document.querySelectorAll('.echo-card.selectable.selected').length;
    var countEl = document.getElementById('echoDeleteCount');
    if (countEl) countEl.textContent = '已选 ' + count + ' 张';
  }

  function confirmEchoDelete() {
    var selected = document.querySelectorAll('.echo-card.selectable.selected');
    if (!selected.length) { _showToast('请先选择要删除的卡片'); return; }
    var ids = [];
    selected.forEach(function(el) { if (el.dataset.cardId) ids.push(el.dataset.cardId); });

    var echoes = Storage.Echoes.load();
    var toTrash = [];
    var rest = [];
    echoes.forEach(function(c) {
      if (ids.indexOf(c.id) >= 0) toTrash.push(c);
      else rest.push(c);
    });
    Storage.Echoes.save(rest);
    Storage.Trash.addMany(toTrash);
    _showToast('已移入垃圾箱 ' + toTrash.length + ' 张');
    cancelEchoDelete();
    _refreshAll();
  }

  function cancelEchoDelete() {
    _isEchoDeleteMode = false;
    var bar = document.getElementById('echoDeleteBar');
    if (bar) bar.classList.remove('active');
    var grid = document.getElementById('cardsGrid');
    if (grid) {
      grid.querySelectorAll('.echo-card').forEach(function(el) {
        el.classList.remove('selectable', 'selected');
      });
    }
  }

  // ========================================================
  //  卡片详情
  // ========================================================
  var _currentCardId = null;
  var _currentCard = null;

  function openCardDetail(card) {
    _currentCardId = card.id;
    _currentCard = card;
    switchTab('card-detail', true);

    _setText('detailDomain', card.domain || '未分类');
    _setText('detailLevel', 'L' + (card.level || 1));
    _setText('detailDate', card.createdAt ? new Date(card.createdAt).toLocaleDateString('zh-CN') : '');
    _setText('detailTopic', card.topic || card.domain || '—');
    _setText('detailBlindspot', card.blindSpot || card.blindspot || '—');
    _setText('detailAction', card.action || '—');

    // 来源笔记
    var srcNote = card.noteId ? Storage.Notes.get(card.noteId) : null;
    _setText('detailSourceNote', srcNote ? '📒 ' + srcNote.title : '—');

    // 顿悟（可编辑）
    _loadInsight(card);

    // 笔记（可编辑）
    _loadCardNote(card.id);

    // 掌握度
    var stars = document.getElementById('detailStars');
    if (stars) {
      stars.innerHTML = '';
      for (var i = 1; i <= 5; i++) {
        var star = document.createElement('span');
        star.className = 'star' + (i <= (card.level || 1) ? ' filled' : '');
        star.textContent = '★';
        star.addEventListener('click', (function(level) {
          return function() {
            _currentCard.level = level;
            document.querySelectorAll('#detailStars .star').forEach(function(s, idx) {
              s.classList.toggle('filled', idx < level);
            });
            var echoes = Storage.Echoes.load();
            var idx = echoes.findIndex(function(c) { return c.id === _currentCard.id; });
            if (idx >= 0) { echoes[idx].level = level; Storage.Echoes.save(echoes); }
          };
        })(i));
        stars.appendChild(star);
      }
    }

    // 同笔记关联卡片
    var related = document.getElementById('detailRelated');
    if (related) {
      var echoes = Storage.Echoes.load();
      var relatedCards = echoes.filter(function(c) {
        return c.id !== card.id && (c.noteId === card.noteId || c.domain === card.domain);
      }).slice(0, 4);
      related.innerHTML = '';
      if (relatedCards.length) {
        relatedCards.forEach(function(rc) {
          var mini = document.createElement('div');
          mini.className = 'related-card-mini';
          mini.textContent = (rc.topic || rc.insight || '').substring(0, 30) + '...';
          mini.addEventListener('click', function() { openCardDetail(rc); });
          related.appendChild(mini);
        });
      } else {
        related.innerHTML = '<div class="related-empty">暂无关联卡片</div>';
      }
    }
  }

  function closeCardDetail() {
    _currentCardId = null;
    _currentCard = null;
    switchTab('cards', true);
  }

  // ===== 顿悟编辑 =====
  function _loadInsight(card) {
    var userEdited = Storage.CardNotes.get('insight:' + card.id);
    var text = userEdited || card.insight || '—';
    _setText('insightText', text);
    var display = document.getElementById('insightDisplay');
    var editing = document.getElementById('insightEditing');
    if (display) display.style.display = '';
    if (editing) editing.style.display = 'none';
  }

  function editInsight() {
    var display = document.getElementById('insightDisplay');
    var editing = document.getElementById('insightEditing');
    var textarea = document.getElementById('insightTextarea');
    var resetBtn = document.getElementById('insightResetBtn');
    if (!display || !editing || !textarea) return;
    var userEdited = Storage.CardNotes.get('insight:' + _currentCardId);
    textarea.value = userEdited || (_currentCard ? _currentCard.insight : '') || '';
    if (resetBtn) resetBtn.style.display = userEdited ? '' : 'none';
    display.style.display = 'none';
    editing.style.display = '';
    setTimeout(function() { textarea.focus(); }, 50);
  }

  function saveInsight() {
    var textarea = document.getElementById('insightTextarea');
    if (!textarea || !_currentCardId) return;
    Storage.CardNotes.save('insight:' + _currentCardId, textarea.value);
    _loadInsight(_currentCard);
    _showToast('已更新');
  }

  function cancelInsight() { _loadInsight(_currentCard); }

  function resetInsight() {
    if (!_currentCardId) return;
    Storage.CardNotes.remove('insight:' + _currentCardId);
    _loadInsight(_currentCard);
    _showToast('已恢复原文');
  }

  // ===== 卡片笔记 =====
  function _loadCardNote(cardId) {
    var note = Storage.CardNotes.get(cardId);
    var noteText = document.getElementById('noteText');
    if (!noteText) return;
    if (note) {
      noteText.textContent = note;
      noteText.classList.remove('note-empty');
    } else {
      noteText.textContent = '点「编辑」记录你的想法…';
      noteText.classList.add('note-empty');
    }
    var display = document.getElementById('noteDisplay');
    var editing = document.getElementById('noteEditing');
    if (display) display.style.display = '';
    if (editing) editing.style.display = 'none';
  }

  function editCardNote() {
    var display = document.getElementById('noteDisplay');
    var editing = document.getElementById('noteEditing');
    var textarea = document.getElementById('noteTextarea');
    if (!display || !editing || !textarea) return;
    textarea.value = Storage.CardNotes.get(_currentCardId) || '';
    display.style.display = 'none';
    editing.style.display = '';
    setTimeout(function() { textarea.focus(); }, 50);
  }

  function saveCardNote() {
    var textarea = document.getElementById('noteTextarea');
    if (!textarea || !_currentCardId) return;
    Storage.CardNotes.save(_currentCardId, textarea.value);
    _loadCardNote(_currentCardId);
    _showToast('笔记已保存');
  }

  function cancelCardNote() { _loadCardNote(_currentCardId); }

  // ========================================================
  //  我的页
  // ========================================================
  function _updateProfilePage() {
    var p = Storage.Profile.load();
    var name = p.nickname || '栖思用户';
    _setText('displayName', name);
    _setText('sidebar-name', name);
    _setText('val-nickname', name);
    _setText('val-purpose', p.defaultPurpose || '考前复习');

    var notes = Storage.Notes.load();
    var cards = Storage.Echoes.load();
    _setText('stat-notes', notes.length);
    _setText('stat-cards', cards.length);
    _setText('stat-reviews', Storage.Reviews.totalCount());
  }

  function switchTheme(t) {
    document.body.className = t;
    Storage.Theme.set(t);
  }

  function switchProfileTab(ptab) {
    document.querySelectorAll('.profile-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.ptab === ptab);
    });
    document.querySelectorAll('.profile-panel').forEach(function(p) {
      p.classList.toggle('active', p.id === 'panel-' + ptab);
    });
  }

  // ========================================================
  //  垃圾箱
  // ========================================================
  function openTrash() {
    var overlay = document.getElementById('trashOverlay');
    if (overlay) {
      overlay.classList.add('active');
      overlay.onclick = function(e) { if (e.target === overlay) closeTrash(); };
    }
    _renderTrash();
  }

  function closeTrash() {
    var overlay = document.getElementById('trashOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  function _renderTrash() {
    var body = document.getElementById('trashBody');
    if (!body) return;
    var items = Storage.Trash.loadPurged();
    _updateTrashBadge();

    if (!items.length) {
      body.innerHTML = '<div class="trash-empty">垃圾箱是空的 🌿</div>';
      return;
    }

    body.innerHTML = '';
    items.forEach(function(item) {
      var el = document.createElement('div');
      el.className = 'trash-item';
      var isNote = item.itemType === 'note';
      var deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
      var timeStr = '';
      if (deletedAt) {
        var remain = 7 - Math.floor((Date.now() - item.deletedAt) / 86400000);
        timeStr = remain > 0 ? '剩余 ' + remain + ' 天自动清空' : '即将清空';
      }
      var title = isNote ? (item.title || '未命名笔记') : ((item.topic || item.domain || '知识点'));
      var content = isNote ? (item.markdown || '').replace(/[#*`\-\[\]>\n]/g, ' ').trim().substring(0, 60)
                           : (item.insight || '');

      el.innerHTML =
        '<div class="trash-item-main">' +
          '<div class="trash-item-domain">' + (isNote ? '📒 笔记' : '🃏 卡片') + ' · ' + _esc(title) + '</div>' +
          '<div class="trash-item-insight">' + _esc(content) + '</div>' +
          '<div class="trash-item-time">' + timeStr + '</div>' +
        '</div>' +
        '<div class="trash-item-actions">' +
          '<button class="trash-restore-btn" data-id="' + item.id + '">恢复</button>' +
          '<button class="trash-perm-delete-btn" data-id="' + item.id + '">彻底删除</button>' +
        '</div>';
      body.appendChild(el);
    });

    body.querySelectorAll('.trash-restore-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var item = Storage.Trash.restore(this.dataset.id);
        if (item) {
          if (item.itemType === 'note') Storage.Notes.add(item);
          else Storage.Echoes.add(item);
          _showToast('已恢复');
          _renderTrash();
          _refreshAll();
        }
      });
    });

    body.querySelectorAll('.trash-perm-delete-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        Storage.Trash.permanentDelete(this.dataset.id);
        _showToast('已彻底删除');
        _renderTrash();
      });
    });
  }

  function _updateTrashBadge() {
    var badge = document.getElementById('trashBadge');
    if (!badge) return;
    var count = Storage.Trash.loadPurged().length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ========================================================
  //  清空确认弹窗
  // ========================================================
  function confirmClearChat() {
    var popup = document.getElementById('clearPopup');
    if (popup) popup.classList.add('active');
  }
  function closeClearPopup() {
    var popup = document.getElementById('clearPopup');
    if (popup) popup.classList.remove('active');
  }
  function doClearChat() {
    closeClearPopup();
    Chat.clearChat();
  }

  // ========================================================
  //  工具
  // ========================================================
  function _showToast(msg) {
    var toast = document.getElementById('qisiToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'qisiToast';
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--text-primary);color:var(--bg);padding:10px 24px;border-radius:9999px;font-size:14px;z-index:200;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(function() { toast.style.opacity = '0'; }, 2500);
  }

  function _getVal(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function _getSelectVal(id, def) { var e = document.getElementById(id); return e ? e.value : def; }
  function _setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ========================================================
  //  公开 API
  // ========================================================
  return {
    init: init,
    switchTab: switchTab,
    completeOnboarding: completeOnboarding,
    skipOnboarding: skipOnboarding,
    toggleTextImport: toggleTextImport,
    confirmTextImport: confirmTextImport,
    resetOrganize: resetOrganize,
    startReview: startReview,
    openNoteDetail: openNoteDetail,
    // 知识点页
    enterEchoDeleteMode: enterEchoDeleteMode,
    confirmEchoDelete: confirmEchoDelete,
    cancelEchoDelete: cancelEchoDelete,
    openTrash: openTrash,
    closeTrash: closeTrash,
    // 卡片详情
    openCardDetail: openCardDetail,
    closeCardDetail: closeCardDetail,
    editInsight: editInsight, saveInsight: saveInsight, cancelInsight: cancelInsight, resetInsight: resetInsight,
    editCardNote: editCardNote, saveCardNote: saveCardNote, cancelCardNote: cancelCardNote,
    // 其他
    switchTheme: switchTheme,
    switchProfileTab: switchProfileTab,
    confirmClearChat: confirmClearChat,
    closeClearPopup: closeClearPopup,
    doClearChat: doClearChat,
    _showToast: _showToast,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
