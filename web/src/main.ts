/**
 * SPECODE Web UI
 *
 * Vanilla TypeScript, no framework. The Engine drives all state — the UI
 * only renders what the engine emits. Terminal-aesthetic: monospace,
 * dark, functional colors, no decoration.
 *
 * Layout:
 *   ┌── header ──────────────────────────────────────┐
 *   │ SPECODE   session: abc123   coverage: 42%       │
 *   ├── tree panel ─────────┬── chat panel ───────────┤
 *   │ ✓ Intent: todo app   │ AI: target platform?    │
 *   │ ~ Platform           │ You: web                │
 *   │ ○ Features           │ AI: auth strategy?      │
 *   ├── status bar ─────────┴─────────────────────────┤
 *   │ coverage: 42%  verbosity: [L][M][H]  ready      │
 *   ├── input bar ───────────────────────────────────  │
 *   │ > _                                             │
 *   └─────────────────────────────────────────────────┘
 *
 * State is also persisted to localStorage so sessions survive page reloads.
 * Commands: /verbosity low|medium|high   /save   /clear
 */

import {
  Engine,
  SpecTree,
  SpecNode,
  ConversationTurn,
  VerbosityLevel,
  OllamaProvider,
} from "@specode/core";

// ---------------------------------------------------------------------------
// Bootstrap — build layout, wire up engine
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;
app.innerHTML = buildLayout();

const el = {
  treeContent:   document.getElementById("tree-content")!,
  chatMessages:  document.getElementById("chat-messages")!,
  coverageStat:  document.getElementById("coverage-stat")!,
  sessionId:     document.getElementById("session-id")!,
  statusMsg:     document.getElementById("status-msg")!,
  verbosityBtns: document.querySelectorAll<HTMLButtonElement>(".verbosity-btn"),
  input:         document.getElementById("main-input") as HTMLInputElement,
};

// Disable input immediately on keydown Enter to prevent double-submit race
let submitting = false;
el.input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (submitting) return;
  const value = el.input.value.trim();
  if (!value) return;
  submitting    = true;
  el.input.value = "";
  handleInput(value).finally(() => { submitting = false; });
});

el.verbosityBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    engine.setVerbosity(btn.dataset["level"] as VerbosityLevel);
    updateVerbosityBtns(btn.dataset["level"] as VerbosityLevel);
  });
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

let engine: Engine;

try {
  // Browser never reads provider API keys: talk to the local Ollama proxy.
  const provider = new OllamaProvider("qwen3.5:0.8b", "/ollama");
  engine = new Engine(provider, "medium");
} catch (err) {
  showFatal(err instanceof Error ? err.message : String(err));
  // Stop here — engine is undefined, event handlers are never attached
  throw err;
}

engine.on("tree:updated", (tree: SpecTree) => {
  renderTree(tree);
  updateCoverage(tree);
  el.sessionId.textContent = tree.id.slice(0, 8);
  persistToStorage(tree, engine.getConversation());
});

engine.on("thinking:start", () => {
  el.input.disabled = true;
  setStatus("generating...");
  appendThinking();
});

engine.on("thinking:end", () => {
  el.input.disabled = false;
  setStatus("ready");
  removeThinking();
  el.input.focus();
});

engine.on("question:ready", (question: string) => {
  removeThinking();
  appendMessage("ai", question);
});

engine.on("spec:complete", (tree: SpecTree) => {
  setStatus("spec complete!");
  renderTree(tree);
  appendMessage("ai", `Spec complete (${tree.completeness}% coverage). Use /save to export.`);
  el.input.disabled = true;
});

engine.on("error", (msg: string) => {
  setStatus(`error: ${msg}`);
  removeThinking();
  appendMessage("ai", `Error: ${msg}`);
  el.input.disabled = false;
});

// ---------------------------------------------------------------------------
// Start or resume session
// ---------------------------------------------------------------------------

const intentParam = new URLSearchParams(window.location.search).get("intent")?.trim();
const savedState  = loadFromStorage();

