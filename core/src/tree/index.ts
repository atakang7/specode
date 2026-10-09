/**
 * SPECODE — Spec Tree Engine
 *
 * This module owns all tree operations:
 *   - Initializing a tree from raw user intent
 *   - Expanding nodes when new information arrives
 *   - Detecting and hoisting shared subtrees (defined once, referenced everywhere)
 *   - Scoring completeness
 *   - Running gap analysis to find the next best question
 *
 * Design principle: the tree is the single source of truth.
 * The LLM reads tree state and produces structured patches.
 * This module applies those patches — it never calls the LLM directly.
 */

import { v4 as uuid } from "uuid";
import {
  SpecTree,
  SpecNode,
  NodeKind,
  GapAnalysis,
  VerbosityLevel,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Node priority — higher means "ask about this first"
// Encodes domain expertise: intent and platform must be known before anything
// else can be meaningfully specified.
// ---------------------------------------------------------------------------

export const KIND_PRIORITY: Record<NodeKind, number> = {
  intent:       100,
  platform:      90,
  "user-role":   80,
  "tech-stack":  75,
  feature:       70,
  flow:          60,
  "data-model":  55,
  integration:   50,
  constraint:    40,
  shared:        30,
};

// ---------------------------------------------------------------------------
// Known shared patterns — when these labels appear inside multiple feature
// subtrees, they get hoisted into tree.shared and replaced with sharedRef.
// ---------------------------------------------------------------------------

const SHARED_PATTERNS = [
  "authentication", "authorization", "notifications", "file upload",
  "search", "pagination", "logging", "error handling",
  "internationalization", "theming", "rate limiting", "caching",
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeNode(
  label: string,
  kind: NodeKind,
  children: SpecNode[] = [],
  dependsOn: string[] = []
): SpecNode {
  return {
    id: uuid(),
    label,
    kind,
    status: "empty",
    value: null,
    children,
    dependsOn,
    updatedAt: new Date().toISOString(),
    openQuestions: [],
  };
}

// ---------------------------------------------------------------------------
// Initialize a fresh spec tree from raw user intent.
// Builds the top-level skeleton. The AI expands nodes as the conversation
// progresses — the tree starts sparse by design.
// ---------------------------------------------------------------------------

export function initTree(
  rawIntent: string,
  verbosity: VerbosityLevel
): SpecTree {
  const intentNode = makeNode("Intent", "intent");
  intentNode.value  = rawIntent;
  // Intent starts complete — the user stated it when they launched the session.
  // The AI can refine it later but Platform is the next logical question.
  intentNode.status = "complete";

  const platform     = makeNode("Platform", "platform");
  const userRoles    = makeNode("User Roles", "user-role");
  const techStack    = makeNode("Tech Stack", "tech-stack");
  const features     = makeNode("Features", "feature");
  const dataModels   = makeNode("Data Models", "data-model");
  const integrations = makeNode("Integrations", "integration");
  const constraints  = makeNode("Constraints", "constraint");

  // Features and data models can only be meaningfully specified once intent
  // and platform are at least partially known.
  features.dependsOn     = [intentNode.id, platform.id];
  dataModels.dependsOn   = [features.id];
  integrations.dependsOn = [features.id];
  constraints.dependsOn  = [platform.id];

  const tree: SpecTree = {
    id: uuid(),
    title: deriveTitle(rawIntent),
    nodes: [intentNode, platform, userRoles, techStack, features, dataModels, integrations, constraints],
    shared: [],
    completeness: 0,
    verbosity,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return { ...tree, completeness: scoreTree(tree) };
}

// ---------------------------------------------------------------------------
// Update a node with new information.
// Called after the LLM processes a user answer and returns a structured patch.
// ---------------------------------------------------------------------------

export function updateNode(
  tree: SpecTree,
  nodeId: string,
  patch: Partial<Pick<SpecNode, "value" | "status" | "openQuestions" | "children">>
): SpecTree {
  const updatedNodes  = patchNodes(tree.nodes, nodeId, patch);
  const updatedShared = patchNodes(tree.shared, nodeId, patch);
  const updated: SpecTree = {
    ...tree,
    nodes:  updatedNodes,
    shared: updatedShared,
    updatedAt: new Date().toISOString(),
  };
  return { ...updated, completeness: scoreTree(updated) };
}

function patchNodes(
  nodes: SpecNode[],
  nodeId: string,
  patch: Partial<Pick<SpecNode, "value" | "status" | "openQuestions" | "children">>
): SpecNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, ...patch, updatedAt: new Date().toISOString() };
    }
    if (node.children.length > 0) {
      return { ...node, children: patchNodes(node.children, nodeId, patch) };
    }
    return node;
  });
}

