/**
 * SPECODE — Runner
 *
 * Self-contained script. No build step. Runs directly with Node 18+.
 *
 * State model — everything lives on disk, nothing is transient:
 *
 *   specs/<session-id>/
 *     tree.json            The live spec artifact. Rewritten after every turn.
 *     tree.v<n>.json       Immutable snapshot before each turn (full history).
 *     conversation.jsonl   Append-only log: every turn + the tree mutations it caused.
 *     session.json         Session metadata: intent, model, verbosity, turn count.
 *
 * The tree is the application spec. It exists independently of the conversation.
 * The conversation's only job is to produce mutations to the tree.
 * Kill the process at any point — the tree is intact and fully resumable.
 *
 * Usage:
 *   node runner/run.mjs "a todo app in TypeScript"
 *   node runner/run.mjs --resume <session-id>
 *
 * Environment:
 *   SPECODE_MODEL     ollama model name (default: qwen3.5:0.8b)
 *   OLLAMA_BASE_URL   ollama endpoint   (default: http://localhost:11434)
 *   SPECODE_VERBOSITY low | medium | high (default: medium)
 */

import * as readline from "readline";
import * as fs       from "fs";
import * as path     from "path";
import * as cryptoMod from "crypto";
import * as http     from "http";
import * as https    from "https";

// randomUUID was added in Node 14.17 — fall back to v4 UUID via randomBytes for older Node
function randomUUID() {
  const bytes = cryptoMod.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// HTTP helper — replaces native fetch (not available in Node < 18)
// Returns a Promise<{ statusCode, body: string }> for non-streaming requests,
// or calls onData(chunk) incrementally for streaming requests.
// ---------------------------------------------------------------------------

function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === "https:" ? https : http;
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || "GET",
      headers:  options.headers || {},
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end",  () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Streaming variant — calls onLine(line) for each newline-terminated chunk.
// Returns a Promise<void> that resolves when the stream ends.
function httpStreamLines(url, options, body, onLine) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === "https:" ? https : http;
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || "GET",
      headers:  options.headers || {},
    }, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end",  () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`)));
        return;
      }
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) onLine(line);
      });
      res.on("end", () => {
        if (buf.trim()) onLine(buf);
        resolve();
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL      = process.env.SPECODE_MODEL     || "gemma2:2b";
const OLLAMA_URL = process.env.OLLAMA_BASE_URL   || "http://localhost:11434";
const VERBOSITY  = process.env.SPECODE_VERBOSITY || "medium";
const SPECS_DIR  = path.resolve("specs");

const isResume = process.argv[2] === "--resume";
const arg      = process.argv[isResume ? 3 : 2];

const HELP = `
SPECODE — spec elicitation engine

Usage:
  node runner/run.mjs "your intent"
  node runner/run.mjs --resume <session-id>

Options:
  SPECODE_MODEL      Ollama model name  (default: gemma2:2b)
  OLLAMA_BASE_URL    Ollama endpoint    (default: http://localhost:11434)
  SPECODE_VERBOSITY  low|medium|high    (default: medium)
  SPECODE_PROVIDER   claude|openai|ollama (default: ollama)

Examples:
  node runner/run.mjs "a todo app in TypeScript"
  node runner/run.mjs --resume 225ad55d-1a48-4578-ba63-441e588e4feb
  SPECODE_VERBOSITY=low node runner/run.mjs "a REST API in Go"
`;

if (!arg || arg === "--help" || arg === "-h") {
  console.log(HELP);
  process.exit(arg ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Ollama: health check + structured streaming
//
// Two modes depending on what the model supports:
//   - stream:true  + format:schema  → tokens stream live, JSON enforced
//   - stream:false + format:schema  → wait for full response, JSON enforced
//
// We try streaming first. If the model doesn't support it with schema, Ollama
// returns a non-streamed response anyway and we handle both.
// ---------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["question", "targetNodeId", "nodeUpdate", "newChildren", "sharedPatternDetected", "reasoning"],
  properties: {
    question:              { type: "string" },
    targetNodeId:          { type: ["string", "null"] },
    nodeUpdate: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          required: ["nodeId", "value", "status", "openQuestions"],
          properties: {
            nodeId:        { type: "string" },
            value:         { type: ["string", "null"] },
            status:        { type: "string", enum: ["empty", "partial", "complete", "n/a"] },
            openQuestions: { type: "array", items: { type: "string" } },
          },
        },
      ],
    },
    newChildren: {
      type: "array",
      items: {
        type: "object",
        required: ["parentId", "label", "kind"],
        properties: {
          parentId: { type: "string" },
          label:    { type: "string" },
          kind:     { type: "string", enum: ["feature","data-model","flow","integration","constraint","user-role","shared"] },
          value:    { type: ["string", "null"] },
        },
      },
    },
    sharedPatternDetected: { type: ["string", "null"] },
    reasoning:             { type: "string" },
  },
};

