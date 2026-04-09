# Chat Workspace

The chat workspace is the main working surface in Orxa Code. A thread can show provider output, approvals, plan state, browser work, file browsing, git review, and terminal activity without switching to a different mode.

## Shared timeline

Claude, Codex, and Opencode threads all feed into the same general timeline layout. The renderer turns provider-specific events into a common thread view so the app can show:

- markdown replies
- command output
- file diffs
- approvals and questions
- plan state and follow-up actions

## Thread header controls

The thread header can open the sidebars that matter while you are working:

- browser
- files
- git
- provider handoff actions

The bottom of the workspace can also open a thread-scoped terminal drawer.

## Sidebars and drawer

### Browser

Use it when the thread needs a live page, inspect mode, or annotations.

### Files

Use it to browse the project tree and inspect or edit files in place.

### Git

Use it to switch between diff, log, issues, and pull request views for the current repo.

### Terminal drawer

Use it to keep shell work tied to the same thread and working directory.

## Why the workspace matters

The app is easier to reason about when the thread, repo state, and supporting tools stay together. That is the core shape of the current product, and the README should describe it that way.
