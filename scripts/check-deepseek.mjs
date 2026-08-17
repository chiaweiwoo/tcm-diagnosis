import fs from "node:fs";

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;

  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEEPSEEK_MODEL_FAST || process.env.DEEPSEEK_MODEL_DEEP || "deepseek-v4-flash";

if (!apiKey || apiKey.includes("your_")) {
  console.error("DEEPSEEK_API_KEY is missing in .env.local");
  process.exit(1);
}

const response = await fetch("https://api.deepseek.com/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: "你只返回合法JSON，不要解释。" },
      { role: "user", content: '请返回 {"状态":"成功"}' },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    temperature: 0,
    max_tokens: 400,
  }),
});

if (!response.ok) {
  console.error(`DeepSeek check failed: ${response.status}`);
  console.error((await response.text()).slice(0, 500));
  process.exit(1);
}

const payload = await response.json();
const content = payload.choices?.[0]?.message?.content ?? "";
if (!content.trim()) {
  console.error("DeepSeek returned empty content.");
  console.error(JSON.stringify({ model, usage: payload.usage, choices: payload.choices }, null, 2));
  process.exit(1);
}
const parsed = JSON.parse(content);

console.log(
  JSON.stringify(
    {
      status: parsed["状态"] === "成功" ? "ok" : "unexpected",
      model,
      usage: payload.usage,
    },
    null,
    2,
  ),
);
