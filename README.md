# 日新册 · RedShip

南开大学党史 RAG 智能体 —— 支持**快速问答**与**深度研究**双模式，全部能力通过 DashScope API 调用（无本地大模型），Docker Compose 一键部署。

## 功能概览

| 模式 | 说明 | 典型耗时 |
|------|------|----------|
| 快速问答 | Pipeline RAG：知识库混合检索 + 可选联网搜索 | &lt; 5 秒 |
| 深度研究 | 规划 → 并行联网检索/抽取 → 反思循环 → 报告生成 | 1–10 分钟 |

- **知识库**：`bibliography/` 目录增量摄入（SHA-256），Milvus 混合检索（Dense + BM25/jieba）→ qwen3-rerank 精排
- **文档智能**：小文档走 DashScope Files API；大文档走 MinerU 解析后会话级 Milvus RAG（无跨路径回退）
- **引用**：答案段落内嵌 `[(N)](/threads/.../citations/...)`，悬停预览

## 快速开始

### 1. 配置环境

```bash
cp .env.example .env
# 编辑 .env，填入 DASHSCOPE_API_KEY
```

### 2. 启动服务（7 个容器）

```bash
docker compose up -d --build
```

| 服务 | 端口 | 说明 |
|------|------|------|
| frontend | 8006 | Next.js 前端 |
| backend | 8005 | FastAPI 后端 |
| postgres | 5432 | 元数据 |
| redis | 6379 | 缓存 |
| milvus | 19530 | 向量库 |
| etcd / minio | — | Milvus 依赖 |

开发热重载：使用 `docker compose up`（会自动加载 `docker-compose.override.yml`）。

### 3. 访问

- 前端：http://localhost:8006
- API 文档：http://localhost:8005/docs
- 默认管理员：`admin@redship.local` / `ChangeMe!2026`（见 `.env`）

### 4. 导入文献

将 PDF / MD / DOCX 放入 `bibliography/`，然后：

- 管理页点击「增量同步」，或
- `POST /api/admin/bibliography/sync`

## 项目结构

```
RedShip/
├── bibliography/          # 可扩展知识库（挂载进容器）
├── backend/               # FastAPI + LangGraph 风格编排
├── frontend/              # Next.js + Tailwind（crimson/canvas 配色）
├── legacy/                # 归档说明（本次为原地重构）
├── docker-compose.yml
├── PLAN.md                # 完整设计方案
├── CHAT.md / RESPONSE.md / EMBEDDING.md / RERANK.md  # DashScope API 参考
└── .env.example
```

## 环境变量（核心）

```env
DASHSCOPE_API_KEY=sk-...
CHAT_MODEL=qwen3.6-plus
RESEARCH_MODEL=qwen3.6-plus
EMBEDDING_MODEL=text-embedding-v4
RERANK_MODEL=qwen3-rerank
RESEARCH_MAX_ITERATIONS=6
```

完整列表见 [`.env.example`](.env.example)。

## API 要点

| 路由 | 说明 |
|------|------|
| `POST /api/auth/login` | JWT 登录 |
| `POST /api/chat/stream` | SSE 双模式聊天 |
| `GET /api/knowledge/documents` | 知识库列表 |
| `POST /api/knowledge/documents/upload` | 管理员上传文档 |
| `POST /api/admin/bibliography/sync` | 增量同步 |
| `POST /api/admin/bibliography/reindex` | 全量重建索引 |
| `POST /api/threads/{id}/files` | 会话附件 |

## 技术栈

- **编排**：LangGraph StateGraph（Pipeline RAG + Deep Research），Redis checkpoint（`ckpt:{thread_id}`，7 天 TTL）
- **解析**：PDF/DOCX 仅 MinerU（`pipeline` CPU 后端）；MD/TXT 直接读取
- **向量库**：Milvus 2.5（Hybrid + RRFRanker）
- **关系库**：PostgreSQL 17 + Alembic
- **缓存**：Redis（LangGraph checkpoint、embedding 缓存、联网搜索缓存）
- **AI**：DashScope — Chat Completions、Responses API、Files API、Embedding、Rerank

## 详细设计

请参阅 [`PLAN.md`](PLAN.md) 获取架构图、Milvus Schema、SSE 事件格式与实施阶段说明。

## 代码注释约定

源码注释统一为**中文**，专有名词保留英文（LangGraph、Milvus、DashScope、SSE 等）。层次如下：

| 层级 | 要求 |
|------|------|
| 文件/模块 | 3–8 行：职责、上下游、与 PLAN 对应章节 |
| 类 / 导出类型 | 用途与生命周期 |
| 公共函数 / 路由 / Hook | `参数` / `返回` / `异常`（Python docstring 或 TS JSDoc） |
| 行内注释 | 仅标注非显而易见逻辑（路由分支、序列化、SSE 分帧等） |

**不写**：自解释赋值、纯 re-export 的 `__init__.py`、LLM 提示词正文（`prompts.py`）。

**Python 模板**（公共函数）：

```python
async def example(state: RagState) -> dict[str, Any]:
    """一句话职责说明。

    参数:
        state: 图状态，含 query、history 等字段。

    返回:
        写入图的状态片段。

    异常:
        ValueError: 失败原因。
    """
```

**TypeScript 模板**（导出函数）：

```typescript
/**
 * 一句话职责说明。
 * @param path - 相对或绝对 API 路径
 * @returns 解析后的 SSE 事件流
 */
```