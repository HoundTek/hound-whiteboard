/**
 * @file 状态访问工具
 * @description 提供测试中模拟节点状态读写的辅助函数。
 * @module core/test-support/state-fixtures
 * @author Zhou Chenyu
 */

/**
 * 创建模拟节点状态访问器
 * @description
 * 模拟 DevicesDAGHandlerContext 中的 getNodeState / setNodeState 行为。
 * @param {Object} [initialState={}] - 初始状态
 * @returns {{ getState: () => Object, setState: (path: string, nextState: Object) => Object }}
 *
 * @example
 *   const { getState, setState } = createStateAccess({ count: 0 });
 *   setState("/node", { count: 1 });
 *   expect(getState()).toEqual({ count: 1 });
 */
function createStateAccess(initialState = {}) {
  let state = { ...initialState };

  return {
    getState() {
      return state;
    },
    setState(path, nextState) {
      state = nextState ?? {};
      return state;
    },
  };
}

export { createStateAccess };
