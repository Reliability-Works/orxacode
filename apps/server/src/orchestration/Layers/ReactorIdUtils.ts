/**
 * Tiny shared id helpers used across reactor / ingestion modules.
 */

export function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false
  }
  return left === right
}
