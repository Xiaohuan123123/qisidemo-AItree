/**
 * 栖思 · 笔记整理工具 — 飞书 API 客户端
 * 职责：token 存储与自动刷新、OAuth 辅助、docx 文档读写
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const ACCOUNTS_BASE = 'https://accounts.feishu.cn';

const APP_ID = () => process.env.FEISHU_APP_ID || '';
const APP_SECRET = () => process.env.FEISHU_APP_SECRET || '';
const REDIRECT_URI = () => process.env.FEISHU_REDIRECT_URI || 'http://localhost:3001/api/feishu-callback';

const SCOPE = 'offline_access docx:document docx:document.block:convert drive:drive';

// access_token 提前 5 分钟刷新，避免边界过期
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DESCENDANT_MAX_BLOCKS = 1000;

// ========================================================
//  Token 存储（三档：file / memory / auto）
// ========================================================
const TOKEN_FILE = path.join(__dirname, '..', '.feishu-token.json');
let _memoryToken = null;
let _storeType = null;     // 'file' | 'memory'
let _refreshing = null;    // 模块级 Promise，防止并发刷新（refresh_token 一次性）

function getStoreType() {
  if (_storeType) return _storeType;
  // 显式指定优先
  const forced = (process.env.FEISHU_TOKEN_STORE || '').toLowerCase();
  if (forced === 'memory') return (_storeType = 'memory');
  if (forced === 'file') return (_storeType = 'file');
  // 自动探测可写性：用 'a' 模式打开但**不写内容**（写内容会污染已有文件），
  // 打开失败（Vercel 只读文件系统 / EACCES）就降级到内存
  try {
    const fd = fs.openSync(TOKEN_FILE, 'a');
    fs.closeSync(fd);
    return (_storeType = 'file');
  } catch (e) {
    console.warn('[Feishu] token 文件不可写，降级为内存存储:', e.code);
    return (_storeType = 'memory');
  }
}

function getTokenStore() {
  const type = getStoreType();
  return { type: type, persistent: type === 'file' };
}

async function loadToken() {
  if (getStoreType() === 'memory') return _memoryToken;
  try {
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    if (!raw || !raw.trim()) return null;
    const token = JSON.parse(raw);
    // 结构校验：缺 accessToken 视为无效（文件损坏时绝不能把坏数据当有效 token）
    if (!token || !token.accessToken) {
      console.warn('[Feishu] token 文件结构无效，已清理');
      try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
      return null;
    }
    return token;
  } catch (e) {
    // JSON 解析失败（文件被写坏）或读取失败：清理并视作未授权，避免脏数据放大成难懂的报错
    console.warn('[Feishu] token 文件损坏，已清理:', e.message);
    try { fs.unlinkSync(TOKEN_FILE); } catch (e2) {}
    return null;
  }
}

async function saveToken(token) {
  if (getStoreType() === 'memory') {
    _memoryToken = token;
    return;
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf8');
}

async function clearToken() {
  _memoryToken = null;
  if (getStoreType() === 'file') {
    try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
  }
}

// ========================================================
//  OAuth：state 防 CSRF（HMAC 签名，零存储，适配 serverless）
// ========================================================
function makeState() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', APP_SECRET()).update(ts).digest('hex').substring(0, 32);
  return ts + '.' + sig;
}

function verifyState(state) {
  if (!state || typeof state !== 'string') return false;
  const parts = state.split('.');
  if (parts.length !== 2) return false;
  const [ts, sig] = parts;
  const expect = crypto.createHmac('sha256', APP_SECRET()).update(ts).digest('hex').substring(0, 32);
  // 恒定时间比较，避免时序侧信道
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  // 10 分钟时效
  const age = Date.now() - parseInt(ts, 10);
  return age >= 0 && age < 10 * 60 * 1000;
}

function buildAuthorizeUrl() {
  return ACCOUNTS_BASE + '/open-apis/authen/v1/authorize?' + new URLSearchParams({
    client_id: APP_ID(),
    response_type: 'code',
    redirect_uri: REDIRECT_URI(),
    scope: SCOPE,
    state: makeState(),
  }).toString();
}

// ========================================================
//  OAuth：授权码换 token / 刷新 token
// ========================================================
async function exchangeCode(code) {
  const res = await fetch(ACCOUNTS_BASE + '/oauth/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      code: code,
      redirect_uri: REDIRECT_URI(),
    }).toString(),
  });
  const data = await res.json();
  if (data.code !== 0 || !data.access_token) {
    throw new Error('换取 token 失败: ' + (data.error_description || data.msg || JSON.stringify(data)));
  }
  return normalizeToken(data);
}

async function refreshToken(oldRefresh) {
  const res = await fetch(ACCOUNTS_BASE + '/oauth/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      refresh_token: oldRefresh,
    }).toString(),
  });
  const data = await res.json();
  if (data.code !== 0 || !data.access_token) {
    const err = new Error('刷新 token 失败: ' + (data.error_description || data.msg || JSON.stringify(data)));
    err.code = data.code;
    throw err;
  }
  // 响应未带新 refresh_token 时保留旧的
  const normalized = normalizeToken(data);
  if (!normalized.refreshToken) normalized.refreshToken = oldRefresh;
  return normalized;
}

function normalizeToken(data) {
  const expiresIn = parseInt(data.expires_in || '7200', 10);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: data.scope || '',
  };
}

/**
 * 确保拿到可用的 access_token，必要时自动刷新。
 * 并发保护：多个请求同时到达时共用一个刷新 Promise
 * （refresh_token 一次性使用，并发刷新会让另一个实例的 token 作废）。
 */
