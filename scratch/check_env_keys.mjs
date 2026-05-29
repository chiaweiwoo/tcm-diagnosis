console.log("Loading env keys...");
const keys = Object.keys(process.env);
const dbKeys = keys.filter(k => k.toLowerCase().includes("db") || k.toLowerCase().includes("sql") || k.toLowerCase().includes("postgres") || k.toLowerCase().includes("key") || k.toLowerCase().includes("url"));
console.log("Matching env keys found:", dbKeys);
