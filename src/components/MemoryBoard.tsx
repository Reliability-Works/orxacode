import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, EventObjectNode } from "cytoscape";
import type { MemoryBackfillStatus, MemoryGraphSnapshot } from "@shared/ipc";

type Props = {
  snapshot: MemoryGraphSnapshot | null;
  loading: boolean;
  error?: string;
  workspaceFilter: string;
  onWorkspaceFilterChange: (workspace: string) => void;
  onRefresh: () => void;
  onPrepareBackfillSession: () => void;
  preparingBackfillSession: boolean;
  backfillStatus: MemoryBackfillStatus | null;
  workspaceOptions?: string[];
};

const MAX_NODE_LABEL_LENGTH = 52;
const WORKSPACE_HUB_PREFIX = "workspace::";
const MAX_GRAPH_DEGREE_PER_NODE = 4;
const WORKSPACE_COLOR = "#3d5c41";
const WORKSPACE_BORDER = "#6e9a73";

const TAG_PRIORITY = [
  "preference",
  "constraint",
  "decision",
  "fact",
  "tech-stack",
  "codebase",
  "follow-up",
  "user",
  "assistant",
] as const;

const TAG_COLOR_MAP: Record<string, { fill: string; border: string }> = {
  preference: { fill: "#5f8fd7", border: "#9ec5ff" },
  constraint: { fill: "#d17a3f", border: "#ffc18f" },
  decision: { fill: "#9a72d3", border: "#d2b8ff" },
  fact: { fill: "#5f7ec3", border: "#9eb7ea" },
  "tech-stack": { fill: "#4d9a9a", border: "#9ee6e6" },
  codebase: { fill: "#4a8ba8", border: "#93d4ef" },
  "follow-up": { fill: "#9a8a4a", border: "#ddcf8e" },
  user: { fill: "#6f86b6", border: "#aec6f1" },
  assistant: { fill: "#6e75a6", border: "#b5bcf0" },
};

function normalizeTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function getPrimaryTag(tags: string[]) {
  const normalized = tags.map(normalizeTag);
  for (const candidate of TAG_PRIORITY) {
    if (normalized.includes(candidate)) {
      return candidate;
    }
  }
  return normalized[0] ?? "fact";
}

function colorForTag(tag: string) {
  return TAG_COLOR_MAP[tag] ?? { fill: "#5f7ec3", border: "#9eb7ea" };
}

