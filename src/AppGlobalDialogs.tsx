import { ConfirmDialog } from './components/ConfirmDialog'
import { TextInputDialog } from './components/TextInputDialog'
import { GlobalModalsHost } from './components/GlobalModalsHost'
import { GlobalSearchModal } from './components/GlobalSearchModal'
import { SettingsDrawer } from './components/SettingsDrawer'
import { InfoDialog } from './components/InfoDialog'

type AppGlobalDialogsProps = {
  confirmDialogProps: React.ComponentProps<typeof ConfirmDialog>
  textInputDialogProps: React.ComponentProps<typeof TextInputDialog>
  globalModalsProps: React.ComponentProps<typeof GlobalModalsHost>
  globalSearchProps: React.ComponentProps<typeof GlobalSearchModal>
  settingsDrawerProps: React.ComponentProps<typeof SettingsDrawer>
  infoDialogProps: React.ComponentProps<typeof InfoDialog>
}

export function AppGlobalDialogs(props: AppGlobalDialogsProps) {
  const {
    confirmDialogProps,
    textInputDialogProps,
    globalModalsProps,
    globalSearchProps,
    settingsDrawerProps,
    infoDialogProps,
  } = props

  return (
    <>
      <ConfirmDialog {...confirmDialogProps} />
      <TextInputDialog {...textInputDialogProps} />
      <GlobalModalsHost {...globalModalsProps} />
      <GlobalSearchModal {...globalSearchProps} />
      <SettingsDrawer {...settingsDrawerProps} />
      <InfoDialog {...infoDialogProps} />
    </>
  )
}
