import fs from "fs";
import os from "os";
import path from "path";

import { Directory } from "../io.js";
import { UnorderedBlockAllocator, FileBlock } from "../file-block.js";

describe("file-block", () => {
  let rootPath;
  let rootDir;

  beforeEach(() => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "hound-file-block-"));
    rootDir = Directory.parse(rootPath);
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("应能加入、查询、删除和修改块内文件", () => {
    const blockFile = rootDir.peek("block", "json");
    const block = new FileBlock(blockFile, { maxBlockSize: 1024 * 1024 });

    block.addFile("a", { text: "hello" });
    block.addFile("b", "world");

    expect(block.hasFile("a")).toBe(true);
    expect(block.getFile("b").content).toBe("world");

    block.updateFile("b", { text: "updated" });
    expect(JSON.parse(block.getFile("b").content)).toEqual({ text: "updated" });

    expect(block.removeFile("a")).toBe(true);
    expect(block.hasFile("a")).toBe(false);
  });

  test("应能 flush 后重新 load", () => {
    const blockFile = rootDir.peek("persist", "json");
    const block = new FileBlock(blockFile, { maxBlockSize: 1024 * 1024 });

    block.addFile("id-1", "payload").flush();

    const reloaded = new FileBlock(blockFile).load();
    expect(reloaded.hasFile("id-1")).toBe(true);
    expect(reloaded.getFile("id-1").content).toBe("payload");
  });

  test("应能从 source file 加入到块中", () => {
    const docsDir = rootDir.cd("docs").make();
    const source = docsDir.peek("note", "txt").write("note content");
    const block = new FileBlock(rootDir.peek("assets", "json"), {
      maxBlockSize: 1024 * 1024,
    });

    block.addFromSourceFile(source);

    const entry = block.getFile(source.getPath());
    expect(entry).not.toBeNull();
    expect(entry.content).toBe("note content");
  });

  test("FileBlock 不负责块大小约束，超大条目可正常加入", () => {
    const block = new FileBlock(rootDir.peek("small", "json"));

    expect(() => block.addFile("large", "x".repeat(2000))).not.toThrow();
    expect(block.hasFile("large")).toBe(true);
  });

  test("应能分割块并合并块", () => {
    const leftFile = rootDir.peek("left", "json");
    const rightFile = rootDir.peek("right", "json");

    const left = new FileBlock(leftFile, { maxBlockSize: 1024 * 1024 });
    const right = new FileBlock(rightFile, { maxBlockSize: 1024 * 1024 });

    left
      .addFile("f1", "1")
      .addFile("f2", "2")
      .addFile("f3", "3")
      .addFile("f4", "4");

    const result = left.split(right, (entry) => Number(entry.id[1]) >= 3);
    expect(result.movedIds.length).toBe(2);
    expect(left.listFiles().length).toBe(2);
    expect(right.listFiles().length).toBe(2);

    left.merge(right, { clearSource: true });
    expect(left.listFiles().length).toBe(4);
    expect(right.listFiles().length).toBe(0);
  });

  test("UnorderedBlockAllocator 应能绑定目录并自动分配块", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 180,
    }).load();

    allocator.addFile("a", "a".repeat(100));
    allocator.addFile("b", "b".repeat(100));
    allocator.addFile("c", "c".repeat(100));

    expect(allocator.getFile("a")).not.toBeNull();
    expect(allocator.getFile("b")).not.toBeNull();
    expect(allocator.getFile("c")).not.toBeNull();
    expect(allocator.listBlocks().length).toBeGreaterThanOrEqual(2);
  });

  test("UnorderedBlockAllocator 应能更新、删除并重建索引", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 512,
    }).load();

    allocator.addFile("id-1", { text: "hello" });
    allocator.addFile("id-2", { text: "world" });

    allocator.updateFile("id-2", { text: "updated" });
    expect(JSON.parse(allocator.getFile("id-2").content)).toEqual({
      text: "updated",
    });

    expect(allocator.removeFile("id-1")).toBe(true);
    expect(allocator.getFile("id-1")).toBeNull();

    const reloaded = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 512,
    }).load();
    expect(reloaded.getFile("id-2")).not.toBeNull();
    expect(reloaded.getFile("id-1")).toBeNull();
  });

  test("UnorderedBlockAllocator 应能合并块并 compact", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 180,
      maxBlockSize: 1024,
    }).load();

    allocator.addFile("f1", "1");
    allocator.addFile("f2", "2");
    allocator.addFile("f3", "3");

    const blocks = allocator.listBlocks();
    if (blocks.length >= 2) {
      allocator.mergeBlocks(blocks[0].blockId, blocks[1].blockId);
    }

    allocator.compact();
    expect(allocator.getFile("f1")).not.toBeNull();
    expect(allocator.getFile("f2")).not.toBeNull();
    expect(allocator.getFile("f3")).not.toBeNull();
  });

  test("UnorderedBlockAllocator 对超大文件应使用独立块", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 256,
    }).load();

    allocator.addFile("small-1", "a".repeat(20));
    allocator.addFile("small-2", "b".repeat(20));
    allocator.addFile("huge", "h".repeat(1200));

    const hugeLoc = allocator.locateFile("huge");
    const hugeBlock = hugeLoc.block;
    expect(hugeBlock.listFiles().length).toBe(1);
    expect(hugeBlock.hasFile("huge")).toBe(true);
  });

  test("UnorderedBlockAllocator 应提供 allocateForWrite 并按剩余空间排序选块", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 1024,
    }).load();

    allocator.addFile("s1", "a".repeat(50));
    allocator.addFile("s2", "b".repeat(120));
    allocator.addFile("s3", "c".repeat(180));

    const sorted = allocator.listBlocksByRemainingSpace("asc");
    expect(sorted.length).toBeGreaterThan(0);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].remainingSpace).toBeGreaterThanOrEqual(
        sorted[i - 1].remainingSpace,
      );
    }

    const sizeHint = allocator.estimateEntrySizeHint("planned", "z".repeat(40));
    const allocation = allocator.allocateForWrite(sizeHint);
    const expected = sorted.find((item) => item.remainingSpace >= sizeHint);

    if (expected) {
      expect(allocation.blockId).toBe(expected.blockId);
      expect(allocation.created).toBe(false);
    } else {
      expect(allocation.created).toBe(true);
    }
  });

  test("UnorderedBlockAllocator addFile 应遵循 allocateForWrite 的分配结果", () => {
    const blockDir = rootDir.cd("blocks");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 900,
    }).load();

    allocator.addFile("base-1", "x".repeat(80));
    allocator.addFile("base-2", "y".repeat(80));

    const payload = "k".repeat(60);
    const sizeHint = allocator.estimateEntrySizeHint("new-file", payload);
    const planned = allocator.allocateForWrite(sizeHint);

    allocator.addFile("new-file", payload);
    expect(allocator.locateFile("new-file").blockId).toBe(planned.blockId);
  });

  test("FileBlock 边界：重复 fileId 和少于 2 个条目时 split 应报错", () => {
    const left = new FileBlock(rootDir.peek("left-edge", "json"), {
      maxBlockSize: 1024,
    });
    const right = new FileBlock(rootDir.peek("right-edge", "json"), {
      maxBlockSize: 1024,
    });

    left.addFile("dup", "1");
    expect(() => left.addFile("dup", "2")).toThrow(/already exists/i);
    expect(() => left.split(right, () => true)).toThrow(/less than 2/i);
  });

  test("UnorderedBlockAllocator 边界：重复添加、删除不存在、非法 sizeHint", () => {
    const allocator = new UnorderedBlockAllocator(rootDir.cd("blocks-edge"), {
      minBlockSize: 64,
      maxBlockSize: 512,
    }).load();

    allocator.addFile("once", "payload");
    expect(() => allocator.addFile("once", "payload-2")).toThrow(
      /already exists/i,
    );
    expect(allocator.removeFile("missing")).toBe(false);
    expect(() => allocator.allocateForWrite(-1)).toThrow(/sizeHint/i);
    expect(() => allocator.allocateForWrite(Number.NaN)).toThrow(/sizeHint/i);
  });

  test("UnorderedBlockAllocator 边界：update 不存在应报错，merge 同块应 no-op", () => {
    const allocator = new UnorderedBlockAllocator(rootDir.cd("blocks-merge"), {
      minBlockSize: 64,
      maxBlockSize: 1024,
    }).load();

    expect(() => allocator.updateFile("not-found", "x")).toThrow(
      /does not exist/i,
    );

    allocator.addFile("f1", "1");
    const blockId = allocator.locateFile("f1").blockId;
    const before = allocator.listBlocks().length;
    allocator.mergeBlocks(blockId, blockId);
    const after = allocator.listBlocks().length;
    expect(after).toBe(before);
    expect(allocator.getFile("f1")).not.toBeNull();
  });

  test("UnorderedBlockAllocator 边界：降序剩余空间排序应正确", () => {
    const allocator = new UnorderedBlockAllocator(rootDir.cd("blocks-order"), {
      minBlockSize: 64,
      maxBlockSize: 1024,
    }).load();

    allocator.addFile("o1", "a".repeat(100));
    allocator.addFile("o2", "b".repeat(50));
    allocator.addFile("o3", "c".repeat(250));

    const desc = allocator.listBlocksByRemainingSpace("desc");
    for (let i = 1; i < desc.length; i++) {
      expect(desc[i].remainingSpace).toBeLessThanOrEqual(
        desc[i - 1].remainingSpace,
      );
    }
  });

  test("UnorderedBlockAllocator 压力：随机 add/update/remove 后索引与内容应一致", () => {
    const allocator = new UnorderedBlockAllocator(rootDir.cd("blocks-random"), {
      minBlockSize: 128,
      maxBlockSize: 1024,
    }).load();

    const expected = new Map();
    const pool = Array.from({ length: 80 }, (_, i) => `id-${i}`);

    for (let step = 0; step < 1000; step++) {
      const id = pool[Math.floor(Math.random() * pool.length)];
      const action = Math.random();

      if (!expected.has(id)) {
        const payload = `add-${step}-${"a".repeat(step % 60)}`;
        allocator.addFile(id, payload);
        expected.set(id, payload);
        continue;
      }

      if (action < 0.55) {
        const payload = `upd-${step}-${"b".repeat(step % 70)}`;
        allocator.updateFile(id, payload);
        expected.set(id, payload);
      } else {
        const removed = allocator.removeFile(id);
        expect(removed).toBe(true);
        expected.delete(id);
      }
    }

    // 1) 期望集合中的每个 id 都可定位且内容一致
    expected.forEach((payload, id) => {
      const entry = allocator.getFile(id);
      const loc = allocator.locateFile(id);
      expect(entry).not.toBeNull();
      expect(entry.content).toBe(payload);
      expect(loc).not.toBeNull();
      expect(loc.block.hasFile(id)).toBe(true);
    });

    // 2) 实际块中的条目集合应与期望集合完全一致
    const actualIds = new Set();
    allocator.listBlocks().forEach(({ blockId }) => {
      const block = allocator.blocks.get(blockId);
      block.listFiles().forEach((entry) => actualIds.add(entry.id));
    });

    expect(actualIds.size).toBe(expected.size);
    expected.forEach((_, id) => {
      expect(actualIds.has(id)).toBe(true);
    });
  });

  test("UnorderedBlockAllocator 边界：autoFlush=false 时仅 flush 后可恢复", () => {
    const blockDir = rootDir.cd("blocks-noflush");
    const allocator = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 1024,
      autoFlush: false,
    }).load();

    allocator.addFile("nf-1", "draft-content");

    // 未 flush 前，新实例不可见
    const beforeFlush = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 1024,
      autoFlush: false,
    }).load();
    expect(beforeFlush.getFile("nf-1")).toBeNull();

    // 手动 flush 后可见
    const loc = allocator.locateFile("nf-1");
    loc.block.flush();

    const afterFlush = new UnorderedBlockAllocator(blockDir, {
      minBlockSize: 64,
      maxBlockSize: 1024,
      autoFlush: false,
    }).load();
    expect(afterFlush.getFile("nf-1")).not.toBeNull();
    expect(afterFlush.getFile("nf-1").content).toBe("draft-content");
  });
});
