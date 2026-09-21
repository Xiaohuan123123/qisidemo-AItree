/**
 * 栖思 · 笔记整理工具 — 笔记库模块
 * 笔记列表渲染 + 笔记详情（Markdown）+ 导出/删除/复盘入口
 */
var Notes = (function() {
  'use strict';

  var _currentNoteId = null;

  var SOURCE_TYPE_LABEL = {
    screenshot: '🖼️ 截图',
    file: '📄 文件',
    text: '✂️ 文字',
    mixed: '📎 混合',
  };

  // ========================================================
  //  笔记库列表页
  // ========================================================
  function renderList() {
    var grid = document.getElementById('notesGrid');
    if (!grid) return;
    var notes = Storage.Notes.load();

    if (!notes.length) {
      grid.innerHTML = '<div class="empty-cards">还没有笔记 📒<br>去「整理」页导入第一份内容吧</div>';
      return;
    }

    grid.innerHTML = '';
    notes.slice().reverse().forEach(function(note) {
      var el = document.createElement('div');
      el.className = 'note-card';
      el.style.cursor = 'pointer';

      var excerpt = (note.markdown || '').replace(/[#*`\-\[\]>\n]/g, ' ').trim().substring(0, 80);
      var dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString('zh-CN') : '';
      var srcLabel = SOURCE_TYPE_LABEL[note.sourceType] || '📎';

      el.innerHTML =
        '<div class="note-card-top">' +
          '<span class="note-card-title">' + _esc(note.title || '未命名笔记') + '</span>' +
          '<span class="note-card-top-right">' +
            '<span class="note-card-src">' + srcLabel + '</span>' +
            '<button class="note-card-export" title="导出 Markdown">⬇️</button>' +
          '</span>' +
        '</div>' +
        '<div class="note-card-excerpt">' + _esc(excerpt) + '...</div>' +
        '<div class="note-card-meta">' +
          '<span>' + dateStr + '</span>' +
          (note.cardIds && note.cardIds.length ? '<span>🃏 ' + note.cardIds.length + ' 个知识点</span>' : '') +
          (note.reviewCount ? '<span>🔁 复盘 ' + note.reviewCount + ' 次</span>' : '') +
        '</div>' +
        '<div class="note-card-footer">' +
          Feishu.syncButtonHTML(note.id, 'feishu-btn-sm') +
          Feishu.syncBadgeHTML(note) +
        '</div>';

      // 导出按钮（阻止冒泡，避免触发卡片点击）
      el.querySelector('.note-card-export').addEventListener('click', function(e) {
        e.stopPropagation();
        exportNoteById(note.id);
      });
      el.addEventListener('click', function() { App.openNoteDetail(note.id); });
      grid.appendChild(el);
    });
  }

  // ========================================================
  //  笔记详情页
  // ========================================================
  function openDetail(noteId) {
    var note = Storage.Notes.get(noteId);
    if (!note) { App._showToast('笔记不存在'); return; }
    _currentNoteId = noteId;

    App.switchTab('note-detail', true);

    _setText('noteDetailTitle', note.title || '未命名笔记');
    var dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString('zh-CN') : '';
    _setText('noteDetailMeta', (SOURCE_TYPE_LABEL[note.sourceType] || '') + ' · ' + dateStr + (note.reviewCount ? ' · 已复盘 ' + note.reviewCount + ' 次' : ''));

    // 方案单摘要
    var planRows = document.getElementById('noteDetailPlan');
    if (planRows && note.plan) {
      var p = note.plan;
      var rows = [];
      if (p.purpose) rows.push(['🎯 目的', p.purpose]);
      if (p.format) rows.push(['🧩 结构', p.format]);
      if (p.detailLevel) rows.push(['✂️ 详略', p.detailLevel]);
      if (p.allowSupplement) rows.push(['📎 补充', p.allowSupplement]);
      if (p.keepAnnotations) rows.push(['✏️ 批注', p.keepAnnotations]);
      if (p.sourceSummary) rows.push(['📄 摘要', p.sourceSummary]);
      planRows.innerHTML = rows.map(function(r) {
        return '<span class="note-plan-chip"><b>' + r[0] + '</b> ' + _esc(r[1]) + '</span>';
      }).join('');
    }

    // 飞书同步按钮 + 已同步标记
    _renderFeishuBar(note);

    // Markdown 正文
    var body = document.getElementById('noteDetailBody');
    if (body) {
      body.innerHTML = renderMarkdown(note.markdown);
    }
  }

  function _renderFeishuBar(note) {
    var host = document.getElementById('noteDetailFeishu');
    if (!host) return;
    host.innerHTML = Feishu.syncButtonHTML(note.id) + ' ' + Feishu.syncBadgeHTML(note);
  }

  /**
   * 渲染 Markdown → 安全 HTML
   * 笔记内容来自 LLM（可能原样保留用户粘贴的原始 HTML），
   * 直接 innerHTML 会让 <img onerror=...> 这类 payload 在打开笔记时执行，
   * 因此必须经 DOMPurify 净化后再插入。
   */
  function renderMarkdown(md) {
    var source = md || '*（空笔记）*';
    if (typeof marked === 'undefined') return _esc(source);
    var html;
    try {
      if (marked.setOptions) marked.setOptions({ breaks: true });
      html = marked.parse(source);
    } catch (e) {
      return _esc(source);
    }
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    }
    // DOMPurify 未加载（CDN 失败）时降级为纯文本，绝不直接插入未净化 HTML
    console.warn('[Notes] DOMPurify 未加载，降级为纯文本渲染');
    return _esc(source);
  }

  function closeDetail() {
    _currentNoteId = null;
    App.switchTab('notes', true);
  }

  // ========================================================
  //  操作：导出 / 删除 / 复盘
  // ========================================================
  // Windows 文件名非法字符替换
  function _safeFilename(name) {
    return (name || '笔记').replace(/[\\/:*?"<>|\r\n]/g, '_').substring(0, 80) || '笔记';
  }

  function exportMarkdown() {
    var note = Storage.Notes.get(_currentNoteId);
    if (note) exportNoteById(note.id);
  }

  // 全部笔记合并导出为一个 Markdown 文件
  function exportAllNotes() {
    var notes = Storage.Notes.load();
    if (!notes.length) { App._showToast('还没有笔记可以导出'); return; }
    var parts = notes.map(function(note) {
      var dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString('zh-CN') : '';
      return '# ' + (note.title || '未命名笔记') + '\n\n' +
        '> ' + dateStr + (note.plan && note.plan.purpose ? ' ｜ 整理目的：' + note.plan.purpose : '') + '\n\n' +
        (note.markdown || '');
    });
    var blob = new Blob([parts.join('\n\n---\n\n')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '栖思笔记汇总_' + new Date().toISOString().split('T')[0] + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 3000);
    App._showToast('已导出 ' + notes.length + ' 篇笔记 📥');
  }

  // 任意入口导出（笔记卡片 / 生成结果气泡共用）
  function exportNoteById(noteId) {
    var note = Storage.Notes.get(noteId);
    if (!note) { App._showToast('笔记不存在'); return; }
    var blob = new Blob([note.markdown || ''], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = _safeFilename(note.title) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 3000);
    App._showToast('已导出 Markdown 📥');
  }

  function deleteCurrent() {
    var note = Storage.Notes.get(_currentNoteId);
    if (!note) return;
    var overlay = document.getElementById('noteDeleteOverlay');
    if (overlay) overlay.classList.add('active');
  }

  function confirmDelete() {
    var note = Storage.Notes.get(_currentNoteId);
    if (note) {
      note.itemType = 'note';
      Storage.Trash.add(note);
      Storage.Notes.remove(note.id);
      Storage.Analytics.track('note_delete', { noteId: note.id });
      App._showToast('已移入垃圾箱');
    }
    closeDeleteConfirm();
    closeDetail();
    document.dispatchEvent(new CustomEvent('note:updated', { detail: {} }));
  }

  function closeDeleteConfirm() {
    var overlay = document.getElementById('noteDeleteOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  function startReviewCurrent() {
    if (_currentNoteId) App.startReview(_currentNoteId);
  }

  function getCurrentId() { return _currentNoteId; }

  function _setText(id, t) { var e = document.getElementById(id); if (e) e.textContent = t; }
  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  return {
    renderList: renderList,
    openDetail: openDetail,
    closeDetail: closeDetail,
    exportMarkdown: exportMarkdown,
    exportNoteById: exportNoteById,
    exportAllNotes: exportAllNotes,
    deleteCurrent: deleteCurrent,
    confirmDelete: confirmDelete,
    closeDeleteConfirm: closeDeleteConfirm,
    startReviewCurrent: startReviewCurrent,
    getCurrentId: getCurrentId,
  };
})();
