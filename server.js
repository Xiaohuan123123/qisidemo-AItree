/**
 * 栖思 · 笔记整理工具 — 本地开发服务器
 * 运行: node server.js
 * 访问: http://localhost:3001
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// 加载 .env（不依赖 dotenv）
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        process.env[key] = val;
      }
    });
  } catch (e) {}
}

loadEnv();

const PORT = 3001;

// 静态资源白名单：只允许这些目录下的这些扩展名
const STATIC_DIRS = ['js', 'css', 'assets'];
const STATIC_EXTS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.woff', '.woff2'];
const STATIC_ROOT_FILES = ['index.html'];

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const handleChat = require('./api/chat');
const handleVision = require('./api/vision');
const handleFeishu = require('./api/feishu');
const handleFeishuCallback = require('./api/feishu-callback');

// Vercel 风格 res 适配（api/*.js 使用 res.status().json()）
function wrapRes(res) {
  res.status = function(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function(obj) {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise(function(resolve, reject) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', function() {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ===== 静态文件安全校验 =====
// 静态服务只暴露 index.html 与 STATIC_DIRS 下的静态资源。
// 这挡住的是一类真实漏洞：原先 path.join(__dirname, url) 会让 /.env、
// /.feishu-token.json、/../ 穿越访问到任意文件（含 API Key 与用户凭证）。
function resolveStaticFile(urlPath) {
  // 拒绝含空字节 / 反斜杠的路径
  if (urlPath.indexOf('\0') >= 0 || urlPath.indexOf('\\') >= 0) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (e) {
    return null;
  }
  // 解码后再查一次，防止 %00 / %5c 绕过
  if (decoded.indexOf('\0') >= 0 || decoded.indexOf('\\') >= 0) return null;

  const segments = decoded.split('/').filter(Boolean);
  // 根路径与目录请求统一落到 index.html
  if (!segments.length) return path.join(__dirname, 'index.html');

  // 任何以 "." 开头的段（.env、.git、.feishu-token.json…）一律拒绝
  for (const seg of segments) {
    if (seg.startsWith('.')) return null;
  }
  if (segments.length > 1 && segments.some(s => s === '..')) return null;

  const ext = path.extname(decoded).toLowerCase();
  const isRootFile = segments.length === 1 && STATIC_ROOT_FILES.indexOf(segments[0]) >= 0;
  const isAssetFile = segments.length >= 2 &&
    STATIC_DIRS.indexOf(segments[0]) >= 0 &&
    STATIC_EXTS.indexOf(ext) >= 0;

  if (!isRootFile && !isAssetFile) return null;

  const fullPath = path.resolve(__dirname, decoded.replace(/^\/+/, ''));
  // 最终防线：解析后的绝对路径必须仍在项目目录内
  const rootPath = path.resolve(__dirname);
  if (fullPath !== rootPath && !fullPath.startsWith(rootPath + path.sep)) return null;

  return fullPath;
}

// ===== API 路由表 =====
const ROUTES = {
  '/api/chat': handleChat,
  '/api/vision': handleVision,
  '/api/feishu': handleFeishu,
  '/api/feishu-callback': handleFeishuCallback,
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const urlPath = req.url.split('?')[0];

  // API 路由（GET 也需要：OAuth 回调是浏览器重定向过来的）
  const handler = ROUTES[urlPath];
  if (handler) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.body = await readBody(req).catch(() => ({}));
    }
    return handler(req, wrapRes(res));
  }

  // 静态文件
  const filePath = resolveStaticFile(urlPath);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }

  try {
    const content = fs.readFileSync(filePath);
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  🌱 栖思 · 笔记整理工具 已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  🔑 DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? '✅ 已配置' : '❌ 未配置（请创建 .env 文件）'}`);
  console.log(`  👁 VISION_API_KEY:   ${process.env.VISION_API_KEY ? '✅ 已配置' : '⚠️ 未配置（截图识别不可用，文字/PDF 导入不受影响）'}`);
  const fsReady = process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET;
  console.log(`  📄 飞书同步:         ${fsReady ? '✅ 已配置' : '⚠️ 未配置（请设置 FEISHU_APP_ID / FEISHU_APP_SECRET）'}\n`);
});
