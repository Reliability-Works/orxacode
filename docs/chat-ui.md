# Chat UI

All session types (OpenCode, Codex, Claude) render through a shared set of React components. This ensures a consistent experience regardless of which AI backend is active.

## Message Components

| Component          | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `TextPart`         | Markdown text with hover copy button                        |
| `ToolCallCard`     | Collapsible card for tool invocations with status indicator |
| `BashTool`         | Terminal-style command execution with ANSI stripping        |
| `EditTool`         | File edit display with unified diff view                    |
| `DiffBlock`        | Color-coded unified diff (additions green, deletions red)   |
| `CommandOutput`    | Monospace terminal output block with exit code              |
| `ContextToolGroup` | Grouped display for read/search/list operations             |
| `ReasoningPart`    | Expandable reasoning/thinking block                         |
| `ThinkingShimmer`  | Animated indicator while agent is processing                |
| `MessageHeader`    | Role label, timestamp, agent/model/duration metadata        |
| `CopyButton`       | Hover-visible clipboard copy with confirmation              |
| `MessageTurn`      | Groups user + assistant messages as a turn                  |

## Dock System

Docks appear above the composer input and provide non-blocking interaction:

### TodoDock
Shows plan/todo progress with a collapsible step list. Progress counter (done/total), pulsing dot for in-progress items, strikethrough for completed. Used by both OpenCode (via `todo.updated` events) and Codex (via `turn/plan/updated`).

### QuestionDock
Renders agent questions one at a time with single/multi-select options, custom text input, progress dots for multi-question flows, and submit/reject buttons.

### PermissionDock
Three-decision pattern: Allow once / Always allow / Reject. Shows file patterns for file operations and command preview for bash operations.

### PlanReadyDock
Appears after a Codex plan turn completes. Two actions: "Implement this plan" (switches to default mode) or "Modify plan" (opens textarea for changes).

### QueuedMessagesDock
Shows messages typed while the agent is busy. Each item has Send Now / Edit / Remove actions. Messages auto-send when the agent finishes its turn.

## Message Queue

When the agent is busy processing:
- The composer textarea stays editable
- Pressing Enter queues the message instead of blocking
- Queued messages appear in the QueuedMessagesDock
- The stop button remains available to interrupt the current turn
- A toast confirms "Message queued"