if (savedState) {
  // Restore both the tree and conversation to the engine, not just the DOM.
  engine.restore(savedState.tree, savedState.conversation);
  renderTree(savedState.tree);
  updateCoverage(savedState.tree);
  for (const turn of savedState.conversation) {
    appendMessage(turn.role, turn.content);
  }
  setStatus("resumed from storage");
  el.input.disabled = false;
  el.input.focus();
} else {
  const intent = intentParam || "a web application";
  engine.start(intent).then(() => el.input.focus());
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function handleInput(value: string): Promise<void> {
  if (value.startsWith("/")) {
    handleCommand(value);
    return;
  }
  appendMessage("user", value);
  await engine.answer(value);
}

function handleCommand(cmd: string): void {
  const [command, ...args] = cmd.slice(1).split(" ");
  switch (command) {
    case "verbosity": {
      const level = args[0] as VerbosityLevel;
      if (["low", "medium", "high"].includes(level)) {
        engine.setVerbosity(level);
        updateVerbosityBtns(level);
        setStatus(`verbosity → ${level}`);
      } else {
        setStatus("usage: /verbosity low|medium|high");
      }
      break;
    }
    case "save": {
      const tree = engine.getTree();
      const blob = new Blob([JSON.stringify(tree, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: `spec-${tree.id}.json` });
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`saved spec-${tree.id.slice(0, 8)}.json`);
      break;
    }
    case "clear":
      el.chatMessages.innerHTML = "";
      break;
    case "reset":
      localStorage.removeItem("specode:session");
      location.reload();
      break;
    default:
      setStatus(`unknown: /${command}  — try /verbosity /save /clear /reset`);
  }
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

function renderTree(tree: SpecTree): void {
  const lines: string[] = [];
  for (const node of tree.nodes) renderNodeLines(node, 0, lines);

  if (tree.shared.length > 0) {
    lines.push(`<div class="shared-section"><div class="section-label">── shared ──</div>${
      tree.shared.map((s) => `<div class="shared-node">◆ ${esc(s.label)}</div>`).join("")
    }</div>`);
  }

  el.treeContent.innerHTML = lines.join("");
}

function renderNodeLines(node: SpecNode, depth: number, lines: string[]): void {
  const icon  = statusIcon(node.status);
  const value = node.value
    ? `: <span class="node-value">${esc(node.value.slice(0, 55))}</span>`
    : "";
  const ref   = node.sharedRef
    ? ` <span class="shared-ref">[→shared]</span>`
    : "";

  lines.push(`<div class="tree-node status-${node.status} depth-${Math.min(depth, 3)}">
    <span class="status-icon">${icon}</span>
    <span class="node-label">${esc(node.label)}</span>${value}${ref}
  </div>`);

  for (const child of node.children) renderNodeLines(child, depth + 1, lines);
}

function statusIcon(status: SpecNode["status"]): string {
  return { complete: "✓", partial: "~", empty: "○", "n/a": "-" }[status] ?? "?";
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

function appendMessage(role: "ai" | "user", content: string): void {
  const div = document.createElement("div");
  div.className = `chat-turn role-${role}`;
  div.innerHTML = `
    <span class="role-label">${role === "ai" ? "AI" : "YOU"}</span>
    <div class="turn-content">${esc(content)}</div>
  `;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function appendThinking(): void {
  const div = document.createElement("div");
  div.id        = "thinking";
  div.className = "thinking-indicator";
  div.textContent = "AI: generating...";
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function removeThinking(): void {
  document.getElementById("thinking")?.remove();
}

// ---------------------------------------------------------------------------
// Status / coverage
// ---------------------------------------------------------------------------

function updateCoverage(tree: SpecTree): void {
  el.coverageStat.className   = `stat-value ${tree.completeness >= 85 ? "ok" : tree.completeness >= 50 ? "warn" : "low"}`;
  el.coverageStat.textContent = `${tree.completeness}%`;
}

function updateVerbosityBtns(active: VerbosityLevel): void {
  el.verbosityBtns.forEach((b) => b.classList.toggle("active", b.dataset["level"] === active));
}

function setStatus(msg: string): void {
  el.statusMsg.textContent = msg;
}

function showFatal(msg: string): void {
  app.innerHTML = `<div style="padding:32px;color:#f04a4a;font-family:monospace;white-space:pre-wrap">
Fatal error: ${esc(msg)}

Check your environment variables (SPECODE_PROVIDER, ANTHROPIC_API_KEY, etc.)
and reload the page.
  </div>`;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// Survives page reloads — same model as disk persistence in the runner.
// ---------------------------------------------------------------------------

interface StoredSession {
  tree:         SpecTree;
  conversation: ConversationTurn[];
  savedAt:      string;
}

function persistToStorage(tree: SpecTree, conversation: ConversationTurn[]): void {
  try {
    const session: StoredSession = { tree, conversation, savedAt: new Date().toISOString() };
    localStorage.setItem("specode:session", JSON.stringify(session));
  } catch {
    // Storage quota exceeded — not fatal
  }
}

function loadFromStorage(): StoredSession | null {
  try {
    const raw = localStorage.getItem("specode:session");
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// XSS-safe escaping for all content rendered via innerHTML
// ---------------------------------------------------------------------------

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Layout HTML
// ---------------------------------------------------------------------------

function buildLayout(): string {
  return `
    <div id="header">
      <span class="logo">SPECODE</span>
      <span class="sep">│</span>
      <span class="dim-label">session:</span>
      <span id="session-id" class="dim-value">—</span>
      <span class="sep">│</span>
      <span class="dim-label">coverage:</span>
      <span id="coverage-stat" class="stat-value warn">0%</span>
    </div>

    <div id="tree-panel">
      <div class="panel-title">SPEC TREE</div>
      <div id="tree-content"></div>
    </div>

    <div id="chat-panel">
      <div class="panel-title">CONVERSATION</div>
      <div id="chat-messages"></div>
    </div>

    <div id="status-bar">
      <span class="dim-label">verbosity:</span>
      <button class="verbosity-btn" data-level="low">LOW</button>
      <button class="verbosity-btn active" data-level="medium">MED</button>
      <button class="verbosity-btn" data-level="high">HIGH</button>
      <span class="sep">│</span>
      <span id="status-msg">initializing...</span>
      <span class="commands">/save /verbosity /clear /reset</span>
    </div>

    <div id="input-bar">
      <span class="prompt-symbol">&gt;</span>
      <input
        id="main-input"
        type="text"
        placeholder="answer or /command..."
        autocomplete="off"
        spellcheck="false"
        disabled
      />
    </div>
  `;
}
