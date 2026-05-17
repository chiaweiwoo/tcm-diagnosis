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

## AI 输出质量评估

两类按需评估，均由管理员手动触发：

**临床画像（per-doctor）** — 管理员在 `/admin/users/[doctorId]` → 临床画像 标签页点击"运行评估"，分析该医师近 14 天的病案输入习惯。结果仅供管理员参考。

**提示词评估（fleet-wide）** — 管理员在 `/admin/prompt-reviews` 点击"运行新审查"，对全体医师的 AI 输出进行系统审查，追踪提示词问题与改进效果。

批量运行：在 GitHub Actions → Evaluate Doctors → Run workflow 手动触发（可指定单个医师邮箱）。
