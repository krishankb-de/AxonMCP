#!/usr/bin/env node

/**
 * Semantic DOM Filter MCP Server
 * 
 * A high-pass filter that sits between chaotic web pages and clean LLM context.
 * Converts 100KB HTML into ~2KB Semantic Markdown with integer IDs for
 * zero-hallucination element targeting.
 * 
 * Tools:
 *   - get_semantic_view:  Navigate to URL, extract semantic map guided by task intent
 *   - perform_action:     Click, type, select, hover, scroll, keyboard, navigate
 *   - get_screenshot:     Capture a PNG screenshot of the current page
 *   - get_current_state:  Re-extract the semantic map without navigating
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { BrowserEngine } from "./browser-engine.js";
import { SemanticProcessor } from "./semantic-processor.js";
import { MarkdownSynthesizer } from "./markdown-synthesizer.js";
import { DiffEngine } from "./diff-engine.js";
import type {
  SemanticMap,
  SessionState,
} from "./types.js";

// ─── Globals ────────────────────────────────────────────────────────────────

const browser = new BrowserEngine();
const processor = new SemanticProcessor();
const synthesizer = new MarkdownSynthesizer();
const diffEngine = new DiffEngine();

/** In-memory cache for semantic diff calculations */
let sessionState: SessionState | null = null;

/** Maps semantic integer IDs → CSS selectors for action execution */
let selectorMap: Map<number, string> = new Map();

// ─── Pipeline Helper ────────────────────────────────────────────────────────

async function extractSemanticMap(taskIntent: string): Promise<SemanticMap> {
  // 1. Inject semantic IDs into the DOM
  const injectedMap = await browser.injectSemanticIds();

  // 2. Extract accessibility tree
  const axTree = await browser.getAccessibilityTree();

  // 3. Process through semantic shredder
  const { nodes, landmarks, totalRaw } = processor.process(
    axTree,
    taskIntent,
    injectedMap
  );

  // 4. Update selector map
  selectorMap = injectedMap;

  // 5. Build the semantic map
  const map: SemanticMap = {
    url: browser.getCurrentUrl(),
    title: await browser.getCurrentTitle(),
    timestamp: Date.now(),
    taskIntent,
    totalRawNodes: totalRaw,
    totalFilteredNodes: nodes.length,
    nodes,
    landmarks,
  };

  return map;
}

// ─── MCP Server Setup ───────────────────────────────────────────────────────

const server = new McpServer({
  name: "semantic-dom-filter",
  version: "1.0.0",
});

// ─── Tool: get_semantic_view ─────────────────────────────────────────────────

