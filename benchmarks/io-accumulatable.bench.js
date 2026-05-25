/**
 * @file Accumulatable I/O Roundtrip 性能测试
 * @module benchmarks/io-accumulatable
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { app, BrowserWindow, ipcMain } from "electron";

import { registerIOBridge } from "../src/io-bridge-main.js";
import { Directory } from "../src/utils/filesys/io.js";

const ITERATIONS = 800;
const LARGE_DIRECTORY_FILE_COUNT = 400;
const LARGE_JSON_ITEM_COUNT = 2000;

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createFixture() {
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "hound-io-accumulatable-"),
  );
  const rootDir = Directory.parse(rootPath);
  const docsDir = rootDir.cd("docs").make();
  const largeDir = rootDir.cd("large-dir").make();

  docsDir.peek("note", "txt").write("hello benchmark");
  docsDir.peek("config", "json").writeJSON({ ok: true, size: 3 });
  docsDir.peek("large-config", "json").writeJSON(
    createLargeJSONPayload(LARGE_JSON_ITEM_COUNT),
  );
  docsDir.peek("burst", "json").writeJSON({ ok: true, size: 0 });

  for (let index = 0; index < LARGE_DIRECTORY_FILE_COUNT; index++) {
    largeDir.peek(`item-${index}`, "json").writeJSON({
      id: index,
      label: `item-${index}`,
    });
  }

  return { rootPath };
}

function destroyFixture(rootPath) {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

function printResult(result) {
  console.log(
    `${result.name}: ${result.opsPerSecond.toFixed(2)} ops/sec (${result.msPerOp.toFixed(4)} ms/op, ${result.iterations} iterations)`,
  );
}

async function run() {
  registerIOBridge(ipcMain);

  const fixture = createFixture();
  const preloadPath = path.join(__dirname, "../src/preload-io.js");

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await window.loadFile(path.join(__dirname, "io-roundtrip.html"));

    const results = await window.webContents.executeJavaScript(
      `import("./io-accumulatable-renderer.js").then((module) => module.runAccumulatableBenchmark(${JSON.stringify({ rootPath: fixture.rootPath, iterations: ITERATIONS })}))`,
      true,
    );

    console.log("开始 Accumulatable I/O 性能测试...\n");
    console.log("═══════════════════════════════════════════════════");
    results.forEach((result) => printResult(result));
    console.log("\n性能测试完成！");
    console.log("═══════════════════════════════════════════════════");
  } finally {
    destroyFixture(fixture.rootPath);
    if (!window.isDestroyed()) window.destroy();
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error) => {
    console.error("Accumulatable I/O benchmark failed:", error);
    app.exit(1);
  });