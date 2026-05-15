/**
 * Fire-and-forget activity logging. Always call inside after() so it never
 * blocks a doctor-facing response. Never throws — failures are silently ignored.
 */

export type ActivityEventType = "login" | "organize" | "analyze";

export async function logActivity({
  doctorEmail,
  eventType,
  metadata,
}: {
  doctorEmail: string;
  eventType: ActivityEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/activity_logs`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        doctor_email: doctorEmail,
        event_type: eventType,
        metadata: metadata ?? null,
      }),
    });
  } catch {
    // Non-critical — never block the caller
  }
}
