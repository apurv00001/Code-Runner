import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor from "@monaco-editor/react";
import JSZip from "jszip";
import {
  Files,
  Search,
  GitBranch,
  Settings,
  X,
  Plus,
  ChevronRight,
  TerminalSquare,
  AlertCircle,
  FileCode2,
  WrapText,
  Map as MapIcon,
  Columns2,
  Play,
  Square,
  ExternalLink,
  Download,
  Save,
  FolderOpen,
  RefreshCw,
  Braces,
} from "lucide-react";

type FileLanguage =
  | "html"
  | "css"
  | "javascript"
  | "javascriptreact"
  | "typescript"
  | "typescriptreact"
  | "json"
  | "markdown";
type ThemeMode = "dark" | "light";
type DragType = "sidebar" | "preview" | "panel";
type ConsoleLevel = "log" | "warn" | "error" | "system";
type MenuKey = "File" | "Edit" | "View" | "Run";
type GroupId = "primary" | "secondary";
type ActivityId = "explorer" | "search" | "git";
type PanelTab = "terminal" | "problems" | "output";

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

interface CursorPos {
  line: number;
  col: number;
}

const STORAGE_KEY = "webcode-studio-v3";
const ENV_API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

const createId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const EXT_LANG_MAP: Record<string, FileLanguage> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascriptreact",
  ts: "typescript",
  tsx: "typescriptreact",
  json: "json",
  md: "markdown",
  mdx: "markdown",
};

const LANG_LABEL: Record<FileLanguage, string> = {
  html: "HTML",
  css: "CSS",
  javascript: "JavaScript",
  javascriptreact: "JSX",
  typescript: "TypeScript",
  typescriptreact: "TSX",
  json: "JSON",
  markdown: "Markdown",
};

const FILE_COLOR: Record<FileLanguage, string> = {
  html: "#e44d26",
  css: "#264de4",
  javascript: "#f7df1e",
  javascriptreact: "#61dafb",
  typescript: "#3178c6",
  typescriptreact: "#3178c6",
  json: "#fbc02d",
  markdown: "#78909c",
};

const FILE_LETTER: Record<FileLanguage, string> = {
  html: "H",
  css: "C",
  javascript: "J",
  javascriptreact: "X",
  typescript: "T",
  typescriptreact: "X",
  json: "{}",
  markdown: "M",
};

function FileIcon({ language, size = 14 }: { language: FileLanguage; size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 2,
        backgroundColor: FILE_COLOR[language] ?? "#666",
        color: ["javascript", "json"].includes(language) ? "#111" : "#fff",
        fontSize: size <= 14 ? 7 : 9,
        fontWeight: 700,
        fontFamily: "monospace",
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {FILE_LETTER[language] ?? "?"}
    </span>
  );
}

const inferLanguage = (fileName: string): FileLanguage | null => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG_MAP[ext] ?? null;
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
    <title>My App</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div class="container">
      <h1>Hello, World!</h1>
      <p>Edit the files in the explorer and click <strong>Run All</strong> to see your changes.</p>
      <button id="greetBtn" class="btn">Say Hello</button>
      <div id="output" class="output"></div>
    </div>
    <script src="script.js"></script>
  </body>
</html>`,
  },
  {
    id: createId(),
    name: "styles.css",
    language: "css",
    content: `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #e2e8f0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

.container {
  text-align: center;
  padding: 2rem;
  max-width: 560px;
}

