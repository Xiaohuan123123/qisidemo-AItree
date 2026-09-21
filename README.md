# 栖思 · 笔记整理工具（Demo 2.0 PC版）

> 📒 把小红书、公众号的碎片内容，整理成属于你的清爽笔记

## 🚀 快速开始

### 1. 配置环境变量
在项目根目录创建 `.env` 文件：

```bash
# 必填：对话/生成用模型（DeepSeek）
DEEPSEEK_API_KEY=sk-xxx

# 可选：截图识别用多模态模型（OpenAI 兼容接口，支持智谱GLM / 通义Qwen-VL / 豆包等）
VISION_API_KEY=xxx
VISION_BASE_URL=https://openai.zhipuai.cn/api/paas/v4
VISION_MODEL=glm-4v-flash
```

### 2. 启动
```bash
node server.js
```
访问 http://localhost:3001

> 不配 `VISION_API_KEY` 也能用：文字粘贴、PDF、Word、Markdown 导入不受影响，仅截图识别不可用。

## ✨ 核心流程

### 📥 笔记输入
- **截图导入**：小红书/公众号笔记截图（最多9张，可Ctrl+V粘贴），多模态模型OCR识别
- **文件导入**：PDF / Word / Markdown / 纯文本，本地解析
- **文字导入**：直接粘贴文字内容

### 💬 需求确认（至多5轮）
1. **识别确认**：AI展示摘要、要点、存疑处，用户确认或纠正
2. **明确目的**：考前复习 / 搭建知识体系 / 输出分享 / 单纯存档
3. **结构形式**：AI推荐2-3种形式（附排版预览），或自定义
4. **风格深度**：详略程度 / 是否补充原文外知识 / 批注处理
5. **方案回放**：结构化「整理方案单」逐条确认，可返回修改

> 任何阶段可发「跳过，直接整理」用默认方案直达生成。

### 📒 笔记输出
- 生成 Markdown 结构化笔记，存入笔记库
- 自动析出 1-5 个知识点卡片
- 支持导出 `.md` 文件

### 🌿 复盘
- 笔记详情页点「开始复盘」，基于笔记内容自由对话
- 可提问查证、让AI展开讲解、抽问检验记忆
- 复盘记录按笔记独立保存

## 📁 项目结构

```
demo2pc/
├── index.html          # 主页面（整理 / 笔记库 / 知识点 / 我的）
├── css/style.css       # 样式（三套主题）
├── js/
│   ├── app.js          # 主控制器
│   ├── chat.js         # 对话模块（整理/复盘/自由对话三会话）
│   ├── organize.js     # 整理状态机（S0-S5需求确认流程）
│   ├── notes.js        # 笔记库 + 笔记详情（Markdown渲染）
│   └── storage.js      # 存储层（localStorage）
├── api/
│   ├── chat.js         # DeepSeek 对话/生成 API
│   ├── vision.js       # 多模态截图识别 API
│   └── prompts.js      # 全部 System Prompt（单一来源）
├── server.js           # 本地开发服务器（端口3001）
└── vercel.json         # Vercel 部署配置
```

## 🛠️ 技术栈

- **前端**：原生 HTML/CSS/JavaScript + marked.js（Markdown渲染）
- **后端**：Node.js 原生 http（零依赖）
- **模型**：DeepSeek（对话/生成）+ OpenAI兼容多模态接口（截图OCR）
- **部署**：Vercel Serverless Functions

## 📄 License

MIT License

---

**开发者**：小欢
**GitHub**：[Xiaohuan123123](https://github.com/Xiaohuan123123)
