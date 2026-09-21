/**
 * 栖思 · 笔记整理工具 — 对话 API（DeepSeek）
 * 模式：chat / review / analyze / suggest / generate / extract
 * System Prompt 统一来自 api/prompts.js
 */

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';

const { buildSystemPrompt } = require('./prompts');

// 从回复中提取 JSON 对象（容忍 markdown 包裹）
function parseJSON(reply, fallback) {
  const cleaned = String(reply || '').replace(/```json\s*|\s*```/g, '').trim();
  try { return Object.assign({}, fallback, JSON.parse(cleaned)); } catch (e) {}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return Object.assign({}, fallback, JSON.parse(objMatch[0])); } catch (e2) {}
  }
  return Object.assign({}, fallback);
}

// 从回复中提取 JSON 数组
function parseJSONArray(reply) {
  const cleaned = String(reply || '').replace(/```json\s*|\s*```/g, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) {}
  }
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, mode, extra } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });
  }

  const chatMode = mode || 'chat';
  const isJSONMode = ['analyze', 'suggest', 'generate', 'extract'].includes(chatMode);

  let systemPrompt = buildSystemPrompt(chatMode, extra);
  let finalMessages = messages;

  // review 模式：把笔记内容作为独立的上下文消息注入
  if (chatMode === 'review' && extra && extra.noteMarkdown) {
    finalMessages = [
      { role: 'system', content: '## 用户要复盘的笔记内容（Markdown）\n\n' + extra.noteMarkdown },
      ...messages,
    ];
  }

  // generate 模式：方案单 + 原文作为最后一条用户消息的一部分
  if (chatMode === 'generate' && extra && extra.plan && extra.sourceText) {
    const planJson = JSON.stringify(extra.plan, null, 2);
    finalMessages = messages.slice(0, -1).concat([{
      role: 'user',
      content: messages[messages.length - 1].content +
        '\n\n## 整理方案单\n' + planJson +
        '\n\n## 原始内容\n' + extra.sourceText,
    }]);
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...finalMessages,
        ],
        temperature: isJSONMode ? 0.3 : 0.7,
        max_tokens: isJSONMode ? 4096 : 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    // ===== 结构化 JSON 模式 =====
    if (chatMode === 'analyze') {
      const fallback = { title: '', summary: '', keyPoints: [], uncertain: [], noteType: '' };
      return res.status(200).json({ result: parseJSON(reply, fallback), usage: data.usage, model: MODEL });
    }

    if (chatMode === 'suggest') {
      const fallback = { formats: [] };
      const parsed = parseJSON(reply, fallback);
      return res.status(200).json({ result: { formats: parsed.formats || [] }, usage: data.usage, model: MODEL });
    }

    if (chatMode === 'generate') {
      const fallback = { title: '未命名笔记', markdown: String(reply || '') };
      const parsed = parseJSON(reply, fallback);
      return res.status(200).json({ result: { title: parsed.title || fallback.title, markdown: parsed.markdown || '' }, usage: data.usage, model: MODEL });
    }

    if (chatMode === 'extract') {
      const cards = parseJSONArray(reply);
      return res.status(200).json({ cards, usage: data.usage, model: MODEL });
    }

    // ===== 对话 / 复盘模式：纯文本回复 =====
    return res.status(200).json({ reply: String(reply || '').trim(), usage: data.usage, model: MODEL });
  } catch (error) {
    console.error('DeepSeek API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
