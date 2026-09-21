/**
 * 栖思 · 笔记整理工具 — 整理状态机（S0识别 → S1目的 → S2形式 → S3风格 → S4方案单 → S5生成）
 * 规则驱动：每阶段「调API拿结构化结果 → 渲染卡片/选项 → 用户确认推进」
 */
var Organize = (function() {
  'use strict';

  var session = null; // { stage, plan, sourceText, sourceMeta, analysis, suggestions }

  var SKIP_RE = /跳过|直接整理|直接生成|随便整理/;

  var PURPOSES = ['考前复习', '搭建知识体系', '输出分享', '单纯存档'];
  var NOTE_TYPES = ['课堂笔记', '读书笔记', '会议纪要', '灵感碎片', '资料摘抄'];

  function isActive() { return !!session; }
  function getSession() { return session; }

  function _persist() {
    Storage.OrganizeSession.save(session);
  }

  function _defaultPlan() {
    return {
      title: '', noteType: '', sourceSummary: '', keyPoints: [], uncertainPoints: [],
      corrections: '',
      purpose: '', format: '', detailLevel: '', allowSupplement: '', keepAnnotations: '',
    };
  }

  // ========================================================
  //  入口：新会话 / 恢复会话
  // ========================================================
  function start(sourceText, sourceMeta) {
    session = {
      stage: 'S0',
      plan: _defaultPlan(),
      sourceText: sourceText,
      sourceMeta: sourceMeta || { type: 'text', files: [] },
      analysis: null,
      suggestions: null,
    };
    _persist();
    _runAnalyze();
  }

  function resume(saved) {
    if (!saved || !saved.stage) return false;
    session = saved;
    // 按当前阶段重新渲染 AI 提示（不重复调API）
    if (session.stage === 'S0' && session.analysis) _renderS0();
    else if (session.stage === 'S1') _renderS1();
    else if (session.stage === 'S2' && session.suggestions) _renderS2();
    else if (session.stage === 'S3') _renderS3();
    else if (session.stage === 'S4') _renderS4();
    else return false;
    return true;
  }

  function _clear() {
    session = null;
    Storage.OrganizeSession.clear();
  }

  // ========================================================
  //  S0：内容识别分析
  // ========================================================
  async function _runAnalyze() {
    var text = session.sourceText;
    if (text.length > 12000) text = text.substring(0, 12000) + '\n\n[内容过长，已截取前12000字]';

    var data = await Chat.apiRequest('/api/chat', {
      messages: [{ role: 'user', content: '请分析以下笔记内容：\n\n' + text }],
      mode: 'analyze',
    }, '🔍 正在分析内容');

    if (data.aborted) {
      Chat.addBubble('ai', '已停止分析 🛑 重新上传内容即可再来一次。');
      return;
    }
    if (data.error || !data.result) {
      Chat.addBubble('ai', '内容分析失败了 😅 可以点击输入框上方的「清空」重新开始，或直接重新导入。');
      return;
    }
    session.analysis = data.result || {};
    var p = session.plan;
    p.title = session.analysis.title || '';
    p.noteType = session.analysis.noteType || '';
    p.sourceSummary = session.analysis.summary || '';
    p.keyPoints = session.analysis.keyPoints || [];
    p.uncertainPoints = session.analysis.uncertain || [];
    _persist();
    _renderS0();
  }

  function _renderS0() {
    var p = session.plan;
    var html = '<div class="analyze-card">';
    html += '<div class="analyze-title">📋 ' + _esc(p.title || '未命名笔记') + '</div>';
    if (p.sourceSummary) html += '<div class="analyze-summary">' + _esc(p.sourceSummary) + '</div>';
    if (p.noteType) html += '<div class="analyze-type">笔记类型：<b>' + _esc(p.noteType) + '</b></div>';
    if (p.keyPoints && p.keyPoints.length) {
      html += '<div class="analyze-section-title">关键要点（' + p.keyPoints.length + '条）</div><ul class="analyze-points">';
      p.keyPoints.forEach(function(k) { html += '<li>' + _esc(k) + '</li>'; });
      html += '</ul>';
    }
    if (p.uncertainPoints && p.uncertainPoints.length) {
      html += '<div class="analyze-section-title uncertain">⚠️ 这几处可能识别不准</div><ul class="analyze-points uncertain-list">';
      p.uncertainPoints.forEach(function(u) { html += '<li>' + _esc(u) + '</li>'; });
      html += '</ul>';
    }
    html += '<div class="analyze-hint">类型或内容不对的话，直接打字告诉我修正 ✏️</div>';
    html += '</div>';

    Chat.addBubble('ai', html, ['识别没问题，继续 ✓', '有地方要纠正 ✏️'], null, true);
    session.stage = 'S0';
    _persist();
  }

  // ========================================================
  //  用户消息分发
  // ========================================================
  function handleUserMessage(text) {
    if (!session) return false;

    // 任何阶段：跳过指令
    if (SKIP_RE.test(text)) {
      _fastForward();
      return true;
    }

    switch (session.stage) {
      case 'S0': return _handleS0(text);
      case 'S1': return _handleS1(text);
      case 'S2': return _handleS2(text);
      case 'S3': return _handleS3(text);
      case 'S4': return _handleS4(text);
      default: return false;
    }
  }

  // ===== S0：确认或纠正 =====
  function _handleS0(text) {
    if (/没问题|对的|正确|继续|✓/.test(text)) {
      Chat.addBubble('ai', '好的 👌 接下来确认一下你的整理目的。');
    } else {
      session.plan.corrections = (session.plan.corrections ? session.plan.corrections + '；' : '') + text;
      Chat.addBubble('ai', '收到，已记下你的修正 ✓ 接下来确认一下你的整理目的。');
    }
    _persist();
    _renderS1();
    return true;
  }

  // ===== S1：明确目的 =====
  function _renderS1() {
    session.stage = 'S1';
    _persist();
    Chat.addBubble('ai',
      '你整理这份笔记是为了什么？',
      PURPOSES.slice(),
      null, false);
  }

  function _handleS1(text) {
    var purpose = text;
    for (var i = 0; i < PURPOSES.length; i++) {
      if (text.indexOf(PURPOSES[i]) >= 0) { purpose = PURPOSES[i]; break; }
    }
    session.plan.purpose = purpose;
    _persist();
    _runSuggest();
    return true;
  }

  // ===== S2：分点形式（AI推荐） =====
  async function _runSuggest() {
    var data = await Chat.apiRequest('/api/chat', {
      messages: [{ role: 'user', content: '请推荐整理形式' }],
      mode: 'suggest',
      extra: { purpose: session.plan.purpose, noteType: session.plan.noteType },
    }, '🧩 正在推荐结构');

    if (data.aborted) {
      Chat.addBubble('ai', '已停止 🛑 换个说法或重新选择目的即可继续。');
      return;
    }
    if (data.error || !data.result) { _fallbackFormats(); return; }
    session.suggestions = (data.result && data.result.formats) || [];
    if (!session.suggestions.length) { _fallbackFormats(); return; }
    _renderS2();
  }

  // 推荐接口失败时的本地兜底形式
  function _fallbackFormats() {
    session.suggestions = [
      { name: '分级大纲+重点加粗', reason: '层次清晰，适合快速回顾', preview: '## 一、主题\n- **要点1**\n  - 细节说明' },
      { name: '定义-特征-示例', reason: '概念型内容的经典结构', preview: '**定义**：……\n**特征**：……\n**示例**：……' },
      { name: '问答对', reason: '适合自测记忆', preview: '**Q：问题？**\nA：回答要点' },
    ];
    _renderS2();
  }

  function _renderS2() {
    session.stage = 'S2';
    _persist();

    var html = '<div class="format-suggest">';
    html += '<div class="format-suggest-title">考虑到你是为了<b>' + _esc(session.plan.purpose) + '</b>，我建议这几种结构：</div>';
    session.suggestions.forEach(function(f, idx) {
      html += '<div class="format-card" data-idx="' + idx + '">';
      html += '<div class="format-card-top"><span class="format-name">' + _esc(f.name) + '</span>';
      html += '<button class="format-pick-btn" data-idx="' + idx + '">选这个</button></div>';
      html += '<div class="format-reason">' + _esc(f.reason || '') + '</div>';
      if (f.preview) html += '<pre class="format-preview">' + _esc(f.preview) + '</pre>';
      html += '</div>';
    });
    html += '<div class="format-custom-hint">都不合适？直接打字描述你想要的结构 ✏️</div>';
    html += '</div>';

    var row = Chat.addBubble('ai', html, null, null, true);
    if (row) {
      row.querySelectorAll('.format-pick-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var f = session.suggestions[parseInt(this.dataset.idx, 10)];
          if (!f) return;
          // 禁用全部按钮，标记选中
          row.querySelectorAll('.format-pick-btn').forEach(function(b) { b.disabled = true; });
          row.querySelectorAll('.format-card').forEach(function(c) { c.classList.remove('picked'); });
          this.closest('.format-card').classList.add('picked');
          this.textContent = '已选择';
          _pickFormat(f.name);
        });
      });
    }
  }

  function _handleS2(text) {
    // 自由文本 = 自定义结构
    _pickFormat(text);
    return true;
  }

  function _pickFormat(name) {
    session.plan.format = name;
    Chat.addBubble('user', '用「' + name + '」的结构');
    _persist();
    setTimeout(_renderS3, 300);
  }

  // ===== S3：风格与深度（交互卡片） =====
  function _renderS3() {
    session.stage = 'S3';
    _persist();

    var html = '<div class="style-card">';
    html += '<div class="style-card-title">最后确认一下整理风格 ✨</div>';

    html += _chipGroup('详略程度', 'detailLevel', ['逐字保留', '适度精简', '高度提炼'], session.plan.detailLevel || '适度精简');
    html += _chipGroup('原文之外的知识补充', 'allowSupplement', ['不允许', '允许并标注', '自由补充'], session.plan.allowSupplement || '允许并标注');
    html += _chipGroup('原文的个人批注与疑问', 'keepAnnotations', ['保留', '剔除', '单独成段'], session.plan.keepAnnotations || '保留');

    html += '<button class="style-confirm-btn">确认风格 →</button>';
    html += '</div>';

    var row = Chat.addBubble('ai', html, null, null, true);
    if (row) {
      // chip 单选逻辑
      row.querySelectorAll('.style-chip-group').forEach(function(group) {
        group.querySelectorAll('.style-chip').forEach(function(chip) {
          chip.addEventListener('click', function() {
            group.querySelectorAll('.style-chip').forEach(function(c) { c.classList.remove('active'); });
            this.classList.add('active');
          });
        });
      });
      var confirmBtn = row.querySelector('.style-confirm-btn');
      confirmBtn.addEventListener('click', function() {
        var values = {};
        row.querySelectorAll('.style-chip-group').forEach(function(group) {
          var active = group.querySelector('.style-chip.active');
          if (active) values[group.dataset.key] = active.dataset.value;
        });
        session.plan.detailLevel = values.detailLevel || '适度精简';
        session.plan.allowSupplement = values.allowSupplement || '允许并标注';
        session.plan.keepAnnotations = values.keepAnnotations || '保留';
        confirmBtn.disabled = true;
        confirmBtn.textContent = '已确认 ✓';
        Chat.addBubble('user', '详略：' + session.plan.detailLevel + '｜补充：' + session.plan.allowSupplement + '｜批注：' + session.plan.keepAnnotations);
        _persist();
        setTimeout(_renderS4, 300);
      });
    }
  }

  function _chipGroup(label, key, options, selected) {
    var html = '<div class="style-chip-group" data-key="' + key + '">';
    html += '<div class="style-chip-label">' + _esc(label) + '</div><div class="style-chip-row">';
    options.forEach(function(opt) {
      html += '<button class="style-chip' + (opt === selected ? ' active' : '') + '" data-value="' + _esc(opt) + '">' + _esc(opt) + '</button>';
    });
    html += '</div></div>';
    return html;
  }

  function _handleS3(text) {
    // S3 主要靠交互卡片；自由文本尝试宽松解析，否则提示
    if (/保留|精简|提炼|逐字/.test(text)) {
      session.plan.detailLevel = /逐字/.test(text) ? '逐字保留' : (/提炼/.test(text) ? '高度提炼' : '适度精简');
    }
    if (/不允许|不要补充|别补充/.test(text)) session.plan.allowSupplement = '不允许';
    else if (/标注/.test(text)) session.plan.allowSupplement = '允许并标注';
    if (/剔除|去掉|删掉/.test(text)) session.plan.keepAnnotations = '剔除';
    else if (/单独|成段|集中/.test(text)) session.plan.keepAnnotations = '单独成段';
    else if (/保留/.test(text)) session.plan.keepAnnotations = '保留';
    Chat.addBubble('ai', '好的，已调整 ✓');
    _persist();
    setTimeout(_renderS4, 300);
    return true;
  }

  // ===== S4：方案回放确认 =====
  function _planRows() {
    var p = session.plan;
    return [
      { key: 'content', label: '📄 内容范围', value: p.sourceSummary || '—' },
      { key: 'noteType', label: '🗂 笔记类型', value: p.noteType || '未判断' },
      { key: 'purpose', label: '🎯 整理目的', value: p.purpose || '未选择' },
      { key: 'format', label: '🧩 结构形式', value: p.format || '未选择' },
      { key: 'detail', label: '✂️ 详略程度', value: p.detailLevel || '适度精简' },
      { key: 'supplement', label: '📎 知识补充', value: mapSupplement(p.allowSupplement) },
      { key: 'annotations', label: '✏️ 批注处理', value: p.keepAnnotations || '保留' },
    ];
    function mapSupplement(v) {
      if (v === '不允许') return '只基于原文';
      if (v === '自由补充') return '可自由补充';
      return '允许，补充处会标注';
    }
  }

  function _renderS4() {
    session.stage = 'S4';
    _persist();

    var html = '<div class="plan-sheet">';
    html += '<div class="plan-sheet-title">📋 整理方案单</div>';
    html += '<div class="plan-sheet-sub">确认后我就开始生成笔记</div>';
    _planRows().forEach(function(r) {
      html += '<div class="plan-row" data-key="' + r.key + '">';
      html += '<span class="plan-row-label">' + r.label + '</span>';
      html += '<span class="plan-row-value">' + _esc(r.value) + '</span>';
      html += '</div>';
    });
    if (session.plan.corrections) {
      html += '<div class="plan-row"><span class="plan-row-label">🖊 你的修正</span><span class="plan-row-value">' + _esc(session.plan.corrections) + '</span></div>';
    }
    html += '<div class="plan-sheet-actions">';
    html += '<button class="plan-confirm-btn">✓ 确认生成</button>';
    html += '<button class="plan-edit-btn">返回修改</button>';
    html += '</div>';
    html += '<div class="plan-sheet-hint">也可以直接打字说"改成高度提炼"这类修改意见</div>';
    html += '</div>';

    var row = Chat.addBubble('ai', html, null, null, true);
    if (row) {
      row.querySelector('.plan-confirm-btn').addEventListener('click', function() {
        this.disabled = true;
        this.textContent = '生成中...';
        Chat.addBubble('user', '确认，开始整理 ✓');
        _generate();
      });
      row.querySelector('.plan-edit-btn').addEventListener('click', function() {
        Chat.addBubble('ai', '想修改哪一项？', ['修改整理目的', '修改结构形式', '修改详略与风格'], null, false);
      });
    }
  }

  function _handleS4(text) {
    if (/确认|可以|没问题|生成|好/.test(text) && !/改|修|不是/.test(text)) {
      Chat.addBubble('user', '确认，开始整理 ✓');
      _generate();
      return true;
    }
    // 修改路由
    if (/目的/.test(text)) { _renderS1(); return true; }
    if (/形式|结构|大纲/.test(text)) { _renderS2(); return true; }
    if (/详略|精简|提炼|风格|补充|批注/.test(text)) {
      // 先应用修改再重新展示方案单
      _applyStyleText(text);
      Chat.addBubble('ai', '好的，已更新方案 ✓');
      setTimeout(_renderS4, 300);
      return true;
    }
    Chat.addBubble('ai', '可以点「确认生成」开始，或告诉我要改哪一项（如"改成高度提炼"）😊');
    return true;
  }

  function _applyStyleText(text) {
    if (/逐字/.test(text)) session.plan.detailLevel = '逐字保留';
    else if (/提炼/.test(text)) session.plan.detailLevel = '高度提炼';
    else if (/精简/.test(text)) session.plan.detailLevel = '适度精简';
    if (/不允许补充|不要补充|别补充/.test(text)) session.plan.allowSupplement = '不允许';
    if (/单独成段/.test(text)) session.plan.keepAnnotations = '单独成段';
    else if (/剔除|去掉批注/.test(text)) session.plan.keepAnnotations = '剔除';
    _persist();
  }

  // ===== 跳过：默认值直达生成 =====
  function _fastForward() {
    var p = session.plan;
    var profile = Storage.Profile.load();
    if (!p.purpose) p.purpose = profile.defaultPurpose || '考前复习';
    if (!p.format) p.format = '分级大纲+重点加粗';
    if (!p.detailLevel) p.detailLevel = '适度精简';
    if (!p.allowSupplement) p.allowSupplement = '允许并标注';
    if (!p.keepAnnotations) p.keepAnnotations = '保留';
    Chat.addBubble('ai', '好，用默认方案直接整理 🌿');
    _persist();
    _generate();
  }

  // ========================================================
  //  S5：生成笔记 + 提取知识点卡片
  // ========================================================
  async function _generate() {
    session.stage = 'S5';
    _persist();

    // 1. 生成笔记
    var data = await Chat.apiRequest('/api/chat', {
      messages: [{ role: 'user', content: '请按方案单生成笔记。' }],
      mode: 'generate',
      extra: { plan: session.plan, sourceText: session.sourceText },
    }, '✍️ 正在生成笔记');

    if (data.aborted) {
      session.stage = 'S4';
      _persist();
      Chat.addBubble('ai', '已停止生成 🛑 点方案单的「确认生成」可以随时再来。');
      return;
    }
    if (data.error || !data.result) {
      session.stage = 'S4';
      _persist();
      Chat.addBubble('ai', '生成失败了 😅 可能是网络问题，点方案单的「确认生成」再试一次。');
      return;
    }

    var result = data.result || { title: '未命名笔记', markdown: '' };

    // 2. 保存笔记实体
    var note = {
      id: 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      title: result.title || '未命名笔记',
      createdAt: new Date().toISOString(),
      markdown: result.markdown || '',
      sourceType: session.sourceMeta.type,
      sourceFiles: session.sourceMeta.files || [],
      sourceText: session.sourceText.substring(0, 8000),
      plan: session.plan,
      cardIds: [],
      reviewCount: 0,
      lastReviewedAt: null,
    };
    Storage.Notes.add(note);

    // 3. 提取知识点卡片（失败不影响笔记）
    var cards = [];
    try {
      cards = await _extractCards(note.markdown);
      cards.forEach(function(c) {
        c.id = 'card-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
        c.createdAt = note.createdAt;
        c.noteId = note.id;
        note.cardIds.push(c.id);
      });
      if (cards.length) {
        Storage.Echoes.addMany(cards);
        Storage.Notes.update(note.id, { cardIds: note.cardIds });
      }
    } catch (e) {
      console.warn('[Organize] extract cards failed:', e);
    }

    Storage.Analytics.track('note_generated', {
      noteId: note.id,
      purpose: session.plan.purpose,
      cardCount: cards.length,
    });

    _renderResult(note, cards);
    _clear();
    document.dispatchEvent(new CustomEvent('note:generated', { detail: { note: note, cards: cards } }));

    // 自动同步到飞书（开关开启时才生效；未授权时静默跳过，绝不弹窗）
    Feishu.autoSync(note.id);
  }

  async function _extractCards(markdown) {
    var data = await Chat.apiRequest('/api/chat', {
      messages: [{ role: 'user', content: '请从以下笔记中提取知识点卡片：\n\n' + markdown }],
      mode: 'extract',
    }, '🃏 正在析出知识点');
    if (data.aborted || data.error || !data.cards) return [];
    return data.cards || [];
  }

  function _renderResult(note, cards) {
    var html = '<div class="note-result">';
    html += '<div class="note-result-banner">✅ 笔记整理完成</div>';
    html += '<div class="note-result-title">📒 ' + _esc(note.title) + '</div>';
    html += '<div class="note-result-meta">' + _esc(note.plan.format) + ' · ' + _esc(note.plan.detailLevel) + (cards.length ? ' · 析出 ' + cards.length + ' 个知识点' : '') + '</div>';
    html += '<div class="note-result-actions">';
    html += '<button class="note-result-btn" data-action="view">查看笔记</button>';
    html += '<button class="note-result-btn" data-action="export">⬇️ 导出</button>';
    html += '<button class="note-result-btn secondary" data-action="feishu">📄 同步到飞书</button>';
    html += '<button class="note-result-btn" data-action="review">开始复盘</button>';
    html += '<button class="note-result-btn secondary" data-action="again">再整理一份</button>';
    html += '</div>';
    html += '</div>';

    var row = Chat.addBubble('ai', html, null, null, true);
    if (row) {
      row.querySelectorAll('.note-result-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var action = this.dataset.action;
          if (action === 'view') App.openNoteDetail(note.id);
          else if (action === 'export') Notes.exportNoteById(note.id);
          else if (action === 'feishu') Feishu.syncNote(note.id, { force: false });
          else if (action === 'review') App.startReview(note.id);
          else if (action === 'again') App.resetOrganize();
        });
      });
    }
  }

  // ========================================================
  //  工具
  // ========================================================
  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  return {
    isActive: isActive,
    start: start,
    resume: resume,
    handleUserMessage: handleUserMessage,
    getSession: getSession,
    clear: _clear,
  };
})();
