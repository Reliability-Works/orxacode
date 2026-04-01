export type BrowserRecoveryStep = 'dismiss_overlays' | 'stabilize'
export type { BrowserInteractionMode, BrowserInteractionOptions } from './browser-dom-interaction-script'
export { buildInteractionScript } from './browser-dom-interaction-script'

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
    })();`
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
    })();`
}

export function buildScrollScript(
  x?: number,
  y?: number,
  top?: number,
  left?: number,
  behavior?: 'auto' | 'smooth'
): string {
  return `(() => {
      const scrollBehavior = ${JSON.stringify(behavior ?? 'auto')};
      const hasAbsolute = ${JSON.stringify(typeof top === 'number' || typeof left === 'number')};
      if (hasAbsolute) {
        window.scrollTo({
          top: ${JSON.stringify(typeof top === 'number' ? top : 0)},
          left: ${JSON.stringify(typeof left === 'number' ? left : 0)},
          behavior: scrollBehavior,
        });
      } else {
        window.scrollBy({
          top: ${JSON.stringify(typeof y === 'number' ? y : 0)},
          left: ${JSON.stringify(typeof x === 'number' ? x : 0)},
          behavior: scrollBehavior,
        });
      }
      return { ok: true };
    })();`
}

/**
 * Script injected into the browser webContents to enable element inspection.
 * Highlights elements on hover. Click data is stored on window and polled.
 */
export function buildInspectEnableScript(): string {
  return `(() => {
    if (window.__orxaInspectActive) return { ok: true, alreadyActive: true };
    window.__orxaInspectActive = true;

    const overlay = document.createElement("div");
    overlay.id = "__orxa-inspect-overlay";
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #22C55E;background:rgba(34,197,94,0.08);display:none;transition:all 60ms ease;border-radius:3px;";
    document.body.appendChild(overlay);

    const label = document.createElement("div");
    label.id = "__orxa-inspect-label";
    label.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;background:#22C55E;color:#000;font:11px/1.3 monospace;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis;";
    document.body.appendChild(label);

    function getSelector(el) {
      const parts = [];
      let cur = el;
      for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
        if (cur.id) { parts.unshift("#" + CSS.escape(cur.id)); break; }
        let seg = cur.tagName.toLowerCase();
        const meaningful = Array.from(cur.classList).filter(c => !/^[a-z0-9]{5,}$/i.test(c) && c.length < 30).slice(0, 2);
        if (meaningful.length) seg += "." + meaningful.map(c => CSS.escape(c)).join(".");
        parts.unshift(seg);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }

    function identifyEl(el) {
      const tag = el.tagName.toLowerCase();
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return tag + ' "' + ariaLabel.slice(0, 40) + '"';
      const text = (el.textContent || "").trim().slice(0, 40);
      if (tag === "button" || tag === "a") return tag + (text ? ' "' + text + '"' : "");
      if (tag === "input") return "input[" + (el.type || "text") + "]" + (el.placeholder ? ' "' + el.placeholder.slice(0, 30) + '"' : "");
      if (tag === "img") return "img" + (el.alt ? ' "' + el.alt.slice(0, 30) + '"' : "");
      if (/^h[1-6]$/.test(tag)) return tag + (text ? ' "' + text + '"' : "");
      return tag + (text ? ' "' + text.slice(0, 30) + '"' : "");
    }

    function handleMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === label || el === document.body || el === document.documentElement) {
        overlay.style.display = "none";
        label.style.display = "none";
        return;
      }
      const rect = el.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.left = rect.left + "px";
      overlay.style.top = rect.top + "px";
      overlay.style.width = rect.width + "px";
      overlay.style.height = rect.height + "px";
      label.style.display = "block";
      label.textContent = identifyEl(el) + "  " + getSelector(el);
      label.style.left = Math.min(rect.left, window.innerWidth - 300) + "px";
      label.style.top = Math.max(0, rect.top - 22) + "px";
    }

    function handleClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === label) return;
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      window.__orxaInspectLastAnnotation = {
        element: identifyEl(el),
        selector: getSelector(el),
        boundingBox: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        computedStyles: "color:" + styles.color + ";bg:" + styles.backgroundColor + ";font:" + styles.fontSize + " " + styles.fontFamily.split(",")[0],
      };
    }

    document.addEventListener("mousemove", handleMove, true);
    document.addEventListener("click", handleClick, true);
    window.__orxaInspectCleanup = () => {
      document.removeEventListener("mousemove", handleMove, true);
      document.removeEventListener("click", handleClick, true);
      overlay.remove();
      label.remove();
      delete window.__orxaInspectActive;
      delete window.__orxaInspectCleanup;
      delete window.__orxaInspectLastAnnotation;
    };
    return { ok: true };
  })();`
}

export function buildInspectDisableScript(): string {
  return `(() => {
    if (typeof window.__orxaInspectCleanup === "function") {
      window.__orxaInspectCleanup();
      return { ok: true };
    }
    return { ok: false, error: "inspect not active" };
  })();`
}

export function buildInspectGetAnnotationScript(): string {
  return `(() => {
    const a = window.__orxaInspectLastAnnotation;
    window.__orxaInspectLastAnnotation = null;
    return a || null;
  })();`
}
