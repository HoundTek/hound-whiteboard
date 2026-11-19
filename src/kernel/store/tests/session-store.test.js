/**
 * @file 会话存储测试
 * @description 验证会话存储布局语义：骨架创建幂等、元数据往返、对象快照读写、trash 移动、日志段拼接与段序号推进。
 * @module kernel/store/tests/session-store.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { createMemoryDriver } from "../../../io/driver/memory.js";
import { bindRoot } from "../../../io/driver/io-driver.js";
import { createSessionStore } from "../session-store.js";

/**
 * 装配 memory 驱动绑定的会话存储
 * @returns {Object} 会话存储
 */
function setup() {
  const driver = createMemoryDriver({ rootId: "mem" });
  return createSessionStore(bindRoot(driver, "mem"));
}

describe("SessionStore", () => {
  test("create 建立目录骨架与元数据，重复创建不覆盖已有元数据", async () => {
    const store = setup();
    expect(await store.exists()).toBe(false);
    expect(await store.create({ boardName: "白板" })).toBe(true);
    expect(await store.exists()).toBe(true);
    expect((await store.readMeta()).boardName).toBe("白板");

    await store.writeMeta({ boardName: "改名", lastTime: 42 });
    expect(await store.create({ boardName: "覆盖" })).toBe(true);
    expect((await store.readMeta()).boardName).toBe("改名");
  });

  test("元数据写入自动加盖格式版本", async () => {
    const store = setup();
    await store.create();
    expect((await store.readMeta()).formatVersion).toBe(1);
    await store.writeMeta({ lastTime: 100 });
    const meta = await store.readMeta();
    expect(meta.formatVersion).toBe(1);
    expect(meta.lastTime).toBe(100);
  });

  test("对象快照写入与全量读回（含斜杠 id 编码）", async () => {
    const store = setup();
    await store.create();
    await store.writeObject({ id: "demo/1", type: "StrokeObject", data: { points: [] } });
    await store.writeObject({ id: "test/core/2", type: "StrokeObject" });
    const objects = await store.readAllObjects();
    expect(objects.map((o) => o.id).sort()).toEqual(["demo/1", "test/core/2"]);
    expect(objects.find((o) => o.id === "demo/1").type).toBe("StrokeObject");
  });

  test("非法对象数据写入被拒绝", async () => {
    const store = setup();
    await store.create();
    expect(await store.writeObject({ id: 1 })).toBe(false);
    expect(await store.writeObject(null)).toBe(false);
  });

  test("loadAll({ includeObjects:false }) 跳过对象数据并返回类型索引", async () => {
    const store = setup();
    await store.create();
    await store.writeObject({
      id: "demo/1",
      type: "StrokeObject",
      data: { points: [{ x: 0, y: 0 }] },
    });
    await store.writeObject({ id: "demo/2", type: "CircleObject" });

    const full = await store.loadAll();
    expect(full.objects).toHaveLength(2);
    expect(full.objectIndex).toBeNull();

    const lazy = await store.loadAll({ includeObjects: false });
    expect(lazy.objects).toEqual([]);
    expect(lazy.objectIndex).toBeNull();
    const index = await store.readObjectTypeIndex();
    expect(index).toHaveLength(2);
    expect(index.find((entry) => entry.id === "demo/1")).toEqual({
      id: "demo/1",
      type: "StrokeObject",
    });
    expect(lazy.records).toEqual([]);
  });

  test("trash 条目写入与两侧移除", async () => {
    const store = setup();
    await store.create();
    await store.writeObject({ id: "demo/1", type: "StrokeObject" });
    await store.writeTrashEntry({
      data: { id: "demo/2", type: "StrokeObject" },
      chunks: [{ chunkId: "1", below: ["demo/1"], above: [] }],
    });

    expect(await store.readAllObjects()).toHaveLength(1);
    const trash = await store.readAllTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0].data.id).toBe("demo/2");
    expect(trash[0].chunks[0].below).toEqual(["demo/1"]);

    // 移除是幂等的（已不存在视为成功）
    expect(await store.removeObject("demo/1")).toBe(true);
    expect(await store.removeObject("demo/1")).toBe(true);
    expect(await store.readAllObjects()).toHaveLength(0);
    expect(await store.removeTrashObject("demo/2")).toBe(true);
    expect(await store.removeTrashObject("demo/404")).toBe(true);
    expect(await store.readAllTrash()).toHaveLength(0);
  });

  test("区块元数据写入与全量读回", async () => {
    const store = setup();
    await store.create();
    await store.writeChunkMetadata(1, {
      tierGraph: [["a", ["b"]]],
      objectCoverIndex: [["a", [1]]],
    });
    await store.writeChunkMetadata(2, { tierGraph: [], objectCoverIndex: [] });
    const list = await store.readAllChunkMetadata();
    expect(list).toHaveLength(2);
    const chunk1 = list.find((c) => c.chunkId === 1);
    expect(chunk1.tierGraph).toEqual([["a", ["b"]]]);
    expect(chunk1.objectCoverIndex).toEqual([["a", [1]]]);
  });

  test("日志段追加与全量读取（per-source 流、流内序号推进）", async () => {
    const store = setup();
    await store.create();

    const empty = await store.readAllRecords();
    expect(empty.records).toEqual([]);
    expect(empty.nextSegmentSeqBySource).toEqual({});

    await store.appendSegment("a", 0, [
      { id: "a/op-1", type: "add-object", source: "a" },
      { id: "a/op-2", type: "modify-object", source: "a" },
    ]);
    await store.appendSegment("a", 1, [
      { id: "a/op-3", type: "delete-object", source: "a" },
    ]);

    const { records, nextSegmentSeqBySource } = await store.readAllRecords();
    expect(records.map((r) => r.id)).toEqual(["a/op-1", "a/op-2", "a/op-3"]);
    expect(nextSegmentSeqBySource).toEqual({ a: 2 });
  });

  test("空段不落成文件；非法来源、段序号与记录被拒绝", async () => {
    const store = setup();
    await store.create();
    expect(await store.appendSegment("a", 0, [])).toBe(0);
    expect((await store.readAllRecords()).nextSegmentSeqBySource).toEqual({});
    expect(await store.appendSegment("", 0, [{ id: "x" }])).toBe(false);
    expect(await store.appendSegment("a", -1, [{ id: "x" }])).toBe(false);
    expect(await store.appendSegment("a", 0, null)).toBe(false);
  });

  test("段内损坏行被跳过，合法行保留", async () => {
    const driver = createMemoryDriver({ rootId: "mem2" });
    const d = bindRoot(driver, "mem2");
    const store = createSessionStore(d);
    await store.create();
    await d.write(
      "hit/a/seg-000000.jsonl",
      '{"id":"a/op-1","source":"a"}\n{bad json\n{"id":"a/op-2","source":"a"}\n',
    );
    const { records } = await store.readAllRecords();
    expect(records.map((r) => r.id)).toEqual(["a/op-1", "a/op-2"]);
  });

  test("多流归并：按来源分组定序并按 id 去重", async () => {
    const driver = createMemoryDriver({ rootId: "mem3" });
    const d = bindRoot(driver, "mem3");
    const store = createSessionStore(d);
    await store.create();
    // a 的流（两段，含一条重复记录）与 c 的流
    await store.appendSegment("a", 0, [
      { id: "a/op-1", source: "a", time: 1 },
      { id: "a/op-2", source: "a", time: 3 },
    ]);
    await store.appendSegment("a", 1, [
      { id: "a/op-2", source: "a", time: 3 },
      { id: "a/op-3", source: "a", time: 4 },
    ]);
    await store.appendSegment("c", 0, [{ id: "c/op-1", source: "c", time: 5 }]);
    // hit/ 下的散文件（非流目录）一律不读
    await d.write("hit/seg-000000.jsonl", '{"id":"x/op-1","source":"x"}\n');

    const { records, nextSegmentSeqBySource } = await store.readAllRecords();
    // 组按 source 字典序拼接，组内按操作序号升序，重复 id 只保留首现
    expect(records.map((r) => r.id)).toEqual([
      "a/op-1",
      "a/op-2",
      "a/op-3",
      "c/op-1",
    ]);
    expect(nextSegmentSeqBySource).toEqual({ a: 2, c: 1 });
  });

  test("段序号自愈：期望序号被占用时递增到空位并返回实际序号", async () => {
    const store = setup();
    await store.create();
    await store.appendSegment("a", 0, [{ id: "a/op-1", source: "a" }]);
    // 另一个写端持有落后的序号：占用冲突时避让而不是覆盖
    const used = await store.appendSegment("a", 0, [
      { id: "a/op-2", source: "a" },
    ]);
    expect(used).toBe(1);
    const { records } = await store.readAllRecords();
    expect(records.map((r) => r.id)).toEqual(["a/op-1", "a/op-2"]);
  });

  test("对象文件原子写：盘上无临时文件残留", async () => {
    const driver = createMemoryDriver({ rootId: "mem" });
    const d = bindRoot(driver, "mem");
    const store = createSessionStore(d);
    await store.create();
    await store.writeObject({ id: "a/1", type: "StrokeObject" });
    await store.writeTrashEntry({ data: { id: "a/2", type: "StrokeObject" }, chunks: [] });
    for (const dir of ["objects", "trash"]) {
      const names = (await d.ls(dir)).map((e) => e.name);
      expect(names.every((n) => !n.startsWith(".tmp-"))).toBe(true);
    }
    expect((await store.readAllObjects()).map((o) => o.id)).toEqual(["a/1"]);
    expect((await store.readAllTrash()).map((e) => e.data.id)).toEqual([
      "a/2",
    ]);
  });

  test("per-source 元数据分片：写入读回与 loadAll 归并", async () => {
    const store = setup();
    await store.create();
    await store.writeSourceMeta("a", {
      lastTime: 10,
      coreIdCounters: { a: 3 },
    });
    await store.writeSourceMeta("b", {
      lastTime: 20,
      objectIdCounters: { b: 5 },
    });
    // board.json 存量兜底字段（boardConfig 与老板计数）
    await store.writeMeta({
      boardConfig: { width: 800, height: 600 },
      lastTime: 5,
      coreIdCounters: { legacy: 1 },
    });

    const session = await store.loadAll();
    expect(session.sourceMeta.a.coreIdCounters).toEqual({ a: 3 });
    // lastTime 取全源最大；计数表按 key 并入（分片覆盖板级同名 key）
    expect(session.meta.lastTime).toBe(20);
    expect(session.meta.coreIdCounters).toEqual({ legacy: 1, a: 3 });
    expect(session.meta.objectIdCounters).toEqual({ b: 5 });
    expect(session.meta.boardConfig).toEqual({ width: 800, height: 600 });
  });

  test("损坏的来源分片被跳过", async () => {
    const driver = createMemoryDriver({ rootId: "mem" });
    const d = bindRoot(driver, "mem");
    const store = createSessionStore(d);
    await store.create();
    await store.writeSourceMeta("a", { lastTime: 10 });
    await d.write("meta/bad.json", "{oops");
    await d.write("meta/.tmp-leftover", "{}");
    const sourceMeta = await store.readAllSourceMeta();
    expect(Object.keys(sourceMeta)).toEqual(["a"]);
  });
});
