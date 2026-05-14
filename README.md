# 临床复核伙伴

面向中医师的临床工作台。把自由书写的病案草稿整理成结构化的临床脉络，在复核深入之前先提示资料完整性，再给出中医临床参考建议，并将诊次记录保存为可回顾的历史。

> 让医生看得更全，记得更准，面对难题时不再孤单。

作者：Woo Chia Wei

---

## 工作流程

1. 用 Google 账号登录，通过允许名单验证后进入工作台。
2. 按习惯写下病情、当前处理与想确认的问题。
3. 系统先整理草稿，提示资料完整性。
4. 资料足够时继续进入临床复核，给出判断、方案与随访提醒。
5. 结果自动保存；可重新打开、修改草稿、重新生成，或删除记录。

---

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

---

## 本地开发

正常开发仍需 Google OAuth。如需本地 UI 调试，可在 `.env.local` 启用开发绕过：

```env
DEV_AUTH_BYPASS=true
DEV_AUTH_EMAIL=chiaweiwoo123@gmail.com
```

绕过仍会校验允许名单，且在生产和预览环境下永远无效。

参考 `.env.local.example` 配置所有必填环境变量，包括 Supabase、DeepSeek API Key 和可选的 `AI_RATES_URL`。

---

## 评估 CLI

两个独立的评估轨道，均为本地 CLI 运行，不对外暴露。

**后端评估**（流水线稳定性）

```bash
npm run assess:backend
```

从 `local-data/real-doctor-examples.md` 读取真实医师案例，对每个案例运行 `organize → analyze` 流水线，并调用 DeepSeek 生成评审意见。报告写入 `output/assessment/<run-id>/`，运行记录存入 Supabase，可在 `/admin/assessments` 查看。

**前端评估**（浏览器交互）

```bash
npm run assess:frontend   # 第一步：浏览器运行 + 截图上传
npm run report:frontend   # 第二步：生成 HTML 报告
```

需要在 `.env.local` 配置 `ANTHROPIC_API_KEY`（Claude 视觉评审用）。随机抽取 3 个案例，用 Playwright 打开真实浏览器，运行成功路径、阻断场景与历史记录加载场景，并行调用三个评审员（DeepSeek UX、DeepSeek 中医临床、Claude 视觉），生成含截图的自包含 HTML 报告。

---

## 技术栈

- **Web App**：Next.js + TypeScript，部署于 Vercel
- **UI**：自定义 CSS + lucide-react
- **AI**：DeepSeek（服务端路由），Claude（评估 CLI 视觉评审）
- **认证与数据**：Supabase（Google OAuth、允许名单、JSONB 病案存储、日志）
- **测试**：`npm run test`（Vitest）、`npm run build`
