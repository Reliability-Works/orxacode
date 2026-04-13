let activeEnvironmentHttpOrigin: string | null = null

export function setActiveEnvironmentHttpOrigin(origin: string | null) {
  activeEnvironmentHttpOrigin = origin
}

export function getActiveEnvironmentHttpOrigin() {
  return activeEnvironmentHttpOrigin
}
