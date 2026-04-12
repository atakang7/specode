#!/usr/bin/env node
/**
 * SPECODE CLI
 *
 * Layout (terminal, monospace, efficiency-first):
 *
 *   ┌─ SPEC TREE ──────────────────┐ ┌─ CONVERSATION ──────────────────┐
 *   │ ✓ Intent: todo app in TS     │ │ AI: target platform?            │
 *   │ ~ Platform                   │ │     [web / desktop / mobile]    │
 *   │ ○ User Roles                 │ │                                 │
 *   │ ○ Features                   │ │ You: web                        │
 *   │   ○ Auth (shared)            │ │                                 │
 *   │ ○ Data Models                │ │ AI: auth strategy?              │
 *   └──────────────────────────────┘ │     [JWT / session / OAuth]     │
 *   ┌─ STATUS ─────────────────────┐ └─────────────────────────────────┘
 *   │ coverage: 42% │ verbosity: M │ ┌─ INPUT ─────────────────────────┐
 *   │ provider: claude             │ │ > _                             │
 *   └──────────────────────────────┘ └─────────────────────────────────┘
 *
 * Commands (typed in input):
 *   /verbosity low|medium|high   — change verbosity
 *   /save                        — save spec to specs/ directory
 *   /quit                        — exit
 */

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import {
  Engine,
  SpecTree,
  ConversationTurn,
  VerbosityLevel,
  createProviderFromEnv,
  renderNodeSummary,
} from "@specode/core";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// CLI entry — parse args and launch the Ink app
// ---------------------------------------------------------------------------

const rawIntent = process.argv.slice(2).join(" ").trim();
const verbosity = (process.env.SPECODE_VERBOSITY as VerbosityLevel) ?? "medium";

if (!rawIntent) {
  console.error("Usage: specode <your intent>");
  console.error('Example: specode "a todo app in TypeScript"');
  process.exit(1);
}

let provider;
try {
  provider = createProviderFromEnv();
} catch (err) {
  console.error(
    `Provider error: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}

const engine = new Engine(provider, verbosity);

// ---------------------------------------------------------------------------
// Root app component
// ---------------------------------------------------------------------------

function App() {
  const { exit } = useApp();
  const [tree, setTree] = useState<SpecTree | null>(null);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Initializing...");
  const [isComplete, setIsComplete] = useState(false);

  // Wire engine events to local state
  useEffect(() => {
    engine.on("tree:updated", (t: SpecTree) => {
      setTree(t);
      setConversation([...engine.getConversation()]);
    });

    engine.on("thinking:start", () => {
      setIsThinking(true);
      setStatusMessage("thinking...");
    });

    engine.on("thinking:end", () => {
      setIsThinking(false);
      setStatusMessage("ready");
    });

    engine.on("spec:complete", (t: SpecTree) => {
      setTree(t);
      setIsComplete(true);
      setStatusMessage("spec complete!");
    });

    engine.on("error", (msg: string) => {
      setIsThinking(false);
      setStatusMessage(`error: ${msg}`);
    });

    // Kick off the session
    engine.start(rawIntent);
  }, []);

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setInput("");

      // Handle slash commands
      if (trimmed.startsWith("/")) {
        handleCommand(trimmed);
        return;
      }

      if (!isComplete) {
        await engine.answer(trimmed);
        setConversation([...engine.getConversation()]);
      }
    },
    [isComplete]
  );

  function handleCommand(cmd: string) {
    const [command, ...args] = cmd.slice(1).split(" ");

    switch (command) {
      case "verbosity": {
        const level = args[0] as VerbosityLevel;
        if (["low", "medium", "high"].includes(level)) {
          engine.setVerbosity(level);
          setStatusMessage(`verbosity → ${level}`);
        } else {
          setStatusMessage("usage: /verbosity low|medium|high");
        }
        break;
      }
      case "save": {
        const t = engine.getTree();
        const dir = path.join(process.cwd(), "specs");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${t.id}.json`);
        fs.writeFileSync(file, JSON.stringify(t, null, 2));
        setStatusMessage(`saved → specs/${t.id}.json`);
        break;
      }
      case "quit":
      case "exit":
        exit();
        break;
      default:
        setStatusMessage(`unknown command: /${command}`);
    }
  }

  if (!tree) {
    return (
      <Box>
        <Text color="yellow">Initializing SPECODE...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      {/* Main panels */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left: Spec tree */}
        <TreePanel tree={tree} />

        {/* Right: Conversation */}
        <ConversationPanel turns={conversation} isThinking={isThinking} />
      </Box>

      {/* Bottom: Status bar + Input */}
      <StatusBar tree={tree} statusMessage={statusMessage} />
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isThinking || isComplete}
        isComplete={isComplete}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tree Panel — left side, shows the spec tree
// ---------------------------------------------------------------------------

function TreePanel({ tree }: { tree: SpecTree }) {
  const width = 40;
  const lines: string[] = [];

  for (const node of tree.nodes) {
    lines.push(renderNodeSummary(node));
  }

  if (tree.shared.length > 0) {
    lines.push("");
    lines.push("── shared ──");
    for (const node of tree.shared) {
      lines.push(`  ◆ ${node.label}`);
    }
  }

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold color="cyan">
        SPEC TREE
      </Text>
      {lines.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Conversation Panel — right side, shows the dialogue
// ---------------------------------------------------------------------------

function ConversationPanel({
  turns,
  isThinking,
}: {
  turns: ConversationTurn[];
  isThinking: boolean;
}) {
  // Show last 20 turns
  const visible = turns.slice(-20);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold color="cyan">
        CONVERSATION
      </Text>
      {visible.map((turn, i) => (
        <Box key={i} flexDirection="column" marginBottom={0}>
          <Text color={turn.role === "ai" ? "green" : "white"} wrap="wrap">
            {turn.role === "ai" ? "AI: " : "You: "}
            {turn.content}
          </Text>
        </Box>
      ))}
      {isThinking && <Text color="yellow">AI: thinking...</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status Bar
// ---------------------------------------------------------------------------

function StatusBar({
  tree,
  statusMessage,
}: {
  tree: SpecTree;
  statusMessage: string;
}) {
  const verbosityShort: Record<VerbosityLevel, string> = {
    low: "L",
    medium: "M",
    high: "H",
  };

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="cyan">coverage: </Text>
      <Text color={tree.completeness >= 85 ? "green" : "yellow"}>
        {tree.completeness}%
      </Text>
      <Text color="gray"> │ </Text>
      <Text color="cyan">verbosity: </Text>
      <Text>{verbosityShort[tree.verbosity]}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">{statusMessage}</Text>
      <Text color="gray">  /verbosity /save /quit</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Input Bar
// ---------------------------------------------------------------------------

function InputBar({
  value,
  onChange,
  onSubmit,
  disabled,
  isComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
  isComplete: boolean;
}) {
  return (
    <Box borderStyle="single" borderColor={disabled ? "gray" : "white"} paddingX={1}>
      <Text color="gray">{"> "}</Text>
      {isComplete ? (
        <Text color="green">Spec complete. /save to export, /quit to exit.</Text>
      ) : disabled ? (
        <Text color="gray">waiting...</Text>
      ) : (
        <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

render(<App />);
