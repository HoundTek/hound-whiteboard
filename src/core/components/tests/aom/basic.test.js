const { RandomNumberPool } = require("../../../../utils/algorithm");
const { ActiveObjectManager } = require("../../active-object-manager");

describe("ActiveObjectManager/basic", () => {
  let aom = new ActiveObjectManager();

  beforeEach(() => {
    aom = new ActiveObjectManager();
  });

  describe("构造", () => {
    test("应正确构造 ActiveObjectManager 实例", () => {
      expect(aom).toBeInstanceOf(ActiveObjectManager);
      expect(aom.layerOrder).toEqual([]);
      expect(aom.layerIndex).toBeInstanceOf(Map);
      expect(aom.activeObjects).toBeInstanceOf(Set);
      expect(aom.layerPool).toBeInstanceOf(RandomNumberPool);
      expect(aom.onLayer).toBeInstanceOf(Map);
    });
  });
});
