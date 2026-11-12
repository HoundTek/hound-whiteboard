/**
 * @file CLI 帮助渲染
 * @description 命令 spec（单一事实来源）与帮助文本渲染：总览由 spec + 字典生成，单命令帮助含用法、说明、标志表与示例。
 * @module cli/help
 * @author Zhou Chenyu
 */

import { t, hasKey } from "./i18n.js";

/**
 * 构造标志描述符
 * @param {string} flag - 标志名（不带 -- 前缀）
 * @param {string} [value] - 值占位符的 i18n key（无值标志省略）
 * @returns {{flag: string, value: ?string}} 标志描述符
 */
function f(flag, value = null) {
  return { flag, value };
}

/** 读命令目标寻址标志组 */
const TARGETING = [f("daemon", "ph.name"), f("path", "ph.boardDir")];

/** 写命令目标寻址 + 身份标志组 */
const WRITE_TARGETING = [...TARGETING, f("source", "ph.source")];

/**
 * 命令帮助 spec（键为 topic 名，渲染文案经 i18n 字典解析）
 * @description group 决定总览分组；key 是字典 help 节下的条目名；flags 为标志表（说明先查命令专属，回退通用/修改标志）。
 * @type {Array<{name: string, key: string, group: string, flags: Array<{flag: string, value: ?string}>}>}
 */
const TOPICS = [
  {
    name: "daemon.start",
    key: "daemonStart",
    group: "daemon",
    flags: [
      f("name", "ph.name"),
      f("path", "ph.boardDir"),
      f("source", "ph.identity"),
      f("relay", "ph.relay"),
      f("board-id", "ph.room"),
      f("port", "ph.port"),
    ],
  },
  { name: "daemon.release", key: "daemonRelease", group: "daemon", flags: [f("name", "ph.name")] },
  { name: "daemon.stop", key: "daemonStop", group: "daemon", flags: [f("name", "ph.name")] },
  { name: "daemon.status", key: "daemonStatus", group: "daemon", flags: [f("name", "ph.name"), f("json")] },
  {
    name: "create",
    key: "create",
    group: "offline",
    flags: [
      f("path", "ph.boardDir"),
      f("chunk-width", "ph.px"),
      f("chunk-height", "ph.px"),
      f("source", "ph.identity"),
      f("json"),
    ],
  },
  {
    name: "export",
    key: "export",
    group: "offline",
    flags: [f("path", "ph.boardDir"), f("out", "ph.file"), f("json")],
  },
  { name: "import", key: "import", group: "offline", flags: [f("path", "ph.boardDir"), f("json")] },
  { name: "info", key: "info", group: "read", flags: [...TARGETING, f("json")] },
  { name: "list", key: "list", group: "read", flags: [...TARGETING, f("json")] },
  { name: "show", key: "show", group: "read", flags: [...TARGETING, f("json")] },
  { name: "inspect", key: "inspect", group: "read", flags: [...TARGETING, f("json")] },
  {
    name: "ops",
    key: "ops",
    group: "read",
    flags: [f("source", "ph.source"), f("type", "ph.type"), f("limit", "ph.n"), ...TARGETING, f("json")],
  },
  { name: "tree", key: "tree", group: "read", flags: [...TARGETING, f("json")] },
  { name: "choices", key: "choices", group: "read", flags: [...TARGETING, f("json")] },
  {
    name: "add",
    key: "add",
    group: "write",
    flags: [
      f("type", "ph.type"),
      f("data", "ph.json"),
      f("property", "ph.json"),
      f("position", "ph.xy"),
      ...WRITE_TARGETING,
      f("json"),
    ],
  },
  { name: "delete", key: "delete", group: "write", flags: [...WRITE_TARGETING, f("json")] },
  { name: "undo", key: "undo", group: "write", flags: [...WRITE_TARGETING, f("json")] },
  { name: "redo", key: "redo", group: "write", flags: [...WRITE_TARGETING, f("json")] },
  { name: "choose", key: "choose", group: "write", flags: [f("choice", "ph.choice"), ...WRITE_TARGETING, f("json")] },
  {
    name: "unchoose",
    key: "unchoose",
    group: "write",
    flags: [f("apply"), f("discard"), ...WRITE_TARGETING, f("json")],
  },
  {
    name: "modify",
    key: "modify",
    group: "write",
    flags: [
      f("choice", "ph.choice"),
      f("displacement", "ph.xy"),
      f("transform-delta", "ph.abcd"),
      f("position", "ph.xy"),
      f("transform", "ph.abcd"),
      f("property", "ph.json"),
      f("data", "ph.json"),
      ...WRITE_TARGETING,
      f("json"),
    ],
  },
];

