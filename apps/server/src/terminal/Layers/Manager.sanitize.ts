function isCsiFinalByte(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e
}

function shouldStripCsiSequence(body: string, finalByte: string): boolean {
  if (finalByte === 'n') {
    return true
  }
  if (finalByte === 'R' && /^[0-9;?]*$/.test(body)) {
    return true
  }
  if (finalByte === 'c' && /^[>0-9;?]*$/.test(body)) {
    return true
  }
  return false
}

function shouldStripOscSequence(content: string): boolean {
  return /^(10|11|12);(?:\?|rgb:)/.test(content)
}

function stripStringTerminator(value: string): string {
  if (value.endsWith('\u001b\\')) {
    return value.slice(0, -2)
  }
  const lastCharacter = value.at(-1)
  if (lastCharacter === '\u0007' || lastCharacter === '\u009c') {
    return value.slice(0, -1)
  }
  return value
}

function findStringTerminatorIndex(input: string, start: number): number | null {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index)
    if (codePoint === 0x07 || codePoint === 0x9c) {
      return index + 1
    }
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) {
      return index + 2
    }
  }
  return null
}

function isEscapeIntermediateByte(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x2f
}

function isEscapeFinalByte(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x7e
}

function findEscapeSequenceEndIndex(input: string, start: number): number | null {
  let cursor = start
  while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) {
    cursor += 1
  }
  if (cursor >= input.length) {
    return null
  }
  return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1
}

type ParsedCsiSequence = {
  sequence: string
  body: string
  nextIndex: number
}

function readCsiSequence(
  input: string,
  sequenceStart: number,
  bodyStart: number
): ParsedCsiSequence | null {
  let cursor = bodyStart
  while (cursor < input.length) {
    if (isCsiFinalByte(input.charCodeAt(cursor))) {
      return {
        sequence: input.slice(sequenceStart, cursor + 1),
        body: input.slice(bodyStart, cursor),
        nextIndex: cursor + 1,
      }
    }
    cursor += 1
  }
  return null
}

type ParsedStringControlSequence = {
  sequence: string
  content: string
  nextIndex: number
}

function readStringControlSequence(
  input: string,
  sequenceStart: number,
  contentStart: number
): ParsedStringControlSequence | null {
  const terminatorIndex = findStringTerminatorIndex(input, contentStart)
  if (terminatorIndex === null) {
    return null
  }
  return {
    sequence: input.slice(sequenceStart, terminatorIndex),
    content: stripStringTerminator(input.slice(contentStart, terminatorIndex)),
    nextIndex: terminatorIndex,
  }
}

type ParsedSanitizedControlSequence =
  | { appendText: string; nextIndex: number; pendingControlSequence: null }
  | { appendText: ''; nextIndex: number; pendingControlSequence: string }

function pendingFromIndex(input: string, index: number): ParsedSanitizedControlSequence {
  return { appendText: '', nextIndex: index, pendingControlSequence: input.slice(index) }
}

function parseCsiAt(
  input: string,
  index: number,
  bodyStart: number
): ParsedSanitizedControlSequence {
  const parsed = readCsiSequence(input, index, bodyStart)
  if (!parsed) {
    return pendingFromIndex(input, index)
  }
  return {
    appendText: shouldStripCsiSequence(parsed.body, input[parsed.nextIndex - 1] ?? '')
      ? ''
      : parsed.sequence,
    nextIndex: parsed.nextIndex,
    pendingControlSequence: null,
  }
}

function parseStringControlAt(
  input: string,
  index: number,
  contentStart: number,
  isOsc: boolean
): ParsedSanitizedControlSequence {
  const parsed = readStringControlSequence(input, index, contentStart)
  if (!parsed) {
    return pendingFromIndex(input, index)
  }
  return {
    appendText: !isOsc || !shouldStripOscSequence(parsed.content) ? parsed.sequence : '',
    nextIndex: parsed.nextIndex,
    pendingControlSequence: null,
  }
}

function parseEscControlSequence(input: string, index: number): ParsedSanitizedControlSequence {
  const nextCodePoint = input.charCodeAt(index + 1)
  if (Number.isNaN(nextCodePoint)) {
    return pendingFromIndex(input, index)
  }

  if (nextCodePoint === 0x5b) {
    return parseCsiAt(input, index, index + 2)
  }

  if (
    nextCodePoint === 0x5d ||
    nextCodePoint === 0x50 ||
    nextCodePoint === 0x5e ||
    nextCodePoint === 0x5f
  ) {
    return parseStringControlAt(input, index, index + 2, nextCodePoint === 0x5d)
  }

  const escapeSequenceEndIndex = findEscapeSequenceEndIndex(input, index + 1)
  if (escapeSequenceEndIndex === null) {
    return pendingFromIndex(input, index)
  }
  return {
    appendText: input.slice(index, escapeSequenceEndIndex),
    nextIndex: escapeSequenceEndIndex,
    pendingControlSequence: null,
  }
}

function parseC1ControlSequence(
  input: string,
  index: number,
  codePoint: number
): ParsedSanitizedControlSequence | null {
  if (codePoint === 0x9b) {
    return parseCsiAt(input, index, index + 1)
  }

  if (codePoint === 0x9d || codePoint === 0x90 || codePoint === 0x9e || codePoint === 0x9f) {
    return parseStringControlAt(input, index, index + 1, codePoint === 0x9d)
  }

  return null
}

export function sanitizeTerminalHistoryChunk(
  pendingControlSequence: string,
  data: string
): { visibleText: string; pendingControlSequence: string } {
  const input = `${pendingControlSequence}${data}`
  let visibleText = ''
  let index = 0

  const append = (value: string) => {
    visibleText += value
  }

  while (index < input.length) {
    const codePoint = input.charCodeAt(index)

    if (codePoint === 0x1b) {
      const parsed = parseEscControlSequence(input, index)
      if (parsed.pendingControlSequence !== null) {
        return { visibleText, pendingControlSequence: parsed.pendingControlSequence }
      }
      append(parsed.appendText)
      index = parsed.nextIndex
      continue
    }

    const parsedC1 = parseC1ControlSequence(input, index, codePoint)
    if (parsedC1) {
      if (parsedC1.pendingControlSequence !== null) {
        return { visibleText, pendingControlSequence: parsedC1.pendingControlSequence }
      }
      append(parsedC1.appendText)
      index = parsedC1.nextIndex
      continue
    }

    append(input[index] ?? '')
    index += 1
  }

  return { visibleText, pendingControlSequence: '' }
}
