export function resolveClaudeUserInputResponse(
  response: string,
  requestedSchema: unknown
): {
  action: 'accept' | 'cancel'
  content?: Record<string, unknown>
} {
  if (response.trim().length === 0) {
    return { action: 'cancel' }
  }

  const firstField =
    requestedSchema && typeof requestedSchema === 'object' && !Array.isArray(requestedSchema)
      ? Object.keys(
          (requestedSchema as { properties?: Record<string, unknown> }).properties ?? {}
        )[0]
      : undefined

  let content: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(response) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      content = parsed as Record<string, unknown>
    }
  } catch {
    content = firstField ? { [firstField]: response } : { value: response }
  }

  return {
    action: 'accept',
    ...(content ? { content } : {}),
  }
}
