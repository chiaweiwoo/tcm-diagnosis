# 临床复核伙伴

> 面向中医师的临床工作台
> **Live: [tcm.chiawei.me](https://tcm.chiawei.me)**

把自由书写的病案草稿整理成结构化临床脉络，在分析深入前先验证资料完整性，再给出中医临床参考建议，并保存可回顾的诊次历史。

医生写下病情、当前处理与想确认的问题，系统先整理草稿、提示缺失资料，资料足够时继续给出判断与随访提醒。结果自动保存，可重新打开、修改、重新生成或删除。

## 技术栈

| 层 | 技术 |
|---|---|
| Frontend | Next.js + TypeScript，部署于 Vercel |
| UI | 自定义 CSS + lucide-react |
| AI | DeepSeek（服务端路由，仅后端调用）|
| 认证与数据 | Supabase（Google OAuth、允许名单、JSONB 病案存储、日志）|
| 测试与 CI | GitHub Actions + Vitest |

## API Routes

| Route | 用途 |
|---|---|
| `POST /api/organize` | 整理草稿，输出结构化病案与完整性提示 |
| `POST /api/analyze` | 生成临床复核建议 |
| `GET /api/consultations` | 列出当前医师的历史记录 |
| `POST /api/consultations` | 新建病案记录 |
| `GET /api/consultations/[id]` | 读取单条病案 |
| `PATCH /api/consultations/[id]` | 更新草稿、整理快照、复核结果或记录名称 |
| `DELETE /api/consultations/[id]` | 删除单条病案 |
| `GET /auth/callback` | Google OAuth 回调与允许名单验证 |
| `GET /auth/signout` | 登出并跳转登录页 |

## 本地开发

正常开发需要 Google OAuth。如需本地 UI 调试，可在 `.env.local` 启用开发绕过：

```env
DEV_AUTH_BYPASS=true
DEV_AUTH_EMAIL=you@example.com
```

绕过仍会校验允许名单，且在生产和预览环境永远无效。

参考 `.env.local.example` 配置所有必填环境变量（Supabase、DeepSeek API Key 等）。

```bash
npm install
npm run dev    # http://localhost:3000
npm run test   # Vitest
npm run build  # 本地构建验证
```

## 评估 CLI

流水线稳定性评估，分两步运行，结果存入 Supabase，可在 `/admin/assessments` 查看。

```bash
# 第一步（本地）：对 Vercel 部署运行所有样本，保存原始结果
ASSESS_BASE_URL=https://tcm.chiawei.me npm run assess:run

# 第二步（GitHub Actions）：读取原始结果，生成 DeepSeek 评审意见
# 在 Actions → Assess Review → Run workflow 填入 run_id
```

样本来源：`local-data/real-doctor-examples.md`（本地，不进仓库）。