async function checkOllamaHealth() {
  try {
    const res = await httpRequest(`${OLLAMA_URL}/api/show`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
    }, JSON.stringify({ name: MODEL }));
    if (res.statusCode !== 200) {
      throw new Error(`Model "${MODEL}" not found. Run: ollama pull ${MODEL}`);
    }
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      throw new Error(`Ollama is not running at ${OLLAMA_URL}. Start it with: ollama serve`);
    }
    throw err;
  }
}

async function ollamaStream(messages, onToken) {
  let full = "";

  await httpStreamLines(
    `${OLLAMA_URL}/api/chat`,
    { method: "POST", headers: { "Content-Type": "application/json" } },
    JSON.stringify({
      model:    MODEL,
      messages,
      stream:   true,
      format:   RESPONSE_SCHEMA,
      options:  { temperature: 0.1, num_ctx: 4096 },
    }),
    (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const event = JSON.parse(trimmed);
        const token = (event.message && event.message.content) || "";
        if (token) {
          full += token;
          onToken(token);
        }
      } catch {
        // Incomplete JSON line — ignore
      }
    }
  );

  return full;
}

// ---------------------------------------------------------------------------
// Spec tree (mirrors core/src/tree — kept in sync manually)
// ---------------------------------------------------------------------------

const KIND_PRIORITY = {
  intent: 100, platform: 90, "user-role": 80, "tech-stack": 75,
  feature: 70, flow: 60, "data-model": 55, integration: 50,
  constraint: 40, shared: 30,
};

function makeNode(label, kind) {
  return {
    id: randomUUID(), label, kind,
    status: "empty", value: null,
    children: [], dependsOn: [], openQuestions: [],
    attempts: 0,
    updatedAt: new Date().toISOString(),
  };
}

function initTree(intent, verbosity) {
  const intentNode       = makeNode("Intent",       "intent");
  intentNode.value       = intent;
  // Intent starts complete — the user already stated it.
  // The AI can add detail later but should not block on it.
  intentNode.status      = "complete";
  const platform         = makeNode("Platform",     "platform");
  const userRoles        = makeNode("User Roles",   "user-role");
  const techStack        = makeNode("Tech Stack",   "tech-stack");
  const features         = makeNode("Features",     "feature");
  const dataModels       = makeNode("Data Models",  "data-model");
  const integrations     = makeNode("Integrations", "integration");
  const constraints      = makeNode("Constraints",  "constraint");

  features.dependsOn     = [intentNode.id, platform.id];
  dataModels.dependsOn   = [features.id];
  integrations.dependsOn = [features.id];
  constraints.dependsOn  = [platform.id];

  const tree = {
    id: randomUUID(), title: intent.slice(0, 60),
    nodes: [intentNode, platform, userRoles, techStack, features, dataModels, integrations, constraints],
    shared: [], completeness: 0, verbosity,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  tree.completeness = scoreTree(tree);
  return tree;
}

function flattenNodes(nodes) {
  const out = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children.length) out.push(...flattenNodes(n.children));
  }
  return out;
}

function scoreTree(tree) {
  const all = flattenNodes(tree.nodes);
  if (!all.length) return 0;
  let total = 0, filled = 0;
  for (const n of all) {
    const w = KIND_PRIORITY[n.kind] !== undefined ? KIND_PRIORITY[n.kind] : 30;
    total += w;
    if      (n.status === "complete") filled += w;
    else if (n.status === "partial")  filled += w * 0.5;
    else if (n.status === "n/a")      filled += w;
  }
  return Math.round((filled / total) * 100);
}

