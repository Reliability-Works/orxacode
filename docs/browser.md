# Browser Sidebar

The browser sidebar is attached to the active thread. You can keep the chat on the left and the embedded browser on the right while you inspect or change a page.

## What it supports

- multiple tabs
- back, forward, reload, and URL entry
- a persistent browser profile
- inspect mode for element annotations
- prompt copying from saved annotations

## Inspect mode

Inspect mode is the part most people use first:

1. Open the browser sidebar from the thread header.
2. Click `Inspect`.
3. Click elements in the page.
4. Add notes to the captured annotations.
5. Click `Copy prompt` and send that prompt back into the thread.

The copied prompt includes the page URL, element selectors, note text, and bounds when they are available.

## Where it runs

The browser runtime lives in the desktop process, not in the renderer. The renderer asks for browser actions through the desktop bridge, and the main process keeps the browser state in sync with the active thread UI.

## Related files

- `apps/web/src/components/browser-sidebar/`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/chat/ChatViewInner.tsx`
- `apps/desktop/src/browserRuntime.ts`
- `apps/desktop/src/main.ipc.ts`
- `packages/contracts/src/ipc.ts`
