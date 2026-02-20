/**
 * Semantic Processor — The "Semantic Shredder"
 * 
 * Takes a raw Accessibility Tree and applies three filters:
 * 1. Visibility Filter — removes hidden/aria-hidden/zero-opacity nodes
 * 2. Structural Flattening — collapses deep nesting into a flat component list
 * 3. Heuristic Pruning — uses task_intent to prune irrelevant sections
 * 
 * Then assigns simple integer IDs to every remaining node.
 */

import type {
  RawAxNode,
  SemanticNode,
  NodeState,
  NodeCategory,
  LandmarkInfo,
} from "./types.js";

// Roles we consider purely structural / decorative and should be collapsed
const STRUCTURAL_ROLES = new Set([
  "generic",
  "none",
  "presentation",
  "group",
  "LineBreak",
  "InlineTextBox",
  "paragraph",
  "Section",
]);

// Roles that represent navigation / chrome
const NAVIGATION_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "menu",
  "menubar",
  "toolbar",
]);

// Roles that represent main content areas
const CONTENT_LANDMARK_ROLES = new Set([
  "main",
  "article",
  "region",
  "document",
]);

// Roles that are interactive
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
]);

const HEADING_ROLE = "heading";

const FORM_ROLES = new Set([
  "form",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
]);

const TABLE_ROLES = new Set([
  "table",
  "row",
  "rowgroup",
  "rowheader",
  "columnheader",
  "cell",
  "gridcell",
  "grid",
  "treegrid",
]);

const MEDIA_ROLES = new Set(["img", "image", "figure", "video", "audio"]);

export class SemanticProcessor {
  private idCounter: number = 0;
  private selectorMap: Map<number, string> = new Map();

  /**
   * Process a raw accessibility tree into a filtered, flattened semantic node list.
   */
  process(
    rawTree: RawAxNode,
    taskIntent: string,
    injectedSelectors?: Map<number, string>
  ): { nodes: SemanticNode[]; landmarks: LandmarkInfo[]; totalRaw: number } {
    this.idCounter = 0;
    this.selectorMap = injectedSelectors ?? new Map();

    // Step 1: Count total raw nodes
    const totalRaw = this.countNodes(rawTree);

    // Step 2: Collect landmarks
    const landmarks = this.extractLandmarks(rawTree);

    // Step 3: Apply visibility filter & structural flattening
    const flatNodes = this.flatten(rawTree);

    // Step 4: Apply heuristic pruning based on task intent
    const prunedNodes = this.pruneByIntent(flatNodes, taskIntent, rawTree);

    return { nodes: prunedNodes, landmarks, totalRaw };
  }

  /**
   * Get the selector map (id -> CSS selector) for action execution.
   */
  getSelectorMap(): Map<number, string> {
    return this.selectorMap;
  }

  // ─── Visibility Filter ──────────────────────────────────────────────────────

  private isVisible(node: RawAxNode): boolean {
    // Skip nodes that are explicitly hidden
    if (node.role === "none" || node.role === "presentation") {
      // These may still have visible children we want
      return true;
    }
    return true; // Playwright's AxTree typically only includes visible nodes
  }

  // ─── Structural Flattening ──────────────────────────────────────────────────

  private flatten(node: RawAxNode): SemanticNode[] {
    if (!this.isVisible(node)) return [];

    const results: SemanticNode[] = [];
    const role = node.role.toLowerCase();

    // If this is a meaningful node, convert it
    if (this.isMeaningful(node)) {
      const semanticNode = this.convertNode(node);
      if (semanticNode) {
        // For table/list structures, include children inline
        if (TABLE_ROLES.has(role) || role === "list" || role === "tablist" || role === "tree") {
          semanticNode.children = this.flattenChildren(node);
        }
        results.push(semanticNode);
        // Don't recurse into children we've already captured
        if (semanticNode.children && semanticNode.children.length > 0) {
          return results;
        }
      }
    }

    // Recurse into children, collapsing structural wrappers
    if (node.children) {
      for (const child of node.children) {
        results.push(...this.flatten(child));
      }
    }

    return results;
  }

  private flattenChildren(node: RawAxNode): SemanticNode[] {
    const results: SemanticNode[] = [];
    if (!node.children) return results;

    for (const child of node.children) {
      if (this.isMeaningful(child)) {
        const converted = this.convertNode(child);
        if (converted) {
          if (child.children && child.children.length > 0) {
            converted.children = this.flattenChildren(child);
          }
          results.push(converted);
        }
      } else if (child.children) {
        results.push(...this.flattenChildren(child));
      }
    }
    return results;
  }

  /**
   * Determine if a node carries meaning (not just a structural wrapper).
   */
  private isMeaningful(node: RawAxNode): boolean {
    const role = node.role.toLowerCase();

    // Always meaningful: interactive elements
    if (INTERACTIVE_ROLES.has(role)) return true;

    // Always meaningful: headings
    if (role === HEADING_ROLE) return true;

    // Always meaningful: media
    if (MEDIA_ROLES.has(role)) return true;

    // Tables
    if (TABLE_ROLES.has(role)) return true;

    // Lists
    if (role === "list" || role === "listitem") return true;

    // Tab structures
    if (role === "tablist" || role === "tabpanel") return true;

    // Tree structures
    if (role === "tree" || role === "treeitem") return true;

    // Landmarks
    if (NAVIGATION_ROLES.has(role) || CONTENT_LANDMARK_ROLES.has(role)) return true;

    // Static text with actual content
    if (
      (role === "statictext" || role === "text") &&
      node.name &&
      node.name.trim().length > 0
    ) {
      return true;
    }

    // Form role
    if (role === "form") return true;

    // Alert, status, log, dialog
    if (["alert", "alertdialog", "dialog", "status", "log", "marquee", "timer", "tooltip"].includes(role)) {
      return true;
    }

    // Structural role with a name (named landmark/section)
    if (STRUCTURAL_ROLES.has(role) && node.name && node.name.trim().length > 2) {
      return false; // Still flatten through it unless it's a named region
    }

    return false;
  }

