import { useMemo } from 'react'
import type { McpDevToolsServerState } from '@shared/ipc'
import type { BrowserControlOwner } from './lib/app-session-utils'
import { buildBrowserAutopilotHint } from './lib/app-session-utils'
import {
  BROWSER_MODE_TOOLS_POLICY,
  BROWSER_MODE_TOOLS_POLICY_WITH_MCP,
  mergeModeToolPolicies,
} from './lib/browser-tool-guardrails'

type PromptMetadataArgs = {
  composer: string
  browserModeEnabled: boolean
  browserControlOwner: BrowserControlOwner
  mcpDevToolsState: McpDevToolsServerState
}

export function useBrowserPromptMetadata({
  composer,
  browserModeEnabled,
  browserControlOwner,
  mcpDevToolsState,
}: PromptMetadataArgs) {
  const browserSystemAddendum = useMemo(() => {
    if (!browserModeEnabled) {
      return undefined
    }
    return [
      'Browser Mode is enabled in Orxa Code.',
      browserControlOwner === 'agent'
        ? 'Agent currently owns browser control.'
        : 'Human currently owns browser control. Browser actions will be blocked until hand-back.',
      'To request browser automation, emit exactly one tag per action:',
      '<orxa_browser_action>{"id":"unique-action-id","action":"navigate","args":{"url":"https://example.com"}}</orxa_browser_action>',
      'Supported actions: open_tab, close_tab, switch_tab, navigate, back, forward, reload, click, type, press, scroll, extract_text, exists, visible, wait_for, wait_for_navigation, wait_for_idle, screenshot.',
      'For dynamic pages prefer robust locators in args.locator (selector/selectors/text/role/name/label/frameSelector/includeShadowDom/exact), plus timeoutMs/maxAttempts where needed.',
      'Do not stop at first paint: continue with scroll, click, wait_for_idle, and extract_text loops until requested evidence is gathered.',
      'Hard guardrail: do not use Playwright, MCP tools, web.run, or any external/headless/system browser tool in this session.',
      'Only the in-app Orxa browser is allowed while Browser Mode is enabled.',
      'Do not assume native browser tools. Wait for machine result messages prefixed with [ORXA_BROWSER_RESULT].',
    ].join('\n')
  }, [browserControlOwner, browserModeEnabled])

  const browserAutopilotHint = useMemo(() => {
    if (!browserModeEnabled || browserControlOwner !== 'agent') {
      return undefined
    }
    return buildBrowserAutopilotHint(composer)
  }, [browserControlOwner, browserModeEnabled, composer])

  const effectiveSystemAddendum = useMemo(() => {
    const parts = [browserSystemAddendum, browserAutopilotHint]
      .map(item => item?.trim())
      .filter((item): item is string => Boolean(item))
    if (parts.length === 0) {
      return undefined
    }
    return parts.join('\n\n')
  }, [browserAutopilotHint, browserSystemAddendum])

  const activePromptToolsPolicy = useMemo(
    () =>
      mergeModeToolPolicies(
        browserModeEnabled
          ? mcpDevToolsState === 'running'
            ? BROWSER_MODE_TOOLS_POLICY_WITH_MCP
            : BROWSER_MODE_TOOLS_POLICY
          : undefined
      ),
    [browserModeEnabled, mcpDevToolsState]
  )

  return {
    browserAutopilotHint,
    effectiveSystemAddendum,
    activePromptToolsPolicy,
  }
}
