export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf('/')
  if (slashIndex === -1) return pathValue
  return pathValue.slice(slashIndex + 1)
}

export function extensionCandidates(fileName: string): string[] {
  const candidates = new Set<string>()
  if (fileName.includes('.')) {
    candidates.add(fileName)
  }
  let dotIndex = fileName.indexOf('.')
  while (dotIndex !== -1 && dotIndex < fileName.length - 1) {
    const candidate = fileName.slice(dotIndex + 1)
    if (candidate.length > 0) {
      candidates.add(candidate)
    }
    dotIndex = fileName.indexOf('.', dotIndex + 1)
  }
  return [...candidates]
}
