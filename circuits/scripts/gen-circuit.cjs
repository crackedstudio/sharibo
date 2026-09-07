#!/usr/bin/env node
// Regenerates circuits/membership.circom from
// circuits/membership.template.circom + circuits/config.json — the single
// source of truth for the Merkle tree depth (see the "Changing the Merkle
// tree depth" section in the repo README). Run automatically by
// scripts/compile.sh and by the circuit test suite; safe to run manually:
//
//   node scripts/gen-circuit.cjs
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function generate() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const template = fs.readFileSync(path.join(ROOT, "membership.template.circom"), "utf8");

  // Allow overriding levels via environment variable `LEVELS` or by
  // passing an explicit override when calling `generate(overrideLevels)`.
  const env = process.env.LEVELS;
  const levelsFromEnv = typeof env === "string" && env !== "" ? Number(env) : undefined;

  function generateWithOverride(overrideLevels) {
    const levels = Number(
      levelsFromEnv ?? (typeof overrideLevels !== "undefined" ? overrideLevels : config.levels),
    );
    if (!Number.isInteger(levels) || levels < 1) {
      throw new Error(`invalid levels: ${levels}`);
    }

    const output =
      template.trimEnd() +
      `\n\ncomponent main { public [root, externalNullifier, recipientHash] } = Sharibo(${levels});\n`;

    const outPath = path.join(ROOT, "membership.circom");
    fs.writeFileSync(outPath, output);
    return { outPath, levels };
  }

  // Default API: no argument -> use env or config.json
  return generateWithOverride();
}

if (require.main === module) {
  const { outPath, levels } = generate();
  console.log(`generated ${outPath} for levels=${levels}`);
}

// Export a function that optionally accepts an explicit levels override.
module.exports = { generate: function (override) {
  // If an override was provided, regenerate with that levels value.
  if (typeof override !== 'undefined') {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    const template = fs.readFileSync(path.join(ROOT, "membership.template.circom"), "utf8");
    const env = process.env.LEVELS;
    const levelsFromEnv = typeof env === "string" && env !== "" ? Number(env) : undefined;
    const levels = Number(levelsFromEnv ?? override ?? cfg.levels);
    if (!Number.isInteger(levels) || levels < 1) {
      throw new Error(`invalid levels: ${levels}`);
    }
    const output = template.trimEnd() + `\n\ncomponent main { public [root, externalNullifier, recipientHash] } = Sharibo(${levels});\n`;
    const outPath = path.join(ROOT, "membership.circom");
    fs.writeFileSync(outPath, output);
    return { outPath, levels };
  }
  return generate();
} };
