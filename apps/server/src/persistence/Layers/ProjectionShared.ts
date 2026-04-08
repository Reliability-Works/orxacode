import { Effect, Option } from 'effect'

/**
 * Wraps an Option result so that the inner value is returned via Option.some
 * (passed through unchanged), preserving the existing Option-shaped contract
 * used by projection repository getters.
 */
export const passThroughOptionalRow = <T>(
  rowOption: Option.Option<T>
): Effect.Effect<Option.Option<T>> =>
  Option.match(rowOption, {
    onNone: () => Effect.succeed(Option.none<T>()),
    onSome: row => Effect.succeed(Option.some(row)),
  })
