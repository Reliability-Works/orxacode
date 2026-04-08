import { Effect, FileSystem, PlatformError, Scope } from 'effect'

export function makeTempDirectoryScoped(
  prefix: string
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    return yield* fileSystem.makeTempDirectoryScoped({ prefix })
  })
}
