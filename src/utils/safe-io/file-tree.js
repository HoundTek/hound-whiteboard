/**
 * 文件树模块（主进程） - 柯里化版 + AdmZip 支持
 *
 * 支持 BaseDir / Dir / File 三种路径模式，所有主要 API 均已柯里化。
 *
 * @module fileTree
 */

import app from "electron";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import { Some, None } from "../functional";

/**
 * 无效文件名字符集合
 * @type {string[]}
 */
const invalidChars = ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\0"];

/**
 * 检查文件名是否合法
 *
 * @param {string} name - 要检查的文件名或目录名
 * @returns {boolean} 是否为合法名称
 */
const isValidName = (name) => {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name === "." || name === "..") return false;
  if (name.endsWith(".")) return false;
  return !invalidChars.some((char) => name.includes(char));
};

/**
 * 构造目录信息（Option 类型）
 *
 * @param {string} name - 目录名称
 * @returns {Option} 目录信息或 None（名称非法时）
 */
const DirInfo = (name) => {
  if (!isValidName(name)) return None();
  const isHidden = name.startsWith(".");
  return Some({ name, isHidden });
};

/**
 * 构造文件信息（Option 类型）
 *
 * @param {string} baseName - 文件名（不含扩展名）
 * @param {string} [ext=""] - 文件扩展名（不含点）
 * @returns {Option} 文件信息或 None（名称非法时）
 */
const FileInfo = (baseName, ext = "") => {
  if (!isValidName(baseName) || (ext && !isValidName(ext))) return None();
  const isHidden = baseName.startsWith(".");
  return Some({ name: baseName, ext: ext || "", isHidden });
};

/**
 * BaseDir 构造器（柯里化）
 * 用于创建基础目录路径对象，必须匹配指定的 root 前缀
 *
 * @param {string[]} root - 根路径片段
 * @returns {(segments: string[]) => Option} 返回接受路径片段的函数
 */
const BaseDir = (root) => (segments) => {
  if (
    !Array.isArray(root) ||
    !Array.isArray(segments) ||
    segments.length < root.length ||
    !root.every((el, i) => el === segments[i])
  ) {
    return None();
  }

  const name = segments.at(-1) || "";
  return Some({
    __type: "dir-base",
    root,
    path: segments,
    name,
    isHidden: name.startsWith("."),
  });
};

/**
 * Dir 构造器（柯里化）
 * 将 BaseDir 提升为带丰富元数据的目录对象
 *
 * @param {Option} baseOption - BaseDir Option 对象
 * @returns {Option} 丰富的目录对象
 */
const Dir = (baseOption) =>
  baseOption.flatMap((base) => {
    if (base.__type === "dir") return Some(base);

    const isRoot = base.path.length === base.root.length;
    const parentOption = isRoot
      ? None()
      : BaseDir(base.root)(base.path.slice(0, -1));

    return DirInfo(base.name).flatMap((info) => {
      const richDir = {
        __type: "dir",
        type: "dir",
        ...info,
        root: base.root,
        path: base.path,
        parent: parentOption,
      };
      return Some(richDir);
    });
  });

/**
 * File 构造器（柯里化）
 * 根据父目录和文件信息构造文件对象
 *
 * @param {Option} parentOption - 父目录 Option
 * @returns {(fileInfoOption: Option) => Option} 返回接受文件信息的函数
 */
const File = (parentOption) => (fileInfoOption) =>
  parentOption.flatMap((parent) =>
    fileInfoOption.flatMap((info) => {
      const fileObj = {
        __type: "file",
        type: "file",
        ...info,
        root: parent.root,
        path: [...parent.path, info.name],
        parent,
      };
      return Some(fileObj);
    })
  );

/**
 * 将任意路径对象转换为 BaseDir 类型
 *
 * @param {Option} entry - 目录或文件路径对象
 * @returns {Option} BaseDir 类型的 Option
 */
const toBaseDir = (entry) =>
  entry.flatMap((e) => {
    if (e.__type === "dir-base") return Some(e);
    if (e.__type === "dir" || e.__type === "file") {
      return Some({
        __type: "dir-base",
        root: e.root,
        path: e.path,
        name: e.name,
        isHidden: e.isHidden,
      });
    }
    return None();
  });

/**
 * 将 BaseDir 转换为 Dir 类型
 *
 * @param {Option} baseOption - BaseDir Option
 * @returns {Option} Dir 类型的 Option
 */
const toDir = (baseOption) => Dir(baseOption);

/**
 * 获取目录的完整物理路径（不安全版本，内部使用）
 *
 * @param {Object} validDir - 已验证的目录对象
 * @returns {string} 目录的完整路径
 */
const getDirPathUnsafe = (validDir) => path.join(...validDir.path);

