import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing DB credentials in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Resolve chiaweiwoo123@gmail.com ID
const { data: usersData } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

const user = usersData.users.find(
  (u) => u.email?.toLowerCase().trim() === "chiaweiwoo123@gmail.com",
);

if (user) {
  console.log(`Found user chiaweiwoo123@gmail.com with ID: ${user.id}`);
  
  // Delete from doctor_discussion_agenda
  const { error } = await supabase
    .from("doctor_discussion_agenda")
    .delete()
    .eq("doctor_id", user.id);

  if (error) {
    console.error("Failed to delete from doctor_discussion_agenda:", error.message);
  } else {
    console.log("Successfully deleted chiaweiwoo123@gmail.com discussion agenda from DB.");
  }
} else {
  console.log("User chiaweiwoo123@gmail.com not found.");
}
