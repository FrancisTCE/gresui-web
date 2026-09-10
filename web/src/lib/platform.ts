// Platform sniffing, for the one thing it is still legitimate for: telling the
// user which modifier key to press.

/** True on macOS, where the command key stands in for Ctrl in shortcuts. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  // userAgentData is the supported route; the platform string is the fallback
  // that still works in Safari and Firefox.
  const data = (
    navigator as Navigator & {
      userAgentData?: { platform?: string };
    }
  ).userAgentData;
  const platform = data?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/** The Ctrl-or-Cmd modifier for the current platform, as a keyboard event flag. */
export function isModifier(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/** Display form of that modifier: "⌘" on macOS, "Ctrl" elsewhere. */
export function modKeyLabel(): string {
  return isMac() ? "⌘" : "Ctrl";
}
