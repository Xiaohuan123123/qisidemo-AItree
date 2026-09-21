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

### 📄 同步到飞书（可选）
把笔记同步成飞书云文档。**同一篇笔记反复同步会原地更新，文档链接恒定**（评论、协作者、所在文件夹都保留）。

**接入步骤**（约 10 分钟）：

1. 访问 [open.feishu.cn](https://open.feishu.cn) → 创建**企业自建应用**（个人账号即可，自己就是管理员）
2. 「凭证与基础信息」记下 **App ID** / **App Secret**
3. 「权限管理」→ **切到「用户身份权限」页签**（切错成应用身份后面全是 403）开通：
   - `offline_access` ← 必须，否则拿不到 refresh_token，无法自动续期
   - `docx:document`（创建编辑文档）
   - `docx:document.block:convert` ← 必须，markdown 转换要用
   - `drive:drive`
4. 「安全设置 → 重定向 URL」添加：`http://localhost:3001/api/feishu-callback`
5. 「版本管理与发布」→ 创建版本 → 配置可用范围（含自己）→ 提交发布
6. 把 App ID / Secret 填入 `.env` 的 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，重启服务器

> ⚠️ **改过权限必须重新发版本**才生效——这是最常见的卡点。
> 不配置时同步按钮会提示未配置，其他功能不受影响。

**使用**：笔记详情页 / 笔记库卡片 / 生成结果气泡都有「📄 同步到飞书」按钮。首次点击会弹出飞书授权页，授权一次即可长期使用（token 自动续期）。设置页可开启「自动同步」，新笔记生成后自动同步。

> **已知边界**：飞书里手动改过的内容会被覆盖；笔记中的图片会转为文字链接；应用内单换行在飞书里不生效。

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
