/**
 * 路径工具
 * @module core/utils/path
 * @author Zhou Chenyu
 */

/**
 * 将路径规整为片段数组。
 * @param {string} path - 原始路径
 * @returns {string[]}
 */
function normalizePath(path = "/") {
  if (path === "/" || path === "") return [];
  return String(path)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * 将路径片段数组转换为绝对路径。
 * @param {string[]} segments - 路径片段
 * @returns {string}
 */
function toAbsolutePath(segments = []) {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * 连接多个路径片段并输出规整后的绝对路径。
 * @param {...string} parts - 需要拼接的路径段
 * @returns {string}
 */
function joinPath(...parts) {
  const segments = parts.flatMap((part) => normalizePath(part));
  return toAbsolutePath(segments);
}

/**
 * 将相对路径或绝对路径解析为绝对路径。
 * @param {string} basePath - 基准路径
 * @param {string} targetPath - 目标路径，可为相对路径
 * @returns {string}
 */
function resolvePath(basePath = "/", targetPath = "") {
  if (!targetPath) {
    return toAbsolutePath(normalizePath(basePath));
  }

  if (String(targetPath).startsWith("/")) {
    return toAbsolutePath(normalizePath(targetPath));
  }

  const resolvedSegments = normalizePath(basePath);
  for (const segment of String(targetPath).split("/")) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment || trimmedSegment === ".") {
      continue;
    }
    if (trimmedSegment === "..") {
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(trimmedSegment);
  }

  return toAbsolutePath(resolvedSegments);
}

export { joinPath, normalizePath, resolvePath, toAbsolutePath };