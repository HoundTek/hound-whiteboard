/**
 * @file CLI 英文消息字典
 * @description CLI 全部用户可见文本的英文文案；key 集与 zh-CN 对齐，缺失时回退中文。
 * @module cli/locales/en-US
 * @author Zhou Chenyu
 */

export default {
  // 占位符词汇（用法行与标志表中的参数占位）
  label: {
    position: "position",
  },
  ph: {
    name: "<name>",
    boardDir: "<board-dir>",
    objectId: "<object-id>",
    opId: "<op-id>",
    type: "<type>",
    json: "'<json>'",
    xy: "x,y",
    abcd: "a,b,c,d",
    choice: "<name>",
    n: "N",
    file: "<file.hwb>",
    identity: "<identity>",
    source: "<source>",
    relay: "<relay-url>",
    room: "<room>",
    port: "<port>",
    px: "<px>",
  },

  // 顶层用法总览
  usage: {
    synopsis: "Usage: hwb <command> [--daemon <name> | --path <board-dir>] [--flag value]",
    group: {
      daemon: "Daemon management:",
      offline: "Board creation & packaging (offline, no daemon):",
      read: "Read commands (--daemon <name> queries via daemon, or --path <board-dir> reads board files directly):",
      write: "Write commands (--daemon <name> executes via daemon; with --path <board-dir>, prefer the holding daemon, otherwise write shards autonomously):",
    },
    modifyFlags: `Modify flags:
  --displacement dx,dy        Position delta (choice/single object)
  --transform-delta a,b,c,d   Transform delta, left-multiplied onto current (choice/single object)
  --position x,y              Absolute position (single-member choice only)
  --transform a,b,c,d         Absolute transform (single-member choice only)
  --property '<json>'         Absolute style properties (single-member choice only)
  --data '<json>'|"@file"     Absolute data (single-member choice only)`,
    commonFlags: `Common flags:
  --daemon <name>     Target daemon (preferred for write commands; either/or with --path for reads)
  --path <board-dir>  Read commands read board files directly (zero disk writes); write commands without a daemon write shards autonomously; daemon start locates the board
  --source <source>   Operation author namespace (default cli); determines new object id prefix
  --json              Output pure JSON (default is human-readable text)
  -h, --help          Print help (use "hwb help <command>" for per-command details)
  --version           Print version`,
    collab: `Collaboration:
  When the daemon is connected to a relay (--relay), CLI operations and the GUI see each other in real time.`,
  },

  // 各命令帮助
  help: {
    label: {
      usage: "Usage: ",
      flags: "Flags:",
      examples: "Examples:",
      subcommands: "Subcommands:",
    },
    commonFlag: {
      daemon: "Target daemon name; write commands prefer the daemon, read commands choose either this or --path",
      path: "Board directory (~ expansion supported); reads read board files directly (zero disk writes), writes without a daemon write shards autonomously",
      source: "Operation author namespace (default cli); determines new object id prefix and operation record source",
      json: "Output pure JSON (default is human-readable text)",
    },
    modifyFlag: {
      displacement: "Position delta (choice/single object)",
      "transform-delta": "Transform delta, left-multiplied onto current (choice/single object)",
      position: "Absolute position (single-member choice only)",
      transform: "Absolute transform (single-member choice only)",
      property: "Absolute style properties (single-member choice only)",
      data: "Absolute data (single-member choice only); '<json>' or @file",
    },
    daemon: {
      summary: "Manage board-holding daemons (start/release/stop/status)",
      usage: "daemon <subcommand> [--name <name>] [--path <board-dir>]",
      description:
        "Each board is held exclusively by one daemon (persistence + WebSocket RPC). Daemons are reference-counted: start is idempotent (+1), release -1 exits at zero, stop forces shutdown.",
      subcommands: "start (launch) / release (reference -1) / stop (force shutdown) / status (inspect); use hwb help daemon <subcommand> for details",
    },
    daemonStart: {
      summary: "Start a board-holding daemon in the background; +1 reference if the same name/board is alive (idempotent)",
      usage:
        "daemon start --name <name> --path <board-dir> [--source <identity>] [--relay <relay-url>] [--board-id <room>] [--port <port>]",
      description:
        "Spawns a detached daemon and returns once ready. The board must already exist (create it with hwb create first). Repeating start with the same name and board adds a reference instead of failing; same name with a different board, or a board already held by another daemon, is rejected.",
      flag: {
        name: "Daemon name (charset [A-Za-z0-9._-], globally unique)",
        path: "Board directory (~ expansion supported); must already be created by create",
        source: "Collaboration identity (when omitted, a daemon-* identity is derived from the registry name→source mapping)",
        relay: "Relay address (e.g. ws://127.0.0.1:8377); connects the daemon to cross-machine collaboration",
        "board-id": "Relay room name (defaults to the board directory path)",
        port: "Listening port (auto-assigned when omitted)",
      },
      examples: `hwb create --path ~/boards/a --width 800 --height 600
hwb daemon start --name board1 --path ~/boards/a
hwb daemon start --name board1 --path ~/boards/a --relay ws://127.0.0.1:8377 --board-id demo`,
    },
    daemonRelease: {
      summary: "Reference -1; the daemon exits automatically at zero with no client connections",
      usage: "daemon release --name <name>",
      description:
        "Releases one holding reference. At zero the daemon persists and exits; references held by GUI long-lived connections are unaffected by CLI release.",
      flag: { name: "Daemon name" },
      examples: "hwb daemon release --name board1",
    },
    daemonStop: {
      summary: "Force the reference count to zero and shut down (unconditional; cleans up descriptor and registry)",
      usage: "daemon stop --name <name>",
      description:
        "Unconditionally shuts down the daemon: drains in-flight writes, persists, and removes the board's .daemon.json and the registry entry.",
      flag: { name: "Daemon name" },
      examples: "hwb daemon stop --name board1",
    },
    daemonStatus: {
      summary: "Show one daemon (including reference count); lists all when name is omitted",
      usage: "daemon status [--name <name>] [--json]",
      description:
        "Shows daemon state from the registry (name/refCount/board dir/port/identity/start time/alive); entries whose process is dead are marked as zombies.",
      flag: { name: "Daemon name (lists all when omitted)" },
      examples: "hwb daemon status\nhwb daemon status --name board1 --json",
    },
    create: {
      summary: "Create an empty board offline; fails if the board directory already exists",
      usage: "create --path <board-dir> [--width <px>] [--height <px>] [--source <identity>] [--json]",
      description:
        "Creates a board offline without a daemon. Board size is document data (it determines chunking); when omitted the size is unknown and later add commands need explicit dimensions.",
      flag: {
        path: "Board directory (~ expansion supported)",
        width: "Board width in pixels (default 0, i.e. unknown)",
        height: "Board height in pixels (default 0, i.e. unknown)",
      },
      examples: "hwb create --path ~/boards/a --width 800 --height 600",
    },
    export: {
      summary: "Export a board as .hwb (flat zip, without .daemon.json)",
      usage: "export --path <board-dir> --out <file.hwb> [--json]",
      description:
        "Offline read, no daemon needed; safe even while a daemon holds the board. board.json sits at the zip root; objects/trash/hit/chunks are packed as-is.",
      flag: {
        path: "Board directory (~ expansion supported)",
        out: "Output .hwb file path",
      },
      examples: "hwb export --path ~/boards/a --out backup.hwb",
    },
    import: {
      summary: "Import a .hwb as a board (format version checked; target must be empty or absent)",
      usage: "import <file.hwb> --path <board-dir> [--json]",
      description:
        "Offline board creation, no daemon needed. Verifies board.json exists in the zip and its formatVersion matches the current version, then unpacks flat; the result can be held by daemon start.",
      flag: { path: "Target board directory (must be empty or absent)" },
      examples: "hwb import backup.hwb --path ~/boards/b",
    },
    info: {
      summary: "Print board metadata and statistics (including the active chain)",
      usage: "info [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "Prints board config, record count and HEAD, the active chain, and object/trash counts. Operation ids in the chain can be explicit undo targets.",
      examples: "hwb info --daemon board1\nhwb info --path ~/boards/a --json",
    },
    list: {
      summary: "List active and trash objects",
      usage: "list [--daemon <name> | --path <board-dir>] [--json]",
      description: "Lists active objects (id, type) and trash entries.",
      examples: "hwb list --daemon board1",
    },
    show: {
      summary: "Print an object's serialized data",
      usage: "show <object-id> [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "Prints the full serialized data of a single object (default mode adds a header line with id and type).",
      examples: "hwb show cli/1 --daemon board1",
    },
    inspect: {
      summary: "Print object diagnostics",
      usage: "inspect <object-id...> [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "Prints the runtime state of one or more objects: AOM membership, load count, covered chunks and geometry snapshot. show reports document content; inspect reports how the object sits on the board.",
      examples: "hwb inspect cli/1 cli/2 --daemon board1",
    },
    ops: {
      summary: "Print operation record details",
      usage: "ops [--source <source>] [--type <type>] [--limit N] [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "Prints operation records (id/type/source/time/parentId, ...) newest first, with optional source/type filters and a limit.",
      flag: {
        source: "Only records from this source (here --source acts as a filter)",
        type: "Only records of this type (e.g. add-object)",
        limit: "Maximum number of records to print (positive integer)",
      },
      examples: "hwb ops --daemon board1 --limit 10\nhwb ops --path ~/boards/a --source cli",
    },
    tree: {
      summary: "Print the undo time-travel tree as an indented tree (HEAD and undone branches)",
      usage: "tree [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "Active-chain nodes are unmarked, the HEAD node is marked [HEAD], undone branches are marked [undone]; aggregate nodes are wrapped in braces, multi-object molecule nodes in brackets. The redo stack is printed at the end.",
      examples: "hwb tree --daemon board1",
    },
    choices: {
      summary: "List all choice buffers with member status",
      usage: "choices [--daemon <name> | --path <board-dir>] [--json]",
      description:
        "In daemon mode the AOM registry is authoritative (resident members are marked active); choices in the buffer not yet restored (untouched since a daemon restart) are marked active:false.",
      examples: "hwb choices --daemon board1",
    },
    add: {
      summary: "Create and commit an object",
      usage:
        "add --type <type> [--data '<json>'|\"@file\"] [--property '<json>'] [--position x,y] [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description:
        "Creates and commits an object, printing the new object id (single line, for script capture). --type takes a registry type name (StrokeObject/CircleObject/EllipseObject/PolygonObject). --data accepts lenient JSON (bare keys, single quotes, bare string values) or @file to read from a file.",
      flag: {
        type: "Object type name (e.g. StrokeObject)",
        data: "Geometry data JSON, or @file to read from a file (path supports ~ expansion)",
        property: "Style property JSON (color/width, e.g. '{color: #f00, width: 3}')",
        position: "Initial position (default 0,0)",
      },
      examples: `hwb add --daemon board1 --type StrokeObject --data '{"points":[{"x":1,"y":1},{"x":100,"y":100}]}'
hwb add --daemon board1 --type StrokeObject --data @stroke.json --property '{color: #f00, width: 3}'`,
    },
    delete: {
      summary: "Delete objects (undoable)",
      usage: "delete <object-id...> [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description: "Moves objects to trash; recoverable via undo.",
      examples: "hwb delete cli/1 cli/2 --daemon board1",
    },
    undo: {
      summary: "Undo; with an operation id, undo that operation, otherwise undo this end's most recent operation",
      usage: "undo [<op-id>] [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description:
        "Without an operation id, undoes only this end's (--source identity) most recent operation; with an id, undoes that operation (ids are listed in info's chain). Identity changes across daemon restarts, so undoing historical operations requires an explicit id.",
      examples: "hwb undo --daemon board1\nhwb undo cli/op-3 --daemon board1",
    },
    redo: {
      summary: "Redo one step",
      usage: "redo [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description: "Redoes this end's most recent undo.",
      examples: "hwb redo --daemon board1",
    },
    choose: {
      summary: "Choose objects into a named choice",
      usage: "choose <object-id...> --choice <name> [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description:
        "Named selection (an object belongs to at most one choice at a time; choosing into a new choice removes it from the old one). Choice names must be non-empty, contain no /, and not start with ~.",
      flag: { choice: "Choice name" },
      examples: "hwb choose cli/1 cli/2 --choice batch --daemon board1",
    },
    unchoose: {
      summary: "Commit or discard a choice",
      usage: "unchoose <name> (--apply|--discard) [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description:
        "Ends a choice: --apply commits resident modifications via commitObjects (modifications and de-selection fold into one aggregate node); --discard discards them. Exactly one of the two flags is required.",
      flag: {
        apply: "Commit modifications",
        discard: "Discard modifications",
      },
      examples: "hwb unchoose batch --apply --daemon board1",
    },
    modify: {
      summary: "Modify a single object or choice members",
      usage:
        "modify (<object-id> | --choice <name>) <modify flags> [--daemon <name> | --path <board-dir>] [--source <identity>] [--json]",
      description:
        "An unselected single object is modified via an automatic choose→modify→commit chain, one atomic record; an object already in a choice follows that choice's semantics. Choice deltas are converted per member; in daemon mode modifications stay resident in the AOM until unchoose --apply commits them at once. Absolute flags (--position/--transform/--property/--data) are allowed only for single-member choices.",
      flag: { choice: "Modify all members of this choice (either/or with an object id)" },
      examples: `hwb modify cli/1 --displacement 10,20 --daemon board1
hwb modify --choice batch --transform-delta 2,0,0,2 --daemon board1
hwb unchoose batch --apply --daemon board1`,
    },
  },

  // 错误消息
  err: {
    boardPathMissing: "Board directory path is required.",
    boardNotFound: "Board directory does not exist or is not a board: {path}",
    boardNotFoundWithHint:
      "Board directory does not exist or is not a board: {path} (create it first with hwb create --path {boardDir}).",
    boardExists: "Board already exists: {path}",
    invalidDaemonName: "Invalid daemon name: {name} (letters/digits/.-_ only).",
    daemonHoldsOtherBoard:
      "daemon {name} already holds board directory {path}; one name can only point to one board.",
    daemonConnectFailed: "Failed to connect to daemon {name} (port {port}).",
    boardOccupied: "A daemon is already running for this board directory (port {port}).",
    daemonStartTimeout: "daemon {name} start timed out (not ready within {ms}ms).",
    daemonNotRunning: "daemon {name} is not running.",
    daemonNotRegistered: "daemon {name} is not running (no registry entry).",
    daemonStoppedUnreachable: "daemon {name} has stopped (port {port} unreachable).",
    daemonStartLockContention: "Daemon start lock contention failed (still held after stale lock reclamation).",
    daemonStopNeedName: "daemon stop requires --name {name}.",
    daemonReleaseNeedName: "daemon release requires --name {name}.",
    daemonStopTimeout: "Timed out waiting for daemon {name} shutdown confirmation (registry entry still present).",
    daemonExitTimeout: "Timed out waiting for daemon {name} exit confirmation (registry entry still present).",
    daemonUnavailable: "daemon {name} unavailable: no registry entry or port unreachable.",
    daemonUnavailableWithHint:
      "daemon {name} unavailable: no registry entry or port unreachable; start it first with hwb daemon start --name {name} --path {boardDir}.",
    unknownDaemonSub: "Unknown daemon subcommand: {sub} (supported: start/release/stop/status).",
    unknownCommand: "Unknown command: {command}",
    unknownHelpTopic: "Unknown help topic: {topic} (see all commands with hwb help).",
    daemonPathConflict: "--daemon and --path are mutually exclusive; pick one.",
    missingTargetRead: "Missing target: read commands take --daemon {name} or --path {boardDir}.",
    missingTargetWrite:
      "Write command {command} requires --daemon {name} or --path {boardDir} to address a target.",
    notAZip: "Cannot open .hwb file: {file} (not a valid zip)",
    invalidBoardPackage: "Not a valid board package: {file} (zip is missing {metaFile})",
    packageMetaCorrupt: "Board package metadata corrupt: {file} ({metaFile} is not valid JSON)",
    formatVersionMismatch:
      "Board package format version incompatible: {file} (package has {found}, current supports {supported})",
    targetDirNotEmpty: "Target directory is not empty: {path} (import requires an empty or non-existent directory)",
    invalidJson:
      "{flag} is not valid JSON: {message} (for complex data use standard JSON or {flag} @file)",
    addNeedData: "add requires --data (use --data '<json>' or --data @file).",
    addNeedType: "add requires --type.",
    exportNeedOut: "export requires --out {file}.",
    importNeedFile: "import requires a .hwb file path.",
    showNeedId: "show requires an object id.",
    inspectNeedId: "inspect requires at least one object id.",
    objectNotFound: "Object not found: {ids}",
    deleteNeedIds: "delete requires at least one object id.",
    chooseNeedIds: "choose requires at least one object id.",
    invalidLimit: "Invalid limit: {limit} (expected a positive integer)",
    invalidPair: 'Invalid {name}: {text} (expected "x,y")',
    invalidMatrix: 'Invalid {name}: {text} (expected "a,b,c,d")',
    modifyNeedFlag:
      "modify requires at least one modify flag (--displacement/--transform-delta/--position/--transform/--property/--data).",
    choiceNotFound: "Choice not found: {name}",
    chooseNeedChoice: "choose requires --choice {choice}.",
    invalidChoiceName:
      'Invalid choice name: {name} (must be non-empty, contain no "/", and not start with "~").',
    unchooseNeedName: "unchoose requires a choice name.",
    unchooseNeedFlag: "unchoose requires exactly one of --apply or --discard.",
    modifyNeedTarget: "modify requires an object id or --choice {choice}.",
    choiceFullPatchMulti:
      "choice {name} has {count} objects; absolute modification (--position/--transform/--property/--data) is only allowed for single-object choices; use delta flags (--displacement/--transform-delta).",
  },

  // 状态与确认输出
  out: {
    daemonRefUp: "daemon {name} reference +1 (now {refCount}).",
    daemonRefDown: "daemon {name} reference -1 (now {refCount}).",
    daemonStarted:
      "daemon {name} started (background): {path} (port {port}, identity {source})",
    daemonStopped: "daemon {name} stopped.",
    daemonExited: "daemon {name} exited.",
    noDaemons: "(no daemons)",
    daemonStatusLine:
      "{name}  {status}  refs: {refCount}  board: {path}  port: {port}  identity: {source}  started: {startedAt}",
    statusAlive: "running",
    statusZombie: "stopped (zombie entry)",
    exported: "Exported: {file}",
    imported: "Imported: {path}",
    boardCreated: "Board created: {path}",
    infoBoardConfig: "Board config: {config}",
    infoConfigUnset: "unset",
    infoRecords: "Records: {records} (HEAD {head})",
    infoHeadNone: "none",
    infoChain: "Active chain: {chain}",
    infoChainEmpty: "(empty)",
    infoObjects: "Objects: {objects} (trash: {trash})",
    listObjects: "Objects:",
    listTrash: "trash:",
    emptyBoard: "(empty board)",
    deleted: "deleted: {ids}",
    undoOk: "undo ok (undid {id})",
    undoNone: "undo: nothing to undo",
    undoNotOnChain: "({id} is not on the active chain)",
    undoNoLocal: "(no local operations)",
    redoOk: "redo ok (redid {id})",
    redoNone: "redo: no recent undo to redo",
    opsParent: "(parent {id})",
    treeEmpty: "(empty tree)",
    treeHead: "HEAD",
    treeUndone: "undone",
    redoStack: "Redo stack: {ids}",
    chooseOk: "choose ok ({name}: {ids})",
    noChoice: "(no choices)",
    choiceHeader: "{name} ({count} members):",
    memberActive: "active",
    memberInactive: "active:false",
    memberMissing: "missing",
    unchooseOk: "unchoose ok ({name}, {action})",
    unchooseDropped: ", {count} objects no longer on the board",
    unchooseApplied: "applied",
    unchooseDiscarded: "discarded",
    modifyOkChain: "modify ok ({id}, supra chain)",
    modifyOkPending: "modify ok ({name}: {ids}, resident pending commit)",
    modifyOkCommitted: "modify ok ({name}: {ids}, committed)",
    // start-daemon.js 进程内输出
    sdUsage:
      "Usage: node start-daemon.js --name <name> --path <board-dir> [--source identity] [--relay relay-url] [--board-id room] [--port port]",
    sdStarted: "daemon {name} started: ws://127.0.0.1:{port}",
    sdBoardDir: "Board directory: {path}",
    sdIdentity: "Identity: {source}",
    sdRelay: "Relay: {relay} (room {room})",
    sdNoRelay: "Relay: not connected (standalone authoritative end)",
  },
};
