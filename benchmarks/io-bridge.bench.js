/**
 * @file I/O Bridge 性能测试
 * @module benchmarks/io-bridge
 */

import fs from "fs";
import os from "os";
import path from "path";
import Benchmark from "benchmark";

import { Directory, File } from "../src/utils/io.js";
import { handleIOBridgeRequest } from "../src/io-bridge-main.js";

const suite = new Benchmark.Suite("IO Bridge Benchmarks");

function toDirectoryPayload(directory) {
  return {
    __houndType: "Directory",
    paths: [...directory.paths],
  };
}

function toFilePayload(file) {
  return {
    __houndType: "File",
    dir: toDirectoryPayload(file.dir),
    name: file.name,
    extension: file.extension,
  };
}

function createFixture() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "hound-io-bench-"));
  const rootDir = Directory.parse(rootPath);
  const docsDir = rootDir.cd("docs").make();
  const noteFile = docsDir.peek("note", "txt").write("hello benchmark");
  const jsonFile = docsDir.peek("config", "json").writeJSON({ ok: true, size: 3 });

  return {
    rootPath,
    rootDir,
    docsDir,
    noteFile,
    jsonFile,
  };
}

function destroyFixture(rootPath) {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

globalThis.__houndIOBridge = {
  call(request) {
    return Promise.resolve(handleIOBridgeRequest(null, request));
  },
};

const { Directory: RendererDirectory, File: RendererFile } = await import("../src/utils/renderer-io.js");

suite.add("Direct File#cat", function () {
  const fixture = createFixture();
  fixture.noteFile.cat();
  destroyFixture(fixture.rootPath);
});

suite.add("IPC handler File#cat", function () {
  const fixture = createFixture();
  handleIOBridgeRequest(null, {
    target: toFilePayload(fixture.noteFile),
    method: "cat",
    args: [],
  });
  destroyFixture(fixture.rootPath);
});

suite.add("Renderer File#cat", {
  defer: true,
  fn(deferred) {
    const fixture = createFixture();
    const rendererFile = new RendererFile(fixture.docsDir.getPath(), "note", "txt");
    rendererFile
      .cat()
      .then(() => {
        destroyFixture(fixture.rootPath);
        deferred.resolve();
      })
      .catch((error) => {
        destroyFixture(fixture.rootPath);
        deferred.benchmark.emit("error", error);
      });
  },
});

suite.add("Direct Directory#lsFile", function () {
  const fixture = createFixture();
  fixture.docsDir.lsFile();
  destroyFixture(fixture.rootPath);
});

suite.add("IPC handler Directory#lsFile", function () {
  const fixture = createFixture();
  handleIOBridgeRequest(null, {
    target: toDirectoryPayload(fixture.docsDir),
    method: "lsFile",
    args: [],
  });
  destroyFixture(fixture.rootPath);
});

suite.add("Renderer Directory#lsFile", {
  defer: true,
  fn(deferred) {
    const fixture = createFixture();
    const rendererDir = new RendererDirectory(fixture.docsDir.getPath());
    rendererDir
      .lsFile()
      .then(() => {
        destroyFixture(fixture.rootPath);
        deferred.resolve();
      })
      .catch((error) => {
        destroyFixture(fixture.rootPath);
        deferred.benchmark.emit("error", error);
      });
  },
});

suite.add("Direct File#writeJSON", function () {
  const fixture = createFixture();
  fixture.jsonFile.writeJSON({ ok: true, size: 4 });
  destroyFixture(fixture.rootPath);
});

suite.add("IPC handler File#writeJSON", function () {
  const fixture = createFixture();
  handleIOBridgeRequest(null, {
    target: toFilePayload(fixture.jsonFile),
    method: "writeJSON",
    args: [{ ok: true, size: 4 }],
  });
  destroyFixture(fixture.rootPath);
});

suite.add("Renderer File#writeJSON", {
  defer: true,
  fn(deferred) {
    const fixture = createFixture();
    const rendererFile = new RendererFile(fixture.docsDir.getPath(), "config", "json");
    rendererFile
      .writeJSON({ ok: true, size: 4 })
      .then(() => {
        destroyFixture(fixture.rootPath);
        deferred.resolve();
      })
      .catch((error) => {
        destroyFixture(fixture.rootPath);
        deferred.benchmark.emit("error", error);
      });
  },
});

suite.on("cycle", function (event) {
  console.log(String(event.target));
});

suite.on("complete", function () {
  console.log("\n性能测试完成！");
  console.log("═══════════════════════════════════════════════════");
  console.log(`最快项: ${this.filter("fastest").map("name")}`);
});

console.log("开始 I/O Bridge 性能测试...\n");
console.log("═══════════════════════════════════════════════════");
suite.run({ async: true });