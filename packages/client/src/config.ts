// Determine the Merkle tree depth used by the client SDK.
// Priority: `process.env.LEVELS` -> circuits/config.json (Node only) -> default 4
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let _treeLevels = 4;
if (typeof process !== "undefined" && process.env && process.env.LEVELS) {
	_treeLevels = Number(process.env.LEVELS);
} else {
	try {
		// Node-only: attempt to read the canonical circuits/config.json file.
		// `node:` imports stay external to browser bundles (Vite externalizes
		// them); the try/catch below keeps browser imports working.
		const here = path.dirname(fileURLToPath(import.meta.url));
		const raw = readFileSync(path.join(here, "..", "..", "..", "circuits", "config.json"), "utf8");
		const cfg: unknown = JSON.parse(raw);
		const levels = (cfg as { levels?: unknown } | null)?.levels;
		if (typeof levels === "number" && Number.isInteger(levels)) _treeLevels = levels;
	} catch {
		// Ignore: fall back to default
	}
}

export const TREE_LEVELS = _treeLevels;
export const MAX_CIRCLE_SIZE = 2 ** TREE_LEVELS;
