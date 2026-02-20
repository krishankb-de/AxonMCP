/**
 * Type definitions for the Semantic DOM Filter MCP Server.
 */

// ─── Accessibility Tree Types ────────────────────────────────────────────────

export interface RawAxNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  invalid?: string;
  focused?: boolean;
  checked?: "mixed" | boolean;
  pressed?: "mixed" | boolean;
  selected?: boolean;
  expanded?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  level?: number;
  autocomplete?: string;
  haspopup?: string;
  url?: string;
  orientation?: string;
  children?: RawAxNode[];
}

// ─── Semantic Node (Post-Processing) ────────────────────────────────────────

export interface SemanticNode {
  /** Simple integer ID assigned by the processor */
  id: number;
  /** Accessible role: button, link, heading, textbox, etc. */
  role: string;
  /** Human-readable name / label */
  name: string;
  /** Current value (for inputs, sliders, etc.) */
  value?: string;
  /** URL for links/images */
  url?: string;
  /** Heading level (1-6) */
  level?: number;
  /** Interactive state flags */
  state: NodeState;
  /** Child elements (for grouped structures like lists, tables) */
  children?: SemanticNode[];
  /** The category this node was classified into */
  category: NodeCategory;
}

export interface NodeState {
  disabled?: boolean;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  selected?: boolean;
  expanded?: boolean;
  focused?: boolean;
  required?: boolean;
  readonly?: boolean;
  invalid?: string;
}

export type NodeCategory =
  | "navigation"
  | "content"
  | "interactive"
  | "heading"
  | "media"
  | "form"
  | "table"
  | "landmark"
  | "decorative"
  | "unknown";

// ─── Semantic Map (The final output of the pipeline) ─────────────────────────

export interface SemanticMap {
  /** The URL of the page */
  url: string;
  /** Page title */
  title: string;
  /** Timestamp of extraction */
  timestamp: number;
  /** The task intent that guided filtering */
  taskIntent: string;
  /** Total nodes before filtering */
  totalRawNodes: number;
  /** Total nodes after filtering */
  totalFilteredNodes: number;
  /** The filtered semantic nodes */
  nodes: SemanticNode[];
  /** Page landmarks for structural context */
  landmarks: LandmarkInfo[];
}

export interface LandmarkInfo {
  role: string;
  name: string;
  nodeCount: number;
}

// ─── Semantic Diff Types ─────────────────────────────────────────────────────

export interface SemanticDiff {
  /** Whether the action caused any change */
  hasChanges: boolean;
  /** Human-readable summary of changes */
  summary: string;
  /** Nodes that were added */
  added: SemanticNode[];
  /** Nodes that were removed */
  removed: SemanticNode[];
  /** Nodes that changed state or content */
  modified: NodeModification[];
  /** URL change if navigation occurred */
  urlChange?: { from: string; to: string };
  /** Title change */
  titleChange?: { from: string; to: string };
}

export interface NodeModification {
  id: number;
  role: string;
  changes: PropertyChange[];
}

export interface PropertyChange {
  property: string;
  from: string;
  to: string;
}

// ─── Tool Input Types ────────────────────────────────────────────────────────

export interface GetSemanticViewArgs {
  url: string;
  task_intent: string;
}

export interface PerformActionArgs {
  action: "click" | "type" | "select" | "hover" | "scroll" | "wait" | "press_key" | "go_back" | "go_forward" | "navigate";
  id?: number;
  value?: string;
  url?: string;
}

export interface ScreenshotArgs {
  full_page?: boolean;
}

// ─── Browser Session State ───────────────────────────────────────────────────

export interface SessionState {
  url: string;
  title: string;
  taskIntent: string;
  lastSemanticMap: SemanticMap;
  timestamp: number;
}
