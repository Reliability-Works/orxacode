import type { BrowserLocator } from "../../shared/ipc";

export type BrowserRecoveryStep = "dismiss_overlays" | "stabilize";
export type BrowserInteractionMode = "click" | "type" | "extract_text" | "exists" | "visible" | "inspect";
export type BrowserInteractionOptions = {
  text?: string;
  clear?: boolean;
  maxLength?: number;
  timeoutMs?: number;
};

export function buildRecoveryScript(step: BrowserRecoveryStep): string {
  return `(() => {
      const step = ${JSON.stringify(step)};
      if (step === "dismiss_overlays") {
        const selectors = [
          "[aria-modal='true'] button",
          "button[aria-label*='close' i]",
          "button[title*='close' i]",
          "button[class*='close' i]",
          "button[id*='close' i]",
          "button[name*='close' i]",
          "button[data-testid*='close' i]",
          "button[data-test*='close' i]",
          "button:where([aria-label*='accept' i], [aria-label*='agree' i], [aria-label*='consent' i])",
          "button:where([id*='accept' i], [name*='accept' i], [class*='accept' i])",
          "[role='dialog'] button",
          ".modal button",
          ".popup button",
          ".cookie button",
        ];
        let dismissed = 0;
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue;
            const style = window.getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") continue;
            try {
              node.click();
              dismissed += 1;
              if (dismissed >= 4) break;
            } catch {
              // ignore recovery failures
            }
          }
          if (dismissed >= 4) break;
        }
        return { ok: true, step, dismissed };
      }

      try {
        window.dispatchEvent(new Event("resize"));
        window.scrollBy({ top: 0, left: 0, behavior: "auto" });
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      } catch {
        // ignore recovery failures
      }
      return { ok: true, step };
    })();`;
}

