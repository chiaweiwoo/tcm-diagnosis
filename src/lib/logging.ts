type ErrorLogInput = {
  source: string;
  message: string;
  level?: "error" | "warn" | "info";
  details?: Record<string, unknown>;
};

export async function logServerEvent(input: ErrorLogInput) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(`[${input.source}] ${input.message}`, input.details ?? {});
    return;
  }

  try {
    await fetch(`${supabaseUrl}/rest/v1/error_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        source: input.source,
        level: input.level ?? "error",
        message: input.message,
        details: input.details ?? null,
      }),
    });
  } catch (error) {
    console.error("[logging] failed to write error log", error);
  }
}
