/**
 * @file 配置管理模块
 * @module config-manager
 * @description 功能:
 * - 获取应用配置
 */

import { Directory } from "../utils/io";
import { app } from "electron";

let userDataDir, configFile;

/**
 * 初始化配置管理器
 * @function init
 */
function init() {
  userDataDir = Directory.parse(app.getPath("userData"));
  configFile = userDataDir.cd("data").existOrMake().peek("config", "json");
}

module.exports = {};
