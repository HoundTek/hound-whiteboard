/**
 * @file 同步收敛性质测试
 * @description 随机操作脚本在多个端上产生记录流，按来源保序、跨来源随机交错投递，断言任意到达顺序收敛到同一状态。
 * @module kernel/api/tests/sync-convergence.test
 * @author Zhou Chenyu
 * SPDX-License-Identifier: MIT
 */

import { BoardApi } from "../board-api.js";
import { BoardCore } from "../../board/board-core.js";
import { createDefaultAomRenderHooks } from "../../board/aom-render-hooks.js";
import { createDefaultPersistenceAdapter } from "../../board/persistence-adapter.js";

/**
 * 确定性随机数发生器（mulberry32）
 * @param {number} seed - 种子
 * @returns {() => number} 返回 [0,1) 随机数的函数
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 创建一个端（独立的 BoardCore 与 BoardApi）
 * @param {string} source - 端标识
 * @param {() => number} now - 确定性时间源（各端共享逻辑时钟）
 * @returns {{boardCore: BoardCore, api: BoardApi}} 端
 */
function createEnd(source, now) {
  const boardCore = new BoardCore({
    width: 800,
    height: 600,
    source,
    now,
    aomRenderHooks: createDefaultAomRenderHooks(),
    persistenceAdapter: createDefaultPersistenceAdapter(),
  });
  return { boardCore, api: new BoardApi(boardCore) };
}

/**
 * 计算端的状态摘要（收敛断言口径）
 * @param {BoardCore} boardCore - 白板核心
 * @returns {Object} 状态摘要
 */
function digestOf(boardCore) {
  const objects = {};
  for (const obj of boardCore.getAllObjects()) {
    objects[obj.id] = JSON.stringify(obj.serialize());
  }
  return {
    logIds: boardCore.operationLog
      .toJSON()
      .map((record) => record.id)
      .sort(),
    head: boardCore.undoTree.head?.shareId ?? null,
    objects,
    trash: [...boardCore.trash.keys()].sort(),
  };
}

/**
 * 随机操作执行器：在指定端上执行一步随机操作
 * @param {Object} end - 端
 * @param {() => number} rand - 随机数源
 * @param {number} step - 步骤序号（造 id 用）
 * @returns {Promise<void>}
 */
async function randomOp(end, rand, step) {
  const { boardCore, api } = end;
  const roll = rand();
  const ownIds = boardCore
    .getAllObjects()
    .map((obj) => obj.id)
    .filter(
      (id) =>
        !boardCore.activeObjectManager.isActive(id) &&
        !boardCore.activeObjectManager.isRemoteActive(id),
    );

  if (roll < 0.4) {
    // 创建一笔
    const id = `${end.boardCore.hitCommitter.source}/s${step}`;
    const x = Math.floor(rand() * 700);
    api.createObject("StrokeObject", {
      id,
      position: { x, y: Math.floor(rand() * 500) },
      property: { width: 2 },
      data: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    });
    await api.commitObjects([id]);
    return;
  }
  if (roll < 0.65 && ownIds.length > 0) {
    // 选择 + 修改 + 提交（≈ 拖拽/属性修改）
    const id = ownIds[Math.floor(rand() * ownIds.length)];
    await api.addActiveObjects([id]);
    api.modifyObject(id, {
      position: { x: Math.floor(rand() * 700), y: Math.floor(rand() * 500) },
    });
    await api.commitObjects([id]);
    return;
  }
  if (roll < 0.75 && ownIds.length > 0) {
    // 删除
    const id = ownIds[Math.floor(rand() * ownIds.length)];
    await api.deleteObjects([id]);
    return;
  }
  if (roll < 0.85) {
    // 数据擦除（随机横线）
    const y = Math.floor(rand() * 500);
    await api.eraseData({
      points: [
        { x: 0, y },
        { x: 800, y },
      ],
      radius: 3,
    });
    return;
  }
  if (roll < 0.95) {
    api.undo();
    return;
  }
  api.redo();
}

