import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { BrowserAgentActionRequest, BrowserBounds, BrowserLocator } from "../../shared/ipc";

import { assertBoolean, assertFiniteNumber, assertOptionalString, assertString, assertStringArray } from "./validators-core";

export function assertBrowserBoundsInput(value: unknown): BrowserBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser bounds payload is required");
  }
  const payload = value as Partial<BrowserBounds>;
  const width = assertFiniteNumber(payload.width, "bounds.width");
  const height = assertFiniteNumber(payload.height, "bounds.height");
  return {
    x: assertFiniteNumber(payload.x, "bounds.x"),
    y: assertFiniteNumber(payload.y, "bounds.y"),
    width,
    height,
  };
}

export function assertOptionalBrowserBoundsInput(value: unknown): Partial<BrowserBounds> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bounds must be an object");
  }
  const payload = value as Partial<BrowserBounds>;
  const output: Partial<BrowserBounds> = {};
  if (payload.x !== undefined) {
    output.x = assertFiniteNumber(payload.x, "bounds.x");
  }
  if (payload.y !== undefined) {
    output.y = assertFiniteNumber(payload.y, "bounds.y");
  }
  if (payload.width !== undefined) {
    output.width = assertFiniteNumber(payload.width, "bounds.width");
  }
  if (payload.height !== undefined) {
    output.height = assertFiniteNumber(payload.height, "bounds.height");
  }
  return output;
}

export function assertOptionalBrowserLocatorInput(value: unknown): BrowserLocator | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("locator must be an object");
  }
  const payload = value as Record<string, unknown>;
  const locator: BrowserLocator = {};
  if (payload.selector !== undefined) {
    locator.selector = assertString(payload.selector, "locator.selector");
  }
  if (payload.selectors !== undefined) {
    locator.selectors = assertStringArray(payload.selectors, "locator.selectors", 24);
  }
  if (payload.text !== undefined) {
    locator.text = assertString(payload.text, "locator.text");
  }
  if (payload.role !== undefined) {
    locator.role = assertString(payload.role, "locator.role");
  }
  if (payload.name !== undefined) {
    locator.name = assertString(payload.name, "locator.name");
  }
  if (payload.label !== undefined) {
    locator.label = assertString(payload.label, "locator.label");
  }
  if (payload.frameSelector !== undefined) {
    locator.frameSelector = assertString(payload.frameSelector, "locator.frameSelector");
  }
  if (payload.includeShadowDom !== undefined) {
    locator.includeShadowDom = assertBoolean(payload.includeShadowDom, "locator.includeShadowDom");
  }
  if (payload.exact !== undefined) {
    locator.exact = assertBoolean(payload.exact, "locator.exact");
  }
  return locator;
}

export function createAssertBrowserSender(getMainWindow: () => BrowserWindow | null) {
  return (event: IpcMainInvokeEvent) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("Main window is not available");
    }
    if (event.sender.id !== mainWindow.webContents.id) {
      throw new Error("Unauthorized browser IPC sender");
    }
  };
}

