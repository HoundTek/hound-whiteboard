const rust = require('../src/rust-bindings');

describe('Rust Example Module', () => {
  describe('add', () => {
    test('应该正确相加两个正数', () => {
      expect(rust.add(2, 3)).toBe(5);
    });

    test('应该正确处理负数', () => {
      expect(rust.add(-1, 1)).toBe(0);
      expect(rust.add(-5, -3)).toBe(-8);
    });

    test('应该正确处理零', () => {
      expect(rust.add(0, 5)).toBe(5);
      expect(rust.add(0, 0)).toBe(0);
    });
  });

  describe('fibonacci', () => {
    test('应该正确计算小的斐波那契数', () => {
      expect(rust.fibonacci(0)).toBe(0);
      expect(rust.fibonacci(1)).toBe(1);
      expect(rust.fibonacci(2)).toBe(1);
      expect(rust.fibonacci(3)).toBe(2);
      expect(rust.fibonacci(10)).toBe(55);
    });

    test('应该正确计算较大的斐波那契数', () => {
      expect(rust.fibonacci(20)).toBe(6765);
      expect(rust.fibonacci(30)).toBe(832040);
    });
  });

  describe('isPrime', () => {
    test('应该正确识别质数', () => {
      expect(rust.isPrime(2)).toBe(true);
      expect(rust.isPrime(3)).toBe(true);
      expect(rust.isPrime(5)).toBe(true);
      expect(rust.isPrime(7)).toBe(true);
      expect(rust.isPrime(11)).toBe(true);
      expect(rust.isPrime(97)).toBe(true);
    });

    test('应该正确识别非质数', () => {
      expect(rust.isPrime(0)).toBe(false);
      expect(rust.isPrime(1)).toBe(false);
      expect(rust.isPrime(4)).toBe(false);
      expect(rust.isPrime(8)).toBe(false);
      expect(rust.isPrime(10)).toBe(false);
      expect(rust.isPrime(100)).toBe(false);
    });
  });

  describe('sumArray', () => {
    test('应该正确求和数组', () => {
      expect(rust.sumArray([1, 2, 3, 4, 5])).toBe(15);
    });

    test('应该处理空数组', () => {
      expect(rust.sumArray([])).toBe(0);
    });

    test('应该处理负数', () => {
      expect(rust.sumArray([-1, 1])).toBe(0);
      expect(rust.sumArray([-5, -3, -2])).toBe(-10);
    });

    test('应该处理大数组', () => {
      const arr = Array.from({ length: 1000 }, (_, i) => i + 1);
      expect(rust.sumArray(arr)).toBe(500500);
    });
  });
});