describe("同步收敛性质", () => {
  const SEEDS = [1, 7, 42, 2024, 31415];
  const END_SOURCES = ["a", "b", "c"];
  const STEPS = 24;

  for (const seed of SEEDS) {
    test(`种子 ${seed}：随机操作任意交错投递后三端收敛`, async () => {
      const rand = mulberry32(seed);
      // 共享逻辑时钟：确定性时间标记，无同毫秒并列
      let tick = 0;
      const now = () => (tick += 1000);
      const ends = END_SOURCES.map((s) => createEnd(s, now));
      /** 各来源的完整记录流（按 seq 升序） @type {Map<string, Object[]>} */
      const streams = new Map(END_SOURCES.map((s) => [s, []]));
      /** 各接收端对各来源的已投递位置 @type {Map<string, Map<string, number>>} */
      const cursors = new Map(
        END_SOURCES.map((s) => [
          s,
          new Map(END_SOURCES.map((t) => [t, 0])),
        ]),
      );

      /**
       * 收割各端日志新增记录进入来源流
       * @returns {void}
       */
      const harvest = () => {
        for (const end of ends) {
          const source = end.boardCore.hitCommitter.source;
          const records = end.boardCore.operationLog.toJSON();
          const stream = streams.get(source);
          // 本地日志含远端记录，只取本来源且未收割的部分
          const own = records.filter((r) => r.source === source);
          for (let i = stream.length; i < own.length; i++) {
            stream.push(own[i]);
          }
        }
      };

      /**
       * 投递一步：随机挑一个父已满足的（接收端, 来源）对投递下一批
       * @returns {Promise<boolean>} 是否投递成功
       *
       * @description
       * 投递粒度与真实通道一致：超分子成员同批完整到达（发送侧重微任务合批保证原子性）。
       */
      const deliverOne = async () => {
        const eligible = [];
        for (const end of ends) {
          const receiver = end.boardCore.hitCommitter.source;
          const log = end.boardCore.operationLog;
          for (const source of END_SOURCES) {
            if (source === receiver) continue;
            const cursor = cursors.get(receiver).get(source);
            const stream = streams.get(source);
            if (cursor >= stream.length) continue;
            const next = stream[cursor];
            if (next.parentId === null || log.has(next.parentId)) {
              eligible.push([receiver, source]);
            }
          }
        }
        if (eligible.length === 0) return false;
        const [receiver, source] =
          eligible[Math.floor(rand() * eligible.length)];
        const end = ends.find(
          (e) => e.boardCore.hitCommitter.source === receiver,
        );
        const cursor = cursors.get(receiver).get(source);
        const stream = streams.get(source);
        // 批次：独立记录单条；超分子连同其全部连续成员
        const batch = [stream[cursor]];
        if (stream[cursor].supraOpId !== null) {
          let i = cursor + 1;
          while (
            i < stream.length &&
            stream[i].supraOpId === stream[cursor].supraOpId
          ) {
            batch.push(stream[i]);
            i++;
          }
        }
        await end.api.applyRemoteOperations(batch);
        cursors.get(receiver).set(source, cursor + batch.length);
        return true;
      };

      /**
       * 全部未投递记录排空
       * @returns {Promise<void>}
       */
      const drainAll = async () => {
        for (let guard = 0; guard < 10000; guard++) {
          const remaining = END_SOURCES.some((receiver) =>
            END_SOURCES.some(
              (source) =>
                source !== receiver &&
                cursors.get(receiver).get(source) < streams.get(source).length,
            ),
          );
          if (!remaining) return;
          if (!(await deliverOne())) {
            throw new Error("投递死锁：无父已满足的待投递记录");
          }
        }
        throw new Error("投递排空超出护栏");
      };

      // 随机操作脚本，间或投递
      for (let step = 0; step < STEPS; step++) {
        const end = ends[Math.floor(rand() * ends.length)];
        try {
          await randomOp(end, rand, step);
        } catch {
          // 无效操作（如远程活跃对象）跳过，不产生记录
        }
        harvest();
        while (rand() < 0.6) {
          if (!(await deliverOne())) break;
        }
      }
      await drainAll();

      const [first, ...rest] = ends.map((end) =>
        JSON.stringify(digestOf(end.boardCore)),
      );
      for (const other of rest) {
        expect(other).toBe(first);
      }
    });
  }
});
