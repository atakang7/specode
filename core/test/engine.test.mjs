import assert from "node:assert/strict";
import test from "node:test";
import core from "../dist/index.js";

const { Engine, initTree } = core;

test("restoring a saved session restores engine state", () => {
  const engine = new Engine({ name: "stub", complete: async () => ({ content: "{}" }) });
  const tree = initTree("a calendar app", "low");
  const turns = [{ role: "user", content: "web", timestamp: "2026-01-01T00:00:00Z" }];

  engine.restore(tree, turns);
  tree.nodes[0].value = "modified outside engine";
  turns[0].content = "modified outside engine";

  assert.equal(engine.getTree().nodes[0].value, "a calendar app");
  assert.equal(engine.getConversation()[0].content, "web");
  assert.equal(engine.getTree().verbosity, "low");
});
