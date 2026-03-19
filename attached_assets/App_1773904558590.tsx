import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import JSZip from "jszip";

type FileLanguage = "html" | "css" | "javascript";
type ThemeMode = "dark" | "light";
type DragType = "sidebar" | "preview" | "console";
type ConsoleLevel = "log" | "warn" | "error" | "system";
type MenuKey = "File" | "Edit" | "View" | "Run";
type GroupId = "primary" | "secondary";

interface ProjectFile {
  id: string;
  name: string;
  language: FileLanguage;
  content: string;
}

interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  message: string;
}

interface EditorGroupState {
  tabs: string[];
  activeId: string | null;
}

interface RunnerPayload {
  ok: boolean;
  logs?: Array<{ level: "log" | "warn" | "error" | "result"; message: string }>;
  error?: string;
}

const STORAGE_KEY = "vscode-lite-project";
const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const inferLanguage = (fileName: string): FileLanguage | null => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js")) return "javascript";
  return null;
};

const parseNodeCommand = (command: string) => {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts[0] !== "node") return null;
  if (!/^[./a-zA-Z0-9_-]+\.js$/.test(parts[1])) return null;
  return { fileName: parts[1], args: parts.slice(2) };
};

const seedFiles = (): ProjectFile[] => [
  {
    id: createId(),
    name: "index.html",
    language: "html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebCode Studio</title>
  </head>
  <body>
    <main class="app">
      <h1>WebCode Studio</h1>
      <p>Run All to render this project.</p>
      <button id="runBtn">Run Script</button>
    </main>
  </body>
</html>`,
  },
  {
    id: createId(),
    name: "styles.css",
    language: "css",
    content: `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #0f172a;
  color: #e2e8f0;
  font-family: Inter, system-ui, sans-serif;
}

.app {
  text-align: center;
}

button {
  border: 1px solid #38bdf8;
  background: transparent;
  color: inherit;
  padding: 0.4rem 0.9rem;
}`,
  },
  {
    id: createId(),
    name: "script.js",
    language: "javascript",
    content: `const button = document.getElementById("runBtn");

button?.addEventListener("click", () => {
  console.log("Preview runtime active");
});`,
  },
];

const buildPreviewDocument = (files: ProjectFile[]) => {
  const html = files.find((file) => file.language === "html")?.content ?? "<body></body>";
  const css = files
    .filter((file) => file.language === "css")
    .map((file) => file.content)
    .join("\n\n");
  const js = files
    .filter((file) => file.language === "javascript")
    .map((file) => file.content)
    .join("\n\n");

  const bridge = `<script>
(() => {
  const send = (level, args) => {
    const message = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
    parent.postMessage({ source: "preview-console", level, message }, "*");
  };
  ["log", "warn", "error"].forEach((level) => {
    const original = console[level];
    console[level] = (...args) => {
      send(level, args);
      original.apply(console, args);
    };
  });
  window.addEventListener("error", (event) => {
    parent.postMessage({ source: "preview-console", level: "error", message: event.message }, "*");
  });
})();
</script>`;

  const styleTag = `<style>${css}</style>`;
  const scriptTag = `${bridge}<script>${js}</script>`;

  let output = html;
  if (!output.toLowerCase().includes("<html")) {
    output = `<!doctype html><html><head></head><body>${output}</body></html>`;
  }

  output = output.includes("</head>") ? output.replace("</head>", `${styleTag}</head>`) : `${styleTag}${output}`;
  output = output.includes("</body>") ? output.replace("</body>", `${scriptTag}</body>`) : `${output}${scriptTag}`;
  return output;
};

const resolveApiCandidates = () => {
  if (ENV_API_BASE) return [ENV_API_BASE];
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return ["", "http://localhost:4000"];
  }
  return [""];
};

const emptyGroup = (): EditorGroupState => ({ tabs: [], activeId: null });

export default function App() {
  const initialFiles = useMemo(() => seedFiles(), []);
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [previewDoc, setPreviewDoc] = useState(buildPreviewDocument(initialFiles));
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [markersByFile, setMarkersByFile] = useState<Record<string, number>>({});

  const [groups, setGroups] = useState<Record<GroupId, EditorGroupState>>({
    primary: { tabs: initialFiles.map((file) => file.id), activeId: initialFiles[0]?.id ?? null },
    secondary: emptyGroup(),
  });
  const [focusedGroup, setFocusedGroup] = useState<GroupId>("primary");
  const [draggedTab, setDraggedTab] = useState<{ fileId: string; fromGroup: GroupId } | null>(null);

  const [nodeCommand, setNodeCommand] = useState("node script.js");
  const [terminalInput, setTerminalInput] = useState("node script.js");
  const [menuOpen, setMenuOpen] = useState<MenuKey | null>(null);
  const [isRunningJsOnly, setIsRunningJsOnly] = useState(false);
  const [isRunningCommand, setIsRunningCommand] = useState(false);

  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(270);
  const [editorWidthPercent, setEditorWidthPercent] = useState(64);
  const [consoleHeight, setConsoleHeight] = useState(190);
  const [drag, setDrag] = useState<{
    type: DragType;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);

  const topPanelRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorRefs = useRef<Partial<Record<GroupId, Parameters<NonNullable<ComponentProps<typeof Editor>["onMount"]>>[0]>>>({});

  const isDark = theme === "dark";

  const fileMap = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const activeFileId = groups[focusedGroup].activeId;
  const activeFile = activeFileId ? fileMap.get(activeFileId) ?? null : null;
  const markerCount = activeFile ? markersByFile[activeFile.id] ?? 0 : 0;

  const appendConsole = useCallback((level: ConsoleLevel, message: string) => {
    setConsoleEntries((prev) => [...prev, { id: createId(), level, message }]);
  }, []);

  const appendSystem = useCallback((message: string) => appendConsole("system", message), [appendConsole]);

  const callRunnerApi = useCallback(async (path: string, body: unknown) => {
    const candidates = resolveApiCandidates();
    let lastError: string | null = null;

    for (const base of candidates) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as RunnerPayload;
        return payload;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Failed to contact backend";
      }
    }

    throw new Error(lastError ?? "Failed to contact backend");
  }, []);

  const openFileInGroup = useCallback((fileId: string, groupId: GroupId) => {
    setGroups((prev) => {
      const group = prev[groupId];
      const tabs = group.tabs.includes(fileId) ? group.tabs : [...group.tabs, fileId];
      return { ...prev, [groupId]: { tabs, activeId: fileId } };
    });
    setFocusedGroup(groupId);
  }, []);

  const closeTab = useCallback((groupId: GroupId, fileId: string) => {
    setGroups((prev) => {
      const group = prev[groupId];
      if (!group.tabs.includes(fileId)) return prev;
      const nextTabs = group.tabs.filter((id) => id !== fileId);
      let nextActive = group.activeId;
      if (group.activeId === fileId) {
        nextActive = nextTabs[nextTabs.length - 1] ?? null;
      }
      return { ...prev, [groupId]: { tabs: nextTabs, activeId: nextActive } };
    });
  }, []);

  const moveTab = useCallback((fromGroup: GroupId, toGroup: GroupId, fileId: string, toIndex?: number) => {
    setGroups((prev) => {
      const fromTabs = prev[fromGroup].tabs.filter((id) => id !== fileId);
      const targetTabsBase = prev[toGroup].tabs.filter((id) => id !== fileId);
      const insertAt = typeof toIndex === "number" ? Math.min(Math.max(0, toIndex), targetTabsBase.length) : targetTabsBase.length;
      const targetTabs = [...targetTabsBase.slice(0, insertAt), fileId, ...targetTabsBase.slice(insertAt)];

      const next = {
        ...prev,
        [fromGroup]: {
          tabs: fromTabs,
          activeId:
            prev[fromGroup].activeId === fileId
              ? fromTabs[Math.max(0, Math.min(insertAt, fromTabs.length - 1))] ?? null
              : prev[fromGroup].activeId,
        },
        [toGroup]: {
          tabs: targetTabs,
          activeId: fileId,
        },
      };
      return next;
    });
    setFocusedGroup(toGroup);
  }, []);

  const splitActiveTab = useCallback(() => {
    const current = groups[focusedGroup];
    if (!current.activeId) return;
    const targetGroup: GroupId = focusedGroup === "primary" ? "secondary" : "primary";
    moveTab(focusedGroup, targetGroup, current.activeId);
  }, [focusedGroup, groups, moveTab]);

  const runNodeCommandInBrowser = useCallback(
    (command: string) => {
      const parsed = parseNodeCommand(command);
      if (!parsed) {
        appendSystem("Unsupported command. Use: node <file.js> [args]");
        return;
      }

      const jsFiles = new Map(
        files.filter((file) => file.language === "javascript").map((file) => [file.name, file.content])
      );
      if (!jsFiles.has(parsed.fileName)) {
        appendConsole("error", `File not found: ${parsed.fileName}`);
        return;
      }

      appendSystem("Backend unavailable. Running in browser Node-like runtime.");

      const pushLog = (level: "log" | "warn" | "error", args: unknown[]) => {
        const message = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(" ");
        appendConsole(level, message);
      };

      const moduleCache = new Map<string, { exports: unknown }>();
      const resolvePath = (importer: string, specifier: string) => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
        const importerParts = importer.split("/");
        importerParts.pop();
        const segments = [...importerParts, ...specifier.split("/")];
        const normalized: string[] = [];
        segments.forEach((segment) => {
          if (!segment || segment === ".") return;
          if (segment === "..") {
            normalized.pop();
            return;
          }
          normalized.push(segment);
        });
        const resolved = normalized.join("/");
        return resolved.endsWith(".js") ? resolved : `${resolved}.js`;
      };

      const runModule = (fileName: string): unknown => {
        const cached = moduleCache.get(fileName);
        if (cached) return cached.exports;

        const code = jsFiles.get(fileName);
        if (typeof code !== "string") {
          throw new Error(`Cannot find module '${fileName}'`);
        }

        const module = { exports: {} as unknown };
        moduleCache.set(fileName, module);

        const localRequire = (specifier: string) => {
          const resolved = resolvePath(fileName, specifier);
          if (!resolved) {
            throw new Error(
              `Only relative require paths are supported in browser runtime. Received: ${specifier}`
            );
          }
          return runModule(resolved);
        };

        const dirname = fileName.includes("/") ? fileName.slice(0, fileName.lastIndexOf("/")) : ".";
        const processShim = {
          argv: ["node", fileName, ...parsed.args],
          env: {},
          platform: "browser",
          cwd: () => "/",
        };

        const runtimeConsole = {
          log: (...args: unknown[]) => pushLog("log", args),
          warn: (...args: unknown[]) => pushLog("warn", args),
          error: (...args: unknown[]) => pushLog("error", args),
        };

        const wrapped = new Function(
          "require",
          "module",
          "exports",
          "console",
          "process",
          "__filename",
          "__dirname",
          `"use strict";\n${code}`
        );

        wrapped(localRequire, module, module.exports, runtimeConsole, processShim, fileName, dirname);
        return module.exports;
      };

      try {
        runModule(parsed.fileName);
      } catch (error) {
        appendConsole("error", error instanceof Error ? error.message : "Browser Node runtime error");
      }
    },
    [appendConsole, appendSystem, files]
  );

  const runAll = useCallback(() => {
    appendSystem("Run All started.");
    setPreviewDoc(buildPreviewDocument(files));
  }, [appendSystem, files]);

  const runJsOnly = useCallback(async () => {
    const preferred = activeFile?.language === "javascript" ? activeFile : null;
    const jsFile = preferred ?? files.find((file) => file.language === "javascript");
    if (!jsFile) {
      appendSystem("No JavaScript file available.");
      return;
    }

    setIsRunningJsOnly(true);
    appendSystem(`Run JS Only started for ${jsFile.name}.`);

    try {
      const payload = await callRunnerApi("/api/run-js", { code: jsFile.content });
      (payload.logs ?? []).forEach((entry) => {
        const level = entry.level === "warn" || entry.level === "error" ? entry.level : "log";
        appendConsole(level, entry.level === "result" ? `Result: ${entry.message}` : entry.message);
      });
      if (!payload.ok) appendConsole("error", payload.error ?? "Execution failed.");
    } catch {
      appendSystem("Backend unavailable. Running JS in browser fallback.");
      try {
        const runtimeConsole = {
          log: (...args: unknown[]) => appendConsole("log", args.map(String).join(" ")),
          warn: (...args: unknown[]) => appendConsole("warn", args.map(String).join(" ")),
          error: (...args: unknown[]) => appendConsole("error", args.map(String).join(" ")),
        };
        const runner = new Function("console", `"use strict";\n${jsFile.content}`);
        runner(runtimeConsole);
      } catch (error) {
        appendConsole("error", error instanceof Error ? error.message : "Browser fallback runtime error");
      }
    } finally {
      setIsRunningJsOnly(false);
    }
  }, [activeFile, appendConsole, appendSystem, callRunnerApi, files]);

  const runNodeCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) {
        appendSystem("Enter command. Example: node script.js");
        return;
      }
      appendSystem(`Running command: ${trimmed}`);
      setIsRunningCommand(true);
      setNodeCommand(trimmed);

      try {
        const payload = await callRunnerApi("/api/run-command", {
          command: trimmed,
          files: files
            .filter((file) => file.language === "javascript")
            .map((file) => ({ name: file.name, content: file.content })),
        });
        (payload.logs ?? []).forEach((entry) => {
          const level = entry.level === "warn" || entry.level === "error" ? entry.level : "log";
          appendConsole(level, entry.level === "result" ? `Result: ${entry.message}` : entry.message);
        });
        if (!payload.ok) appendConsole("error", payload.error ?? "Command execution failed.");
      } catch {
        runNodeCommandInBrowser(trimmed);
      } finally {
        setIsRunningCommand(false);
      }
    },
    [appendConsole, appendSystem, callRunnerApi, files, runNodeCommandInBrowser]
  );

  const createFile = useCallback(() => {
    const name = window.prompt("New filename (.html, .css, .js)", "new-file.js")?.trim() ?? "";
    if (!name) return;
    const language = inferLanguage(name);
    if (!language) {
      appendSystem("Only .html, .css, and .js files are supported.");
      return;
    }
    if (files.some((file) => file.name.toLowerCase() === name.toLowerCase())) {
      appendSystem("A file with that name already exists.");
      return;
    }

    const newFile: ProjectFile = {
      id: createId(),
      name,
      language,
      content: language === "html" ? "<div></div>" : "",
    };

    setFiles((prev) => [...prev, newFile]);
    openFileInGroup(newFile.id, focusedGroup);
  }, [appendSystem, files, focusedGroup, openFileInGroup]);

  const renameFile = useCallback(
    (fileId: string) => {
      const target = fileMap.get(fileId);
      if (!target) return;
      const nextName = window.prompt("Rename file", target.name)?.trim() ?? "";
      if (!nextName || nextName === target.name) return;
      const nextLanguage = inferLanguage(nextName);
      if (!nextLanguage) {
        appendSystem("Rename failed: extension must be .html, .css, or .js.");
        return;
      }
      if (files.some((file) => file.id !== fileId && file.name.toLowerCase() === nextName.toLowerCase())) {
        appendSystem("Rename failed: file name already exists.");
        return;
      }
      setFiles((prev) => prev.map((file) => (file.id === fileId ? { ...file, name: nextName, language: nextLanguage } : file)));
    },
    [appendSystem, fileMap, files]
  );

  const deleteFile = useCallback(
    (fileId: string) => {
      const target = fileMap.get(fileId);
      if (!target) return;
      if (!window.confirm(`Delete ${target.name}?`)) return;

      setFiles((prev) => prev.filter((file) => file.id !== fileId));
      setGroups((prev) => {
        const next: Record<GroupId, EditorGroupState> = {
          primary: { ...prev.primary },
          secondary: { ...prev.secondary },
        };
        (["primary", "secondary"] as GroupId[]).forEach((groupId) => {
          const tabs = next[groupId].tabs.filter((id) => id !== fileId);
          const activeId = next[groupId].activeId === fileId ? tabs[tabs.length - 1] ?? null : next[groupId].activeId;
          next[groupId] = { tabs, activeId };
        });
        return next;
      });
    },
    [fileMap]
  );

  const updateFileContent = useCallback((fileId: string, content: string) => {
    setFiles((prev) => prev.map((file) => (file.id === fileId ? { ...file, content } : file)));
  }, []);

  const saveProject = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, groups, theme }));
    appendSystem("Project saved.");
  }, [appendSystem, files, groups, theme]);

  const loadProject = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      appendSystem("No project found in local storage.");
      return;
    }

    try {
      const parsed = JSON.parse(saved) as {
        files?: ProjectFile[];
        groups?: Record<GroupId, EditorGroupState>;
        theme?: ThemeMode;
      };
      const restoredFiles = (parsed.files ?? []).filter(
        (file): file is ProjectFile =>
          typeof file?.id === "string" &&
          typeof file?.name === "string" &&
          typeof file?.content === "string" &&
          inferLanguage(file.name) !== null
      );
      if (!restoredFiles.length) {
        appendSystem("Saved project is empty.");
        return;
      }

      const fileIds = new Set(restoredFiles.map((file) => file.id));
      const rawGroups = parsed.groups;
      const normalizeGroup = (source: EditorGroupState | undefined): EditorGroupState => {
        const tabs = (source?.tabs ?? []).filter((id) => fileIds.has(id));
        const activeId = source?.activeId && tabs.includes(source.activeId) ? source.activeId : tabs[0] ?? null;
        return { tabs, activeId };
      };

      const nextGroups: Record<GroupId, EditorGroupState> = {
        primary: normalizeGroup(rawGroups?.primary),
        secondary: normalizeGroup(rawGroups?.secondary),
      };
      if (!nextGroups.primary.tabs.length) {
        nextGroups.primary = { tabs: restoredFiles.map((file) => file.id), activeId: restoredFiles[0].id };
      }

      setFiles(restoredFiles);
      setGroups(nextGroups);
      setFocusedGroup(nextGroups.primary.activeId ? "primary" : "secondary");
      setTheme(parsed.theme === "light" ? "light" : "dark");
      setPreviewDoc(buildPreviewDocument(restoredFiles));
      appendSystem("Project loaded.");
    } catch {
      appendSystem("Failed to parse saved project.");
    }
  }, [appendSystem]);

  const downloadProject = useCallback(async () => {
    const zip = new JSZip();
    files.forEach((file) => zip.file(file.name, file.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "webcode-studio.zip";
    link.click();
    URL.revokeObjectURL(url);
    appendSystem("ZIP downloaded.");
  }, [appendSystem, files]);

  const formatActive = useCallback(() => {
    editorRefs.current[focusedGroup]?.getAction("editor.action.formatDocument")?.run();
  }, [focusedGroup]);

  const openPreviewInNewTab = useCallback(() => {
    const doc = buildPreviewDocument(files);
    const popup = window.open("", "_blank");
    if (!popup) {
      appendSystem("Popup blocked. Allow popups and try again.");
      return;
    }
    popup.document.open();
    popup.document.write(doc);
    popup.document.close();
  }, [appendSystem, files]);

  const executeTerminalCommand = useCallback(
    async (raw: string) => {
      const command = raw.trim();
      if (!command) return;
      appendSystem(`$ ${command}`);

      if (command === "run all") {
        runAll();
        return;
      }
      if (command === "run js") {
        await runJsOnly();
        return;
      }
      if (command === "clear") {
        setConsoleEntries([]);
        return;
      }
      if (command === "format") {
        formatActive();
        return;
      }
      if (command === "save") {
        saveProject();
        return;
      }
      if (command === "load") {
        loadProject();
        return;
      }
      if (command === "zip") {
        await downloadProject();
        return;
      }
      if (command.startsWith("node ")) {
        await runNodeCommand(command);
        return;
      }

      appendConsole("warn", "Unknown command. Use run all, run js, node <file.js>, format, save, load, zip, clear.");
    },
    [appendConsole, appendSystem, downloadProject, formatActive, loadProject, runAll, runJsOnly, runNodeCommand, saveProject]
  );

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as {
        files?: ProjectFile[];
        groups?: Record<GroupId, EditorGroupState>;
        theme?: ThemeMode;
      };
      if (!parsed.files?.length) return;

      const restoredFiles = parsed.files.filter(
        (file): file is ProjectFile =>
          typeof file?.id === "string" &&
          typeof file?.name === "string" &&
          typeof file?.content === "string" &&
          inferLanguage(file.name) !== null
      );
      if (!restoredFiles.length) return;

      const fileIds = new Set(restoredFiles.map((file) => file.id));
      const normalize = (group: EditorGroupState | undefined): EditorGroupState => {
        const tabs = (group?.tabs ?? []).filter((id) => fileIds.has(id));
        return {
          tabs,
          activeId: group?.activeId && tabs.includes(group.activeId) ? group.activeId : tabs[0] ?? null,
        };
      };

      const restoredGroups: Record<GroupId, EditorGroupState> = {
        primary: normalize(parsed.groups?.primary),
        secondary: normalize(parsed.groups?.secondary),
      };
      if (!restoredGroups.primary.tabs.length) {
        restoredGroups.primary = { tabs: restoredFiles.map((file) => file.id), activeId: restoredFiles[0].id };
      }

      setFiles(restoredFiles);
      setGroups(restoredGroups);
      setTheme(parsed.theme === "light" ? "light" : "dark");
      setPreviewDoc(buildPreviewDocument(restoredFiles));
      appendSystem("Project restored from local storage.");
    } catch {
      appendSystem("Saved project is invalid and was ignored.");
    }
  }, [appendSystem]);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.data?.source !== "preview-console") return;
      const level = event.data.level === "warn" || event.data.level === "error" ? event.data.level : "log";
      const message = typeof event.data.message === "string" ? event.data.message : String(event.data.message);
      appendConsole(level, message);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [appendConsole]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, groups, theme }));
  }, [files, groups, theme]);

  useEffect(() => {
    setGroups((prev) => {
      const available = new Set(files.map((file) => file.id));
      const cleanGroup = (group: EditorGroupState): EditorGroupState => {
        const tabs = group.tabs.filter((id) => available.has(id));
        const activeId = group.activeId && tabs.includes(group.activeId) ? group.activeId : tabs[0] ?? null;
        return { tabs, activeId };
      };

      const nextPrimary = cleanGroup(prev.primary);
      const nextSecondary = cleanGroup(prev.secondary);

      if (!nextPrimary.tabs.length && files.length) {
        return {
          primary: { tabs: files.map((file) => file.id), activeId: files[0].id },
          secondary: nextSecondary,
        };
      }
      return { primary: nextPrimary, secondary: nextSecondary };
    });
  }, [files]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: MouseEvent) => {
      if (drag.type === "sidebar") {
        setSidebarWidth(Math.min(420, Math.max(210, drag.startValue + (event.clientX - drag.startX))));
        return;
      }
      if (drag.type === "preview") {
        const width = topPanelRef.current?.getBoundingClientRect().width ?? 0;
        if (width < 200) return;
        const delta = ((event.clientX - drag.startX) / width) * 100;
        setEditorWidthPercent(Math.min(84, Math.max(28, drag.startValue + delta)));
        return;
      }
      const height = workspaceRef.current?.getBoundingClientRect().height ?? 0;
      if (height < 200) return;
      const delta = drag.startY - event.clientY;
      setConsoleHeight(Math.min(420, Math.max(110, drag.startValue + delta)));
    };

    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  const menuItems: Record<MenuKey, Array<{ label: string; action: () => void }>> = {
    File: [
      { label: "New File", action: createFile },
      { label: "Save", action: saveProject },
      { label: "Load", action: loadProject },
      { label: "Download ZIP", action: () => void downloadProject() },
    ],
    Edit: [
      { label: "Format", action: formatActive },
      {
        label: "Rename Active File",
        action: () => {
          if (activeFile) renameFile(activeFile.id);
        },
      },
      {
        label: "Delete Active File",
        action: () => {
          if (activeFile) deleteFile(activeFile.id);
        },
      },
      { label: "Split Active Tab", action: splitActiveTab },
    ],
    View: [
      { label: isTerminalOpen ? "Hide Terminal" : "Show Terminal", action: () => setIsTerminalOpen((prev) => !prev) },
      { label: "Open Preview In New Tab", action: openPreviewInNewTab },
      { label: isDark ? "Switch To Light Theme" : "Switch To Dark Theme", action: () => setTheme((prev) => (prev === "dark" ? "light" : "dark")) },
    ],
    Run: [
      { label: "Run All", action: runAll },
      { label: "Run JS Only", action: () => void runJsOnly() },
      { label: "Run Node Command", action: () => void runNodeCommand(nodeCommand) },
    ],
  };

  const renderEditorGroup = (groupId: GroupId) => {
    const group = groups[groupId];
    const groupActiveId = group.activeId;
    const groupFile = groupActiveId ? fileMap.get(groupActiveId) ?? null : null;

    return (
      <section
        key={groupId}
        className={`flex min-w-0 flex-1 flex-col border-r ${isDark ? "border-[#2b2b2b]" : "border-slate-300"}`}
        onClick={() => setFocusedGroup(groupId)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!draggedTab) return;
          moveTab(draggedTab.fromGroup, groupId, draggedTab.fileId);
          setDraggedTab(null);
        }}
      >
        <div className={`flex h-9 items-end border-b px-1 ${isDark ? "border-[#2b2b2b] bg-[#1f1f1f]" : "border-slate-300 bg-slate-200"}`}>
          <div className="flex min-w-0 flex-1 gap-1 overflow-auto text-xs">
            {group.tabs.map((fileId, index) => {
              const file = fileMap.get(fileId);
              if (!file) return null;
              const active = group.activeId === fileId;
              return (
                <div
                  key={`${groupId}-${file.id}`}
                  className={`flex items-center rounded-t border border-b-0 px-2 py-1 ${
                    active
                      ? isDark
                        ? "border-[#2b2b2b] bg-[#252526]"
                        : "border-slate-300 bg-white"
                      : isDark
                        ? "border-transparent bg-[#2d2d30] text-slate-300"
                        : "border-transparent bg-slate-100 text-slate-600"
                  }`}
                  draggable
                  onDragStart={() => setDraggedTab({ fileId: file.id, fromGroup: groupId })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggedTab) return;
                    moveTab(draggedTab.fromGroup, groupId, draggedTab.fileId, index);
                    setDraggedTab(null);
                  }}
                >
                  <button className="truncate text-left" onClick={() => openFileInGroup(file.id, groupId)}>
                    {file.name}
                  </button>
                  <button className="ml-2 text-[10px] opacity-70 hover:opacity-100" onClick={() => closeTab(groupId, file.id)}>
                    x
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {groupFile ? (
          <Editor
            path={`${groupId}:${groupFile.name}`}
            language={groupFile.language}
            value={groupFile.content}
            onMount={(editor) => {
              editorRefs.current[groupId] = editor;
            }}
            onValidate={(markers) => {
              setMarkersByFile((prev) => ({ ...prev, [groupFile.id]: markers.length }));
            }}
            onChange={(value) => updateFileContent(groupFile.id, value ?? "")}
            theme={isDark ? "vs-dark" : "light"}
            height="calc(100% - 2.25rem)"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              automaticLayout: true,
              formatOnPaste: true,
              formatOnType: true,
              suggestOnTriggerCharacters: true,
              wordWrap: "on",
              autoClosingBrackets: "always",
              autoClosingQuotes: "always",
              autoClosingDelete: "always",
              quickSuggestions: { other: true, comments: true, strings: true },
            }}
          />
        ) : (
          <div className="grid h-[calc(100%-2.25rem)] place-items-center text-sm opacity-60">No open tab in this editor group</div>
        )}
      </section>
    );
  };

  return (
    <div className={`h-screen overflow-hidden ${isDark ? "bg-[#1e1e1e] text-slate-200" : "bg-slate-100 text-slate-900"}`}>
      <header className={`flex h-9 items-center justify-between border-b px-3 text-xs ${isDark ? "border-[#2b2b2b] bg-[#2d2d30]" : "border-slate-300 bg-slate-200"}`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-wide">WebCode Studio</span>
          {(Object.keys(menuItems) as MenuKey[]).map((menu) => (
            <div key={menu} className="relative">
              <button
                onClick={() => setMenuOpen((prev) => (prev === menu ? null : menu))}
                className={`rounded px-2 py-1 ${menuOpen === menu ? (isDark ? "bg-[#3a3a3a]" : "bg-slate-300") : "hover:bg-black/10"}`}
              >
                {menu}
              </button>
              {menuOpen === menu ? (
                <div className={`absolute left-0 top-8 z-20 w-52 border text-xs shadow-lg ${isDark ? "border-[#2b2b2b] bg-[#252526]" : "border-slate-300 bg-white"}`}>
                  {menuItems[menu].map((item) => (
                    <button
                      key={`${menu}-${item.label}`}
                      className="flex w-full items-center px-3 py-2 text-left hover:bg-black/10"
                      onClick={() => {
                        item.action();
                        setMenuOpen(null);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            className={`rounded border px-2 py-1 ${isDark ? "border-[#3a3a3a] hover:bg-[#3a3a3a]" : "border-slate-400 hover:bg-slate-100"}`}
          >
            {isDark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-2.25rem)]" ref={workspaceRef}>
        <aside className={`w-12 border-r ${isDark ? "border-[#2b2b2b] bg-[#333333]" : "border-slate-300 bg-slate-300"}`}>
          <div className="flex h-full flex-col items-center gap-2 pt-2 text-[10px]">
            <button className={`h-8 w-8 rounded ${isDark ? "bg-[#094771] text-white" : "bg-sky-600 text-white"}`} title="Explorer">
              EX
            </button>
            <button className={`h-8 w-8 rounded ${isDark ? "hover:bg-[#424242]" : "hover:bg-slate-400"}`} title="Search">
              SR
            </button>
            <button className={`h-8 w-8 rounded ${isDark ? "hover:bg-[#424242]" : "hover:bg-slate-400"}`} title="Run">
              RN
            </button>
          </div>
        </aside>

        <section className={`overflow-auto border-r ${isDark ? "border-[#2b2b2b] bg-[#252526]" : "border-slate-300 bg-slate-50"}`} style={{ width: sidebarWidth }}>
          <div className={`flex h-9 items-center justify-between border-b px-3 text-xs ${isDark ? "border-[#2b2b2b]" : "border-slate-300"}`}>
            <span className="font-medium tracking-wide">EXPLORER</span>
            <button onClick={createFile} className="rounded px-1.5 py-0.5 hover:bg-black/10" title="New File">
              +
            </button>
          </div>
          <div className="pt-1 text-[13px]">
            {files.map((file) => {
              const isActive = activeFile?.id === file.id;
              return (
                <div key={file.id} className={`group flex items-center justify-between px-2 py-1.5 ${isActive ? (isDark ? "bg-[#37373d]" : "bg-slate-200") : ""}`}>
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openFileInGroup(file.id, focusedGroup)}>
                    <span className="text-[10px] opacity-60">{file.language === "html" ? "H" : file.language === "css" ? "C" : "J"}</span>
                    <span className="truncate">{file.name}</span>
                  </button>
                  <div className="hidden gap-1 text-[10px] group-hover:flex">
                    <button className="rounded px-1 hover:bg-black/10" onClick={() => renameFile(file.id)}>
                      Ren
                    </button>
                    <button className="rounded px-1 hover:bg-black/10" onClick={() => deleteFile(file.id)}>
                      Del
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div
          className={`w-1 cursor-col-resize ${isDark ? "bg-[#2b2b2b]" : "bg-slate-300"}`}
          onMouseDown={(event) =>
            setDrag({ type: "sidebar", startX: event.clientX, startY: event.clientY, startValue: sidebarWidth })
          }
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className={`flex h-10 items-center justify-between gap-2 border-b px-2 text-xs ${isDark ? "border-[#2b2b2b] bg-[#252526]" : "border-slate-300 bg-slate-100"}`}>
            <div className="flex items-center gap-1">
              <button className="rounded border px-2 py-1" onClick={formatActive}>Format</button>
              <button className="rounded border px-2 py-1" onClick={saveProject}>Save</button>
              <button className="rounded border px-2 py-1" onClick={loadProject}>Load</button>
              <button className="rounded border px-2 py-1" onClick={() => void downloadProject()}>ZIP</button>
              <button className="rounded border px-2 py-1" onClick={splitActiveTab}>Split</button>
            </div>
            <div className="flex items-center gap-1">
              <button className="rounded border px-2 py-1" onClick={runAll}>Run All</button>
              <button className="rounded border px-2 py-1" onClick={() => void runJsOnly()} disabled={isRunningJsOnly}>
                {isRunningJsOnly ? "Running JS..." : "Run JS Only"}
              </button>
              <input
                value={nodeCommand}
                onChange={(event) => setNodeCommand(event.target.value)}
                className={`w-48 rounded border px-2 py-1 ${isDark ? "border-[#3a3a3a] bg-[#1e1e1e]" : "border-slate-300 bg-white"}`}
                placeholder="node script.js"
              />
              <button className="rounded border px-2 py-1" onClick={() => void runNodeCommand(nodeCommand)} disabled={isRunningCommand}>
                {isRunningCommand ? "Running..." : "Run Node Cmd"}
              </button>
              <button className="rounded border px-2 py-1" onClick={openPreviewInNewTab}>Open Preview</button>
            </div>
          </div>

          <div className="min-h-0 flex-1" style={{ height: `calc(100% - ${isTerminalOpen ? consoleHeight : 0}px)` }} ref={topPanelRef}>
            <div className="flex h-full min-h-0">
              <section className="flex min-w-0" style={{ width: `${editorWidthPercent}%` }}>
                {renderEditorGroup("primary")}
                {groups.secondary.tabs.length > 0 || groups.secondary.activeId ? renderEditorGroup("secondary") : null}
              </section>

              <div
                className={`w-1 cursor-col-resize ${isDark ? "bg-[#2b2b2b]" : "bg-slate-300"}`}
                onMouseDown={(event) =>
                  setDrag({ type: "preview", startX: event.clientX, startY: event.clientY, startValue: editorWidthPercent })
                }
              />

              <section className={`min-w-0 flex-1 ${isDark ? "bg-[#1e1e1e]" : "bg-white"}`}>
                <div className={`flex h-9 items-center justify-between border-b px-3 text-xs font-medium tracking-wide ${isDark ? "border-[#2b2b2b] bg-[#252526]" : "border-slate-300 bg-slate-100"}`}>
                  <span>PREVIEW</span>
                  <button className="rounded border px-2 py-1" onClick={openPreviewInNewTab}>Open In Tab</button>
                </div>
                <iframe title="preview" srcDoc={previewDoc} className="h-[calc(100%-2.25rem)] w-full bg-white" sandbox="allow-scripts" />
              </section>
            </div>
          </div>

          {isTerminalOpen ? (
            <>
              <div
                className={`h-1 cursor-row-resize ${isDark ? "bg-[#2b2b2b]" : "bg-slate-300"}`}
                onMouseDown={(event) =>
                  setDrag({ type: "console", startX: event.clientX, startY: event.clientY, startValue: consoleHeight })
                }
              />

              <section className={`${isDark ? "border-t border-[#2b2b2b] bg-[#181818]" : "border-t border-slate-300 bg-slate-50"}`} style={{ height: consoleHeight }}>
                <div className={`flex h-9 items-center justify-between border-b px-3 text-xs ${isDark ? "border-[#2b2b2b]" : "border-slate-300"}`}>
                  <div className="flex items-center gap-3">
                    <span>TERMINAL</span>
                    <span className="opacity-60">Type commands: node script.js, run all, run js, clear</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="rounded border px-2 py-1 text-[10px]" onClick={() => setConsoleEntries([])}>Clear</button>
                    <button className="rounded border px-2 py-1 text-[10px]" onClick={() => setIsTerminalOpen(false)}>Close</button>
                  </div>
                </div>

                <div className="h-[calc(100%-4.5rem)] overflow-auto p-3 font-mono text-xs leading-5">
                  {consoleEntries.length === 0 ? (
                    <div className="opacity-60">Run code to view logs, warnings, and errors.</div>
                  ) : (
                    consoleEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className={`${
                          entry.level === "error"
                            ? "text-rose-400"
                            : entry.level === "warn"
                              ? "text-amber-400"
                              : entry.level === "system"
                                ? "text-sky-400"
                                : ""
                        }`}
                      >
                        [{entry.level}] {entry.message}
                      </div>
                    ))
                  )}
                </div>

                <form
                  className={`flex h-9 items-center gap-2 border-t px-2 ${isDark ? "border-[#2b2b2b]" : "border-slate-300"}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void executeTerminalCommand(terminalInput);
                    setTerminalInput("");
                  }}
                >
                  <span className="font-mono text-xs opacity-70">$</span>
                  <input
                    value={terminalInput}
                    onChange={(event) => setTerminalInput(event.target.value)}
                    className={`h-7 flex-1 rounded border px-2 text-xs ${isDark ? "border-[#3a3a3a] bg-[#1e1e1e]" : "border-slate-300 bg-white"}`}
                    placeholder="node script.js"
                  />
                  <button className="rounded border px-2 py-1 text-xs">Run</button>
                </form>
              </section>
            </>
          ) : (
            <div className={`border-t px-2 py-1 text-xs ${isDark ? "border-[#2b2b2b] bg-[#1b1b1b]" : "border-slate-300 bg-slate-100"}`}>
              <button className="rounded border px-2 py-1" onClick={() => setIsTerminalOpen(true)}>
                Open Terminal
              </button>
            </div>
          )}

          <footer className={`flex h-6 items-center justify-between px-3 text-[10px] ${isDark ? "bg-[#007acc] text-white" : "bg-sky-600 text-white"}`}>
            <span>File: {activeFile?.name ?? "None"}</span>
            <span>Problems: {markerCount}</span>
            <span>API: {ENV_API_BASE || "same-origin/localhost"}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}