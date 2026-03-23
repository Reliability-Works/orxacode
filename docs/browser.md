# Browser Integration

Orxa Code includes an embedded Chromium browser in its own dedicated sidebar.

## Features

- Multi-tab browsing with URL navigation controls
- Persistent browser profile (`persist:orxa-browser`) — cookies and logins survive restarts
- History list with clear history action
- Back/forward/reload navigation

## Agent Browser Automation

When **Browser Mode** is enabled in the composer controls:

1. The agent emits structured action envelopes:
   ```xml
   <orxa_browser_action>{"id":"action-id","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>
   ```

2. The app executes the action and returns a machine message:
   ```
   [ORXA_BROWSER_RESULT]{"id":"action-id","action":"navigate","ok":true,"data":{...}}
   ```

3. If browser mode is disabled or the human owns control, actions are blocked with a reason.

## Supported Actions

Navigation: `open_tab`, `close_tab`, `switch_tab`, `navigate`, `back`, `forward`, `reload`

Interaction: `click`, `type`, `press`, `scroll`, `extract_text`, `screenshot`

Waiting: `exists`, `visible`, `wait_for`, `wait_for_navigation`, `wait_for_idle`

## Human/Agent Control

- Agent controls by default when Browser Mode is enabled
- **Take control** switches ownership to the human and pauses agent execution
- **Hand back to agent** returns control for continued automation
- The browser sidebar auto-focuses when agent browser actions begin

## Jobs with Browser Mode

Each scheduled job can independently enable browser mode. When enabled, the job run receives browser capability instructions. When disabled, no browser contract is injected.
