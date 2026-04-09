import type { DesktopBrowserBounds } from '@orxa-code/contracts'

export const DEFAULT_URL = 'about:blank'

export function normalizeBrowserUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed === DEFAULT_URL) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
    } catch {
      return null
    }
  }
}

export function getFallbackTitle(url: string): string {
  if (!url || url === DEFAULT_URL) {
    return 'New Tab'
  }
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}

export function buildInspectScript(localX: number, localY: number): string {
  return `
(() => {
  const x = ${localX};
  const y = ${localY};
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const tagName = element.tagName ? element.tagName.toLowerCase() : 'element';
  const idPart = element.id ? \`#\${element.id}\` : '';
  const classPart =
    typeof element.className === 'string' && element.className.trim()
      ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.')
      : '';
  const selector = \`\${tagName}\${idPart}\${classPart}\`.slice(0, 200) || tagName;
  const styles = window.getComputedStyle(element);
  return {
    element: (element.getAttribute('aria-label') || element.textContent || tagName).trim().slice(0, 200) || tagName,
    selector,
    text: element.textContent ? element.textContent.trim().slice(0, 400) : null,
    boundingBox: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    computedStyles: \`display: \${styles.display}; position: \${styles.position}; color: \${styles.color}; background: \${styles.backgroundColor}; font: \${styles.fontSize} \${styles.fontFamily};\`,
  };
})()
`.trim()
}

export function normalizeAnnotationCandidate(
  raw: {
    element?: unknown
    selector?: unknown
    text?: unknown
    boundingBox?: Partial<DesktopBrowserBounds> | null
    computedStyles?: unknown
  } | null
) {
  if (!raw) {
    return null
  }
  return {
    element: String(raw.element ?? 'element'),
    selector: String(raw.selector ?? 'element'),
    text: raw.text ? String(raw.text) : null,
    boundingBox: raw.boundingBox
      ? {
          x: Math.max(0, Math.floor(raw.boundingBox.x ?? 0)),
          y: Math.max(0, Math.floor(raw.boundingBox.y ?? 0)),
          width: Math.max(0, Math.floor(raw.boundingBox.width ?? 0)),
          height: Math.max(0, Math.floor(raw.boundingBox.height ?? 0)),
        }
      : null,
    computedStyles: raw.computedStyles ? String(raw.computedStyles) : null,
  }
}
