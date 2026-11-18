import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const count = (page: Page, nodes: number, edges: number) =>
  expect(page.locator('.count')).toHaveText(`${nodes} 个节点 · ${edges} 条依赖`);
async function expand(page: Page, id: string, label: string) {
  await node(page, id).click({ button: 'right' });
  await page.getByRole('button', { name: label, exact: true }).click();
}

test('depth controls, shared downstream and zoomed anchor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await count(page, 5, 4);
  await expect(node(page, 'report')).toHaveCount(0);
  await expand(page, 'center', '展开下游 1 级');
  await count(page, 5, 4);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  const center = node(page, 'center');
  const before = (await center.boundingBox())!;
  const zoom = await page.locator('.zoom output').innerText();
  await expand(page, 'center', '展开下游 2 级');
  await count(page, 6, 6);
  const after = (await center.boundingBox())!;
  expect(Math.abs(before.x - after.x)).toBeLessThan(1);
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  await expect(page.locator('.zoom output')).toHaveText(zoom);
  await expect(node(page, 'report')).toHaveCount(1);
  await expand(page, 'center', '展开上游 2 级');
  await count(page, 8, 8);
  page.once('dialog', dialog => dialog.accept());
  await expand(page, 'center', '展开下游全部');
  await count(page, 9, 9);
  expect(errors).toEqual([]);
});

test('retry keeps graph and instance switch suppresses old response', async ({ page }) => {
  await page.goto('/?failOnce');
  await count(page, 5, 4);
  await expand(page, 'center', '展开下游 2 级');
  await expect(page.getByRole('alert')).toContainText('暂时不可用');
  await count(page, 5, 4);
  await page.getByRole('button', { name: '重试' }).click();
  await count(page, 6, 6);
  await expand(page, 'center', '展开上游 2 级');
  await page.getByLabel('调度实例').selectOption('daily-b');
  await count(page, 5, 4);
  await expect(node(page, 'center')).toContainText('渠道宽表汇总');
  await expect(node(page, 'raw')).toHaveCount(0);
});

test('rapid expands preserve both results across worker versions', async ({ page }) => {
  await page.goto('/');
  await count(page, 5, 4);
  await node(page, 'orders').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: '展开上游 1 级' }).click();
  await node(page, 'metrics').focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('button', { name: '展开下游 2 级' }).click();
  await count(page, 8, 7);
  await expect(node(page, 'raw')).toHaveCount(1);
  await expect(node(page, 'sink')).toHaveCount(1);
});
