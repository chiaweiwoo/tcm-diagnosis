-- Add report_url to assessment_runs for Supabase Storage HTML report link
ALTER TABLE assessment_runs
  ADD COLUMN IF NOT EXISTS report_url text,
  ADD COLUMN IF NOT EXISTS triggered_by_detail text;

COMMENT ON COLUMN assessment_runs.report_url IS 'Supabase Storage public URL of the generated HTML report';
COMMENT ON COLUMN assessment_runs.triggered_by_detail IS 'E.g. assess:frontend or assess:backend';

-- Storage bucket: assessment-reports (public, 10MB limit, png/jpeg/html)
-- Create via Supabase dashboard or:
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('assessment-reports', 'assessment-reports', true, 10485760,
--         ARRAY['image/png', 'image/jpeg', 'text/html'])
-- ON CONFLICT (id) DO NOTHING;

-- Allow service_role to upload (already covered by service_role bypass)
-- Public read is enabled via bucket public=true
