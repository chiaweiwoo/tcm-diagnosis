import path from "node:path";

function statusBadge(status) {
  const map = {
    success: ["#065f46", "#d1fae5", "成功"],
    "blocked-unexpected": ["#92400e", "#fef9c3", "意外阻断"],
    "blocked-not-triggered": ["#b42318", "#fff1ee", "阻断未触发"],
    failed: ["#b42318", "#fff1ee", "失败"],
    skipped: ["#374151", "#f3f4f6", "跳过"],
  };
  const [color, bg, label] = map[status] ?? ["#374151", "#f3f4f6", status];
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;background:${bg};color:${color}">${label}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdownToHtml(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const out = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^### /.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h4 style="margin:14px 0 4px;font-size:14px">${escapeHtml(line.slice(4))}</h4>`);
    } else if (/^## /.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h3 style="margin:18px 0 6px;font-size:16px;border-bottom:1px solid #e5e0db;padding-bottom:4px">${escapeHtml(line.slice(3))}</h3>`);
    } else if (/^# /.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h2 style="margin:20px 0 8px;font-size:18px">${escapeHtml(line.slice(2))}</h2>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul style="margin:6px 0;padding-left:20px">'); inList = true; }
      out.push(`<li style="margin:2px 0">${escapeHtml(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (!inList) { out.push('<ul style="margin:6px 0;padding-left:20px">'); inList = true; }
      out.push(`<li style="margin:2px 0">${escapeHtml(line.replace(/^\d+\. /, ""))}</li>`);
    } else if (line === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("<br>");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      const formatted = escapeHtml(line)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`(.+?)`/g, '<code style="background:#f7e7e3;padding:1px 5px;border-radius:3px;font-size:12px">$1</code>');
      out.push(`<p style="margin:4px 0">${formatted}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

// screenshotUrls: { "basename.png": "https://..." }
function buildScenarioCard(scenario, screenshotUrls) {
  const images = (scenario.screenshots ?? [])
    .map((p) => {
      const name = path.basename(p);
      const url = screenshotUrls?.[name];
      return url ? { name, url } : null;
    })
    .filter(Boolean);

  const sections = scenario.sectionsVisible?.length
    ? scenario.sectionsVisible.map((s) => `<span style="display:inline-block;margin:2px 3px;padding:2px 8px;background:#f7e7e3;border-radius:10px;font-size:12px">${escapeHtml(s)}</span>`).join("")
    : '<span style="color:#9f2f28;font-size:12px">无</span>';

  const screenshots = images.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        ${images.map((img) => `
          <div>
            <div style="font-size:11px;color:#66736e;margin-bottom:3px">${escapeHtml(img.name)}</div>
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name)}"
              style="height:160px;width:auto;border:1px solid #dbe5df;border-radius:6px;cursor:pointer;object-fit:cover"
              onclick="showLightbox(this.src)"
            />
          </div>`).join("")}
      </div>`
    : '<p style="color:#66736e;font-size:12px;margin-top:8px">无截图</p>';

  const warnings = scenario.warnings?.length
    ? `<div style="margin-top:8px;padding:8px 12px;background:#fff1ee;border-radius:6px;font-size:12px;color:#b42318">
        ${scenario.warnings.map((w) => `⚠ ${escapeHtml(w)}`).join("<br>")}
      </div>`
    : "";

  const meta = [
    scenario.elapsedMs ? `耗时：${(scenario.elapsedMs / 1000).toFixed(1)}s` : null,
    scenario.exampleId ? `样本：${scenario.exampleId}` : null,
    scenario.elapsedText ? `计时器：${scenario.elapsedText}` : null,
    scenario.modelLabel ? `模型标签：${scenario.modelLabel}` : null,
    scenario.blockedState ? `阻断原因：${escapeHtml(scenario.blockedReason ?? "—")}` : null,
  ].filter(Boolean).map((m) => `<span style="font-size:12px;color:#66736e;margin-right:16px">${m}</span>`).join("");

  return `
    <div style="background:#fffdf8;border:1px solid #dbe5df;border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <strong style="font-size:15px">${escapeHtml(scenario.name)}</strong>
        ${statusBadge(scenario.status)}
      </div>
      <div style="margin-bottom:8px">${meta}</div>
      <div style="margin-bottom:4px"><span style="font-size:12px;font-weight:700;color:#66736e;text-transform:uppercase;letter-spacing:.04em">可见板块</span></div>
      <div>${sections}</div>
      ${warnings}
      ${screenshots}
    </div>`;
}

function reviewerSection(title, reviewer) {
  if (!reviewer || reviewer.skipped) {
    return `
      <section style="margin-bottom:32px">
        <h2 style="font-size:18px;font-weight:800;margin-bottom:4px">${escapeHtml(title)}</h2>
        <p style="color:#66736e;font-size:13px">（已跳过或无内容）</p>
      </section>`;
  }
  return `
    <section style="margin-bottom:32px">
      <h2 style="font-size:18px;font-weight:800;margin-bottom:2px">${escapeHtml(title)}</h2>
      <p style="font-size:12px;color:#66736e;margin-bottom:12px">模型：${escapeHtml(reviewer.model)}</p>
      <div style="font-size:14px;line-height:1.75;color:#26322f">${renderMarkdownToHtml(reviewer.text)}</div>
    </section>`;
}

// screenshotUrls: { "basename.png": "https://..." }
export function buildHtmlReport(reportData, screenshotUrls = {}) {
  const { runId, generatedAt, baseUrl, scenarios, aggregate, reviewers, cleanup, selectedExamples } = reportData;

  const scenarioCards = scenarios.map((s) => buildScenarioCard(s, screenshotUrls));

  const summaryBadges = [
    `<span style="background:#d1fae5;color:#065f46;padding:3px 12px;border-radius:12px;font-weight:700;font-size:13px">成功 ${aggregate.success}</span>`,
    `<span style="background:#fef9c3;color:#92400e;padding:3px 12px;border-radius:12px;font-weight:700;font-size:13px">阻断 ${aggregate.blocked}</span>`,
    aggregate.failed > 0
      ? `<span style="background:#fff1ee;color:#b42318;padding:3px 12px;border-radius:12px;font-weight:700;font-size:13px">失败 ${aggregate.failed}</span>`
      : null,
  ].filter(Boolean).join(" ");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>前端评估报告 — ${escapeHtml(runId)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif; background: #f8f6f1; color: #26322f; line-height: 1.6; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
    .header { background: #9f2f28; color: white; padding: 28px 32px; border-radius: 14px; margin-bottom: 32px; }
    .header h1 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
    .header .meta { font-size: 13px; opacity: .8; }
    .section-title { font-size: 20px; font-weight: 800; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #dbe5df; }
    #lightbox { display:none; position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:1000; align-items:center; justify-content:center; cursor:pointer; }
    #lightbox img { max-width:92vw; max-height:92vh; border-radius:8px; box-shadow:0 8px 40px rgba(0,0,0,.5); }
  </style>
</head>
<body>
  <div class="wrap">

    <div class="header">
      <h1>前端评估报告</h1>
      <div class="meta">
        运行 ID：${escapeHtml(runId)} &nbsp;·&nbsp;
        ${new Date(generatedAt).toLocaleString("zh-CN")} &nbsp;·&nbsp;
        ${escapeHtml(baseUrl)}
      </div>
    </div>

    <section style="margin-bottom:32px">
      <h2 class="section-title">执行摘要</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${summaryBadges}</div>
      <p style="font-size:14px;color:#66736e">
        场景总数：${aggregate.total} &nbsp;·&nbsp;
        样本：${selectedExamples?.map((e) => e.id).join(", ") ?? "—"}
      </p>
      ${aggregate.warnings?.length ? `<div style="margin-top:10px;padding:10px 14px;background:#fff1ee;border-radius:8px;font-size:13px;color:#b42318">${aggregate.warnings.map((w) => `⚠ ${escapeHtml(w)}`).join("<br>")}</div>` : ""}
    </section>

    <section style="margin-bottom:32px">
      <h2 class="section-title">场景详情 + 截图</h2>
      ${scenarioCards.join("")}
    </section>

    <section style="margin-bottom:32px">
      <h2 class="section-title">评审意见</h2>
      ${reviewerSection("UX 流程评审（产品分析师视角）", reviewers?.ux)}
      ${reviewerSection("临床输出评审（资深中医师视角）", reviewers?.tcm)}
      ${reviewerSection("视觉评审（截图分析）", reviewers?.visual)}
    </section>

    <section>
      <h2 class="section-title">测试记录清理</h2>
      <p style="font-size:14px">
        尝试删除 ${cleanup?.attempted ?? 0} 条 &nbsp;·&nbsp;
        成功 ${cleanup?.succeeded ?? 0} 条
        ${cleanup?.failed?.length ? `&nbsp;·&nbsp;<span style="color:#b42318">失败：${cleanup.failed.map((f) => escapeHtml(f.id)).join(", ")}</span>` : ""}
      </p>
    </section>

  </div>

  <div id="lightbox" onclick="this.style.display='none'">
    <img id="lightbox-img" src="" alt="截图放大">
  </div>
  <script>
    function showLightbox(src) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox').style.display = 'flex';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.getElementById('lightbox').style.display = 'none';
    });
  </script>
</body>
</html>`;
}