export function assertBrowserAgentActionRequest(value: unknown): BrowserAgentActionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser action payload is required");
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.action !== "string") {
    throw new Error("Browser action is required");
  }

  const tabID = assertOptionalString(payload.tabID, "tabID");
  const timeoutMs = payload.timeoutMs === undefined ? undefined : Math.floor(assertFiniteNumber(payload.timeoutMs, "timeoutMs"));
  const maxAttempts = payload.maxAttempts === undefined ? undefined : Math.floor(assertFiniteNumber(payload.maxAttempts, "maxAttempts"));
  const locator = assertOptionalBrowserLocatorInput(payload.locator);
  const action = payload.action;
  switch (action) {
    case "open_tab":
      return {
        action,
        url: assertOptionalString(payload.url, "url"),
        activate: payload.activate === undefined ? undefined : assertBoolean(payload.activate, "activate"),
      };
    case "close_tab":
      return {
        action,
        tabID,
      };
    case "switch_tab":
      return {
        action,
        tabID: assertString(payload.tabID, "tabID"),
      };
    case "navigate":
      return {
        action,
        url: assertString(payload.url, "url"),
        tabID,
      };
    case "back":
    case "forward":
    case "reload":
      return {
        action,
        tabID,
      };
    case "click":
      return {
        action,
        tabID,
        selector: assertOptionalString(payload.selector, "selector"),
        locator,
        timeoutMs,
        maxAttempts,
        waitForNavigation:
          payload.waitForNavigation === undefined ? undefined : assertBoolean(payload.waitForNavigation, "waitForNavigation"),
      };
    case "type":
      return {
        action,
        text: assertString(payload.text, "text"),
        tabID,
        selector: assertOptionalString(payload.selector, "selector"),
        locator,
        submit: payload.submit === undefined ? undefined : assertBoolean(payload.submit, "submit"),
        clear: payload.clear === undefined ? undefined : assertBoolean(payload.clear, "clear"),
        timeoutMs,
        maxAttempts,
      };
    case "press":
      return {
        action,
        key: assertString(payload.key, "key"),
        tabID,
      };
    case "scroll": {
      const behavior =
        payload.behavior === undefined
          ? undefined
          : payload.behavior === "auto" || payload.behavior === "smooth"
            ? payload.behavior
            : (() => {
                throw new Error("scroll behavior must be 'auto' or 'smooth'");
              })();
      return {
        action,
        tabID,
        x: payload.x === undefined ? undefined : assertFiniteNumber(payload.x, "x"),
        y: payload.y === undefined ? undefined : assertFiniteNumber(payload.y, "y"),
        top: payload.top === undefined ? undefined : assertFiniteNumber(payload.top, "top"),
        left: payload.left === undefined ? undefined : assertFiniteNumber(payload.left, "left"),
        behavior,
      };
    }
    case "extract_text":
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        maxLength: payload.maxLength === undefined ? undefined : Math.floor(assertFiniteNumber(payload.maxLength, "maxLength")),
        locator,
        timeoutMs,
        maxAttempts,
      };
    case "exists":
    case "visible":
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        locator,
        timeoutMs,
      };
    case "wait_for": {
      const state =
        payload.state === undefined
          ? undefined
          : payload.state === "attached" || payload.state === "visible" || payload.state === "hidden"
            ? payload.state
            : (() => {
                throw new Error("wait_for state must be 'attached', 'visible', or 'hidden'");
              })();
      return {
        action,
        selector: assertOptionalString(payload.selector, "selector"),
        tabID,
        locator,
        timeoutMs,
        state,
      };
    }
    case "wait_for_navigation":
      return {
        action,
        tabID,
        timeoutMs,
      };
    case "wait_for_idle":
      return {
        action,
        tabID,
        timeoutMs,
        idleMs: payload.idleMs === undefined ? undefined : Math.floor(assertFiniteNumber(payload.idleMs, "idleMs")),
      };
    case "screenshot": {
      const format =
        payload.format === undefined
          ? undefined
          : payload.format === "png" || payload.format === "jpeg"
            ? payload.format
            : (() => {
                throw new Error("screenshot format must be 'png' or 'jpeg'");
              })();
      return {
        action,
        tabID,
        format,
        quality: payload.quality === undefined ? undefined : assertFiniteNumber(payload.quality, "quality"),
        bounds: assertOptionalBrowserBoundsInput(payload.bounds),
        workspace: payload.workspace === undefined ? undefined : assertString(payload.workspace, "workspace"),
        sessionID: payload.sessionID === undefined ? undefined : assertString(payload.sessionID, "sessionID"),
        actionID: payload.actionID === undefined ? undefined : assertString(payload.actionID, "actionID"),
      };
    }
    default:
      throw new Error(`Unsupported browser action: ${action}`);
  }
}