function analyzeGaps(tree) {
  const all = flattenNodes(tree.nodes);
  const incomplete = all
    .filter(n => (n.status === "empty" || n.status === "partial") && !n.sharedRef)
    .filter(n => !n.dependsOn.length || n.dependsOn.every(depId => {
      const dep = all.find(x => x.id === depId);
      return !dep || dep.status === "partial" || dep.status === "complete" || dep.status === "n/a";
    }))
    .sort((a, b) => (KIND_PRIORITY[b.kind] || 0) - (KIND_PRIORITY[a.kind] || 0));

  const ambiguous = all.filter(n => n.status === "complete" && n.openQuestions.length > 0);

  return {
    priorityNode:    incomplete[0] || ambiguous[0] || null,
    incompleteNodes: incomplete,
    ambiguousNodes:  ambiguous,
    isComplete:      tree.completeness >= 85 && !incomplete.length && !ambiguous.length,
  };
}

// Match by full ID or 8-char prefix — the model returns prefixes
function nodeMatches(node, nodeId) {
  return node.id === nodeId || node.id.startsWith(nodeId);
}

function patchNodes(nodes, nodeId, patch) {
  return nodes.map(n => {
    if (nodeMatches(n, nodeId)) return { ...n, ...patch, updatedAt: new Date().toISOString() };
    if (n.children.length) return { ...n, children: patchNodes(n.children, nodeId, patch) };
    return n;
  });
}

function insertChild(nodes, parentId, child) {
  return nodes.map(n => {
    if (nodeMatches(n, parentId)) return { ...n, children: [...n.children, child] };
    if (n.children.length) return { ...n, children: insertChild(n.children, parentId, child) };
    return n;
  });
}

// ---------------------------------------------------------------------------
// Prompts (mirrors core/src/prompts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Verbosity controls SPECIFICATION DEPTH — how many sub-questions per node.
//
// low:    one answer → complete. Fast broad strokes. "web" is enough.
// medium: one level of follow-up. "web" → "which framework?" then done.
// high:   drill until code-generatable. "web" → framework → version →
//         routing strategy → deployment target → env config. No assumptions.
// ---------------------------------------------------------------------------

const VERBOSITY_DEPTH = {
  low: `
DEPTH: low — accept the first answer given for any node. Mark it complete immediately.
Do not ask follow-up questions on a node that already has a value.
"web" = Platform complete. "PostgreSQL" = DB complete. Move on.`,

  medium: `
DEPTH: medium — ask ONE follow-up if the answer is too broad to be actionable.
"web" → ask framework once → then mark complete.
"PostgreSQL" → ask hosting/version once → then mark complete.
Never go more than one level deep on any single node.`,

  high: `
DEPTH: high — drill until every node value is a direct code-generation instruction.
A value is complete only when a developer can write the code without deciding anything.
"web" is NOT complete → ask framework → ask version → ask deployment → ask env config.
"PostgreSQL" is NOT complete → ask version → ask hosting → ask ORM → ask migration strategy.
Keep asking sub-questions on the same node until the answer is unambiguous and implementable.
Only then mark complete and move to the next node.`,
};

function buildSystemPrompt(verbosity) {
  return `/no_think
You are SPECODE — a spec elicitation engine. Your only job: fill the spec tree with values specific enough that an LLM can generate a complete, deployable application from tree.json alone, with zero clarifying questions.

## The standard for "complete"
A node is complete when its value is a direct code-generation instruction — no inference, no assumption, no ambiguity.
INCOMPLETE: "web", "database", "auth", "notifications"
COMPLETE: "Next.js 14 App Router, deployed on Vercel", "PostgreSQL 16 on Railway, Prisma ORM", "JWT in httpOnly cookies, 7-day expiry, refresh token rotation", "email via Resend, on user signup and password reset"

## Output: valid JSON only — no prose, no markdown
{
  "question": "single focused question for the user",
  "targetNodeId": "8-char node ID prefix or null",
  "nodeUpdate": { "nodeId": "id", "value": "complete implementable value or null if still partial", "status": "partial|complete|n/a", "openQuestions": [] } | null,
  "newChildren": [{ "parentId": "id", "label": "name", "kind": "feature|data-model|flow|integration|constraint|user-role|shared", "value": null }],
  "sharedPatternDetected": "pattern name or null",
  "reasoning": "one sentence: why this question, why complete or not"
}

## Specification depth
${VERBOSITY_DEPTH[verbosity] || VERBOSITY_DEPTH.medium}

## 3-strike assumption rule
If the same node has been asked 3 times and the user has not provided a usable answer (skipped, said "don't know", gave vague replies):
- Mark the node complete with a reasonable default
- Set the value as: "assumed: <value> — reason: <why this default makes sense>"
- This assumption is visible in the tree and accountable

## Rules
- NEVER ask about nodes whose dependencies are still empty.
- NEVER mark a node complete unless its value meets the completeness standard above.
- nodeUpdate is null only on the very first turn (no prior user answer to process).
- If the intent node already has a clear purpose ("a task management app"), mark it COMPLETE immediately — do not re-ask.
- When an answer implies sub-specs (e.g. "OAuth" → provider config, callback URL), add them as newChildren.
- Flag shared patterns (auth, notifications, file upload, search, pagination) in sharedPatternDetected.`;
}