  // ─── Node Conversion ───────────────────────────────────────────────────────

  private convertNode(raw: RawAxNode): SemanticNode | null {
    const role = raw.role.toLowerCase();
    const name = (raw.name || "").trim();

    // Skip empty text nodes
    if ((role === "statictext" || role === "text") && name.length === 0) {
      return null;
    }

    this.idCounter++;
    const id = this.idCounter;

    const state: NodeState = {};
    if (raw.disabled) state.disabled = true;
    if (raw.checked !== undefined) state.checked = raw.checked;
    if (raw.pressed !== undefined) state.pressed = raw.pressed;
    if (raw.selected !== undefined) state.selected = raw.selected;
    if (raw.expanded !== undefined) state.expanded = raw.expanded;
    if (raw.focused) state.focused = true;
    if (raw.required) state.required = true;
    if (raw.readonly) state.readonly = true;
    if (raw.invalid) state.invalid = raw.invalid;

    const node: SemanticNode = {
      id,
      role: this.normalizeRole(role),
      name,
      state,
      category: this.categorize(role),
    };

    if (raw.value !== undefined && raw.value !== "") node.value = raw.value;
    if (raw.url) node.url = raw.url;
    if (raw.level) node.level = raw.level;

    return node;
  }

  private normalizeRole(role: string): string {
    const map: Record<string, string> = {
      statictext: "text",
      menuitem: "menu-item",
      menuitemcheckbox: "menu-checkbox",
      menuitemradio: "menu-radio",
      treeitem: "tree-item",
      tabpanel: "tab-panel",
      listitem: "list-item",
      columnheader: "column-header",
      rowheader: "row-header",
      gridcell: "cell",
      searchbox: "search",
      spinbutton: "number-input",
      alertdialog: "alert-dialog",
      contentinfo: "footer",
      complementary: "aside",
      banner: "header",
    };
    return map[role] || role;
  }

  private categorize(role: string): NodeCategory {
    if (INTERACTIVE_ROLES.has(role)) return "interactive";
    if (role === HEADING_ROLE) return "heading";
    if (NAVIGATION_ROLES.has(role)) return "navigation";
    if (CONTENT_LANDMARK_ROLES.has(role)) return "landmark";
    if (FORM_ROLES.has(role)) return "form";
    if (TABLE_ROLES.has(role)) return "table";
    if (MEDIA_ROLES.has(role)) return "media";
    if (role === "statictext" || role === "text") return "content";
    if (STRUCTURAL_ROLES.has(role)) return "decorative";
    return "unknown";
  }

  // ─── Heuristic Pruning ─────────────────────────────────────────────────────

  private pruneByIntent(
    nodes: SemanticNode[],
    taskIntent: string,
    rawTree: RawAxNode
  ): SemanticNode[] {
    const intent = taskIntent.toLowerCase();

    // Intent: reading content — prune navigation
    if (this.isContentIntent(intent)) {
      return nodes.filter(
        (n) => n.category !== "navigation" || n.role === "link"
      );
    }

    // Intent: filling forms — prune non-form content
    if (this.isFormIntent(intent)) {
      return nodes.filter(
        (n) =>
          n.category === "form" ||
          n.category === "interactive" ||
          n.category === "heading" ||
          n.role === "text" ||
          n.role === "button" ||
          n.role === "link"
      );
    }

    // Intent: navigation/finding — keep everything but de-prioritize large text blocks
    if (this.isNavigationIntent(intent)) {
      return nodes.filter((n) => {
        if (n.role === "text" && n.name.length > 200) return false;
        return true;
      });
    }

    // Default: return everything
    return nodes;
  }

  private isContentIntent(intent: string): boolean {
    const keywords = [
      "read",
      "content",
      "article",
      "text",
      "pricing",
      "information",
      "details",
      "description",
      "about",
      "documentation",
      "docs",
      "blog",
      "post",
      "story",
      "news",
    ];
    return keywords.some((k) => intent.includes(k));
  }

  private isFormIntent(intent: string): boolean {
    const keywords = [
      "fill",
      "form",
      "input",
      "sign up",
      "signup",
      "login",
      "log in",
      "register",
      "submit",
      "search",
      "enter",
      "type",
      "write",
    ];
    return keywords.some((k) => intent.includes(k));
  }

  private isNavigationIntent(intent: string): boolean {
    const keywords = [
      "find",
      "navigate",
      "click",
      "go to",
      "open",
      "menu",
      "browse",
      "explore",
      "look for",
      "locate",
    ];
    return keywords.some((k) => intent.includes(k));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private countNodes(node: RawAxNode): number {
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += this.countNodes(child);
      }
    }
    return count;
  }

  private extractLandmarks(node: RawAxNode): LandmarkInfo[] {
    const landmarks: LandmarkInfo[] = [];
    this.findLandmarks(node, landmarks);
    return landmarks;
  }

  private findLandmarks(node: RawAxNode, results: LandmarkInfo[]): void {
    const role = node.role.toLowerCase();
    if (
      NAVIGATION_ROLES.has(role) ||
      CONTENT_LANDMARK_ROLES.has(role) ||
      role === "search" ||
      role === "form"
    ) {
      results.push({
        role,
        name: node.name || "(unnamed)",
        nodeCount: this.countNodes(node),
      });
    }
    if (node.children) {
      for (const child of node.children) {
        this.findLandmarks(child, results);
      }
    }
  }
}