export function buildInteractionScript(
  mode: BrowserInteractionMode,
  locator: BrowserLocator,
  options: BrowserInteractionOptions,
): string {
  return `(() => {
      const mode = ${JSON.stringify(mode)};
      const locator = ${JSON.stringify(locator)};
      const options = ${JSON.stringify(options)};

      const includeShadowDom = locator.includeShadowDom !== false;
      const exact = locator.exact === true;

      const toStringSafe = (value) => {
        if (typeof value === "string") return value;
        if (value === null || value === undefined) return "";
        return String(value);
      };

      const normalize = (value) => toStringSafe(value).replace(/\\s+/g, " ").trim();
      const normalizeMatch = (value) => normalize(value).toLowerCase();
      const cssEscape = (value) => {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          return CSS.escape(value);
        }
        return toStringSafe(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
      };
      const dedupe = (values) => {
        const out = [];
        const seen = new Set();
        for (const raw of values) {
          const value = normalize(raw);
          if (!value) continue;
          const key = value.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(value);
        }
        return out;
      };

      const textMatches = (haystack, needle) => {
        const h = normalizeMatch(haystack);
        const n = normalizeMatch(needle);
        if (!n) return false;
        return exact ? h === n : h.includes(n);
      };

      const isElementVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const collectElements = (root) => {
        const out = [];
        const visited = new Set();
        const walk = (node) => {
          if (!node || visited.has(node)) return;
          visited.add(node);
          if (node instanceof Element) {
            out.push(node);
            if (includeShadowDom && node.shadowRoot) {
              walk(node.shadowRoot);
            }
          }
          const children = node instanceof Document || node instanceof ShadowRoot || node instanceof Element
            ? node.children
            : undefined;
          if (children) {
            for (const child of children) {
              walk(child);
            }
          }
        };
        walk(root);
        return out;
      };

      const queryCssDeepAll = (root, selector) => {
        if (!selector) return null;
        const matches = [];
        const seen = new Set();
        const push = (element) => {
          if (!element || seen.has(element)) return;
          seen.add(element);
          matches.push(element);
        };
        if (!includeShadowDom) {
          try {
            for (const element of root.querySelectorAll(selector)) {
              push(element);
            }
            const first = root.querySelector(selector);
            if (first) {
              push(first);
            }
          } catch {
            // invalid selector
          }
          return matches;
        }
        const all = collectElements(root);
        for (const candidate of all) {
          if (candidate.matches) {
            try {
              if (candidate.matches(selector)) {
                push(candidate);
              }
            } catch {
              // invalid selector
            }
          }
        }
        return matches;
      };

      const queryByText = (root, text) => {
        if (!text) return null;
        const all = collectElements(root);
        for (const element of all) {
          const rendered = element instanceof HTMLElement ? element.innerText : element.textContent;
          if (textMatches(rendered ?? "", text)) {
            return [element];
          }
        }
        return [];
      };

      const queryByLabel = (root, labelText) => {
        if (!labelText) return null;
        const labels = root.querySelectorAll("label");
        for (const label of labels) {
          const rendered = label instanceof HTMLElement ? label.innerText : label.textContent;
          if (!textMatches(rendered ?? "", labelText)) {
            continue;
          }
          const htmlFor = label.getAttribute("for");
          if (htmlFor) {
            const byID = root.getElementById ? root.getElementById(htmlFor) : root.querySelector("#" + cssEscape(htmlFor));
            if (byID) return [byID];
          }
          const nested = label.querySelector("input, textarea, select, [contenteditable='true']");
          if (nested) return [nested];
        }
        return [];
      };

      const roleTagMatches = (element, role) => {
        const tag = element.tagName.toLowerCase();
        if (role === "button") return tag === "button";
        if (role === "link") return tag === "a";
        if (role === "textbox") return tag === "input" || tag === "textarea";
        if (role === "checkbox") return tag === "input" && element.getAttribute("type") === "checkbox";
        return false;
      };

      const queryByRole = (root, role, name) => {
        if (!role) return null;
        const all = collectElements(root);
        for (const element of all) {
          const attrRole = (element.getAttribute("role") || "").toLowerCase();
          const matchesRole = attrRole === role.toLowerCase() || roleTagMatches(element, role.toLowerCase());
          if (!matchesRole) continue;
          if (!name) return [element];
          const ariaLabel = element.getAttribute("aria-label") || "";
          const rendered = element instanceof HTMLElement ? element.innerText : element.textContent;
          const accessibleName = normalize(ariaLabel || rendered || "");
          if (textMatches(accessibleName, name)) {
            return [element];
          }
        }
        return [];
      };

      const toHintCandidates = () => {
        const explicit = dedupe([
          locator.name,
          locator.label,
          locator.text,
          locator.selector,
          ...(Array.isArray(locator.selectors) ? locator.selectors : []),
        ]);
        const hints = [];
        for (const value of explicit) {
          hints.push(value);
          const tokenized = value
            .replace(/[>+~*\\[\\]().,:#'"=]/g, " ")
            .replace(/\\s+/g, " ")
            .trim();
          if (tokenized.length > 0) {
            hints.push(tokenized);
          }
        }
        return dedupe(hints);
      };

      const buildFallbackSelectors = (hints) => {
        const candidates = [];
        for (const hint of hints) {
          const shortHint = hint.length > 80 ? hint.slice(0, 80) : hint;
          const escapedHint = cssEscape(shortHint);
          candidates.push("[data-testid='" + escapedHint + "']");
          candidates.push("[data-test='" + escapedHint + "']");
          candidates.push("[data-qa='" + escapedHint + "']");
          candidates.push("[name='" + escapedHint + "']");
          candidates.push("[id='" + escapedHint + "']");
          if (!shortHint.includes(" ")) {
            candidates.push("#" + escapedHint);
          }
          candidates.push("[aria-label*='" + escapedHint + "' i]");
          candidates.push("[title*='" + escapedHint + "' i]");
        }
        return dedupe(candidates);
      };

      const scoreElement = (element, hints) => {
        if (!(element instanceof HTMLElement)) {
          return -1000;
        }
        let score = 0;
        if (isElementVisible(element)) {
          score += 25;
        }
        const tag = element.tagName.toLowerCase();
        if (tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable) {
          score += 12;
        }
        if (element.hasAttribute("disabled")) {
          score -= 20;
        }
        const role = normalize(element.getAttribute("role"));
        if (role === "button" || role === "link" || role === "textbox") {
          score += 8;
        }
        const rendered = normalize(element.innerText || element.textContent || "");
        const aria = normalize(element.getAttribute("aria-label"));
        const title = normalize(element.getAttribute("title"));
        const id = normalize(element.id);
        const name = normalize(element.getAttribute("name"));
        const testid = normalize(element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("data-qa"));
        for (const hint of hints) {
          const hintNorm = normalize(hint);
          if (!hintNorm) continue;
          if (textMatches(rendered, hintNorm)) score += 32;
          if (textMatches(aria, hintNorm)) score += 40;
          if (textMatches(title, hintNorm)) score += 16;
          if (textMatches(name, hintNorm)) score += 20;
          if (textMatches(testid, hintNorm)) score += 26;
          if (textMatches(id, hintNorm)) score += 14;
        }
        return score;
      };

      const chooseBestCandidate = (candidates, hints) => {
        let best = null;
        let bestScore = -10000;
        for (const candidate of candidates) {
          if (!(candidate instanceof HTMLElement)) {
            continue;
          }
          const score = scoreElement(candidate, hints);
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
        return best;
      };

      const resolveRoot = () => {
        if (!locator.frameSelector) return document;
        const iframe = document.querySelector(locator.frameSelector);
        if (!(iframe instanceof HTMLIFrameElement)) return document;
        try {
          return iframe.contentDocument || document;
        } catch {
          return document;
        }
      };

      const root = resolveRoot();
      const selectors = Array.isArray(locator.selectors) ? locator.selectors.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
      if (locator.selector && !selectors.includes(locator.selector)) {
        selectors.unshift(locator.selector);
      }
      const hintCandidates = toHintCandidates();
      const fallbackSelectors = buildFallbackSelectors(hintCandidates);
      for (const fallbackSelector of fallbackSelectors) {
        if (!selectors.includes(fallbackSelector)) {
          selectors.push(fallbackSelector);
        }
      }

      const strategyList = [];
      for (const selector of selectors) {
        strategyList.push({ type: "css", value: selector });
      }
      if (locator.text) {
        strategyList.push({ type: "text", value: locator.text });
      }
      if (locator.label) {
        strategyList.push({ type: "label", value: locator.label });
      }
      if (locator.role) {
        strategyList.push({ type: "role", role: locator.role, name: locator.name });
      }

      if (strategyList.length === 0) {
        strategyList.push({ type: "css", value: "body" });
      }

      let element = null;
      let strategyUsed = null;
      for (const strategy of strategyList) {
        let matches = [];
        if (strategy.type === "css") {
          matches = queryCssDeepAll(root, strategy.value) ?? [];
        } else if (strategy.type === "text") {
          matches = queryByText(root, strategy.value) ?? [];
        } else if (strategy.type === "label") {
          matches = queryByLabel(root, strategy.value) ?? [];
        } else if (strategy.type === "role") {
          matches = queryByRole(root, strategy.role, strategy.name) ?? [];
        }
        element = chooseBestCandidate(matches, hintCandidates);
        if (element) {
          strategyUsed = strategy;
          break;
        }
      }

      if (!element && hintCandidates.length > 0) {
        const all = collectElements(root);
        element = chooseBestCandidate(all, hintCandidates);
        if (element) {
          strategyUsed = { type: "heuristic", value: hintCandidates[0] };
        }
      }

      const visible = isElementVisible(element);
      const strategyLabel = strategyUsed
        ? strategyUsed.type + ":" + (strategyUsed.value || strategyUsed.role || "")
        : undefined;

      if (mode === "inspect") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }
      if (mode === "exists") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }
      if (mode === "visible") {
        return {
          ok: true,
          found: Boolean(element),
          visible,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
        };
      }

      const extractFallbackText = () => {
        const limit = typeof options.maxLength === "number" && Number.isFinite(options.maxLength) && options.maxLength > 0
          ? Math.floor(options.maxLength)
          : 200000;
        const body = document.body;
        const raw = body ? (body.innerText || body.textContent || "") : "";
        return String(raw).slice(0, limit);
      };

      if (!(element instanceof HTMLElement)) {
        if (mode === "extract_text") {
          return {
            ok: true,
            text: extractFallbackText(),
            selectorUsed: "body",
            strategyUsed: strategyLabel || "body_fallback",
            visible: true,
            fallback: true,
          };
        }
        return { ok: false, error: "selector_not_found" };
      }

      element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
      if (mode === "click") {
        if (!visible) {
          const rectHidden = element.getBoundingClientRect();
          if (rectHidden.width <= 0 || rectHidden.height <= 0) {
            return { ok: false, error: "element_not_visible" };
          }
        }
        if (element instanceof HTMLButtonElement && element.disabled) {
          return { ok: false, error: "element_disabled" };
        }
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        try {
          element.focus({ preventScroll: true });
        } catch {
          // ignore focus failures
        }
        const fireMouseEvent = (type) => {
          element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: centerX,
            clientY: centerY,
          }));
        };
        fireMouseEvent("pointerdown");
        fireMouseEvent("mousedown");
        fireMouseEvent("pointerup");
        fireMouseEvent("mouseup");
        if (typeof element.click === "function") {
          element.click();
        }
        fireMouseEvent("click");
        return {
          ok: true,
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
          visible,
        };
      }

      if (mode === "type") {
        const value = toStringSafe(options.text);
        const shouldClear = options.clear !== false;
        element.focus();
        const emitInputEvents = (target) => {
          try {
            target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
          } catch {
            // InputEvent not supported in some environments
          }
          target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        };
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          if (shouldClear) {
            element.value = "";
          }
          element.value += value;
          emitInputEvents(element);
          return {
            ok: true,
            typed: value.length,
            selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
            strategyUsed: strategyLabel,
            visible,
          };
        }
        if (element.isContentEditable) {
          if (shouldClear) {
            element.textContent = "";
          }
          element.textContent = (element.textContent ?? "") + value;
          emitInputEvents(element);
          return {
            ok: true,
            typed: value.length,
            selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
            strategyUsed: strategyLabel,
            visible,
          };
        }
        return { ok: false, error: "unsupported_element" };
      }

      if (mode === "extract_text") {
        const limit = typeof options.maxLength === "number" && Number.isFinite(options.maxLength) && options.maxLength > 0
          ? Math.floor(options.maxLength)
          : 200000;
        const raw = element.innerText || element.textContent || "";
        return {
          ok: true,
          text: String(raw).slice(0, limit),
          selectorUsed: strategyUsed && strategyUsed.value ? strategyUsed.value : locator.selector,
          strategyUsed: strategyLabel,
          visible,
        };
      }

      return { ok: false, error: "unsupported_mode" };
    })();`;
}

