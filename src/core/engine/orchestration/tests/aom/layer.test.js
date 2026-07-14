import { DirectedGraph } from "../../../utils/directed-graph.js";
import { ActiveObjectManager, Layer } from "../../active-object-manager.js";

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
      expect(layer.active).toBe(true);
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
      aom.insertLayerUnderById(layer2, layer1.id);
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
      aom.insertLayerUnderById(layer1, layer4.id);
      aom.insertLayerUnderById(layer3, layer1.id);
      aom.insertLayerUnderById(layer2, layer1.id);

      expect(aom.compareLayerOrderById(layer3.id, layer2.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer2.id, layer1.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer4.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer4.id, layer1.id)).toBeGreaterThan(0);
      expect(aom.compareLayerOrderById(layer2.id, layer3.id)).toBeGreaterThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer2.id)).toBeGreaterThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer1.id)).toBe(0);
    });

    test("应正确比较层顺序（用 id 表示）", () => {
      const layer1 = new Layer(1);
      const layer2 = new Layer(2);
      const layer3 = new Layer(3);
      const layer4 = new Layer(4);
      // 顺序：layer3 -> layer2 -> layer1 -> layer4
      aom.insertLayerToTop(layer4);
      aom.insertLayerUnderById(layer1, layer4.id);
      aom.insertLayerUnderById(layer3, layer1.id);
      aom.insertLayerUnderById(layer2, layer1.id);

      expect(aom.compareLayerOrderById(layer3.id, layer2.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer2.id, layer1.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer4.id)).toBeLessThan(0);
      expect(aom.compareLayerOrderById(layer1.id, layer1.id)).toBe(0);
    });
  });
});
