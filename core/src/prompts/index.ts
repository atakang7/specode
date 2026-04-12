/**
 * SPECODE — Prompt Engineering Layer
 *
 * This is the most important file in the project.
 *
 * Core philosophy:
 *   The STRUCTURE does the thinking, not the LLM.
 *   Prompts encode domain expertise so that even small models
 *   can produce high-quality spec elicitation.
 *
 * Responsibilities:
 *   1. SYSTEM PROMPT — defines the AI's role and strict output contract
 *   2. CONTEXT INJECTION — serializes current tree state into the prompt
 *   3. QUESTION RENDERING — renders questions at the correct verbosity level
 *   4. RESPONSE PARSING — validates and parses the structured LLM response
 */

import {
  SpecTree,
  SpecNode,
  GapAnalysis,
  VerbosityLevel,
  LLMMessage,
  ConversationTurn,
} from "../types/index.js";
import { flattenNodes } from "../tree/index.js";

// ---------------------------------------------------------------------------
// System prompt
//
// Key design decisions:
//   - AI is a spec analyst, not a chatbot — single question per turn
//   - Strict JSON output contract with every field typed and explained
//   - Tree is the source of truth — conversation is just the editing interface
//   - Shared pattern detection is a first-class responsibility
//   - "complete" status has a precise definition: implementable without questions
// ---------------------------------------------------------------------------

export function buildSystemPrompt(verbosity: VerbosityLevel): string {
  return `/no_think
You are SPECODE, a spec elicitation engine. Your job is to fill a structured application spec tree by asking the user precise questions. The tree is the application specification — when complete, an LLM must be able to implement the full application without asking any further questions.

## Role
- You are NOT a chatbot. You are a structured spec analyst.
- Ask EXACTLY ONE question per turn, targeting the highest-priority unknown node.
- Extract structured spec values from every user answer, even casual or incomplete ones.
- When a user answer implies sub-specs, propose them as newChildren.
- Flag shared patterns (auth, CRUD, notifications, search, pagination) in sharedPatternDetected.

## Output contract
Respond with ONLY valid JSON — no prose, no markdown, no code fences.

{
  "question": "The single question to show the user. Phrased at the correct verbosity level.",
  "targetNodeId": "ID of the node this question is about. Use the 8-char prefix from the tree context. null if asking generally.",
  "nodeUpdate": {
    "nodeId": "ID of the node to update with the user's last answer (may differ from targetNodeId)",
    "value": "Extracted spec value — must be specific and concrete enough to implement. Not a summary.",
    "status": "partial (more to clarify) | complete (fully implementable, no ambiguity)",
    "openQuestions": ["Any remaining ambiguities about this node that must be resolved later"]
  },
  "newChildren": [
    {
      "parentId": "Parent node ID (8-char prefix)",
      "label": "Child node label",
      "kind": "feature | data-model | flow | integration | constraint | user-role | shared",
      "value": "Initial value if already known from context, otherwise null"
    }
  ],
  "sharedPatternDetected": "Name of a shared pattern if detected (auth, notifications, etc.), or null",
  "reasoning": "One sentence: why this question is the highest priority right now"
}

If there is no prior user answer to process, set nodeUpdate to null.

## Verbosity levels
${VERBOSITY_INSTRUCTIONS[verbosity]}

## Completeness rules
A node is "complete" ONLY when its value is specific enough that a developer can implement it without asking follow-up questions. Examples:
- COMPLETE: "PostgreSQL 16, hosted on Railway, schema managed by Prisma ORM"
- PARTIAL:  "PostgreSQL" (missing hosting, ORM, migration strategy)
- COMPLETE: "JWT tokens, 7-day expiry, stored in httpOnly cookies, refresh token rotation"
- PARTIAL:  "JWT auth" (missing expiry, storage, refresh strategy)

## Critical rules
- Never ask about a node whose dependencies have status "empty".
- Never repeat a question that was already answered in the conversation.
- A spec is done when every node is complete or n/a and no openQuestions remain.`;
}

