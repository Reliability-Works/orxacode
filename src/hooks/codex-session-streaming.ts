import type { MutableRefObject } from "react";

type RefValue<T> = MutableRefObject<T>;

type StreamingRefs = {
  streamingItemIdRef: RefValue<string | null>;
  thinkingItemIdRef: RefValue<string | null>;
  activeTurnIdRef: RefValue<string | null>;
  codexItemToMsgId: RefValue<Map<string, string>>;
};

export function nextMessageID(prefix: string, messageCounterRef: RefValue<number>): string {
  const id = `${prefix}-${messageCounterRef.current}`;
  messageCounterRef.current += 1;
  return id;
}

export function resetStreamingBookkeeping(refs: StreamingRefs) {
  refs.streamingItemIdRef.current = null;
  refs.thinkingItemIdRef.current = null;
  refs.activeTurnIdRef.current = null;
  refs.codexItemToMsgId.current.clear();
}
