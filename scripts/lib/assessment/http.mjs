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

export async function postJson(url, body, { retries = 2, retryDelayMs = 2000 } = {}) {
  const startedAt = Date.now();
  let lastStatus;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }

    const response = await fetch(url, {
      method: "POST",
      headers: assessmentHeaders(),
      body: JSON.stringify(body),
    });
    lastStatus = response.status;

    // Retry on transient server errors only
    if (response.status >= 500 || response.status === 429) {
      if (attempt < retries) {
        console.warn(`[http] ${url} → ${response.status}, retrying (${attempt + 1}/${retries})…`);
        continue;
      }
    }

    const payload = await readJson(response);
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      payload,
    };
  }

  // Exhausted retries
  return {
    ok: false,
    status: lastStatus,
    latencyMs: Date.now() - startedAt,
    payload: { error: `Failed after ${retries} retries (last status: ${lastStatus})` },
  };
}
