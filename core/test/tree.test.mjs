import assert from "node:assert/strict";
import test from "node:test";
import tree from "../dist/tree/index.js";

const { initTree, updateNode, addChildNode } = tree;

test("updates a node using the eight-character ID from a prompt", () => {
  const initial = initTree("a todo app", "medium");
  const platform = initial.nodes.find((node) => node.kind === "platform");
  const updated = updateNode(initial, platform.id.slice(0, 8), {
    status: "complete",
    value: "web",
    openQuestions: [],
  });
  assert.equal(updated.nodes.find((node) => node.id === platform.id).value, "web");
});

test("does not add duplicate children or expand completed parents", () => {
  const initial = initTree("a todo app", "medium");
  const features = initial.nodes.find((node) => node.kind === "feature");
  const child = {
    label: "Authentication",
    kind: "feature",
    status: "empty",
    value: null,
    children: [],
    dependsOn: [],
    openQuestions: [],
  };
  const first = addChildNode(initial, features.id.slice(0, 8), child);
  const second = addChildNode(first, features.id.slice(0, 8), child);
  assert.equal(second.nodes.find((node) => node.id === features.id).children.length, 1);

  const complete = updateNode(second, features.id, { status: "complete" });
  const after = addChildNode(complete, features.id, { ...child, label: "Notifications" });
  assert.equal(after.nodes.find((node) => node.id === features.id).children.length, 1);
});
