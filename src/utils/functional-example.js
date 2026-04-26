/**
 * 函数式编程工具使用示例
 * 
 * 演示 Option / Maybe 单子的常见用法
 * 
 * @file functional-example.js
 */

import { Some, None, Option, of } from "./functional.js";

// ==================== 1. 基本构造 ====================

console.log("=== 基本构造 ===");

const someValue = Some(42);
const noneValue = None();
const optionFromValue = Option(100);
const optionFromNull = Option(null);
const optionFromFunc = Option(() => 999);
const optionFromThrow = Option(() => { throw new Error("失败"); });

console.log("Some(42):", someValue.inspect());
console.log("None():", noneValue.inspect());
console.log("Option(100):", optionFromValue.inspect());
console.log("Option(null):", optionFromNull.inspect());
console.log("Option(() => 999):", optionFromFunc.inspect());
console.log("Option(抛出异常):", optionFromThrow.inspect());

// ==================== 2. 链式操作 ====================

console.log("\n=== 链式操作 ===");

const result1 = Some(5)
  .map(x => x * 2)
  .flatMap(x => Some(x + 10))
  .map(x => `结果是: ${x}`);

console.log("链式计算结果:", result1.unwrap());

// 使用 Option 安全处理可能失败的操作
const safeDivide = (a, b) => Option(() => {
  if (b === 0) throw new Error("除数不能为0");
  return a / b;
});

console.log("10 / 2 =", safeDivide(10, 2).unwrapOr("计算失败"));
console.log("10 / 0 =", safeDivide(10, 0).unwrapOr("计算失败"));

// ==================== 3. fold（模式匹配） ====================

console.log("\n=== fold 模式匹配 ===");

const describe = (opt) => opt.fold(
  () => "这是一个 None 值",
  (value) => `这是一个 Some 值，内容为: ${value}`
);

console.log(describe(Some("Hello")));
console.log(describe(None()));

// ==================== 4. getOrElse 与 orElse ====================

console.log("\n=== 默认值处理 ===");

console.log("Some 值默认值:", Some(123).getOrElse(() => 999));
console.log("None 值默认值:", None().getOrElse(() => 999));

const backup = Some("备用数据");
console.log("orElse 示例:", None().orElse(backup).inspect());

// ==================== 5. 与数组结合使用 ====================

console.log("\n=== 与数组结合 ===");

const numbers = [1, 2, 3, 0, 4];

const safeResults = numbers.map(n => 
  Option(() => 100 / n)
    .map(result => `100 / ${n} = ${result}`)
);

console.log("安全除法结果:", safeResults.map(r => r.unwrapOr("计算失败")));

// ==================== 6. ap（应用函子）示例 ====================

console.log("\n=== ap 应用函子 ===");

const add = Some(x => y => x + y);
const num1 = Some(10);
const num2 = Some(20);

const sum = add.ap(num1).ap(num2);
console.log("10 + 20 =", sum.unwrapOr("计算失败"));

export default { Some, None, Option };