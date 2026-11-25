/** `npm test`: run the suite with the Node test runner. Extra arguments pass through to `node --test`. */

import { spawnSync } from "node:child_process";

const run = spawnSync(
	process.execPath,
	["--experimental-strip-types", "--test", ...process.argv.slice(2)],
	{ stdio: "inherit" },
);

process.exit(run.status ?? 1);
