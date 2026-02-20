/**
 * Quick test script — runs the full pipeline against a real URL
 * and prints the semantic map output.
 *
 * Usage:
 *   node dist/test-run.js                                 # default demo
 *   node dist/test-run.js <url> "<intent>"                # read only
 *   node dist/test-run.js <url> "<intent>" click "<text>" # navigate + click + read result
 *
 * Example (this repo's use case):
 *   node dist/test-run.js https://modelcontextprotocol.io/docs/getting-started/intro \
 *     "find and press the Build servers button" click "Build servers"
 */

import { BrowserEngine } from "./browser-engine.js";
import { SemanticProcessor } from "./semantic-processor.js";
import { MarkdownSynthesizer } from "./markdown-synthesizer.js";
import { DiffEngine } from "./diff-engine.js";
import type { SemanticMap, SemanticNode } from "./types.js";

const TEST_URL   = process.argv[2] || "https://modelcontextprotocol.io/docs/getting-started/intro";
const TASK_INTENT = process.argv[3] || "find and press the Build servers button";
const MODE        = process.argv[4] || "click";          // "read" | "click"
const CLICK_TEXT  = process.argv[5] || "Build servers";  // button/link text to find

const browser     = new BrowserEngine();
const processor   = new SemanticProcessor();
const synthesizer = new MarkdownSynthesizer();
const diffEngine  = new DiffEngine();

// ─── Selector map shared across phases ───────────────────────────────────────
let selectorMap = new Map<number, string>();

async function extractSemanticMap(taskIntent: string): Promise<SemanticMap> {
  const injectedMap = await browser.injectSemanticIds();
  selectorMap = injectedMap;
  const axTree = await browser.getAccessibilityTree();
  const { nodes, landmarks, totalRaw } = processor.process(axTree, taskIntent, injectedMap);

  return {
    url: browser.getCurrentUrl(),
    title: await browser.getCurrentTitle(),
    timestamp: Date.now(),
    taskIntent,
    totalRawNodes: totalRaw,
    totalFilteredNodes: nodes.length,
    nodes,
    landmarks,
  };
}

// ─── Find a node by fuzzy text match ─────────────────────────────────────────
function findNodeByText(nodes: SemanticNode[], text: string): SemanticNode | null {
  const lower = text.toLowerCase();
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(lower)) return node;
    if (node.children) {
      const found = findNodeByText(node.children, text);
      if (found) return found;
    }
  }
  return null;
}

// ─── Print a section divider ──────────────────────────────────────────────────
function section(title: string) {
  console.log("\n" + "═".repeat(80));
  console.log(` ${title}`);
  console.log("═".repeat(80) + "\n");
}