export function buildPressScript(key: string): string {
  return `(() => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      const down = new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true });
      const up = new KeyboardEvent("keyup", { key: ${JSON.stringify(key)}, bubbles: true });
      target.dispatchEvent(down);
      target.dispatchEvent(up);
      if (${JSON.stringify(key)} === "Enter" && target instanceof HTMLInputElement && target.form) {
        target.form.requestSubmit();
      }
      return { ok: true };
    })();`;
}

export function buildScrollScript(
  x?: number,
  y?: number,
  top?: number,
  left?: number,
  behavior?: "auto" | "smooth",
): string {
  return `(() => {
      const scrollBehavior = ${JSON.stringify(behavior ?? "auto")};
      const hasAbsolute = ${JSON.stringify(typeof top === "number" || typeof left === "number")};
      if (hasAbsolute) {
        window.scrollTo({
          top: ${JSON.stringify(typeof top === "number" ? top : 0)},
          left: ${JSON.stringify(typeof left === "number" ? left : 0)},
          behavior: scrollBehavior,
        });
      } else {
        window.scrollBy({
          top: ${JSON.stringify(typeof y === "number" ? y : 0)},
          left: ${JSON.stringify(typeof x === "number" ? x : 0)},
          behavior: scrollBehavior,
        });
      }
      return { ok: true };
    })();`;
}