server.tool(
  "get_semantic_view",
  "Navigate to a URL and extract a filtered semantic map of the page. " +
    "The task_intent guides what gets included: 'read content' prunes nav/footers, " +
    "'fill form' focuses on inputs, 'find X' keeps navigation elements. " +
    "Returns compact Semantic Markdown with integer IDs for every interactive element.",
  {
    url: z.string().describe("The URL to navigate to"),
    task_intent: z
      .string()
      .describe(
        "What you're trying to accomplish on this page (e.g., 'find the pricing table', 'fill the login form', 'read the article')"
      ),
  },
  async ({ url, task_intent }) => {
    try {
      // Navigate
      await browser.navigate(url);

      // Extract semantic map
      const semanticMap = await extractSemanticMap(task_intent);

      // Cache state for future diffs
      sessionState = {
        url: semanticMap.url,
        title: semanticMap.title,
        taskIntent: task_intent,
        lastSemanticMap: semanticMap,
        timestamp: Date.now(),
      };

      // Synthesize markdown
      const markdown = synthesizer.synthesize(semanticMap);

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: perform_action ────────────────────────────────────────────────────

server.tool(
  "perform_action",
  "Execute an action on the current page and return only the semantic diff (what changed). " +
    "Actions: click/type/select/hover on elements by ID, scroll, press_key, go_back, go_forward, navigate to URL. " +
    "Returns a concise diff instead of the full page, plus the updated semantic map if significant changes occurred.",
  {
    action: z
      .enum([
        "click",
        "type",
        "select",
        "hover",
        "scroll",
        "wait",
        "press_key",
        "go_back",
        "go_forward",
        "navigate",
      ])
      .describe("The action to perform"),
    id: z
      .number()
      .optional()
      .describe(
        "The semantic ID of the element to interact with (from the semantic map)"
      ),
    value: z
      .string()
      .optional()
      .describe(
        "Value for type/select actions, direction for scroll (up/down), key for press_key"
      ),
    url: z
      .string()
      .optional()
      .describe("URL for navigate action"),
  },
  async ({ action, id, value, url }) => {
    try {
      // Validate state
      if (!sessionState) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No active session. Call get_semantic_view first to navigate to a page.",
            },
          ],
          isError: true,
        };
      }

      // ── Execute the action ──────────────────────────────────────────────

      switch (action) {
        case "click": {
          if (id === undefined) throw new Error("click requires an element id");
          const selector = selectorMap.get(id);
          if (!selector) throw new Error(`No element found with id=${id}. It may have changed — call get_current_state to refresh.`);
          await browser.clickElement(selector);
          break;
        }

        case "type": {
          if (id === undefined) throw new Error("type requires an element id");
          if (!value) throw new Error("type requires a value");
          const selector = selectorMap.get(id);
          if (!selector) throw new Error(`No element found with id=${id}.`);
          await browser.typeIntoElement(selector, value);
          break;
        }

        case "select": {
          if (id === undefined) throw new Error("select requires an element id");
          if (!value) throw new Error("select requires a value");
          const selector = selectorMap.get(id);
          if (!selector) throw new Error(`No element found with id=${id}.`);
          await browser.selectOption(selector, value);
          break;
        }

        case "hover": {
          if (id === undefined) throw new Error("hover requires an element id");
          const selector = selectorMap.get(id);
          if (!selector) throw new Error(`No element found with id=${id}.`);
          await browser.hoverElement(selector);
          break;
        }

        case "scroll": {
          const direction = (value === "up" ? "up" : "down") as "up" | "down";
          await browser.scroll(direction);
          break;
        }

        case "wait": {
          const ms = value ? parseInt(value, 10) : 2000;
          await browser.waitForSettled(ms);
          break;
        }

        case "press_key": {
          if (!value) throw new Error("press_key requires a value (e.g., 'Enter', 'Tab', 'Escape')");
          await browser.pressKey(value);
          break;
        }

        case "go_back":
          await browser.goBack();
          break;

        case "go_forward":
          await browser.goForward();
          break;

        case "navigate": {
          if (!url) throw new Error("navigate requires a url");
          await browser.navigate(url);
          break;
        }
      }

      // ── Wait for page to settle ────────────────────────────────────────
      await browser.waitForSettled(2000);

      // ── Take "after" snapshot ──────────────────────────────────────────
      const afterMap = await extractSemanticMap(sessionState.taskIntent);

      // ── Calculate diff ─────────────────────────────────────────────────
      const diff = diffEngine.diff(sessionState.lastSemanticMap, afterMap);

      // ── Update cached state ────────────────────────────────────────────
      sessionState = {
        url: afterMap.url,
        title: afterMap.title,
        taskIntent: sessionState.taskIntent,
        lastSemanticMap: afterMap,
        timestamp: Date.now(),
      };

      // ── Build response ─────────────────────────────────────────────────
      const response: string[] = [];
      response.push(`**Action:** ${action}${id !== undefined ? ` on id=${id}` : ""}${value ? ` value="${value}"` : ""}`);
      response.push(`**Result:** ${diff.hasChanges ? "Changes detected" : "No visible changes"}`);
      response.push("");

      if (diff.hasChanges) {
        response.push("## Changes");
        response.push(diff.summary);
        response.push("");

        // If major changes (navigation, many additions), include the full updated map
        const isMajorChange =
          diff.urlChange ||
          diff.added.length > 5 ||
          diff.removed.length > 5;

        if (isMajorChange) {
          response.push("## Updated Semantic Map");
          response.push(synthesizer.synthesize(afterMap));
        }
      }

      return {
        content: [{ type: "text" as const, text: response.join("\n") }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_current_state ─────────────────────────────────────────────────

server.tool(
  "get_current_state",
  "Re-extract the semantic map of the current page without navigating. " +
    "Useful after multiple actions when you want to see the full current state. " +
    "Optionally update the task_intent to change the filtering heuristics.",
  {
    task_intent: z
      .string()
      .optional()
      .describe("Optionally update the task intent to re-filter the page"),
  },
  async ({ task_intent }) => {
    try {
      if (!sessionState) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No active session. Call get_semantic_view first.",
            },
          ],
          isError: true,
        };
      }

      const intent = task_intent || sessionState.taskIntent;
      const semanticMap = await extractSemanticMap(intent);

      // Update session
      sessionState = {
        url: semanticMap.url,
        title: semanticMap.title,
        taskIntent: intent,
        lastSemanticMap: semanticMap,
        timestamp: Date.now(),
      };

      const markdown = synthesizer.synthesize(semanticMap);

      return {
        content: [{ type: "text" as const, text: markdown }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool: get_screenshot ────────────────────────────────────────────────────

server.tool(
  "get_screenshot",
  "Capture a screenshot of the current page. Returns a PNG image. " +
    "Useful for visual verification when the semantic map isn't sufficient.",
  {
    full_page: z
      .boolean()
      .optional()
      .default(false)
      .describe("Capture the full scrollable page instead of just the viewport"),
  },
  async ({ full_page }) => {
    try {
      const screenshot = await browser.screenshot(full_page);
      return {
        content: [
          {
            type: "image" as const,
            data: screenshot.toString("base64"),
            mimeType: "image/png",
          },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Resource: session state ─────────────────────────────────────────────────

server.resource(
  "session-state",
  "browser://session",
  async (uri) => {
    if (!sessionState) {
      return {
        contents: [
          {
            uri: uri.href,
            text: "No active browser session.",
            mimeType: "text/plain",
          },
        ],
      };
    }

    const state = {
      url: sessionState.url,
      title: sessionState.title,
      taskIntent: sessionState.taskIntent,
      totalNodes: sessionState.lastSemanticMap.totalFilteredNodes,
      timestamp: new Date(sessionState.timestamp).toISOString(),
    };

    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(state, null, 2),
          mimeType: "application/json",
        },
      ],
    };
  }
);

// ─── Cleanup & Start ─────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await browser.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await browser.close();
  process.exit(0);
});

process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:", err);
  await browser.close();
  process.exit(1);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Semantic DOM Filter MCP server running on stdio");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await browser.close();
  process.exit(1);
});
