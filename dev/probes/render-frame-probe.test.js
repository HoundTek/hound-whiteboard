/**
 * @jest-environment node
 */

/**
 * @file 渲染帧指纹探针测试
 * @description 验证探针能区分「位图突变」与「仅显示画布突变」，并能产出可导出的帧历史。
 * @module ui/render-frame-probe-test
 * @author Zhou Chenyu
 */

import { createCanvas } from "@napi-rs/canvas";
import {
  createRenderFrameProbe,
  PROBE_SAMPLE_GRID,
} from "./render-frame-probe.js";

/**
 * 生成一张纯色源画布
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {string} color - 填充色
 * @returns {ReturnType<typeof createCanvas>} 画布
 */
function makeSource(width, height, color) {
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").fillStyle = color;
  canvas.getContext("2d").fillRect(0, 0, width, height);
  return canvas;
}

/**
 * 创建使用真实光栅器的探针
 * @param {Object} [options={}] - 覆盖选项
 * @returns {{ probe: Object, messages: string[] }} 探针与日志
 */
function makeProbe(options = {}) {
  const messages = [];
  const probe = createRenderFrameProbe({
    enabled: true,
    createCanvas: (width, height) => createCanvas(width, height),
    logger: (message) => messages.push(message),
    ...options,
  });
  return { probe, messages };
}

describe("渲染帧指纹探针", () => {
  test("未启用时不采样也不记录", () => {
    const probe = createRenderFrameProbe({
      createCanvas: (width, height) => createCanvas(width, height),
    });
    expect(probe.enabled).toBe(false);
    const result = probe.sampleFrame({
      bitmap: makeSource(40, 40, "#000"),
      bitmapWidth: 40,
      bitmapHeight: 40,
      canvas: makeSource(40, 40, "#000"),
      canvasWidth: 40,
      canvasHeight: 40,
    });
    expect(result).toBeNull();
    expect(probe.getHistory()).toHaveLength(0);
  });

  test("内容不变时相邻帧亮度差接近零", () => {
    const { probe, messages } = makeProbe();
    const bitmap = makeSource(80, 80, "#ffffff");
    const canvas = makeSource(80, 80, "#ffffff");

    probe.sampleFrame({
      bitmap,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas,
      canvasWidth: 80,
      canvasHeight: 80,
    });
    const second = probe.sampleFrame({
      bitmap,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas,
      canvasWidth: 80,
      canvasHeight: 80,
    });

    expect(Math.abs(second.bitmapLumaDelta)).toBeLessThan(1);
    expect(Math.abs(second.canvasLumaDelta)).toBeLessThan(1);
    expect(messages).toHaveLength(0);
  });

  test("位图突变时报告为 Worker 产出层问题", () => {
    const { probe, messages } = makeProbe();
    const white = makeSource(80, 80, "#ffffff");
    const black = makeSource(80, 80, "#000000");

    probe.sampleFrame({
      bitmap: white,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas: white,
      canvasWidth: 80,
      canvasHeight: 80,
      meta: { frameId: 1 },
    });
    const record = probe.sampleFrame({
      bitmap: black,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas: black,
      canvasWidth: 80,
      canvasHeight: 80,
      meta: { frameId: 2 },
    });

    expect(record.bitmapLumaDelta).toBeLessThan(-100);
    expect(messages[0]).toContain("Worker 产出层");
    expect(probe.getAnomalies()).toHaveLength(1);
    expect(probe.getAnomalies()[0].frameId).toBe(2);
  });

  test("仅显示画布突变时报告为 UI 合成层问题", () => {
    const { probe, messages } = makeProbe();
    const white = makeSource(80, 80, "#ffffff");
    const black = makeSource(80, 80, "#000000");

    probe.sampleFrame({
      bitmap: white,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas: white,
      canvasWidth: 80,
      canvasHeight: 80,
    });
    probe.sampleFrame({
      bitmap: white,
      bitmapWidth: 80,
      bitmapHeight: 80,
      canvas: black,
      canvasWidth: 80,
      canvasHeight: 80,
    });

    expect(messages[0]).toContain("UI 合成层");
    expect(probe.getAnomalies()).toHaveLength(1);
  });

  test("导出的帧历史不含指纹点列，且携带元数据", () => {
    const { probe } = makeProbe();
    const source = makeSource(60, 60, "#3366cc");
    for (let index = 1; index <= 3; index++) {
      probe.sampleFrame({
        bitmap: source,
        bitmapWidth: 60,
        bitmapHeight: 60,
        canvas: source,
        canvasWidth: 60,
        canvasHeight: 60,
        meta: {
          frameId: index,
          originX: 1.25,
          canvasWidth: 60,
          devicePixelRatio: 2,
        },
      });
    }

    const history = probe.getHistory();
    expect(history).toHaveLength(3);
    expect(history[2].frameId).toBe(3);
    expect(history[2].originX).toBe(1.25);
    expect(history[2].devicePixelRatio).toBe(2);
    expect(history[2].bitmapPrint).toBeUndefined();
    expect(history[2].canvasPrint).toBeUndefined();
  });

  test("历史长度受 historyLimit 限制", () => {
    const { probe } = makeProbe({ historyLimit: 5 });
    const source = makeSource(40, 40, "#888888");
    for (let index = 0; index < 12; index++) {
      probe.sampleFrame({
        bitmap: source,
        bitmapWidth: 40,
        bitmapHeight: 40,
        canvas: source,
        canvasWidth: 40,
        canvasHeight: 40,
        meta: { frameId: index },
      });
    }
    const history = probe.getHistory();
    expect(history).toHaveLength(5);
    expect(history[4].frameId).toBe(11);
  });

  test("采样网格为固定尺寸，与源尺寸无关", () => {
    const { probe } = makeProbe();
    const source = makeSource(320, 200, "#123456");
    probe.sampleFrame({
      bitmap: source,
      bitmapWidth: 320,
      bitmapHeight: 200,
      canvas: source,
      canvasWidth: 320,
      canvasHeight: 200,
    });
    const raw = probe.sampleFrame({
      bitmap: source,
      bitmapWidth: 320,
      bitmapHeight: 200,
      canvas: source,
      canvasWidth: 320,
      canvasHeight: 200,
    });
    expect(raw.bitmapPrint.points).toHaveLength(
      PROBE_SAMPLE_GRID * PROBE_SAMPLE_GRID,
    );
  });
});

