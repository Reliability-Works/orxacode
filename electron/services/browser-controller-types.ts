import type { WebContents } from 'electron'
import type { ArtifactRecord, BrowserState, OrxaEvent } from '../../shared/ipc'

export type BrowserTabRecord = {
  id: string
  view: { webContents: WebContents }
  lastNavigatedAt?: number
  lastActivityAt: number
}

export type BrowserControllerActionContext = {
  now: () => number
  getState: () => BrowserState
  emit: (event: OrxaEvent) => void
  titleForRecord: (record: BrowserTabRecord) => string
  requireTab: (tabID?: string) => BrowserTabRecord
  openTab: (url?: string, activate?: boolean) => Promise<unknown>
  closeTab: (tabID?: string) => unknown
  switchTab: (tabID: string) => unknown
  navigate: (url: string, tabID?: string) => Promise<unknown>
  back: (tabID?: string) => unknown
  forward: (tabID?: string) => unknown
  reload: (tabID?: string) => unknown
  artifactStore: {
    writeImageArtifact: (input: {
      workspace: string
      sessionID: string
      kind: string
      mime: string
      buffer: Buffer
      width: number
      height: number
      title: string
      url: string
      actionID?: string
      metadata?: Record<string, unknown>
    }) => Promise<ArtifactRecord>
  }
  getActiveWebContents: () => WebContents | null
  inspectPollTimer: ReturnType<typeof setInterval> | null
  inspectEventCallback: ((annotation: unknown) => void) | null
}
