/**
 * @file I/O Direct 性能测试
 * @description 测量直接文件 I/O 各操作的性能（不含桥接层开销）。
 * @module benchmarks/io-direct
 */

import fs from "fs";
import os from "os";
import path from "path";

import { Directory } from "../src/utils/filesys/io.js";
import { printHeader, printFooter, benchmarkSync } from "./helpers.js";

const ITERATIONS = 2000;
const SCENARIO_ITERATIONS = 200;
const LARGE_DIRECTORY_FILE_COUNT = 400;
const LARGE_JSON_ITEM_COUNT = 2000;
const BURST_WRITE_COUNT = 20;
const ROUNDS = 5;

function createLargeJSONPayload(size) {
  return {
    meta: { type: "benchmark", size },
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
  const configFile = docsDir
    .peek("config", "json")
    .writeJSON({ ok: true, size: 3 });
  const largeDir = rootDir.cd("large-dir").make();
  const largeJsonFile = docsDir
    .peek("large-config", "json")
    .writeJSON(createLargeJSONPayload(LARGE_JSON_ITEM_COUNT));
  const burstWriteFile = docsDir
    .peek("burst", "json")
    .writeJSON({ ok: true, size: 0 });

  for (let index = 0; index < LARGE_DIRECTORY_FILE_COUNT; index++) {
    largeDir.peek(`item-${index}`, "json").writeJSON({
      id: index,
      label: `item-${index}`,
    });
  }
  return {
    rootPath,
    noteFile,
    docsDir,
    configFile,
    largeDir,
    largeJsonFile,
    burstWriteFile,
  };
}

function destroyFixture(rootPath) {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

printHeader("I/O Direct 性能测试");

// Direct File#cat
(() => {
  const fixture = createFixture();
  benchmarkSync("Direct File#cat", ITERATIONS, ROUNDS, () => {
    fixture.noteFile.cat();
  });
  destroyFixture(fixture.rootPath);
})();

// Direct Directory#lsFile
(() => {
  const fixture = createFixture();
  benchmarkSync("Direct Directory#lsFile", ITERATIONS, ROUNDS, () => {
    fixture.docsDir.lsFile();
  });
  destroyFixture(fixture.rootPath);
})();

// Direct File#writeJSON
(() => {
  const fixture = createFixture();
  let index = 0;
  benchmarkSync("Direct File#writeJSON", ITERATIONS, ROUNDS, () => {
    fixture.configFile.writeJSON({ ok: true, size: index++ % 10 });
  });
  destroyFixture(fixture.rootPath);
})();

// Large directory lsFile
(() => {
  const fixture = createFixture();
  benchmarkSync(
    "Scenario Direct Directory#lsFile (400 files)",
    SCENARIO_ITERATIONS,
    ROUNDS,
    () => {
      fixture.largeDir.lsFile();
    },
  );
  destroyFixture(fixture.rootPath);
})();

// Large JSON catJSON
(() => {
  const fixture = createFixture();
  benchmarkSync(
    "Scenario Direct File#catJSON (large)",
    SCENARIO_ITERATIONS,
    ROUNDS,
    () => {
      fixture.largeJsonFile.catJSON();
    },
  );
  destroyFixture(fixture.rootPath);
})();

// Burst write
(() => {
  const fixture = createFixture();
  let index = 0;
  benchmarkSync(
    `Scenario Direct File#writeJSON burst (${BURST_WRITE_COUNT} writes)`,
    SCENARIO_ITERATIONS,
    ROUNDS,
    () => {
      for (let writeIndex = 0; writeIndex < BURST_WRITE_COUNT; writeIndex++) {
        fixture.burstWriteFile.writeJSON({
          ok: true,
          size: index,
          writeIndex,
          payload: createLargeJSONPayload(50),
        });
      }
      index++;
    },
  );
  destroyFixture(fixture.rootPath);
})();

printFooter();
