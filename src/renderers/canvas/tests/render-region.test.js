/**
 * @jest-environment node
 */

/**
 * @file 区域重绘原语测试
 * @description 验证矩形区域重绘的相交剔除与裁剪顺序。
 * @module canvas/render-region-test
 * @author Zhou Chenyu
 */

import { Renderer } from "../renderer.js";
import { OBJECT_DRAW_STRATEGIES } from "../object-draw-strategies.js";
import { BasicObject } from "../../../kernel/objects/basic-obj.js";
import { RectangleRange } from "../../../kernel/range/rectangle.js";

/**
 * 共享绘制记录
 * @description 同时写入对象日志与当前上下文日志，便于核对裁剪与绘制的先后次序。
 * @type {{ current: Array<any> | null }}
 */
const sharedDrawLog = { current: null };

/**
 * 记录型对象
 * @description 注册真实绘制策略，让区域重绘走正式分派路径而不替换分派函数。
 */
class RecordingObject extends BasicObject {
  /**
   * @param {string} id - 对象 id
   * @param {Array<any>} log - 绘制记录
   */
  constructor(id, log) {
    super();
    this.id = id;
    this._log = log;
  }
}

OBJECT_DRAW_STRATEGIES.set(RecordingObject, (ctx, object) => {
  object._log.push(["draw", object.id]);
  sharedDrawLog.current?.push(["draw", object.id]);
});

/**
 * 记录型 2D 上下文
 */
class RecordingContext {
  /**
   * @param {Array<any>} log - 调用记录
   */
  constructor(log) {
    this.log = log;
  }

  /** @returns {void} */
  save() {
    this.log.push(["save"]);
  }

  /** @returns {void} */
  restore() {
    this.log.push(["restore"]);
  }

  /** @param {...number} args - 变换参数 @returns {void} */
  setTransform(...args) {
    this.log.push(["setTransform", ...args]);
  }

  /** @returns {void} */
  beginPath() {
    this.log.push(["beginPath"]);
  }

  /** @param {...number} args - 矩形参数 @returns {void} */
  rect(...args) {
    this.log.push(["rect", ...args]);
  }

  /** @returns {void} */
  clip() {
    this.log.push(["clip"]);
  }

  /** @param {...number} args - 清理参数 @returns {void} */
  clearRect(...args) {
    this.log.push(["clearRect", ...args]);
  }
}

/**
 * 构造一个绘制条目
 * @param {string} id - 对象 id
 * @param {Array<any>} drawLog - 绘制记录
 * @param {RectangleRange | undefined} screenRect - 屏幕矩形
 * @returns {{objectId: string, object: RecordingObject, screenRect?: RectangleRange}}
 */
function createEntry(id, drawLog, screenRect) {
  return {
    objectId: id,
    object: new RecordingObject(id, drawLog),
    screenRect,
  };
}

/**
 * 创建被测渲染器
 * @returns {Renderer}
 */
function createRenderer() {
  return new Renderer({ zoom: 1, origin: { x: 0, y: 0 } });
}

/**
 * 只保留上下文调用名，便于阅读裁剪顺序
 * @param {Array<any>} log - 调用记录
 * @returns {string[]}
 */
function callNames(log) {
  return log.map((call) => call[0]);
}

