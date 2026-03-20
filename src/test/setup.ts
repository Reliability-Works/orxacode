import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  const gradientStub = { addColorStop: vi.fn() };
  const contextBase = {
    canvas: null as HTMLCanvasElement | null,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    createLinearGradient: vi.fn(() => gradientStub),
    createRadialGradient: vi.fn(() => gradientStub),
    createPattern: vi.fn(() => null),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(function getContext(this: HTMLCanvasElement) {
      const cache = new Map<PropertyKey, unknown>();
      return new Proxy({ ...contextBase, canvas: this }, {
        get(target, prop) {
          if (prop in target) {
            return target[prop as keyof typeof target];
          }
          if (!cache.has(prop)) {
            cache.set(prop, vi.fn());
          }
          return cache.get(prop);
        },
      });
    }),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
