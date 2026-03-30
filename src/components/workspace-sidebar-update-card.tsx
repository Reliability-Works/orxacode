import type { AppShellUpdateStatusMessage } from '../hooks/useAppShellUpdateFlow'

type WorkspaceSidebarUpdateCardProps = {
  updateAvailableVersion: string | null
  isCheckingForUpdates: boolean
  updateInstallPending: boolean
  updateStatusMessage: AppShellUpdateStatusMessage | null
  onCheckForUpdates: () => Promise<void> | void
  onDownloadAndInstallUpdate: () => Promise<void> | void
}

export function WorkspaceSidebarUpdateCard({
  updateAvailableVersion,
  isCheckingForUpdates,
  updateInstallPending,
  updateStatusMessage,
  onCheckForUpdates,
  onDownloadAndInstallUpdate,
}: WorkspaceSidebarUpdateCardProps) {
  if (!updateAvailableVersion) {
    return null
  }

  return (
    <button
      type="button"
      className="update-card"
      onClick={() => {
        if (updateInstallPending) {
          void onDownloadAndInstallUpdate()
          return
        }
        void onCheckForUpdates()
      }}
      disabled={isCheckingForUpdates}
    >
      <span className="update-card-title">Update available</span>
      <span className="update-card-version">{updateAvailableVersion}</span>
      <span className="update-card-message">
        {updateStatusMessage?.text ?? 'Install the latest release'}
      </span>
    </button>
  )
}
