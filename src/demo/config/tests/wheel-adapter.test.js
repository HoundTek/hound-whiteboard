/**
 * @file 滚轮适配器测试
 * @description 验证捏合缩放与双指平移的分流：带 ctrlKey 的 wheel 走锚点缩放，其余走平移。
 * @author Zhou Chenyu
 */

import { attachWheelAdapter } from "../dom-adapters.js";
import { ViewportTool } from "../viewport-tool.js";
import { Viewport } from "../../../ui/components/orchestration/viewport.js";
import { DevicesDAG } from "../../../ui/devices-dag/index.js";
import { createNoopCanvas } from "../../../test-support/noop-canvas.js";

/**
 * 创建假画布容器
 * @param {{ width?: number, height?: number, left?: number, top?: number }} [box] - 布局盒
 * @returns {Object} 假元素
 */
function createFakeAppLeft(box = {}) {
  const listeners = new Map();
  return {
    clientWidth: box.width ?? 800,
    clientHeight: box.height ?? 600,
    getBoundingClientRect() {
      return {
        left: box.left ?? 0,
        top: box.top ?? 0,
        width: this.clientWidth,
        height: this.clientHeight,
      };
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
  };
}

/**
 * 创建测试环境
 * @returns {{ appLeft: Object, emitted: Object[], viewport: Object, wheel: Function }}
 */
function createEnv() {
  const appLeft = createFakeAppLeft({ left: 10, top: 20 });
  const emitted = [];
  const board = {
    signalsEventBus: {
      emit(channel, payload) {
        emitted.push({ channel, payload });
      },
    },
  };
  const viewport = {
    viewportId: "main",
    zoom: 2,
    origin: { x: 100, y: 200 },
  };
  attachWheelAdapter(viewport, board, appLeft);
  /**
   * 派发一次 wheel 事件
   * @param {Object} [event={}] - 事件属性
   * @returns {void}
   */
  const wheel = (event = {}) =>
    appLeft.dispatch("wheel", {
      preventDefault() {},
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      ...event,
    });
  return { appLeft, emitted, viewport, wheel };
}

describe("滚轮适配器", () => {
  test("捏合缩放发 scale 信号并以指针为锚点", () => {
    const { emitted, wheel } = createEnv();

    wheel({ ctrlKey: true, deltaY: 50, clientX: 110, clientY: 220 });

    expect(emitted).toHaveLength(1);
    const [packet] = emitted[0].payload.signals;
    expect(packet.type).toBe("scale");
    // 口径：纵向捏合 100px 放大一倍，向下滚动（deltaY>0）为缩小
    expect(packet.context.value).toBeCloseTo(2 * 2 ** -0.5, 6);
    expect(packet.context.sourceType).toBe("pinch");
    // 锚点是画布坐标，需减掉画布在页面中的偏移
    expect(packet.context.anchor.x).toBe(100);
    expect(packet.context.anchor.y).toBe(200);
  });

  test("双指张开放大、捏合缩小", () => {
    const pinchOut = createEnv();
    pinchOut.wheel({ ctrlKey: true, deltaY: -100 });
    expect(pinchOut.emitted[0].payload.signals[0].context.value).toBeCloseTo(
      4,
      6,
    );

    const pinchIn = createEnv();
    pinchIn.wheel({ ctrlKey: true, deltaY: 100 });
    expect(pinchIn.emitted[0].payload.signals[0].context.value).toBeCloseTo(
      1,
      6,
    );
  });

  test("不带 ctrlKey 的滚轮仍然平移", () => {
    const { emitted, wheel } = createEnv();

    wheel({ deltaX: 20, deltaY: 30 });

    const [packet] = emitted[0].payload.signals;
    expect(packet.type).toBe("position");
    expect(packet.context.sourceType).toBe("wheel");
    // 平移量按当前缩放折算到世界坐标
    expect(packet.context.value.x).toBeCloseTo(100 + 20 / 2, 6);
    expect(packet.context.value.y).toBeCloseTo(200 + 30 / 2, 6);
  });

  test("行单位的滚轮先换算成像素再缩放", () => {
    const { emitted, wheel } = createEnv();

    wheel({ ctrlKey: true, deltaMode: 1, deltaY: 3 });

    const [packet] = emitted[0].payload.signals;
    // 1 行 = 16px，3 行 = 48px → 放大约 0.48 倍
    expect(packet.context.value).toBeCloseTo(2 * 2 ** (-48 / 100), 6);
  });

  test("捏合与平移信号都路由到视口 workflow", () => {
    const { emitted, wheel } = createEnv();

    wheel({ ctrlKey: true, deltaY: 10 });
    wheel({ deltaY: 10 });

    expect(emitted.map((item) => item.payload.to)).toEqual([
      "/main/workflows/viewport",
      "/main/workflows/viewport",
    ]);
  });
});

describe("ViewportTool 缩放锚点", () => {
  /**
   * 建立真实 Viewport 与工具
   * @returns {{ viewport: Viewport, tool: ViewportTool, restore: () => void }}
   */
  function createViewportEnv() {
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    const viewport = new Viewport(
      {
        rootElement: {},
        canvas: createNoopCanvas(),
        uiCanvas: createNoopCanvas(),
        worker: {
          addEventListener() {},
          removeEventListener() {},
          postMessage() {},
        },
      },
      {
        width: 800,
        height: 600,
        devicesDAG: new DevicesDAG(),
        getBoardApi: () => null,
      },
      { width: 800, height: 600 },
      "main",
    );
    viewport.setViewportState({ origin: { x: 0, y: 0 }, zoom: 1 });
    /**
     * 还原全局动画帧钩子
     * @returns {void}
     */
    const restore = () => {
      if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = previousRaf;
      if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = previousCancel;
    };
    return { viewport, tool: new ViewportTool(), restore };
  }

  test("带锚点时锚点下的世界坐标保持不动", () => {
    const { viewport, tool, restore } = createViewportEnv();
    const anchor = { x: 200, y: 150 };
    const before = viewport.screenPointToWorld(anchor);

    try {
      tool.process(
        { signals: [{ type: "scale", context: { value: 2, anchor } }] },
        { services: { viewport } },
      );

      const after = viewport.screenPointToWorld(anchor);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(viewport.zoom).toBe(2);
    } finally {
      viewport.destroy();
      restore();
    }
  });

  test("无锚点时仍以视口中心为锚点", () => {
    const { viewport, tool, restore } = createViewportEnv();
    const center = viewport.getViewportScreenCenter();
    const before = viewport.screenPointToWorld(center);

    try {
      tool.process(
        { signals: [{ type: "scale", context: { value: 0.5 } }] },
        { services: { viewport } },
      );

      const after = viewport.screenPointToWorld(center);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    } finally {
      viewport.destroy();
      restore();
    }
  });
});
