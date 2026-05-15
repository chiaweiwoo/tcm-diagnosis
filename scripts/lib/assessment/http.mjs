export async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawText: text };
  }
}

function assessmentHeaders() {
  const key = process.env.ASSESSMENT_API_KEY;
  if (!key) throw new Error("ASSESSMENT_API_KEY is missing in .env.local");
  return {
    "Content-Type": "application/json",
    "X-Assessment-Key": key,
  };
}

export async function postJson(url, body) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: assessmentHeaders(),
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);

  return {
    ok: response.ok,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    payload,
  };
}
