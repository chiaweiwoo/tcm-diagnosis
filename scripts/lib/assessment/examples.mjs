import fs from "node:fs/promises";

const EXAMPLE_HEADING = /^##\s+(real-example-\d+)\s+\|\s+([^|]+?)\s+\|\s+(.+)$/gm;

// Parse examples from local .md file.
// Used only by assess:seed to populate the DB — not called during normal assess:run.
export async function parseExamplesFromFile(filePath) {
  const markdown = await fs.readFile(filePath, "utf8");
  const matches = Array.from(markdown.matchAll(EXAMPLE_HEADING));

  return matches.map((match, index) => {
    const headingEnd = match.index + match[0].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const body = markdown.slice(headingEnd, nextStart);
    const fenced = body.match(/```text\s*([\s\S]*?)```/);

    return {
      id: match[1].trim(),
      caseTypeGuess: match[2].trim(),
      topicGuess: match[3].trim(),
      draft: fenced?.[1]?.trim() ?? "",
    };
  });
}

// Load active examples from DB.
// Primary source for assess:run. Throws if table is empty — run assess:seed first.
export async function loadAssessmentExamples() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase credentials not set. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/doctor_examples?is_active=eq.true&order=id.asc&select=id,case_type_guess,topic_guess,draft`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to load examples from DB: ${response.status} ${detail.slice(0, 200)}`);
  }

  const rows = await response.json();

  if (!rows || rows.length === 0) {
    throw new Error(
      "No active examples found in DB.\n" +
      "Run: npm run assess:seed -- --file local-data/real-doctor-examples.md\n" +
      "This populates the doctor_examples table from your local .md file.",
    );
  }

  return rows.map((row) => ({
    id: row.id,
    caseTypeGuess: row.case_type_guess,
    topicGuess: row.topic_guess,
    draft: row.draft,
  }));
}
