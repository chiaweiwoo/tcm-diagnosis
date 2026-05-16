# 临床复核伙伴

> 面向中医师的临床工作台
> **Live: [tcm.chiawei.me](https://tcm.chiawei.me)**

医生填写结构化病案表单（9 个临床字段），系统即时给出中医临床复核建议，并自动保存可回顾的诊次历史。

结果以三栏呈现：判断（当前思路）/ 方案（建议优化）/ 随访监测，顶部附重点结论与风险提醒。记录可重新打开、修改、重新复核或删除。

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
| `POST /api/analyze` | 接收结构化病案表单，生成临床复核建议 |
| `GET /api/consultations` | 列出当前医师的历史记录 |
| `POST /api/consultations` | 新建病案记录 |
| `GET /api/consultations/[id]` | 读取单条病案 |
| `PATCH /api/consultations/[id]` | 更新表单数据、复核结果或记录名称 |
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

## 提示词改进的思路

这个系统服务于真实中医师，而开发者本身并非中医领域专家。这带来一个核心挑战：**如何在不具备专业判断力的前提下，持续提升 AI 输出的质量？**

我们的答案是：用 AI 做预处理，让专家只审关键。

每次评估运行真实病案，AI 评审员读完所有输出后，不是罗列指标，而是给出三层分析：每个病案单独打分、每个输出栏目跨病案找规律、最后综合成一份可操作的报告。报告里有两样东西特别重要：一是给医生看的简报（已经提炼好，不需要医生读原始输出）；二是给下一轮 AI 协作用的提示词改进方向（写清楚哪里有问题、建议怎么改）。

这样，开发者读完报告后，可以直接带着这份报告和 AI 讨论如何修改提示词，不需要重新解释背景。医生拿到的是一个具体问题而不是一堆输出，反馈成本低，愿意参与。

整个流程形成闭环：**评估 → 开发者与 AI 协作改提示词 → 重新评估 → 对比两次报告 → 有针对性地向医生确认** — 每一轮都比上一轮更聚焦，医生的时间只用在真正需要判断的地方。

这不是自动化测试，而是一个有意设计的协作节奏：AI 做功课，人做决策。

## 评估 CLI

流水线稳定性评估，分两步运行，结果存入 Supabase，可在 `/admin/assessments` 查看。

```bash
# 第一步（本地）：对 Vercel 部署运行所有样本，保存原始结果
ASSESS_BASE_URL=https://tcm.chiawei.me npm run assess:run

# 第二步（GitHub Actions）：读取原始结果，生成 DeepSeek 评审意见
# 在 Actions → Assess Review → Run workflow 填入 run_id
```

样本来源：`local-data/real-doctor-examples.md`（本地，不进仓库）。
