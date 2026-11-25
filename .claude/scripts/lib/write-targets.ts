/**
 * The files a write hook's payload says were written.
 *
 * Claude Code names one `tool_input.file_path`.
 */

/** The payload's `file_path`, as given, in a list of at most one; empty when it names none. */
export function writeTargets(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const toolInput = (input as { tool_input?: unknown }).tool_input;
	if (!toolInput || typeof toolInput !== "object") return [];
	const filePath = (toolInput as { file_path?: unknown }).file_path;
	return typeof filePath === "string" && filePath !== "" ? [filePath] : [];
}
