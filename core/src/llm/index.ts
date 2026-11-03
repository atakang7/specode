/**
 * SPECODE — LLM Provider Adapters
 *
 * The engine only ever calls the LLMProvider interface.
 * This module provides concrete adapters for common providers.
 *
 * Adding a new provider:
 *   1. Implement the LLMProvider interface
 *   2. Export it from this file
 *   3. Add it to createProviderFromEnv()
 *   That's it — the engine needs no other changes.
 */

import { LLMProvider, LLMMessage, LLMResponse } from "../types/index.js";

// ---------------------------------------------------------------------------
// Anthropic Claude
// ---------------------------------------------------------------------------

export class ClaudeProvider implements LLMProvider {
  name = "claude";
  private apiKey: string;
  private model:  string;

  constructor(apiKey: string, model = "claude-sonnet-4-6") {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const systemMessage       = messages.find((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      this.model,
        max_tokens: 1024,
        system:     systemMessage?.content,
        messages:   conversationMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage:   { input_tokens: number; output_tokens: number };
    };

    return {
      content: data.content[0]?.text ?? "",
      usage:   { input: data.usage.input_tokens, output: data.usage.output_tokens },
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private apiKey: string;
  private model:  string;

  constructor(apiKey: string, model = "gpt-4o") {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model:      this.model,
        messages,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage:   { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message.content ?? "",
      usage:   { input: data.usage.prompt_tokens, output: data.usage.completion_tokens },
    };
  }
}

// ---------------------------------------------------------------------------
// Ollama (local models)
// ---------------------------------------------------------------------------

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private baseUrl: string;
  private model:   string;

  constructor(model = "qwen3.5:0.8b", baseUrl = "http://localhost:11434") {
    this.model   = model;
    this.baseUrl = baseUrl;
  }

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:    this.model,
        messages,
        stream:   false,
        options:  { temperature: 0.1, num_ctx: 4096 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return { content: data.message.content ?? "" };
  }
}

// ---------------------------------------------------------------------------
// Factory — create a provider from environment variables
// ---------------------------------------------------------------------------

export function createProviderFromEnv(): LLMProvider {
  const provider = process.env.SPECODE_PROVIDER ?? "claude";

  switch (provider) {
    case "claude": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is required for the Claude provider");
      return new ClaudeProvider(key, process.env.SPECODE_MODEL ?? "claude-sonnet-4-6");
    }
    case "openai": {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY is required for the OpenAI provider");
      return new OpenAIProvider(key, process.env.SPECODE_MODEL ?? "gpt-4o");
    }
    case "ollama": {
      return new OllamaProvider(
        process.env.SPECODE_MODEL    ?? "qwen3.5:0.8b",
        process.env.OLLAMA_BASE_URL  ?? "http://localhost:11434"
      );
    }
    default:
      throw new Error(
        `Unknown provider "${provider}". Set SPECODE_PROVIDER to: claude | openai | ollama`
      );
  }
}
