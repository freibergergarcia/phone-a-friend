// Every color the mod draws, named for what it means. No other file names a
// color: `tests/paf-tasks-mod.test.ts` in the repository refuses one.
//
// Why one place. The pane is opened with a transparent background (PANE_OPEN in
// register.tsx), so uncolored text and what is behind it are both the
// terminal's own and always readable. Everything named here is drawn on that
// background, whatever it is:
//
// - A theme key follows the person's Claude Code theme, so a light theme and
//   the colorblind themes get their own colors.
// - `inverse` is not used. It takes the text color from the terminal's
//   background, so a label came out white on yellow when the theme was dark and
//   the terminal light. A solid label names both of its colors instead:
//   LABEL_TEXT on one of the colors below.

// Secondary text: places, ages, counts.
export const SUBTLE = 'inactive'
// What is running. No theme key names it, so this is the one raw color.
export const LIVE_COLOR = 'cyan'
// A ship, a session that is done.
export const OK_COLOR = 'success'
// A blocker, a failed call, a command that could not run.
export const ERROR_COLOR = 'error'
// Findings short of a blocker, and what waits for the person.
export const WARN_COLOR = 'warning'
// The text of a solid label, on any of the colors above as its background.
export const LABEL_TEXT = 'inverseText'
