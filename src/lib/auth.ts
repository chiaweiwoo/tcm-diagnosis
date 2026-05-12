const allowedEmails = (process.env.ALLOWED_DOCTOR_EMAILS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export function getAllowedDoctorEmails() {
  return allowedEmails;
}

export function isAllowedDoctorEmail(email?: string | null) {
  if (!email) return false;
  return allowedEmails.includes(email.trim().toLowerCase());
}
