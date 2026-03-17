export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  lastNavigatedAt?: number;
};

export type BrowserState = {
  partition: string;
  bounds: BrowserBounds;
  tabs: BrowserTab[];
  activeTabID?: string;
};

export type BrowserHistoryItem = {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
};

export type BrowserLocator = {
  selector?: string;
  selectors?: string[];
  text?: string;
  role?: string;
  name?: string;
  label?: string;
  frameSelector?: string;
  includeShadowDom?: boolean;
  exact?: boolean;
};

export type BrowserAgentActionRequest =
  | {
      action: "open_tab";
      url?: string;
      activate?: boolean;
    }
  | {
      action: "close_tab";
      tabID?: string;
    }
  | {
      action: "switch_tab";
      tabID: string;
    }
  | {
      action: "navigate";
      url: string;
      tabID?: string;
    }
  | {
      action: "back";
      tabID?: string;
    }
  | {
      action: "forward";
      tabID?: string;
    }
  | {
      action: "reload";
      tabID?: string;
    }
  | {
      action: "click";
      tabID?: string;
      selector?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
      maxAttempts?: number;
      waitForNavigation?: boolean;
    }
  | {
      action: "type";
      text: string;
      tabID?: string;
      selector?: string;
      locator?: BrowserLocator;
      submit?: boolean;
      clear?: boolean;
      timeoutMs?: number;
      maxAttempts?: number;
    }
  | {
      action: "press";
      key: string;
      tabID?: string;
    }
  | {
      action: "scroll";
      tabID?: string;
      x?: number;
      y?: number;
      top?: number;
      left?: number;
      behavior?: "auto" | "smooth";
    }
  | {
      action: "extract_text";
      selector?: string;
      tabID?: string;
      maxLength?: number;
      locator?: BrowserLocator;
      timeoutMs?: number;
      maxAttempts?: number;
    }
  | {
      action: "exists";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
    }
  | {
      action: "visible";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
    }
  | {
      action: "wait_for";
      selector?: string;
      tabID?: string;
      locator?: BrowserLocator;
      timeoutMs?: number;
      state?: "attached" | "visible" | "hidden";
    }
  | {
      action: "wait_for_navigation";
      tabID?: string;
      timeoutMs?: number;
    }
  | {
      action: "wait_for_idle";
      tabID?: string;
      timeoutMs?: number;
      idleMs?: number;
    }
  | {
      action: "screenshot";
      tabID?: string;
      format?: "png" | "jpeg";
      quality?: number;
      bounds?: Partial<BrowserBounds>;
      workspace?: string;
      sessionID?: string;
      actionID?: string;
    };

export type BrowserAgentActionResult = {
  action: BrowserAgentActionRequest["action"];
  ok: boolean;
  state: BrowserState;
  tabID?: string;
  data?: Record<string, unknown>;
  error?: string;
};
