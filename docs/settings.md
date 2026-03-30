# Settings Reference

Settings are organized into provider-specific sections.

## Orxa Code (App-level)

| Setting                      | Description                                 | Default |
| ---------------------------- | ------------------------------------------- | ------- |
| Auto-open terminal on create | Open terminal when creating PTY             | true    |
| Confirm dangerous actions    | Show confirmation for reject buttons        | true    |
| Auto check for updates       | Periodic update checks                      | true    |
| Notify when agent waiting    | Desktop notification when agent needs input | true    |
| Notify when agent finishes   | Desktop notification on task completion     | true    |
| Enable collaboration modes   | Show collaboration mode selector for Codex  | true    |
| Notify on subagent events    | Desktop notifications for subagent activity | true    |
| Release channel              | stable or prerelease                        | stable  |

## Orxa Code (Preferences)

| Setting   | Description                                           |
| --------- | ----------------------------------------------------- |
| Code font | Font used in diff viewer, file tree, and code preview |

## Orxa Code (Git)

| Setting                | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| Commit guidance prompt | Instructions for commit message generation                    |
| Git command agent      | Which provider handles git operations (opencode/claude/codex) |

## OpenCode

| Section         | Settings                                        |
| --------------- | ----------------------------------------------- |
| Config Files    | Project and global config editor (JSON/JSONC)   |
| Provider Models | Toggle model visibility, provider management    |
| Agents          | OpenCode agent file editor                      |
| Personalization | AGENTS.md editor                                |
| Server          | Runtime diagnostics, repair, profile management |

## Codex

| Section         | Settings                                                    |
| --------------- | ----------------------------------------------------------- |
| General         | Binary path, additional CLI arguments, doctor check, update |
| Models          | Model selector, reasoning effort                            |
| Access          | Access mode (on-request, full-access)                       |
| Config          | Editable config.toml and AGENTS.md                          |
| Personalization | Claude/Codex directory links                                |

## Claude Code

| Section         | Settings                                |
| --------------- | --------------------------------------- |
| Config          | Editable settings.json and CLAUDE.md    |
| Personalization | Custom instructions                     |
| Permissions     | Default permission mode                 |
| Directories     | Allowed/blocked directory configuration |
