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
  intentNode.status = "partial";

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
  // Only scan feature nodes — shared patterns live in features, not in
  // platform/intent/constraints which are structurally unique.
  const featureNodes = tree.nodes.filter((n) => n.kind === "feature");
  const labelToIds   = new Map<string, string[]>();

  collectFeatureChildLabels(featureNodes, labelToIds);

  let updatedTree = { ...tree };

  for (const [label, ids] of labelToIds.entries()) {
    const isKnownPattern = SHARED_PATTERNS.some((p) =>
      label.toLowerCase().includes(p)
    );

    if (ids.length > 1 || isKnownPattern) {
      const already = updatedTree.shared.find(
        (s) => s.label.toLowerCase() === label.toLowerCase()
      );

      if (!already) {
        // Create the shared node
        const sharedNode = makeNode(label, "shared");
        updatedTree = { ...updatedTree, shared: [...updatedTree.shared, sharedNode] };
        // Replace all duplicates in the feature tree with sharedRef pointers
        updatedTree = {
          ...updatedTree,
          nodes: replaceWithSharedRef(updatedTree.nodes, label, sharedNode.id),
        };
      }
    }
  }

  updatedTree.updatedAt    = new Date().toISOString();
  updatedTree.completeness = scoreTree(updatedTree);
  return updatedTree;
}

function collectFeatureChildLabels(
  nodes: SpecNode[],
  map: Map<string, string[]>
): void {
  for (const node of nodes) {
    for (const child of node.children) {
      const existing = map.get(child.label) ?? [];
      map.set(child.label, [...existing, child.id]);
      // Recurse into grandchildren
      if (child.children.length > 0) collectFeatureChildLabels([child], map);
    }
  }
}

function replaceWithSharedRef(
  nodes: SpecNode[],
  label: string,
  sharedId: string
): SpecNode[] {
  return nodes.map((node) => {
    if (node.children.length === 0) return node;
    const updatedChildren = node.children.map((child) => {
      if (child.label.toLowerCase() === label.toLowerCase() && !child.sharedRef) {
        // Replace with a lightweight reference node
        return {
          ...child,
          sharedRef: sharedId,
          status: "complete" as const,
          value: `→ shared/${label}`,
          children: [],
          updatedAt: new Date().toISOString(),
        };
      }
      return child;
    });
    return { ...node, children: replaceWithSharedRef(updatedChildren, label, sharedId) };
  });
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
  const allNodes = flattenNodes(tree.nodes);

  // Validate dependency graph is acyclic before using it
  validateNoCycles(allNodes);

  const incompleteNodes = allNodes
    .filter((n) => n.status === "empty" || n.status === "partial")
    .filter((n) => !n.sharedRef)                     // skip reference nodes
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
    isComplete: coverageScore >= 85 && incompleteNodes.length === 0 && ambiguousNodes.length === 0,
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
  const allNodes = flattenNodes(tree.nodes);
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
