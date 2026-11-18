import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function frameInterval(page: Page, gesture: 'zoom' | 'drag') {
  return page.evaluate(async gesture => {
    const root = document.querySelector<SVGSVGElement>('svg[aria-label="Graph"]')!;
    const bounds = root.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    let emit: () => void;
    if (gesture === 'zoom') {
      emit = () => root.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: -80, cancelable: true }));
    } else {
      const node = Array.from(root.querySelectorAll<SVGGElement>('.gk-node')).find(n => {
        const r = n.getBoundingClientRect();
        return r.x > bounds.x + 20 && r.right < bounds.right - 30 && r.y > bounds.y + 20 && r.bottom < bounds.bottom - 30;
      });
      if (!node) throw Error('benchmark expected a visible node');
      const r = node.getBoundingClientRect();
      const clientX = r.x + r.width / 2;
      const clientY = r.y + r.height / 2;
      emit = () => {
        const before = node.getAttribute('transform');
        node.dispatchEvent(new MouseEvent('mousedown', { view: window, bubbles: true, clientX, clientY }));
        window.dispatchEvent(new MouseEvent('mousemove', { view: window, bubbles: true, clientX: clientX + 18, clientY: clientY + 10, buttons: 1 }));
        if (before === node.getAttribute('transform')) throw Error('benchmark drag did not move node');
        window.dispatchEvent(new MouseEvent('mouseup', { view: window, bubbles: true, clientX: clientX + 18, clientY: clientY + 10 }));
      };
    }
    const frame = () => new Promise<number>(requestAnimationFrame);
    const start = await frame();
    emit();
    return (await frame()) - start;
  }, gesture);
}

test('export browser baseline for 100, 1000 and 5000 visible nodes', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('.count')).toHaveText('5 个节点 · 4 条依赖');
  const frames = [];
  for (const size of [100, 1000, 5000]) {
    await page.getByLabel('性能样本').selectOption(String(size));
    await expect(page.locator('.count')).toHaveText(`${size} 个节点 · ${size * 1.3} 条依赖`, { timeout: 50_000 });
    await expect(page.locator('.loading')).toHaveCount(0);
    await expect.poll(async () => page.locator('.graph-footer').innerText()).toContain('上次布局');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
    const zoom_frame_ms = await frameInterval(page, 'zoom');
    const drag_frame_ms = await frameInterval(page, 'drag');
    frames.push({ zoom_frame_ms, drag_frame_ms });
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出耗时' }).click();
  const path = await (await download).path();
  const raw = await readFile(path!, 'utf8');
  type Metric = { phase: string; visible_nodes: number; worker_compute_ms: number; roundtrip_ms: number; svg_update_ms: number; dom_node_count: number };
  const entries = (JSON.parse(raw) as Metric[]).filter(metric => metric.phase === 'benchmark');
  expect(entries.map(metric => metric.visible_nodes)).toEqual([100, 1000, 5000]);
  for (const metric of entries) {
    expect(metric.worker_compute_ms).toBeGreaterThan(0);
    expect(metric.roundtrip_ms).toBeGreaterThanOrEqual(metric.worker_compute_ms);
    expect(metric.svg_update_ms).toBeGreaterThan(0);
    expect(metric.dom_node_count).toBeGreaterThan(metric.visible_nodes * 8);
  }
  const results = entries.map((metric, i) => ({ ...metric, ...frames[i] }));
  await info.attach('instance-dag-metrics', { body: raw, contentType: 'application/json' });
  await info.attach('interaction-frames', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  console.log(JSON.stringify(results));
});
