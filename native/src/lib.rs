#![deny(clippy::all)]

use napi_derive::napi;

/// 两数相加
#[napi]
pub fn add(a: i32, b: i32) -> i32 {
  a + b
}

/// 计算斐波那契数列第 n 项
#[napi]
pub fn fibonacci(n: u32) -> i64 {
  if n <= 1 {
    return n as i64;
  }
  
  let mut prev = 0i64;
  let mut curr = 1i64;
  
  for _ in 2..=n {
    let next = prev + curr;
    prev = curr;
    curr = next;
  }
  
  curr
}

/// 判断是否为质数
#[napi]
pub fn is_prime(n: u32) -> bool {
  if n < 2 {
    return false;
  }
  if n == 2 {
    return true;
  }
  if n % 2 == 0 {
    return false;
  }
  
  let sqrt_n = (n as f64).sqrt() as u32;
  for i in (3..=sqrt_n).step_by(2) {
    if n % i == 0 {
      return false;
    }
  }
  
  true
}

/// 数组求和
#[napi]
pub fn sum_array(arr: Vec<i32>) -> i32 {
  arr.iter().sum()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_add() {
    assert_eq!(add(2, 3), 5);
    assert_eq!(add(-1, 1), 0);
  }

  #[test]
  fn test_fibonacci() {
    assert_eq!(fibonacci(0), 0);
    assert_eq!(fibonacci(1), 1);
    assert_eq!(fibonacci(10), 55);
    assert_eq!(fibonacci(20), 6765);
  }

  #[test]
  fn test_is_prime() {
    assert_eq!(is_prime(2), true);
    assert_eq!(is_prime(3), true);
    assert_eq!(is_prime(4), false);
    assert_eq!(is_prime(7), true);
    assert_eq!(is_prime(10), false);
    assert_eq!(is_prime(17), true);
  }

  #[test]
  fn test_sum_array() {
    assert_eq!(sum_array(vec![1, 2, 3, 4, 5]), 15);
    assert_eq!(sum_array(vec![]), 0);
    assert_eq!(sum_array(vec![-1, 1]), 0);
  }
}