/**
 * @file CLI 中文（简体）消息字典
 * @description CLI 全部用户可见文本的中文文案；key 集为权威，其它语言字典须与之对齐。
 * @module cli/locales/zh-CN
 * @author Zhou Chenyu
 */

export default {
  // 占位符词汇（用法行与标志表中的参数占位）
  label: {
    position: "位置",
  },
  ph: {
    name: "<名>",
    boardDir: "<板目录>",
    objectId: "<对象id>",
    opId: "<操作id>",
    type: "<类型>",
    json: "'<json>'",
    xy: "x,y",
    abcd: "a,b,c,d",
    choice: "<名>",
    n: "N",
    file: "<文件.hwb>",
    identity: "<身份>",
    source: "<来源>",
    relay: "<中继地址>",
    room: "<房间>",
    port: "<端口>",
    px: "<像素>",
  },

  // 顶层用法总览
  usage: {
    synopsis: "用法：hwb <命令> [--daemon <名> | --path <板目录>] [--标志 值]",
    group: {
      daemon: "daemon 管理：",
      offline: "建板与打包（离线，不接 daemon）：",
      read: "读命令（--daemon <名> 经 daemon 查询，或 --path <板目录> 直读板文件）：",
      write: "写命令（--daemon <名> 经 daemon 执行；--path <板目录> 时优先走持有 daemon，无 daemon 则自治直写分片）：",
    },
    modifyFlags: `修改标志：
  --displacement dx,dy        位置增量（choice/单对象均可）
  --transform-delta a,b,c,d   变换增量，左乘当前变换（choice/单对象均可）
  --position x,y              全量位置（choice 仅单成员允许）
  --transform a,b,c,d         全量变换（choice 仅单成员允许）
  --property '<json>'         全量样式属性（choice 仅单成员允许）
  --data '<json>'|"@文件"     全量数据（choice 仅单成员允许）`,
    commonFlags: `通用标志：
  --daemon <名>    目标 daemon（写命令优先；读命令与 --path 二选一）
  --path <板目录>  读命令直读板文件（零写盘）；写命令无 daemon 时自治直写分片；daemon start 指定板位置
  --source <来源>  操作作者命名空间（默认 cli），决定新对象 id 前缀
  --json           输出为纯 JSON（默认输出为人类可读文本）
  -h, --help       打印帮助（hwb help <命令> 查看单命令详情）
  --version        打印版本号`,
    collab: `协作模式：
  daemon 若连了中继（--relay），CLI 操作与 GUI 实时互见。`,
  },

  // 各命令帮助
  help: {
    label: {
      usage: "用法：",
      flags: "标志：",
      examples: "示例：",
      subcommands: "子命令：",
    },
    commonFlag: {
      daemon: "目标 daemon 名；写命令优先经 daemon 执行，读命令与 --path 二选一",
      path: "板目录（支持 ~ 展开）；读命令直读板文件（零写盘），写命令无 daemon 时自治直写分片",
      source: "操作作者命名空间（默认 cli），决定新对象 id 前缀与操作记录来源",
      json: "输出为纯 JSON（默认为人类可读文本）",
    },
    modifyFlag: {
      displacement: "位置增量（choice/单对象均可）",
      "transform-delta": "变换增量，左乘当前变换（choice/单对象均可）",
      position: "全量位置（choice 仅单成员允许）",
      transform: "全量变换（choice 仅单成员允许）",
      property: "全量样式属性（choice 仅单成员允许）",
      data: "全量数据（choice 仅单成员允许）；'<json>' 或 @文件",
    },
    daemon: {
      summary: "管理持板 daemon（start/release/stop/status）",
      usage: "daemon <子命令> [--name <名>] [--path <板目录>]",
      description:
        "每块板由一个持板 daemon 独占持有（落盘 + WebSocket RPC）。daemon 以引用计数管理生命周期：start 幂等 +1，release -1 归零自动退出，stop 强制关闭。",
      subcommands: "start（启动）/ release（引用 -1）/ stop（强制关闭）/ status（查看状态）；hwb help daemon <子命令> 查看细节",
    },
    daemonStart: {
      summary: "后台启动持板 daemon；同名同板已存活时引用 +1（幂等）",
      usage:
        "daemon start --name <名> --path <板目录> [--source <身份>] [--relay <中继地址>] [--board-id <房间>] [--port <端口>]",
      description:
        "以 detached 子进程拉起 daemon 并等待就绪后返回。板必须已存在（先用 hwb create 建板）。同名同板重复 start 是引用 +1 而非报错；同名不同板、同板已被其它 daemon 持有均拒绝。",
      flag: {
        name: "daemon 名（字符集 [A-Za-z0-9._-]，全局唯一）",
        path: "板目录（支持 ~ 展开），板必须已由 create 创建",
        source: "协作身份（省略时按注册表 name→source 映射分配 daemon-* 身份）",
        relay: "中继地址（如 ws://127.0.0.1:8377），连接后进入跨机协作",
        "board-id": "中继房间名（省略时取板目录路径）",
        port: "监听端口（省略时自动分配）",
      },
      examples: `hwb create --path ~/boards/a --width 800 --height 600
hwb daemon start --name board1 --path ~/boards/a
hwb daemon start --name board1 --path ~/boards/a --relay ws://127.0.0.1:8377 --board-id demo`,
    },
    daemonRelease: {
      summary: "引用 -1；归零且无客户端连接则 daemon 自动退出",
      usage: "daemon release --name <名>",
      description:
        "释放一份持有引用。归零后 daemon 落盘并自动退出；GUI 长连接持有的引用不受 CLI release 影响。",
      flag: { name: "daemon 名" },
      examples: "hwb daemon release --name board1",
    },
    daemonStop: {
      summary: "强制归零关闭（无条件，清理描述与注册表）",
      usage: "daemon stop --name <名>",
      description:
        "无条件关闭 daemon：排空在途写、落盘、清理板目录 .daemon.json 与注册表条目。",
      flag: { name: "daemon 名" },
      examples: "hwb daemon stop --name board1",
    },
    daemonStatus: {
      summary: "查单个 daemon（含引用计数）；省略 name 时列出全部",
      usage: "daemon status [--name <名>] [--json]",
      description:
        "按注册表条目展示 daemon 状态（name/refCount/板目录/端口/身份/启动时间/存活）；进程已死的条目标注为僵尸。",
      flag: { name: "daemon 名（省略时列出全部）" },
      examples: "hwb daemon status\nhwb daemon status --name board1 --json",
    },
    create: {
      summary: "离线创建空板；板目录已存在时报错",
      usage: "create --path <板目录> [--width <像素>] [--height <像素>] [--source <身份>] [--json]",
      description:
        "离线建板，不接 daemon。板尺寸是文档数据（决定区块划分），省略时板尺寸未知，后续 add 需显式指定尺寸。",
      flag: {
        path: "板目录（支持 ~ 展开）",
        width: "板宽（像素，默认 0 即未知）",
        height: "板高（像素，默认 0 即未知）",
      },
      examples: "hwb create --path ~/boards/a --width 800 --height 600",
    },
    export: {
      summary: "导出板为 .hwb（zip 平铺，不含 .daemon.json）",
      usage: "export --path <板目录> --out <文件.hwb> [--json]",
      description:
        "离线读操作，不接 daemon；对 daemon 正在持有的板同样安全。zip 内 board.json 在根，objects/trash/hit/chunks 原样打包。",
      flag: {
        path: "板目录（支持 ~ 展开）",
        out: "输出 .hwb 文件路径",
      },
      examples: "hwb export --path ~/boards/a --out backup.hwb",
    },
    import: {
      summary: "导入 .hwb 建板（校验格式版本，目标须为空/不存在）",
      usage: "import <文件.hwb> --path <板目录> [--json]",
      description:
        "离线建板操作，不接 daemon。校验 zip 内 board.json 存在且 formatVersion 与当前版本一致后平铺解压；导入后即可被 daemon start 持有。",
      flag: { path: "目标板目录（须为空或不存在）" },
      examples: "hwb import backup.hwb --path ~/boards/b",
    },
    info: {
      summary: "打印板元数据与统计（含活动链 chain）",
      usage: "info [--daemon <名> | --path <板目录>] [--json]",
      description:
        "打印板配置、记录数与 HEAD、活动链 chain、对象/trash 计数。chain 中的操作 id 可作为 undo 的显式目标。",
      examples: "hwb info --daemon board1\nhwb info --path ~/boards/a --json",
    },
    list: {
      summary: "列出活动与 trash 对象",
      usage: "list [--daemon <名> | --path <板目录>] [--json]",
      description: "列出活动对象（id、类型）与 trash 条目。",
      examples: "hwb list --daemon board1",
    },
    show: {
      summary: "打印对象序列化数据",
      usage: "show <对象id> [--daemon <名> | --path <板目录>] [--json]",
      description: "打印单个对象的完整序列化数据（默认模式带 id 与类型标题行）。",
      examples: "hwb show cli/1 --daemon board1",
    },
    inspect: {
      summary: "打印对象诊断详情",
      usage: "inspect <对象id...> [--daemon <名> | --path <板目录>] [--json]",
      description:
        "打印一个或多个对象的运行态：AOM 成员身份、引用计数、覆盖区块与几何数据快照。与 show 的分工是「对象在板上处于什么状态」而非「对象的文档内容」。",
      examples: "hwb inspect cli/1 cli/2 --daemon board1",
    },
    ops: {
      summary: "打印操作记录明细",
      usage: "ops [--source <来源>] [--type <类型>] [--limit N] [--daemon <名> | --path <板目录>] [--json]",
      description:
        "按时间倒序打印操作记录（id/type/source/time/parentId 等），可按来源、类型过滤并限制条数。",
      flag: {
        source: "只看该来源的记录（通用 --source 语义在此为过滤）",
        type: "只看该类型的记录（如 add-object）",
        limit: "最多打印条数（正整数）",
      },
      examples: "hwb ops --daemon board1 --limit 10\nhwb ops --path ~/boards/a --source cli",
    },
    tree: {
      summary: "以缩进树打印时间回溯树（HEAD 与已撤销分支）",
      usage: "tree [--daemon <名> | --path <板目录>] [--json]",
      description:
        "活动链节点不标状态，HEAD 节点标 [HEAD]，已撤销分支标 [已撤销]；聚合节点以花括号包裹、多对象分子节点以方括号包裹。末尾打印重做栈。",
      examples: "hwb tree --daemon board1",
    },
    choices: {
      summary: "列出全部 choice buffer 及成员状态",
      usage: "choices [--daemon <名> | --path <板目录>] [--json]",
      description:
        "daemon 模式以 AOM 注册表为权威（驻留成员标 active）；buffer 中未恢复的 choice（daemon 重启后未再操作）标 active:false。",
      examples: "hwb choices --daemon board1",
    },
    add: {
      summary: "创建并提交对象",
      usage:
        "add --type <类型> [--data '<json>'|\"@文件\"] [--property '<json>'] [--position x,y] [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description:
        "创建并提交一个对象，打印新对象 id（单行，脚本捕获用）。--type 取对象注册表类型名（StrokeObject/CircleObject/EllipseObject/PolygonObject）。--data 支持宽松 JSON（裸属性名、单引号、裸字符串值）或 @文件 从文件读取。",
      flag: {
        type: "对象类型名（如 StrokeObject）",
        data: "几何数据 JSON，或 @文件 从文件读取（路径支持 ~ 展开）",
        property: "样式属性 JSON（颜色/线宽等，如 '{color: #f00, width: 3}'）",
        position: "初始位置（默认 0,0）",
      },
      examples: `hwb add --daemon board1 --type StrokeObject --data '{"points":[{"x":1,"y":1},{"x":100,"y":100}]}'
hwb add --daemon board1 --type StrokeObject --data @stroke.json --property '{color: #f00, width: 3}'`,
    },
    delete: {
      summary: "删除对象（可撤销）",
      usage: "delete <对象id...> [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description: "把对象移入 trash，可经 undo 恢复。",
      examples: "hwb delete cli/1 cli/2 --daemon board1",
    },
    undo: {
      summary: "撤销；指定操作 id 时撤销该操作，省略时撤销本端最近操作",
      usage: "undo [<操作id>] [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description:
        "省略操作 id 时只撤销本端（--source 身份）最近一步操作；显式指定时撤销该操作（id 见 info 输出的 chain）。daemon 重启后身份会变，撤销历史操作需显式传操作 id。",
      examples: "hwb undo --daemon board1\nhwb undo cli/op-3 --daemon board1",
    },
    redo: {
      summary: "重做一步",
      usage: "redo [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description: "重做本端最近一次撤销。",
      examples: "hwb redo --daemon board1",
    },
    choose: {
      summary: "把对象选入命名 choice",
      usage: "choose <对象id...> --choice <名> [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description:
        "命名选择（同一对象同时只属一个 choice；choose 新 choice 自动从旧 choice 摘出）。choice 名不可为空、不可含 /、不可以 ~ 开头。",
      flag: { choice: "choice 名" },
      examples: "hwb choose cli/1 cli/2 --choice batch --daemon board1",
    },
    unchoose: {
      summary: "提交或放弃一个 choice",
      usage: "unchoose <名> (--apply|--discard) [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description:
        "结束一个 choice：--apply 经 commitObjects 提交驻留修改（修改与取消选择折叠为一个聚合节点）；--discard 放弃修改。两标志必传其一。",
      flag: {
        apply: "提交修改",
        discard: "放弃修改",
      },
      examples: "hwb unchoose batch --apply --daemon board1",
    },
    modify: {
      summary: "修改单对象或 choice 成员",
      usage:
        "modify (<对象id> | --choice <名>) <修改标志> [--daemon <名> | --path <板目录>] [--source <身份>] [--json]",
      description:
        "单对象未选中时自动 choose→modify→commit 成链，一条记录原子完成；对象已属某 choice 时按该 choice 语义修改。choice 增量逐成员换算；daemon 模式下修改驻留 AOM，等 unchoose --apply 一次性提交。全量标志（--position/--transform/--property/--data）仅单成员 choice 允许。",
      flag: { choice: "修改该 choice 的全部成员（与对象 id 二选一）" },
      examples: `hwb modify cli/1 --displacement 10,20 --daemon board1
hwb modify --choice batch --transform-delta 2,0,0,2 --daemon board1
hwb unchoose batch --apply --daemon board1`,
    },
  },

  // 错误消息
  err: {
    boardPathMissing: "缺少板目录路径。",
    boardNotFound: "板目录不存在或不是板：{path}",
    boardNotFoundWithHint:
      "板目录不存在或不是板：{path}（先用 hwb create --path {boardDir} 建板）。",
    boardExists: "板已存在：{path}",
    invalidDaemonName: "非法 daemon name：{name}（仅允许字母/数字/.-_）。",
    daemonHoldsOtherBoard:
      "daemon {name} 已持有板目录 {path}，同一 name 只能指向一块板。",
    daemonConnectFailed: "daemon {name} 连接失败（端口 {port}）。",
    boardOccupied: "板目录已有 daemon 在运行（端口 {port}）。",
    daemonStartTimeout: "daemon {name} 启动超时（{ms}ms 内未就绪）。",
    daemonNotRunning: "daemon {name} 未在运行。",
    daemonNotRegistered: "daemon {name} 未在运行（注册表无此条目）。",
    daemonStoppedUnreachable: "daemon {name} 已停止（端口 {port} 不可连通）。",
    daemonStartLockContention: "daemon 启动锁竞争失败（回收 stale 锁后仍被占用）。",
    daemonStopNeedName: "daemon stop 需要 --name {name}。",
    daemonReleaseNeedName: "daemon release 需要 --name {name}。",
    daemonStopTimeout: "daemon {name} 停机确认超时（注册表条目仍在）。",
    daemonExitTimeout: "daemon {name} 退出确认超时（注册表条目仍在）。",
    daemonUnavailable: "daemon {name} 不可用：注册表无条目或端口不可连通。",
    daemonUnavailableWithHint:
      "daemon {name} 不可用：注册表无条目或端口不可连通，请先 hwb daemon start --name {name} --path {boardDir}。",
    unknownDaemonSub: "未知 daemon 子命令：{sub}（支持 start/release/stop/status）。",
    unknownCommand: "未知命令：{command}",
    unknownHelpTopic: "未知帮助主题：{topic}（用 hwb help 查看全部命令）。",
    daemonPathConflict: "--daemon 与 --path 互斥，只能二选一。",
    missingTargetRead: "缺少目标：读命令可用 --daemon {name} 或 --path {boardDir}。",
    missingTargetWrite:
      "写命令 {command} 需要 --daemon {name} 或 --path {boardDir} 指定目标。",
    notAZip: "无法打开 .hwb 文件：{file}（不是合法 zip）",
    invalidBoardPackage: "不是合法板包：{file}（zip 内缺少 {metaFile}）",
    packageMetaCorrupt: "板包元数据损坏：{file}（{metaFile} 不是合法 JSON）",
    formatVersionMismatch:
      "板包格式版本不兼容：{file}（包内 {found}，当前支持 {supported}）",
    targetDirNotEmpty: "目标目录非空：{path}（导入要求空目录或不存在）",
    invalidJson:
      "{flag} 不是合法 JSON：{message}（复杂数据建议写标准 JSON 或用 {flag} @文件）",
    addNeedData: "add 需要 --data（可用 --data '<json>' 或 --data @文件）。",
    addNeedType: "add 需要 --type。",
    exportNeedOut: "export 需要 --out {file}。",
    importNeedFile: "import 需要 .hwb 文件路径。",
    showNeedId: "show 需要一个对象 id。",
    inspectNeedId: "inspect 需要至少一个对象 id。",
    objectNotFound: "对象不存在：{ids}",
    deleteNeedIds: "delete 需要至少一个对象 id。",
    chooseNeedIds: "choose 需要至少一个对象 id。",
    invalidLimit: "无效 limit：{limit}（应为正整数）",
    invalidPair: '无效 {name}：{text}（应为 "x,y"）',
    invalidMatrix: '无效 {name}：{text}（应为 "a,b,c,d"）',
    modifyNeedFlag:
      "modify 需要至少一个修改标志（--displacement/--transform-delta/--position/--transform/--property/--data）。",
    choiceNotFound: "choice 不存在：{name}",
    chooseNeedChoice: "choose 需要 --choice {choice}。",
    invalidChoiceName:
      '非法 choice 名：{name}（不可为空、含 "/" 或以 "~" 开头）。',
    unchooseNeedName: "unchoose 需要 choice 名。",
    unchooseNeedFlag: "unchoose 需要且只能传 --apply 或 --discard 之一。",
    modifyNeedTarget: "modify 需要对象 id 或 --choice {choice}。",
    choiceFullPatchMulti:
      "choice {name} 含 {count} 个对象，全量修改（--position/--transform/--property/--data）仅单对象 choice 允许；请用增量标志（--displacement/--transform-delta）。",
  },

  // 状态与确认输出
  out: {
    daemonRefUp: "daemon {name} 引用 +1（当前 {refCount}）。",
    daemonRefDown: "daemon {name} 引用 -1（当前 {refCount}）。",
    daemonStarted:
      "daemon {name} 已启动（后台）：{path}（端口 {port}，身份 {source}）",
    daemonStopped: "daemon {name} 已停止。",
    daemonExited: "daemon {name} 已退出。",
    noDaemons: "（无 daemon）",
    daemonStatusLine:
      "{name}  {status}  引用：{refCount}  板：{path}  端口：{port}  身份：{source}  启动：{startedAt}",
    statusAlive: "运行中",
    statusZombie: "已停止（僵尸条目）",
    exported: "已导出：{file}",
    imported: "已导入：{path}",
    boardCreated: "板已创建：{path}",
    infoBoardConfig: "板配置：{config}",
    infoConfigUnset: "未设置",
    infoRecords: "记录：{records} 条（HEAD {head}）",
    infoHeadNone: "无",
    infoChain: "活动链：{chain}",
    infoChainEmpty: "（空）",
    infoObjects: "对象：{objects}（trash：{trash}）",
    listObjects: "对象：",
    listTrash: "trash：",
    emptyBoard: "（空板）",
    deleted: "deleted: {ids}",
    undoOk: "undo ok（撤销 {id}）",
    undoNone: "undo：无可撤销目标",
    undoNotOnChain: "（{id} 不在活动链上）",
    undoNoLocal: "（无本端操作）",
    redoOk: "redo ok（重做 {id}）",
    redoNone: "redo：无最近撤销可重做",
    opsParent: "（父 {id}）",
    treeEmpty: "（空树）",
    treeHead: "HEAD",
    treeUndone: "已撤销",
    redoStack: "重做栈：{ids}",
    chooseOk: "choose ok（{name}：{ids}）",
    noChoice: "（无 choice）",
    choiceHeader: "{name}（{count} 成员）：",
    memberActive: "active",
    memberInactive: "active:false",
    memberMissing: "missing",
    unchooseOk: "unchoose ok（{name}，{action}）",
    unchooseDropped: "，{count} 个对象已不在板上",
    unchooseApplied: "已提交",
    unchooseDiscarded: "已放弃",
    modifyOkChain: "modify ok（{id}，超分子链）",
    modifyOkPending: "modify ok（{name}：{ids}，驻留待提交）",
    modifyOkCommitted: "modify ok（{name}：{ids}，已提交）",
    // start-daemon.js 进程内输出
    sdUsage:
      "用法：node start-daemon.js --name <名> --path <板目录> [--source 身份] [--relay 中继地址] [--board-id 房间] [--port 端口]",
    sdStarted: "daemon {name} 已启动：ws://127.0.0.1:{port}",
    sdBoardDir: "板目录：{path}",
    sdIdentity: "身份：{source}",
    sdRelay: "中继：{relay}（房间 {room}）",
    sdNoRelay: "中继：未连接（单机权威端）",
  },
};
