/**
 * @file I/O Direct 性能测试
 * @module benchmarks/io-direct
 */

import fs from "fs";
import os from "os";
import path from "path";

import { Directory } from "../src/utils/filesys/io.js";

const ITERATIONS = 2000;
const SCENARIO_ITERATIONS = 200;
const LARGE_DIRECTORY_FILE_COUNT = 400;
const LARGE_JSON_ITEM_COUNT = 2000;
const BURST_WRITE_COUNT = 20;

function createLargeJSONPayload(size) {
  return {
    meta: {
      type: "benchmark",
      size,
    },
    objects: Array.from({ length: size }, (_, index) => ({
      id: index,
      x: index % 100,
      y: (index * 3) % 100,
      text: `object-${index}`,
      color: `#${(index % 255).toString(16).padStart(2, "0")}0000`,
    })),
  };
}

function createFixture() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "hound-io-direct-"));
  const rootDir = Directory.parse(rootPath);
  const docsDir = rootDir.cd("docs").make();
  const noteFile = docsDir.peek("note", "txt").write("hello benchmark");
  const configFile = docsDir.peek("config", "json").writeJSON({
    ok: true,
    size: 3,
  });
  const largeDir = rootDir.cd("large-dir").make();
  const largeJsonFile = docsDir.peek("large-config", "json").writeJSON(
    createLargeJSONPayload(LARGE_JSON_ITEM_COUNT),
  );
  const burstWriteFile = docsDir.peek("burst", "json").writeJSON({
    ok: true,
    size: 0,
  });

  for (let index = 0; index < LARGE_DIRECTORY_FILE_COUNT; index++) {
    largeDir.peek(`item-${index}`, "json").writeJSON({
      id: index,
      label: `item-${index}`,
    });
  }

  return {
    rootPath,
    docsDir,
    largeDir,
    noteFile,
    configFile,
    largeJsonFile,
    burstWriteFile,
  };
}

function destroyFixture(rootPath) {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

function measureSyncBenchmark(name, iterations, run) {
  const startedAt = process.hrtime.bigint();

  for (let index = 0; index < iterations; index++) {
    run(index);
  }

  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const opsPerSecond = (iterations * 1000) / elapsedMs;
  const msPerOp = elapsedMs / iterations;

  console.log(
    `${name}: ${opsPerSecond.toFixed(2)} ops/sec (${msPerOp.toFixed(4)} ms/op, ${iterations} iterations)`,
  );
}

console.log("开始 I/O Direct 性能测试...\n");
console.log("═══════════════════════════════════════════════════");

{
  const fixture = createFixture();
  measureSyncBenchmark("Direct File#cat", ITERATIONS, () => {
    fixture.noteFile.cat();
  });
  destroyFixture(fixture.rootPath);
}

{
  const fixture = createFixture();
  measureSyncBenchmark("Direct Directory#lsFile", ITERATIONS, () => {
    fixture.docsDir.lsFile();
  });
  destroyFixture(fixture.rootPath);
}

{
  const fixture = createFixture();
  measureSyncBenchmark("Direct File#writeJSON", ITERATIONS, (index) => {
    fixture.configFile.writeJSON({ ok: true, size: index % 10 });
  });
  destroyFixture(fixture.rootPath);
}

{
  const fixture = createFixture();
  measureSyncBenchmark(
    "Scenario Direct Directory#lsFile (400 files)",
    SCENARIO_ITERATIONS,
    () => {
      fixture.largeDir.lsFile();
    },
  );
  destroyFixture(fixture.rootPath);
}

{
  const fixture = createFixture();
  measureSyncBenchmark(
    "Scenario Direct File#catJSON (large)",
    SCENARIO_ITERATIONS,
    () => {
      fixture.largeJsonFile.catJSON();
    },
  );
  destroyFixture(fixture.rootPath);
}

{
  const fixture = createFixture();
  measureSyncBenchmark(
    `Scenario Direct File#writeJSON burst (${BURST_WRITE_COUNT} writes)` ,
    SCENARIO_ITERATIONS,
    (index) => {
      for (let writeIndex = 0; writeIndex < BURST_WRITE_COUNT; writeIndex++) {
        fixture.burstWriteFile.writeJSON({
          ok: true,
          size: index,
          writeIndex,
          payload: createLargeJSONPayload(50),
        });
      }
    },
  );
  destroyFixture(fixture.rootPath);
}

console.log("\n性能测试完成！");
console.log("═══════════════════════════════════════════════════");