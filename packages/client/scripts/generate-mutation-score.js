import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, "../reports/mutation/mutation.json");
const scoreFilePath = path.join(__dirname, "../MUTATION_SCORE.md");

if (!fs.existsSync(reportPath)) {
  console.error("Mutation report not found at", reportPath);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
const files = report.files;

let totalMutants = 0;
let totalKilled = 0;
let totalSurvived = 0;
let totalTimeout = 0;
let totalNoCoverage = 0;

const rows = [];
const moduleNames = [];

for (const [filepath, fileData] of Object.entries(files)) {
  const filename = path.basename(filepath);
  moduleNames.push(filename);
  const mutants = fileData.mutants || [];

  let mKilled = 0;
  let mSurvived = 0;
  let mTimeout = 0;
  let mNoCoverage = 0;
  let mTotal = 0;

  for (const m of mutants) {
    mTotal++;
    if (m.status === "Killed") mKilled++;
    else if (m.status === "Survived") mSurvived++;
    else if (m.status === "Timeout") mTimeout++;
    else if (m.status === "NoCoverage") mNoCoverage++;
  }

  totalMutants += mTotal;
  totalKilled += mKilled;
  totalSurvived += mSurvived;
  totalTimeout += mTimeout;
  totalNoCoverage += mNoCoverage;

  const score = mTotal === 0 ? "100.00%" : (((mKilled + mTimeout) / mTotal) * 100).toFixed(2) + "%";

  rows.push(
    `| \`${filepath}\` | ${score} | ${mKilled} | ${mSurvived} | ${mTimeout} | ${mNoCoverage} |`,
  );
}

const totalScore =
  totalMutants === 0
    ? "100.00%"
    : (((totalKilled + totalTimeout) / totalMutants) * 100).toFixed(2) + "%";
rows.push(
  `| **Total** | **${totalScore}** | **${totalKilled}** | **${totalSurvived}** | **${totalTimeout}** | **${totalNoCoverage}** |`,
);

const dateStr = new Date().toISOString().split("T")[0];

const mdContent = `# Mutation Score — \`packages/client\` crypto modules

Scope: ${moduleNames.map((m) => `\`${m}\``).join(", ")}  
Date Generated: ${dateStr}
Runner: \`@stryker-mutator/vitest-runner\`
Config: \`stryker.conf.json\`

## How to run

\`\`\`bash
just mutation
# or directly:
npm run mutate --workspace=packages/client
\`\`\`

Expected wall-clock time: **3–8 minutes** on a modern laptop (4 workers, vitest
in-process mode).  Do not add this to the default CI pipeline — it is too slow
to run on every commit.  Run it when changing crypto modules, or
periodically to verify the test suite hasn't drifted.

The HTML report is written to \`packages/client/reports/mutation/mutation.html\`
(git-ignored).

## Baseline scores

| File | Mutation score | Killed | Survived | Timeout | No coverage |
|------|---------------|--------|----------|---------|-------------|
${rows.join("\n")}

## Ratchet Rule
The \`thresholds.break\` score in \`stryker.conf.json\` represents a ratchet. 
The threshold only goes up; a PR lowering it needs a stated reason.
`;

fs.writeFileSync(scoreFilePath, mdContent);
console.log("Updated MUTATION_SCORE.md with new scores.");
