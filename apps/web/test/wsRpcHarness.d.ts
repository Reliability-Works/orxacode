type BrowserWsClient = {
  send: (data: string) => void
}
export type NormalizedWsRpcRequestBody = {
  _tag: string
  [key: string]: unknown
}
type UnaryResolverResult = unknown | Promise<unknown>
interface BrowserWsRpcHarnessOptions {
  readonly resolveUnary?: (request: NormalizedWsRpcRequestBody) => UnaryResolverResult
  readonly getInitialStreamValues?: (
    request: NormalizedWsRpcRequestBody
  ) => ReadonlyArray<unknown> | undefined
}
export declare class BrowserWsRpcHarness {
  readonly requests: Array<NormalizedWsRpcRequestBody>
  private readonly parser
  private client
  private scope
  private serverReady
  private resolveUnary
  private getInitialStreamValues
  private streamPubSubs
  reset(options?: BrowserWsRpcHarnessOptions): Promise<void>
  connect(client: BrowserWsClient): void
  disconnect(): Promise<void>
  private initializeStreamPubSubs
  onMessage(rawData: string): Promise<void>
  emitStreamValue(method: string, value: unknown): void
  private makeLayer
  private makeServerOptions
  private handleUnary
  private handleStream
}
export {}
