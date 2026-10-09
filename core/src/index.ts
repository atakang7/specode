/**
 * SPECODE — Engine
 *
 * Orchestrates the full spec elicitation loop:
 *   1. Initialize a tree from user intent
 *   2. Analyze gaps → find the highest-priority unknown
 *   3. Build a context-rich prompt and call the LLM
 *   4. Parse the structured response and apply mutations to the tree
 *   5. Detect and hoist shared patterns
 *   6. Emit events so UIs (CLI, web) can re-render reactively
 *   7. Repeat until the tree is complete
 *
 * The engine is completely UI-agnostic. All communication is through events.
 * External callers never mutate the tree directly — they call engine methods.
 */

import { Emitter } from "./emitter.js";
import {
  SpecTree,
  EngineSession,
  ConversationTurn,
  VerbosityLevel,
  LLMProvider,
} from "./types/index.js";
import {
  initTree,
  updateNode,
  addChildNode,
  hoistSharedSubtrees,
  analyzeGaps,
  makeNode,
  resolveNodeId,
} from "./tree/index.js";
import {
  buildMessages,
  parseLLMResponse,
  ParsedLLMResponse,
} from "./prompts/index.js";

// ---------------------------------------------------------------------------
// Engine events
// ---------------------------------------------------------------------------

export type EngineEvent =
  | { type: "tree:updated";    tree: SpecTree }
  | { type: "question:ready";  question: string; targetNodeId: string | null }
  | { type: "thinking:start" }
  | { type: "thinking:end" }
  | { type: "spec:complete";   tree: SpecTree }
  | { type: "error";           message: string };

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class Engine extends Emitter {
  private session: EngineSession;

  constructor(provider: LLMProvider, verbosity: VerbosityLevel = "medium") {
    super();
    this.session = {
      tree:         initTree("", verbosity),
      conversation: [],
      provider,
      verbosity,
    };
  }

  // -------------------------------------------------------------------------
  // Start a new spec session with the user's raw intent.
  // -------------------------------------------------------------------------

  async start(rawIntent: string): Promise<void> {
    const tree = initTree(rawIntent, this.session.verbosity);
    this.session = { ...this.session, tree, conversation: [] };
    this.emit("tree:updated", this.getTree());
    await this.nextTurn();
  }

  // -------------------------------------------------------------------------
  // Submit a user answer and advance the conversation.
  // -------------------------------------------------------------------------

  async answer(userInput: string): Promise<void> {
    this.session.conversation.push({
      role:      "user",
      content:   userInput,
      timestamp: new Date().toISOString(),
    });
    await this.nextTurn();
  }

  /** Restore a previously persisted session without running an extra LLM turn. */
  restore(tree: SpecTree, conversation: ConversationTurn[]): void {
    if (!tree || !Array.isArray(tree.nodes) || !Array.isArray(conversation)) {
      throw new Error("Invalid saved spec session");
    }
    this.session.tree = structuredClone(tree);
    this.session.conversation = structuredClone(conversation);
    this.session.verbosity = tree.verbosity;
    this.emit("tree:updated", this.getTree());
  }

  // -------------------------------------------------------------------------
  // Change verbosity mid-session.
  // -------------------------------------------------------------------------

  setVerbosity(level: VerbosityLevel): void {
    this.session.verbosity       = level;
    this.session.tree            = { ...this.session.tree, verbosity: level };
    this.emit("tree:updated", this.getTree());
  }

  // -------------------------------------------------------------------------
  // Read-only access to session state.
  // Returns copies — callers cannot mutate internal state.
  // -------------------------------------------------------------------------

  getTree(): SpecTree {
    return structuredClone(this.session.tree);
  }

  getConversation(): ConversationTurn[] {
    return [...this.session.conversation];
  }

  // -------------------------------------------------------------------------
  // Core loop: gap analysis → build prompt → call LLM → apply mutations
  // -------------------------------------------------------------------------

  private async nextTurn(): Promise<void> {
    try {
      this.emit("thinking:start");

      const gapAnalysis = analyzeGaps(this.session.tree);

      if (gapAnalysis.isComplete) {
        this.emit("thinking:end");
        this.emit("spec:complete", this.getTree());
        return;
      }

      const messages   = buildMessages(this.session.tree, gapAnalysis, this.session.conversation);
      const llmResponse = await this.session.provider.complete(messages);
      const parsed      = parseLLMResponse(llmResponse.content);

      this.applyMutations(parsed);

      this.session.conversation.push({
        role:      "ai",
        content:   parsed.question,
        nodeId:    parsed.targetNodeId ?? undefined,
        timestamp: new Date().toISOString(),
      });

      this.emit("thinking:end");
      this.emit("tree:updated",   this.getTree());
      this.emit("question:ready", parsed.question, parsed.targetNodeId);
    } catch (err) {
      this.emit("thinking:end");
      this.emit("error", err instanceof Error ? err.message : "Unknown engine error");
    }
  }

  // -------------------------------------------------------------------------
  // Apply all mutations from a parsed LLM response to the tree.
  // -------------------------------------------------------------------------

  private applyMutations(parsed: ParsedLLMResponse): void {
    // Construct the full mutation candidate first. A bad node prefix or
    // invalid child cannot leave a half-committed tree in memory.
    let next = this.session.tree;
    if (parsed.nodeUpdate?.nodeId) {
      const { nodeId, value, status, openQuestions } = parsed.nodeUpdate;
      next = updateNode(next, resolveNodeId(next, nodeId), {
        value, status, openQuestions,
      });
    }

    for (const child of parsed.newChildren) {
      if (!child.parentId || !child.label) continue;
      next = addChildNode(next, resolveNodeId(next, child.parentId), {
        label: child.label,
        kind: child.kind,
        status: child.value ? "partial" : "empty",
        value: child.value,
        children: [],
        dependsOn: [],
        openQuestions: [],
      });
    }

    if (parsed.sharedPatternDetected) {
      const label = parsed.sharedPatternDetected;
      const exists = next.shared.some((n) => n.label.toLowerCase() === label.toLowerCase());
      if (!exists) next = { ...next, shared: [...next.shared, makeNode(label, "shared")] };
    }
    this.session.tree = hoistSharedSubtrees(next);
  }
}

// Re-export everything consumers need
export * from "./types/index.js";
export * from "./tree/index.js";
export * from "./prompts/index.js";
export {
  ClaudeProvider,
  OpenAIProvider,
  OllamaProvider,
  createProviderFromEnv,
} from "./llm/index.js";