function buildTreeContext(tree, gaps) {
  const all   = flattenNodes(tree.nodes);
  const icons = { complete: "✓", partial: "~", empty: "○", "n/a": "-" };

  const nodeLines = all.map(n => {
    const icon     = icons[n.status] || "?";
    const val      = n.value ? `→ ${n.value}` : "(empty)";
    const attempts = (n.attempts && n.attempts > 0) ? ` [asked:${n.attempts}/3]` : "";
    const q        = n.openQuestions.length ? ` [?? ${n.openQuestions[0]}]` : "";
    return `  ${icon} [${n.id.slice(0,8)}] ${n.kind.toUpperCase()}: ${n.label} ${val}${attempts}${q}`;
  }).join("\n");

  const sharedLines = tree.shared.length
    ? `\nSHARED:\n${tree.shared.map(s => `  ◆ [${s.id.slice(0,8)}] ${s.label}`).join("\n")}`
    : "";

  const gapList = gaps.incompleteNodes.slice(0, 5)
    .map(n => {
      const strikes = n.attempts ? ` (asked ${n.attempts}/3 times)` : "";
      return `  - [${n.id.slice(0,8)}] ${n.kind}: ${n.label} (${n.status})${strikes}`;
    }).join("\n");

  return `## Spec Tree (completeness: ${tree.completeness}%)
TITLE: ${tree.title}  VERBOSITY: ${tree.verbosity}

NODES:
${nodeLines}${sharedLines}

TOP GAPS:
${gapList || "  (none)"}`;
}


// ---------------------------------------------------------------------------
// Turn modes — the engine decides what the model must do this turn.
// The model never decides what node to target or whether an answer is done.
// ---------------------------------------------------------------------------

function buildMessages(tree, gaps, history, turnMode) {
  const messages = [
    { role: "system", content: buildSystemPrompt(tree.verbosity) },
    { role: "user",   content: buildTreeContext(tree, gaps) },
    // Only include the last 6 history entries to keep context tight
    ...history.slice(-6).map(t => ({ role: t.role === "ai" ? "assistant" : "user", content: t.content })),
  ];

  messages.push({ role: "user", content: turnMode.instruction });
  return messages;
}

