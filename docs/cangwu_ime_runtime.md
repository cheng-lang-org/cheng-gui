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
- `Ctrl+O`: 按 `auto` 导入旧编码文件（读取 `CHENG_CW_IME_IMPORT_PATH`）
- `Ctrl+Shift+O`: 按显式编码导入（读取 `CHENG_CW_IME_IMPORT_PATH` + `CHENG_CW_IME_IMPORT_ENCODING`）

## UTF-ZH 严格策略
- continuation 必须为 `10xxxxxx`
- codepoint 必须是 Unicode scalar
- 4 字节 overlong（ASCII/DICT 成员）拒收
- 错误统一替换 `U+FFFD`，并计入错误计数

## 备注
- 首版是 `cheng-gui` 独立面板，不接管系统全局输入法。
- IDE 默认 UTF-8 行为不变。
