const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const reportPath = path.join(process.cwd(), 'reports', 'summary.md');
  try {
    const report = await fs.readFile(reportPath, 'utf8');
    process.stdout.write(report);
  } catch (error) {
    console.error(`Could not read ${reportPath}: ${error.message}`);
    process.exitCode = 1;
  }
})();
