/**
 * Rust 原生模块绑定
 * @module rust-bindings
 */

const native = require('../../index.js');

module.exports = {
  /**
   * 两数相加
   * @param {number} a - 第一个数
   * @param {number} b - 第二个数
   * @returns {number} 和
   */
  add: native.add,

  /**
   * 计算斐波那契数列第 n 项
   * @param {number} n - 项数
   * @returns {number} 斐波那契数
   */
  fibonacci: native.fibonacci,

  /**
   * 判断是否为质数
   * @param {number} n - 要判断的数
   * @returns {boolean} 是否为质数
   */
  isPrime: native.isPrime,

  /**
   * 数组求和
   * @param {number[]} arr - 数字数组
   * @returns {number} 数组和
   */
  sumArray: native.sumArray,
};