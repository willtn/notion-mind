/**
 * The Markdown form of the fixture: a vault directory that the original
 * hooks at `fae7be4` read.
 */

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { changedAt, type Field, type FixtureNote, type FixtureSpec, type HookForm, type NoteType } from "./spec.ts";

const ARCHIVE_YEAR = "2025";

const inProject = (folder: string, note: FixtureNote): string =>
	typeof note.fields.project === "string" ? `${folder}/${note.fields.project}` : folder;

const FOLDER_OF_TYPE: Readonly<Record<NoteType, (note: FixtureNote) => string>> = {
	"Work note": (note) =>
		inProject(note.fields.status === "active" ? "work/active" : `work/archive/${ARCHIVE_YEAR}`, note),
	Incident: () => "work/incidents",
	"1:1": () => "work/1-1",
	"Inbox item": () => "work/meetings",
	Thinking: () => "thinking",
	Person: () => "org/people",
	"Brain topic": () => "brain",
	Reference: () => "reference",
	"Archive note": () => "reference",
	"North Star": () => "brain",
	Home: () => "",
	"Loose page": () => "reference",
};

/** The path of a note in the vault, with forward slashes. */
export function markdownPath(note: FixtureNote): string {
	const folder = note.markdownFolder ?? FOLDER_OF_TYPE[note.type](note);
	return folder === "" ? `${note.title}.md` : `${folder}/${note.title}.md`;
}

const yamlValue = (value: string | readonly string[]): string =>
	typeof value === "string" ? ` ${value}` : value.map((item) => `\n  - ${item}`).join("");

/** The properties of a note as a YAML frontmatter block, or "" when the note has no property. */
export function renderFrontmatter(fields: FixtureNote["fields"]): string {
	const lines = (Object.keys(fields) as Field[]).map((field) => `${field}:${yamlValue(fields[field]!)}`);
	return lines.length === 0 ? "" : `---\n${lines.join("\n")}\n---\n\n`;
}

export const renderNote = (note: FixtureNote): string => renderFrontmatter(note.fields) + note.body;

/**
 * The Markdown form: a new vault for each scenario, and the hooks of
 * `scriptsDir` on it. `now` is the instant that the note ages count from.
 */
export function markdownForm(spec: FixtureSpec, options: { readonly scriptsDir: string; readonly now: Date }): HookForm {
	const { scriptsDir, now } = options;
	const paths = new Map(spec.notes.map((note) => [note.title, markdownPath(note)] as const));
	const titleOfReference = new Map<string, string>();
	for (const [title, path] of paths) {
		for (const reference of [path, basename(path), title]) titleOfReference.set(reference, title);
	}

	return (dir) => {
		const write = (path: string, content: string): string => {
			const full = join(dir, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, content);
			return full;
		};
		for (const file of spec.repoFiles) write(file.path, file.content);
		for (const note of spec.notes) {
			const changed = changedAt(note, now);
			utimesSync(write(paths.get(note.title)!, renderNote(note)), changed, changed);
		}

		return {
			scriptsDir,
			projectDir: dir,
			// The hooks at `fae7be4` start a detached search-index worker without this switch.
			env: { VAULT_QMD_REFRESH: "off" },
			sessionLogDir: join(dir, "thinking", "session-logs"),
			writePayload: (note) => {
				const filePath = join(dir, paths.get(note.title)!);
				return {
					tool_name: "Write",
					tool_input: { file_path: filePath, content: renderNote(note) },
					tool_response: { filePath, success: true },
				};
			},
			noteOf: (reference) => titleOfReference.get(reference.replace(/^\.\//, "")) ?? null,
			notesIn: (folder) => [...paths].filter(([, path]) => path.startsWith(`${folder}/`)).map(([title]) => title),
		};
	};
}
