# 斗地主示例（生产联机闭环）

本目录当前主推 `doudizhu_main.cheng` 的联机闭环：

- 房主权威状态机
- `cheng-libp2p` 真实网络（默认）+ mock 回退
- 公共消息走 topic，私密同步走 DM
- 局内重连恢复
- 机器人补位与超时托管

## 文件入口

- 示例入口：`/Users/lbcheng/.cheng-packages/cheng-gui/examples/doudizhu_main.cheng`
- 规则状态机：`/Users/lbcheng/.cheng-packages/cheng-gui/src/examples_games/doudizhu/state.cheng`
- 应用联机逻辑：`/Users/lbcheng/.cheng-packages/cheng-gui/src/examples_games/doudizhu/app.cheng`

## 一键验证

只做编译闭环（推荐先跑）：

```bash
bash /Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_doudizhu_closed_loop.sh --obj-only
```

完整编译 + 原生链接（macOS）：

```bash
bash /Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_doudizhu_closed_loop.sh
```

如需在链接后额外做运行时 smoke（会短暂拉起窗口），先设置：

```bash
export CHENG_EXAMPLES_ENABLE_RUNTIME_SMOKE=1
```

可选双进程启动 smoke：

```bash
bash /Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/verify_doudizhu_closed_loop.sh --smoke
```

## 运行 GUI

```bash
bash /Users/lbcheng/.cheng-packages/cheng-gui/src/scripts/run_examples_games.sh doudizhu
```

## 联机流程（双进程）

1. 进程 A 点击 `创建房间 Create`，输入：`roomCode|listenAddr|name`（都可留空用默认）。
2. 记下房主显示的 `roomCode / hostPeerId / hostAddr`。
3. 进程 B 点击 `加入房间 Join`，输入：`roomCode|hostPeerId|hostAddr|name|listenAddr`。
4. 所有玩家点击 `准备 Ready`，房主点击 `开始 Start`。
5. 通过 `发送动作 Send` 输入中文命令：
   - `叫分 0` / `叫分 1` / `叫分 2` / `叫分 3`
   - `出牌 S3,H3`
   - `不出`
6. 房主可点击 `机器人补位 Bot Fill` 补空座或托管离线座位。

## 重连流程

1. 客户端异常中断后重开程序并重新 `加入房间 Join`（同昵称可复用 token）。
2. 点击 `重连 Reconnect`。
3. 房主返回 `publicSnapshot + privateSnapshot + allowedActions + seat`，客户端恢复手牌与轮次。

## 网络模式开关

默认真实网络：

```bash
export CHENG_GAMES_P2P_MODE=real
export CHENG_GAMES_P2P_ALLOW_MOCK_FALLBACK=1
```

强制 mock：

```bash
export CHENG_GAMES_P2P_MODE=mock
export CHENG_GAMES_P2P_ALLOW_MOCK_FALLBACK=1
```
