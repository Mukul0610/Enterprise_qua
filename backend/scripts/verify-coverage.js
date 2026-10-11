const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const candidatePaths = [
  path.join(process.cwd(), 'coverage', 'coverage-summary.json'),
  path.join(projectRoot, 'coverage', 'coverage-summary.json'),
];
const summaryPath = candidatePaths.find((p) => fs.existsSync(p));

if (!summaryPath) {
  console.error('\x1b[31m[Coverage Verification Error]\x1b[0m coverage/coverage-summary.json not found. Run tests with --coverage first.');
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

const BENCHMARKS = {
  statements: 90.0,
  branches: 85.0,
  functions: 90.0,
  lines: 90.0,
};
const metrics = ['statements', 'branches', 'functions', 'lines'];

console.log('\n========================================================================================================');
console.log('                   BACKEND PER-FILE UNIT TEST CODE COVERAGE REPORT                      ');
console.log('========================================================================================================\n');

let failedFiles = [];
let passedFiles = [];

// Table header
console.log(
  `| ${'File Path'.padEnd(58)} | ${'Statements'.padEnd(10)} | ${'Branches'.padEnd(10)} | ${'Functions'.padEnd(10)} | ${'Lines'.padEnd(10)} | ${'Status'.padEnd(6)} |`
);
console.log('|' + '-'.repeat(60) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(12) + '|' + '-'.repeat(8) + '|');

Object.keys(summary).forEach((filePath) => {
  if (filePath === 'total') return;

  // Relative path
  let relPath = filePath;
  if (filePath.startsWith(projectRoot)) {
    relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  } else {
    relPath = filePath.replace(/\\/g, '/');
  }

  // Filter only src files
  if (!relPath.startsWith('src/')) {
    return;
  }

  const fileCov = summary[filePath];
  const stPct = fileCov.statements ? fileCov.statements.pct : 100;
  const brPct = fileCov.branches ? fileCov.branches.pct : 100;
  const fnPct = fileCov.functions ? fileCov.functions.pct : 100;
  const lnPct = fileCov.lines ? fileCov.lines.pct : 100;

  const isPassed = stPct >= BENCHMARKS.statements && brPct >= BENCHMARKS.branches && fnPct >= BENCHMARKS.functions && lnPct >= BENCHMARKS.lines;

  const stDisplay = `${stPct.toFixed(1)}%`.padEnd(10);
  const brDisplay = `${brPct.toFixed(1)}%`.padEnd(10);
  const fnDisplay = `${fnPct.toFixed(1)}%`.padEnd(10);
  const lnDisplay = `${lnPct.toFixed(1)}%`.padEnd(10);
  const statusDisplay = isPassed ? '\x1b[32mPASS\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ';

  let shortRelPath = relPath;
  if (shortRelPath.length > 58) {
    shortRelPath = '...' + shortRelPath.slice(-55);
  }

  console.log(
    `| ${shortRelPath.padEnd(58)} | ${stDisplay} | ${brDisplay} | ${fnDisplay} | ${lnDisplay} | ${statusDisplay} |`
  );

  if (isPassed) {
    passedFiles.push({ file: relPath, stPct, brPct, fnPct, lnPct });
  } else {
    failedFiles.push({ file: relPath, stPct, brPct, fnPct, lnPct });
  }
});

console.log('|' + '='.repeat(60) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(12) + '|' + '='.repeat(8) + '|');

if (summary.total) {
  const tot = summary.total;
  const toPct = (item) => {
    if (!item) return '100.0';
    const val = typeof item.pct === 'number' ? item.pct : parseFloat(item.pct);
    return !isNaN(val) ? val.toFixed(1) : '100.0';
  };
  const stPct = toPct(tot.statements);
  const brPct = toPct(tot.branches);
  const fnPct = toPct(tot.functions);
  const lnPct = toPct(tot.lines);
  const totalPassed = parseFloat(stPct) >= BENCHMARKS.statements && parseFloat(brPct) >= BENCHMARKS.branches && parseFloat(fnPct) >= BENCHMARKS.functions && parseFloat(lnPct) >= BENCHMARKS.lines;
  const totalStatus = totalPassed ? '\x1b[32mPASS\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ';

  console.log(
    `| ${'OVERALL TOTAL COVERAGE'.padEnd(58)} | ${(stPct + '%').padEnd(10)} | ${(brPct + '%').padEnd(10)} | ${(fnPct + '%').padEnd(10)} | ${(lnPct + '%').padEnd(10)} | ${totalStatus} |`
  );
  console.log('========================================================================================================\n');
}

console.log(`Files Processed: ${passedFiles.length + failedFiles.length}`);
console.log(`Passed: \x1b[32m${passedFiles.length}\x1b[0m`);
console.log(`Failed in any metric:   \x1b[31m${failedFiles.length}\x1b[0m\n`);

const totalPassed = summary.total &&
  parseFloat(summary.total.statements.pct) >= BENCHMARKS.statements &&
  parseFloat(summary.total.branches.pct) >= BENCHMARKS.branches &&
  parseFloat(summary.total.functions.pct) >= BENCHMARKS.functions &&
  parseFloat(summary.total.lines.pct) >= BENCHMARKS.lines;

if (!totalPassed) {
  console.error('\x1b[31m[ERROR] Total coverage does not meet requirements:\x1b[0m');
  failedFiles.forEach((f) => {
    console.error(
      ` - ${f.file} -> Statements: ${f.stPct.toFixed(1)}%, Branches: ${f.brPct.toFixed(1)}%, Functions: ${f.fnPct.toFixed(1)}%, Lines: ${f.lnPct.toFixed(1)}%`
    );
  });
  console.error('\n\x1b[31mCoverage benchmark failed. Total coverage must achieve >= 90% in Statements, Functions, Lines and >= 85% in Branches.\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32m[SUCCESS] Enterprise Backend Coverage Gate Passed (Total Coverage >= 90% Statements/Functions/Lines, >= 85% Branches)!\x1b[0m\n');
  process.exit(0);
}
