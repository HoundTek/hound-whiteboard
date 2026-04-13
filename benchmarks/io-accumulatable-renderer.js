/**
 * @file Accumulatable I/O Roundtrip Renderer 性能测试运行器
 * @module benchmarks/io-accumulatable-renderer
 */

import {
  Directory as AccumulatableDirectory,
  File as AccumulatableFile,
} from "../src/utils/accumulatable-io.js";
import {
  Directory as RendererDirectory,
  File as RendererFile,
} from "../src/utils/renderer-io.js";

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

async function runAccumulatableBenchmark({ rootPath, iterations }) {
  const rendererRoot = new RendererDirectory(rootPath);
  const rendererDocs = rendererRoot.cd("docs");
  const rendererLargeDir = rendererRoot.cd("large-dir");
  const rendererNote = new RendererFile(rendererDocs, "note", "txt");
  const rendererConfig = new RendererFile(rendererDocs, "config", "json");
  const rendererLargeJson = new RendererFile(
    rendererDocs,
    "large-config",
    "json",
  );
  const rendererBurst = new RendererFile(rendererDocs, "burst", "json");

  const accumRoot = new AccumulatableDirectory(rootPath);
  const accumDocs = accumRoot.cd("docs");
  const accumLargeDir = accumRoot.cd("large-dir");
  const accumNote = new AccumulatableFile(accumDocs, "note", "txt");
  const accumConfig = new AccumulatableFile(accumDocs, "config", "json");
  const accumLargeJson = new AccumulatableFile(
    accumDocs,
    "large-config",
    "json",
  );
  const accumBurst = new AccumulatableFile(accumDocs, "burst", "json");

  return [
    await measureAsyncBenchmark(
      "Sequential File.exist + cat + catJSON",
      iterations,
      async () => {
        await rendererNote.exist();
        await rendererNote.cat();
        await rendererConfig.catJSON();
      },
    ),
    await measureAsyncBenchmark(
      "Accumulatable File.exist + cat + catJSON",
      iterations,
      async () => {
        accumNote.exist();
        accumNote.cat();
        accumConfig.catJSON();
        await accumNote.flush(2);
        await accumConfig.flushAll();
      },
    ),
    await measureAsyncBenchmark(
      `Sequential Directory checks (${LARGE_DIRECTORY_FILE_COUNT} files)`,
      Math.max(1, Math.floor(iterations / 4)),
      async () => {
        await rendererDocs.exist();
        await rendererDocs.existFile("note", "txt");
        await rendererLargeDir.lsFile();
      },
    ),
    await measureAsyncBenchmark(
      `Accumulatable Directory checks (${LARGE_DIRECTORY_FILE_COUNT} files)`,
      Math.max(1, Math.floor(iterations / 4)),
      async () => {
        accumDocs.exist();
        accumDocs.existFile("note", "txt");
        accumLargeDir.lsFile();
        await accumDocs.flushAll();
        await accumLargeDir.flushAll();
      },
    ),
    await measureAsyncBenchmark(
      `Sequential burst writeJSON (${BURST_WRITE_COUNT} writes)`,
      Math.max(1, Math.floor(iterations / 5)),
      async (index) => {
        for (let writeIndex = 0; writeIndex < BURST_WRITE_COUNT; writeIndex++) {
          await rendererBurst.writeJSON({
            ok: true,
            size: index,
            writeIndex,
            payload: createLargeJSONPayload(50),
          });
        }
      },
    ),
    await measureAsyncBenchmark(
      `Accumulatable burst writeJSON (${BURST_WRITE_COUNT} writes)`,
      Math.max(1, Math.floor(iterations / 5)),
      async (index) => {
        for (let writeIndex = 0; writeIndex < BURST_WRITE_COUNT; writeIndex++) {
          accumBurst.writeJSON({
            ok: true,
            size: index,
            writeIndex,
            payload: createLargeJSONPayload(50),
          });
        }
        await accumBurst.flushAll();
      },
    ),
    await measureAsyncBenchmark(
      `Sequential large read mix (${LARGE_JSON_ITEM_COUNT})`,
      Math.max(1, Math.floor(iterations / 5)),
      async () => {
        await rendererLargeDir.lsFile();
        await rendererLargeJson.catJSON();
      },
    ),
    await measureAsyncBenchmark(
      `Accumulatable large read mix (${LARGE_JSON_ITEM_COUNT})`,
      Math.max(1, Math.floor(iterations / 5)),
      async () => {
        accumLargeDir.lsFile();
        accumLargeJson.catJSON();
        await accumLargeDir.flushAll();
        await accumLargeJson.flushAll();
      },
    ),
  ];
}

export {
  runAccumulatableBenchmark,
};