/**
 * The name that Notion gives to the language of a code block.
 *
 *     storedLanguage("js")        // { name: "javascript", known: true }
 *     storedLanguage("dataview")  // { name: "javascript", known: false }
 *     storedLanguage("zig")       // undefined: not measured
 *
 * Measured on one page with a code block for each name below, written with
 * `replace_content` and read with `notion-fetch`. Notion stores a block
 * with no language, or with a language that it does not know, as
 * `javascript`. An uppercase letter makes no difference.
 */

/** The names that Notion returns as they are. */
const KEPT: readonly string[] = [
	"javascript", "ts", "py", "bash", "shell", "powershell", "yaml", "json", "toml", "xml", "html", "css", "scss", "sass", "less", "markdown", "sql", "go", "rs", "rb", "c", "c++", "cs",
	"java", "kotlin", "swift", "php", "perl", "lua", "r", "scala", "dart", "elixir", "erlang", "haskell", "clojure", "diff", "docker", "graphql", "proto", "hcl", "nix", "latex", "mermaid", "txt",
];

/** The names that Notion returns as another name of the same language. */
const RENAMED: Readonly<Record<string, string>> = {
	js: "javascript", jsx: "javascript", mjs: "javascript", typescript: "ts", tsx: "ts", python: "py", sh: "bash", ps1: "powershell", bat: "shell", yml: "yaml", jsonc: "json",
	md: "markdown", rust: "rs", ruby: "rb", h: "c", cpp: "c++", csharp: "cs", "c#": "cs", kt: "kotlin", pl: "perl", ex: "elixir", erl: "erlang", hs: "haskell", clj: "clojure",
	objc: "m", "objective-c": "m", dockerfile: "docker", makefile: "mk", gql: "graphql", protobuf: "proto", tex: "latex", text: "txt", plaintext: "txt", plain: "txt", ini: "txt",
};

/** The names that Notion does not know. The first one is a code block with no language. */
const UNKNOWN: readonly string[] = ["", "python3", "zsh", "console", "fish", "json5", "golang", "patch", "make", "terraform", "tf", "vim", "http", "nginx", "csv", "dataview", "dataviewjs", "base"];

const FALLBACK = "javascript";

/** The name that Notion returns for the language `sent` of a code block, and whether Notion knows the language. `undefined` for a name that was not measured. */
export function storedLanguage(sent: string): { readonly name: string; readonly known: boolean } | undefined {
	const name = sent.toLowerCase();
	if (KEPT.includes(name)) return { name, known: true };
	const renamed = RENAMED[name];
	if (renamed !== undefined) return { name: renamed, known: true };
	return UNKNOWN.includes(name) ? { name: FALLBACK, known: false } : undefined;
}
