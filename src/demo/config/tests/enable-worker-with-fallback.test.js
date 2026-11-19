/**
 * @file enable-worker-with-fallback 测试
 * @description 验证持久化开板失败回退内存模式的装配策略，以及 owner 冲突时不回退。
 * @module demo/config/tests/enable-worker-with-fallback.test
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";

import { enableWorkerWithFallback } from "../enable-worker-with-fallback.js";

/**
 * 构造假 worker
 * @returns {{ terminate: jest.Mock }} 假 worker
 */
function makeWorker() {
  return { terminate: jest.fn() };
}

/**
 * 构造假 Board（仅 helper 依赖的接口面）
 * @param {Object} [overrides={}] - 覆盖项
 * @returns {{ rootPath: string | undefined, enableWorkerMode: jest.Mock }} 假 Board
 */
function makeBoard(overrides = {}) {
  return {
    rootPath: "/board",
    enableWorkerMode: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("enableWorkerWithFallback", () => {
  test("首次装配成功时直接返回 worker，不触发回退", async () => {
    const board = makeBoard();
    const worker = makeWorker();
    const onFallback = jest.fn();

    const result = await enableWorkerWithFallback(board, () => worker, {
      onFallback,
    });

    expect(result).toBe(worker);
    expect(onFallback).not.toHaveBeenCalled();
    expect(board.rootPath).toBe("/board");
  });

  test("持久化开板失败时清空 rootPath 并换新 worker 回退内存模式", async () => {
    const failure = new Error("RPC timeout: createBoard");
    const board = makeBoard({
      enableWorkerMode: jest
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({}),
    });
    const staleWorker = makeWorker();
    const freshWorker = makeWorker();
    const workers = [staleWorker, freshWorker];
    const onFallback = jest.fn();

    const result = await enableWorkerWithFallback(board, () => workers.shift(), {
      onFallback,
    });

    expect(result).toBe(freshWorker);
    expect(staleWorker.terminate).toHaveBeenCalledTimes(1);
    expect(board.rootPath).toBeUndefined();
    expect(onFallback).toHaveBeenCalledWith(failure);
    expect(board.enableWorkerMode).toHaveBeenCalledTimes(2);
  });

  test("owner 冲突时直接抛出，不回退内存模式", async () => {
    const conflict = new Error("板目录已被其他持有者认领");
    const board = makeBoard({
      enableWorkerMode: jest.fn().mockRejectedValue(conflict),
    });
    const worker = makeWorker();
    const onFallback = jest.fn();

    await expect(
      enableWorkerWithFallback(board, () => worker, { onFallback }),
    ).rejects.toBe(conflict);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
    expect(board.rootPath).toBe("/board");
    expect(board.enableWorkerMode).toHaveBeenCalledTimes(1);
  });

  test("内存模式开板失败（无 rootPath）时直接抛出，不重试", async () => {
    const failure = new Error("worker 脚本加载失败");
    const board = makeBoard({
      rootPath: undefined,
      enableWorkerMode: jest.fn().mockRejectedValue(failure),
    });
    const worker = makeWorker();

    await expect(
      enableWorkerWithFallback(board, () => worker),
    ).rejects.toBe(failure);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(board.enableWorkerMode).toHaveBeenCalledTimes(1);
  });

  test("回退重试仍失败时终止新 worker 并抛出", async () => {
    const retryFailure = new Error("内存模式也失败");
    const board = makeBoard({
      enableWorkerMode: jest
        .fn()
        .mockRejectedValueOnce(new Error("持久化失败"))
        .mockRejectedValueOnce(retryFailure),
    });
    const staleWorker = makeWorker();
    const freshWorker = makeWorker();
    const workers = [staleWorker, freshWorker];

    await expect(
      enableWorkerWithFallback(board, () => workers.shift()),
    ).rejects.toBe(retryFailure);
    expect(staleWorker.terminate).toHaveBeenCalledTimes(1);
    expect(freshWorker.terminate).toHaveBeenCalledTimes(1);
  });
});
