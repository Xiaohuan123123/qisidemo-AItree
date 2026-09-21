/**
 * 栖思 · 笔记整理工具 — 截图识别 API（OpenAI 兼容多模态接口）
 * 环境变量：
 *   VISION_API_KEY   — 必填，视觉模型 API Key
 *   VISION_BASE_URL  — 默认 https://openai.zhipuai.cn/api/paas/v4（智谱），可切换 Qwen/豆包等兼容端点
 *   VISION_MODEL     — 默认 glm-4v-flash（免费档），可换 glm-4v-plus / qwen-vl-max 等
 */

const DEFAULT_BASE_URL = 'https://openai.zhipuai.cn/api/paas/v4';
const DEFAULT_MODEL = 'glm-4v-flash';

const OCR_PROMPT = '请识别以下笔记截图中的全部文字内容。要求：\n' +
  '1. 保留原文的层级结构和分段，用空行分隔\n' +
  '2. 标题、列表、重点标注尽量保留原格式（可用 Markdown 表示）\n' +
  '3. 识别不确定的字用[?]标注，不要猜测编造\n' +
  '4. 只输出识别出的文字内容本身，不要任何解释\n' +
  '5. 如果有多张图，按顺序用「---」分隔拼接';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { images, userText } = req.body || {};
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array required' });
  }

  const apiKey = process.env.VISION_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'VISION_API_KEY not configured. Add it to .env file.' });
  }

  const baseUrl = (process.env.VISION_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = process.env.VISION_MODEL || DEFAULT_MODEL;

  // 所有图片放一个请求（账号并发受限时合并请求最快），限流时自动重试
  const result = await _recognizeWithRetry(baseUrl, model, apiKey, images, userText);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  return res.status(200).json({ text: result.text || '', usage: null, model });
};

// 单请求识别全部图片，429 限流自动重试（最多3次，退避2s/5s）
async function _recognizeWithRetry(baseUrl, model, apiKey, images, userText) {
  const delays = [0, 2000, 5000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(function(r) { setTimeout(r, delays[attempt]); });
    const r = await _recognizeOnce(baseUrl, model, apiKey, images, userText);
    if (!r.error || !r.rateLimited) return r;
    console.warn('[Vision] rate limited, retry in', delays[attempt + 1] || 0, 'ms');
  }
  return { error: 'Vision API rate limit exceeded', status: 429 };
}

async function _recognizeOnce(baseUrl, model, apiKey, images, userText) {
  const content = [{ type: 'text', text: (userText ? userText + '\n\n' : '') + OCR_PROMPT }];
  images.forEach(function(img) {
    if (!img.base64 || !img.mimeType) return;
    content.push({ type: 'image_url', image_url: { url: 'data:' + img.mimeType + ';base64,' + img.base64 } });
  });

  try {
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      signal: AbortSignal.timeout(110000),
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: content }],
        // glm-4v-flash 上限 1024；其他模型默认 8192，可用 VISION_MAX_TOKENS 覆盖
        max_tokens: /glm-4v-flash/i.test(model)
          ? 1024
          : Math.min(parseInt(process.env.VISION_MAX_TOKENS || '8192', 10), 8192),
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      const rateLimited = response.status === 429 || err.indexOf('rate_limit') >= 0 || err.indexOf('concurrency') >= 0;
      return { error: err, status: response.status, rateLimited };
    }

    const data = await response.json();
    const choice = data.choices && data.choices[0];
    let text = choice && choice.message && choice.message.content;
    if (!text) return { error: 'Vision API returned empty content' };
    // glm-4v-flash 有时把换行转义成字面量 \n，还原为真实换行
    if (text.indexOf('\\n') >= 0) text = text.replace(/\\n/g, '\n');
    // 输出被 max_tokens 截断时打标记，让前端有机会提示
    if (choice.finish_reason === 'length') {
      return { text: text + '\n\n[识别结果过长被截断，建议减少单批截图数量]' };
    }
    return { text };
  } catch (error) {
    console.error('Vision API error:', error);
    if (error && error.name === 'TimeoutError') return { error: 'Vision API timeout', status: 504 };
    return { error: 'Internal server error' };
  }
}
