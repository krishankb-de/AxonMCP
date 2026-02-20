/**
 * Browser Engine — manages a Playwright browser instance and pages.
 * Provides methods for navigation, interaction, and accessibility tree extraction.
 */

import { chromium, Browser, BrowserContext, Page, CDPSession } from "playwright";
import type { RawAxNode } from "./types.js";

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /**
   * Launch the headless browser if not already running.
   */
  async ensureBrowser(): Promise<void> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      });
      this.page = await this.context.newPage();
    }
  }

  /**
   * Navigate to a URL and wait for the page to be interactive.
   */
  async navigate(url: string): Promise<{ url: string; title: string }> {
    await this.ensureBrowser();
    const page = this.getPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait a bit for dynamic content to render
    await page.waitForTimeout(1500);

    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  /**
   * Get the full Accessibility Tree from the current page via CDP.
   */
  async getAccessibilityTree(): Promise<RawAxNode> {
    const page = this.getPage();
    const cdp = await page.context().newCDPSession(page);
    try {
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      return this.cdpNodesToAxTree(nodes);
    } catch {
      return { role: "WebArea", name: "Empty Page", children: [] };
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  /**
   * Convert CDP flat AX node list into a nested tree structure.
   */
  private cdpNodesToAxTree(cdpNodes: any[]): RawAxNode {
    if (!cdpNodes || cdpNodes.length === 0) {
      return { role: "WebArea", name: "Empty Page", children: [] };
    }

    const nodeMap = new Map<string, RawAxNode>();
    const childMap = new Map<string, string[]>();

    for (const n of cdpNodes) {
      const axNode: RawAxNode = {
        role: n.role?.value || "none",
        name: n.name?.value || "",
      };

      // Extract properties
      if (n.properties) {
        for (const prop of n.properties) {
          const name = prop.name;
          const val = prop.value?.value;
          switch (name) {
            case "disabled": axNode.disabled = val === true; break;
            case "focused": axNode.focused = val === true; break;
            case "checked": axNode.checked = val === "mixed" ? "mixed" : val === true; break;
            case "pressed": axNode.pressed = val === "mixed" ? "mixed" : val === true; break;
            case "selected": axNode.selected = val === true; break;
            case "expanded": axNode.expanded = val === true; break;
            case "modal": axNode.modal = val === true; break;
            case "multiline": axNode.multiline = val === true; break;
            case "multiselectable": axNode.multiselectable = val === true; break;
            case "readonly": axNode.readonly = val === true; break;
            case "required": axNode.required = val === true; break;
            case "level": axNode.level = typeof val === "number" ? val : undefined; break;
            case "invalid": axNode.invalid = typeof val === "string" ? val : undefined; break;
            case "haspopup": axNode.haspopup = typeof val === "string" ? val : undefined; break;
            case "autocomplete": axNode.autocomplete = typeof val === "string" ? val : undefined; break;
            case "orientation": axNode.orientation = typeof val === "string" ? val : undefined; break;
          }
        }
      }

      // Value
      if (n.value?.value !== undefined) {
        axNode.value = String(n.value.value);
      }

      // Description
      if (n.description?.value) {
        axNode.description = n.description.value;
      }

      nodeMap.set(n.nodeId, axNode);

      // Track children
      if (n.childIds && n.childIds.length > 0) {
        childMap.set(n.nodeId, n.childIds);
      }
    }

    // Build tree by linking children
    for (const [parentId, childIds] of childMap) {
      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children = [];
        for (const cid of childIds) {
          const child = nodeMap.get(cid);
          if (child) parent.children.push(child);
        }
      }
    }

    // Root is the first node
    return nodeMap.get(cdpNodes[0].nodeId) || { role: "WebArea", name: "Empty Page", children: [] };
  }

  /**
   * Click an element by its semantic ID (we locate it by its accessible name/role
   * using a data attribute we inject, or by building a selector from the semantic map).
   */
  async clickElement(selector: string): Promise<void> {
    const page = this.getPage();
    await page.click(selector, { timeout: 5000 });
    await page.waitForTimeout(800);
  }

  /**
   * Type text into an element.
   */
  async typeIntoElement(selector: string, text: string): Promise<void> {
    const page = this.getPage();
    await page.click(selector, { timeout: 5000 });
    await page.fill(selector, text);
    await page.waitForTimeout(500);
  }

  /**
   * Select an option in a <select> element.
   */
  async selectOption(selector: string, value: string): Promise<void> {
    const page = this.getPage();
    await page.selectOption(selector, value, { timeout: 5000 });
    await page.waitForTimeout(500);
  }

  /**
   * Hover over an element.
   */
  async hoverElement(selector: string): Promise<void> {
    const page = this.getPage();
    await page.hover(selector, { timeout: 5000 });
    await page.waitForTimeout(500);
  }

  /**
   * Scroll the page.
   */
  async scroll(direction: "up" | "down", amount: number = 500): Promise<void> {
    const page = this.getPage();
    const delta = direction === "down" ? amount : -amount;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(500);
  }

  /**
   * Press a keyboard key.
   */
  async pressKey(key: string): Promise<void> {
    const page = this.getPage();
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
  }

  /**
   * Go back in browser history.
   */
  async goBack(): Promise<void> {
    const page = this.getPage();
    await page.goBack({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  /**
   * Go forward in browser history.
   */
  async goForward(): Promise<void> {
    const page = this.getPage();
    await page.goForward({ timeout: 10000 });
    await page.waitForTimeout(1000);
  }

  /**
   * Take a screenshot of the current page.
   */
  async screenshot(fullPage: boolean = false): Promise<Buffer> {
    const page = this.getPage();
    return await page.screenshot({ fullPage, type: "png" });
  }

  /**
   * Get current page URL.
   */
  getCurrentUrl(): string {
    return this.getPage().url();
  }

  /**
   * Get current page title.
   */
  async getCurrentTitle(): Promise<string> {
    return await this.getPage().title();
  }

  /**
   * Evaluate JavaScript in the page context.
   */
  async evaluate<T>(fn: string): Promise<T> {
    const page = this.getPage();
    return await page.evaluate(fn) as T;
  }

  /**
   * Inject data-semantic-id attributes onto interactive elements so we can
   * later locate them by simple CSS selectors like [data-semantic-id="7"].
   */
  async injectSemanticIds(): Promise<Map<number, string>> {
    const page = this.getPage();

    const mapping = await page.evaluate(() => {
      const elements: Array<{ id: number; xpath: string }> = [];
      let counter = 1;

      // Select all interactive and meaningful elements
      const selectors = [
        'a', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]',
        '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
        '[role="switch"]', '[role="slider"]', '[role="spinbutton"]',
        '[role="combobox"]', '[role="listbox"]', '[role="option"]',
        '[role="searchbox"]', '[role="textbox"]',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'img', 'video', 'audio',
        'details', 'summary',
        '[tabindex]',
        'td', 'th',
        'label',
      ];

      const seen = new Set<Element>();
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          if (seen.has(el)) continue;
          // Skip hidden elements
          const style = window.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            el.getAttribute("aria-hidden") === "true"
          ) {
            continue;
          }
          seen.add(el);
          el.setAttribute("data-semantic-id", String(counter));

          // Build a simple xpath for reference
          const tag = el.tagName.toLowerCase();
          const idx = Array.from(el.parentElement?.children || [])
            .filter((c) => c.tagName === el.tagName)
            .indexOf(el) + 1;
          elements.push({
            id: counter,
            xpath: `//${tag}[@data-semantic-id="${counter}"]`,
          });
          counter++;
        }
      }
      return elements;
    });

    const idMap = new Map<number, string>();
    for (const { id } of mapping) {
      idMap.set(id, `[data-semantic-id="${id}"]`);
    }
    return idMap;
  }

  /**
   * Wait for the page to settle after an action.
   */
  async waitForSettled(timeout: number = 3000): Promise<void> {
    const page = this.getPage();
    try {
      await page.waitForLoadState("domcontentloaded", { timeout });
    } catch {
      // Timeout is acceptable — page may already be loaded
    }
    await page.waitForTimeout(500);
  }

  /**
   * Close everything.
   */
  async close(): Promise<void> {
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  private getPage(): Page {
    if (!this.page) {
      throw new Error("Browser not initialized. Call navigate() first.");
    }
    return this.page;
  }
}
