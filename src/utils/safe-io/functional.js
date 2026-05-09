/**
 * 函数式编程工具模块
 *
 * 提供 Maybe（Option）单子实现，以及常用函数式辅助函数。
 *
 * @module functional
 */

// ==================== 基础构造器 ====================

/**
 * 将一个值包装成单元素数组
 *
 * 用于支持 Array 风格的链式操作（与 monadic 操作风格保持一致）。
 *
 * @param {*} x - 任意值
 * @returns {Array} 包含单个元素的数组
 */
export const of = (x) => [x];

/**
 * Some 构造器
 *
 * 表示一个存在的值（Maybe/Option 的成功分支）。
 *
 * @param {*} x - 包装的值
 * @returns {Object} Some 实例，包含 monadic 操作方法
 */
export const Some = (x) => ({
  __tag: "Some",

  /**
   * map :: (a -> b) -> Maybe b
   */
  map: (f) => Some(f(x)),

  /**
   * flatMap / chain / bind
   * 推荐使用 flatMap
   */
  flatMap: (f) => f(x),
  F: (f) => f(x),           // 保留别名，向下兼容
  chain: (f) => f(x),

  /**
   * ap :: Maybe (a -> b) -> Maybe b
   */
  ap: (m) => m.map((f) => f(x)),

  /**
   * getOrElse :: (() -> a) -> a
   */
  getOrElse: (_) => x,

  /**
   * orElse :: Maybe a -> Maybe a
   * Some 的 orElse 始终返回自身
   */
  orElse: (_) => Some(x),

  /**
   * fold :: (() -> b) -> (a -> b) -> b
   */
  fold: (onNone, onSome) => onSome(x),

  isSome: () => true,
  isNone: () => false,

  unwrap: () => x,
  unwrapOr: (_) => x,

  inspect: () => `Some(${x})`,
  toString: () => `Some(${x})`,
});

/**
 * None 构造器
 *
 * 表示一个不存在的值（Maybe/Option 的失败分支）。
 *
 * @returns {Object} None 实例，包含 monadic 操作方法
 */
export const None = () => ({
  __tag: "None",

  map: () => None(),
  flatMap: () => None(),
  F: () => None(),
  chain: () => None(),

  ap: () => None(),

  /**
   * getOrElse :: (() -> a) -> a
   * @param {Function} f - 默认值生成函数（支持延迟求值）
   */
  getOrElse: (f) => f(),

  /**
   * orElse :: Maybe a -> Maybe a
   * None 的 orElse 返回传入的备用 Option
   */
  orElse: (alt) => alt,

  /**
   * fold :: (() -> b) -> (a -> b) -> b
   */
  fold: (onNone, _) => onNone(),

  isSome: () => false,
  isNone: () => true,

  unwrap: () => { throw new Error("Cannot unwrap None"); },
  unwrapOr: (defaultValue) => defaultValue,

  inspect: () => "None",
  toString: () => "None",
});

/**
 * Option 智能构造器（推荐使用）
 *
 * - 如果传入函数，会安全执行该函数，捕获异常并转为 None
 * - 如果传入普通值：`null` 或 `undefined` → None，否则 → Some
 *
 * @param {*|Function} expr - 值或延迟求值函数
 * @returns {Object} Some 或 None 实例
 */
export const Option = (expr) => {
  if (typeof expr === "function") {
    try {
      const value = expr();
      return value != null ? Some(value) : None();   // null 或 undefined → None
    } catch (e) {
      console.error("Option constructor error:", e);
      return None();
    }
  }

  // 普通值：只有明确为 null 或 undefined 时才是 None
  return (expr != null) ? Some(expr) : None();
};

// ==================== 导出 ====================

/**
 * 默认导出对象，包含所有工具函数
 */
export default {
  of,
  Some,
  None,
  Option,
};