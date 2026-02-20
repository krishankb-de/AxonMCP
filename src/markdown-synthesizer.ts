/**
 * Markdown Synthesizer — converts the filtered SemanticMap into
 * compact, LLM-friendly Semantic Markdown.
 * 
 * Each element gets a simple integer ID so the AI never has to
 * hallucinate CSS selectors.
 * 
 * Output format:
 *   # Page Title
 *   URL: https://example.com
 *   
 *   ## Landmarks
 *   - main: "Main Content" (42 nodes)
 *   
 *   ## Content
 *   [Heading(1): "Welcome", id=1]
 *   [Text: "Hello world"]
 *   [Button: "Sign Up", id=3, state=enabled]
 *   [Link: "Learn More", id=4, url="/learn"]
 *   [TextBox: "Email", id=5, value="", required]
 */

import type { SemanticMap, SemanticNode, NodeState } from "./types.js";

export class MarkdownSynthesizer {
  /**
   * Convert a SemanticMap into compact Semantic Markdown.
   */
  synthesize(map: SemanticMap): string {
    const lines: string[] = [];

    // Header
    lines.push(`# ${map.title}`);
    lines.push(`**URL:** ${map.url}`);
    lines.push(`**Task:** ${map.taskIntent}`);
    lines.push(
      `**Stats:** ${map.totalFilteredNodes} semantic nodes (filtered from ${map.totalRawNodes} raw nodes)`
    );
    lines.push("");

    // Landmarks
    if (map.landmarks.length > 0) {
      lines.push("## Page Structure");
      for (const lm of map.landmarks) {
        lines.push(`- **${lm.role}**: "${lm.name}" (${lm.nodeCount} nodes)`);
      }
      lines.push("");
    }

    // Semantic nodes
    lines.push("## Semantic Map");
    lines.push("");

    for (const node of map.nodes) {
      lines.push(this.renderNode(node, 0));
    }

    return lines.join("\n");
  }

  /**
   * Render a single semantic node as a Markdown line.
   */
  private renderNode(node: SemanticNode, indent: number): string {
    const prefix = "  ".repeat(indent);
    const parts: string[] = [];

    // Role with optional level (for headings)
    let roleStr = this.capitalize(node.role);
    if (node.level) {
      roleStr += `(${node.level})`;
    }
    parts.push(roleStr);

    // Name / label
    if (node.name) {
      parts.push(`"${this.truncate(node.name, 80)}"`);
    }

    // ID (for interactive / actionable elements)
    if (this.isActionable(node)) {
      parts.push(`id=${node.id}`);
    }

    // Value
    if (node.value !== undefined) {
      parts.push(`value="${this.truncate(node.value, 40)}"`);
    }

    // URL (for links)
    if (node.url) {
      parts.push(`url="${this.truncate(node.url, 60)}"`);
    }

    // State flags
    const stateStr = this.renderState(node.state);
    if (stateStr) {
      parts.push(stateStr);
    }

    let line = `${prefix}[${parts.join(": ").replace(/: (?=")/g, ": ").replace(/: (?=id=)/g, ", ").replace(/: (?=value=)/g, ", ").replace(/: (?=url=)/g, ", ").replace(/: (?=state=|disabled|checked|selected|expanded|focused|required|readonly|pressed|invalid)/g, ", ")}]`;

    // Simplify the formatting - rebuild cleanly
    line = this.formatNodeLine(node, prefix);

    // Render children
    if (node.children && node.children.length > 0) {
      const childLines = node.children
        .map((child) => this.renderNode(child, indent + 1))
        .join("\n");
      return `${line}\n${childLines}`;
    }

    return line;
  }

  private formatNodeLine(node: SemanticNode, prefix: string): string {
    const segments: string[] = [];

    // Role
    let role = this.capitalize(node.role);
    if (node.level) role += `(${node.level})`;
    segments.push(role);

    // Name
    if (node.name) {
      segments.push(`"${this.truncate(node.name, 80)}"`);
    }

    // Attributes
    const attrs: string[] = [];
    if (this.isActionable(node)) attrs.push(`id=${node.id}`);
    if (node.value !== undefined) attrs.push(`value="${this.truncate(node.value, 40)}"`);
    if (node.url) attrs.push(`url="${this.truncate(node.url, 60)}"`);

    // State
    const stateFlags = this.getStateFlags(node.state);
    attrs.push(...stateFlags);

    const nameAndRole =
      segments.length > 1
        ? `${segments[0]}: ${segments.slice(1).join(" ")}`
        : segments[0];

    if (attrs.length > 0) {
      return `${prefix}[${nameAndRole}, ${attrs.join(", ")}]`;
    }
    return `${prefix}[${nameAndRole}]`;
  }

  private getStateFlags(state: NodeState): string[] {
    const flags: string[] = [];
    if (state.disabled) flags.push("disabled");
    if (state.checked === true) flags.push("checked");
    if (state.checked === "mixed") flags.push("checked=mixed");
    if (state.pressed === true) flags.push("pressed");
    if (state.pressed === "mixed") flags.push("pressed=mixed");
    if (state.selected) flags.push("selected");
    if (state.expanded === true) flags.push("expanded");
    if (state.expanded === false) flags.push("collapsed");
    if (state.focused) flags.push("focused");
    if (state.required) flags.push("required");
    if (state.readonly) flags.push("readonly");
    if (state.invalid) flags.push(`invalid="${state.invalid}"`);
    return flags;
  }

  private renderState(state: NodeState): string {
    const flags = this.getStateFlags(state);
    return flags.join(", ");
  }

  private isActionable(node: SemanticNode): boolean {
    const actionableRoles = new Set([
      "button",
      "link",
      "textbox",
      "search",
      "combobox",
      "listbox",
      "option",
      "checkbox",
      "radio",
      "switch",
      "slider",
      "number-input",
      "tab",
      "menu-item",
      "menu-checkbox",
      "menu-radio",
      "tree-item",
      "select",
      "cell",
      "row",
    ]);
    return actionableRoles.has(node.role);
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private truncate(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 3) + "...";
  }
}
