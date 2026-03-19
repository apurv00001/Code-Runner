import express from "express";
import cors from "cors";
import { VM } from "vm2";
import { inspect } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const serializeArg = (value) => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return inspect(value, { depth: 2, breakLength: 80 });
  }
};

const runCodeInSandbox = (code, options = {}) => {
  const includeResult = options.includeResult !== false;
  const logs = [];
  const logger = (level) => (...args) => {
    logs.push({ level, message: args.map(serializeArg).join(" ") });
  };

  try {
    // vm2 runs user code in an isolated context with a strict timeout.
    const vm = new VM({
      timeout: 1000,
      eval: false,
      wasm: false,
      sandbox: {
        console: {
          log: logger("log"),
          warn: logger("warn"),
          error: logger("error"),
        },
        process: {
          argv: Array.isArray(options.argv) ? options.argv : ["node", "script.js"],
          env: {},
          platform: "linux",
          cwd: () => "/",
        },
      },
    });

    const result = vm.run(`"use strict";\n${code}`);
    if (includeResult && result !== undefined) {
      logs.push({ level: "result", message: serializeArg(result) });
    }

    return { ok: true, logs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown runtime error";
    return { ok: false, logs, error: message };
  }
};

const parseNodeCommand = (command) => {
  const normalized = typeof command === "string" ? command.trim() : "";
  const match = normalized.match(/^node\s+([./a-zA-Z0-9_-]+\.js)(?:\s+(.*))?$/);
  if (!match) return null;
  const rawArgs = match[2]?.trim() ?? "";
  const args = rawArgs ? rawArgs.split(/\s+/) : [];
  return { fileName: match[1], args };
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "Sandbox runner is online." });
});

app.post("/api/run-js", (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) {
    res.status(400).json({ ok: false, logs: [], error: "No JavaScript code provided." });
    return;
  }

  res.json(runCodeInSandbox(code));
});

app.post("/api/run-command", (req, res) => {
  const command = typeof req.body?.command === "string" ? req.body.command : "";
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const parsedCommand = parseNodeCommand(command);

  if (!parsedCommand) {
    res.status(400).json({
      ok: false,
      logs: [],
      error: "Unsupported command. Use: node <file.js>",
    });
    return;
  }

  const targetFile = parsedCommand.fileName;

  const matched = files.find(
    (file) => typeof file?.name === "string" && typeof file?.content === "string" && file.name === targetFile
  );

  if (!matched) {
    res.status(404).json({
      ok: false,
      logs: [],
      error: `File not found: ${targetFile}`,
    });
    return;
  }

  res.json(
    runCodeInSandbox(matched.content, {
      includeResult: false,
      argv: ["node", targetFile, ...parsedCommand.args],
    })
  );
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Sandbox runner listening on http://localhost:${PORT}`);
});