h1 {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(90deg, #38bdf8, #818cf8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 1rem;
}

p {
  color: #94a3b8;
  margin-bottom: 1.5rem;
  line-height: 1.6;
}

.btn {
  padding: 0.6rem 1.4rem;
  border: 1px solid #38bdf8;
  background: transparent;
  color: #38bdf8;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.btn:hover {
  background: #38bdf8;
  color: #0f172a;
}

.output {
  margin-top: 1.2rem;
  min-height: 40px;
  font-size: 1.1rem;
  color: #818cf8;
}`,
  },
  {
    id: createId(),
    name: "script.js",
    language: "javascript",
    content: `const btn = document.getElementById("greetBtn");
const output = document.getElementById("output");

const greetings = [
  "Hello, World! 👋",
  "Bonjour le monde! 🇫🇷",
  "Hola Mundo! 🌍",
  "Ciao Mondo! 🇮🇹",
  "Olá Mundo! 🇧🇷",
];

let index = 0;

btn?.addEventListener("click", () => {
  output.textContent = greetings[index % greetings.length];
  output.style.opacity = "0";
  requestAnimationFrame(() => {
    output.style.transition = "opacity 0.3s";
    output.style.opacity = "1";
  });
  index++;
  console.log("Greeting shown:", greetings[(index - 1) % greetings.length]);
});`,
  },
];

const buildPreviewDocument = (files: ProjectFile[]) => {
  const html = files.find((f) => f.language === "html")?.content ?? "<body></body>";
  const css = files
    .filter((f) => f.language === "css")
    .map((f) => f.content)
    .join("\n\n");
  const js = files
    .filter((f) => f.language === "javascript")
    .map((f) => f.content)
    .join("\n\n");

  const bridge = `<script>
(() => {
  const send = (level, args) => {
    const message = args.map((a) => {
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ");
    parent.postMessage({ source: "preview-console", level, message }, "*");
  };
  ["log", "warn", "error"].forEach((level) => {
    const orig = console[level];
    console[level] = (...args) => { send(level, args); orig.apply(console, args); };
  });
  window.addEventListener("error", (e) => {
    parent.postMessage({ source: "preview-console", level: "error", message: e.message }, "*");
  });
})();
</script>`;

  let output = html;
  if (!output.toLowerCase().includes("<html")) {
    output = `<!doctype html><html><head></head><body>${output}</body></html>`;
  }
  output = output.includes("</head>")
    ? output.replace("</head>", `<style>${css}</style></head>`)
    : `<style>${css}</style>${output}`;
  output = output.includes("</body>")
    ? output.replace("</body>", `${bridge}<script>${js}</script></body>`)
    : `${output}${bridge}<script>${js}</script>`;
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

const BROWSER_API_RE =
  /\b(document|window\.location|window\.history|navigator\b|localStorage|sessionStorage|XMLHttpRequest|addEventListener\s*\(|removeEventListener\s*\(|querySelector|getElementById|innerHTML|createElement)\b/;

export default function App() {
  const initialFiles = useMemo(() => seedFiles(), []);
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [previewDoc, setPreviewDoc] = useState(buildPreviewDocument(initialFiles));
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [markersByFile, setMarkersByFile] = useState<Record<string, number>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const [cursorPos, setCursorPos] = useState<CursorPos>({ line: 1, col: 1 });
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [activityId, setActivityId] = useState<ActivityId>("explorer");
  const [searchQuery, setSearchQuery] = useState("");
  const [wordWrap, setWordWrap] = useState<"on" | "off">("on");
  const [showMinimap, setShowMinimap] = useState(false);
  const [autoSave, setAutoSave] = useState(false);

  const [groups, setGroups] = useState<Record<GroupId, EditorGroupState>>({
    primary: { tabs: initialFiles.map((f) => f.id), activeId: initialFiles[0]?.id ?? null },
    secondary: emptyGroup(),
  });
  const [focusedGroup, setFocusedGroup] = useState<GroupId>("primary");
  const [draggedTab, setDraggedTab] = useState<{ fileId: string; fromGroup: GroupId } | null>(null);

  const [nodeCommand, setNodeCommand] = useState("node script.js");
  const [terminalInput, setTerminalInput] = useState("");
  const [menuOpen, setMenuOpen] = useState<MenuKey | null>(null);
  const [isRunningJsOnly, setIsRunningJsOnly] = useState(false);
  const [isRunningCommand, setIsRunningCommand] = useState(false);

  const [isPanelOpen, setIsPanelOpenRaw] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [editorWidthPercent, setEditorWidthPercent] = useState(60);
  const [panelHeight, setPanelHeight] = useState(200);
  const [drag, setDrag] = useState<{
    type: DragType;
    startX: number;
    startY: number;
    startValue: number;
  } | null>(null);

  const topPanelRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const editorRefs = useRef<
    Partial<
      Record<
        GroupId,
        Parameters<NonNullable<ComponentProps<typeof Editor>["onMount"]>>[0]
      >
    >
  >({});

  const isDark = theme === "dark";
  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const activeFileId = groups[focusedGroup].activeId;
  const activeFile = activeFileId ? (fileMap.get(activeFileId) ?? null) : null;
  const totalMarkers = Object.values(markersByFile).reduce((a, b) => a + b, 0);

  const isUnsaved = useCallback(
    (fileId: string) => {
      const file = fileMap.get(fileId);
      if (!file) return false;
      if (!(fileId in savedContents)) return false;
      return savedContents[fileId] !== file.content;
    },
    [fileMap, savedContents]
  );

  const appendConsole = useCallback((level: ConsoleLevel, message: string) => {
    setConsoleEntries((prev) => [...prev, { id: createId(), level, message }]);
  }, []);

  const appendSystem = useCallback(
    (message: string) => appendConsole("system", message),
    [appendConsole]
  );

  const callRunnerApi = useCallback(async (path: string, body: unknown) => {
    const candidates = resolveApiCandidates();
    let lastError: string | null = null;
    for (const base of candidates) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return (await res.json()) as RunnerPayload;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Failed to contact backend";
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
      const nextActive =
        group.activeId === fileId ? (nextTabs[nextTabs.length - 1] ?? null) : group.activeId;
      return { ...prev, [groupId]: { tabs: nextTabs, activeId: nextActive } };
    });
  }, []);

  const moveTab = useCallback(
    (fromGroup: GroupId, toGroup: GroupId, fileId: string, toIndex?: number) => {
      setGroups((prev) => {
        const fromTabs = prev[fromGroup].tabs.filter((id) => id !== fileId);
        const targetBase = prev[toGroup].tabs.filter((id) => id !== fileId);
        const at =
          typeof toIndex === "number"
            ? Math.min(Math.max(0, toIndex), targetBase.length)
            : targetBase.length;
        const targetTabs = [...targetBase.slice(0, at), fileId, ...targetBase.slice(at)];
        return {
          ...prev,
          [fromGroup]: {
            tabs: fromTabs,
            activeId:
              prev[fromGroup].activeId === fileId
                ? (fromTabs[Math.max(0, Math.min(at, fromTabs.length - 1))] ?? null)
                : prev[fromGroup].activeId,
          },
          [toGroup]: { tabs: targetTabs, activeId: fileId },
        };
      });
      setFocusedGroup(toGroup);
    },
    []
  );

  const splitActiveTab = useCallback(() => {
    const cur = groups[focusedGroup];
    if (!cur.activeId) return;
    const target: GroupId = focusedGroup === "primary" ? "secondary" : "primary";
    moveTab(focusedGroup, target, cur.activeId);
  }, [focusedGroup, groups, moveTab]);

  const runJsInBrowserIframe = useCallback(
    (code: string): Promise<void> => {
      return new Promise((resolve) => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin"
        );
        Object.assign(iframe.style, {
          position: "fixed",
          opacity: "0",
          pointerEvents: "none",
          width: "1px",
          height: "1px",
          left: "-9999px",
          top: "-9999px",
        });
        document.body.appendChild(iframe);

        let done = false;
        const cleanup = () => {
          if (!done) {
            done = true;
            window.removeEventListener("message", onMsg);
            clearTimeout(timer);
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
            resolve();
          }
        };

        const timer = setTimeout(() => {
          appendSystem("Script timed out after 10 s.");
          cleanup();
        }, 10000);

        const onMsg = (e: MessageEvent) => {
          if (e.data?.source !== "iframe-js-runner") return;
          if (e.data.type === "log") {
            const lv: ConsoleLevel =
              e.data.level === "warn"
                ? "warn"
                : e.data.level === "error"
                  ? "error"
                  : "log";
            appendConsole(lv, String(e.data.message ?? ""));
          } else if (e.data.type === "done") {
            cleanup();
          }
        };
        window.addEventListener("message", onMsg);

        const escaped = code
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/<\/script>/gi, "<\\/script>");

        const html = `<!doctype html><html><body><script>
(function(){
  var send = function(level,msg){
    try{ parent.postMessage({source:'iframe-js-runner',type:'log',level:level,message:msg},'*'); }catch(e){}
  };
  var _c = {
    log: function(){send('log', Array.prototype.slice.call(arguments).map(function(a){return typeof a==='string'?a:JSON.stringify(a);}).join(' '));},
    warn: function(){send('warn', Array.prototype.slice.call(arguments).map(function(a){return typeof a==='string'?a:JSON.stringify(a);}).join(' '));},
    error: function(){send('error', Array.prototype.slice.call(arguments).map(function(a){return typeof a==='string'?a:JSON.stringify(a);}).join(' '));}
  };
  console.log = _c.log; console.warn = _c.warn; console.error = _c.error;
  window.addEventListener('error', function(e){ send('error', e.message); parent.postMessage({source:'iframe-js-runner',type:'done'},'*'); });
  try{
    (function(console){ ${escaped} })(_c);
  }catch(e){
    send('error', e && e.message ? e.message : String(e));
  }
  parent.postMessage({source:'iframe-js-runner',type:'done'},'*');
})();
<\/script></body></html>`;

        const doc = iframe.contentDocument;
        if (!doc) { cleanup(); return; }
        doc.open();
        doc.write(html);
        doc.close();
      });
    },
    [appendConsole, appendSystem]
  );

  const runNodeCommandInBrowser = useCallback(
    (command: string) => {
      const parts = command.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2 || parts[0] !== "node" || !/^[./a-zA-Z0-9_-]+\.js$/.test(parts[1])) {
        appendSystem("Unsupported command. Use: node <file.js> [args]");
        return;
      }
      const fileName = parts[1];
      const args = parts.slice(2);
      const jsFiles = new Map(
        files.filter((f) => f.language === "javascript").map((f) => [f.name, f.content])
      );
      if (!jsFiles.has(fileName)) {
        appendConsole("error", `File not found: ${fileName}`);
        return;
      }
      const src = jsFiles.get(fileName) ?? "";
      if (BROWSER_API_RE.test(src)) {
        appendConsole(
          "warn",
          `${fileName} uses browser APIs (document, window, etc.) which are not available in Node.js.\n  → Use "Run All" to run it in the browser preview, or rewrite it without DOM calls.`
        );
        return;
      }
      appendSystem("Backend unavailable — running in browser Node-like runtime.");
      const pushLog = (level: "log" | "warn" | "error", a: unknown[]) => {
        appendConsole(
          level,
          a
            .map((x) => {
              if (typeof x === "string") return x;
              try {
                return JSON.stringify(x);
              } catch {
                return String(x);
              }
            })
            .join(" ")
        );
      };
      const cache = new Map<string, { exports: unknown }>();
      const resolvePath = (from: string, spec: string) => {
        if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
        const parts2 = from.split("/");
        parts2.pop();
        const segs = [...parts2, ...spec.split("/")];
        const norm: string[] = [];
        segs.forEach((s) => {
          if (!s || s === ".") return;
          if (s === "..") { norm.pop(); return; }
          norm.push(s);
        });
        const r = norm.join("/");
        return r.endsWith(".js") ? r : `${r}.js`;
      };
      const runModule = (fn: string): unknown => {
        const cached = cache.get(fn);
        if (cached) return cached.exports;
        const code = jsFiles.get(fn);
        if (!code) throw new Error(`Cannot find module '${fn}'`);
        const mod = { exports: {} as unknown };
        cache.set(fn, mod);
        const localRequire = (spec: string) => {
          const r = resolvePath(fn, spec);
          if (!r) throw new Error(`Only relative requires supported. Got: ${spec}`);
          return runModule(r);
        };
        const dir = fn.includes("/") ? fn.slice(0, fn.lastIndexOf("/")) : ".";
        const wrapped = new Function(
          "require", "module", "exports", "console", "process", "__filename", "__dirname",
          `"use strict";\n${code}`
        );
        wrapped(
          localRequire, mod, mod.exports,
          { log: (...a: unknown[]) => pushLog("log", a), warn: (...a: unknown[]) => pushLog("warn", a), error: (...a: unknown[]) => pushLog("error", a) },
          { argv: ["node", fn, ...args], env: {}, platform: "browser", cwd: () => "/" },
          fn, dir
        );
        return mod.exports;
      };
      try { runModule(fileName); } catch (e) {
        appendConsole("error", e instanceof Error ? e.message : "Runtime error");
      }
    },
    [appendConsole, appendSystem, files]
  );

  const runAll = useCallback(() => {
    appendSystem("▶ Run All");
    setPreviewDoc(buildPreviewDocument(files));
  }, [appendSystem, files]);

  const runJsOnly = useCallback(async () => {
    const jsFile =
      activeFile?.language === "javascript"
        ? activeFile
        : files.find((f) => f.language === "javascript");
    if (!jsFile) { appendSystem("No JavaScript file found."); return; }

    const usesBrowserApis = BROWSER_API_RE.test(jsFile.content);
    setIsRunningJsOnly(true);
    appendSystem(`▶ Run JS: ${jsFile.name}${usesBrowserApis ? " (browser mode)" : ""}`);

    if (usesBrowserApis) {
      appendSystem(
        "File uses browser APIs — running in isolated browser iframe.\n  Note: DOM elements from index.html are not available here. Use 'Run All' to see DOM interactions."
      );
      await runJsInBrowserIframe(jsFile.content);
      setIsRunningJsOnly(false);
      return;
    }

    try {
      const payload = await callRunnerApi("/api/run-js", { code: jsFile.content });
      (payload.logs ?? []).forEach((entry) => {
        const lv = entry.level === "warn" || entry.level === "error" ? entry.level : "log";
        appendConsole(lv, entry.level === "result" ? `↩ ${entry.message}` : entry.message);
      });
      if (!payload.ok) {
        const errMsg = payload.error ?? "Execution failed.";
        if (/document|window|navigator|localStorage/i.test(errMsg)) {
          appendConsole("warn", "Detected browser API usage. Re-running in browser iframe...");
          await runJsInBrowserIframe(jsFile.content);
        } else {
          appendConsole("error", errMsg);
        }
      }
    } catch {
      appendSystem("Backend unavailable — running in browser iframe.");
      await runJsInBrowserIframe(jsFile.content);
    } finally {
      setIsRunningJsOnly(false);
    }
  }, [activeFile, appendConsole, appendSystem, callRunnerApi, files, runJsInBrowserIframe]);

  const runNodeCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) { appendSystem("Enter a command, e.g. node script.js"); return; }
      appendSystem(`$ ${trimmed}`);
      setIsRunningCommand(true);
      setNodeCommand(trimmed);
      try {
        const payload = await callRunnerApi("/api/run-command", {
          command: trimmed,
          files: files
            .filter((f) => f.language === "javascript")
            .map((f) => ({ name: f.name, content: f.content })),
        });
        (payload.logs ?? []).forEach((entry) => {
          const lv = entry.level === "warn" || entry.level === "error" ? entry.level : "log";
          appendConsole(lv, entry.level === "result" ? `↩ ${entry.message}` : entry.message);
        });
        if (!payload.ok) {
          const errMsg = payload.error ?? "Command failed.";
          if (/document is not defined|window is not defined|navigator is not defined/i.test(errMsg)) {
            const fileName = trimmed.replace(/^node\s+/, "").split(/\s+/)[0];
            appendConsole(
              "warn",
              `${fileName} uses browser APIs (document, window…) which are not available in Node.js.\n  → Use "Run All" to render it in the browser preview.`
            );
          } else {
            appendConsole("error", errMsg);
          }
        }
      } catch {
        runNodeCommandInBrowser(trimmed);
      } finally {
        setIsRunningCommand(false);
      }
    },
    [appendConsole, appendSystem, callRunnerApi, files, runNodeCommandInBrowser]
  );

  const createFile = useCallback(() => {
    const name = window.prompt("New file name (.html .css .js .ts .tsx .json .md)", "new.js")?.trim() ?? "";
    if (!name) return;
    const language = inferLanguage(name);
    if (!language) { appendSystem("Unsupported extension. Use .html .css .js .ts .tsx .json .md"); return; }
    if (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      appendSystem("A file with that name already exists.");
      return;
    }
    const newFile: ProjectFile = { id: createId(), name, language, content: "" };
    setFiles((prev) => [...prev, newFile]);
    openFileInGroup(newFile.id, focusedGroup);
  }, [appendSystem, files, focusedGroup, openFileInGroup]);

  const renameFile = useCallback(
    (fileId: string) => {
      const target = fileMap.get(fileId);
      if (!target) return;
      const next = window.prompt("Rename file", target.name)?.trim() ?? "";
      if (!next || next === target.name) return;
      const nextLang = inferLanguage(next);
      if (!nextLang) { appendSystem("Unsupported extension."); return; }
      if (files.some((f) => f.id !== fileId && f.name.toLowerCase() === next.toLowerCase())) {
        appendSystem("Name already taken.");
        return;
      }
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, name: next, language: nextLang } : f))
      );
    },
    [appendSystem, fileMap, files]
  );

  const deleteFile = useCallback(
    (fileId: string) => {
      const target = fileMap.get(fileId);
      if (!target || !window.confirm(`Delete ${target.name}?`)) return;
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setGroups((prev) => {
        const next = { ...prev };
        (["primary", "secondary"] as GroupId[]).forEach((gid) => {
          const tabs = next[gid].tabs.filter((id) => id !== fileId);
          const activeId =
            next[gid].activeId === fileId ? (tabs[tabs.length - 1] ?? null) : next[gid].activeId;
          next[gid] = { tabs, activeId };
        });
        return next;
      });
    },
    [fileMap]
  );

  const updateFileContent = useCallback((fileId: string, content: string) => {
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, content } : f)));
  }, []);

  const saveProject = useCallback(() => {
    const snapshot: Record<string, string> = {};
    files.forEach((f) => { snapshot[f.id] = f.content; });
    setSavedContents(snapshot);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, groups, theme }));
    appendSystem("✓ Project saved");
  }, [appendSystem, files, groups, theme]);

  const loadProject = useCallback(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { appendSystem("No saved project found."); return; }
    try {
      const parsed = JSON.parse(raw) as {
        files?: ProjectFile[];
        groups?: Record<GroupId, EditorGroupState>;
        theme?: ThemeMode;
      };
      const restored = (parsed.files ?? []).filter(
        (f): f is ProjectFile =>
          typeof f?.id === "string" &&
          typeof f?.name === "string" &&
          typeof f?.content === "string" &&
          inferLanguage(f.name) !== null
      );
      if (!restored.length) { appendSystem("Saved project is empty."); return; }
      const ids = new Set(restored.map((f) => f.id));
      const norm = (g?: EditorGroupState): EditorGroupState => {
        const tabs = (g?.tabs ?? []).filter((id) => ids.has(id));
        return { tabs, activeId: g?.activeId && tabs.includes(g.activeId) ? g.activeId : (tabs[0] ?? null) };
      };
      const nextGroups: Record<GroupId, EditorGroupState> = {
        primary: norm(parsed.groups?.primary),
        secondary: norm(parsed.groups?.secondary),
      };
      if (!nextGroups.primary.tabs.length) {
        nextGroups.primary = { tabs: restored.map((f) => f.id), activeId: restored[0].id };
      }
      const snapshot: Record<string, string> = {};
      restored.forEach((f) => { snapshot[f.id] = f.content; });
      setFiles(restored);
      setGroups(nextGroups);
      setSavedContents(snapshot);
      setTheme(parsed.theme === "light" ? "light" : "dark");
      setPreviewDoc(buildPreviewDocument(restored));
      appendSystem("✓ Project loaded");
    } catch { appendSystem("Failed to parse saved project."); }
  }, [appendSystem]);

  const downloadProject = useCallback(async () => {
    const zip = new JSZip();
    files.forEach((f) => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "webcode-studio.zip";
    a.click();
    URL.revokeObjectURL(url);
    appendSystem("✓ ZIP downloaded");
  }, [appendSystem, files]);

  const formatActive = useCallback(() => {
    editorRefs.current[focusedGroup]?.getAction("editor.action.formatDocument")?.run();
  }, [focusedGroup]);

  const openPreviewInNewTab = useCallback(() => {
    const doc = buildPreviewDocument(files);
    const win = window.open("", "_blank");
    if (!win) { appendSystem("Popup blocked."); return; }
    win.document.open();
    win.document.write(doc);
    win.document.close();
  }, [appendSystem, files]);

  const executeTerminalCommand = useCallback(
    async (raw: string) => {
      const cmd = raw.trim();
      if (!cmd) return;
      appendSystem(`$ ${cmd}`);
      const cmdMap: Record<string, () => void | Promise<void>> = {
        "run all": runAll,
        "run js": () => runJsOnly(),
        clear: () => setConsoleEntries([]),
        format: formatActive,
        save: saveProject,
        load: loadProject,
        zip: () => downloadProject(),
        help: () =>
          appendConsole(
            "system",
            "Commands: run all, run js, node <file.js>, clear, format, save, load, zip"
          ),
      };
      if (cmd in cmdMap) { await cmdMap[cmd](); return; }
      if (cmd.startsWith("node ")) { await runNodeCommand(cmd); return; }
      appendConsole("warn", `Unknown command: "${cmd}". Type help for available commands.`);
    },
    [appendConsole, appendSystem, downloadProject, formatActive, loadProject, runAll, runJsOnly, runNodeCommand, saveProject]
  );

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: Array<{ file: ProjectFile; lines: Array<{ lineNum: number; text: string }> }> = [];
    for (const file of files) {
      const lines = file.content.split("\n");
      const matched = lines
        .map((text, i) => ({ lineNum: i + 1, text }))
        .filter(({ text }) => text.toLowerCase().includes(q));
      if (matched.length) results.push({ file, lines: matched });
    }
    return results;
  }, [files, searchQuery]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        files?: ProjectFile[];
        groups?: Record<GroupId, EditorGroupState>;
        theme?: ThemeMode;
      };
      if (!parsed.files?.length) return;
      const restored = parsed.files.filter(
        (f): f is ProjectFile =>
          typeof f?.id === "string" &&
          typeof f?.name === "string" &&
          typeof f?.content === "string" &&
          inferLanguage(f.name) !== null
      );
      if (!restored.length) return;
      const ids = new Set(restored.map((f) => f.id));
      const norm = (g?: EditorGroupState): EditorGroupState => {
        const tabs = (g?.tabs ?? []).filter((id) => ids.has(id));
        return { tabs, activeId: g?.activeId && tabs.includes(g.activeId) ? g.activeId : (tabs[0] ?? null) };
      };
      const nextGroups: Record<GroupId, EditorGroupState> = {
        primary: norm(parsed.groups?.primary),
        secondary: norm(parsed.groups?.secondary),
      };
      if (!nextGroups.primary.tabs.length) {
        nextGroups.primary = { tabs: restored.map((f) => f.id), activeId: restored[0].id };
      }
      const snapshot: Record<string, string> = {};
      restored.forEach((f) => { snapshot[f.id] = f.content; });
      setFiles(restored);
      setGroups(nextGroups);
      setSavedContents(snapshot);
      setTheme(parsed.theme === "light" ? "light" : "dark");
      setPreviewDoc(buildPreviewDocument(restored));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const receiveMessage = (e: MessageEvent) => {
      if (e.data?.source !== "preview-console") return;
      const lv = e.data.level === "warn" || e.data.level === "error" ? e.data.level : "log";
      appendConsole(lv, String(e.data.message ?? ""));
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [appendConsole]);

  useEffect(() => {
    if (autoSave) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, groups, theme }));
    }
  }, [files, groups, theme, autoSave]);

  useEffect(() => {
    setGroups((prev) => {
      const available = new Set(files.map((f) => f.id));
      const clean = (g: EditorGroupState): EditorGroupState => {
        const tabs = g.tabs.filter((id) => available.has(id));
        return { tabs, activeId: g.activeId && tabs.includes(g.activeId) ? g.activeId : (tabs[0] ?? null) };
      };
      const np = clean(prev.primary);
      const ns = clean(prev.secondary);
      if (!np.tabs.length && files.length) {
        return { primary: { tabs: files.map((f) => f.id), activeId: files[0].id }, secondary: ns };
      }
      return { primary: np, secondary: ns };
    });
  }, [files]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleEntries]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      if (drag.type === "sidebar") {
        setSidebarWidth(Math.min(500, Math.max(160, drag.startValue + (e.clientX - drag.startX))));
        return;
      }
      if (drag.type === "preview") {
        const w = topPanelRef.current?.getBoundingClientRect().width ?? 0;
        if (w < 200) return;
        const delta = ((e.clientX - drag.startX) / w) * 100;
        setEditorWidthPercent(Math.min(85, Math.max(20, drag.startValue + delta)));
        return;
      }
      const h = workspaceRef.current?.getBoundingClientRect().height ?? 0;
      if (h < 200) return;
      setPanelHeight(Math.min(500, Math.max(100, drag.startValue + (drag.startY - e.clientY))));
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") { e.preventDefault(); saveProject(); }
      if (ctrl && e.key === "`") { e.preventDefault(); setIsPanelOpenRaw((p) => !p); }
      if (ctrl && e.key === "\\") { e.preventDefault(); splitActiveTab(); }
      if (ctrl && e.key === "w") { e.preventDefault(); if (activeFileId) closeTab(focusedGroup, activeFileId); }
      if (ctrl && e.key === "n") { e.preventDefault(); createFile(); }
      if (e.key === "Escape") setMenuOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveProject, splitActiveTab, activeFileId, closeTab, focusedGroup, createFile]);


  const menuItems: Record<MenuKey, Array<{ label: string; shortcut?: string; action: () => void }>> = {
    File: [
      { label: "New File", shortcut: "Ctrl+N", action: createFile },
      { label: "Save", shortcut: "Ctrl+S", action: saveProject },
      { label: "Load from Storage", action: loadProject },
      { label: "Download as ZIP", action: () => void downloadProject() },
    ],
    Edit: [
      { label: "Format Document", action: formatActive },
      { label: "Rename File", action: () => { if (activeFile) renameFile(activeFile.id); } },
      { label: "Delete File", action: () => { if (activeFile) deleteFile(activeFile.id); } },
      { label: "Split Editor", shortcut: "Ctrl+\\", action: splitActiveTab },
    ],
    View: [
      { label: isPanelOpen ? "Hide Panel" : "Show Panel", shortcut: "Ctrl+`", action: () => setIsPanelOpenRaw((p) => !p) },
      { label: wordWrap === "on" ? "Disable Word Wrap" : "Enable Word Wrap", action: () => setWordWrap((p) => (p === "on" ? "off" : "on")) },
      { label: showMinimap ? "Hide Minimap" : "Show Minimap", action: () => setShowMinimap((p) => !p) },
      { label: autoSave ? "Disable Auto Save" : "Enable Auto Save", action: () => setAutoSave((p) => !p) },
      { label: "Open Preview in New Tab", action: openPreviewInNewTab },
      { label: isDark ? "Light Theme" : "Dark Theme", action: () => setTheme((p) => (p === "dark" ? "light" : "dark")) },
    ],
    Run: [
      { label: "Run All (HTML+CSS+JS)", action: runAll },
      { label: "Run JS Only", action: () => void runJsOnly() },
      { label: "Run Node Command", action: () => void runNodeCommand(nodeCommand) },
    ],
  };

  const renderEditorGroup = (groupId: GroupId) => {
    const group = groups[groupId];
    const gFile = group.activeId ? (fileMap.get(group.activeId) ?? null) : null;
    const isActive = groupId === focusedGroup;

    return (
      <section
        key={groupId}
        className="flex min-w-0 flex-1 flex-col"
        style={{ borderRight: `1px solid ${isDark ? "#3c3c3c" : "#e5e5e5"}` }}
        onClick={() => setFocusedGroup(groupId)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!draggedTab) return;
          moveTab(draggedTab.fromGroup, groupId, draggedTab.fileId);
          setDraggedTab(null);
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            height: 36,
            background: isDark ? "#2d2d30" : "#f3f3f3",
            borderBottom: `1px solid ${isDark ? "#3c3c3c" : "#e5e5e5"}`,
            paddingLeft: 4,
            overflowX: "auto",
            overflowY: "hidden",
            scrollbarWidth: "none",
          }}
        >
          {group.tabs.map((fileId, index) => {
            const file = fileMap.get(fileId);
            if (!file) return null;
            const active = group.activeId === fileId;
            const unsaved = isUnsaved(fileId);
            return (
              <div
                key={`${groupId}-${file.id}`}
                draggable
                onDragStart={() => setDraggedTab({ fileId: file.id, fromGroup: groupId })}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!draggedTab) return;
                  moveTab(draggedTab.fromGroup, groupId, draggedTab.fileId, index);
                  setDraggedTab(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  paddingLeft: 12,
                  paddingRight: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  borderTop: active && isActive ? "1px solid #007acc" : "1px solid transparent",
                  background: active ? (isDark ? "#1e1e1e" : "#ffffff") : "transparent",
                  color: active ? (isDark ? "#cccccc" : "#333333") : (isDark ? "#858585" : "#6e6e6e"),
                  position: "relative",
                  userSelect: "none",
                }}
                onClick={() => openFileInGroup(file.id, groupId)}
              >
                <FileIcon language={file.language} />
                <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {file.name}
                </span>
                {unsaved && (
                  <span style={{ color: isDark ? "#cccccc" : "#333333", fontSize: 16, lineHeight: 1, marginLeft: -2, marginRight: -2 }}>
                    ●
                  </span>
                )}
                <button
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    cursor: "pointer",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                    opacity: 0.6,
                    borderRadius: 3,
                  }}
                  onClick={(e) => { e.stopPropagation(); closeTab(groupId, file.id); }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = isDark ? "#555" : "#ddd"; (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.opacity = "0.6"; }}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Breadcrumb */}
        {gFile && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              height: 26,
              paddingLeft: 12,
              fontSize: 12,
              background: isDark ? "#1e1e1e" : "#ffffff",
              borderBottom: `1px solid ${isDark ? "#3c3c3c" : "#e5e5e5"}`,
              color: isDark ? "#858585" : "#6e6e6e",
            }}
          >
            <span>project</span>
            <ChevronRight size={12} />
            <FileIcon language={gFile.language} size={12} />
            <span style={{ color: isDark ? "#cccccc" : "#333" }}>{gFile.name}</span>
          </div>
        )}

        {gFile ? (
          <Editor
            path={`${groupId}:${gFile.name}`}
            language={gFile.language}
            value={gFile.content}
            onMount={(editor) => {
              editorRefs.current[groupId] = editor;
              editor.onDidChangeCursorPosition((e) => {
                if (groupId === focusedGroup) {
                  setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                }
              });
            }}
            onValidate={(markers) => {
              setMarkersByFile((prev) => ({ ...prev, [gFile.id]: markers.length }));
            }}
            onChange={(value) => updateFileContent(gFile.id, value ?? "")}
            theme={isDark ? "vs-dark" : "light"}
            height={`calc(100% - ${26 + 36}px)`}
            options={{
              minimap: { enabled: showMinimap },
              fontSize: 14,
              lineNumbers: "on",
              automaticLayout: true,
              formatOnPaste: true,
              formatOnType: false,
              suggestOnTriggerCharacters: true,
              wordWrap,
              autoClosingBrackets: "always",
              autoClosingQuotes: "always",
              quickSuggestions: { other: true, comments: false, strings: true },
              tabSize: 2,
              renderLineHighlight: "line",
              smoothScrolling: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              renderWhitespace: "selection",
              scrollBeyondLastLine: false,
              padding: { top: 8, bottom: 8 },
            }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isDark ? "#1e1e1e" : "#ffffff",
              color: isDark ? "#404040" : "#cccccc",
              fontSize: 13,
            }}
          >
            Open a file from the Explorer
          </div>
        )}
      </section>
    );
  };

  const colors = {
    activityBar: isDark ? "#333333" : "#2c2c2c",
    activityBarText: isDark ? "#858585" : "#aaaaaa",
    activityBarActive: "#ffffff",
    sidebar: isDark ? "#252526" : "#f3f3f3",
    sidebarText: isDark ? "#cccccc" : "#333333",
    sidebarMuted: isDark ? "#858585" : "#888888",
    border: isDark ? "#3c3c3c" : "#e5e5e5",
    editorBg: isDark ? "#1e1e1e" : "#ffffff",
    panelBg: isDark ? "#1e1e1e" : "#f3f3f3",
    panelHeader: isDark ? "#252526" : "#e8e8e8",
    statusBar: "#007acc",
    menuBar: isDark ? "#3c3c3c" : "#dddddd",
    toolbarBg: isDark ? "#252526" : "#f3f3f3",
  };

  return (
    <div
      style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: colors.editorBg }}
      onClick={() => { if (menuOpen) setMenuOpen(null); }}
    >
      {/* Menu bar */}
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 8,
          paddingRight: 12,
          fontSize: 13,
          background: isDark ? "#3c3c3c" : "#dddddd",
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 12, marginRight: 12, color: isDark ? "#cccccc" : "#333" }}>
            ⬛ WebCode Studio
          </span>
          {(Object.keys(menuItems) as MenuKey[]).map((menu) => (
            <div key={menu} style={{ position: "relative" }}>
              <button
                style={{
                  background: menuOpen === menu ? (isDark ? "#505050" : "#c0c0c0") : "none",
                  border: "none",
                  color: isDark ? "#cccccc" : "#333333",
                  padding: "3px 8px",
                  cursor: "pointer",
                  fontSize: 13,
                  borderRadius: 3,
                }}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((p) => (p === menu ? null : menu)); }}
              >
                {menu}
              </button>
              {menuOpen === menu && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    zIndex: 100,
                    minWidth: 220,
                    background: isDark ? "#252526" : "#f5f5f5",
                    border: `1px solid ${colors.border}`,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                    borderRadius: 4,
                    paddingTop: 4,
                    paddingBottom: 4,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {menuItems[menu].map((item) => (
                    <button
                      key={item.label}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 12px",
                        background: "none",
                        border: "none",
                        color: isDark ? "#cccccc" : "#333333",
                        cursor: "pointer",
                        fontSize: 13,
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = isDark ? "#094771" : "#0060c0"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = isDark ? "#cccccc" : "#333333"; }}
                      onClick={() => { item.action(); setMenuOpen(null); }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 24 }}>{item.shortcut}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setTheme((p) => (p === "dark" ? "light" : "dark"))}
            style={{
              background: "none",
              border: `1px solid ${colors.border}`,
              color: isDark ? "#cccccc" : "#333",
              borderRadius: 4,
              padding: "2px 8px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {isDark ? "☀ Light" : "● Dark"}
          </button>
        </div>
      </div>

      {/* Main workspace */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }} ref={workspaceRef}>
        {/* Activity bar */}
        <div
          style={{
            width: 48,
            background: colors.activityBar,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 8,
            gap: 4,
            flexShrink: 0,
            borderRight: `1px solid ${isDark ? "#222" : "#bbb"}`,
          }}
        >
          {(
            [
              { id: "explorer" as ActivityId, icon: <Files size={24} />, label: "Explorer" },
              { id: "search" as ActivityId, icon: <Search size={24} />, label: "Search" },
              { id: "git" as ActivityId, icon: <GitBranch size={24} />, label: "Source Control" },
            ] as const
          ).map(({ id, icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setActivityId(id)}
              style={{
                background: "none",
                border: "none",
                color: activityId === id ? colors.activityBarActive : colors.activityBarText,
                borderLeft: activityId === id ? "2px solid #fff" : "2px solid transparent",
                padding: "8px 0",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {icon}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            title="Settings"
            style={{
              background: "none",
              border: "none",
              color: colors.activityBarText,
              padding: "8px 0",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              marginBottom: 4,
            }}
          >
            <Settings size={24} />
          </button>
        </div>

        {/* Sidebar */}
        <div
          style={{
            width: sidebarWidth,
            background: colors.sidebar,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${colors.border}`,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Sidebar header */}
          <div
            style={{
              height: 35,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingLeft: 12,
              paddingRight: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: colors.sidebarMuted,
              textTransform: "uppercase",
              borderBottom: `1px solid ${colors.border}`,
              flexShrink: 0,
            }}
          >
            {activityId === "explorer" && "Explorer"}
            {activityId === "search" && "Search"}
            {activityId === "git" && "Source Control"}
            {activityId === "explorer" && (
              <button
                title="New File (Ctrl+N)"
                onClick={createFile}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.sidebarMuted,
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = colors.sidebarText; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = colors.sidebarMuted; }}
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {/* Explorer content */}
          {activityId === "explorer" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  paddingLeft: 12,
                  paddingRight: 8,
                  height: 28,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  color: colors.sidebarMuted,
                  textTransform: "uppercase",
                  flexShrink: 0,
                }}
              >
                <FolderOpen size={14} />
                <span>Project</span>
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {files.map((file) => {
                  const isActive = file.id === activeFileId;
                  const unsaved = isUnsaved(file.id);
                  return (
                    <div
                      key={file.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        paddingLeft: 20,
                        paddingRight: 6,
                        height: 28,
                        cursor: "pointer",
                        background: isActive ? (isDark ? "#094771" : "#cce4f7") : "transparent",
                        color: isActive ? (isDark ? "#ffffff" : "#000000") : colors.sidebarText,
                        fontSize: 13,
                      }}
                      onClick={() => openFileInGroup(file.id, focusedGroup)}
                      onMouseEnter={(e) => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = isDark ? "#2a2d2e" : "#e8e8e8";
                        const btns = (e.currentTarget as HTMLElement).querySelectorAll("button");
                        btns.forEach((b) => { (b as HTMLElement).style.display = "flex"; });
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                        const btns = (e.currentTarget as HTMLElement).querySelectorAll("button");
                        btns.forEach((b) => { (b as HTMLElement).style.display = "none"; });
                      }}
                    >
                      <span style={{ marginRight: 6, flexShrink: 0 }}>
                        <FileIcon language={file.language} />
                      </span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                        {unsaved && <span style={{ marginLeft: 4, color: isDark ? "#e2a85a" : "#e07000" }}>●</span>}
                      </span>
                      <div style={{ display: "flex", gap: 2, marginLeft: 4 }}>
                        {[
                          { label: "Rename", action: () => renameFile(file.id), char: "✎" },
                          { label: "Delete", action: () => deleteFile(file.id), char: "✕" },
                        ].map(({ label, action, char }) => (
                          <button
                            key={label}
                            title={label}
                            onClick={(e) => { e.stopPropagation(); action(); }}
                            style={{
                              display: "none",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "none",
                              border: "none",
                              color: colors.sidebarMuted,
                              cursor: "pointer",
                              fontSize: 12,
                              padding: "2px 4px",
                              borderRadius: 3,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = isDark ? "#555" : "#ccc"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                          >
                            {char}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Search content */}
          {activityId === "search" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "8px 12px" }}>
                <input
                  type="text"
                  placeholder="Search in files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    background: isDark ? "#3c3c3c" : "#ffffff",
                    border: `1px solid ${isDark ? "#555" : "#ccc"}`,
                    borderRadius: 3,
                    color: isDark ? "#cccccc" : "#333",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: "auto", fontSize: 12 }}>
                {searchQuery.trim() === "" && (
                  <div style={{ padding: "8px 12px", color: colors.sidebarMuted }}>
                    Type to search across all files.
                  </div>
                )}
                {searchResults.map(({ file, lines }) => (
                  <div key={file.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 12px",
                        color: colors.sidebarText,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                      onClick={() => openFileInGroup(file.id, focusedGroup)}
                    >
                      <FileIcon language={file.language} size={12} />
                      {file.name}
                      <span style={{ color: colors.sidebarMuted, fontWeight: 400, marginLeft: "auto" }}>
                        {lines.length}
                      </span>
                    </div>
                    {lines.slice(0, 5).map(({ lineNum, text }) => (
                      <div
                        key={lineNum}
                        style={{
                          paddingLeft: 28,
                          paddingRight: 12,
                          paddingTop: 2,
                          paddingBottom: 2,
                          color: colors.sidebarMuted,
                          fontFamily: "monospace",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "pointer",
                        }}
                        onClick={() => openFileInGroup(file.id, focusedGroup)}
                      >
                        <span style={{ color: isDark ? "#5a9bcf" : "#0070d5", marginRight: 8 }}>{lineNum}</span>
                        {text.trim()}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activityId === "git" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: colors.sidebarMuted, fontSize: 13, padding: 16, textAlign: "center" }}>
              <div>
                <GitBranch size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                <p>Source control is not available in the browser environment.</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar resize handle */}
        <div
          style={{
            width: 4,
            cursor: "col-resize",
            background: "transparent",
            flexShrink: 0,
          }}
          onMouseDown={(e) =>
            setDrag({ type: "sidebar", startX: e.clientX, startY: e.clientY, startValue: sidebarWidth })
          }
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#007acc55"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        />

        {/* Main editor area */}
        <main style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minWidth: 0 }}>
          {/* Action toolbar */}
          <div
            style={{
              height: 36,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "0 8px",
              background: colors.toolbarBg,
              borderBottom: `1px solid ${colors.border}`,
              flexShrink: 0,
              fontSize: 12,
            }}
          >
            {[
              { icon: <Play size={13} />, label: "Run All", action: runAll, primary: true },
              { icon: isRunningJsOnly ? <Square size={13} /> : <FileCode2 size={13} />, label: isRunningJsOnly ? "Running…" : "Run JS", action: () => void runJsOnly(), disabled: isRunningJsOnly },
              { icon: <Braces size={13} />, label: "Format", action: formatActive },
              { icon: <Save size={13} />, label: "Save", action: saveProject, shortcut: "Ctrl+S" },
              { icon: <Download size={13} />, label: "ZIP", action: () => void downloadProject() },
              { icon: <Columns2 size={13} />, label: "Split", action: splitActiveTab },
              { icon: <RefreshCw size={13} />, label: "Load", action: loadProject },
              { icon: <ExternalLink size={13} />, label: "Preview", action: openPreviewInNewTab },
            ].map(({ icon, label, action, primary, disabled }) => (
              <button
                key={label}
                title={label}
                onClick={action}
                disabled={disabled}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  background: primary ? "#007acc" : "transparent",
                  border: primary ? "none" : `1px solid ${colors.border}`,
                  borderRadius: 4,
                  color: primary ? "#ffffff" : (isDark ? "#cccccc" : "#333333"),
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontSize: 12,
                  opacity: disabled ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!primary && !disabled) (e.currentTarget as HTMLElement).style.background = isDark ? "#3a3a3a" : "#e0e0e0";
                }}
                onMouseLeave={(e) => {
                  if (!primary) (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {/* Node command input */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ color: colors.sidebarMuted, fontSize: 11 }}>$</span>
              <input
                value={nodeCommand}
                onChange={(e) => setNodeCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runNodeCommand(nodeCommand); }}
                placeholder="node script.js"
                style={{
                  width: 160,
                  padding: "3px 8px",
                  background: isDark ? "#3c3c3c" : "#ffffff",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  color: isDark ? "#cccccc" : "#333",
                  fontSize: 12,
                  fontFamily: "monospace",
                  outline: "none",
                }}
              />
              <button
                onClick={() => void runNodeCommand(nodeCommand)}
                disabled={isRunningCommand}
                style={{
                  padding: "3px 8px",
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  color: isDark ? "#cccccc" : "#333",
                  cursor: isRunningCommand ? "not-allowed" : "pointer",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {isRunningCommand ? "Running…" : "Run Node"}
              </button>
            </div>
          </div>

          {/* Editor + Preview */}
          <div
            style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}
            ref={topPanelRef}
          >
            {/* Editor groups */}
            <div
              style={{
                display: "flex",
                minWidth: 0,
                width: `${editorWidthPercent}%`,
              }}
            >
              {renderEditorGroup("primary")}
              {(groups.secondary.tabs.length > 0 || groups.secondary.activeId)
                ? renderEditorGroup("secondary")
                : null}
            </div>

            {/* Editor/Preview resize handle */}
            <div
              style={{ width: 4, cursor: "col-resize", background: "transparent", flexShrink: 0 }}
              onMouseDown={(e) =>
                setDrag({ type: "preview", startX: e.clientX, startY: e.clientY, startValue: editorWidthPercent })
              }
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#007acc55"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            />

            {/* Preview */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: isDark ? "#1e1e1e" : "#ffffff" }}>
              <div
                style={{
                  height: 35,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingLeft: 12,
                  paddingRight: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: colors.sidebarMuted,
                  borderBottom: `1px solid ${colors.border}`,
                  background: colors.toolbarBg,
                }}
              >
                <span>Preview</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={runAll}
                    title="Run All"
                    style={{
                      background: "#007acc",
                      border: "none",
                      borderRadius: 3,
                      color: "#fff",
                      padding: "2px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Play size={11} /> Run
                  </button>
                  <button
                    onClick={openPreviewInNewTab}
                    style={{
                      background: "none",
                      border: `1px solid ${colors.border}`,
                      borderRadius: 3,
                      color: colors.sidebarMuted,
                      padding: "2px 6px",
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>
              </div>
              <iframe
                title="preview"
                srcDoc={previewDoc}
                style={{ flex: 1, width: "100%", border: "none", background: "#fff" }}
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>

          {/* Panel resize handle */}
          {isPanelOpen && (
            <div
              style={{ height: 4, cursor: "row-resize", background: "transparent", flexShrink: 0 }}
              onMouseDown={(e) =>
                setDrag({ type: "panel", startX: e.clientX, startY: e.clientY, startValue: panelHeight })
              }
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#007acc55"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            />
          )}

          {/* Panel (Terminal / Problems) */}
          {isPanelOpen && (
            <div
              style={{
                height: panelHeight,
                display: "flex",
                flexDirection: "column",
                background: colors.panelBg,
                borderTop: `1px solid ${colors.border}`,
                flexShrink: 0,
              }}
            >
              {/* Panel tabs */}
              <div
                style={{
                  height: 35,
                  display: "flex",
                  alignItems: "stretch",
                  background: colors.panelHeader,
                  borderBottom: `1px solid ${colors.border}`,
                  paddingLeft: 8,
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "stretch" }}>
                  {(
                    [
                      { id: "terminal" as PanelTab, label: "Terminal", icon: <TerminalSquare size={13} /> },
                      {
                        id: "problems" as PanelTab,
                        label: `Problems ${totalMarkers > 0 ? `(${totalMarkers})` : ""}`,
                        icon: <AlertCircle size={13} />,
                      },
                    ] as const
                  ).map(({ id, label, icon }) => (
                    <button
                      key={id}
                      onClick={() => setPanelTab(id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        paddingLeft: 12,
                        paddingRight: 12,
                        background: "none",
                        border: "none",
                        borderBottom: panelTab === id ? "1px solid #007acc" : "1px solid transparent",
                        color: panelTab === id ? (isDark ? "#cccccc" : "#333333") : colors.sidebarMuted,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: panelTab === id ? 600 : 400,
                      }}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, paddingRight: 8 }}>
                  <button
                    onClick={() => setConsoleEntries([])}
                    title="Clear"
                    style={{ background: "none", border: "none", color: colors.sidebarMuted, cursor: "pointer", fontSize: 11, padding: "2px 6px", borderRadius: 3 }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setIsPanelOpenRaw(false)}
                    title="Close Panel"
                    style={{ background: "none", border: "none", color: colors.sidebarMuted, cursor: "pointer", padding: 3, borderRadius: 3, display: "flex" }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Terminal content */}
              {panelTab === "terminal" && (
                <>
                  <div
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      padding: "6px 12px",
                      fontFamily: "Consolas, 'Courier New', monospace",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {consoleEntries.length === 0 && (
                      <div style={{ color: colors.sidebarMuted }}>
                        Output from your code will appear here.
                        <br />
                        Type <code style={{ background: isDark ? "#333" : "#eee", padding: "0 4px", borderRadius: 2 }}>help</code> for available commands.
                      </div>
                    )}
                    {consoleEntries.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          color:
                            entry.level === "error"
                              ? "#f48771"
                              : entry.level === "warn"
                                ? "#cca700"
                                : entry.level === "system"
                                  ? "#4ec9b0"
                                  : isDark
                                    ? "#d4d4d4"
                                    : "#333333",
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ opacity: 0.5, flexShrink: 0, fontSize: 11, paddingTop: 1 }}>
                          {entry.level === "error" ? "✕" : entry.level === "warn" ? "⚠" : entry.level === "system" ? "›" : "○"}
                        </span>
                        <span style={{ wordBreak: "break-all" }}>{entry.message}</span>
                      </div>
                    ))}
                    <div ref={consoleEndRef} />
                  </div>
                  <form
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 12px",
                      borderTop: `1px solid ${colors.border}`,
                      flexShrink: 0,
                    }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void executeTerminalCommand(terminalInput);
                      setTerminalInput("");
                    }}
                  >
                    <span style={{ color: "#4ec9b0", fontFamily: "monospace", fontSize: 13 }}>›</span>
                    <input
                      value={terminalInput}
                      onChange={(e) => setTerminalInput(e.target.value)}
                      placeholder="node script.js  |  run all  |  run js  |  clear  |  help"
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: isDark ? "#cccccc" : "#333333",
                        fontFamily: "Consolas, 'Courier New', monospace",
                        fontSize: 13,
                      }}
                    />
                    <button
                      type="submit"
                      style={{
                        background: "none",
                        border: `1px solid ${colors.border}`,
                        borderRadius: 3,
                        color: colors.sidebarMuted,
                        cursor: "pointer",
                        padding: "2px 8px",
                        fontSize: 12,
                      }}
                    >
                      Run
                    </button>
                  </form>
                </>
              )}

              {/* Problems content */}
              {panelTab === "problems" && (
                <div style={{ flex: 1, overflowY: "auto", fontSize: 12 }}>
                  {totalMarkers === 0 ? (
                    <div style={{ padding: 16, color: colors.sidebarMuted }}>
                      ✓ No problems detected in the workspace.
                    </div>
                  ) : (
                    files.map((file) => {
                      const count = markersByFile[file.id] ?? 0;
                      if (!count) return null;
                      return (
                        <div key={file.id}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "5px 12px",
                              color: colors.sidebarText,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                            onClick={() => openFileInGroup(file.id, focusedGroup)}
                          >
                            <FileIcon language={file.language} size={12} />
                            {file.name}
                            <span style={{ color: "#f48771", marginLeft: "auto" }}>{count} error{count !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {!isPanelOpen && (
            <div
              style={{
                height: 22,
                display: "flex",
                alignItems: "center",
                paddingLeft: 8,
                borderTop: `1px solid ${colors.border}`,
                flexShrink: 0,
              }}
            >
              <button
                onClick={() => setIsPanelOpenRaw(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: colors.sidebarMuted,
                  cursor: "pointer",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <TerminalSquare size={12} /> Terminal (Ctrl+`)
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Status bar */}
      <div
        style={{
          height: 24,
          background: colors.statusBar,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 8,
          paddingRight: 8,
          fontSize: 12,
          color: "#ffffff",
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>
            {activeFile ? (
              <>
                <FileIcon language={activeFile.language} size={11} />
                <span style={{ marginLeft: 5 }}>{activeFile.name}</span>
              </>
            ) : (
              "No file open"
            )}
          </span>
          {totalMarkers > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={12} />
              {totalMarkers} problem{totalMarkers !== 1 ? "s" : ""}
            </span>
          )}
          {autoSave && <span style={{ opacity: 0.7 }}>Auto Save</span>}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          <span>{activeFile ? LANG_LABEL[activeFile.language] : ""}</span>
          <span>Spaces: 2</span>
          <span
            onClick={() => setWordWrap((p) => (p === "on" ? "off" : "on"))}
            style={{ cursor: "pointer", opacity: wordWrap === "on" ? 1 : 0.5 }}
            title="Toggle Word Wrap"
          >
            <WrapText size={12} />
          </span>
          <span
            onClick={() => setShowMinimap((p) => !p)}
            style={{ cursor: "pointer", opacity: showMinimap ? 1 : 0.5 }}
            title="Toggle Minimap"
          >
            <MapIcon size={12} />
          </span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}
