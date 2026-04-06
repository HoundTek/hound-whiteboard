const { DirectedGraph } = require("../../../utils/directed-graph");
const { ActiveObjectManager, Layer } = require("../../active-object-manager");

describe("ActiveObjectManager/layer", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

  describe("构造", () => {
    test("构造函数应正确初始化层", () => {
      const layer = new Layer(1);
      expect(layer).toBeInstanceOf(Layer);
      expect(layer.id).toBe(1);
      expect(layer.activeObjects).toEqual(new Set());
      expect(layer.inactiveGraph).toBeInstanceOf(DirectedGraph);
    });
  });

  describe("层管理", () => {
    test("应正确将层插入至顶层", () => {
      const layer1 = new Layer(1);
      const layer2 = new Layer(2);
      aom.insertLayerToTop(layer1);
      aom.insertLayerToTop(layer2);
      expect(aom.layerOrder).toEqual([layer1, layer2]);
      expect(aom.layerIndex.get(layer1.id)).toBe(0);
      expect(aom.layerIndex.get(layer2.id)).toBe(1);
    });

    test("应正确插入层", () => {
      const layer1 = new Layer(1);
      const layer2 = new Layer(2);
      aom.insertLayerToTop(layer1);
      aom.insertLayerUnder(layer2, layer1);
      expect(aom.layerOrder).toEqual([layer2, layer1]);
      expect(aom.layerIndex.get(layer1.id)).toBe(1);
      expect(aom.layerIndex.get(layer2.id)).toBe(0);
    });

    test("应正确比较层顺序", () => {
      const layer1 = new Layer(1);
      const layer2 = new Layer(2);
      const layer3 = new Layer(3);
      const layer4 = new Layer(4);
      // 顺序：layer3 -> layer2 -> layer1 -> layer4
      aom.insertLayerToTop(layer4);
      aom.insertLayerUnder(layer1, layer4);
      aom.insertLayerUnder(layer3, layer1);
      aom.insertLayerUnder(layer2, layer1);

      expect(aom.compareLayerOrder(layer3, layer2)).toBeLessThan(0);
      expect(aom.compareLayerOrder(layer2, layer1)).toBeLessThan(0);
      expect(aom.compareLayerOrder(layer1, layer4)).toBeLessThan(0);
      expect(aom.compareLayerOrder(layer4, layer1)).toBeGreaterThan(0);
      expect(aom.compareLayerOrder(layer2, layer3)).toBeGreaterThan(0);
      expect(aom.compareLayerOrder(layer1, layer2)).toBeGreaterThan(0);
      expect(aom.compareLayerOrder(layer1, layer1)).toBe(0);
    });

    test("应正确比较层顺序（用 id 表示）", () => {
      const layer1 = new Layer(1);
      const layer2 = new Layer(2);
      const layer3 = new Layer(3);
      const layer4 = new Layer(4);
      // 顺序：layer3 -> layer2 -> layer1 -> layer4
      aom.insertLayerToTop(layer4);
      aom.insertLayerUnder(layer1, layer4);
      aom.insertLayerUnder(layer3, layer1);
      aom.insertLayerUnder(layer2, layer1);

      expect(aom.compareLayerOrderById(layer3.id, layer2.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer2.id, layer1.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer4.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer1.id)).toBe(0);
    });
  });
});
