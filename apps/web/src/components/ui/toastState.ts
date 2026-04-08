import { ThreadId } from '@orxa-code/contracts'
import { Toast } from '@base-ui/react/toast'

export type ThreadToastData = {
  threadId?: ThreadId | null
  tooltipStyle?: boolean
  dismissAfterVisibleMs?: number
}

export const toastManager = Toast.createToastManager<ThreadToastData>()
export const anchoredToastManager = Toast.createToastManager<ThreadToastData>()
