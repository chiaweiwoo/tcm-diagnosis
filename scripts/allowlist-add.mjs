#!/usr/bin/env node
/**
 * scripts/allowlist-add.mjs
 *
 * Onboard or remove a doctor from the allowlist.
 *
 * Usage:
 *   node scripts/allowlist-add.mjs --email doctor@example.com [--admin]
 *   node scripts/allowlist-add.mjs --email doctor@example.com --remove
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.
 * Load via: node --env-file=.env.local scripts/allowlist-add.mjs ...
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    email:  { type: "string" },
    admin:  { type: "boolean", default: false },
    remove: { type: "boolean", default: false },
    yes:    { type: "boolean", default: false },
  },
  strict: true,
});

if (!values.email) {
  console.error("Error: --email is required");
  process.exit(1);
}

const email = values.email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Supabase admin client
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  console.error("Tip: node --env-file=.env.local scripts/allowlist-add.mjs ...");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Remove path
// ---------------------------------------------------------------------------

if (values.remove) {
  const { error } = await supabase
    .from("doctor_allowlist")
    .update({ is_active: false })
    .eq("email", email);

  if (error) {
    console.error(`Error deactivating ${email}:`, error.message);
    process.exit(1);
  }
  console.log(`✓ Deactivated ${email} (is_active=false). auth.users row preserved.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Add path
// ---------------------------------------------------------------------------

// 1. Check if auth.users row already exists
const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) {
  console.error("Error listing auth.users:", listError.message);
  process.exit(1);
}

let userId;
const existing = usersData.users.find((u) => u.email?.toLowerCase() === email);

if (existing) {
  userId = existing.id;
  console.log(`  auth.users row exists: ${userId}`);
} else {
  // 2. Create auth.users row (doctor signs in via Google OAuth later; Supabase matches by email)
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createError) {
    console.error("Error creating auth.users row:", createError.message);
    process.exit(1);
  }
  userId = created.user.id;
  console.log(`  Created auth.users row: ${userId}`);
}

// 3. Upsert into doctor_allowlist
const { error: upsertError } = await supabase
  .from("doctor_allowlist")
  .upsert(
    { email, is_active: true, is_admin: values.admin ?? false },
    { onConflict: "email" },
  );

if (upsertError) {
  console.error("Error upserting doctor_allowlist:", upsertError.message);
  process.exit(1);
}

console.log(`✓ ${email} added to allowlist (is_admin=${values.admin ?? false})`);
console.log(`  UUID: ${userId}`);
console.log(`  Doctor can sign in via Google OAuth — Supabase will match the existing row by email.`);
