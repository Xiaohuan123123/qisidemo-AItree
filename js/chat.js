/**
 * 栖思 · 笔记整理工具 — 对话模块
 * 三种会话：整理（Organize状态机驱动）/ 复盘（基于笔记自由对话）/ 自由对话
 * 导入链路：截图 → /api/vision 识别 → Organize；PDF/Word/Markdown → 本地解析 → Organize
 */
var Chat = (function() {
  'use strict';

  // ===== 状态 =====
  var chatHistory = [];       // 当前会话消息 [{role, content}]
  var sessionType = 'idle';   // idle | organize | review
  var reviewNote = null;      // 复盘中的笔记
  var isProcessing = false;
  var _abortController = null; // 当前请求的 AbortController
  var _thinkingRow = null;     // 内联思考气泡
  var _statusTimer = null;     // 渐进提示计时器
  var _pendingImages = [];    // 待发送的图片 [{base64, mimeType, dataUrl, name}]
  var _MAX_IMAGES = 9;
  var _IMG_MAX_EDGE = 1600;   // 图片压缩后的最长边
  var _REQ_TIMEOUT = 120000;  // 请求超时 120s

  var els = {};

  // ===== 初始化 =====
  function init() {
    console.log('[Chat] init start');
    try {
      els.emptyState = document.getElementById('emptyState');
      els.chatArea = document.getElementById('chatArea');
      els.chatMessages = document.getElementById('chatMessages');
      els.inputField = document.getElementById('inputField');
      els.sendBtn = document.getElementById('sendBtn');
      els.thinking = document.getElementById('thinkingIndicator');

      els.inputField.addEventListener('input', _onInput);
      els.inputField.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!isProcessing) sendMessage();
        }
      });
      // 发送/停止双模按钮
      els.sendBtn.addEventListener('click', function() {
        if (isProcessing) stopGeneration();
        else sendMessage();
      });

      // 图片/文件选择
      var imgInput = document.getElementById('imgFileInput');
      if (imgInput) {
        imgInput.addEventListener('change', function(e) {
          if (e.target.files && e.target.files.length) {
            _handleImageFiles(e.target.files);
          }
          imgInput.value = '';
        });
      }

      // Ctrl+V 粘贴图片
      document.addEventListener('paste', function(e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        var hasImage = false;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') >= 0) {
            if (!hasImage) { e.preventDefault(); hasImage = true; }
            var file = items[i].getAsFile();
            if (file) _handleImageFile(file, '粘贴图片');
          }
        }
      });

      _restoreState();
    } catch (e) {
      console.error('[Chat] init ERROR:', e);
    }
  }

  // ===== 会话恢复 =====
  function _restoreState() {
    // 1. 优先恢复整理会话
    var org = Storage.OrganizeSession.load();
    if (org && org.stage && org.stage !== 'S5') {
      sessionType = 'organize';
      _activateChatArea();
      if (!Organize.resume(org)) Storage.OrganizeSession.clear();
      return;
    }

    // 2. 恢复复盘/自由会话
    var saved = Storage.ChatState.load();
    if (saved && saved.history && saved.history.length > 0) {
      chatHistory = saved.history;
      sessionType = saved.sessionType || 'idle';
      if (sessionType === 'review' && saved.reviewNoteId) {
        reviewNote = Storage.Notes.get(saved.reviewNoteId);
        if (!reviewNote) sessionType = 'idle';
      }
      try { _renderHistory(); } catch (e) { console.error('[Chat] restore error:', e); }
    }
  }

  // ===== 文件处理 =====
  function _isDocFile(file) {
    var name = file.name.toLowerCase();
    return name.endsWith('.md') || name.endsWith('.markdown') ||
           name.endsWith('.doc') || name.endsWith('.docx') || name.endsWith('.pdf') ||
           name.endsWith('.txt');
  }

  function _handleImageFile(file, defaultName) {
    if (!file.type.startsWith('image/')) return;
    if (_pendingImages.length >= _MAX_IMAGES) {
      App._showToast('最多只能添加 ' + _MAX_IMAGES + ' 张图片');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      App._showToast('单张图片不能超过 15MB');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      _compressImage(e.target.result, function(dataUrl) {
        var base64 = dataUrl.split(',')[1];
        _pendingImages.push({ base64: base64, mimeType: 'image/jpeg', dataUrl: dataUrl, name: file.name || defaultName || '图片' });
        _renderImagePreviews();
        _onInput();
      });
    };
    reader.readAsDataURL(file);
  }

  // 压缩图片：长边压到 _IMG_MAX_EDGE，转 JPEG，降低识别 token 与传输量
  function _compressImage(dataUrl, cb) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      var scale = Math.min(1, _IMG_MAX_EDGE / Math.max(w, h));
      if (scale >= 1 && dataUrl.indexOf('image/jpeg') === 0) { cb(dataUrl); return; }
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      try {
        cb(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        console.warn('[Chat] compress failed, use original:', err);
        cb(dataUrl);
      }
    };
    img.onerror = function() { cb(dataUrl); };
    img.src = dataUrl;
  }

  function _handleImageFiles(files) {
    var names = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (_isDocFile(f)) {
        _handleDocFile(f);
      } else if (f.type.startsWith('image/')) {
        _handleImageFile(f);
        names.push(f.name || '图片' + (i + 1));
      } else {
        App._showToast('不支持的文件类型：' + f.name);
      }
    }
  }

  // ===== 文档解析（解析完成后直接进入整理流程） =====
  function _handleDocFile(file) {
    var name = file.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
      _readDocText(file, function(text) { _startOrganizeFromDoc(text, file); });
    } else if (name.endsWith('.pdf')) {
      _loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', function() {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        var reader = new FileReader();
        reader.onload = function(e) {
          window.pdfjsLib.getDocument({ data: e.target.result }).promise.then(function(pdf) {
            var pages = [];
            for (var i = 1; i <= pdf.numPages; i++) {
              pages.push(pdf.getPage(i).then(function(page) {
                return page.getTextContent().then(function(tc) {
                  return tc.items.map(function(item) { return item.str; }).join(' ');
                });
              }));
            }
            Promise.all(pages).then(function(texts) {
              _startOrganizeFromDoc(texts.join('\n\n'), file);
            });
          }).catch(function() { App._showToast('PDF 解析失败'); });
        };
        reader.readAsArrayBuffer(file);
      });
    } else if (name.endsWith('.doc') || name.endsWith('.docx')) {
      _loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', function() {
        var reader = new FileReader();
        reader.onload = function(e) {
          window.mammoth.extractRawText({ arrayBuffer: e.target.result }).then(function(result) {
            _startOrganizeFromDoc(result.value, file);
          }).catch(function() { App._showToast('Word 解析失败'); });
        };
        reader.readAsArrayBuffer(file);
      });
    }
  }

  function _readDocText(file, cb) {
    var reader = new FileReader();
    reader.onload = function(e) { cb(e.target.result); };
    reader.onerror = function() { App._showToast('文件读取失败'); };
    reader.readAsText(file);
  }

  function _startOrganizeFromDoc(text, file) {
    if (!text || text.trim().length < 10) {
      App._showToast('没从文件里读到有效文字');
      return;
    }
    if (text.length > 15000) text = text.substring(0, 15000);
    Storage.Analytics.track('import', { type: file.name.split('.').pop() });
    _activateChatArea();
    Chat.addBubble('ai', '📄 已解析文件「' + file.name + '」（' + text.length + '字），先看看我识别到的内容 👀');
    startOrganize(text, { type: 'file', files: [{ name: file.name, kind: file.name.split('.').pop() }] });
  }

  function _loadScript(url, cb) {
    var existing = document.querySelector('script[src="' + url + '"]');
    if (existing) { cb(); return; }
    var s = document.createElement('script');
    s.src = url;
    s.onload = cb;
    s.onerror = function() { App._showToast('解析组件加载失败，请检查网络'); };
    document.head.appendChild(s);
  }

  // ===== 图片预览 =====
  function _renderImagePreviews() {
    var area = document.getElementById('imgPreviewArea');
    var grid = document.getElementById('imgPreviewGrid');
    if (!area || !grid) return;

    if (_pendingImages.length === 0) {
      area.style.display = 'none';
      return;
    }
    area.style.display = '';
    grid.innerHTML = '';
    _pendingImages.forEach(function(img, idx) {
      var item = document.createElement('div');
      item.className = 'img-preview-item';
      var imgEl = document.createElement('img');
      imgEl.src = img.dataUrl;
      item.appendChild(imgEl);
      var removeBtn = document.createElement('button');
      removeBtn.className = 'img-remove';
      removeBtn.textContent = '✕';
      removeBtn.onclick = function() { removeImageAt(idx); };
      item.appendChild(removeBtn);
      grid.appendChild(item);
    });
  }

  function removeImageAt(idx) {
    _pendingImages.splice(idx, 1);
    _renderImagePreviews();
    _onInput();
  }

  function clearPendingImages() {
    _pendingImages = [];
    _renderImagePreviews();
    _onInput();
  }

  // ========================================================
  //  发送消息
  // ========================================================
  function sendMessage() {
    var text = els.inputField.value.trim();
    var hasImages = _pendingImages.length > 0;
    if ((!text && !hasImages) || isProcessing) return;

    // ===== 有图片：走截图识别链路 =====
    if (hasImages) {
      _sendImagesForOCR(text);
      return;
    }

    isProcessing = true;
    _addBubble('user', text);
    els.inputField.value = '';
    _onInput();

    // ===== 整理会话：交给状态机 =====
    if (sessionType === 'organize' || (typeof Organize !== 'undefined' && Organize.isActive())) {
      sessionType = 'organize';
      Storage.Analytics.track('organize_message', { stage: Organize.getSession() ? Organize.getSession().stage : '' });
      // 延迟一点，让用户气泡先渲染
      setTimeout(function() {
        isProcessing = false;
        Organize.handleUserMessage(text);
      }, 100);
      return;
    }

    // ===== 复盘 / 自由对话 =====
    chatHistory.push({ role: 'user', content: text });
    _saveState();
    _callDialogueAPI(text);
  }

  // ===== 统一 API 请求：中止 + 超时 + 内联思考气泡（OCR/对话/整理流程共用） =====
  async function apiRequest(url, body, thinkingText) {
    isProcessing = true;
    _updateSendBtn();
    _renderThinking(true, thinkingText || '💡 栖思正在思考');
    _startStatusTimer();
    _abortController = new AbortController();
    var timeout = setTimeout(function() {
      if (_abortController) _abortController.abort();
    }, _REQ_TIMEOUT);

    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: _abortController.signal,
      });
      clearTimeout(timeout);
      _stopStatusTimer();
      _renderThinking(false);
      if (!res.ok) {
        return { error: await res.text().catch(function() { return 'request failed'; }) };
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timeout);
      _stopStatusTimer();
      _renderThinking(false);
      if (err && err.name === 'AbortError') return { aborted: true };
      console.error('[Chat] request error:', err);
      return { error: 'network' };
    } finally {
      _abortController = null;
      isProcessing = false;
      _updateSendBtn();
    }
  }

  // ===== 截图 OCR =====
  async function _sendImagesForOCR(text) {
    var images = _pendingImages.slice();
    var names = images.map(function(i) { return i.name; });
    _addBubble('user', (text || '识别这些截图') + '\n🖼️ ' + names.join('、'), null, null, false, images.map(function(i) { return i.dataUrl; }));
    els.inputField.value = '';
    clearPendingImages();

    var data = await apiRequest('/api/vision', {
      images: images.map(function(i) { return { base64: i.base64, mimeType: i.mimeType }; }),
      userText: text || '',
    }, '🔍 正在识别截图');

    if (data.aborted) {
      _addBubble('ai', '已停止识别 🛑 可以重新上传，或换个方式导入。');
      return;
    }
    if (data.error) {
      var msg = String(data.error).indexOf('VISION_API_KEY') >= 0
        ? '截图识别还没配置 Key 😅 请在 .env 文件填入 VISION_API_KEY，或改用文字/PDF导入。'
        : '截图识别出错了 😅 请重试，或改用文字导入。';
      _addBubble('ai', msg);
      return;
    }

    var recognized = (data.text || '').trim();
    if (recognized.length < 10) {
      _addBubble('ai', '没从截图里识别出有效文字 🤔 试试更清晰的截图，或直接把文字粘贴给我。');
      return;
    }

    Storage.Analytics.track('import', { type: 'screenshot', count: images.length });
    _addBubble('ai', '👀 识别完成（' + recognized.length + '字），先看看我抓到的内容：');
    startOrganize(recognized, { type: 'screenshot', files: names.map(function(n) { return { name: n, kind: 'image' }; }) });
  }

  // ===== 对话 API（复盘/自由对话共用） =====
  async function _callDialogueAPI(text) {
    var mode = sessionType === 'review' ? 'review' : 'chat';
    var body = {
      messages: chatHistory.slice(-20),
      mode: mode,
    };
    if (mode === 'review' && reviewNote) {
      body.extra = { noteMarkdown: reviewNote.markdown };
    }

    var data = await apiRequest('/api/chat', body);

    if (data.aborted) { _showToast('已停止'); return; }
    if (data.error) {
      _addBubble('ai', '网络好像不太稳定，请稍后再试 🌐');
      return;
    }
    var reply = (data.reply || '').trim() || '嗯嗯，我在听，你继续说。';
    _addBubble('ai', reply);
    chatHistory.push({ role: 'assistant', content: reply });
    _saveState();
  }

  // ========================================================
  //  会话管理
  // ========================================================
  function startOrganize(sourceText, sourceMeta) {
    sessionType = 'organize';
    chatHistory = [];
    _saveState();
    Organize.start(sourceText, sourceMeta);
  }

  function startReview(note) {
    if (!note) return;
    sessionType = 'review';
    reviewNote = note;
    chatHistory = Storage.Reviews.getHistory(note.id) || [];
    _activateChatArea();
    _renderHistory();
    Storage.Reviews.recordReview(note.id);
    Storage.Notes.update(note.id, {
      reviewCount: Storage.Reviews.get(note.id).reviewCount,
      lastReviewedAt: Date.now(),
    });
    Storage.Analytics.track('review_start', { noteId: note.id });

    if (chatHistory.length === 0) {
      var opening = '好，我们来复盘「' + note.title + '」🌿 你可以问我笔记里的任何内容，也可以让我展开讲讲某个点。';
      _addBubble('ai', opening);
      chatHistory.push({ role: 'assistant', content: opening });
    }
    _saveState();
    document.dispatchEvent(new CustomEvent('note:updated', { detail: { noteId: note.id } }));
  }

  function endSession() {
    sessionType = 'idle';
    reviewNote = null;
    chatHistory = [];
    _saveState();
  }

  function _saveState() {
    Storage.ChatState.save({
      history: chatHistory,
      sessionType: sessionType,
      reviewNoteId: reviewNote ? reviewNote.id : null,
    });
    if (sessionType === 'review' && reviewNote) {
      Storage.Reviews.saveHistory(reviewNote.id, chatHistory);
    }
  }

  // 复盘中的笔记内容被更新时同步
  function refreshReviewNote() {
    if (sessionType === 'review' && reviewNote) {
      var fresh = Storage.Notes.get(reviewNote.id);
      if (fresh) reviewNote = fresh;
    }
  }

  // ===== 清空会话 =====
  function clearChat() {
    if (sessionType === 'review' && reviewNote) {
      Storage.Reviews.saveHistory(reviewNote.id, []);
    }
    chatHistory = [];
    sessionType = 'idle';
    reviewNote = null;
    isProcessing = false;
    if (typeof Organize !== 'undefined') Organize.clear();

    if (els.chatMessages) els.chatMessages.innerHTML = '';
    if (els.emptyState) els.emptyState.classList.remove('hidden');
    if (els.chatArea) els.chatArea.classList.remove('active');
    _renderThinking(false);
    clearPendingImages();

    Storage.ChatState.clear();
    Storage.Analytics.track('chat_clear', {});
  }

  // ===== 气泡渲染 =====
  function _addBubble(type, text, options, unused, isHTML, imageUrls) {
    if (els.emptyState) els.emptyState.classList.add('hidden');
    if (els.chatArea) els.chatArea.classList.add('active');

    var row = document.createElement('div');
    row.className = 'bubble-row ' + type;

    var avatar = document.createElement('div');
    avatar.className = 'bubble-avatar ' + (type === 'ai' ? 'ai-avatar' : 'user-avatar');
    avatar.textContent = type === 'ai' ? '🌳' : '🐻';
    row.appendChild(avatar);

    var bubbleWrap = document.createElement('div');
    bubbleWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;';

    if (imageUrls && imageUrls.length) {
      var imgGrid = document.createElement('div');
      imgGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;';
      imageUrls.forEach(function(url) {
        var imgEl = document.createElement('img');
        imgEl.src = url;
        imgEl.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid var(--border-light);';
        imgEl.onclick = function() { window.open(url, '_blank'); };
        imgGrid.appendChild(imgEl);
      });
      bubbleWrap.appendChild(imgGrid);
    }

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (isHTML) bubble.innerHTML = text;
    else bubble.textContent = text;
    bubbleWrap.appendChild(bubble);
    row.appendChild(bubbleWrap);

    if (options && options.length > 0) {
      var group = document.createElement('div');
      group.className = 'option-group';
      options.forEach(function(opt) {
        var btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;
        btn.addEventListener('click', function() { _selectOption(btn, opt); });
        group.appendChild(btn);
      });
      bubbleWrap.appendChild(group);
    }

    els.chatMessages.appendChild(row);
    requestAnimationFrame(function() {
      els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    });
    return row;
  }

  function _selectOption(btn, text) {
    btn.parentElement.querySelectorAll('.option-btn').forEach(function(b) {
      b.style.pointerEvents = 'none';
      b.style.opacity = '0.5';
    });
    btn.style.opacity = '1';
    btn.style.background = 'var(--primary)';
    btn.style.color = '#fff';
    btn.style.borderColor = 'var(--primary)';
    els.inputField.value = text;
    sendMessage();
  }

  function _renderHistory() {
    if (chatHistory.length === 0) return;
    if (els.emptyState) els.emptyState.classList.add('hidden');
    if (els.chatArea) els.chatArea.classList.add('active');
    if (els.chatMessages) els.chatMessages.innerHTML = '';
    chatHistory.forEach(function(msg) {
      if (msg.role === 'user') {
        _addBubble('user', msg.content);
      } else {
        _addBubble('ai', msg.content, null, null, false);
      }
    });
  }

  // ===== 内联思考气泡（替代悬浮提示） =====
  function _renderThinking(show, text) {
    if (show) {
      if (_thinkingRow) {
        _setThinkingText(text);
        return;
      }
      var row = document.createElement('div');
      row.className = 'bubble-row ai thinking-row';
      var avatar = document.createElement('div');
      avatar.className = 'bubble-avatar ai-avatar';
      avatar.textContent = '🌳';
      var bubble = document.createElement('div');
      bubble.className = 'bubble thinking-bubble';
      bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span><span class="thinking-label">' + (text || '💡 栖思正在思考') + '</span>';
      row.appendChild(avatar);
      row.appendChild(bubble);
      if (els.emptyState) els.emptyState.classList.add('hidden');
      if (els.chatArea) els.chatArea.classList.add('active');
      els.chatMessages.appendChild(row);
      requestAnimationFrame(function() {
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
      });
      _thinkingRow = row;
    } else {
      if (_thinkingRow && _thinkingRow.parentNode) _thinkingRow.parentNode.removeChild(_thinkingRow);
      _thinkingRow = null;
    }
  }

  function _setThinkingText(text) {
    if (_thinkingRow && text) {
      var label = _thinkingRow.querySelector('.thinking-label');
      if (label) label.textContent = text;
    }
  }

  // 渐进提示：等待久了更新文案，避免用户以为卡死
  function _startStatusTimer() {
    _stopStatusTimer();
    _statusTimer = setTimeout(function() {
      _setThinkingText('⏳ 还在处理中，内容较多请稍候…');
    }, 10000);
    _statusTimer2 = setTimeout(function() {
      _setThinkingText('⏳ 快好了，如果太久可以点停止按钮');
    }, 30000);
  }
  function _stopStatusTimer() {
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    if (_statusTimer2) { clearTimeout(_statusTimer2); _statusTimer2 = null; }
  }
  var _statusTimer2 = null;

  // ===== 停止生成 =====
  function stopGeneration() {
    if (_abortController) {
      _abortController.abort();
    }
  }

  // ===== 发送/停止按钮切换 =====
  var SEND_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>';
  var STOP_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  function _updateSendBtn() {
    if (!els.sendBtn) return;
    if (isProcessing) {
      els.sendBtn.disabled = false;
      els.sendBtn.classList.add('stop-mode');
      els.sendBtn.innerHTML = STOP_SVG;
      els.sendBtn.title = '停止';
    } else {
      els.sendBtn.classList.remove('stop-mode');
      els.sendBtn.innerHTML = SEND_SVG;
      els.sendBtn.title = '发送';
      _onInput();
    }
  }

  // ===== UI 状态 =====
  function _activateChatArea() {
    if (els.emptyState) els.emptyState.classList.add('hidden');
    if (els.chatArea) els.chatArea.classList.add('active');
  }

  function _onInput() {
    var hasText = els.inputField.value.trim().length > 0;
    // 处理中保持停止按钮可用
    els.sendBtn.disabled = isProcessing ? false : (!hasText && _pendingImages.length === 0);
  }

  // ===== 公开 API =====
  return {
    init: init,
    sendMessage: sendMessage,
    addBubble: _addBubble,
    showThinking: _renderThinking,
    apiRequest: apiRequest,
    startOrganize: startOrganize,
    startReview: startReview,
    endSession: endSession,
    refreshReviewNote: refreshReviewNote,
    clearChat: clearChat,
    stopGeneration: stopGeneration,
    clearPendingImages: clearPendingImages,
    removeImageAt: removeImageAt,
  };
})();
