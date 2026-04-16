import * as Effect from 'effect/Effect'
import { NetService } from '@orxa-code/shared/Net'

export const DEFAULT_DESKTOP_BACKEND_PORT = 3773

export function resolveDesktopBackendPort(env: NodeJS.ProcessEnv = process.env): number {
  const rawValue = env.ORXA_DESKTOP_BACKEND_PORT?.trim()
  if (!rawValue) {
    return DEFAULT_DESKTOP_BACKEND_PORT
  }

  const parsed = Number(rawValue)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `Invalid ORXA_DESKTOP_BACKEND_PORT "${rawValue}". Expected an integer between 1 and 65535.`
    )
  }

  return parsed
}

export function checkDesktopBackendPortAvailability(port: number): Promise<boolean> {
  return Effect.service(NetService).pipe(
    Effect.flatMap(net => net.isPortAvailableOnLoopback(port)),
    Effect.provide(NetService.layer),
    Effect.runPromise
  )
}

export async function ensureDesktopBackendPortAvailable(
  port: number,
  checkAvailability: (port: number) => Promise<boolean> = checkDesktopBackendPortAvailability
): Promise<void> {
  const isAvailable = await checkAvailability(port)
  if (isAvailable) {
    return
  }

  throw new Error(
    `Desktop backend port ${port} is already in use on loopback. Stop the conflicting process or set ORXA_DESKTOP_BACKEND_PORT to a different fixed port.`
  )
}
