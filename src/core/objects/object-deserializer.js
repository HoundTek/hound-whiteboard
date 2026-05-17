/**
 * @file 对象反序列化器
 * @module core/objects/object-deserializer
 * @author Zhou Chenyu
 */

import { BasicObject } from "./basic-obj.js";
import { PolygonObject } from "./graph/polygon.js";
import { TextObject } from "./one-dim/text.js";
import { StrokeObject } from "./stroke/stroke.js";

/**
 * @type {Map<string, {parse: function}>}
 * @description
 * 反序列化器注册表，映射对象类型字符串到对应的解析器类。
 * 每个解析器类必须实现一个静态 parse 方法，用于将序列化数据转换回对象实例。
 */
const parserRegistry = new Map([
  ["PolygonObject", PolygonObject],
  ["TextObject", TextObject],
  ["StrokeObject", StrokeObject],
]);

/**
 * 规范化序列化对象
 * @param {string | JSON} data - 序列化的对象数据，可以是 JSON 字符串或已经解析的 JSON 对象
 * @returns {JSON} 规范化后的 JSON 对象
 * @throws {SyntaxError} 如果输入是无效的 JSON 字符串
 */
function normalizeSerializedObject(data) {
  if (typeof data === "string") {
    return JSON.parse(data);
  }

  return data;
}

/**
 * 反序列化对象
 * @param {string | JSON} data - 序列化的对象数据，可以是 JSON 字符串或已经解析的 JSON 对象
 * @returns {BasicObject} 反序列化后的对象实例
 * @throws {TypeError} 如果输入的数据格式不正确或对象类型不支持
 */
function deserialize(data) {
  const serializedObject = normalizeSerializedObject(data);

  if (
    !serializedObject ||
    typeof serializedObject !== "object" ||
    Array.isArray(serializedObject)
  ) {
    throw new TypeError(
      "Serialized object must be a plain object or JSON string",
    );
  }

  if (typeof serializedObject.type !== "string") {
    throw new TypeError("Serialized object must contain a string type field");
  }

  const parser = parserRegistry.get(serializedObject.type);
  if (!parser || typeof parser.parse !== "function") {
    throw new TypeError(`Unsupported object type: ${serializedObject.type}`);
  }

  return parser.parse(serializedObject);
}

/**
 * 注册自定义反序列化器
 * @param {string} type - 对象类型字符串，用于标识反序列化器
 * @param {{parse: function}} parser - 反序列化器类，必须实现一个静态 parse 方法
 * @throws {TypeError} 如果类型或解析器不符合要求
 */
function registerDeserializer(type, parser) {
  if (typeof type !== "string" || type.length === 0) {
    throw new TypeError("Deserializer type must be a non-empty string");
  }

  if (!parser || typeof parser.parse !== "function") {
    throw new TypeError(
      "Deserializer parser must expose a static parse function",
    );
  }

  parserRegistry.set(type, parser);
}

export { deserialize, registerDeserializer };
