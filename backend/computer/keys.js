// Parses key combos like "ctrl+shift+s" or "enter" into nut-js Key values. Unknown names are rejected, never guessed.
const ALIASES = {
  ctrl: "LeftControl", control: "LeftControl", alt: "LeftAlt", shift: "LeftShift",
  win: "LeftWin", windows: "LeftWin", super: "LeftWin", meta: "LeftWin", cmd: "LeftSuper", command: "LeftSuper",
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: "Space",
  backspace: "Backspace", delete: "Delete", del: "Delete", insert: "Insert",
  up: "Up", down: "Down", left: "Left", right: "Right", home: "Home", end: "End",
  pageup: "PageUp", pagedown: "PageDown", printscreen: "Print",
};
const MODIFIERS = new Set(["ctrl", "control", "alt", "shift", "win", "windows", "super", "meta", "cmd", "command"]);

/** Canonical lowercase names for a combo, e.g. "Ctrl + S" -> ["ctrl","s"]. Throws on anything unknown. */
export function parseCombo(combo) {
  const parts = String(combo).toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Empty key combination.");
  if (parts.length > 4) throw new Error("At most 4 keys can be pressed together.");
  for (const p of parts) {
    const known = ALIASES[p] || /^[a-z0-9]$/.test(p) || /^f([1-9]|1[0-2])$/.test(p);
    if (!known) throw new Error(`Unknown key '${p}'. Use names like ctrl, alt, shift, win, enter, esc, tab, space, up, f5, or a single letter/digit.`);
  }
  const nonMods = parts.filter((p) => !MODIFIERS.has(p));
  if (nonMods.length > 1) throw new Error("A combination can contain at most one non-modifier key (e.g. ctrl+shift+s).");
  return parts;
}

/** Map canonical names to nut-js Key enum members. */
export function toNutKeys(parts, Key) {
  return parts.map((p) => {
    const name = ALIASES[p] || (/^[a-z]$/.test(p) ? p.toUpperCase() : /^[0-9]$/.test(p) ? `Num${p}` : p.toUpperCase());
    if (Key[name] === undefined) throw new Error(`Key '${p}' is not supported on this system.`);
    return Key[name];
  });
}

// Combos that would let the agent run arbitrary commands or lock/sign out the user are never sent.
const BLOCKED = [["win", "r"], ["win", "x"], ["win", "l"], ["ctrl", "alt", "delete"]];
export function isBlockedCombo(parts) {
  const norm = parts.map((p) => ({ windows: "win", super: "win", meta: "win", control: "ctrl", del: "delete" })[p] || p);
  return BLOCKED.some((b) => b.length === norm.length && b.every((k) => norm.includes(k)));
}
