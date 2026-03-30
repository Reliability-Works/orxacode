export function preferredAgentForMode(params: {
  hasPlanAgent: boolean
  serverAgentNames: Set<string>
  firstAgentName?: string
}) {
  const { hasPlanAgent, serverAgentNames, firstAgentName } = params
  if (serverAgentNames.has('build')) {
    return 'build'
  }
  const firstNonPlan =
    firstAgentName !== 'plan' ? firstAgentName : [...serverAgentNames].find(n => n !== 'plan')
  return firstNonPlan ?? (hasPlanAgent ? 'plan' : undefined)
}