/**
 * 获取文件的完整物理路径（不安全版本，内部使用）
 *
 * @param {Object} validFile - 已验证的文件对象
 * @returns {string} 文件的完整路径
 */
const getFilePathUnsafe = (validFile) =>
  path.join(
    getDirPathUnsafe(validFile),
    validFile.ext ? `${validFile.name}.${validFile.ext}` : validFile.name
  );

/**
 * 获取路径对象的完整物理路径（安全 Option 包装）
 *
 * @param {Option} entry - 路径对象 Option
 * @returns {Option<string>} 完整路径的 Option
 */
const getPath = (entry) =>
  entry.flatMap((e) =>
    Some(e.type === "file" ? getFilePathUnsafe(e) : getDirPathUnsafe(e))
  );

/**
 * 进入子目录（cd 操作，柯里化）
 *
 * @param {Option} dir - 当前目录 Option
 * @returns {(name: string) => Option} 返回接受子目录名称的函数
 */
const cd = (dir) => (name) =>
  toBaseDir(dir).flatMap((validDir) =>
    DirInfo(name).flatMap((info) =>
      BaseDir(validDir.root)([...validDir.path, info.name])
    )
  );

/**
 * 获取父目录（柯里化）
 *
 * @param {Option} dir - 当前目录 Option
 * @returns {Option} 父目录 Option（若已是根目录则返回 None）
 */
const father = (dir) =>
  toBaseDir(dir).flatMap((validDir) => {
    if (validDir.path.length <= validDir.root.length) return None();
    const parentSegments = validDir.path.slice(0, -1);
    return BaseDir(validDir.root)(parentSegments);
  });

// ==================== 文件系统操作（柯里化） ====================

/**
 * 判断路径是否存在
 *
 * @param {Option} entry - 路径对象 Option
 * @returns {Option<boolean>} 是否存在的 Option
 */
const exist = (entry) =>
  getPath(entry).flatMap((targetPath) => {
    try {
      return Some(fs.existsSync(targetPath));
    } catch (e) {
      console.error("exist error:", e);
      return None();
    }
  });

/**
 * 创建目录（支持递归创建）
 *
 * @param {Option} dir - 目录对象 Option
 * @returns {Option} 创建成功后的目录 Option
 */
const make = (dir) =>
  toBaseDir(dir).flatMap((validDir) => {
    try {
      fs.mkdirSync(getDirPathUnsafe(validDir), { recursive: true });
      return Some(validDir);
    } catch (e) {
      console.error("make error:", e);
      return None();
    }
  });

/**
 * 删除目录或文件（递归删除）
 *
 * @param {Option} dir - 目录对象 Option
 * @returns {Option} 删除成功后的目录 Option
 */
const rm = (dir) =>
  toBaseDir(dir).flatMap((validDir) => {
    try {
      fs.rmSync(getDirPathUnsafe(validDir), { recursive: true, force: true });
      return Some(validDir);
    } catch (e) {
      console.error("rm error:", e);
      return None();
    }
  });

/**
 * 复制目录或文件（柯里化）
 *
 * @param {Option} src - 源路径 Option
 * @returns {(dest: Option) => Option} 返回接受目标路径的函数
 */
const cp = (src) => (dest) =>
  toBaseDir(src).flatMap((validSrc) =>
    toBaseDir(dest).flatMap((validDest) => {
      try {
        fs.cpSync(getDirPathUnsafe(validSrc), getDirPathUnsafe(validDest), {
          recursive: true,
          force: true,
        });
        return Some(validSrc);
      } catch (e) {
        console.error("cp error:", e);
        return None();
      }
    })
  );

/**
 * 压缩文件或目录为 zip（柯里化）
 *
 * 支持压缩整个目录（推荐）或单个文件。
 *
 * @param {Option} sourceEntry - 源目录或文件 Option
 * @returns {(zipFilePath: string) => Option} 返回接受目标 zip 文件路径的函数
 */
const zip = (sourceEntry) => (zipFilePath) =>
  toBaseDir(sourceEntry).flatMap((validSource) => {
    try {
      const zip = new AdmZip();
      const sourcePath = getDirPathUnsafe(validSource);

      // 如果是目录，使用 addLocalFolder（推荐方式）
      if (validSource.__type === "dir-base" || validSource.type === "dir") {
        zip.addLocalFolder(sourcePath);
      } else {
        // 单个文件
        zip.addLocalFile(sourcePath);
      }

      zip.writeZip(zipFilePath);
      return Some(validSource);
    } catch (e) {
      console.error("zip error:", e);
      return None();
    }
  });

/**
 * 解压 zip 文件到指定目录（柯里化）
 *
 * 默认覆盖已有文件。
 *
 * @param {string} zipFilePath - zip 文件的完整路径
 * @returns {(targetDirEntry: Option) => Option} 返回接受目标目录 Option 的函数
 */
