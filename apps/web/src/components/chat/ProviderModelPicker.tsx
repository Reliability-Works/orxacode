import { type ProviderKind, type ServerProvider } from '@orxa-code/contracts'
import { resolveSelectableModel } from '@orxa-code/shared/model'
import { memo, useState } from 'react'
import type { VariantProps } from 'class-variance-authority'
import { type ProviderPickerKind, PROVIDER_OPTIONS } from '../../session-logic'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { buttonVariants } from '../ui/buttonVariants'
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from '../ui/menu'
import { ClaudeAI, CursorIcon, Gemini, Icon, OpenAI, OpenCodeIcon } from '../Icons'
import { cn } from '~/lib/utils'
import { getProviderSnapshot } from '../../providerModels'
import {
  groupOpencodeModelsBySubprovider,
  stripOpencodeSubproviderPrefix,
  type OpencodeSubproviderGroup,
} from '../../opencodeModelGroups'

type ProviderModelOption = { slug: string; name: string }
type ProviderModelPickerProps = {
  provider: ProviderKind
  model: string
  lockedProvider: ProviderKind | null
  providers?: ReadonlyArray<ServerProvider>
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>
  activeProviderIconClassName?: string
  compact?: boolean
  disabled?: boolean
  triggerVariant?: VariantProps<typeof buttonVariants>['variant']
  triggerClassName?: string
  onProviderModelChange: (provider: ProviderKind, model: string) => void
}

function isAvailableProviderOption(option: (typeof PROVIDER_OPTIONS)[number]): option is {
  value: ProviderKind
  label: string
  available: true
} {
  return option.available
}

const PROVIDER_ICON_BY_PROVIDER: Record<ProviderPickerKind, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  opencode: OpenCodeIcon,
  cursor: CursorIcon,
}

export const AVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(isAvailableProviderOption)
const UNAVAILABLE_PROVIDER_OPTIONS = PROVIDER_OPTIONS.filter(option => !option.available)
const COMING_SOON_PROVIDER_OPTIONS = [{ id: 'gemini', label: 'Gemini', icon: Gemini }] as const

function providerIconClassName(
  provider: ProviderKind | ProviderPickerKind,
  fallbackClassName: string
): string {
  return provider === 'claudeAgent' ? 'text-[#d97757]' : fallbackClassName
}

function ProviderStatusLabel(props: { label: string }) {
  return (
    <span className="ms-auto text-caption text-muted-foreground/80 uppercase tracking-wide">
      {props.label}
    </span>
  )
}

function DisabledProviderMenuItem(props: {
  icon: Icon
  label: string
  statusLabel: string
  iconClassName?: string
}) {
  const IconComponent = props.icon
  return (
    <MenuItem disabled>
      <IconComponent
        aria-hidden="true"
        className={cn('size-4 shrink-0 opacity-80', props.iconClassName)}
      />
      <span>{props.label}</span>
      <ProviderStatusLabel label={props.statusLabel} />
    </MenuItem>
  )
}

function ProviderModelPickerTrigger(props: {
  activeProvider: ProviderKind
  selectedModelLabel: string
  compact: boolean | undefined
  activeProviderIconClassName: string | undefined
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.activeProvider]
  return (
    <span
      className={cn(
        'flex min-w-0 w-full box-border items-center gap-2.5 overflow-hidden md:gap-2',
        props.compact ? 'max-w-[13rem] sm:pl-1 md:max-w-36' : undefined
      )}
    >
      <ProviderIcon
        aria-hidden="true"
        className={cn(
          'size-4.5 shrink-0 md:size-4',
          providerIconClassName(props.activeProvider, 'text-muted-foreground/70'),
          props.activeProviderIconClassName
        )}
      />
      <span className="min-w-0 flex-1 truncate">{props.selectedModelLabel}</span>
      <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60 md:size-3" />
    </span>
  )
}

