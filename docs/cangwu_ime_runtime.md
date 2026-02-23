# CangWu IME Runtime (v1)

## 入口
- `src/cangwu_ime_main.cheng`

## 资产文件
- `src/ime/data/utfzh_dict_v1.tsv`
- `src/ime/data/cangwu_single_v1.tsv`
- `src/ime/data/cangwu_phrase_v1.tsv`
- `src/ime/data/cangwu_reverse_v1.tsv`
- `src/ime/data/ime_data_manifest_v1.txt`

## 构建资产
```bash
bash src/scripts/build_cangwu_assets.sh
```

## 验证
```bash
bash src/scripts/verify_cangwu_ime.sh
```

## 一键转码（旧编码 -> UTF-ZH）
```bash
bash src/scripts/convert_to_utfzh.sh --in legacy.txt --out legacy.utfzh.bin --from auto --report legacy.report.txt
```

### 语料自适应压缩（推荐长篇中文）
当默认词典对具体语料不够“贴身”时，可在转码前按输入语料重排 UTF-ZH 词典，再编码：
```bash
build/cangwu_ime/bin/convert_to_utfzh \
  --in novel.txt \
  --out novel.utfzh.bin \
  --from auto \
  --report novel.utfzh.report \
  --optimize-dict \
  --dict-out novel.utfzh.dict.tsv
```
报告会新增：
- `dict_optimized=true|false`
- `dict_path=<优化词典路径>`
- 可选引擎参数：`--engine cheng|builtin|auto`
- 默认 `cheng`：先走 Cheng bridge；若 bridge 不可用或异常，会自动回退到内置二进制引擎（`builtin`）。
- 环境变量：
  - `CW_IME_CONVERT_ENGINE=cheng|builtin|auto`（未传 `--engine` 时生效）
  - `CW_IME_CHENG_TIMEOUT_SEC=<秒>`（`cheng` 引擎超时，默认 8 秒）
  - `CW_IME_CHENG_REQUIRED=1`（启用后禁用回退，`cheng` 失败即整体失败）
  - `CW_IME_BUILD_CHENG_BRIDGE=1`（`convert` 子命令默认构建 bridge；设为 `0` 可跳过）

## 二进制入口（统一命令行选项）
- 主入口：`build/cangwu_ime/bin/cangwu_ime_cli`
- 别名入口：`build/cangwu_ime/bin/convert_to_utfzh`、`build/cangwu_ime/bin/build_cangwu_assets`、`build/cangwu_ime/bin/verify_cangwu_ime`
- 以上别名与主入口参数一致，分别等价于：
  - `cangwu_ime_cli convert ...`
  - `cangwu_ime_cli build-assets ...`
  - `cangwu_ime_cli verify ...`
- CLI 入口链路：
  - Cheng 入口：`src/cangwu_ime_cli_entry.cheng`（`cw_cli_entry`）
  - Host：`src/runtime/cangwu_ime_cli_cheng_host.c`
  - 业务核心：`src/runtime/cangwu_ime_cli_bin.c`
- `src/scripts/convert_to_utfzh.sh`、`src/scripts/build_cangwu_assets.sh`、`src/scripts/verify_cangwu_ime.sh` 仅保留为兼容壳，实际逻辑都在 `build/cangwu_ime/bin/cangwu_ime_cli`。

## 交互
- `A..Z`: 录入仓五码
- `Z`: 进入反查模式
- `;`: 上下结构筛选
- `'`: 包围结构筛选
- `/`: 杂合结构筛选
- `Space`: 上屏首候选
- `1..9`: 上屏指定候选
- `Backspace`: 删除输入码；输入为空时删除输出末字
- `Esc`: 清空输入与筛选
- `PageUp/PageDown`: 候选翻页
- `Ctrl+S`: 保存 UTF-8 文本（`cangwu_output.txt`）
- `Ctrl+Shift+S`: 保存 UTF-ZH 二进制（`cangwu_output.utfzh.bin`）
- `Ctrl+O`: 按 `auto` 导入旧编码文件（读取 `CW_IME_IMPORT_PATH`）
- `Ctrl+Shift+O`: 按显式编码导入（读取 `CW_IME_IMPORT_PATH` + `CW_IME_IMPORT_ENCODING`）

## UTF-ZH 严格策略
- continuation 必须为 `10xxxxxx`
- codepoint 必须是 Unicode scalar
- 4 字节 overlong（ASCII/DICT 成员）拒收
- 错误统一替换 `U+FFFD`，并计入错误计数

## 备注
- 首版是 `cheng-gui` 独立面板，不接管系统全局输入法。
- IDE 默认 UTF-8 行为不变。