// ---------------------------------------------------------------------------
// Add a new child node under a parent.
// Called when the LLM determines a user answer implies a new sub-spec
// (e.g. "OAuth" under auth implies "OAuth Provider Config").
// ---------------------------------------------------------------------------

export function addChildNode(
  tree: SpecTree,
  parentId: string,
  child: Omit<SpecNode, "id" | "updatedAt">
): SpecTree {
  const newChild: SpecNode = {
    ...child,
    id: uuid(),
    updatedAt: new Date().toISOString(),
  };
  const updatedNodes = insertChild(tree.nodes, parentId, newChild);
  const updated = { ...tree, nodes: updatedNodes, updatedAt: new Date().toISOString() };
  return { ...updated, completeness: scoreTree(updated) };
}

function insertChild(nodes: SpecNode[], parentId: string, child: SpecNode): SpecNode[] {
  return nodes.map((node) => {
    if (node.id === parentId) return { ...node, children: [...node.children, child] };
    if (node.children.length > 0) return { ...node, children: insertChild(node.children, parentId, child) };
    return node;
  });
}

// ---------------------------------------------------------------------------
// Detect shared patterns and hoist them.
//
// When the same concept appears as a child of multiple feature nodes:
//   1. Create a single shared node in tree.shared (if not already there)
//   2. Replace all duplicate children with sharedRef pointers
//
// This keeps the tree DRY — shared specs are defined once, referenced everywhere.
// ---------------------------------------------------------------------------

export function hoistSharedSubtrees(tree: SpecTree): SpecTree {
  // Only share concepts that actually appear in multiple feature branches.
  // A single known pattern must remain where it was defined.
  const featureNodes = tree.nodes.filter((node) => node.kind === "feature");
  const labels = new Map<string, SpecNode[]>();
  const visit = (node: SpecNode) => {
    for (const child of node.children) {
      if (!child.sharedRef) {
        const key = child.label.toLowerCase().trim();
        labels.set(key, [...(labels.get(key) ?? []), child]);
      }
      visit(child);
    }
  };
  for (const feature of featureNodes) visit(feature);

  let updated: SpecTree = { ...tree };
  for (const [label, occurrences] of labels) {
    if (occurrences.length < 2) continue;
    const existing = updated.shared.find((node) => node.label.toLowerCase().trim() === label);
    const source = occurrences.find((node) => node.value || node.children.length > 0) ?? occurrences[0];
    const canonical: SpecNode = existing ?? {
      ...source, id: uuid(), kind: "shared", updatedAt: new Date().toISOString(),
    };
    if (!existing) updated = { ...updated, shared: [...updated.shared, canonical] };
    updated = {
      ...updated,
      nodes: replaceWithSharedRef(updated.nodes, label, canonical.id),
    };
  }

  updated.updatedAt = new Date().toISOString();
  updated.completeness = scoreTree(updated);
  return updated;
}

function replaceWithSharedRef(nodes: SpecNode[], label: string, sharedId: string): SpecNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children.map((child) => {
      if (child.label.toLowerCase().trim() === label && !child.sharedRef) {
        return {
          ...child, sharedRef: sharedId,
          status: "complete" as const, value: `→ shared/${child.label}`,
          children: [], openQuestions: [],
          updatedAt: new Date().toISOString(),
        };
      }
      return replaceWithSharedRef([child], label, sharedId)[0];
    }),
  }));
}

/** Resolve the 8-character node IDs sent by models; reject ambiguity. */
export function resolveNodeId(tree: SpecTree, prefix: string): string {
  if (!prefix || prefix.length < 8) throw new Error("Invalid node ID prefix");
  const candidates = flattenNodes([...tree.nodes, ...tree.shared])
    .filter((node) => node.id === prefix || node.id.startsWith(prefix));
  if (candidates.length !== 1) {
    throw new Error(`Unresolvable or ambiguous node ID: ${prefix}`);
  }
  return candidates[0].id;
}