function ProviderModelsRadioGroup(props: {
  provider: ProviderKind
  value: string
  modelOptions: ReadonlyArray<ProviderModelOption>
  onValueChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  if (props.provider === 'opencode') {
    return (
      <OpencodeGroupedRadioGroups
        value={props.value}
        modelOptions={props.modelOptions}
        onValueChange={props.onValueChange}
        onClose={props.onClose}
      />
    )
  }
  return (
    <MenuGroup>
      <MenuRadioGroup
        value={props.value}
        onValueChange={value => props.onValueChange(props.provider, value)}
      >
        {props.modelOptions.map(modelOption => (
          <MenuRadioItem
            key={`${props.provider}:${modelOption.slug}`}
            value={modelOption.slug}
            onClick={props.onClose}
          >
            {modelOption.name}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </MenuGroup>
  )
}

function OpencodeGroupedRadioGroups(props: {
  value: string
  modelOptions: ReadonlyArray<ProviderModelOption>
  onValueChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  const groups = groupOpencodeModelsBySubprovider(props.modelOptions)
  return (
    <>
      {groups.map((group, index) => (
        <OpencodeSubproviderSection
          key={group.providerId}
          group={group}
          value={props.value}
          showDivider={index > 0}
          onValueChange={props.onValueChange}
          onClose={props.onClose}
        />
      ))}
    </>
  )
}

function OpencodeSubproviderSection(props: {
  group: OpencodeSubproviderGroup<ProviderModelOption>
  value: string
  showDivider: boolean
  onValueChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  const { group, value, showDivider, onValueChange, onClose } = props
  return (
    <>
      {showDivider ? <MenuDivider /> : null}
      <MenuGroup>
        <div className="px-2 pt-1.5 pb-1 font-medium text-caption text-muted-foreground/80 uppercase tracking-wide">
          {group.label}
        </div>
        <MenuRadioGroup value={value} onValueChange={next => onValueChange('opencode', next)}>
          {group.options.map(modelOption => (
            <MenuRadioItem
              key={`opencode:${modelOption.slug}`}
              value={modelOption.slug}
              onClick={onClose}
            >
              {modelOption.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuGroup>
    </>
  )
}

function AvailableProviderSubmenu(props: {
  option: (typeof AVAILABLE_PROVIDER_OPTIONS)[number]
  provider: ProviderKind
  model: string
  providers: ReadonlyArray<ServerProvider> | undefined
  modelOptions: ReadonlyArray<ProviderModelOption>
  onValueChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  const OptionIcon = PROVIDER_ICON_BY_PROVIDER[props.option.value]
  const liveProvider = props.providers
    ? getProviderSnapshot(props.providers, props.option.value)
    : undefined

  if (liveProvider && liveProvider.status !== 'ready') {
    const unavailableLabel = !liveProvider.enabled
      ? 'Disabled'
      : !liveProvider.installed
        ? 'Not installed'
        : 'Unavailable'
    return (
      <DisabledProviderMenuItem
        icon={OptionIcon}
        label={props.option.label}
        statusLabel={unavailableLabel}
        iconClassName={providerIconClassName(props.option.value, 'text-muted-foreground/85')}
      />
    )
  }

  return (
    <MenuSub>
      <MenuSubTrigger>
        <OptionIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0',
            providerIconClassName(props.option.value, 'text-muted-foreground/85')
          )}
        />
        {props.option.label}
      </MenuSubTrigger>
      <MenuSubPopup className="[--available-height:min(24rem,70vh)]" sideOffset={4}>
        <ProviderModelsRadioGroup
          provider={props.option.value}
          value={props.provider === props.option.value ? props.model : ''}
          modelOptions={props.modelOptions}
          onValueChange={props.onValueChange}
          onClose={props.onClose}
        />
      </MenuSubPopup>
    </MenuSub>
  )
}

export function ProviderOptionsMenu(props: {
  provider: ProviderKind
  model: string
  providers: ReadonlyArray<ServerProvider> | undefined
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ProviderModelOption>>
  onValueChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  return (
    <>
      {AVAILABLE_PROVIDER_OPTIONS.map(option => (
        <AvailableProviderSubmenu
          key={option.value}
          option={option}
          provider={props.provider}
          model={props.model}
          providers={props.providers}
          modelOptions={props.modelOptionsByProvider[option.value]}
          onValueChange={props.onValueChange}
          onClose={props.onClose}
        />
      ))}
      {UNAVAILABLE_PROVIDER_OPTIONS.length > 0 && <MenuDivider />}
      {UNAVAILABLE_PROVIDER_OPTIONS.map(option => (
        <DisabledProviderMenuItem
          key={option.value}
          icon={PROVIDER_ICON_BY_PROVIDER[option.value]}
          label={option.label}
          statusLabel="Coming soon"
          iconClassName="text-muted-foreground/85"
        />
      ))}
      {UNAVAILABLE_PROVIDER_OPTIONS.length === 0 && <MenuDivider />}
      {COMING_SOON_PROVIDER_OPTIONS.map(option => (
        <DisabledProviderMenuItem
          key={option.id}
          icon={option.icon}
          label={option.label}
          statusLabel="Coming soon"
        />
      ))}
    </>
  )
}

function ProviderModelPickerMenuContent(props: {
  picker: ProviderModelPickerProps
  onModelChange: (provider: ProviderKind, value: string) => void
  onClose: () => void
}) {
  const { picker, onModelChange, onClose } = props
  if (picker.lockedProvider !== null) {
    return (
      <ProviderModelsRadioGroup
        provider={picker.lockedProvider}
        value={picker.model}
        modelOptions={picker.modelOptionsByProvider[picker.lockedProvider]}
        onValueChange={onModelChange}
        onClose={onClose}
      />
    )
  }
  return (
    <ProviderOptionsMenu
      provider={picker.provider}
      model={picker.model}
      providers={picker.providers}
      modelOptionsByProvider={picker.modelOptionsByProvider}
      onValueChange={onModelChange}
      onClose={onClose}
    />
  )
}

export const ProviderModelPicker = memo(function ProviderModelPicker(
  props: ProviderModelPickerProps
) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const activeProvider = props.lockedProvider ?? props.provider
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider]
  const rawSelectedLabel =
    selectedProviderOptions.find(option => option.slug === props.model)?.name ?? props.model
  // Opencode model names may arrive in `{provider}/{model}` form — the
  // closed trigger should only show the model, since the provider section
  // is already visible inside the open menu.
  const selectedModelLabel =
    activeProvider === 'opencode'
      ? stripOpencodeSubproviderPrefix(rawSelectedLabel)
      : rawSelectedLabel
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return
    if (!value) return
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider]
    )
    if (!resolvedModel) return
    props.onProviderModelChange(provider, resolvedModel)
    setIsMenuOpen(false)
  }

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={open => {
        if (props.disabled) {
          setIsMenuOpen(false)
          return
        }
        setIsMenuOpen(open)
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? 'ghost'}
            data-chat-provider-model-picker="true"
            className={cn(
              'min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0',
              props.compact ? 'max-w-42 shrink-0' : 'max-w-48 shrink sm:max-w-56 sm:px-3',
              props.triggerClassName
            )}
            disabled={props.disabled}
          />
        }
      >
        <ProviderModelPickerTrigger
          activeProvider={activeProvider}
          selectedModelLabel={selectedModelLabel}
          compact={props.compact}
          activeProviderIconClassName={props.activeProviderIconClassName}
        />
      </MenuTrigger>
      <MenuPopup align="start">
        <ProviderModelPickerMenuContent
          picker={props}
          onModelChange={handleModelChange}
          onClose={() => setIsMenuOpen(false)}
        />
      </MenuPopup>
    </Menu>
  )
})
