/**
 * @file I/O Bridge 性能测试
 * @description 测量 I/O 桥接层各路径（Direct/IPC/Renderer）的性能。
 * @module benchmarks/io-bridge
 */

import fs from "fs";
import os from "os";
import path from "path";

import { Directory, File } from "../src/utils/filesys/io.js";
import { handleIOBridgeRequest } from "../src/io-bridge-main.js";
import {
  printHeader,
  printFooter,
  benchmarkSync,
  benchmarkAsync,
} from "./helpers.js";

const ROUNDS = 5;

function toDirectoryPayload(directory) {
  return { __houndType: "Directory", paths: [...directory.paths] };
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
  const jsonFile = docsDir
    .peek("config", "json")
    .writeJSON({ ok: true, size: 3 });
  return { rootPath, rootDir, docsDir, noteFile, jsonFile };
}

function destroyFixture(rootPath) {
  fs.rmSync(rootPath, { recursive: true, force: true });
}

globalThis.__houndIOBridge = {
  call(request) {
    return Promise.resolve(handleIOBridgeRequest(null, request));
  },
};

const { Directory: RendererDirectory, File: RendererFile } =
  await import("../src/utils/filesys/renderer-io.js");

printHeader("I/O Bridge 性能测试");

// Direct File#cat (sync)
benchmarkSync("Direct File#cat", 80, ROUNDS, () => {
  const f = createFixture();
  f.noteFile.cat();
  destroyFixture(f.rootPath);
});

// IPC handler File#cat (sync)
benchmarkSync("IPC handler File#cat", 80, ROUNDS, () => {
  const f = createFixture();
  handleIOBridgeRequest(null, {
    target: toFilePayload(f.noteFile),
    method: "cat",
    args: [],
  });
  destroyFixture(f.rootPath);
});

// Renderer File#cat (async)
benchmarkAsync("Renderer File#cat", 80, ROUNDS, async () => {
  const f = createFixture();
  try {
    const rendererFile = new RendererFile(f.docsDir.getPath(), "note", "txt");
    await rendererFile.cat();
  } finally {
    destroyFixture(f.rootPath);
  }
});

// Direct Directory#lsFile (sync)
benchmarkSync("Direct Directory#lsFile", 80, ROUNDS, () => {
  const f = createFixture();
  f.docsDir.lsFile();
  destroyFixture(f.rootPath);
});

// IPC handler Directory#lsFile (sync)
benchmarkSync("IPC handler Directory#lsFile", 80, ROUNDS, () => {
  const f = createFixture();
  handleIOBridgeRequest(null, {
    target: toDirectoryPayload(f.docsDir),
    method: "lsFile",
    args: [],
  });
  destroyFixture(f.rootPath);
});

// Renderer Directory#lsFile (async)
benchmarkAsync("Renderer Directory#lsFile", 80, ROUNDS, async () => {
  const f = createFixture();
  try {
    const rendererDir = new RendererDirectory(f.docsDir.getPath());
    await rendererDir.lsFile();
  } finally {
    destroyFixture(f.rootPath);
  }
});

// Direct File#writeJSON (sync)
benchmarkSync("Direct File#writeJSON", 80, ROUNDS, () => {
  const f = createFixture();
  f.jsonFile.writeJSON({ ok: true, size: 4 });
  destroyFixture(f.rootPath);
});

// IPC handler File#writeJSON (sync)
benchmarkSync("IPC handler File#writeJSON", 80, ROUNDS, () => {
  const f = createFixture();
  handleIOBridgeRequest(null, {
    target: toFilePayload(f.jsonFile),
    method: "writeJSON",
    args: [{ ok: true, size: 4 }],
  });
  destroyFixture(f.rootPath);
});

// Renderer File#writeJSON (async)
benchmarkAsync("Renderer File#writeJSON", 80, ROUNDS, async () => {
  const f = createFixture();
  try {
    const rendererFile = new RendererFile(
      f.docsDir.getPath(),
      "config",
      "json",
    );
    await rendererFile.writeJSON({ ok: true, size: 4 });
  } finally {
    destroyFixture(f.rootPath);
  }
});

printFooter();