// ---------------------------------------------------------------------------
// Gap analysis — finds the highest-priority incomplete node to ask about.
//
// Core of the non-sequential conversation model: instead of a fixed question
// order, the engine always asks about the most important unknown.
//
// A node is eligible for a question only if its dependencies are at least
// partially filled — we can't ask about Features before knowing Intent.
// ---------------------------------------------------------------------------

export function analyzeGaps(tree: SpecTree): GapAnalysis {
  const allNodes = flattenNodes([...tree.nodes, ...tree.shared]);

  // Validate dependency graph is acyclic before using it
  validateNoCycles(allNodes);

  const unresolved = allNodes.filter((node) =>
    !node.sharedRef && (node.status === "empty" || node.status === "partial")
  );
  const incompleteNodes = unresolved                     // skip reference nodes
    .filter((n) => dependenciesMet(n, allNodes))
    .sort((a, b) => KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]);

  const ambiguousNodes = allNodes.filter(
    (n) => n.status === "complete" && n.openQuestions.length > 0
  );

  // Ambiguous nodes re-enter the queue — completed but still need clarification
  const priorityNode = incompleteNodes[0] ?? ambiguousNodes[0] ?? null;
  const coverageScore = scoreTree(tree);

  return {
    priorityNode,
    incompleteNodes,
    ambiguousNodes,
    coverageScore,
    isComplete: coverageScore >= 85 && unresolved.length === 0 && ambiguousNodes.length === 0,
  };
}

function dependenciesMet(node: SpecNode, allNodes: SpecNode[]): boolean {
  if (node.dependsOn.length === 0) return true;
  return node.dependsOn.every((depId) => {
    const dep = allNodes.find((n) => n.id === depId);
    // n/a counts as met; missing dep (shouldn't happen) counts as met to avoid deadlock
    if (!dep) return true;
    return dep.status === "complete" || dep.status === "partial" || dep.status === "n/a";
  });
}

// Detect circular dependencies — throws if any cycle exists.
// Uses DFS with coloring: white=unvisited, gray=in-progress, black=done.
function validateNoCycles(nodes: SpecNode[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const color   = new Map<string, "white" | "gray" | "black">();

  nodes.forEach((n) => color.set(n.id, "white"));

  function dfs(id: string, path: string[]): void {
    const c = color.get(id);
    if (c === "black") return;
    if (c === "gray") {
      throw new Error(
        `Circular dependency detected in spec tree: ${[...path, id].join(" → ")}`
      );
    }
    color.set(id, "gray");
    const node = nodeMap.get(id);
    if (node) {
      for (const depId of node.dependsOn) dfs(depId, [...path, id]);
    }
    color.set(id, "black");
  }

  for (const node of nodes) dfs(node.id, []);
}

// ---------------------------------------------------------------------------
// Scoring — 0–100 completeness weighted by node kind priority.
// A missing "intent" node hurts far more than a missing "constraint" node.
// ---------------------------------------------------------------------------

export function scoreTree(tree: SpecTree): number {
  const allNodes = flattenNodes([...tree.nodes, ...tree.shared]).filter((node) => !node.sharedRef);
  if (allNodes.length === 0) return 0;

  let totalWeight  = 0;
  let filledWeight = 0;

  for (const node of allNodes) {
    const weight = KIND_PRIORITY[node.kind] ?? 30;
    totalWeight += weight;
    if      (node.status === "complete") filledWeight += weight;
    else if (node.status === "partial")  filledWeight += weight * 0.5;
    else if (node.status === "n/a")      filledWeight += weight; // n/a = intentionally skipped = counts as filled
  }

  return Math.round((filledWeight / totalWeight) * 100);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function flattenNodes(nodes: SpecNode[]): SpecNode[] {
  const result: SpecNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) result.push(...flattenNodes(node.children));
  }
  return result;
}

export function findNodeById(tree: SpecTree, id: string): SpecNode | undefined {
  return flattenNodes([...tree.nodes, ...tree.shared]).find((n) => n.id === id);
}

function deriveTitle(rawIntent: string): string {
  const trimmed = rawIntent.slice(0, 60);
  const lastSpace = trimmed.lastIndexOf(" ");
  return lastSpace > 20 ? trimmed.slice(0, lastSpace) : trimmed;
}
