/**
 * 栖思 · 笔记整理工具 — 飞书云文档同步 API
 *
 * 认证：用户身份 OAuth（文档建在用户自己的云空间）
 * 覆盖策略：docx 块 API 原地重写，保留同一 document_id → 文档链接恒定
 *
 * 约束：本文件同时运行在本地 server.js（wrapRes 适配）与 Vercel，
 * 只能用两者交集的 API：
 *   可用 - res.status().json() / 原生 res.writeHead|end / req.url / req.body(仅POST)
 *   禁用 - req.query / res.redirect() / res.send() / req.cookies
 */

const client = require('./feishu-client');

function sendJSON(res, status, obj) {
  return res.status(status).json(obj);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise(function(resolve) {
    let raw = '';
    req.on('data', function(c) { raw += c; });
    req.on('end', function() {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', function() { resolve({}); });
  });
}

// 从 req.url 解析 query（不能用 req.query，本地 server.js 不提供）
function parseQuery(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams;
  } catch (e) {
    return new URLSearchParams();
  }
}

// 把飞书错误码翻译成可操作的中文提示
function friendlyError(err) {
  const code = err.code;
  const msg = String(err.message || '');
  const where = err.endpoint ? '（' + err.endpoint + '）' : '';

  if (err.status === 401 || /unauthorized|token/i.test(msg)) {
    return '飞书授权失效，请到「我的 → 设置」断开后重新连接';
  }
  if (err.status === 403 || /forbidden|permission/i.test(msg) || String(code) === '1061004') {
    return '飞书拒绝了操作：请确认应用已开通 docx:document、docx:document.block:convert、offline_access 权限，且已发布版本' + where;
  }
  if (err.status === 404 || String(code) === '1061003') {
    return '目标文档不存在（可能已被删除），可在设置中断开重连后再同步' + where;
  }
  if (code === 99991400 || err.status === 429) return '操作太频繁，请稍后重试';
  if (code === 20037) return '授权已失效，请重新授权';
  return (msg || '飞书接口调用失败') + where;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = parseQuery(req).get('action') || '';

  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
    return sendJSON(res, 503, {
      error: '飞书同步未配置：请在 .env 中设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET',
      code: 'NOT_CONFIGURED',
    });
  }

  try {
    switch (action) {
      case 'authorize':   return await handleAuthorize(req, res);
      case 'auth-status': return await handleAuthStatus(req, res);
      case 'logout':      return await handleLogout(req, res);
      case 'sync':        return await handleSync(req, res);
      default:
        return sendJSON(res, 400, { error: 'unknown action: ' + action });
    }
  } catch (err) {
    console.error('[Feishu] handler error:', err);
    return sendJSON(res, 500, { error: friendlyError(err), code: err.code || 'ERROR' });
  }
};

// ========================================================
//  action: authorize — 返回授权 URL（前端 window.open 打开）
// ========================================================
async function handleAuthorize(req, res) {
  return sendJSON(res, 200, { url: client.buildAuthorizeUrl() });
}

// ========================================================
//  action: auth-status — 只回传状态，绝不回显 token
// ========================================================
async function handleAuthStatus(req, res) {
  const token = await client.loadToken();
  const store = client.getTokenStore();
  return sendJSON(res, 200, {
    authorized: !!(token && token.refreshToken),
    storeType: store.type,
    persistent: store.persistent,
    hint: store.persistent ? null : '当前部署方式不支持持久化授权，服务重启后需重新授权（本地开发不受影响）',
  });
}

// ========================================================
//  action: logout
// ========================================================
async function handleLogout(req, res) {
  await client.clearToken();
  return sendJSON(res, 200, { ok: true });
}

// ========================================================
//  action: sync — 创建或原地重写飞书文档
// ========================================================
async function handleSync(req, res) {
  const body = await readBody(req);
  const { title, markdown, docId } = body;

  const md = preprocessMarkdown(markdown);
  if (md.length < 10) {
    return sendJSON(res, 400, { error: '笔记内容过短，无法同步' });
  }

  const token = await client.ensureFreshToken();
  if (!token) {
    return sendJSON(res, 401, { error: '未授权或授权已过期，请重新授权', code: 'UNAUTHORIZED' });
  }

  // 1. 确定目标文档：有 docId 复用（链接不变），否则新建
  let documentId = docId || null;
  let created = false;
  if (!documentId) {
    documentId = await client.createDocument(token, safeDocTitle(title));
    created = true;
  }

  try {
    // 2. 清空现有内容（首次新建时文档为空，跳过）
    if (!created) {
      await client.clearDocument(token, documentId);
    }
    // 3. markdown → blocks（飞书原生转换）
    const converted = await client.convertMarkdown(token, documentId, md);
    // 4. 分批插入
    await client.insertBlocks(token, documentId, converted);
  } catch (err) {
    // 新建失败时不留半个文档；复用文档失败时原内容已被清空，如实报错
    if (created) {
      try { await client.deleteFile(token, documentId); } catch (e) {}
    }
    // 完整诊断信息只进服务端日志，避免把内部细节抛给前端
    console.error('[Feishu] sync failed at', err.endpoint || '?', '| code:', err.code, '| status:', err.status);
    console.error('[Feishu] raw:', (err.raw || err.message || '').substring(0, 600));
    return sendJSON(res, 500, { error: friendlyError(err), code: err.code || 'SYNC_FAILED' });
  }

  return sendJSON(res, 200, {
    ok: true,
    docId: documentId,
    url: 'https://feishu.cn/docx/' + documentId,
    created: created,
  });
}

// ========================================================
//  Markdown 预处理
// ========================================================
function preprocessMarkdown(md) {
  let text = String(md || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  // 图片 → 可点击链接（飞书 API 无法直接插入正文图片，否则是空占位块）
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, function(m, alt, url) {
    return '[' + (alt ? '图片: ' + alt : '图片') + '](' + url + ')';
  });
  // 剥掉开头的 H1（飞书文档标题已承载它，否则标题出现两次）
  text = text.replace(/^\s*#\s+[^\n]*\n+/, '');
  return text.trim();
}

function safeDocTitle(title) {
  const t = String(title || '栖思笔记').replace(/[\r\n]+/g, ' ').trim();
  return (t.length > 200 ? t.substring(0, 200) : t) || '栖思笔记';
}

module.exports._internal = { preprocessMarkdown, safeDocTitle };
