import fs from 'fs';
import path from 'path';

const adrDir = path.resolve('docs/adr');
const files = fs.readdirSync(adrDir).filter(f => f.endsWith('.md') && f !== 'README.md');

const numbers = new Set();
let failed = false;

for (const file of files) {
  const match = file.match(/^(\d{3})-.*\.md$/);
  if (!match) continue;
  
  const num = match[1];
  if (numbers.has(num)) {
    console.error(`Duplicate ADR number found: ${num} in ${file}`);
    failed = true;
  }
  numbers.add(num);
  
  const content = fs.readFileSync(path.join(adrDir, file), 'utf-8');
  const firstLine = content.trim().split('\n')[0];
  const expectedHeading = `# ADR ${num}:`;
  if (!firstLine.startsWith(expectedHeading)) {
    console.error(`Heading mismatch in ${file}. Expected it to start with: "${expectedHeading}" but got "${firstLine}"`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log('All ADRs passed numbering and heading checks.');
}