// Build the instruction for this turn — engine-owned, model just executes.
// turnMode carries: { instruction, targetNodeId, phase: "ask"|"followup"|"assume"|"complete" }
function buildTurnMode(tree, gaps, history) {
  if (gaps.isComplete) {
    return {
      phase: "complete",
      targetNodeId: null,
      instruction: `The spec is complete at ${tree.completeness}% coverage. Respond with a brief congratulations. Set nodeUpdate to null, newChildren to [], sharedPatternDetected to null.`,
    };
  }

  const target   = gaps.priorityNode;
  if (!target) {
    return {
      phase: "ask",
      targetNodeId: null,
      instruction: `Ask about the most important unknown node in the spec tree.`,
    };
  }

  const nodeId8   = target.id.slice(0, 8);
  const attempts  = target.attempts || 0;

  // 3-strike rule: force assumption after 3 unanswered attempts
  if (attempts >= 3) {
    return {
      phase: "assume",
      targetNodeId: nodeId8,
      instruction:
`Node [${nodeId8}] "${target.label}" has been asked 3 times with no usable answer.
You MUST apply the 3-strike assumption rule NOW:
1. Choose the most reasonable default value for "${target.label}" given this app's context.
2. In nodeUpdate: set nodeId="${nodeId8}", status="complete", value="assumed: <your choice> — reason: <why this fits the app>".
3. In question: write ONE sentence telling the user what you assumed and why.
Do NOT ask another question about [${nodeId8}]. Set targetNodeId="${nodeId8}".`,
    };
  }

  // Check if the last user turn was answering this exact node
  const lastUserMsg = history.length >= 1 ? history[history.length - 1] : null;
  const lastAiMsg   = history.length >= 2 ? history[history.length - 2] : null;
  const justAnswered = lastUserMsg && lastUserMsg.role === "user"
    && lastAiMsg && lastAiMsg.role === "ai"
    && lastAiMsg.nodeId === nodeId8;

  if (justAnswered) {
    // Model must process the answer, decide if complete per verbosity depth, or ask ONE follow-up
    return {
      phase: "followup",
      targetNodeId: nodeId8,
      instruction:
`The user just answered your question about [${nodeId8}] "${target.label}" (${target.kind}).
Their answer: "${lastUserMsg.content}"
Current accumulated value: "${target.value || "(none)"}"

Apply the depth rule for verbosity=${tree.verbosity}:
${tree.verbosity === "low"   ? `LOW: accept this answer as-is. Set status="complete", value="${lastUserMsg.content}". Ask about the NEXT node.` : ""}
${tree.verbosity === "medium" ? `MEDIUM: is "${lastUserMsg.content}" specific enough to implement? If yes → complete it. If it's still vague (e.g. just a category name) → ask ONE follow-up, stay on [${nodeId8}].` : ""}
${tree.verbosity === "high"  ? `HIGH: is every implementation detail for "${target.label}" now known? (framework+version+routing+deployment for platform, etc.) If yes → complete it. If any critical detail is missing → ask ONE targeted follow-up, stay on [${nodeId8}].` : ""}

CRITICAL: set targetNodeId="${nodeId8}" in your response.
If marking complete: set nodeUpdate.status="complete" and nodeUpdate.value=<the full accumulated answer for this node>.
If asking follow-up: set nodeUpdate.status="partial" and nodeUpdate.value=<what is known so far>.`,
    };
  }

  // Fresh question about this node
  return {
    phase: "ask",
    targetNodeId: nodeId8,
    instruction:
`Ask exactly ONE question to fill node [${nodeId8}] "${target.label}" (kind: ${target.kind}).
Set targetNodeId="${nodeId8}". Set nodeUpdate=null (no answer to process yet).
The question must be concrete and focused — not "tell me about X" but "what specific X?"
${attempts > 0 ? `This node has been asked ${attempts} time(s) before. Ask from a different angle.` : ""}`,
  };
}

function parseLLMResponse(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON (structured output failed).\nRaw: ${raw.slice(0,300)}\n${err}`);
  }
  if (typeof p.question !== "string" || !p.question) {
    throw new Error(`LLM response missing "question" field. Got: ${JSON.stringify(p).slice(0,200)}`);
  }
  const nu = p.nodeUpdate;
  return {
    question:              p.question,
    targetNodeId:          p.targetNodeId != null ? p.targetNodeId : null,
    nodeUpdate:            nu ? {
      nodeId:        String(nu.nodeId != null ? nu.nodeId : ""),
      value:         nu.value != null ? String(nu.value) : null,
      status:        ["empty","partial","complete","n/a"].includes(nu.status) ? nu.status : "partial",
      openQuestions: Array.isArray(nu.openQuestions) ? nu.openQuestions.map(String) : [],
    } : null,
    newChildren:           Array.isArray(p.newChildren)
      ? p.newChildren.filter(c => c.parentId && c.label).map(c => ({
          parentId: String(c.parentId), label: String(c.label),
          kind: c.kind || "feature", value: c.value != null ? c.value : null,
        }))
      : [],
    sharedPatternDetected: p.sharedPatternDetected != null ? p.sharedPatternDetected : null,
    reasoning:             p.reasoning || "",
  };
}

// ---------------------------------------------------------------------------
// Apply mutations from LLM response to the tree
// Returns { tree, mutations[] }
// ---------------------------------------------------------------------------

function applyMutations(tree, parsed) {
  const mutations = [];

  if (parsed.nodeUpdate && parsed.nodeUpdate.nodeId) {
    const { nodeId, value, status, openQuestions } = parsed.nodeUpdate;
    tree = { ...tree, nodes: patchNodes(tree.nodes, nodeId, { value, status, openQuestions }) };
    mutations.push({ type: "node:update", nodeId, value, status });
  }

  for (const child of parsed.newChildren) {
    const newChild = {
      ...makeNode(child.label, child.kind),
      status: child.value ? "partial" : "empty",
      value:  child.value != null ? child.value : null,
    };
    tree = { ...tree, nodes: insertChild(tree.nodes, child.parentId, newChild) };
    mutations.push({ type: "node:add", parentId: child.parentId, nodeId: newChild.id, label: child.label });
  }

  if (parsed.sharedPatternDetected) {
    const already = tree.shared.find(s => s.label.toLowerCase() === parsed.sharedPatternDetected.toLowerCase());
    if (!already) {
      const sn = makeNode(parsed.sharedPatternDetected, "shared");
      tree = { ...tree, shared: [...tree.shared, sn] };
      mutations.push({ type: "shared:hoist", label: parsed.sharedPatternDetected });
    }
  }

  tree.completeness = scoreTree(tree);
  tree.updatedAt    = new Date().toISOString();
  return { tree, mutations };
}