const VERBOSITY_INSTRUCTIONS: Record<VerbosityLevel, string> = {
  low:
    `LOW — Keywords only. Use brackets for choices. Maximum brevity.
    Example: "auth strategy? [JWT / session / OAuth]"
    Example: "platform? [web / desktop / mobile / embedded / cli]"`,

  medium:
    `MEDIUM — One sentence of context per option. Show the impact on the spec.
    Example: "What authentication strategy? JWT = stateless, good for APIs. Session = simple for server-rendered web. OAuth = delegate to Google/GitHub."`,

  high:
    `HIGH — Full context: explain the question, all options, tradeoffs, and how the answer shapes downstream spec decisions. 3–5 sentences.`,
};

// ---------------------------------------------------------------------------
// Build the full message array for an LLM call.
//
// Injects:
//   1. System prompt (role + output contract)
//   2. Current tree state (serialized as structured context)
//   3. Conversation history (so the AI knows what was already asked/answered)
//   4. Current gap analysis target (the specific gap to ask about next)
// ---------------------------------------------------------------------------

export function buildMessages(
  tree: SpecTree,
  gapAnalysis: GapAnalysis,
  conversationHistory: ConversationTurn[]
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: "system", content: buildSystemPrompt(tree.verbosity) },
    { role: "user",   content: serializeTree(tree, gapAnalysis) },
  ];

  for (const turn of conversationHistory) {
    messages.push({
      role:    turn.role === "ai" ? "assistant" : "user",
      content: turn.content,
    });
  }

  messages.push({
    role:    "user",
    content: buildInstruction(gapAnalysis),
  });

  return messages;
}

// ---------------------------------------------------------------------------
// Serialize the spec tree into a compact, readable context block.
// This is exactly what the LLM "sees" as the current spec state.
// Format is intentionally human-readable — it works across all model sizes.
// ---------------------------------------------------------------------------

function serializeTree(tree: SpecTree, gapAnalysis: GapAnalysis): string {
  const allNodes = flattenNodes(tree.nodes);

  const nodeLines = allNodes
    .map((n) => {
      const icon = statusIcon(n.status);
      const val  = n.value ? `→ ${n.value}` : "(empty)";
      const ref  = n.sharedRef ? ` [ref→shared]` : "";
      const q    = n.openQuestions.length > 0
        ? ` [?? ${n.openQuestions.slice(0, 2).join("; ")}]`
        : "";
      return `  ${icon} [${n.id.slice(0, 8)}] ${n.kind.toUpperCase()}: ${n.label} ${val}${ref}${q}`;
    })
    .join("\n");

  const sharedLines =
    tree.shared.length > 0
      ? `\nSHARED SUBTREES (defined once, referenced by features):\n${
          tree.shared.map((s) => `  ◆ [${s.id.slice(0, 8)}] ${s.label}: ${s.value ?? "(empty)"}`).join("\n")
        }`
      : "";

  const gapList = gapAnalysis.incompleteNodes
    .slice(0, 5)
    .map((n) => `  - [${n.id.slice(0, 8)}] ${n.kind}: ${n.label} (${n.status})`)
    .join("\n");

  const ambiguousList = gapAnalysis.ambiguousNodes.length > 0
    ? `\nAMBIGUOUS (complete but have open questions):\n${
        gapAnalysis.ambiguousNodes.slice(0, 3)
          .map((n) => `  ! [${n.id.slice(0, 8)}] ${n.label}: ${n.openQuestions.join("; ")}`)
          .join("\n")
      }`
    : "";

  return `## Spec Tree  (completeness: ${tree.completeness}%)
TITLE: ${tree.title}
VERBOSITY: ${tree.verbosity}

NODES:
${nodeLines}
${sharedLines}
TOP GAPS (highest priority first):
${gapList || "  (none — spec may be complete)"}
${ambiguousList}`;
}

