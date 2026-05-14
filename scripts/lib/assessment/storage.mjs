import fs from "node:fs/promises";
import path from "node:path";

const BUCKET = "assessment-reports";

function getConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase credentials missing in .env.local");
  return { supabaseUrl, serviceKey };
}

export function getPublicUrl(remotePath) {
  const { supabaseUrl } = getConfig();
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${remotePath}`;
}

export async function uploadFile(remotePath, data, contentType) {
  const { supabaseUrl, serviceKey } = getConfig();
  const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${remotePath}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: data,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Storage upload failed for ${remotePath}: ${response.status} ${detail.slice(0, 200)}`);
  }

  return getPublicUrl(remotePath);
}

// Upload all screenshots for a run. Returns { basename: publicUrl }
export async function uploadScreenshots(runId, localPaths) {
  const urls = {};
  for (const localPath of localPaths) {
    const filename = path.basename(localPath);
    try {
      const data = await fs.readFile(localPath);
      const remotePath = `${runId}/screenshots/${filename}`;
      urls[filename] = await uploadFile(remotePath, data, "image/png");
    } catch (err) {
      console.error(`[storage] Failed to upload ${filename}: ${err.message}`);
      urls[filename] = null;
    }
  }
  return urls;
}

// Upload the HTML report and return its public URL
export async function uploadHtmlReport(runId, html) {
  const remotePath = `${runId}/frontend-report.html`;
  return uploadFile(remotePath, Buffer.from(html, "utf8"), "text/html");
}

// Patch report_url on an existing assessment_runs row
export async function saveReportUrl(runId, reportUrl) {
  const { supabaseUrl, serviceKey } = getConfig();
  const url = `${supabaseUrl}/rest/v1/assessment_runs?run_id=eq.${encodeURIComponent(runId)}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ report_url: reportUrl }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to update report_url: ${response.status} ${detail.slice(0, 200)}`);
  }
}
