/**
 * @file Board API 路由驻留准备测试
 * @description 验证 route 到对象/区块/类型索引的准备映射，以及调用顺序与释放。
 * @module kernel/api/tests/board-api-residency.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { jest } from "@jest/globals";
import {
  invokeBoardApiRoute,
  prepareRouteResidency,
} from "../board-api-residency.js";

/**
 * 创建最小可用的板核心替身
 * @returns {Object} 板核心替身
 */
function createFakeCore() {
  const node = {
    shareId: "a/op-1",
    memberIds: ["a/op-1"],
    children: [],
  };
  const tree = {
    head: node,
    root: { shareId: null },
    getActiveChain: () => [node],
    isOnActiveChain: (shareId) => shareId === node.shareId,
    findNode: (shareId) => (shareId === node.shareId ? node : null),
    getChildrenOf: () => [],
    getRedoTargetForSource: () => null,
  };
  const record = {
    id: "a/op-1",
    type: "ADD_OBJECT",
    source: "a",
    payload: { chunkId: "1", objectId: "a/1" },
  };
  return {
    width: 100,
    height: 100,
    memoryMode: () => false,
    undoTree: tree,
    operationLog: {
      get: (id) => (id === record.id ? record : null),
      getSupraIdMembers: (supraId) =>
        supraId === "a/supra-1" ? [record] : [],
    },
    hitCommitter: {
      source: "a",
      getSupraId: (key) => (key === "gesture" ? "a/supra-1" : null),
    },
    getObjectCoverChunks: () => new Set([1]),
    ensureObjectTypeIndex: jest.fn(async () => {}),
    ensureChunkMetadata: jest.fn(async () => {}),
    ensureObjectsResident: jest.fn(async () => "release-objects"),
    ensureChunksResident: jest.fn(async () => "release-chunks"),
  };
}

describe("prepareRouteResidency", () => {
  test("对象类 route 按参数准备对象驻留", async () => {
    const core = createFakeCore();
    const release = await prepareRouteResidency(core, "queryObject", {
      objectId: "a/1",
    });
    expect(core.ensureObjectsResident).toHaveBeenCalledWith(
      ["a/1"],
      "route:queryObject",
    );
    expect(release).toBe("release-objects");

    await prepareRouteResidency(core, "modifyObjects", {
      patches: [{ objectId: "a/1" }, { objectId: "a/2" }],
    });
    expect(core.ensureObjectsResident).toHaveBeenLastCalledWith(
      ["a/1", "a/2"],
      "route:modifyObjects",
    );

    await prepareRouteResidency(core, "deleteObjects", {
      objectIds: ["a/1"],
    });
    expect(core.ensureObjectsResident).toHaveBeenLastCalledWith(
      ["a/1"],
      "route:deleteObjects",
    );
  });

  test("queryObjectList 准备类型索引，queryChunkObjects 准备区块元数据", async () => {
    const core = createFakeCore();
    const release = await prepareRouteResidency(core, "queryObjectList");
    expect(core.ensureObjectTypeIndex).toHaveBeenCalledTimes(1);
    expect(release).toBeNull();

    await prepareRouteResidency(core, "queryChunkObjects", {
      chunkIds: [1, 2],
    });
    expect(core.ensureChunkMetadata).toHaveBeenCalledWith([1, 2]);
  });

  test("undo 按过渡记录准备区块驻留", async () => {
    const core = createFakeCore();
    const release = await prepareRouteResidency(core, "undo");
    expect(core.ensureChunksResident).toHaveBeenCalledWith(
      [1],
      "route-transition",
    );
    expect(release).toBe("release-chunks");
  });

  test("abortSupra 按超分子成员记录准备区块驻留", async () => {
    const core = createFakeCore();
    const release = await prepareRouteResidency(core, "abortSupra", {
      key: "gesture",
    });
    expect(core.ensureChunksResident).toHaveBeenCalledWith(
      [1],
      "route-transition",
    );
    expect(release).toBe("release-chunks");

    core.ensureChunksResident.mockClear();
    expect(
      await prepareRouteResidency(core, "abortSupra", { key: "missing" }),
    ).toBeNull();
    expect(core.ensureChunksResident).not.toHaveBeenCalled();
  });

  test("内存模式与无准备 route 直接返回 null", async () => {
    const core = createFakeCore();
    core.memoryMode = () => true;
    expect(await prepareRouteResidency(core, "queryObject", {})).toBeNull();
    expect(core.ensureObjectsResident).not.toHaveBeenCalled();

    const live = createFakeCore();
    expect(await prepareRouteResidency(live, "queryBoardInfo")).toBeNull();
  });
});

describe("invokeBoardApiRoute", () => {
  test("先准备、再调用、最后释放", async () => {
    const core = createFakeCore();
    const order = [];
    core.ensureObjectsResident = jest.fn(async () => () => {
      order.push("release");
    });
    const api = {
      deleteObjects: jest.fn(() => {
        order.push("invoke");
        return "ok";
      }),
    };

    const result = await invokeBoardApiRoute(core, api, "deleteObjects", {
      objectIds: ["a/1"],
    });

    expect(result).toBe("ok");
    expect(order).toEqual(["invoke", "release"]);
    expect(api.deleteObjects).toHaveBeenCalledWith(["a/1"], undefined);
  });

  test("准备失败时不调用 route", async () => {
    const core = createFakeCore();
    core.ensureObjectsResident = jest.fn(async () => {
      throw new Error("load failed");
    });
    const api = { deleteObjects: jest.fn() };

    await expect(
      invokeBoardApiRoute(core, api, "deleteObjects", { objectIds: ["a/1"] }),
    ).rejects.toThrow("load failed");
    expect(api.deleteObjects).not.toHaveBeenCalled();
  });

  test("未知 route 抛错", async () => {
    const core = createFakeCore();
    await expect(invokeBoardApiRoute(core, {}, "nope")).rejects.toThrow(
      "未知 route",
    );
  });
});