describe("A-B-A 瞬变检测", () => {
  test("突变后下一帧恢复时报告 A-B-A 瞬变", () => {
    const { probe, messages } = makeProbe();
    const white = makeSource(80, 80, "#ffffff");
    const black = makeSource(80, 80, "#000000");
    const frame = (bitmap, canvas, frameId) =>
      probe.sampleFrame({
        bitmap,
        bitmapWidth: 80,
        bitmapHeight: 80,
        canvas,
        canvasWidth: 80,
        canvasHeight: 80,
        meta: { frameId },
      });

    frame(white, white, 1);
    frame(black, black, 2); // 突变
    frame(white, white, 3); // 恢复

    const recovered = messages.find((m) => m.includes("A-B-A 单帧闪烁"));
    expect(recovered).toBeDefined();
    expect(recovered).toContain("Worker 产出层");
  });

  test("局部闪烁（整体亮度几乎不变）也能检出", () => {
    const { probe, messages } = makeProbe();
    // 33×33 网格里只有一个小圆点被遮住：整体平均亮度几乎不动，
    // 亮度阈值检测不到，必须靠指纹级 A-B-A 判定
    const clean = makeSource(80, 80, "#ffffff");
    const flashed = createCanvas(80, 80);
    flashed.getContext("2d").drawImage(clean, 0, 0);
    flashed.getContext("2d").fillStyle = "#000000";
    flashed.getContext("2d").fillRect(35, 35, 4, 4);

    const frame = (source, frameId) => {
      const record = probe.sampleFrame({
        bitmap: source,
        bitmapWidth: 80,
        bitmapHeight: 80,
        canvas: source,
        canvasWidth: 80,
        canvasHeight: 80,
        meta: { frameId },
      });
      return record;
    };

    frame(clean, 1);
    const spike = frame(flashed, 2);
    const back = frame(clean, 3);

    // 整体亮度变化远小于 6 的阈值，亮度通道抓不到
    expect(Math.abs(spike.bitmapLumaDelta)).toBeLessThan(1);

    // 指纹级 A-B-A 仍然抓到
    expect(back.transient).toBeDefined();
    expect(back.transient.kind).toBe("aba");
    expect(back.transient.layer).toBe("bitmap");
    expect(messages[0]).toContain("A-B-A 单帧闪烁（Worker 产出层）");
  });

  test("持续变化的内容不会被误判为瞬变", () => {
    const { probe, messages } = makeProbe({ lumaJumpThreshold: 4 });
    const gray = (value) => makeSource(80, 80, `rgb(${value},${value},${value})`);

    // 逐帧单调变暗，永不回到基线
    for (let index = 0; index < 12; index++) {
      const source = gray(255 - index * 20);
      probe.sampleFrame({
        bitmap: source,
        bitmapWidth: 80,
        bitmapHeight: 80,
        canvas: source,
        canvasWidth: 80,
        canvasHeight: 80,
        meta: { frameId: index },
      });
    }

    expect(messages.some((m) => m.includes("A-B-A 瞬变已恢复"))).toBe(false);
  });
});

describe("渲染决策元数据", () => {
  test("Worker 侧 renderStats 会随帧记录保留", () => {
    const { probe } = makeProbe();
    const source = makeSource(40, 40, "#eeeeee");
    probe.sampleFrame({
      bitmap: source,
      bitmapWidth: 40,
      bitmapHeight: 40,
      canvas: source,
      canvasWidth: 40,
      canvasHeight: 40,
      meta: {
        frameId: 7,
        dirtyRectCount: 3,
        fullClear: false,
        cacheRebuild: "partial",
        aomEntryCount: 2,
        tilesDrawn: false,
      },
    });

    const [record] = probe.getHistory();
    expect(record.dirtyRectCount).toBe(3);
    expect(record.fullClear).toBe(false);
    expect(record.cacheRebuild).toBe("partial");
    expect(record.aomEntryCount).toBe(2);
    expect(record.tilesDrawn).toBe(false);
  });
});
