/**
 * 栖思 · 笔记整理工具 — 飞书同步前端模块
 *
 * 独立请求层（不复用 Chat.apiRequest）：后者硬编码 POST、会锁全局 isProcessing
 * （用户在笔记页点同步会锁死聊天输入框）、思考气泡会插进聊天区。
 */
var Feishu = (function() {
  'use strict';

  var _syncing = {};       // per-note in-flight 锁 {noteId: true}
  var _authWindow = null;
  var _authStatusCache = null;

  var REQ_TIMEOUT = 180000;

  // ========================================================
  //  请求层
  // ========================================================
  async function request(url, body) {
    var ctrl = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, REQ_TIMEOUT);
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      var data = await res.json().catch(function() { return {}; });
      if (!res.ok) return { error: data.error || ('请求失败 ' + res.status), code: data.code };
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') return { error: '同步超时，请稍后重试' };
      return { error: '网络异常，请检查连接' };
    }
  }

  // ========================================================
  //  授权状态
  // ========================================================
  async function checkStatus(force) {
    if (!force && _authStatusCache) return _authStatusCache;
    var data = await request('/api/feishu?action=auth-status');
    _authStatusCache = data;
    return data;
  }

  function invalidateStatus() { _authStatusCache = null; }

  /**
   * 打开飞书授权窗口。
   * 策略：先拿到真实授权 URL，再直接 window.open(url)。
   * （开空白窗再改 location 的写法容易被 Chrome 静默拦截；
   *   若仍被拦截，则展示可手动点击的链接作为保底。）
   * @param {boolean} notify 失败时是否弹提示
   */
  async function openAuthWindow(notify) {
    var data = await request('/api/feishu?action=authorize');
    if (!data || !data.url) {
      if (notify !== false) App._showToast((data && data.error) || '无法获取授权链接');
      return null;
    }

    var win = window.open(data.url, 'feishu-auth', 'width=860,height=720,menubar=no,toolbar=no');
    if (win) {
      _authWindow = win;
      return win;
    }

    // 被拦截：给出可手动点击的链接，而不是只弹个提示让用户干瞪眼
    _showManualAuthLink(data.url);
    return null;
  }

  function _showManualAuthLink(url) {
    var old = document.getElementById('feishuManualAuth');
    if (old) old.remove();

    var box = document.createElement('div');
    box.id = 'feishuManualAuth';
    box.className = 'feishu-manual-auth';
    box.innerHTML =
      '<div class="feishu-manual-title">⚠️ 浏览器拦截了授权窗口</div>' +
      '<div class="feishu-manual-desc">点击下面的链接在飞书中完成授权；' +
      '也可以点击地址栏右侧的「弹窗被拦截」图标允许本站弹窗后重试。</div>' +
      '<a class="feishu-manual-link" href="' + _esc(url) + '" target="_blank" rel="noopener">👉 点此打开飞书授权页</a>' +
      '<button class="feishu-manual-close" onclick="document.getElementById(\'feishuManualAuth\').remove()">关闭</button>';
    document.body.appendChild(box);
  }

  // 回调页通过 postMessage 通知（比轮询 win.closed 更即时可靠）
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || d.type !== 'feishu-auth') return;
    if (_authWindow && !_authWindow.closed) {
      try { _authWindow.close(); } catch (err) {}
    }
    _authWindow = null;
    invalidateStatus();
    if (d.ok) {
      App._showToast('已连接飞书账号 ✅');
      document.dispatchEvent(new CustomEvent('feishu:auth-changed', { detail: { authorized: true } }));
    } else {
      App._showToast('授权未完成');
    }
  });

  // ========================================================
  //  同步
  // ========================================================
  function hashMarkdown(md) {
    // 轻量哈希，仅用于判断内容是否变化（非安全用途）
    var s = String(md || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return String(h) + ':' + s.length;
  }

  /**
   * 同步一篇笔记到飞书
   * @param {string} noteId
   * @param {object} opts { silent: 自动同步时静默失败 }
   */
  async function syncNote(noteId, opts) {
    opts = opts || {};
    var note = Storage.Notes.get(noteId);
    if (!note) { if (!opts.silent) App._showToast('笔记不存在'); return { error: 'not found' }; }

    if (_syncing[noteId]) return { error: '正在同步中' };

    // 内容未变则跳过（除非用户强制）
    var hash = hashMarkdown(note.markdown);
    if (!opts.force && note.feishuSyncedHash === hash && note.feishuDocId) {
      if (!opts.silent) App._showToast('内容没有变化，已是最新 ✅');
      return { skipped: true, url: note.feishuUrl };
    }

    _syncing[noteId] = true;
    _setButtonState(noteId, 'syncing');

    try {
      var status = await checkStatus();
      if (!status.authorized) {
        if (opts.silent) return { error: 'unauthorized' };
        // 未授权：引导授权后自动重试
        _syncing[noteId] = false;
        _setButtonState(noteId, 'idle');
        openAuthWindow().then(function(win) {
          if (win) App._showToast('请在弹出的窗口中完成飞书授权');
          var handler = function() {
            document.removeEventListener('feishu:auth-changed', handler);
            syncNote(noteId, opts);
          };
          document.addEventListener('feishu:auth-changed', handler);
        });
        return { error: 'unauthorized' };
      }

      var data = await request('/api/feishu?action=sync', {
        title: note.title,
        markdown: note.markdown,
        docId: note.feishuDocId || null,
      });

      if (data.error) {
        if (data.code === 'UNAUTHORIZED') invalidateStatus();
        if (!opts.silent) App._showToast('同步失败：' + data.error);
        return { error: data.error };
      }

      var patch = {
        feishuDocId: data.docId,
        feishuUrl: data.url,
        feishuSyncedAt: Date.now(),
        feishuSyncedHash: hash,
      };
      Storage.Notes.update(noteId, patch);
      Storage.Analytics.track('feishu_sync', { noteId: noteId, created: !!data.created });

      if (!opts.silent) App._showToast(data.created ? '已同步到飞书 📄' : '飞书文档已更新 📄');
      document.dispatchEvent(new CustomEvent('feishu:synced', { detail: { noteId: noteId, note: Storage.Notes.get(noteId) } }));
      return data;
    } finally {
      _syncing[noteId] = false;
      _setButtonState(noteId, 'idle');
    }
  }

  // 自动同步（生成笔记后调用）：未授权时静默跳过，绝不弹窗
  async function autoSync(noteId) {
    if (!isAutoSyncOn()) return;
    var status = await checkStatus();
    if (!status.authorized) return;
    return syncNote(noteId, { silent: true });
  }

  function isSyncing(noteId) { return !!_syncing[noteId]; }

  function _setButtonState(noteId, state) {
    document.querySelectorAll('[data-feishu-note="' + noteId + '"]').forEach(function(btn) {
      if (state === 'syncing') {
        btn.disabled = true;
        btn.classList.add('syncing');
        if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
        btn.textContent = '同步中…';
      } else {
        btn.disabled = false;
        btn.classList.remove('syncing');
        if (btn.dataset.origText) btn.textContent = btn.dataset.origText;
      }
    });
  }

  // ========================================================
  //  自动同步开关
  // ========================================================
  function isAutoSyncOn() {
    try { return localStorage.getItem('qisi3-feishu-autosync') === 'true'; } catch (e) { return false; }
  }

  function setAutoSync(on) {
    try { localStorage.setItem('qisi3-feishu-autosync', on ? 'true' : 'false'); } catch (e) {}
  }

  // ========================================================
  //  UI 片段
  // ========================================================

  // 生成「同步到飞书」按钮 HTML
  function syncButtonHTML(noteId, extraClass) {
    return '<button class="feishu-btn ' + (extraClass || '') + '" data-feishu-note="' + noteId + '" ' +
      'onclick="event.stopPropagation();Feishu.handleSyncClick(\'' + noteId + '\')">📄 同步到飞书</button>';
  }

  // 生成「已同步」标记 HTML（未授权/未同步返回空串）
  function syncBadgeHTML(note) {
    if (!note || !note.feishuUrl) return '';
    var stale = note.feishuSyncedHash && note.feishuSyncedHash !== hashMarkdown(note.markdown);
    return '<a class="feishu-badge" href="' + _esc(note.feishuUrl) + '" target="_blank" rel="noopener" ' +
      'onclick="event.stopPropagation()" title="在飞书中打开">' +
      (stale ? '📄 有改动待同步' : '📄 已同步') + '</a>';
  }

  function handleSyncClick(noteId) {
    syncNote(noteId, { force: false });
  }

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  return {
    syncNote: syncNote,
    autoSync: autoSync,
    handleSyncClick: handleSyncClick,
    checkStatus: checkStatus,
    invalidateStatus: invalidateStatus,
    openAuthWindow: openAuthWindow,
    isSyncing: isSyncing,
    isAutoSyncOn: isAutoSyncOn,
    setAutoSync: setAutoSync,
    syncButtonHTML: syncButtonHTML,
    syncBadgeHTML: syncBadgeHTML,
    hashMarkdown: hashMarkdown,
  };
})();
