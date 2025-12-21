const { RandomNumberPool } = require("../src/utils/algorithm");
const { randomInt } = require("crypto");

// 模拟 randomInt 以使测试具有确定性
jest.mock("crypto", () => ({
  randomInt: jest.fn(),
}));

describe("RandomNumberPool", () => {
  const MIN = 114514;
  const MAX = 114516;
  let pool = new RandomNumberPool(MIN, MAX);

  beforeEach(() => {
    pool = new RandomNumberPool(MIN, MAX);
    // 在每个测试前清除 mock
    randomInt.mockClear();
  });

  test("构造函数应正确初始化 min, max, length 和 pool", () => {
    expect(pool.min).toBe(MIN);
    expect(pool.max).toBe(MAX);
    expect(pool.length).toBe(0);
    expect(pool.pool).toEqual(new Set());
  });

  test("initFromArray 应能将范围内的数字添加到池中", () => {
    pool.initFromArray([1, 2, 3, 114515, 114514, 114517]);
    expect(pool.pool).toEqual(new Set([114514, 114515]));
    expect(pool.length).toEqual(2);
  });

  test("initFromArray 应能覆盖原有数据", () => {
    pool.initFromArray([114514]);
    pool.initFromArray([114515]);
    expect(pool.pool).toEqual(new Set([114515]));
    expect(pool.length).toEqual(1);
  })

  test("generate 应返回范围内唯一的随机数", () => {
    randomInt
      .mockReturnValueOnce(114514)
      .mockReturnValueOnce(114515)
      .mockReturnValueOnce(114516);

    const rnum1 = pool.generate();
    expect(rnum1).toBe(114514);
    expect(pool.include(114514)).toBe(true);

    const rnum2 = pool.generate();
    expect(rnum2).toBe(114515);
    expect(pool.include(114515)).toBe(true);

    const rnum3 = pool.generate();
    expect(rnum3).toBe(114516);
    expect(pool.include(114516)).toBe(true);
  });

  test("如果池已满，generate 应抛出错误", () => {
    pool.initFromArray([114514, 114515, 114516]); // 填满池子
    expect(pool.isFull()).toBe(true);
    expect(() => pool.generate()).toThrow(
      "RandomNumberPool: no space for a new number"
    );
  });

  test("remove 应从池中删除数字并在成功时返回 true", () => {
    pool.initFromArray([114514, 114515]);
    expect(pool.remove(114514)).toBe(true);
    expect(pool.include(114514)).toBe(false);
    expect(pool.remove(114515)).toBe(true);
    expect(pool.include(114515)).toBe(false);
  });

  test("如果数字不在池中，remove 应返回 false", () => {
    pool.initFromArray([114514]);
    expect(pool.remove(114515)).toBe(false);
    expect(pool.include(114514)).toBe(true);
  });

  test("add 应将数字添加到池中并在成功时返回 true", () => {
    expect(pool.add(114514)).toBe(true);
    expect(pool.include(114514)).toBe(true);
    expect(pool.add(114515)).toBe(true);
    expect(pool.include(114515)).toBe(true);
  });

  test("如果数字已在池中，add 应返回 false", () => {
    pool.add(114514);
    expect(pool.add(114514)).toBe(false);
    expect(pool.include(114514)).toBe(true);
  });

  test("如果数字超出范围，add 应返回 false", () => {
    expect(pool.add(114513)).toBe(false);
    expect(pool.add(114517)).toBe(false);
  });

  test("include 应在数字在池中时返回 true", () => {
    pool.add(114514);
    expect(pool.include(114514)).toBe(true);
  });

  test("include 应在数字不在池中时返回 false", () => {
    expect(pool.include(114514)).toBe(false);
  });

  test("include 应在数字超出范围时返回 false", () => {
    expect(pool.include(114513)).toBe(false);
    expect(pool.include(114517)).toBe(false);
  });

  test("isFull 应在池满时返回 true", () => {
    pool.add(114514);
    pool.add(114515);
    pool.add(114516);
    expect(pool.isFull()).toBe(true);
  });

  test("isFull 应在池未满时返回 false", () => {
    pool.add(114514);
    expect(pool.isFull()).toBe(false);
  });

  test("rename 应删除旧数字并生成一个新数字", () => {
    pool.add(114514);
    randomInt.mockReturnValueOnce(114515); // 要生成的新数字

    const newNum = pool.rename(114514);
    expect(newNum).toBe(114515);
    expect(pool.include(114514)).toBe(false);
    expect(pool.include(114515)).toBe(true);
  });

  test("如果生成新数字时池已满，rename 应抛出错误", () => {
    pool.initFromArray([114514, 114515, 114516]); // 填满池子
    expect(() => pool.rename(114514)).toThrow(
      "RandomNumberPool: no space for a new number"
    );
  });
});
