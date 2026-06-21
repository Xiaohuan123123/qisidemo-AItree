# 栖思 - AI 学习成长助手（Demo 2.0 PC版）

> 🌳 面向大学生的长期学习成长 AI Agent

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env`，填入你的 API Key：
```bash
cp .env.example .env
# 编辑 .env 文件，填入 DEEPSEEK_API_KEY
```

### 3. 启动开发服务器
```bash
node server.js
```

访问 http://localhost:3001

## ✨ 核心功能

### 🎯 对话系统
- **轻聊模式**（随便聊聊）：轻松对话，快速获取建议
- **深度模式**（深入思考）：追问式对话，引导深度思考
- **流式输出**：实时显示 AI 回复
- **认知等级**：L1-L5 标签显示思考深度

### 🃏 知识卡片
- **自动生成**：对话结束自动生成知识卡片
- **手动提取**：点击按钮手动提取知识点
- **三维筛选**：按领域、深度、时间筛选
- **卡片详情**：触发问题、思考路径、顿悟、盲区

### 🌲 知识图谱
- **D3.js 力导向图**：可视化知识结构
- **自动建边**：AI 分析卡片关联，自动建立连接
- **5 种边类型**：前置、深入、关联、对比、组成
- **交互式**：拖拽、悬停、点击查看详情

### 📝 评价系统
- **4 维度评分**：思考深度、纯度、准确度、连贯性
- **综合建议**：针对最弱维度的改进建议
- **认知档案**：追踪学习成长轨迹

### 📚 叶脉笔记
- **笔记系统**：创建、编辑、删除笔记
- **AI 分析**：知识点提取、漏洞识别、学习建议
- **笔记转卡片**：从笔记生成知识卡片

### 🎨 用户体验
- **Onboarding**：7 步引导流程
- **三套主题**：活力、晨曦、深邃
- **响应式设计**：PC 端三栏布局

## 📁 项目结构

```
demo2pc/
├── index.html          # 主页面
├── css/style.css       # 样式文件
├── js/
│   ├── app.js          # 主控制器
│   ├── chat.js         # 对话模块
│   ├── evaluate.js     # 评价模块
│   ├── graph.js        # 图谱建边
│   ├── recommend.js    # 推荐模块
│   ├── storage.js      # 存储层
│   ├── trust.js        # 信任管理
│   └── vein.js         # 叶脉笔记
├── api/chat.js         # 后端 API
├── server.js           # 本地开发服务器
└── vercel.json         # Vercel 部署配置
```

## 🛠️ 技术栈

- **前端**：原生 HTML/CSS/JavaScript
- **图表**：D3.js
- **后端**：Node.js + Express
- **AI**：DeepSeek API
- **部署**：Vercel / EdgeOne Pages

## 📦 部署

### Vercel 部署
1. Fork 本仓库
2. 登录 [Vercel](https://vercel.com)
3. Import Git Repository
4. 添加环境变量 `DEEPSEEK_API_KEY`
5. 自动部署完成！

### 本地开发
```bash
# 安装依赖
npm install

# 启动服务器
node server.js

# 访问 http://localhost:3001
```

## 📝 开发日志

- ✅ Prompt Engineering 迭代：语气校准 + 追问规则
- ✅ 流式输出 + 模式差异化 + Markdown 渲染
- ✅ 知识图谱自动建边 + 用户自定义编辑
- ✅ 叶脉功能：AI 学习笔记系统
- ✅ 评价系统：4 维度量化评分
- ✅ 推荐系统：补缺/深入/拓展

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT License

---

**开发者**：小欢  
**邮箱**：836881606@qq.com  
**GitHub**：[Xiaohuan123123](https://github.com/Xiaohuan123123)
