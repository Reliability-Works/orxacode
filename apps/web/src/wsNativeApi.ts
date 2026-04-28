import { type ContextMenuItem, type NativeApi } from '@orxa-code/contracts'

import { showContextMenuFallback } from './contextMenuFallback'
import { resetServerStateForTests } from './rpc/serverState'
import { getWsRpcClient, resetWsRpcClientForTests, type WsRpcClient } from './wsRpcClient'

let instance: { api: NativeApi } | null = null

export async function resetWsNativeApiForTests() {
  instance = null
  resetServerStateForTests()
  await resetWsRpcClientForTests()
}

function createDialogsApi(): NativeApi['dialogs'] {
  return {
    pickFolder: async () => {
      if (!window.desktopBridge) return null
      return window.desktopBridge.pickFolder()
    },
    confirm: async message => {
      if (window.desktopBridge) {
        return window.desktopBridge.confirm(message)
      }
      return window.confirm(message)
    },
  }
}

function createShellApi(rpcClient: WsRpcClient): NativeApi['shell'] {
  return {
    openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
    openExternal: async url => {
      if (window.desktopBridge) {
        const opened = await window.desktopBridge.openExternal(url)
        if (!opened) {
          throw new Error('Unable to open link.')
        }
        return
      }

      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

function createContextMenuApi(): NativeApi['contextMenu'] {
  return {
    show: async <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number }
    ): Promise<T | null> => {
      if (window.desktopBridge) {
        return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>
      }
      return showContextMenuFallback(items, position)
    },
  }
}

function createServerApi(rpcClient: WsRpcClient): NativeApi['server'] {
  return {
    getConfig: rpcClient.server.getConfig,
    refreshProviders: rpcClient.server.refreshProviders,
    upsertKeybinding: rpcClient.server.upsertKeybinding,
    getSettings: rpcClient.server.getSettings,
    updateSettings: rpcClient.server.updateSettings,
  }
}

function createOrchestrationApi(rpcClient: WsRpcClient): NativeApi['orchestration'] {
  return {
    getSnapshot: rpcClient.orchestration.getSnapshot,
    dispatchCommand: rpcClient.orchestration.dispatchCommand,
    getTurnDiff: rpcClient.orchestration.getTurnDiff,
    getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
    replayEvents: fromSequenceExclusive =>
      rpcClient.orchestration.replayEvents({ fromSequenceExclusive }).then(events => [...events]),
    onDomainEvent: callback => rpcClient.orchestration.onDomainEvent(callback),
  }
}

function createChatsApi(): NativeApi['chats'] {
  return {
    getBaseDir: async () => {
      if (!window.desktopBridge) return null
      return window.desktopBridge.chatsGetBaseDir()
    },
    materializeDir: async input => {
      if (!window.desktopBridge) {
        throw new Error('Chats are only available in the desktop app.')
      }
      return window.desktopBridge.chatsMaterializeDir(input)
    },
    removeDir: async input => {
      if (!window.desktopBridge) return { removed: false }
      return window.desktopBridge.chatsRemoveDir(input)
    },
  }
}

export function createWsNativeApiForRpcClient(rpcClient: WsRpcClient): NativeApi {
  const api: NativeApi = {
    dialogs: createDialogsApi(),
    ...(window.desktopBridge?.browser ? { browser: window.desktopBridge.browser } : {}),
    terminal: {
      open: input => rpcClient.terminal.open(input as never),
      write: input => rpcClient.terminal.write(input as never),
      resize: input => rpcClient.terminal.resize(input as never),
      clear: input => rpcClient.terminal.clear(input as never),
      restart: input => rpcClient.terminal.restart(input as never),
      close: input => rpcClient.terminal.close(input as never),
      onEvent: callback => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      listEntries: rpcClient.projects.listEntries,
      searchEntries: rpcClient.projects.searchEntries,
      readFile: rpcClient.projects.readFile,
      writeFile: rpcClient.projects.writeFile,
    },
    shell: createShellApi(rpcClient),
    git: {
      pull: rpcClient.git.pull,
      status: rpcClient.git.status,
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      pushWorktreeToParent: rpcClient.git.pushWorktreeToParent,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
      discoverRepos: rpcClient.git.discoverRepos,
    },
    contextMenu: createContextMenuApi(),
    server: createServerApi(rpcClient),
    orchestration: createOrchestrationApi(rpcClient),
    chats: createChatsApi(),
  }

  return api
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    return instance.api
  }

  const api = createWsNativeApiForRpcClient(getWsRpcClient())
  instance = { api }
  return api
}
