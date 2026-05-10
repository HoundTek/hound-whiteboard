import { None, Option, Some } from "../functional.js";

describe("safe-io 函数式工具", () => {
  test("Some 可以映射并解包值", () => {
    const result = Some(2).map((value) => value * 3);

    expect(result.isSome()).toBe(true);
    expect(result.unwrap()).toBe(6);
  });

  test("None 会使用回退访问器", () => {
    const result = None();

    expect(result.isNone()).toBe(true);
    expect(result.unwrapOr("fallback")).toBe("fallback");
    expect(result.getOrElse(() => "lazy")).toBe("lazy");
  });

  test("Option 会把空值转为 None 并捕获异常表达式", () => {
    expect(Option("value").unwrap()).toBe("value");
    expect(Option(null).isNone()).toBe(true);
    expect(Option(() => {
      throw new Error("boom");
    }).isNone()).toBe(true);
  });
});