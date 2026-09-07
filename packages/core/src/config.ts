// Determine the Merkle tree depth used by the client SDK.
// Priority: `process.env.LEVELS` -> circuits/config.json (Node only) -> default 4
let _treeLevels = 4;
if (typeof process !== "undefined" && process.env && process.env.LEVELS) {
	_treeLevels = Number(process.env.LEVELS);
} else {
	try {
		// Node-only: attempt to read the canonical circuits/config.json file.
		// Use a dynamic require to avoid bundlers trying to include `fs` in browser builds.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require("fs");
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const path = require("path");
		const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "circuits", "config.json"), "utf8"));
		if (Number.isInteger(cfg.levels)) _treeLevels = cfg.levels;
	} catch (e) {
		// Ignore: fall back to default
	}
}

export const TREE_LEVELS = _treeLevels;
export const MAX_CIRCLE_SIZE = 2 ** TREE_LEVELS;
