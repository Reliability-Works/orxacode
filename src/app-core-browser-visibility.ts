export function shouldHideBrowserViewForPendingInput(input: {
  pendingPermission: unknown
  pendingQuestion: unknown
  dockPendingPermission: unknown
  dockPendingQuestion: unknown
}) {
  const { pendingPermission, pendingQuestion, dockPendingPermission, dockPendingQuestion } = input
  return Boolean(
    pendingPermission || pendingQuestion || dockPendingPermission || dockPendingQuestion
  )
}
