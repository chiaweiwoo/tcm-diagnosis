export async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawText: text };
  }
}

export async function postJson(url, body) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
