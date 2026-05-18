# 小王刷题

小王刷题是一个本地优先的刷题工具，前端使用 React + Vite，后端使用 FastAPI + SQLite。它适合用来搭建个人或小团队的题库练习系统，支持账号、随机刷题、顺序刷题、错题本、收藏题、学习中心和管理平台。

> 公开仓库只包含刷题工具代码和少量示例题，不包含任何私有题库。正式题库请放在本地 `data/question_bank.json`，该文件已被 `.gitignore` 排除，不会被提交。

## 目录

- [截图](#截图)
- [功能概览](#功能概览)
- [技术栈](#技术栈)
- [快速启动](#快速启动)
- [默认账号](#默认账号)
- [题库数据](#题库数据)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [部署与运行](#部署与运行)
- [备份与恢复](#备份与恢复)
- [开发验证](#开发验证)
- [排错指南](#排错指南)
- [开源边界](#开源边界)
- [License](#license)

## 截图

### 登录

![登录页](docs/assets/screenshot-login.png)

### 随机刷题

![随机刷题](docs/assets/screenshot-random-practice.png)

### 学习中心

![学习中心](docs/assets/screenshot-learning-center.png)

### 管理平台

![管理平台](docs/assets/screenshot-admin-panel.png)

## 功能概览

### 账号系统

- 支持注册、登录、退出登录。
- 支持普通用户和管理员角色。
- 使用本地 SQLite 保存用户、会话和学习记录。
- 默认提供 `admin` 和 `demo` 两个账号，便于首次体验。

### 随机刷题

- 支持按单选、多选、判断题数量抽题。
- 默认示例练习为 `2/1/1`，即 2 道单选、1 道多选、1 道判断。
- 支持难度筛选。
- 单选题和判断题首次选择后自动进入下一题。
- 多选题由用户手动进入下一题。
- 支持返回上一题修改答案。
- 交卷后统一展示分数、答案、解析和来源。
- 未交卷时会保留随机练习草稿。

### 顺序刷题

- 按题库顺序逐题练习。
- 支持上一题、下一题。
- 支持跳转到指定题号。
- 已刷题目会记录进度。
- 再次进入时可继续未刷题目。
- 支持重置顺序刷题记录。

### 学习中心

- 总览：展示学习状态和复习入口。
- 错题本：集中查看最近答错且未掌握的题目。
- 我的收藏：集中查看主动收藏的重点题。
- 薄弱点：按章节、知识点和题型展示薄弱分布。
- 学习记录：查看最近作答情况。
- 支持重置学习中心数据。

### 管理平台

管理员登录后可进入管理平台：

- 总览：查看题库和用户数据概况。
- 题库管理：按题型、科目、难度、状态、来源和关键词筛选题目。
- 题目维护：新增、编辑、停用题目。
- 练习配置：创建并发布专项练习。
- 用户管理：查看用户、切换角色、启停账号、重置密码。
- 操作审计：记录关键管理操作。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19, Vite 6, lucide-react |
| 后端 | FastAPI, Pydantic, Uvicorn |
| 数据库 | SQLite |
| 包管理 | npm, pip |
| 运行方式 | 本地前端构建 + FastAPI 静态托管 |

## 快速启动

以下命令以 Windows PowerShell 为例。

### 1. 克隆仓库

```powershell
git clone https://github.com/versev999/XiaoWang-Tiku.git
cd XiaoWang-Tiku
```

### 2. 创建 Python 虚拟环境

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

### 3. 安装前端依赖

```powershell
cd .\frontend
npm install
cd ..
```

### 4. 构建前端

```powershell
cd .\frontend
npm run build
cd ..
```

### 5. 启动本地应用

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1
```

浏览器打开：

```text
http://127.0.0.1:8001/
```

## 默认账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `admin123456` |
| 演示用户 | `demo` | `demo123456` |

正式使用前，请登录管理平台修改默认密码。

## 题库数据

### 公开示例题库

仓库内置一个公开示例题库：

```text
data/question_bank.sample.json
```

它只用于演示数据结构和刷题流程，不对应任何正式考试内容。

如果 `data/question_bank.json` 不存在，后端会自动读取 `data/question_bank.sample.json`。

### 使用自己的私有题库

把你的私有题库放到：

```text
data/question_bank.json
```

然后重新启动后端服务即可。

该文件已被 `.gitignore` 排除，不会被提交到公开仓库。

### 题库字段

题库是一个 JSON 数组，每个题目对象建议包含以下字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 题目唯一 ID |
| `subject` | 科目 |
| `section` | 章节 |
| `type` | 题型，支持 `single`、`multiple`、`judgement` |
| `type_label` | 题型中文名 |
| `difficulty` | 难度 |
| `style_tag` | 出题方式标签 |
| `question` | 题干 |
| `option_a` 到 `option_e` | 选项内容，多选题建议只用 A-D，判断题只用 A/B |
| `answer` | 答案，如 `A`、`BD` |
| `answer_text` | 答案文字 |
| `explanation` | 解析 |
| `source_file` | 来源文件 |
| `source_page` | 来源页码或位置 |
| `source_excerpt` | 来源摘录 |
| `knowledge_point` | 知识点 |

### 最小示例

```json
[
  {
    "id": "DEMO-S-001",
    "subject": "示例科目",
    "section": "基础功能",
    "type": "single",
    "type_label": "单项选择题",
    "difficulty": "中上",
    "style_tag": "正向辨析",
    "question": "在本地刷题工具中，最适合用于保存个人学习进度的数据文件是（ ）。",
    "option_a": "本地 SQLite 运行时数据库",
    "option_b": "前端构建产物目录",
    "option_c": "浏览器缓存目录",
    "option_d": "项目说明文档",
    "option_e": "",
    "answer": "A",
    "answer_text": "A. 本地 SQLite 运行时数据库",
    "explanation": "学习记录、错题、收藏等运行数据适合写入本地数据库。",
    "source_file": "公开示例题库",
    "source_page": "demo",
    "source_excerpt": "示例题仅用于验证刷题流程。",
    "knowledge_point": "本地数据存储"
  }
]
```

## 项目结构

```text
.
├── backend/
│   ├── main.py                 # FastAPI API、认证、刷题、学习中心、管理平台逻辑
│   ├── public_main.py          # 生产模式静态文件托管入口
│   └── requirements.txt        # Python 依赖
├── data/
│   └── question_bank.sample.json
├── docs/
│   ├── assets/                 # README 截图
│   └── local_operations.md     # 本地运维说明
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx             # 主界面和业务交互
│       ├── adminQuestionForm.js
│       ├── main.jsx
│       ├── randomPracticeLogic.js
│       └── styles.css
├── scripts/
│   ├── backup_database.py
│   ├── check_admin_question_validation.mjs
│   ├── check_admin_v04_structure.mjs
│   ├── check_learning_center_v05_structure.mjs
│   ├── check_random_selection_logic.mjs
│   └── start_local.ps1
├── .gitignore
├── LICENSE
└── README.md
```

## 常用命令

### 前端开发服务器

适合只调试前端界面。后端仍需要另行启动。

```powershell
cd .\frontend
npm run dev
```

默认地址通常是：

```text
http://127.0.0.1:5173/
```

### 前端生产构建

```powershell
cd .\frontend
npm run build
```

构建产物会写入：

```text
frontend/dist/
```

该目录已被 `.gitignore` 排除。

### 后端 API 开发启动

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

API 文档：

```text
http://127.0.0.1:8000/docs
```

### 本地生产模式启动

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1
```

该脚本会：

1. 执行前端生产构建。
2. 停止占用目标端口的旧进程。
3. 使用 `backend.public_main:app` 启动 FastAPI。
4. 将前端构建产物由后端统一托管。

## 部署与运行

当前公开版默认面向本地运行。推荐先在本机确认以下内容：

- `http://127.0.0.1:8001/` 可以打开首页。
- 能使用 `demo / demo123456` 登录。
- 随机刷题能开始并交卷。
- 管理员能使用 `admin / admin123456` 登录管理平台。
- `data/app_state.sqlite` 已自动生成。

如需部署到服务器，建议：

- 使用 HTTPS 反向代理。
- 修改默认管理员密码。
- 不要把私有题库放入 Git 仓库。
- 定期备份 `data/app_state.sqlite`。
- 根据服务器实际路径调整启动脚本。

## 备份与恢复

### 备份本地数据库

```powershell
.\.venv\Scripts\python.exe .\scripts\backup_database.py backup
```

备份文件会写入：

```text
data/backups/
```

### 恢复本地数据库

恢复会覆盖当前本地数据库，必须显式加确认参数：

```powershell
.\.venv\Scripts\python.exe .\scripts\backup_database.py restore .\data\backups\app_state_YYYYMMDD_HHMMSS.sqlite --confirm-overwrite
```

## 开发验证

推荐在提交前执行：

```powershell
node .\scripts\check_random_selection_logic.mjs
node .\scripts\check_admin_question_validation.mjs
node .\scripts\check_admin_v04_structure.mjs
node .\scripts\check_learning_center_v05_structure.mjs
.\.venv\Scripts\python.exe -m py_compile .\backend\main.py .\backend\public_main.py .\scripts\backup_database.py
cd .\frontend
npm run build
cd ..
```

如果要快速验证后端示例题库是否能加载：

```powershell
.\.venv\Scripts\python.exe -c "from backend import main; print(len(main.QUESTIONS))"
```

预期输出为示例题库数量，例如：

```text
12
```

## 排错指南

### 1. `frontend build not found; run npm run build`

说明还没有构建前端。

执行：

```powershell
cd .\frontend
npm run build
cd ..
```

然后重新启动后端。

### 2. `Virtual environment python not found`

说明还没有创建 `.venv`。

执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

### 3. 端口 8001 被占用

可以指定其他端口：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1 -Port 8011
```

然后访问：

```text
http://127.0.0.1:8011/
```

### 4. 登录失败

确认是否使用了默认账号：

```text
admin / admin123456
demo / demo123456
```

如果已经修改过密码但忘记了，可以删除本地运行时数据库重新初始化：

```powershell
Remove-Item .\data\app_state.sqlite
powershell -ExecutionPolicy Bypass -File .\scripts\start_local.ps1
```

删除数据库会清空本地账号、学习记录、错题和收藏。

### 5. 私有题库没有生效

确认文件位置：

```text
data/question_bank.json
```

确认 JSON 是数组，并且每道题包含必要字段。修改题库文件后需要重启后端。

### 6. GitHub 上没有显示截图

确认截图文件已经提交：

```powershell
git ls-files docs/assets
```

README 使用的是相对路径，例如：

```markdown
![随机刷题](docs/assets/screenshot-random-practice.png)
```

## 开源边界

本仓库适合公开：

- 前端代码。
- 后端代码。
- 启动脚本。
- 备份脚本。
- README 截图。
- 非考试内容的示例题库。

不建议公开：

- `data/question_bank.json`
- `data/question_bank.csv`
- `data/*.xlsx`
- `data/app_state.sqlite`
- `data/backups/`
- 含真实用户数据或真实题库内容的截图。

相关忽略规则已经写入 `.gitignore`。如果你要重新生成题库或导入正式题库，请先确认 `git status --ignored` 中这些文件仍处于 ignored 状态。

## License

MIT
