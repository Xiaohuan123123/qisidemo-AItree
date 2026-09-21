/**
 * 栖思 · 笔记整理工具 — 飞书 OAuth 回调
 *
 * 独立文件（不放在 feishu.js 的 action 分支里），原因：
 *   1. 重定向 URL 需要是一条干净路径，带 query 会有匹配歧义
 *   2. 浏览器跳转过来要返回 HTML 页面，与 JSON API 职责完全不同
 */

const client = require('./feishu-client');

function html(title, body, script) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><style>' +
    'body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;' +
    'background:#f7f6f2;color:#2d2d2d}' +
    '.card{text-align:center;padding:40px 48px;background:#fff;border-radius:18px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:420px}' +
    '.icon{font-size:44px;margin-bottom:14px}' +
    'h1{font-size:18px;margin:0 0 10px;font-weight:600}' +
    'p{font-size:14px;color:#888;line-height:1.7;margin:0}' +
    'a{display:inline-block;margin-top:20px;padding:9px 22px;background:#7a8b4a;color:#fff;' +
    'border-radius:10px;text-decoration:none;font-size:14px}' +
    '</style></head><body><div class="card">' + body + '</div>' +
    (script ? '<script>' + script + '</script>' : '') + '</body></html>';
}

function sendHTML(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let params;
  try {
    params = new URL(req.url, 'http://localhost').searchParams;
  } catch (e) {
    params = new URLSearchParams();
  }

  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  // 用户在飞书侧拒绝授权
  if (error) {
    return sendHTML(res, 200, html('授权已取消',
      '<div class="icon">🚫</div><h1>授权已取消</h1>' +
      '<p>你没有完成授权，可以关闭本页返回应用重试。</p>' +
      '<a href="javascript:window.close()">关闭本页</a>',
      'try{window.opener&&window.opener.postMessage({type:"feishu-auth",ok:false,reason:"cancelled"},"*")}catch(e){}'
    ));
  }

  if (!code) {
    return sendHTML(res, 400, html('授权失败',
      '<div class="icon">⚠️</div><h1>缺少授权码</h1><p>请返回应用重新点击「同步到飞书」。</p>' +
      '<a href="javascript:window.close()">关闭本页</a>',
      'try{window.opener&&window.opener.postMessage({type:"feishu-auth",ok:false,reason:"no-code"},"*")}catch(e){}'
    ));
  }

  // 校验 state（防授权码注入）
  if (!client.verifyState(state)) {
    return sendHTML(res, 400, html('授权失败',
      '<div class="icon">🔒</div><h1>授权校验未通过</h1>' +
      '<p>state 校验失败，可能是链接已过期（超过 10 分钟）或来源异常。<br>请返回应用重新发起授权。</p>' +
      '<a href="javascript:window.close()">关闭本页</a>',
      'try{window.opener&&window.opener.postMessage({type:"feishu-auth",ok:false,reason:"bad-state"},"*")}catch(e){}'
    ));
  }

  try {
    const token = await client.exchangeCode(code);
    await client.saveToken(token);

    return sendHTML(res, 200, html('授权成功',
      '<div class="icon">✅</div><h1>授权成功</h1>' +
      '<p>已连接到你的飞书账号，本页会自动关闭。<br>若没有自动关闭，请手动关闭并返回应用。</p>' +
      '<a href="javascript:window.close()">关闭本页</a>',
      'try{window.opener&&window.opener.postMessage({type:"feishu-auth",ok:true},"*")}catch(e){}' +
      'setTimeout(function(){try{window.close()}catch(e){}},1200);'
    ));
  } catch (err) {
    console.error('[Feishu] 换取 token 失败:', err.message);
    const detail = String(err.message || '').replace(/[<>]/g, '');
    return sendHTML(res, 500, html('授权失败',
      '<div class="icon">⚠️</div><h1>授权失败</h1>' +
      '<p>' + detail + '</p><p style="margin-top:8px">请检查 .env 中的 FEISHU_APP_ID / FEISHU_APP_SECRET 与重定向 URL 配置。</p>' +
      '<a href="javascript:window.close()">关闭本页</a>',
      'try{window.opener&&window.opener.postMessage({type:"feishu-auth",ok:false,reason:"exchange-failed"},"*")}catch(e){}'
    ));
  }
};
