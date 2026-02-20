/**
 * Quick test script — runs the full pipeline against a real URL
 * and prints the semantic map output.
 */

import { BrowserEngine } from "./browser-engine.js";
import { SemanticProcessor } from "./semantic-processor.js";
import { MarkdownSynthesizer } from "./markdown-synthesizer.js";
import { DiffEngine } from "./diff-engine.js";
import type { SemanticMap } from "./types.js";

const TEST_URL = process.argv[2] || "https://developer.chrome.com/blog/webmcp-epp?hl=en";
const TASK_INTENT = process.argv[3] || "read content";

const browser = new BrowserEngine();
const processor = new SemanticProcessor();
const synthesizer = new MarkdownSynthesizer();
const diffEngine = new DiffEngine();

async function extractSemanticMap(taskIntent: string): Promise<SemanticMap> {
  const injectedMap = await browser.injectSemanticIds();
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

async function main() {
  console.log(`\n🌐 Navigating to: ${TEST_URL}`);
  console.log(`🎯 Task intent: "${TASK_INTENT}"\n`);

  // Phase 1: Navigate
  const start = Date.now();
  const { url, title } = await browser.navigate(TEST_URL);
  console.log(`✅ Page loaded in ${Date.now() - start}ms`);
  console.log(`   URL: ${url}`);
  console.log(`   Title: ${title}\n`);

  // Phase 2: Extract semantic map
  const extractStart = Date.now();
  const semanticMap = await extractSemanticMap(TASK_INTENT);
  console.log(`✅ Semantic map extracted in ${Date.now() - extractStart}ms`);
  console.log(`   Raw nodes: ${semanticMap.totalRawNodes}`);
  console.log(`   Filtered nodes: ${semanticMap.totalFilteredNodes}`);
  console.log(`   Compression: ${((1 - semanticMap.totalFilteredNodes / semanticMap.totalRawNodes) * 100).toFixed(1)}% reduction\n`);

  // Phase 3: Synthesize markdown
  const markdown = synthesizer.synthesize(semanticMap);
  const rawHtmlSize = await browser.evaluate<number>("document.documentElement.outerHTML.length");
  
  console.log(`📊 Size comparison:`);
  console.log(`   Raw HTML: ${(rawHtmlSize / 1024).toFixed(1)} KB`);
  console.log(`   Semantic Markdown: ${(markdown.length / 1024).toFixed(1)} KB`);
  console.log(`   Ratio: ${(rawHtmlSize / markdown.length).toFixed(1)}x smaller\n`);

  console.log("═".repeat(80));
  console.log("SEMANTIC MAP OUTPUT");
  console.log("═".repeat(80));
  console.log(markdown);
  console.log("═".repeat(80));

  // Phase 4: Test a scroll action + diff
  console.log("\n🔄 Testing scroll action + semantic diff...\n");
  const beforeMap = semanticMap;
  
  await browser.scroll("down", 600);
  await browser.waitForSettled(2000);
  
  const afterMap = await extractSemanticMap(TASK_INTENT);
  const diff = diffEngine.diff(beforeMap, afterMap);
  
  console.log(`Diff result: ${diff.hasChanges ? "Changes detected" : "No changes"}`);
  if (diff.hasChanges) {
    console.log(`   Added: ${diff.added.length} nodes`);
    console.log(`   Removed: ${diff.removed.length} nodes`);
    console.log(`   Modified: ${diff.modified.length} nodes`);
    console.log(`\n${diff.summary}`);
  }

  await browser.close();
  console.log("\n✅ Test complete!");
}

main().catch(async (err) => {
  console.error("Error:", err);
  await browser.close();
  process.exit(1);
});