// ---------------------------------------------------------------------------
// Persistence — atomic writes, never corrupt state
// ---------------------------------------------------------------------------

function sessionDir(id)  { return path.join(SPECS_DIR, id); }

function writeAtomic(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);   // atomic on POSIX
}

function persistTree(sessionId, tree) {
  writeAtomic(path.join(sessionDir(sessionId), "tree.json"), JSON.stringify(tree, null, 2));
}

function snapshotTree(sessionId, tree, version) {
  // Immutable — written once, never overwritten
  const p = path.join(sessionDir(sessionId), `tree.v${version}.json`);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, JSON.stringify(tree, null, 2));
  }
}

function appendConversation(sessionId, entry) {
  fs.appendFileSync(
    path.join(sessionDir(sessionId), "conversation.jsonl"),
    JSON.stringify(entry) + "\n"
  );
}

function persistSession(sessionId, meta) {
  writeAtomic(path.join(sessionDir(sessionId), "session.json"), JSON.stringify(meta, null, 2));
}

function loadExistingSession(sessionId) {
  const dir = sessionDir(sessionId);

  // Integrity check: all required files must exist
  for (const f of ["tree.json", "session.json", "conversation.jsonl"]) {
    if (!fs.existsSync(path.join(dir, f))) {
      throw new Error(`Session "${sessionId}" is missing ${f} — cannot resume`);
    }
  }

  const tree = JSON.parse(fs.readFileSync(path.join(dir, "tree.json"), "utf8"));
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));

  // Reconstruct full conversation history from JSONL
  // Preserve all fields — nodeId context is needed for the LLM to understand history
  const lines   = fs.readFileSync(path.join(dir, "conversation.jsonl"), "utf8")
    .split("\n").filter(Boolean);
  const history = lines.map(l => JSON.parse(l))
    .map(e => ({ role: e.role, content: e.content, nodeId: e.targetNodeId }));

  // Cross-validate turn count
  const userTurns = lines.filter(l => JSON.parse(l).role === "user").length;
  if (userTurns !== meta.turns) {
    console.warn(`Warning: session.json says ${meta.turns} turns but conversation.jsonl has ${userTurns} user turns. Using conversation.jsonl as authoritative.`);
    meta.turns = userTurns;
  }

  return { tree, meta, history };
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

const C = {
  reset:  "\x1b[0m",  bold:  "\x1b[1m",  dim:    "\x1b[2m",
  cyan:   "\x1b[36m", green: "\x1b[32m",  yellow: "\x1b[33m",
  gray:   "\x1b[90m", white: "\x1b[97m",  red:    "\x1b[31m",
  blue:   "\x1b[34m",
};

function renderTree(tree) {
  const icons = {
    complete: `${C.green}✓${C.reset}`, partial: `${C.yellow}~${C.reset}`,
    empty:    `${C.gray}○${C.reset}`,  "n/a":   `${C.dim}-${C.reset}`,
  };
  const lines = [];
  function rn(node, depth) {
    const indent = "  ".repeat(depth);
    const icon   = icons[node.status] || "?";
    const val    = node.value   ? `${C.dim}: ${node.value.slice(0, 60)}${C.reset}` : "";
    const ref    = node.sharedRef ? ` ${C.blue}[→shared]${C.reset}` : "";
    lines.push(`${indent}${icon} ${C.white}${node.label}${C.reset}${val}${ref}`);
    for (const child of node.children) rn(child, depth + 1);
  }
  for (const n of tree.nodes) rn(n, 0);
  if (tree.shared.length) {
    lines.push(`\n${C.gray}── shared subtrees ──${C.reset}`);
    for (const s of tree.shared) {
      const val = s.value ? `${C.dim}: ${s.value.slice(0, 60)}${C.reset}` : "";
      lines.push(`  ${C.cyan}◆ ${s.label}${C.reset}${val}`);
    }
  }
  return lines.join("\n");
}

