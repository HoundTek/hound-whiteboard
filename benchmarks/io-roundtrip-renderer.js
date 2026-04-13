/**
 * @file I/O Roundtrip Renderer 性能测试运行器
 * @module benchmarks/io-roundtrip-renderer
 */

import { Directory, File } from "../src/utils/filesys/renderer-io.js";

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

async function measureAsyncBenchmark(name, iterations, run) {
  const startedAt = performance.now();

  for (let index = 0; index < iterations; index++) {
    await run(index);
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    name,
    iterations,
    opsPerSecond: (iterations * 1000) / elapsedMs,
    msPerOp: elapsedMs / iterations,
  };
}

async function runRoundtripBenchmark({ rootPath, iterations }) {
  const rootDir = new Directory(rootPath);
  const docsDir = rootDir.cd("docs");
  const largeDir = rootDir.cd("large-dir");
  const noteFile = new File(docsDir, "note", "txt");
  const configFile = new File(docsDir, "config", "json");
  const largeJsonFile = new File(docsDir, "large-config", "json");
  const burstWriteFile = new File(docsDir, "burst", "json");

  return [
    await measureAsyncBenchmark("Roundtrip File#cat", iterations, async () => {
      await noteFile.cat();
    }),
    await measureAsyncBenchmark(
      "Roundtrip Directory#lsFile",
      iterations,
      async () => {
        await docsDir.lsFile();
      },
    ),
    await measureAsyncBenchmark(
      "Roundtrip File#writeJSON",
      iterations,
      async (index) => {
        await configFile.writeJSON({ ok: true, size: index % 10 });
      },
    ),
    await measureAsyncBenchmark(
      `Scenario Roundtrip Directory#lsFile (${LARGE_DIRECTORY_FILE_COUNT} files)`,
      Math.max(1, Math.floor(iterations / 5)),
      async () => {
        await largeDir.lsFile();
      },
    ),
    await measureAsyncBenchmark(
      `Scenario Roundtrip File#catJSON (large ${LARGE_JSON_ITEM_COUNT})`,
      Math.max(1, Math.floor(iterations / 5)),
      async () => {
        await largeJsonFile.catJSON();
      },
    ),
    await measureAsyncBenchmark(
      `Scenario Roundtrip File#writeJSON burst (${BURST_WRITE_COUNT} writes)`,
      Math.max(1, Math.floor(iterations / 5)),
      async (index) => {
        for (let writeIndex = 0; writeIndex < BURST_WRITE_COUNT; writeIndex++) {
          await burstWriteFile.writeJSON({
            ok: true,
            size: index,
            writeIndex,
            payload: createLargeJSONPayload(50),
          });
        }
      },
    ),
  ];
}

export {
  runRoundtripBenchmark,
};