import { Renderer } from "../renderer.js";
import { RectangleRange } from "../../../kernel/range/rectangle.js";
import { Vector } from "../../../kernel/utils/math.js";

/**
 * 假上下文基类
 * @description 方法与访问器都放在原型上，模拟真实 canvas 上下文的形态。
 */
class FakeContextBase {
  /**
   * @param {Array<any>} log - 调用记录
   */
  constructor(log) {
    this.log = log;
    this.style = "#000000";
  }

  /**
   * 记录一次 save 调用
   * @returns {void}
   */
  save() {
    this.log.push(["save"]);
  }

  /**
   * 记录一次 restore 调用
   * @returns {void}
   */
  restore() {
    this.log.push(["restore"]);
  }
}

/**
 * 假 2D 上下文
 */
class FakeContext extends FakeContextBase {
  /**
   * 记录一次 setTransform 调用
   * @param {...number} args - 变换参数
   * @returns {void}
   */
  setTransform(...args) {
    this.log.push(["setTransform", ...args]);
  }

  /**
   * 记录一次 lineTo 调用
   * @param {number} x - 横坐标
   * @param {number} y - 纵坐标
   * @returns {void}
   */
  lineTo(x, y) {
    this.log.push(["lineTo", x, y]);
  }

  /**
   * 读取描边色
   * @returns {string}
   */
  get strokeStyle() {
    return this.style;
  }

  /**
   * 写入描边色
   * @param {string} value - 颜色
   */
  set strokeStyle(value) {
    this.style = value;
  }

  /**
   * 模拟真实 canvas 上只能在原型上取得的方法
   * @returns {string}
   */
  onlyOnPrototype() {
    return "ok";
  }
}

/**
 * 创建被测渲染器
 * @param {{ zoom?: number, origin?: { x: number, y: number } }} [options={}] - 视口状态
 * @returns {Renderer} 渲染器
 */
function createRenderer(options = {}) {
  return new Renderer({
    zoom: options.zoom ?? 1,
    origin: options.origin ?? { x: 0, y: 0 },
  });
}

describe("Renderer#createViewportContext", () => {
  test("setTransform 应把视口缩放与平移折叠进变换", () => {
    const renderer = createRenderer({ zoom: 2, origin: { x: 120, y: -40 } });
    const ctx = new FakeContext([]);

    renderer.createViewportContext(ctx).setTransform(1, 0, 0, 1, 10, 20);

    expect(ctx.log).toEqual([
      ["setTransform", 2, 0, 0, 2, (10 - 120) * 2, (20 + 40) * 2],
    ]);
  });

  test("单位视口下 setTransform 应等价于原样转发", () => {
    const renderer = createRenderer();
    const ctx = new FakeContext([]);

    renderer.createViewportContext(ctx).setTransform(1, 0, 0, 1, 5, 7);

    expect(ctx.log).toEqual([["setTransform", 1, 0, 0, 1, 5, 7]]);
  });

  test("方法调用应转发到原上下文并保持 this 绑定", () => {
    const renderer = createRenderer();
    const ctx = new FakeContext([]);

    const viewportContext = renderer.createViewportContext(ctx);
    viewportContext.save();
    viewportContext.lineTo(3, 4);
    viewportContext.restore();

    // this 绑错时 log 会写进替身而不是 ctx，这里会看到空数组
    expect(ctx.log).toEqual([["save"], ["lineTo", 3, 4], ["restore"]]);
  });

  test("原型链上的方法也应可访问", () => {
    const renderer = createRenderer();
    const ctx = new FakeContext([]);

    expect(renderer.createViewportContext(ctx).onlyOnPrototype()).toBe("ok");
  });

  test("属性写入与读取应转发到原上下文", () => {
    const renderer = createRenderer();
    const ctx = new FakeContext([]);

    const viewportContext = renderer.createViewportContext(ctx);
    viewportContext.strokeStyle = "#ff0000";

    expect(ctx.style).toBe("#ff0000");
    expect(viewportContext.strokeStyle).toBe("#ff0000");
  });

  test("同一方法重复读取应返回同一引用", () => {
    // 回归保护：此前的 Proxy 实现每次属性读取都 bind 一个新函数，
    // 该开销会压进绘制策略的点循环，与点数成正比。
    const renderer = createRenderer();
    const ctx = new FakeContext([]);

    const viewportContext = renderer.createViewportContext(ctx);

    expect(viewportContext.lineTo).toBe(viewportContext.lineTo);
    expect(viewportContext.save).toBe(viewportContext.save);
  });
});

describe("Renderer#getObjectWorldRect", () => {
  /**
   * 创建带渲染包围盒的桩对象
   * @param {{ renderBounds?: RectangleRange, range?: RectangleRange, position?: Vector }} [options={}] - 桩选项
   * @returns {Object} 桩对象
   */
  function createStubObject(options = {}) {
    const stub = {
      position: options.position ?? new Vector(0, 0),
    };
    if (options.renderBounds) {
      stub.getRenderBounds = () => options.renderBounds;
    }
    if (options.range) {
      stub.getRange = () => options.range;
    }
    return stub;
  }

  test("应使用渲染包围盒并叠加对象位置", () => {
    const renderer = createRenderer();
    const stub = createStubObject({
      renderBounds: new RectangleRange(0, 0, 10, 20),
      position: new Vector(100, 200),
    });

    const rect = renderer.getObjectWorldRect(stub);

    expect(rect.left).toBeCloseTo(100, 9);
    expect(rect.top).toBeCloseTo(200, 9);
    expect(rect.width).toBeCloseTo(10, 9);
    expect(rect.height).toBeCloseTo(20, 9);
  });

  test("渲染包围盒退化时应回退到主判定范围", () => {
    // 子类未维护 rich.boundingBox 时它是零矩形；
    // 直接采用会把对象当作零面积，导致漏绘与漏失效。
    const renderer = createRenderer();
    const stub = createStubObject({
      renderBounds: new RectangleRange(0, 0, 0, 0),
      range: new RectangleRange(0, 0, 30, 40),
    });

    const rect = renderer.getObjectWorldRect(stub);

    expect(rect.width).toBeCloseTo(30, 9);
    expect(rect.height).toBeCloseTo(40, 9);
  });

  test("单点对象退化为零矩形时不影响其他轴向的尺寸", () => {
    const renderer = createRenderer();
    const stub = createStubObject({
      renderBounds: new RectangleRange(0, 0, 25, 0),
    });

    const rect = renderer.getObjectWorldRect(stub);

    expect(rect.width).toBeCloseTo(25, 9);
    expect(rect.height).toBeCloseTo(0, 9);
  });

  test("对象未提供渲染包围盒时应回退到主判定范围", () => {
    const renderer = createRenderer();
    const stub = createStubObject({
      range: new RectangleRange(0, 0, 5, 6),
    });

    const rect = renderer.getObjectWorldRect(stub);

    expect(rect.width).toBeCloseTo(5, 9);
    expect(rect.height).toBeCloseTo(6, 9);
  });
});
