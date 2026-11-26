/**
 * Where a note of the vault goes in the content model. The folder of the
 * note and its tags give the database and the `Type` (part c.1 of the
 * design record). Each rule is one line of a table here.
 *
 *     destinationOf(note("work/active/Billing/Retry Rules.md", { tags: ["work-note"] }))
 *     // { kind: "row", database: "work", type: "Work note", defaults: { status: "active", project: "Billing" }, byDefault: false }
 *     destinationOf(note("brain/North Star.md"))   // { kind: "page", page: "north_star" }
 *     destinationOf(note("work/Index.md"))         // { kind: "section", page: "home", section: "Open Questions" }
 *     destinationOf(note("Home.md"))               // { kind: "skip", reason: "The setup builds the Home page from linked views." }
 */

import { PAGES, type DatabaseKey, type PageKey, type ScaffoldSource } from "./notion-model.ts";
import type { FieldValue, SourceNote } from "./import-source.ts";

export type Destination =
	| {
			readonly kind: "row";
			readonly database: DatabaseKey;
			/** The `Type` option, or `null` for a database with no `Type`. */
			readonly type: string | null;
			/** Fields that the folder gives. A frontmatter field of the same name wins. */
			readonly defaults: Readonly<Record<string, string>>;
			/** The row is one that the setup made. The import fills that row and makes no new one. */
			readonly adopts?: PageKey;
			/** No rule of the template names the folder, so the place is a default. */
			readonly byDefault: boolean;
	  }
	/** A page of the setup under the root, which has no properties. */
	| { readonly kind: "page"; readonly page: PageKey }
	/** One `##` section of a page of the setup. The rest of the note has a different form in Notion. */
	| { readonly kind: "section"; readonly page: PageKey; readonly section: string; readonly rest: string }
	| { readonly kind: "skip"; readonly reason: string };

export type RowDestination = Extract<Destination, { kind: "row" }>;

type Note = Pick<SourceNote, "path" | "title" | "fields">;

const listOf = (value: FieldValue | undefined): readonly string[] => (value === undefined ? [] : typeof value === "string" ? [value] : value);
const hasTag = (note: Note, tag: string): boolean => listOf(note.fields["tags"]).includes(tag);

/** Files of the template that have a different form in Notion, with the reason that the report shows (part c.5). */
const REPLACED_FILES: Readonly<Record<string, string>> = {
	"Home.md": "The setup builds the Home page from linked views.",
	"perf/Brag Doc.md": 'The view "Brag quarters" of the Perf docs database replaces it.',
	"brain/Skills.md": "It is a catalog of repository commands, and it stays a repository file.",
	"perf/competencies/README.md": "The setup folds it into the description of the Competencies database.",
	"thinking/README.md": "The setup folds it into the description of the Work database.",
	"work/meetings/README.md": "The setup folds it into the description of the Work database.",
};

/** What replaces the text of a note outside the section that a page of the setup takes. */
const REST_OF_SECTION_FILE: Readonly<Record<string, string>> = {
	"brain/Memories.md": 'The view "Brain index" of the Knowledge database replaces its list of topics.',
	"work/Index.md": "The views of the Work database replace it.",
};

/** A file of the template that the import leaves out, and the page of the setup that a link to it names. */
const PAGE_OF_REPLACED_FILE: Readonly<Record<string, PageKey>> = { "Home.md": "home" };

const REPLACED_FOLDERS: Readonly<Record<string, string>> = {
	templates: "The setup makes the template rows from the repository.",
	memories: "Cross-repository memory is not a part of the content model.",
	bases: "The saved views of the databases replace the Bases.",
};

/** The reason that the import leaves out each file of the top folder of `path`, or `undefined`. */
export const replacedFolderReason = (path: string): string | undefined => (path.includes("/") ? REPLACED_FOLDERS[path.split("/")[0] ?? ""] : undefined);

const REPOSITORY_DOCUMENT = /^(AGENTS|CLAUDE|README(\.[A-Za-z-]+)?|CHANGELOG|CONTRIBUTING|ARCHITECTURE|NOTION-PORT-DESIGN|LICENSE)\.md$/;

interface PagePart {
	readonly page: PageKey;
	readonly parent: "root" | DatabaseKey;
	readonly type: string | null;
	/** The `##` section that the page takes, or `undefined` for the whole file. */
	readonly section: string | undefined;
}

/**
 * The path in a vault of the template of each scaffold file that is the
 * body of a page of the setup. The import reads a vault, so it needs this
 * path. `SCAFFOLD_SOURCES` has the path of the copy that the setup reads
 * from the repository.
 */
const VAULT_PATH_OF_SOURCE: Readonly<Partial<Record<ScaffoldSource, string>>> = {
	north_star: "brain/North Star.md",
	memories: "brain/Memories.md",
	key_decisions: "brain/Key Decisions.md",
	patterns: "brain/Patterns.md",
	gotchas: "brain/Gotchas.md",
	people_and_context: "org/People & Context.md",
	work_index: "work/Index.md",
};

/** The part of the body of a page of the setup that each file gives, from the `body` of `PAGES`. A source with no file in a vault gives no part. */
const PAGE_PART_OF_FILE: ReadonlyMap<string, PagePart> = new Map(
	PAGES.flatMap((page) =>
		page.body.flatMap((part) => {
			const path = VAULT_PATH_OF_SOURCE[part.source];
			return path === undefined ? [] : [[path, { page: page.key, parent: page.parent, type: page.properties?.["Type"] ?? null, section: part.section }] as const];
		}),
	),
);

