# Semantic DOM Filter MCP Server

A **high-pass filter** that sits between chaotic web pages and clean LLM context windows. Converts ~100KB HTML into ~2KB Semantic Markdown with integer IDs, eliminating selector hallucination and dramatically reducing token usage.

## Architecture

```
User Prompt → LLM Agent → Semantic MCP Server
                               ↓
                    ┌──────────────────────┐
                    │  Playwright (Chromium)│
                    │         ↓            │
                    │  Accessibility Tree   │
                    │         ↓            │
                    │  Semantic Processor   │
                    │  ├─ Visibility Filter │
                    │  ├─ Struct. Flatten   │
                    │  └─ Intent Pruning    │
                    │         ↓            │
                    │  Markdown Synthesizer │
                    └──────────────────────┘
                               ↓
              Clean Semantic Map → LLM Agent
                               ↓
              Action (click id=7) → Semantic Diff
```

## Tools

### `get_semantic_view`
Navigate to a URL and get a filtered semantic map.

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to navigate to |
| `task_intent` | string | What you're trying to do (guides filtering) |

**Intent-guided filtering:**
- `"read content"` / `"find pricing"` → prunes navigation, footers
- `"fill form"` / `"login"` → focuses on inputs, buttons
- `"find X"` / `"navigate"` → keeps navigation, prunes long text

### `perform_action`
Execute an action and get back only what changed (semantic diff).

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum | `click`, `type`, `select`, `hover`, `scroll`, `wait`, `press_key`, `go_back`, `go_forward`, `navigate` |
| `id` | number? | Semantic ID of the target element |
| `value` | string? | Text to type, option to select, scroll direction, key to press |
| `url` | string? | URL for `navigate` action |

### `get_current_state`
Re-extract the semantic map without navigating. Useful to refresh after multiple actions.

| Parameter | Type | Description |
|-----------|------|-------------|
| `task_intent` | string? | Optionally change the intent filter |

### `get_screenshot`
Capture a PNG screenshot of the current viewport.

| Parameter | Type | Description |
|-----------|------|-------------|
| `full_page` | boolean? | Capture the full scrollable page |

## Output Format

```markdown
# Example Page
**URL:** https://example.com
**Task:** find the pricing table
**Stats:** 23 semantic nodes (filtered from 847 raw nodes)

## Page Structure
- **main**: "Main Content" (312 nodes)
- **navigation**: "Primary Nav" (45 nodes)

## Semantic Map

[Heading(1): "Pricing Plans", id=1]
[Text: "Choose the plan that works for you"]
[Button: "Monthly", id=3, selected]
[Button: "Annual", id=4]
[Heading(2): "Starter", id=5]
[Text: "$9/month"]
[Button: "Get Started", id=7]
[Heading(2): "Pro", id=8]
[Text: "$29/month"]
[Button: "Get Started", id=10]
```

## Semantic Diff (after actions)

Instead of re-sending the whole page:

```
**Action:** click on id=3
**Result:** Changes detected

## Changes
Modified:
  [Button, id=3]: state.pressed: "unset" → "true"
Added: [Text: "Billed monthly"]
Removed: [Text: "Billed annually"]
```

## Setup

```bash
npm install
npm run build
```

## Usage with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "semantic-dom": {
      "command": "node",
      "args": ["path/to/browser_mcp/dist/index.js"]
    }
  }
}
```

## Usage with VS Code (Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "semantic-dom": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"]
    }
  }
}
```

## Why This Wins

| Metric | Raw HTML | This MCP |
|--------|----------|----------|
| Payload | ~100KB | ~2KB |
| Token cost | ~25K tokens | ~500 tokens |
| Selector accuracy | Hallucinated CSS | Integer IDs |
| After-action update | Full re-send | Diff only |
| Intent awareness | None | Prunes by task |
