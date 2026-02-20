/**
 * Semantic Diff Engine — compares two SemanticMaps and produces
 * a concise description of what changed.
 * 
 * This is what makes the "feedback loop" work: instead of re-sending
 * the entire page after every action, we only send the diff.
 */

import type {
  SemanticMap,
  SemanticNode,
  SemanticDiff,
  NodeModification,
  PropertyChange,
} from "./types.js";

export class DiffEngine {
  /**
   * Compare two semantic maps and return a structured diff.
   */
  diff(before: SemanticMap, after: SemanticMap): SemanticDiff {
    const result: SemanticDiff = {
      hasChanges: false,
      summary: "",
      added: [],
      removed: [],
      modified: [],
    };

    // Check URL change
    if (before.url !== after.url) {
      result.urlChange = { from: before.url, to: after.url };
      result.hasChanges = true;
    }

    // Check title change
    if (before.title !== after.title) {
      result.titleChange = { from: before.title, to: after.title };
      result.hasChanges = true;
    }

    // Build lookup maps by matching on role + name (since IDs may be reassigned)
    const beforeMap = this.buildNodeIndex(before.nodes);
    const afterMap = this.buildNodeIndex(after.nodes);

    // Find removed nodes
    for (const [key, node] of beforeMap) {
      if (!afterMap.has(key)) {
        result.removed.push(node);
        result.hasChanges = true;
      }
    }

    // Find added nodes
    for (const [key, node] of afterMap) {
      if (!beforeMap.has(key)) {
        result.added.push(node);
        result.hasChanges = true;
      }
    }

    // Find modified nodes (same identity, different state/value)
    for (const [key, afterNode] of afterMap) {
      const beforeNode = beforeMap.get(key);
      if (beforeNode) {
        const changes = this.compareNodes(beforeNode, afterNode);
        if (changes.length > 0) {
          result.modified.push({
            id: afterNode.id,
            role: afterNode.role,
            changes,
          });
          result.hasChanges = true;
        }
      }
    }

    // Generate human-readable summary
    result.summary = this.generateSummary(result);

    return result;
  }

  /**
   * Build an index of nodes keyed by "role:name" for matching across snapshots.
   */
  private buildNodeIndex(nodes: SemanticNode[]): Map<string, SemanticNode> {
    const index = new Map<string, SemanticNode>();

    const addNode = (node: SemanticNode) => {
      const key = `${node.role}:${node.name}`;
      // If duplicate keys, append id to disambiguate
      if (index.has(key)) {
        index.set(`${key}:${node.id}`, node);
      } else {
        index.set(key, node);
      }

      if (node.children) {
        for (const child of node.children) {
          addNode(child);
        }
      }
    };

    for (const node of nodes) {
      addNode(node);
    }

    return index;
  }

  /**
   * Compare two nodes that represent the "same" element and return property changes.
   */
  private compareNodes(
    before: SemanticNode,
    after: SemanticNode
  ): PropertyChange[] {
    const changes: PropertyChange[] = [];

    // Name change
    if (before.name !== after.name) {
      changes.push({
        property: "name",
        from: before.name,
        to: after.name,
      });
    }

    // Value change
    if (before.value !== after.value) {
      changes.push({
        property: "value",
        from: before.value || "(empty)",
        to: after.value || "(empty)",
      });
    }

    // Role change (rare but possible)
    if (before.role !== after.role) {
      changes.push({
        property: "role",
        from: before.role,
        to: after.role,
      });
    }

    // State changes
    const stateProps = [
      "disabled",
      "checked",
      "pressed",
      "selected",
      "expanded",
      "focused",
      "required",
      "readonly",
      "invalid",
    ] as const;

    for (const prop of stateProps) {
      const bVal = before.state[prop];
      const aVal = after.state[prop];
      if (bVal !== aVal) {
        changes.push({
          property: `state.${prop}`,
          from: String(bVal ?? "unset"),
          to: String(aVal ?? "unset"),
        });
      }
    }

    return changes;
  }

  /**
   * Generate a concise human-readable summary of all changes.
   */
  private generateSummary(diff: SemanticDiff): string {
    if (!diff.hasChanges) {
      return "No changes detected.";
    }

    const parts: string[] = [];

    if (diff.urlChange) {
      parts.push(`Page navigated: ${diff.urlChange.from} → ${diff.urlChange.to}`);
    }

    if (diff.titleChange) {
      parts.push(`Title changed: "${diff.titleChange.from}" → "${diff.titleChange.to}"`);
    }

    if (diff.removed.length > 0) {
      const items = diff.removed
        .slice(0, 5)
        .map((n) => `[${this.capitalize(n.role)}: "${this.truncate(n.name, 30)}"]`)
        .join(", ");
      const suffix = diff.removed.length > 5 ? ` and ${diff.removed.length - 5} more` : "";
      parts.push(`Removed: ${items}${suffix}`);
    }

    if (diff.added.length > 0) {
      const items = diff.added
        .slice(0, 5)
        .map((n) => `[${this.capitalize(n.role)}: "${this.truncate(n.name, 30)}"]`)
        .join(", ");
      const suffix = diff.added.length > 5 ? ` and ${diff.added.length - 5} more` : "";
      parts.push(`Added: ${items}${suffix}`);
    }

    if (diff.modified.length > 0) {
      const items = diff.modified.slice(0, 5).map((m) => {
        const changeDesc = m.changes
          .map((c) => `${c.property}: "${c.from}" → "${c.to}"`)
          .join(", ");
        return `[${this.capitalize(m.role)}, id=${m.id}]: ${changeDesc}`;
      });
      const suffix = diff.modified.length > 5 ? `\n  ...and ${diff.modified.length - 5} more modifications` : "";
      parts.push(`Modified:\n  ${items.join("\n  ")}${suffix}`);
    }

    return parts.join("\n");
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private truncate(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 3) + "...";
  }
}