function divider() {
  process.stdout.write(C.gray + "─".repeat(process.stdout.columns || 80) + C.reset + "\n");
}

function header(tree, sessionId) {
  const cov   = tree.completeness;
  const color = cov >= 85 ? C.green : cov >= 50 ? C.yellow : C.red;
  process.stdout.write(
    `\n${C.bold}${C.cyan}SPECODE${C.reset}  ` +
    `${C.gray}session:${C.reset} ${C.dim}${sessionId}${C.reset}\n` +
    `${C.gray}model:${C.reset} ${MODEL}  ` +
    `${C.gray}verbosity:${C.reset} ${tree.verbosity}  ` +
    `${C.gray}coverage:${C.reset} ${color}${cov}%${C.reset}\n`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  // Health check before doing anything else
  process.stdout.write(`${C.gray}Checking Ollama...${C.reset} `);
  try {
    await checkOllamaHealth();
    process.stdout.write(`${C.green}OK${C.reset}\n`);
  } catch (err) {
    process.stdout.write(`${C.red}FAIL${C.reset}\n${err.message}\n`);
    process.exit(1);
  }

  let tree, history, sessionId, turnIndex, meta;

  if (isResume) {
    sessionId = arg;
    try {
      ({ tree, meta, history } = loadExistingSession(sessionId));
      turnIndex = meta.turns;
    } catch (err) {
      console.error(`${C.red}Resume failed:${C.reset} ${err.message}`);
      process.exit(1);
    }
    header(tree, sessionId);
    console.log(`${C.cyan}Resuming session${C.reset} — ${turnIndex} turns completed, coverage ${tree.completeness}%`);
  } else {
    const rawIntent = arg;
    sessionId  = randomUUID();
    tree       = initTree(rawIntent, VERBOSITY);
    history    = [];
    turnIndex  = 0;

    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    meta = { sessionId, intent: rawIntent, model: MODEL, verbosity: VERBOSITY, turns: 0, completeness: 0, createdAt: new Date().toISOString() };
    persistSession(sessionId, meta);
    persistTree(sessionId, tree);

    header(tree, sessionId);
  }

  divider();
  console.log(`${C.gray}Intent:${C.reset} ${tree.title}`);
  console.log(`${C.gray}Spec dir:${C.reset} specs/${sessionId}/`);
  console.log(`${C.gray}Commands: /verbosity low|medium|high   /quit${C.reset}`);
  divider();
  console.log(renderTree(tree));
  divider();

  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = p => new Promise(res => rl.question(p, res));

  while (true) {
    const gaps     = analyzeGaps(tree);
    const turnMode = buildTurnMode(tree, gaps, history);

    if (turnMode.phase === "complete") {
      console.log(`\n${C.green}${C.bold}Spec complete!${C.reset} Coverage: ${tree.completeness}%`);
      console.log(`${C.gray}Full spec: specs/${sessionId}/tree.json${C.reset}`);
      break;
    }

    // Snapshot before this turn — immutable history
    snapshotTree(sessionId, tree, turnIndex);

    // Stream LLM response live to terminal
    process.stdout.write(`\n${C.cyan}${C.bold}AI${C.reset} ${C.dim}(generating...)`);
    let rawResponse = "";
    let firstToken  = true;

    try {
      rawResponse = await ollamaStream(
        buildMessages(tree, gaps, history, turnMode),
        (token) => {
          if (firstToken) {
            process.stdout.write(`\r${" ".repeat(25)}\r`);
            process.stdout.write(`${C.cyan}${C.bold}AI:${C.reset} ${C.dim}`);
            firstToken = false;
          }
          process.stdout.write(token);
        }
      );
      process.stdout.write(`${C.reset}\n`);
    } catch (err) {
      process.stdout.write(`\r${C.red}LLM error: ${err.message}${C.reset}\n`);
      break;
    }

    // Parse structured response — throws on invalid JSON (hard error)
    let parsed;
    try {
      parsed = parseLLMResponse(rawResponse);
    } catch (err) {
      console.error(`${C.red}Parse error:${C.reset} ${err.message}`);
      console.error(`${C.gray}Retrying turn...${C.reset}`);
      continue;   // retry the same turn rather than crashing the session
    }

    // Show the extracted question cleanly below the raw stream
    // If an assumption was applied (3-strike rule), surface it prominently
    const isAssumption = parsed.nodeUpdate && parsed.nodeUpdate.value &&
      String(parsed.nodeUpdate.value).startsWith("assumed:");
    if (isAssumption) {
      console.log(`\n${C.yellow}${C.bold}⚠ Assumption applied:${C.reset} ${parsed.nodeUpdate.value}`);
    }
    console.log(`\n${C.cyan}→${C.reset} ${parsed.question}`);
    if (parsed.reasoning) console.log(`  ${C.gray}${parsed.reasoning}${C.reset}`);

    // Log AI turn to conversation.jsonl
    const aiLogEntry = {
      turnIndex, role: "ai",
      content:      parsed.question,
      targetNodeId: parsed.targetNodeId,
      reasoning:    parsed.reasoning,
      mutations:    [],
      timestamp:    new Date().toISOString(),
    };

    // Show updated tree
    divider();
    console.log(renderTree(tree));
    divider();

    // Assumption phase: auto-commit — no user input needed, the node is declared complete
    if (turnMode.phase === "assume") {
      const { tree: mutated, mutations } = applyMutations(tree, parsed);
      tree = mutated;
      history.push({ role: "ai", content: parsed.question, nodeId: turnMode.targetNodeId });
      persistTree(sessionId, tree);
      aiLogEntry.mutations = mutations;
      appendConversation(sessionId, aiLogEntry);
      turnIndex++;
      persistSession(sessionId, { ...meta, turns: turnIndex, completeness: tree.completeness, verbosity: tree.verbosity, updatedAt: tree.updatedAt });
      divider();
      console.log(renderTree(tree));
      divider();
      continue; // no user input — advance to next node
    }

    // Get user input
    const userInput = await ask(`\n${C.white}You:${C.reset} `);
    const trimmed   = userInput.trim();
    if (!trimmed) continue;

    // Commands
    if (trimmed.startsWith("/")) {
      const [cmd, ...args] = trimmed.slice(1).split(" ");
      if (cmd === "quit" || cmd === "exit") break;
      if (cmd === "verbosity" && ["low","medium","high"].includes(args[0])) {
        tree.verbosity = args[0];
        persistTree(sessionId, tree);
        console.log(`${C.gray}verbosity → ${args[0]}${C.reset}`);
      } else {
        console.log(`${C.gray}unknown command: ${trimmed}${C.reset}`);
      }
      continue;
    }

    // Increment attempt counter on the engine-owned target node
    const engineTargetId = turnMode.targetNodeId;
    if (engineTargetId) {
      const all    = flattenNodes(tree.nodes);
      const target = all.find(n => nodeMatches(n, engineTargetId));
      if (target) {
        const attempts = (target.attempts || 0) + 1;
        tree = { ...tree, nodes: patchNodes(tree.nodes, target.id, { attempts }) };
      }
    }

    // Apply all LLM-proposed mutations
    const { tree: mutated, mutations } = applyMutations(tree, parsed);
    tree = mutated;

    // Update history (used as LLM context on next turn)
    history.push({ role: "ai",   content: parsed.question, nodeId: turnMode.targetNodeId });
    history.push({ role: "user", content: trimmed });

    // ── Persist everything atomically ────────────────────────────────────────
    // 1. Live tree
    persistTree(sessionId, tree);

    // 2. AI turn (with mutations) + user turn
    aiLogEntry.mutations = mutations;
    appendConversation(sessionId, aiLogEntry);
    appendConversation(sessionId, {
      turnIndex, role: "user",
      content:      trimmed,
      targetNodeId: engineTargetId,
      timestamp:    new Date().toISOString(),
    });

    // 3. Session metadata
    turnIndex++;
    persistSession(sessionId, {
      ...meta,
      turns:        turnIndex,
      completeness: tree.completeness,
      verbosity:    tree.verbosity,
      updatedAt:    tree.updatedAt,
    });

    // Show tree after mutations
    divider();
    console.log(renderTree(tree));
    divider();
  }

  rl.close();
  persistSession(sessionId, { ...meta, turns: turnIndex, completeness: tree.completeness, updatedAt: tree.updatedAt });
  console.log(`\n${C.cyan}Session saved → specs/${sessionId}/${C.reset}\n`);
}

run().catch(err => {
  if ((err.message && err.message.includes("readline was closed")) || err.code === "ERR_USE_AFTER_CLOSE") {
    // stdin closed (e.g. piped input finished) — not a crash
    process.exit(0);
  }
  console.error(`\n${C.red}Fatal:${C.reset} ${err.message}\n`);
  process.exit(1);
});
