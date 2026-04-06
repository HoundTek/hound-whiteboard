/**
 * @file 运行所有 Benchmark 测试
 * @module benchmarks/all
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

console.log("═══════════════════════════════════════════════════");
console.log("         HoundWhiteboard Benchmark Suite          ");
console.log("═══════════════════════════════════════════════════\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const benchmarks = [
  { name: "Queue", file: "queue.bench.js" },
  { name: "Chain", file: "chain.bench.js" },
];

benchmarks.forEach((bench, index) => {
  console.log(`\n${"=".repeat(55)}`);
  console.log(`  测试 ${index + 1}/${benchmarks.length}: ${bench.name}`);
  console.log(`${"=".repeat(55)}\n`);

  try {
    const benchPath = path.join(__dirname, bench.file);
    execSync(`node "${benchPath}"`, { stdio: "inherit" });
  } catch (error) {
    console.error(`\n❌ ${bench.name} 测试失败:`, error.message);
  }

  if (index < benchmarks.length - 1) {
    console.log("\n" + "─".repeat(55));
  }
});

console.log("\n═══════════════════════════════════════════════════");
console.log("            所有 Benchmark 测试完成！             ");
console.log("═══════════════════════════════════════════════════\n");
