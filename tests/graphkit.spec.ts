import { expect, test } from '@playwright/test';

test('packed GraphKit drags in graph units and reroutes only adjacent edges', async ({ page }) => {
  await page.goto('/tests/fixtures/graphkit.html');
  const b = page.locator('[data-node-id="b"]');
  const adjacent = page.locator('[data-edge-id="ab"]');
  const untouched = page.locator('[data-edge-id="cd"]');
  const original = await untouched.getAttribute('d');
  for (const zoom of [0.5, 1, 2]) {
    await page.getByRole('button', { name: `${zoom}x`, exact: true }).click();
    await expect(b).toHaveAttribute('transform', 'translate(260,100)');
    const oldPath = await adjacent.getAttribute('d');
    const box = (await b.locator('rect').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 24, y + 12, { steps: 3 });
    await expect(b).toHaveAttribute('transform', `translate(${260 + 24 / zoom},${100 + 12 / zoom})`);
    await expect(adjacent).not.toHaveAttribute('d', oldPath!);
    const moved = await adjacent.getAttribute('d');
    await expect(untouched).toHaveAttribute('d', original!);
    await page.mouse.up();
    await expect(adjacent).toHaveAttribute('d', moved!);
  }
  await page.getByRole('button', { name: 'a:0' }).click();
  await expect(page.getByRole('button', { name: 'a:1' })).toBeVisible();
  await expect(page.locator('[data-node-id="a"]')).toHaveAttribute('transform', 'translate(110,100)');
});

test('packed GraphKit connects ports, rejects invalid intent, pans and zooms', async ({ page }) => {
  await page.goto('/tests/fixtures/graphkit.html');
  const a = page.locator('[data-node-id="a"]');
  const port = (await a.locator('[data-port]').boundingBox())!;
  const b = (await page.locator('[data-node-id="b"] rect').boundingBox())!;
  const dragPort = async (x: number, y: number) => {
    await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 5 });
    await expect(page.locator('.gk-interactions path')).toHaveAttribute('d', /^M/);
    await page.mouse.up();
    await expect(page.locator('.gk-interactions path')).not.toHaveAttribute('d');
  };
  await dragPort(port.x - 12, port.y);
  await expect(page.locator('output')).toBeEmpty();
  await dragPort(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('output')).toHaveText('a:b');
  const original = (await b);
  await page.mouse.move(700, 90);
  await page.mouse.down();
  await page.mouse.move(730, 112, { steps: 3 });
  await page.mouse.up();
  const moved = (await page.locator('[data-node-id="b"] rect').boundingBox())!;
  expect(moved.x - original.x).toBeCloseTo(30);
  expect(moved.y - original.y).toBeCloseTo(22);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await page.locator('[data-node-id="b"] rect').boundingBox())!.width).toBeGreaterThan(moved.width);
});
