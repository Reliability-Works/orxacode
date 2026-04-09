const ENABLE_INSPECT_SCRIPT = `(() => {
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
        text: el.textContent ? el.textContent.trim().slice(0, 400) : null,
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

export function buildInspectEnableScript(): string {
  return ENABLE_INSPECT_SCRIPT
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
