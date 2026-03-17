# Memory System

Orxa Code includes a local-first memory system that stores and retrieves contextual information per workspace.

## How it Works

- Memories are stored locally in the app (no external API required)
- Each workspace has isolated memory retrieval
- Memory graph visualization shows workspace hubs, memory nodes, and relationships
- Tag-based node coloring for visual parsing of memory types

## Usage

### Backfilling Historical Memories

1. Open **Memory** in the sidebar
2. Click **Prepare Backfill Session**
3. The app creates a new session with a prefilled prompt containing workspace context
4. Select model/agent and send
5. Structured memory lines are ingested and the graph updates

### Ongoing Memory Capture

- When memory is enabled, relevant memories are retrieved during prompt assembly
- The app can proactively capture new memories from session history
- Retrieval remains scoped to the active workspace

## Settings

Available in Settings > Memory:

- Global enable/disable
- Per-workspace override
- Guidance for proactive memory capture
- Template import: Conservative, Balanced, Aggressive, Codebase Facts
