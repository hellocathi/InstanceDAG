# 实施与验收记录

| 阶段 | 交付 | 验证 |
| --- | --- | --- |
| A1 | GraphKit 的 `src/core` 和 `src/layout` | `pnpm test` 覆盖空图、单节点、链、多父节点、平行边、四种方向及错误输入。无 DOM Worker 消费成功。 |
| A2 | `src/react/GraphCanvas.tsx` 的 SVG keyed join 与 React Portal | SVG 节点和边复用，重排保留带内部状态的 React 节点，退出节点可正常卸载。 |
| A3 | `GraphCanvas.tsx`、`edges.ts` 的交互和视口 API | InstanceDAG 的 `tests/graphkit.spec.ts` 在 Chromium 中验证 0.5/1/2 倍拖拽、相邻边更新、无关边保持原路径、连线拒绝与接受、缩放和平移。 |
| A4 | GraphKit 的包导出、构建、变更记录和独立 playground | `pnpm typecheck`、`pnpm lint`、`pnpm build`、`npm pack --dry-run`、`npm pack` 通过。新消费者离线安装 tarball 后通过类型、样式、SVG 和 Worker 检查。 |
| B1 | `src/api.ts` 的 HTTP 适配器与 mock | 模拟一级首屏和父/子 1、2、all。使用 mock fetch 验证 HTTP 适配器将展开查询编码进一次请求。 |
| B2 | `src/model.ts` 的会话、去重与可见子图 | `pnpm test` 验证重复请求、乱序合并、会话切换、失败重试、坏数据不写入。 |
| B3 | `graph-layout.worker.ts`、`layout-protocol.ts`、`benchmark.ts` | `pnpm build` 产出独立 Worker 文件。测试验证会话及版本匹配和全图结果。 |
| B4 | `app.tsx` 的卡片、菜单、锚点、加载状态及指标导出 | `pnpm e2e` 在 Chromium 中覆盖展开、共享节点、失败重试、切换实例和缩放后不足 1 CSS px 的锚点偏差。 |
| A5 | 发布前核对项见 GraphKit README | 正式发布仍需维护者确认 npm scope、许可证和发布授权。发布后业务方可切换到正式 semver 依赖。 |

## 性能复现

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium pnpm e2e --grep 'export browser baseline'
```

下表来自云环境 Chromium 156 的单次运行。每组是若干 10 节点管线，共用后继节点。DOM 数量包含 SVG 内的 HTML 卡片。缩放及拖动数据为派发对应手势后的单帧采样，拖动样本还包含提交节点位置。

| 可见节点 | 可见边 | DOM 元素 | Worker 计算 ms | 往返 ms | SVG 提交 ms | 可交互 ms | 缩放帧 ms | 拖动帧 ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 130 | 1,038 | 73.2 | 102.3 | 67.8 | 198.1 | 16.7 | 16.6 |
| 1,000 | 1,300 | 10,308 | 973.5 | 1,012.5 | 537.8 | 1,839.7 | 16.6 | 166.6 |
| 5,000 | 6,500 | 51,508 | 5,163.1 | 5,287.7 | 1,325.3 | 7,876.2 | 50.0 | 400.0 |

当前业务端使用 mock 完成浏览器验收，真实后端仍需联调。样本数据未启用视口虚拟化。

最终全量端到端测试再次通过。第二次运行 5,000 节点样本约 7.3 秒可交互，拖动帧约 483 ms，反映单次采样的运行差异。