describe("Renderer#renderRegion", () => {
  test("只重绘与区域相交的对象，且保持条目给定的层叠顺序", () => {
    const renderer = createRenderer();
    const log = [];
    const drawLog = [];
    const entries = [
      createEntry("inside", drawLog, new RectangleRange(10, 10, 20, 20)),
      createEntry("outside", drawLog, new RectangleRange(400, 400, 20, 20)),
      createEntry("inside-too", drawLog, new RectangleRange(30, 30, 10, 10)),
    ];

    const count = renderer.renderRegion(
      new RecordingContext(log),
      {},
      entries,
      new RectangleRange(0, 0, 100, 100),
    );

    expect(count).toBe(2);
    expect(drawLog).toEqual([["draw", "inside"], ["draw", "inside-too"]]);
  });

  test("裁剪在 save 之后设置一次，所有绘制都在裁剪与 restore 之间", () => {
    const renderer = createRenderer();
    const log = [];
    const drawLog = [];
    const ctx = new RecordingContext(log);
    const viewportContext = {};
    const entries = [
      createEntry("a", drawLog, new RectangleRange(12, 22, 10, 10)),
      createEntry("b", drawLog, new RectangleRange(20, 30, 10, 10)),
    ];

    // 绘制同时记入上下文日志，才能核对裁剪与绘制的先后次序
    sharedDrawLog.current = log;

    renderer.renderRegion(
      ctx,
      viewportContext,
      entries,
      new RectangleRange(10.5, 20.25, 30.5, 40.75),
    );

    expect(callNames(log)).toEqual([
      "save",
      "setTransform",
      "beginPath",
      "rect",
      "clip",
      "draw",
      "draw",
      "restore",
    ]);
    expect(log.find((call) => call[0] === "rect")).toEqual([
      "rect",
      10.5,
      20.25,
      30.5,
      40.75,
    ]);
    expect(log.filter((call) => call[0] === "clip")).toHaveLength(1);
    sharedDrawLog.current = null;
  });

  test("部分相交的跨边界对象不被剔除，由裁剪负责裁边", () => {
    const renderer = createRenderer();
    const drawLog = [];
    const entries = [
      createEntry("straddling", drawLog, new RectangleRange(-50, -50, 60, 60)),
      createEntry("touching", drawLog, new RectangleRange(100, 0, 10, 10)),
      createEntry("apart", drawLog, new RectangleRange(101, 0, 10, 10)),
    ];

    const count = renderer.renderRegion(
      new RecordingContext([]),
      {},
      entries,
      new RectangleRange(0, 0, 100, 100),
    );

    expect(count).toBe(2);
    expect(drawLog).toEqual([["draw", "straddling"], ["draw", "touching"]]);
  });

  test("跨区域对象重绘时必须裁剪，否则越界部分会盖掉区域外的内容", () => {
    const renderer = createRenderer();
    const log = [];
    const drawLog = [];
    // 一个横跨整个区域的大对象，其绘制会落到区域之外
    const entries = [
      createEntry("wide", drawLog, new RectangleRange(-100, -100, 400, 400)),
    ];

    renderer.renderRegion(
      new RecordingContext(log),
      {},
      entries,
      new RectangleRange(0, 0, 50, 50),
    );

    // 大对象仍被重绘，但裁剪矩形限定在区域内，而不是对象自身范围
    expect(drawLog).toEqual([["draw", "wide"]]);
    expect(log.find((call) => call[0] === "rect")).toEqual([
      "rect",
      0,
      0,
      50,
      50,
    ]);
    expect(log.some((call) => call[0] === "clip")).toBe(true);
  });

  test("无屏幕矩形的条目不做剔除", () => {
    const renderer = createRenderer();
    const drawLog = [];

    const count = renderer.renderRegion(
      new RecordingContext([]),
      {},
      [createEntry("no-rect", drawLog, undefined)],
      new RectangleRange(0, 0, 10, 10),
    );

    expect(count).toBe(1);
    expect(drawLog).toEqual([["draw", "no-rect"]]);
  });

  test("区域内没有对象时不建立裁剪也不绘制", () => {
    const renderer = createRenderer();
    const log = [];
    const drawLog = [];

    const count = renderer.renderRegion(
      new RecordingContext(log),
      {},
      [createEntry("outside", drawLog, new RectangleRange(500, 500, 10, 10))],
      new RectangleRange(0, 0, 10, 10),
    );

    expect(count).toBe(0);
    expect(log).toEqual([]);
    expect(drawLog).toEqual([]);
  });

  test("无效区域直接返回，不触碰上下文", () => {
    const renderer = createRenderer();
    const log = [];

    expect(
      renderer.renderRegion(new RecordingContext(log), {}, [], null),
    ).toBe(0);
    expect(log).toEqual([]);
  });
});

describe("Renderer#clearRegion", () => {
  test("整数扩边后清理，避免子像素残留", () => {
    const renderer = createRenderer();
    const log = [];

    const cleared = renderer.clearRegion(
      new RecordingContext(log),
      new RectangleRange(10.2, 20.8, 30.5, 40.1),
    );

    expect(cleared).toBe(true);
    expect(log).toEqual([
      ["save"],
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 10, 20, 31, 41],
      ["restore"],
    ]);
  });

  test("无效区域跳过清理", () => {
    const renderer = createRenderer();
    const log = [];

    expect(renderer.clearRegion(new RecordingContext(log), null)).toBe(false);
    expect(log).toEqual([]);
  });
});

afterEach(() => {
  sharedDrawLog.current = null;
});