function truncateLabel(value: string, maxLength = MAX_NODE_LABEL_LENGTH) {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function createGraphLabel(summary: string) {
  const condensed = summary
    .replace(/\s+/g, " ")
    .replace(/^[-*]\s*/, "")
    .trim();
  const firstSentence = condensed.split(/[.!?]/)[0] ?? condensed;
  return truncateLabel(firstSentence, 32);
}

function formatWorkspaceLabel(workspace: string) {
  if (workspace === "all") {
    return "All workspaces";
  }
  const segments = workspace.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? workspace;
}

function workspaceHubID(workspace: string) {
  return `${WORKSPACE_HUB_PREFIX}${workspace}`;
}

export function MemoryBoard({
  snapshot,
  loading,
  error,
  workspaceFilter,
  onWorkspaceFilterChange,
  onRefresh,
  onPrepareBackfillSession,
  preparingBackfillSession,
  backfillStatus,
  workspaceOptions = [],
}: Props) {
  const [query, setQuery] = useState("");
  const [relationFilter, setRelationFilter] = useState("");
  const [selectedNodeID, setSelectedNodeID] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || workspaceMenuRef.current?.contains(target)) {
        return;
      }
      setWorkspaceMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setWorkspaceMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [workspaceMenuOpen]);

  const filteredNodes = useMemo(() => {
    const nodes = snapshot?.nodes ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (workspaceFilter !== "all" && node.workspace !== workspaceFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const blob = `${node.summary} ${node.content} ${node.tags.join(" ")}`.toLowerCase();
      return blob.includes(normalizedQuery);
    });
  }, [query, snapshot?.nodes, workspaceFilter]);

  const filteredNodeIDs = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const filteredEdges = useMemo(() => {
    const edges = snapshot?.edges ?? [];
    const normalizedRelation = relationFilter.trim().toLowerCase();
    const raw = edges.filter((edge) => {
      if (!filteredNodeIDs.has(edge.from) || !filteredNodeIDs.has(edge.to)) {
        return false;
      }
      if (!normalizedRelation) {
        return true;
      }
      return edge.relation.toLowerCase().includes(normalizedRelation);
    });
    const deduped = new Map<string, (typeof raw)[number]>();
    for (const edge of raw) {
      const key = `${edge.from}::${edge.to}::${edge.relation}`;
      const existing = deduped.get(key);
      if (!existing || existing.weight < edge.weight) {
        deduped.set(key, edge);
      }
    }
    const sorted = [...deduped.values()].sort((a, b) => b.weight - a.weight);
    const maxEdges = Math.max(8, filteredNodes.length * 2);
    const kept: (typeof sorted)[number][] = [];
    const degree = new Map<string, number>();
    for (const edge of sorted) {
      const fromDegree = degree.get(edge.from) ?? 0;
      const toDegree = degree.get(edge.to) ?? 0;
      if (fromDegree >= MAX_GRAPH_DEGREE_PER_NODE || toDegree >= MAX_GRAPH_DEGREE_PER_NODE) {
        continue;
      }
      kept.push(edge);
      degree.set(edge.from, fromDegree + 1);
      degree.set(edge.to, toDegree + 1);
      if (kept.length >= maxEdges) {
        break;
      }
    }
    return kept;
  }, [filteredNodeIDs, filteredNodes.length, relationFilter, snapshot?.edges]);

  const nodesByWorkspace = useMemo(() => {
    const grouped = new Map<string, typeof filteredNodes>();
    for (const node of filteredNodes) {
      const current = grouped.get(node.workspace);
      if (current) {
        current.push(node);
      } else {
        grouped.set(node.workspace, [node]);
      }
    }
    return grouped;
  }, [filteredNodes]);

  const elements = useMemo(
    () => [
      ...[...nodesByWorkspace.entries()].map(([workspace, nodes]) => ({
        data: {
          id: workspaceHubID(workspace),
          label: formatWorkspaceLabel(workspace),
          workspace,
          nodeCount: nodes.length,
          kind: "workspace",
          nodeColor: WORKSPACE_COLOR,
          nodeBorder: WORKSPACE_BORDER,
        },
      })),
      ...filteredNodes.map((node) => ({
        // Stable per-node palette based on the highest-priority recognized tag.
        ...(() => {
          const primaryTag = getPrimaryTag(node.tags);
          const palette = colorForTag(primaryTag);
          return {
            data: {
              id: node.id,
              label: createGraphLabel(node.summary),
              workspace: node.workspace,
              confidence: node.confidence,
              tags: node.tags.join(", "),
              fullLabel: node.summary,
              kind: "memory",
              primaryTag,
              nodeColor: palette.fill,
              nodeBorder: palette.border,
            },
          };
        })(),
      })),
      ...filteredNodes.map((node) => ({
        data: {
          id: `workspace-link::${node.id}`,
          source: workspaceHubID(node.workspace),
          target: node.id,
          weight: 0.25,
          kind: "workspace-link",
        },
      })),
      ...filteredEdges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          label: edge.relation,
          weight: edge.weight,
          kind: "memory-edge",
        },
      })),
    ],
    [filteredEdges, filteredNodes, nodesByWorkspace],
  );

  const selectedNode = useMemo(
    () => filteredNodes.find((node) => node.id === selectedNodeID) ?? null,
    [filteredNodes, selectedNodeID],
  );
  const selectedWorkspace = useMemo(() => {
    if (!selectedNodeID || !selectedNodeID.startsWith(WORKSPACE_HUB_PREFIX)) {
      return null;
    }
    const workspace = selectedNodeID.slice(WORKSPACE_HUB_PREFIX.length);
    const nodes = nodesByWorkspace.get(workspace) ?? [];
    return {
      workspace,
      nodes,
    };
  }, [nodesByWorkspace, selectedNodeID]);
  const isGraphEmpty = elements.length === 0;
  const showDetailsPane = (Boolean(selectedNode) || Boolean(selectedWorkspace)) && !isGraphEmpty;
  const hideLabelsByDefault = filteredNodes.length > 9;

  const workspaces = useMemo(() => {
    const values = new Set<string>();
    for (const workspace of workspaceOptions) {
      const value = workspace.trim();
      if (value) {
        values.add(value);
      }
    }
    for (const workspace of snapshot?.workspaces ?? []) {
      values.add(workspace);
    }
    for (const node of snapshot?.nodes ?? []) {
      values.add(node.workspace);
    }
    for (const edge of snapshot?.edges ?? []) {
      values.add(edge.workspace);
    }
    if (workspaceFilter !== "all") {
      values.add(workspaceFilter);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [snapshot?.edges, snapshot?.nodes, snapshot?.workspaces, workspaceFilter, workspaceOptions]);

  const tagLegend = useMemo(() => {
    const seen = new Set<string>();
    for (const node of filteredNodes) {
      const primary = getPrimaryTag(node.tags);
      seen.add(primary);
    }
    return [...seen];
  }, [filteredNodes]);

  const cytoscapeLayout = useMemo(
    () => ({
      name: "cose",
      animate: false,
      fit: true,
      padding: 112,
      randomize: false,
      nodeRepulsion: 350000,
      nodeOverlap: 40,
      idealEdgeLength: 320,
      edgeElasticity: 95,
      nestingFactor: 0.18,
      gravity: 0.06,
      numIter: 2600,
      componentSpacing: 260,
    }),
    [],
  );

  return (
    <section className="memory-board">
      <header className="dashboard-section-title memory-board-header">
        <div className="memory-board-heading">
          <h2>Memory Graph</h2>
          {!isGraphEmpty ? <p className="memory-board-hint">Select a memory node to inspect details.</p> : null}
        </div>
        <div className="memory-board-actions">
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </header>
      <div className="memory-board-filters">
        <label>
          Workspace
          <div className="memory-board-workspace-wrap" ref={workspaceMenuRef}>
            <button
              type="button"
              className="memory-board-workspace-btn"
              aria-haspopup="listbox"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((value) => !value)}
              title={workspaceFilter === "all" ? "All workspaces" : workspaceFilter}
            >
              <span>{workspaceFilter === "all" ? "All workspaces" : workspaceFilter}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {workspaceMenuOpen ? (
              <div className="memory-board-workspace-menu" role="listbox" aria-label="Workspace">
                <button
                  type="button"
                  className={`memory-board-workspace-option${workspaceFilter === "all" ? " active" : ""}`.trim()}
                  onClick={() => {
                    onWorkspaceFilterChange("all");
                    setWorkspaceMenuOpen(false);
                  }}
                  title="All workspaces"
                >
                  <span className="memory-board-workspace-option-main">All workspaces</span>
                  {workspaceFilter === "all" ? <Check size={14} aria-hidden="true" /> : null}
                </button>
                {workspaces.map((workspace) => {
                  const active = workspaceFilter === workspace;
                  return (
                    <button
                      key={workspace}
                      type="button"
                      className={`memory-board-workspace-option${active ? " active" : ""}`.trim()}
                      onClick={() => {
                        onWorkspaceFilterChange(workspace);
                        setWorkspaceMenuOpen(false);
                      }}
                      title={workspace}
                    >
                      <span className="memory-board-workspace-option-main">{formatWorkspaceLabel(workspace)}</span>
                      <small>{workspace}</small>
                      {active ? <Check size={14} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </label>
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search memory..." />
        </label>
        <label>
          Relation
          <input value={relationFilter} onChange={(event) => setRelationFilter(event.target.value)} placeholder="Filter relation..." />
        </label>
      </div>
      {!isGraphEmpty ? (
        <div className="memory-board-legend">
          <span className="memory-board-legend-item">
            <i style={{ backgroundColor: WORKSPACE_COLOR, borderColor: WORKSPACE_BORDER }} />
            Workspace
          </span>
          {tagLegend.map((tag) => {
            const palette = colorForTag(tag);
            return (
              <span key={tag} className="memory-board-legend-item">
                <i style={{ backgroundColor: palette.fill, borderColor: palette.border }} />
                {tag}
              </span>
            );
          })}
        </div>
      ) : null}
      {backfillStatus ? (
        <p className="raw-path">
          {backfillStatus.message ?? "Memory backfill"} ({Math.round(backfillStatus.progress * 100)}% • {backfillStatus.scannedSessions}/
          {backfillStatus.totalSessions})
        </p>
      ) : null}
      {error ? <p className="dashboard-error">{error}</p> : null}
      <div className={`memory-board-layout${isGraphEmpty ? " is-empty" : ""}${!showDetailsPane ? " no-selection" : ""}`}>
        <div className="memory-board-graph">
          {isGraphEmpty ? (
            <div className="memory-board-empty">
              <p className="dashboard-empty">No memories available for this filter.</p>
              <button type="button" onClick={onPrepareBackfillSession} disabled={preparingBackfillSession}>
                {preparingBackfillSession ? "Preparing Session..." : "Prepare Backfill Session"}
              </button>
              <p className="raw-path">Starts a new session with a prefilled backfill prompt. Review and press Send when ready.</p>
            </div>
          ) : (
            <CytoscapeComponent
              elements={elements}
              style={{ width: "100%", height: "100%" }}
              layout={cytoscapeLayout}
              stylesheet={[
                {
                  selector: 'node[kind = "memory"]',
                  style: {
                    label: hideLabelsByDefault ? "" : "data(label)",
                    "background-color": "data(nodeColor)",
                    color: "#e6eeff",
                    "font-size": "9px",
                    "text-wrap": "wrap",
                    "text-max-width": "140px",
                    "min-zoomed-font-size": 8,
                    "text-outline-color": "#060a12",
                    "text-outline-width": 2,
                    "text-margin-y": 10,
                    width: "mapData(confidence, 0, 1, 17, 30)",
                    height: "mapData(confidence, 0, 1, 17, 30)",
                    "border-color": "data(nodeBorder)",
                    "border-width": 1,
                  },
                },
                {
                  selector: 'node[kind = "workspace"]',
                  style: {
                    label: "data(label)",
                    shape: "round-rectangle",
                    width: "mapData(nodeCount, 1, 24, 120, 260)",
                    height: 34,
                    "background-color": "data(nodeColor)",
                    color: "#dce6f6",
                    "font-size": 10,
                    "text-valign": "center",
                    "text-halign": "center",
                    "text-wrap": "ellipsis",
                    "text-max-width": 210,
                    "border-color": "data(nodeBorder)",
                    "border-width": 1,
                  },
                },
                {
                  selector: 'edge[kind = "memory-edge"]',
                  style: {
                    "curve-style": "bezier",
                    width: "mapData(weight, 0, 5, 1, 4)",
                    "line-color": "#596274",
                    "target-arrow-color": "#596274",
                    "target-arrow-shape": "triangle",
                    opacity: 0.68,
                  },
                },
                {
                  selector: 'edge[kind = "workspace-link"]',
                  style: {
                    width: 1,
                    "curve-style": "bezier",
                    "line-style": "dashed",
                    "line-color": "#4d5c74",
                    "target-arrow-shape": "none",
                    opacity: 0.28,
                  },
                },
                {
                  selector: 'node[kind = "memory"]:selected',
                  style: {
                    label: "data(label)",
                    "background-color": "#9ad0ff",
                    "border-color": "#d4e6ff",
                    "border-width": 2,
                    "font-size": "10px",
                    "text-max-width": "180px",
                  },
                },
                {
                  selector: 'node[kind = "workspace"]:selected',
                  style: {
                    "background-color": "#435a79",
                    "border-color": "#a0bcdf",
                    "border-width": 2,
                  },
                },
                {
                  selector: "edge:selected",
                  style: {
                    "line-color": "#8bc1ff",
                    "target-arrow-color": "#8bc1ff",
                    opacity: 1,
                  },
                },
              ]}
              cy={(cy: Core) => {
                cy.removeAllListeners();
                cy.on("tap", "node", (event: EventObjectNode) => {
                  const node = event.target;
                  const id = node.id();
                  setSelectedNodeID(id);
                });
                cy.on("tap", (event) => {
                  if (event.target === cy) {
                    setSelectedNodeID(null);
                  }
                });
                window.setTimeout(() => {
                  cy.fit(undefined, 100);
                  if (cy.zoom() > 0.8) {
                    cy.zoom(0.8);
                    cy.center();
                  }
                }, 0);
              }}
            />
          )}
        </div>
        <aside className="memory-board-details">
          <p className="memory-board-details-label">// node details</p>
          {selectedNode ? (
            <>
              <h3>{selectedNode.summary}</h3>
              <p className="raw-path">{selectedNode.workspace}</p>
              <p>{selectedNode.content}</p>
              <p className="raw-path">Primary tag: {getPrimaryTag(selectedNode.tags)}</p>
              <p className="raw-path">Tags: {selectedNode.tags.join(", ") || "none"}</p>
              <p className="raw-path">Confidence: {selectedNode.confidence.toFixed(2)}</p>
              <p className="raw-path">
                Source: {selectedNode.source.actor ?? "unknown"} {selectedNode.source.sessionID ? `• ${selectedNode.source.sessionID}` : ""}
              </p>
            </>
          ) : selectedWorkspace ? (
            <>
              <h3>{formatWorkspaceLabel(selectedWorkspace.workspace)}</h3>
              <p className="raw-path">{selectedWorkspace.workspace}</p>
              <p>{selectedWorkspace.nodes.length} memories connected to this workspace hub.</p>
            </>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
