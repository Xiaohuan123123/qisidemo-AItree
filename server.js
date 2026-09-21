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

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const handleChat = require('./api/chat');
const handleVision = require('./api/vision');

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // API 路由
  if (req.url.split('?')[0] === '/api/chat' && req.method === 'POST') {
    req.body = await readBody(req).catch(() => ({}));
    return handleChat(req, wrapRes(res));
  }

  if (req.url.split('?')[0] === '/api/vision' && req.method === 'POST') {
    req.body = await readBody(req).catch(() => ({}));
    return handleVision(req, wrapRes(res));
  }

  // 静态文件（去除查询参数）
  let urlPath = req.url.split('?')[0];
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found: ' + req.url);
  }
});

server.listen(PORT, () => {
  console.log(`\n  🌱 栖思 · 笔记整理工具 已启动`);
  console.log(`  📍 http://localhost:${PORT}`);
  console.log(`  🔑 DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? '✅ 已配置' : '❌ 未配置（请创建 .env 文件）'}`);
  console.log(`  👁 VISION_API_KEY:   ${process.env.VISION_API_KEY ? '✅ 已配置' : '⚠️ 未配置（截图识别不可用，文字/PDF 导入不受影响）'}\n`);
});
