// The deliberate do-nothing callbacks.
//
// Named, because `.catch(() => {})` scattered through a file is
// indistinguishable from an empty block somebody forgot to fill in. Spelling
// the intent out means a reader — and the linter — can tell the difference.

// An empty body is this function's entire purpose, and this is the one place
// in the codebase where it should appear.
// biome-ignore lint/suspicious/noEmptyBlockStatements: see above
export const noop = (): void => {};

/** `.catch(ignoreError)` — a best-effort call whose failure is, deliberately,
 * not the caller's problem. Use it only where there is genuinely nothing to
 * do about the error and nothing depending on the result. */
export const ignoreError = noop;
