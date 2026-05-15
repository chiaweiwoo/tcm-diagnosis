export type DoctorExample = {
  id: string;
  case_type_guess: string;
  topic_guess: string;
  draft: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return {
    baseUrl: `${supabaseUrl}/rest/v1/doctor_examples`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  };
}

export async function listDoctorExamples(): Promise<DoctorExample[]> {
  const config = getConfig();
  if (!config) return [];

  const url = new URL(config.baseUrl);
  url.searchParams.set("select", "id,case_type_guess,topic_guess,draft,is_active,created_at,updated_at");
  url.searchParams.set("order", "id.asc");

  const response = await fetch(url, { headers: config.headers, cache: "no-store" });
  if (!response.ok) return [];
  return (await response.json()) as DoctorExample[];
}