/**
 * 总览分组顺序
 * @type {string[]}
 */
const GROUP_ORDER = ["daemon", "offline", "read", "write"];

/**
 * 把 help 位置参数解析为 topic 名
 * @param {string[]} args - 位置参数（如 ["daemon", "start"] 或 ["add"]）
 * @returns {string} topic 名（如 "daemon.start"）
 */
function resolveTopicName(args) {
  if (args[0] === "daemon") {
    return args[1] ? `daemon.${args[1]}` : "daemon";
  }
  return args[0];
}

/**
 * 解析标志说明：命令专属优先，回退修改标志表，再回退通用标志表
 * @param {string} key - 命令字典条目名
 * @param {string} flag - 标志名
 * @returns {string} 标志说明
 */
function flagDescription(key, flag) {
  const specific = `help.${key}.flag.${flag}`;
  if (hasKey(specific)) return t(specific);
  const modify = `help.modifyFlag.${flag}`;
  if (hasKey(modify)) return t(modify);
  return t(`help.commonFlag.${flag}`);
}

/**
 * 渲染单命令帮助
 * @param {string} topic - topic 名（命令名或 daemon.<子命令>，"daemon" 渲染子命令列表）
 * @returns {?string} 帮助文本；未知 topic 返回 null
 */
function formatCommandHelp(topic) {
  if (topic === "daemon") {
    const lines = [
      `${t("help.label.usage")}hwb ${t("help.daemon.usage")}`,
      "",
      t("help.daemon.description"),
      "",
      t("help.label.subcommands"),
    ];
    for (const entry of TOPICS.filter((topicEntry) => topicEntry.group === "daemon")) {
      lines.push(`  ${t(`help.${entry.key}.usage`)}`);
      lines.push(`      ${t(`help.${entry.key}.summary`)}`);
    }
    lines.push("", t("help.daemon.subcommands"));
    return lines.join("\n");
  }
  const entry = TOPICS.find((topicEntry) => topicEntry.name === topic);
  if (!entry) return null;
  const lines = [
    `${t("help.label.usage")}hwb ${t(`help.${entry.key}.usage`)}`,
    "",
    t(`help.${entry.key}.description`),
    "",
    t("help.label.flags"),
  ];
  for (const { flag, value } of entry.flags) {
    const rendered = value ? `--${flag} ${t(value)}` : `--${flag}`;
    lines.push(`  ${rendered}  ${flagDescription(entry.key, flag)}`);
  }
  lines.push("", t("help.label.examples"));
  for (const line of t(`help.${entry.key}.examples`).split("\n")) {
    lines.push(`  ${line}`);
  }
  return lines.join("\n");
}

/**
 * 渲染顶层用法总览（由 spec 生成，替代手写 USAGE）
 * @returns {string} 总览文本
 */
function formatOverview() {
  const lines = [t("usage.synopsis")];
  for (const group of GROUP_ORDER) {
    lines.push("", t(`usage.group.${group}`));
    for (const entry of TOPICS.filter((topicEntry) => topicEntry.group === group)) {
      lines.push(`  ${t(`help.${entry.key}.usage`)}`);
      lines.push(`      ${t(`help.${entry.key}.summary`)}`);
    }
  }
  lines.push("", t("usage.modifyFlags"), "", t("usage.commonFlags"), "", t("usage.collab"));
  return lines.join("\n");
}

export { TOPICS, resolveTopicName, formatCommandHelp, formatOverview };