const unzip = (zipFilePath) => (targetDirEntry) =>
  toBaseDir(targetDirEntry).flatMap((validTarget) => {
    try {
      if (!fs.existsSync(zipFilePath)) {
        console.error("unzip error: zip file not found");
        return None();
      }

      const zip = new AdmZip(zipFilePath);
      const targetPath = getDirPathUnsafe(validTarget);

      fs.mkdirSync(targetPath, { recursive: true });
      zip.extractAllTo(targetPath, true); // true 表示覆盖

      return Some(validTarget);
    } catch (e) {
      console.error("unzip error:", e);
      return None();
    }
  });

// ==================== 列表操作 ====================

/**
 * 读取目录原始条目（内部使用）
 *
 * @param {Object} validDir - 已验证的目录对象
 * @returns {Option<fs.Dirent[]>} 目录条目数组的 Option
 */
const listRawEntries = (validDir) => {
  try {
    return Some(
      fs.readdirSync(getDirPathUnsafe(validDir), { withFileTypes: true })
    );
  } catch (e) {
    console.error("listRawEntries error:", e);
    return None();
  }
};

/**
 * 过滤目录条目
 *
 * @param {fs.Dirent[]} entries - 原始目录条目
 * @param {Object} options - 过滤选项
 * @param {boolean} [options.showHidden=false] - 是否显示隐藏文件
 * @param {boolean} [options.filesOnly=false] - 是否只显示文件
 * @returns {fs.Dirent[]} 过滤后的条目
 */
const filterEntries = (entries, { showHidden = false, filesOnly = false }) =>
  entries.filter((entry) => {
    if (!showHidden && entry.name.startsWith(".")) return false;
    if (filesOnly && !entry.isFile()) return false;
    return true;
  });

/**
 * 解析单个文件系统条目为本模块的路径对象
 *
 * @param {Object} baseDir - 基础目录对象
 * @returns {(fsEntry: fs.Dirent) => Option} 返回解析函数
 */
const parseEntry = (baseDir) => (fsEntry) => {
  if (fsEntry.isDirectory()) {
    return DirInfo(fsEntry.name).flatMap((info) => {
      const newBase = BaseDir(baseDir.root)([...baseDir.path, info.name]);
      return toDir(newBase);
    });
  }

  if (fsEntry.isFile()) {
    const parsed = path.parse(fsEntry.name);
    const ext = parsed.ext ? parsed.ext.slice(1) : "";
    return FileInfo(parsed.name, ext).flatMap((info) =>
      File(Some(baseDir))(Some(info))
    );
  }
  return None();
};

/**
 * 列出目录内容（柯里化）
 *
 * @param {Option} dir - 目录 Option
 * @returns {(options?: Object) => Option<Array>} 返回接受过滤选项的函数
 */
const ls = (dir) => (options = { showHidden: false, filesOnly: false }) =>
  toBaseDir(dir).flatMap((base) =>
    listRawEntries(base).flatMap((rawEntries) => {
      const filtered = filterEntries(rawEntries, options);
      const parsed = filtered
        .map(parseEntry(base))
        .filter((o) => o.isSome?.())
        .map((o) => o.unwrap?.() ?? o);

      return Some(parsed);
    })
  );

/**
 * 仅列出文件（快捷方法）
 *
 * @param {Option} dir - 目录 Option
 * @returns {(options?: Object) => Option<Array>} 返回接受过滤选项的函数
 */
const lsFile = (dir) => (options = { showHidden: false }) =>
  ls(dir)({ ...options, filesOnly: true });

/**
 * 获取应用程序数据目录路径
 *
 * 优先使用可执行文件同级的 data 目录（便携模式），否则使用系统 AppData 目录。
 *
 * @returns {Option} 数据目录的 BaseDir Option
 */
const DataPath = () => {
  try {
    const exeDir = path.dirname(app.getPath("exe"));
    const portableData = path.join(exeDir, "data");

    const dataDir = fs.existsSync(portableData)
      ? portableData
      : path.join(app.getPath("appData"), "YourAppName", "data");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const segments = dataDir.split(path.sep).filter(Boolean);
    return BaseDir(segments)(segments);
  } catch (e) {
    console.error("DataPath error:", e);
    return None();
  }
};

// ==================== 导出 ====================

export {
  DirInfo,
  FileInfo,
  BaseDir,
  Dir,
  File,
  toBaseDir,
  toDir,
  cd,
  father,
  exist,
  make,
  rm,
  cp,
  zip,
  unzip,
  ls,
  lsFile,
  DataPath,
  getDirPathUnsafe,
  getFilePathUnsafe,
  getPath,
};