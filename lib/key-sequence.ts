/** Matches a key sequence against the last keys pressed: ["G", "E"] or ["C"]. "⇧T" needs Shift. */
export function matchSequence(sequence: string[], pressed: string[]) {
  if (!sequence.length || sequence.length > pressed.length) return false;
  const tail = pressed.slice(pressed.length - sequence.length);
  return sequence.every((key, index) => key.startsWith("⇧") ? tail[index] === key.slice(1).toUpperCase() : key.toLowerCase() === tail[index].toLowerCase());
}

type Keyed = { keys?: string[]; disabled?: boolean };

/**
 * The command the pressed keys run, if any. Longer sequences win, so G then S
 * is not also read as S. A single key right after the first key of a sequence
 * is left alone, so G then K never runs K.
 */
export function commandForKeys<T extends Keyed>(commands: T[], pressed: string[]): T | undefined {
  const match = commands
    .filter((command) => command.keys && !command.disabled && matchSequence(command.keys, pressed))
    .sort((a, b) => (b.keys?.length ?? 0) - (a.keys?.length ?? 0))[0];
  if (!match?.keys) return undefined;
  const previous = pressed.at(-2)?.toLowerCase();
  const startsSequence = previous !== undefined && commands.some((command) => command.keys && command.keys.length > 1 && command.keys[0].toLowerCase() === previous);
  if (match.keys.length === 1 && pressed.length > 1 && startsSequence) return undefined;
  return match;
}