async function main() {
  console.log(`\n🌐  URL         : ${TEST_URL}`);
  console.log(`🎯  Task intent : "${TASK_INTENT}"`);
  console.log(`⚙️   Mode        : ${MODE}${MODE === "click" ? ` → looking for "${CLICK_TEXT}"` : ""}\n`);

  // ── Phase 1: Navigate ──────────────────────────────────────────────────────
  const t0 = Date.now();
  const { url, title } = await browser.navigate(TEST_URL);
  console.log(`✅  Page loaded in ${Date.now() - t0}ms`);
  console.log(`    URL:   ${url}`);
  console.log(`    Title: ${title}`);

  // ── Phase 2: Extract initial semantic map ─────────────────────────────────
  const t1 = Date.now();
  const semanticMap = await extractSemanticMap(TASK_INTENT);
  const rawHtmlSize = await browser.evaluate<number>("document.documentElement.outerHTML.length");
  const markdown0   = synthesizer.synthesize(semanticMap);

  console.log(`\n✅  Semantic map ready in ${Date.now() - t1}ms`);
  console.log(`    Raw nodes    : ${semanticMap.totalRawNodes}`);
  console.log(`    Kept nodes   : ${semanticMap.totalFilteredNodes}  (${((1 - semanticMap.totalFilteredNodes / semanticMap.totalRawNodes) * 100).toFixed(1)}% pruned)`);
  console.log(`    HTML size    : ${(rawHtmlSize / 1024).toFixed(1)} KB → Semantic MD: ${(markdown0.length / 1024).toFixed(1)} KB  (${(rawHtmlSize / markdown0.length).toFixed(1)}x smaller)`);

  section("INITIAL SEMANTIC MAP  (what the LLM sees)");
  console.log(markdown0);

  // ── Phase 3 (optional): Click a button and follow the page ────────────────
  if (MODE === "click") {
    // Find the target node
    const targetNode = findNodeByText(semanticMap.nodes, CLICK_TEXT);

    if (!targetNode) {
      console.warn(`\n⚠️  Could not find a node matching "${CLICK_TEXT}" in the semantic map.`);
      console.warn("   Listed actionable nodes:");
      semanticMap.nodes
        .filter(n => ["button", "link", "tab", "menu-item"].includes(n.role))
        .forEach(n => console.warn(`     [${n.role} id=${n.id}] "${n.name}"`));
    } else {
      console.log(`\n🖱️   Found "${targetNode.name}" → role=${targetNode.role}  id=${targetNode.id}`);

      const selector = selectorMap.get(targetNode.id);

        if (!selector) {
          console.warn(`⚠️   Selector map miss for id=${targetNode.id} — trying clickByText fallback...`);
        }

        {
          console.log(`    ${selector ? `Selector: ${selector}` : `Fallback: clicking by text "${targetNode.name}"`}`);
          console.log("    Clicking...");

          // Snapshot before
          const beforeMap = semanticMap;

          if (selector) {
            await browser.clickElement(selector);
          } else {
            const ok = await browser.clickByText(targetNode.name);
            if (!ok) {
              // Try with just the first word of the node name (e.g. "Build servers")
              const shortName = CLICK_TEXT;
              const ok2 = await browser.clickByText(shortName);
              if (!ok2) {
                console.error(`❌  Could not click "${targetNode.name}" by any method. Aborting.`);
                await browser.close();
                process.exit(1);
              }
            }
          }

        // ── Phase 4: After-click snapshot ───────────────────────────────────
        const afterMap  = await extractSemanticMap("read content");
        const diff      = diffEngine.diff(beforeMap, afterMap);
        const markdown1 = synthesizer.synthesize(afterMap);

        section("DIFF AFTER CLICK  (what changed)");
        console.log(`Changes detected : ${diff.hasChanges}`);
        if (diff.hasChanges) {
          console.log(`  Added    : ${diff.added.length} nodes`);
          console.log(`  Removed  : ${diff.removed.length} nodes`);
          console.log(`  Modified : ${diff.modified.length} nodes`);
          if (diff.urlChange)   console.log(`  URL      : ${diff.urlChange.from}  →  ${diff.urlChange.to}`);
          if (diff.titleChange) console.log(`  Title    : "${diff.titleChange.from}"  →  "${diff.titleChange.to}"`);
          console.log(`\n${diff.summary}`);
        }

        section("FULL READ VIEW OF DESTINATION PAGE");
        console.log(markdown1);

        // Size stats for destination page
        const rawHtmlAfter = await browser.evaluate<number>("document.documentElement.outerHTML.length");
        console.log(`\n📊  Destination page:`);
        console.log(`    HTML: ${(rawHtmlAfter / 1024).toFixed(1)} KB  →  Semantic MD: ${(markdown1.length / 1024).toFixed(1)} KB  (${(rawHtmlAfter / markdown1.length).toFixed(1)}x smaller)`);
      }
    }
  }

  await browser.close();
  console.log("\n✅  Test complete!");
}

main().catch(async (err) => {
  console.error("Error:", err);
  await browser.close();
  process.exit(1);
});