function buildInstruction(gapAnalysis: GapAnalysis): string {
  if (gapAnalysis.isComplete) {
    return `The spec tree is complete (coverage: ${gapAnalysis.coverageScore}%, no open questions).
Respond with JSON where "question" is a congratulations message summarizing what was captured, and "nodeUpdate" is null.`;
  }

  const target = gapAnalysis.priorityNode;
  if (!target) {
    return `Analyze the tree and determine the single most important unknown. Produce your JSON response.`;
  }

  return `Highest-priority gap: [${target.id.slice(0, 8)}] "${target.label}" (kind: ${target.kind}, status: ${target.status}).
Produce your JSON response. If the user just answered something else, extract and update that node first in nodeUpdate, then ask about this gap.`;
}

// ---------------------------------------------------------------------------
// Parse and validate the LLM's JSON response.
//
// With Ollama structured output (format: schema), parsing should never fail.
// Validation is strict — missing required fields throw immediately so the
// caller can retry or surface the error rather than silently proceeding with
// a malformed state.
// ---------------------------------------------------------------------------

export interface ParsedLLMResponse {
  question:              string;
  targetNodeId:          string | null;
  nodeUpdate: {
    nodeId:        string;
    value:         string | null;
    status:        SpecNode["status"];
    openQuestions: string[];
  } | null;
  newChildren: Array<{
    parentId: string;
    label:    string;
    kind:     SpecNode["kind"];
    value:    string | null;
  }>;
  sharedPatternDetected: string | null;
  reasoning:             string;
}

export function parseLLMResponse(raw: string): ParsedLLMResponse {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `LLM returned invalid JSON. This should not happen with structured output enabled.\nRaw (first 300 chars): ${raw.slice(0, 300)}\nParse error: ${err}`
    );
  }

  // Validate required fields
  if (typeof parsed["question"] !== "string" || !parsed["question"]) {
    throw new Error(`LLM response missing required field "question". Got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  const nodeUpdate = parsed["nodeUpdate"] as Record<string, unknown> | null | undefined;
  const validatedNodeUpdate = nodeUpdate
    ? {
        nodeId:        String(nodeUpdate["nodeId"] ?? ""),
        value:         nodeUpdate["value"] != null ? String(nodeUpdate["value"]) : null,
        status:        (["empty", "partial", "complete", "n/a"].includes(nodeUpdate["status"] as string)
          ? nodeUpdate["status"]
          : "partial") as SpecNode["status"],
        openQuestions: Array.isArray(nodeUpdate["openQuestions"])
          ? (nodeUpdate["openQuestions"] as unknown[]).map(String)
          : [],
      }
    : null;

  const newChildren = Array.isArray(parsed["newChildren"])
    ? (parsed["newChildren"] as unknown[]).map((c) => {
        const child = c as Record<string, unknown>;
        return {
          parentId: String(child["parentId"] ?? ""),
          label:    String(child["label"] ?? ""),
          kind:     (child["kind"] as SpecNode["kind"]) ?? "feature",
          value:    child["value"] != null ? String(child["value"]) : null,
        };
      }).filter((c) => c.parentId && c.label)
    : [];

  return {
    question:              parsed["question"] as string,
    targetNodeId:          parsed["targetNodeId"] != null ? String(parsed["targetNodeId"]) : null,
    nodeUpdate:            validatedNodeUpdate,
    newChildren,
    sharedPatternDetected: parsed["sharedPatternDetected"] != null
      ? String(parsed["sharedPatternDetected"])
      : null,
    reasoning:             parsed["reasoning"] != null ? String(parsed["reasoning"]) : "",
  };
}

// ---------------------------------------------------------------------------
// Render a node summary for display in the UI.
// ---------------------------------------------------------------------------

export function renderNodeSummary(node: SpecNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const icon   = statusIcon(node.status);
  const value  = node.value ? `: ${node.value.slice(0, 60)}` : "";
  const line   = `${indent}${icon} ${node.label}${value}`;

  if (node.children.length === 0) return line;
  const childLines = node.children
    .map((c) => renderNodeSummary(c, depth + 1))
    .join("\n");
  return `${line}\n${childLines}`;
}

function statusIcon(status: SpecNode["status"]): string {
  switch (status) {
    case "complete": return "✓";
    case "partial":  return "~";
    case "empty":    return "○";
    case "n/a":      return "-";
  }
}
