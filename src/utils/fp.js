/**
 * @file 文件操作模块
 * @module fp
 * @description 功能：
 * - 将 fs 的文件操作做了特化、封装
 */

import fs from "fs";
import AdmZip from "adm-zip";

/**
 * 创建指定目录
 * @param {Directory} dir 要创建的目录实例
 */
function mkdir(dir) {
  fs.mkdirSync(dir.getPath(), { recursive: true });
}

/**
 * 获取目录中的所有子目录
 * @param {Directory} dir 要读取的目录实例
 * @returns {Array<Directory>} 子目录实例数组
 */
function lsDir(dir) {
  return fs.readdirSync(dir.getPath())
           .filter(name => fs.statSync(dir.cd(name).getPath()).isDirectory())
           .map(name => dir.cd(name));
}

/**
 * 读取目录中的文件
 * @param {Directory} dir - 要读取的目录
 * @returns {Array<File>} 文件数组
 */
function lsFile(dir) {
  return fs.readdirSync(dir.getPath())
           .filter(name => fs.statSync(dir.cd(name).getPath()).isFile())
           .map(name => {
              const nameWithoutExt = name.split(".").slice(0, -1).join(".");
              const ext = name.split(".").pop();
              return new File(dir.getPath(), nameWithoutExt, ext);
            })
}

/**
 * 读取目录中的内容
 * @param {Directory} dir - 要读取的目录
 * @returns {Array<string>} 文件名数组
 */
function ls(dir) {
  return fs.readdirSync(dir.getPath());
}

/**
 * 判断文件是否存在
 * @param {File|Directory} File - 要判断的文件
 * @returns {boolean} 是否存在
 */
function exist(file) {
  return fs.existsSync(file.getPath());
}

/**
 * 读取文件内容
 * @param {File} file - 要读取的文件
 * @returns {string} 文件内容
 */
function readFile(file) {
  return fs.readFileSync(file.getPath(), "utf8");
}

/**
 * 写入文件内容
 * @param {File} file - 要写入的文件
 * @param {string} content - 要写入的内容
 */
function writeFile(file, content) {
  fs.writeFileSync(file.getPath(), content, "utf8");
}

/**
 * 创建文件
 * @param {File} file - 要创建的文件
 */
function touch(file) {
  this.writeFile(file, "");
}

/**
 * 删除文件
 * @param {File} file - 要删除的文件
 */
function rm(file) {
  fs.unlinkSync(file.getPath());
}

/**
 * 删除目录
 * @param {Directory} dir - 要删除的目录
 */
function rmDir(dir) {
  fs.rmSync(dir.getPath(), { recursive: true, force: true});
}

/**
 * 复制文件
 * @param {File} source - 要复制的文件
 * @param {File} dest - 复制到的文件
 */
function cp(source, dest) {
  fs.copyFileSync(source.getPath(), dest.getPath());
}

/**
 * 复制目录
 * @param {Directory} source - 要复制的目录
 * @param {Directory} dest - 复制到的目录
 */
function cpDir(source, dest) {
  fs.cpSync(source.getPath(), dest.getPath(), { recursive: true });
}

/**
 * 移动文件
 * @param {File} source - 要移动的文件
 * @param {File} dest - 移动到的文件
 */
function mv(source, dest) {
  fs.renameSync(source.getPath(), dest.getPath());
}

/**
 * 解压文件
 * @param {File} source - 要解压的文件路径
 * @param {Directory} dest - 解压到的目录路径
 */
function extractFile(source, dest) {
  const zip = new AdmZip(source.getPath());
  zip.extractAllTo(dest.getPath(), true);
}

/**
 * 压缩文件
 * @param {Directory} source - 要压缩的文件夹路径
 * @param {File} dest - 压缩后的文件路径
 * @param {boolean} remove - 是否删除原文件
 */
function compressFile(source, dest, remove = false) {
  const zip = new AdmZip();
  zip.addLocalFolder(source.getPath());
  zip.writeZip(dest.getPath());
  if (remove) {
    fs.rm(source.getPath(), { recursive: true, force: true }, (err) => {
      if (err) throw err;
      console.log("Directory deleted");
    });
  }
}

export {
	mkdir,
	lsDir,
	lsFile,
	ls,
	exist,
	readFile,
	writeFile,
	touch,
	rm,
	rmDir,
	cp,
  cpDir,
	mv,
	extractFile,
	compressFile,
};
