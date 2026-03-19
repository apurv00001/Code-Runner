import { Router, type IRouter } from "express";
import { VM } from "vm2";
import { inspect } from "node:util";

const router: IRouter = Router();

interface LogEntry {
  level: "log" | "warn" | "error" | "result";
  message: string;
}

const serializeArg = (value: unknown): string => {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return inspect(value, { depth: 2, breakLength: 80 });
  }
};

const runCodeInSandbox = (code: string, options: { includeResult?: boolean; argv?: string[] } = {}) => {
  const includeResult = options.includeResult !== false;
  const logs: LogEntry[] = [];
  const logger = (level: "log" | "warn" | "error") =>
    (...args: unknown[]) => {
      logs.push({ level, message: args.map(serializeArg).join(" ") });
    };

  try {
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

const parseNodeCommand = (command: string) => {
  const normalized = typeof command === "string" ? command.trim() : "";
  const match = normalized.match(/^node\s+([./a-zA-Z0-9_-]+\.js)(?:\s+(.*))?$/);
  if (!match) return null;
  const rawArgs = match[2]?.trim() ?? "";
  const args = rawArgs ? rawArgs.split(/\s+/) : [];
  return { fileName: match[1], args };
};

router.post("/run-js", (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code.trim()) {
    res.status(400).json({ ok: false, logs: [], error: "No JavaScript code provided." });
    return;
  }
  res.json(runCodeInSandbox(code));
});

router.post("/run-command", (req, res) => {
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
    (file: { name: unknown; content: unknown }) =>
      typeof file?.name === "string" &&
      typeof file?.content === "string" &&
      file.name === targetFile
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
    runCodeInSandbox(matched.content as string, {
      includeResult: false,
      argv: ["node", targetFile, ...parsedCommand.args],
    })
  );
});

export default router;
