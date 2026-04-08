// DOM query + viewport helpers for ChatView browser tests.
// Extracted from ChatView.browser.ctx.ts to satisfy max-lines.

import { page } from 'vitest/browser'
import { expect, vi } from 'vitest'
import { isMacPlatform } from '../lib/utils'
import { getRouter } from '../router'

export interface ViewportSpec {
  name: string
  width: number
  height: number
  textTolerancePx: number
  attachmentTolerancePx: number
}

export async function nextFrame(): Promise<void> {
  await new Promise<void>(resolve => {
    window.requestAnimationFrame(() => resolve())
  })
}

export async function waitForLayout(): Promise<void> {
  await nextFrame()
  await nextFrame()
  await nextFrame()
}

export async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height)
  await waitForLayout()
}

export async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue('--background').trim()
      ).not.toBe('')
      expect(getComputedStyle(document.body).marginTop).toBe('0px')
    },
    { timeout: 4_000, interval: 16 }
  )
}

export async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string
): Promise<T> {
  let element: T | null = null
  await vi.waitFor(
    () => {
      element = query()
      expect(element, errorMessage).toBeTruthy()
    },
    { timeout: 8_000, interval: 16 }
  )
  if (!element) throw new Error(errorMessage)
  return element
}

export async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string
): Promise<string> {
  let pathname = ''
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname
      expect(predicate(pathname), errorMessage).toBe(true)
    },
    { timeout: 8_000, interval: 16 }
  )
  return pathname
}

export async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    'Unable to find composer editor.'
  )
}

export async function waitForComposerMenuItem(itemId: string): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>(`[data-composer-item-id="${itemId}"]`),
    `Unable to find composer menu item "${itemId}".`
  )
}

export async function waitForSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
    'Unable to find send button.'
  )
}

export function findComposerProviderModelPicker(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-chat-provider-model-picker="true"]')
}

export function findButtonByText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll('button')).find(
    b => b.textContent?.trim() === text
  ) ?? null) as HTMLButtonElement | null
}

export async function waitForButtonByText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(() => findButtonByText(text), `Unable to find "${text}" button.`)
}

function findButtonContainingText(text: string): HTMLButtonElement | null {
  return (Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent?.includes(text)
  ) ?? null) as HTMLButtonElement | null
}

export async function waitForButtonContainingText(text: string): Promise<HTMLButtonElement> {
  return waitForElement(
    () => findButtonContainingText(text),
    `Unable to find button containing "${text}".`
  )
}

export async function expectComposerActionsContained(): Promise<void> {
  const footer = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-composer-footer="true"]'),
    'Unable to find composer footer.'
  )
  const actions = await waitForElement(
    () => document.querySelector<HTMLElement>('[data-chat-composer-actions="right"]'),
    'Unable to find composer actions container.'
  )
  await vi.waitFor(
    () => {
      const footerRect = footer.getBoundingClientRect()
      const actionButtons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'))
      expect(actionButtons.length).toBeGreaterThanOrEqual(1)
      const buttonRects = actionButtons.map(b => b.getBoundingClientRect())
      const firstTop = buttonRects[0]?.top ?? 0
      for (const rect of buttonRects) {
        expect(rect.right).toBeLessThanOrEqual(footerRect.right + 0.5)
        expect(rect.bottom).toBeLessThanOrEqual(footerRect.bottom + 0.5)
        expect(Math.abs(rect.top - firstTop)).toBeLessThanOrEqual(1.5)
      }
    },
    { timeout: 8_000, interval: 16 }
  )
}

export async function waitForInteractionModeButton(
  expectedLabel: 'Chat' | 'Plan'
): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.trim() === expectedLabel
      ) as HTMLButtonElement | null,
    `Unable to find ${expectedLabel} interaction mode button.`
  )
}

export function dispatchChatNewShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform)
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'o',
      shiftKey: true,
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    })
  )
}

export async function triggerChatNewShortcutUntilPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string
): Promise<string> {
  let pathname = router.state.location.pathname
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    dispatchChatNewShortcut()
    await waitForLayout()
    pathname = router.state.location.pathname
    if (predicate(pathname)) return pathname
  }
  throw new Error(`${errorMessage} Last path: ${pathname}`)
}

export async function waitForNewThreadShortcutLabel(): Promise<void> {
  const newThreadButton = page.getByTestId('new-thread-button')
  await expect.element(newThreadButton).toBeInTheDocument()
  await newThreadButton.hover()
  const shortcutLabel = isMacPlatform(navigator.platform)
    ? 'New thread (⇧⌘O)'
    : 'New thread (Ctrl+Shift+O)'
  await expect.element(page.getByText(shortcutLabel)).toBeInTheDocument()
}

export async function waitForImagesToLoad(scope: ParentNode): Promise<void> {
  const images = Array.from(scope.querySelectorAll('img'))
  if (images.length === 0) return
  await Promise.all(
    images.map(
      image =>
        new Promise<void>(resolve => {
          if (image.complete) {
            resolve()
            return
          }
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        })
    )
  )
  await waitForLayout()
}
