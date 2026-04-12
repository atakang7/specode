/**
 * SPECODE — Core Types
 *
 * These types define the entire shape of the spec system.
 * The SpecTree is the single source of truth. Everything else
 * (LLM prompts, UI rendering, code generation) reads from it.
 */

// ---------------------------------------------------------------------------
// Verbosity level — controls how the AI communicates with the user
// ---------------------------------------------------------------------------

export type VerbosityLevel = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Node status — tracks completeness of every spec atom
// ---------------------------------------------------------------------------

export type NodeStatus =
  | "empty"       // Not yet touched
  | "partial"     // Some info gathered, still has unresolved gaps
  | "complete"    // Fully resolved, ready for code generation
  | "n/a";        // Not applicable given the project context

// ---------------------------------------------------------------------------
// Node types — what kind of spec atom this node represents
// ---------------------------------------------------------------------------

export type NodeKind =
  | "intent"        // What the app does at the highest level
  | "platform"      // Target platform: web, desktop, embedded, mobile, cli
  | "user-role"     // A type of user who interacts with the system
  | "feature"       // A discrete capability the app provides
  | "data-model"    // A data entity or schema
  | "integration"   // External service, API, or dependency
  | "constraint"    // Non-functional requirement: perf, security, compliance
  | "tech-stack"    // Language, framework, runtime choices
  | "flow"          // A sequence of interactions or operations
  | "shared";       // A subtree hoisted because it appears in multiple places

// ---------------------------------------------------------------------------
// A single node in the spec tree
// ---------------------------------------------------------------------------

export interface SpecNode {
  /** Unique identifier within the tree */
  id: string;

  /** Human-readable label */
  label: string;

  /** What kind of spec atom this is */
  kind: NodeKind;

  /** Current completeness status */
  status: NodeStatus;

  /**
   * The actual spec content for this node.
   * Starts as null, gets filled through conversation.
   */
  value: string | null;

  /**
   * Sub-nodes — this is what makes the tree recursive.
   * A feature node can have child data-model nodes, child flow nodes, etc.
   */
  children: SpecNode[];

  /**
   * IDs of other nodes this node depends on.
   * Used for gap detection: if a dependency is incomplete, this node
   * may produce follow-up questions automatically.
   */
  dependsOn: string[];

  /**
   * If this node is a reference to a shared subtree, point to the
   * shared node's ID instead of duplicating it.
   */
  sharedRef?: string;

  /** Metadata — when this node was last updated */
  updatedAt: string;

  /** Open questions the AI has flagged about this node */
  openQuestions: string[];
}

// ---------------------------------------------------------------------------
// The full spec tree
// ---------------------------------------------------------------------------

export interface SpecTree {
  /** Unique spec session ID */
  id: string;

  /** Short title derived from the user's initial intent */
  title: string;

  /** Root nodes of the tree (top-level spec dimensions) */
  nodes: SpecNode[];

  /**
   * Shared subtrees — common patterns (auth, CRUD, notifications) that
   * are hoisted here and referenced by multiple nodes rather than
   * duplicated throughout the tree.
   */
  shared: SpecNode[];

  /** Overall completeness score, 0–100 */
  completeness: number;

  /** Verbosity level for this session */
  verbosity: VerbosityLevel;

  /** When this spec was created */
  createdAt: string;

  /** When this spec was last updated */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// A single turn in the conversation
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "ai" | "user";
  content: string;
  /** Which node in the tree this turn is about */
  nodeId?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// LLM provider abstraction
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  /** Raw token usage if available */
  usage?: { input: number; output: number };
}

/**
 * Any LLM provider (Claude, OpenAI, Ollama, etc.) must implement this.
 * The engine only calls this interface — it never imports a specific SDK.
 */
export interface LLMProvider {
  name: string;
  complete(messages: LLMMessage[]): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// The result of a gap-detection pass on the tree
// ---------------------------------------------------------------------------

export interface GapAnalysis {
  /** The single highest-priority node to ask about next */
  priorityNode: SpecNode | null;

  /** All nodes that are incomplete, sorted by priority */
  incompleteNodes: SpecNode[];

  /** Nodes that have been flagged as ambiguous even if partially filled */
  ambiguousNodes: SpecNode[];

  /** 0–100 overall coverage score */
  coverageScore: number;

  /** True when the tree is considered complete enough to compile */
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Engine session — runtime state managed by the engine
// ---------------------------------------------------------------------------

export interface EngineSession {
  tree: SpecTree;
  conversation: ConversationTurn[];
  provider: LLMProvider;
  verbosity: VerbosityLevel;
}