async function ensureFreshToken() {
  const token = await loadToken();
  if (!token || !token.refreshToken) return null;

  if (Date.now() < token.expiresAt - REFRESH_MARGIN_MS) return token;

  if (!_refreshing) {
    _refreshing = (async function() {
      try {
        const fresh = await refreshToken(token.refreshToken);
        await saveToken(fresh);
        return fresh;
      } catch (err) {
        // 20037 / invalid_grant = refresh_token 已失效，清空存储强制重新授权
        if (String(err.message).indexOf('20037') >= 0 || /invalid_grant/i.test(err.message)) {
          await clearToken();
        }
        console.error('[Feishu] 刷新 token 失败:', err.message);
        return null;
      } finally {
        _refreshing = null;
      }
    })();
  }
  return _refreshing;
}

// ========================================================
//  通用请求
// ========================================================
async function feishuRequest(token, method, apiPath, body, query) {
  let url = FEISHU_BASE + apiPath;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
  }
  const opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + token.accessToken,
      'Content-Type': 'application/json; charset=utf-8',
    },
  };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const raw = await res.text();

  let data = null;
  try { data = JSON.parse(raw); } catch (e) { /* 非 JSON 响应 */ }

  // 响应不是预期的 {code,msg,data} 结构时，把原始内容带出来便于定位
  if (!data || typeof data.code === 'undefined') {
    const snippet = raw.substring(0, 300).replace(/\s+/g, ' ');
    const err = new Error('飞书返回了非预期响应 (HTTP ' + res.status + '): ' + snippet);
    err.status = res.status;
    err.endpoint = apiPath;
    err.raw = raw;
    throw err;
  }

  if (data.code !== 0) {
    const err = new Error(data.msg || ('飞书接口错误 code=' + data.code));
    err.code = data.code;
    err.status = res.status;
    err.endpoint = apiPath;
    err.raw = raw;
    throw err;
  }
  return data.data;
}

// ========================================================
//  docx 文档操作
// ========================================================

// 创建空文档 → document_id（根块 id 与 document_id 相同）
async function createDocument(token, title) {
  const data = await feishuRequest(token, 'POST', '/docx/v1/documents', { title: title });
  return data.document.document_id;
}

// 读取根块下的子块数量
async function getChildCount(token, documentId) {
  const data = await feishuRequest(
    token, 'GET', '/docx/v1/documents/' + documentId + '/blocks',
    null, { page_size: 500 }
  );
  const blocks = data.items || [];
  const root = blocks.find(function(b) { return b.block_id === documentId; });
  return root && root.children ? root.children.length : 0;
}

// 清空文档内容（保留文档本身，链接不变）
async function clearDocument(token, documentId) {
  const count = await getChildCount(token, documentId);
  if (count === 0) return;
  await feishuRequest(
    token, 'DELETE',
    '/docx/v1/documents/' + documentId + '/blocks/' + documentId + '/children/batch_delete',
    { start_index: 0, end_index: count },
    { document_revision_id: -1 }
  );
}

// markdown → blocks（飞书原生转换，无需手写转换器）
// 注意：官方路径是 documents/blocks/convert，不含 document_id。
// 第三方文档里常见的 documents/{document_id}/convert 会返回 404。
async function convertMarkdown(token, documentId, markdown) {
  const data = await feishuRequest(
    token, 'POST', '/docx/v1/documents/blocks/convert',
    { content: markdown, content_type: 'markdown' }
  );
  const rawBlocks = data.blocks || [];
  const rawFirstLevel = data.first_level_block_ids || [];

  // convert 返回的是**占位 ID**（表格单元格是 "row<uuid>col<uuid>" 这种拼接串），
  // 直接用于 descendant 插入会报 invalid param (1770001)。
  // 必须换成真实唯一 ID，并同步改写所有引用：parent_id / children / table.cells
  return remapBlockIds(rawBlocks, rawFirstLevel);
}

