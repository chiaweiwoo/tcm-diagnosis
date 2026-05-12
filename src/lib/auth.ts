function parseAllowedEmails() {
  return (process.env.ALLOWED_DOCTOR_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedDoctorEmails() {
  return parseAllowedEmails();
}

export function isAllowedDoctorEmail(email?: string | null) {
  if (!email) return false;
  return parseAllowedEmails().includes(email.trim().toLowerCase());
}

export function normalizeDoctorEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}