/** The page of the setup that a link to `path` names when the import makes no page for that file, or `undefined`. */
export const setupPageOfFile = (path: string): PageKey | undefined => PAGE_OF_REPLACED_FILE[path] ?? PAGE_PART_OF_FILE.get(path)?.page;

interface FolderRule {
	readonly folder: string;
	readonly database: DatabaseKey;
	readonly type: (note: Note) => string | null;
	/** The fields that the folders below `folder` give. */
	readonly defaults?: (below: readonly string[]) => Readonly<Record<string, string>>;
}

const workType = (note: Note): string => (hasTag(note, "decision") ? "Decision" : "Work note");
const projectOf = (below: readonly string[]): Readonly<Record<string, string>> => (below[0] === undefined ? {} : { project: below[0] });
const belowArchiveYear = (below: readonly string[]): readonly string[] => (/^\d{4}$/.test(below[0] ?? "") ? below.slice(1) : below);
const reviewCycleOf = (below: readonly string[]): Readonly<Record<string, string>> => (below[0] === undefined ? {} : { cycle: below[0] });

/** The first rule whose folder holds the note applies, so a longer folder is above a shorter one. */
const FOLDER_RULES: readonly FolderRule[] = [
	{ folder: "work/active", database: "work", type: workType, defaults: (below) => ({ status: "active", ...projectOf(below) }) },
	{ folder: "work/archive", database: "work", type: workType, defaults: (below) => ({ status: "completed", ...projectOf(belowArchiveYear(below)) }) },
	{ folder: "work/incidents", database: "work", type: () => "Incident" },
	{ folder: "work/1-1", database: "work", type: () => "1:1" },
	{ folder: "work/meetings", database: "work", type: () => "Inbox item" },
	{ folder: "work", database: "work", type: workType },
	{ folder: "thinking", database: "work", type: () => "Thinking" },
	{ folder: "org/people", database: "people", type: () => null },
	{ folder: "org/teams", database: "teams", type: () => null },
	{ folder: "perf/competencies", database: "competencies", type: () => null },
	{ folder: "perf/evidence", database: "perf_docs", type: () => "PR evidence" },
	{ folder: "perf/brag", database: "perf_docs", type: () => "Brag quarter" },
	{ folder: "perf", database: "perf_docs", type: (note) => (/review brief/i.test(note.title) ? "Review brief" : "Review artifact"), defaults: reviewCycleOf },
	{ folder: "brain", database: "knowledge", type: () => "Brain topic" },
	{ folder: "reference", database: "knowledge", type: () => "Reference" },
];

const DEFAULT_PLACE = { database: "knowledge", type: "Reference" } as const;

export function destinationOf(note: Note): Destination {
	const replaced = REPLACED_FILES[note.path];
	if (replaced !== undefined) return { kind: "skip", reason: replaced };
	const folders = note.path.split("/").slice(0, -1);
	if (folders.length === 0 && REPOSITORY_DOCUMENT.test(note.path)) return { kind: "skip", reason: "It is a document of the repository and not a note." };
	const replacedFolder = replacedFolderReason(note.path);
	if (replacedFolder !== undefined) return { kind: "skip", reason: replacedFolder };

	const scaffold = PAGE_PART_OF_FILE.get(note.path);
	if (scaffold?.section !== undefined) {
		return { kind: "section", page: scaffold.page, section: scaffold.section, rest: REST_OF_SECTION_FILE[note.path] ?? "The page of the setup takes only this section." };
	}
	if (scaffold !== undefined) {
		return scaffold.parent === "root" ? { kind: "page", page: scaffold.page } : { kind: "row", database: scaffold.parent, type: scaffold.type, defaults: {}, adopts: scaffold.page, byDefault: false };
	}

	const folder = folders.join("/");
	const rule = FOLDER_RULES.find((candidate) => folder === candidate.folder || folder.startsWith(`${candidate.folder}/`));
	if (rule === undefined) return { kind: "row", ...DEFAULT_PLACE, defaults: {}, byDefault: true };
	const below = folder === rule.folder ? [] : folder.slice(rule.folder.length + 1).split("/");
	return { kind: "row", database: rule.database, type: rule.type(note), defaults: rule.defaults?.(below) ?? {}, byDefault: false };
}

/**
 * A note that holds the bulk of a different note of the same database
 * (the "Note Types" table of `AGENTS.md`). The title names its core note.
 */
export interface Satellite {
	/** The `Type` of the note in the Knowledge database. */
	readonly type: string;
	/** The title of the core note. */
	readonly core: string;
	/** The name alone gives the type. Without it, the type applies only when the core note exists. */
	readonly byNameAlone: boolean;
}

const SATELLITE_TITLES: readonly { readonly type: string; readonly pattern: RegExp; readonly byNameAlone: boolean }[] = [
	{ type: "Archive note", pattern: /^(.+?) Archive(?: — .+)?$/, byNameAlone: true },
	{ type: "Event-log satellite", pattern: /^(.+?) — .+ Log$/, byNameAlone: true },
	{ type: "Domain note", pattern: /^(.+?) - .+$/, byNameAlone: false },
];

export function satelliteOf(title: string): Satellite | null {
	for (const { type, pattern, byNameAlone } of SATELLITE_TITLES) {
		const core = pattern.exec(title)?.[1];
		if (core !== undefined) return { type, core, byNameAlone };
	}
	return null;
}
