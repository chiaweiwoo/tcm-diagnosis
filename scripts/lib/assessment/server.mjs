import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 90_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // keep waiting
    }

    await sleep(1_000);
  }

  throw new Error(`Local app did not become ready within ${timeoutMs}ms.`);
}

async function looksLikeWorkbench(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
    if (!response.ok && response.status !== 307 && response.status !== 308) {
      return false;
    }

    const html = await response.text();
    return html.includes("临床复核工作台") || html.includes("医生登录");
  } catch {
    return false;
  }
}

async function findReusableServer(preferredPort) {
  const candidatePorts = [preferredPort, 3000, 3001, 3002, 3003, 3100, 3200];

  for (const port of candidatePorts) {
    const baseUrl = `http://127.0.0.1:${port}`;
    if (await looksLikeWorkbench(baseUrl)) {
      return { baseUrl, port };
    }
  }

  return null;
}

export async function startAssessmentServer({
  rootDir,
  port,
  outputDir,
  doctorEmail,
}) {
  const reusable = process.env.ASSESS_BASE_URL
    ? { baseUrl: process.env.ASSESS_BASE_URL, port: null }
    : await findReusableServer(port);

  if (reusable) {
    return {
      child: null,
      baseUrl: reusable.baseUrl,
      logPath: null,
      reused: true,
      async stop() {
        return undefined;
      },
    };
  }

  const logPath = path.join(outputDir, "local-server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    DEV_AUTH_BYPASS: "true",
    DEV_AUTH_EMAIL: doctorEmail,
  };

  const child = spawn("cmd.exe", ["/c", "npm.cmd", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: rootDir,
    env,
    shell: false,
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logStream.write(chunk);
  });

  child.on("exit", (code) => {
    logStream.write(`\n[server-exit] code=${code}\n`);
    logStream.end();
  });

  await waitForHttp(`http://127.0.0.1:${port}/login`);

  return {
    child,
    baseUrl: `http://127.0.0.1:${port}`,
    logPath,
    reused: false,
    async stop() {
      if (child && !child.killed) {
        child.kill();
      }
      await sleep(500);
    },
  };
}