// 生成块 ID：与飞书客户端格式一致的 UUID v4
function newBlockId() {
  return crypto.randomUUID();
}

/**
 * 剔除服务端只读字段。
 * merge_info（表格合并单元格信息）由服务端生成，客户端传入会直接报
 * 400 invalid param (1770001) —— 实测确认它位于 table.property.merge_info，
 * table 顶层也一并清掉以防不同版本位置不同。
 */
function stripReadonlyFields(block) {
  if (!block || typeof block !== 'object') return;

  if (block.table) {
    delete block.table.merge_info;
    if (block.table.property) delete block.table.property.merge_info;
  }
  // parent_id 由插入位置决定，不能随块传入
  delete block.parent_id;
}

function remapBlockIds(rawBlocks, rawFirstLevel) {
  const idMap = {};

  // 第一遍：为每个块分配新 ID
  rawBlocks.forEach(function(b) {
    if (b && b.block_id) idMap[b.block_id] = newBlockId();
  });

  // 第二遍：改写所有 ID 引用，并剔除只读字段
  const blocks = rawBlocks.map(function(b) {
    const nb = Object.assign({}, b);
    if (idMap[b.block_id]) nb.block_id = idMap[b.block_id];

    if (nb.parent_id && idMap[nb.parent_id]) nb.parent_id = idMap[nb.parent_id];
    else delete nb.parent_id;   // 一级块的 parent 由插入位置决定，不能带

    if (Array.isArray(nb.children)) {
      nb.children = nb.children.map(function(cid) { return idMap[cid] || cid; });
    }

    // 表格：cells 换成单元格块的真实 ID
    if (nb.table && Array.isArray(nb.table.cells)) {
      nb.table.cells = nb.table.cells.map(function(cid) { return idMap[cid] || cid; });
    }
    // 只读字段 merge_info 必须剔除，否则插入报 400 invalid param (1770001)。
    // 注意它在 table.property.merge_info 下，不在 table 顶层——实测两种位置都清一遍。
    stripReadonlyFields(nb);

    return nb;
  });

  const firstLevelIds = rawFirstLevel.map(function(id) { return idMap[id] || id; });
  return { blocks: blocks, firstLevelIds: firstLevelIds };
}

// 分批插入块（descendant 接口单次上限 1000 个块）
async function insertBlocks(token, documentId, converted) {
  const { blocks, firstLevelIds } = converted;
  if (!blocks.length || !firstLevelIds.length) return;

  const byId = {};
  blocks.forEach(function(b) { byId[b.block_id] = b; });

  // 按一级块切分批次，保证每批（含子块）不超过上限
  const batches = [];
  let current = [];
  let currentCount = 0;

  for (const rootId of firstLevelIds) {
    const subtree = collectSubtree(byId, rootId);
    if (currentCount + subtree.length > DESCENDANT_MAX_BLOCKS && current.length) {
      batches.push(current);
      current = [];
      currentCount = 0;
    }
    current.push({ rootId: rootId, subtree: subtree });
    currentCount += subtree.length;
  }
  if (current.length) batches.push(current);

  for (const batch of batches) {
    const childIds = batch.map(function(b) { return b.rootId; });
    const descendants = [];
    batch.forEach(function(b) {
      b.subtree.forEach(function(blk) { descendants.push(blk); });
    });

    await feishuRequest(
      token, 'POST',
      '/docx/v1/documents/' + documentId + '/blocks/' + documentId + '/descendant',
      { children_id: childIds, descendants: descendants, index: -1 }
    );
    // 文档编辑限频约 3 次/秒，多批次之间留间隔
    if (batches.length > 1) await sleep(400);
  }
}

// 取某个块及其全部后代（含自身）
function collectSubtree(map, rootId) {
  const out = [];
  const seen = {};
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (seen[id]) continue;      // 防御性去重，避免异常数据造成死循环
    seen[id] = true;
    const blk = map[id];
    if (!blk) continue;
    out.push(blk);
    if (blk.children && blk.children.length) {
      blk.children.forEach(function(cid) { stack.push(cid); });
    }
  }
  return out;
}

// 删除文档（用于新建失败时清理，进入回收站）
async function deleteFile(token, documentId) {
  return feishuRequest(token, 'DELETE', '/drive/v1/files/' + documentId, null, { type: 'docx' });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

module.exports = {
  FEISHU_BASE, ACCOUNTS_BASE,
  getTokenStore, loadToken, saveToken, clearToken,
  ensureFreshToken,
  makeState, verifyState, buildAuthorizeUrl, exchangeCode,
  createDocument, getChildCount, clearDocument, convertMarkdown, insertBlocks, deleteFile,
  _internal: { normalizeToken, collectSubtree, remapBlockIds },
};
