/**
 * @file 路径工具
 * @description 提供路径片段规整和拼接等基础路径处理函数。
 * @module core/engine/utils/path
 * @author Zhou Chenyu
 */

/**
 * 将路径规整为片段数组。
 *
 * 前导 "/" 保留为第一个元素，用于标记绝对路径。
 *
 * @param {string} [path=""] - 原始路径
 * @returns {string[]}
 *
 * @example
 * normalizePath("/a/b/c") → ["/", "a", "b", "c"]
 * normalizePath("a/b/c")  → ["a", "b", "c"]
 * normalizePath("/")      → ["/"]
 * normalizePath("")       → []
 */
function normalizePath(path = "") {
  if (path === "") return [];
  if (path === "/") return ["/"];

  const parts = String(path).split("/");
  if (parts[0] === "") {
    // 以 / 开头 → 绝对路径
    return ["/", ...parts.slice(1).filter(Boolean)];
  }
  return parts.filter(Boolean);
}

/**
 * 将路径片段数组连接为路径字符串。
 *
 * @param {...(string|string[])} parts - 路径段或段数组
 * @returns {string}
 *
 * @example
 * joinPath("/", "a", "b", "c")   → "/a/b/c"
 * joinPath("a", "b", "c")        → "a/b/c"
 * joinPath("/")                  → "/"
 * joinPath()                     → ""
 */
function joinPath(...parts) {
  const segments = parts.flatMap((part) =>
    Array.isArray(part) ? part : normalizePath(part),
  );
  if (segments.length === 0) return "";

  // 过滤重复的 "/"，只保留第一个作为绝对路径标记
  const hasRoot = segments[0] === "/";
  const rest = segments.filter((s) => s !== "/");
  if (rest.length === 0) return hasRoot ? "/" : "";
  return hasRoot ? `/${rest.join("/")}` : rest.join("/");
}

/**
 * 将相对路径或绝对路径解析为绝对路径。
 *
 * @param {string} [basePath=""] - 基准路径
 * @param {string} [targetPath=""] - 目标路径
 * @returns {string}
 */
function resolvePath(basePath = "", targetPath = "") {
  if (!targetPath) {
    return joinPath(normalizePath(basePath));
  }

  if (String(targetPath).startsWith("/")) {
    return joinPath(normalizePath(targetPath));
  }

  // 相对路径：以 basePath 为基准解析
  const resolvedSegments = normalizePath(basePath);
  for (const segment of String(targetPath).split("/")) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment || trimmedSegment === ".") {
      continue;
    }
    if (trimmedSegment === "..") {
      if (resolvedSegments.length > 0) resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(trimmedSegment);
  }
  return joinPath(resolvedSegments);
}

export { joinPath, normalizePath, resolvePath };
