# InstanceDAG

独立 React + TypeScript 调度实例依赖图。通过 `vendor/your-scope-graphkit-0.1.0.tgz` 安装 GraphKit，使用其布局、React 和样式三个公开入口。

## 运行

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm e2e
```

已有系统 Chromium 时，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm e2e`。如果默认 pnpm store 不可写，在安装时传入指向可写目录的 `--store-dir`。

初始图显示当前任务及所有一级父子。右键节点或使用 Shift+F10 打开菜单，可按方向展开 1 级、2 级或全部依赖。默认启用模拟数据。切换实例可验证旧请求与 Worker 结果隔离。`?failOnce` 模拟第一次展开失败。

## 接入接口

通过 `VITE_DEPENDENCY_API` 指定 API 基地址。约定两个 GET 资源。

- `neighborhood?instanceId=…&centerId=…` 返回中心任务和全部一级父子。
- `dependencies?instanceId=…&nodeId=…&direction=parents|children&depth=1|2|all` 一次返回对应方向及深度的完整结果。

返回 `{ graphVersion?, nodes, edges }`，字段见 `src/api.ts`。同一图版本内边 ID 必须稳定。重型 `all` 请求需由部署方的后端处理规模上限。客户端请求超时为 15 秒。

`src/model.ts` 在会话内按实例、图版本、节点、方向和深度缓存并合并精确请求。累积展开使用 Map 和 Set 维护节点与边，验证整批数据后才写入。有效响应按到达顺序合并，视口锚点优先使用最近一次展开意图。布局任务把完整可见图发给 Worker，以会话和版本过滤过时结果。实例切换终止旧布局并取消可取消的请求。

## 性能

右上角可加载三种规模的生成样本，并导出本次运行的 JSON。Web Worker 计时只包含布局计算。往返包括消息传输和队列时间。SVG 提交耗时从 Worker 结果排队渲染计到提交后的首个动画帧回调，包含 React 更新、原位 SVG 更新与等帧时间。下一帧采集含卡片内容的 DOM 数量和端到端耗时。详见 [实施与验收记录](./IMPLEMENTATION.md)。

重新生成 GraphKit 包时，从 GraphKit 仓库执行 `pnpm build && npm pack`，替换 vendor 下的包并执行 `pnpm update @your-scope/graphkit` 刷新完整性锁。
