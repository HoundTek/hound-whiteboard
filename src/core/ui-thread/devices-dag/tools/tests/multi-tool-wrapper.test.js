/**
 * @file MultiToolWrapper 测试
 * @author Zhou Chenyu
 */

import { jest } from "@jest/globals";
import { MultiToolWrapper } from "../multi-tool-wrapper.js";
import { Tool } from "../tool.js";
import { DevicesDAGNode } from "../../dag-node-edge.js";
import { createSubDAG } from "../../index.js";
import { TOUCHSCREEN_DEVICE_SIGNAL_TYPES } from "../../devices/touchscreen-device.js";

/**
 * 记录调用历史的 Mock 工具
 * @class
 */
class MockTool extends Tool {
  constructor() {
    super();
    this.calls = [];
  }

  process(signalPacket, context) {
    this.calls.push({
      signals: signalPacket.signals.map((s) => ({
        type: s.type,
        value: s.context?.value ?? null,
      })),
      serviceKeys: Object.keys(context?.services ?? {}),
      accKeys: Object.keys(context?.acc ?? {}),
    });
  }

  reset() {
    this.calls = [];
  }
}

describe("MultiToolWrapper", () => {
  const CONTACTS = TOUCHSCREEN_DEVICE_SIGNAL_TYPES.CONTACTS;

  /**
   * 构造一个 touch-contacts 信号包
   * @param {Array<{touchId: string, position?: {x:number,y:number}}>} changed - 发生变化的触点
   * @param {Array<{touchId: string, position?: {x:number,y:number}}>} [extraContacts] - 额外静止触点
   * @returns {Object}
   */
  function buildContactsPacket(changed, extraContacts = []) {
    const active = [
      ...changed.filter((c) => c.position != null),
      ...extraContacts,
    ];
    return {
      signals: [
        {
          type: CONTACTS,
          context: {
            contacts: active.map((c) => ({
              touchId: c.touchId,
              position: c.position,
            })),
            changedTouchIds: changed.map((c) => c.touchId),
            activeTouchIds: active.map((c) => c.touchId),
          },
        },
      ],
    };
  }

  const defaultCtx = { acc: { board: {}, viewport: {} } };

  /**
   * 创建一个可追踪实例的 spy 工厂函数，使用 builder + createGraph 构建入口节点
   * @param {Array<MockTool>} spyOut - 实例写入此数组
   * @returns {(touchId: string) => DevicesDAGNode}
   */
  function createTrackedTool(spyOut) {
    return (_touchId) => {
      const instance = new MockTool();
      spyOut.push(instance);
      const builder = createSubDAG("/touch");
      builder.node().handler((pkt, ctx) => {
        instance.process(pkt, ctx);
      });
      return DevicesDAGNode.createGraph(builder.build());
    };
  }

  test("单触点应创建工具实例，发送 position 信号，抬起时发送 end", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 10, y: 20 } }]),
      defaultCtx,
    );

    expect(instances).toHaveLength(1);
    expect(instances[0].calls).toHaveLength(1);
    expect(instances[0].calls[0].signals).toEqual([
      { type: "position", value: { x: 10, y: 20 } },
    ]);

    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 15, y: 25 } }]),
      defaultCtx,
    );

    expect(instances).toHaveLength(1);
    expect(instances[0].calls).toHaveLength(2);
    expect(instances[0].calls[1].signals).toEqual([
      { type: "position", value: { x: 15, y: 25 } },
    ]);

    wrapper.process(
      buildContactsPacket([{ touchId: "0" }]), // 无 position → 抬起
      defaultCtx,
    );

    expect(instances[0].calls).toHaveLength(3);
    expect(instances[0].calls[2].signals).toEqual([
      { type: "end", value: null },
    ]);
  });

  test("双触点应创建两个独立工具实例，各自接收独立信号", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      buildContactsPacket([
        { touchId: "0", position: { x: 10, y: 20 } },
        { touchId: "1", position: { x: 100, y: 200 } },
      ]),
      defaultCtx,
    );

    expect(instances).toHaveLength(2);

    const [tool0, tool1] = instances;
    expect(tool0.calls).toHaveLength(1);
    expect(tool0.calls[0].signals).toEqual([
      { type: "position", value: { x: 10, y: 20 } },
    ]);
    expect(tool1.calls[0].signals).toEqual([
      { type: "position", value: { x: 100, y: 200 } },
    ]);

    wrapper.process(
      buildContactsPacket([
        { touchId: "0", position: { x: 20, y: 30 } },
        { touchId: "1", position: { x: 110, y: 210 } },
      ]),
      defaultCtx,
    );

    expect(tool0.calls).toHaveLength(2);
    expect(tool0.calls[1].signals).toEqual([
      { type: "position", value: { x: 20, y: 30 } },
    ]);
    expect(tool1.calls[1].signals).toEqual([
      { type: "position", value: { x: 110, y: 210 } },
    ]);
  });

  test("双指先后抬起——只结束对应触点的工具实例", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      buildContactsPacket([
        { touchId: "0", position: { x: 10, y: 20 } },
        { touchId: "1", position: { x: 100, y: 200 } },
      ]),
      defaultCtx,
    );

    expect(instances).toHaveLength(2);
    const [tool0, tool1] = instances;

    // 手指 0 抬起，手指 1 保持
    wrapper.process(
      buildContactsPacket(
        [{ touchId: "0" }],
        [{ touchId: "1", position: { x: 110, y: 210 } }],
      ),
      defaultCtx,
    );

    // 被移除的工具收到了 end
    expect(tool0.calls).toHaveLength(2);
    expect(tool0.calls[1].signals).toEqual([{ type: "end", value: null }]);

    // 保留的工具不受影响，仍只有第一个 position
    expect(tool1.calls).toHaveLength(1);

    // 手指 1 还可继续移动
    wrapper.process(
      buildContactsPacket([{ touchId: "1", position: { x: 120, y: 220 } }]),
      defaultCtx,
    );
    expect(tool1.calls).toHaveLength(2);
    expect(tool1.calls[1].signals).toEqual([
      { type: "position", value: { x: 120, y: 220 } },
    ]);
  });

  test("触点中途加入——新触点创建新实例，旧实例不受影响", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    // 手指 0 先按下并移动一次
    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 10, y: 20 } }]),
      defaultCtx,
    );
    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 15, y: 25 } }]),
      defaultCtx,
    );

    const tool0 = instances[0];

    // 手指 1 中途加入
    wrapper.process(
      buildContactsPacket([
        { touchId: "0", position: { x: 20, y: 30 } },
        { touchId: "1", position: { x: 100, y: 200 } },
      ]),
      defaultCtx,
    );

    expect(instances).toHaveLength(2);
    const tool1 = instances[1];

    // 手指 0 收到第 3 次 position（不受新手指影响）
    expect(tool0.calls).toHaveLength(3);
    expect(tool0.calls[2].signals).toEqual([
      { type: "position", value: { x: 20, y: 30 } },
    ]);

    // 手指 1 只收到 1 次 position（第一次）
    expect(tool1.calls).toHaveLength(1);
    expect(tool1.calls[0].signals).toEqual([
      { type: "position", value: { x: 100, y: 200 } },
    ]);
  });

  test("非 touch-contacts 信号应被忽略，不创建任何实例", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      { signals: [{ type: "mousedown", context: { value: { x: 1, y: 2 } } }] },
      defaultCtx,
    );

    expect(instances).toHaveLength(0);
  });

  test("changedTouchIds 为空时应跳过，不创建任何实例", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      {
        signals: [
          {
            type: CONTACTS,
            context: {
              contacts: [{ touchId: "0", position: { x: 10, y: 20 } }],
              changedTouchIds: [],
              activeTouchIds: ["0"],
            },
          },
        ],
      },
      defaultCtx,
    );

    expect(instances).toHaveLength(0);
  });

  test("reset 应销毁所有实例并清空内部 Map（新建实例不受影响）", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));

    wrapper.process(
      buildContactsPacket([
        { touchId: "0", position: { x: 10, y: 20 } },
        { touchId: "1", position: { x: 100, y: 200 } },
      ]),
      defaultCtx,
    );

    expect(instances).toHaveLength(2);

    wrapper.reset();

    // reset 后新触点应新建实例
    wrapper.process(
      buildContactsPacket([{ touchId: "2", position: { x: 50, y: 60 } }]),
      defaultCtx,
    );

    expect(instances).toHaveLength(3);

    // 旧实例已被清理，新实例只收到新的 position
    const newTool = instances[2];
    expect(newTool.calls).toHaveLength(1);
    expect(newTool.calls[0].signals).toEqual([
      { type: "position", value: { x: 50, y: 60 } },
    ]);
  });

  test("应透传 deviceContext 给工具实例", () => {
    const instances = [];
    const wrapper = new MultiToolWrapper(createTrackedTool(instances));
    const customCtx = {
      acc: {
        board: { id: "board-1" },
        viewport: { zoom: 2 },
        boardApi: { createObject: jest.fn() },
      },
    };

    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 10, y: 20 } }]),
      customCtx,
    );

    expect(instances[0].calls[0].serviceKeys).toEqual(
      expect.arrayContaining(["board", "viewport", "boardApi"]),
    );
    expect(instances[0].calls[0].accKeys).toEqual([]);
  });

  test("per-touch handoff 子图：entry → first → second，end 信号触发移交", () => {
    const instances = [];

    const factory = (_touchId) => {
      const firstTool = new MockTool();
      const secondTool = new MockTool();
      instances.push(firstTool, secondTool);

      const builder = createSubDAG("/touch");

      // entry：信号原样路由到 first
      const entry = builder.node().handler((pkt, _ctx) => ({
        to: "first",
        signals: pkt.signals,
      }));

      // first：处理信号，收到 end 时移交到 second
      const first = builder.node().handler((pkt, ctx) => {
        firstTool.process(pkt, ctx);
        const hasEnd = pkt.signals.some((s) => s.type === "end");
        return hasEnd ? { to: "second", signals: pkt.signals } : undefined;
      });

      // second：仅处理信号
      const second = builder.node().handler((pkt, ctx) => {
        secondTool.process(pkt, ctx);
      });

      builder.edge("first", entry, first);
      builder.edge("second", first, second);

      return DevicesDAGNode.createGraph(builder.build());
    };

    const wrapper = new MultiToolWrapper(factory);

    // 手指按下
    wrapper.process(
      buildContactsPacket([{ touchId: "0", position: { x: 10, y: 20 } }]),
      defaultCtx,
    );

    // position 只到达 first，未移交到 second
    expect(instances[0].calls).toHaveLength(1);
    expect(instances[0].calls[0].signals).toEqual([
      { type: "position", value: { x: 10, y: 20 } },
    ]);
    expect(instances[1].calls).toHaveLength(0);

    // 手指抬起 → end 信号先到 first（记录），再移交到 second（记录）
    wrapper.process(buildContactsPacket([{ touchId: "0" }]), defaultCtx);

    expect(instances[0].calls).toHaveLength(2);
    expect(instances[0].calls[1].signals).toEqual([
      { type: "end", value: null },
    ]);
    expect(instances[1].calls).toHaveLength(1);
    expect(instances[1].calls[0].signals).toEqual([
      { type: "end", value: null },
    ]);
  });

  describe("会话可观察性", () => {
    test("getActiveTouchCount 应反映当前活跃触点数", () => {
      const instances = [];
      const wrapper = new MultiToolWrapper(createTrackedTool(instances));
      expect(wrapper.getActiveTouchCount()).toBe(0);

      wrapper.process(
        buildContactsPacket([{ touchId: "t1", position: { x: 1, y: 1 } }]),
        defaultCtx,
      );
      expect(wrapper.getActiveTouchCount()).toBe(1);

      wrapper.process(
        buildContactsPacket(
          [{ touchId: "t2", position: { x: 5, y: 5 } }],
          [{ touchId: "t1", position: { x: 2, y: 2 } }],
        ),
        defaultCtx,
      );
      expect(wrapper.getActiveTouchCount()).toBe(2);

      // t1 抬起
      wrapper.process(
        buildContactsPacket(
          [{ touchId: "t1" }],
          [{ touchId: "t2", position: { x: 5, y: 5 } }],
        ),
        defaultCtx,
      );
      expect(wrapper.getActiveTouchCount()).toBe(1);
    });

    test("getSessionDebugInfo 应返回会话摘要", () => {
      const instances = [];
      const wrapper = new MultiToolWrapper(createTrackedTool(instances));

      wrapper.process(
        buildContactsPacket([{ touchId: "t1", position: { x: 1, y: 1 } }]),
        defaultCtx,
      );

      const sessions = wrapper.getSessionDebugInfo();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].touchId).toBe("t1");
      expect(sessions[0].sessionId).toBe(0);
      expect(typeof sessions[0].createdAt).toBe("number");
    });

    test("reset 应清空会话并重置 sessionId 计数器", () => {
      const instances = [];
      const wrapper = new MultiToolWrapper(createTrackedTool(instances));

      wrapper.process(
        buildContactsPacket([{ touchId: "t1", position: { x: 1, y: 1 } }]),
        defaultCtx,
      );
      expect(wrapper.getActiveTouchCount()).toBe(1);

      wrapper.reset();
      expect(wrapper.getActiveTouchCount()).toBe(0);
      expect(wrapper.getSessionDebugInfo()).toHaveLength(0);

      // reset 后新触点应从 sessionId=0 重新开始
      wrapper.process(
        buildContactsPacket([{ touchId: "t2", position: { x: 2, y: 2 } }]),
        defaultCtx,
      );
      const sessions = wrapper.getSessionDebugInfo();
      expect(sessions[0].sessionId).toBe(0);
    });
  });
});
