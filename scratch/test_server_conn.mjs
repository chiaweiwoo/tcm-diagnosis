const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
console.log(`Checking connection to APP_BASE_URL: ${baseUrl}...`);

try {
  const res = await fetch(baseUrl, { method: "HEAD" });
  console.log(`✓ Connection successful! Status code: ${res.status}`);
} catch (err) {
  console.log(`✗ Connection failed: ${err.message}`);
  console.log(`Suggestion: We need to start the Next.js development server locally first.`);
}
