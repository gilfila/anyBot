import { test, expect } from '@playwright/test';

test.describe('Orbit Snake', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('plays a deterministic run and persists a high score', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Orbit Snake' })).toBeVisible();
    await page.getByRole('button', { name: /Launch run/ }).click();
    const state = await page.evaluate(() => window.__orbitSnakeTest.getState());
    await page.evaluate(({ x, y }) => window.__orbitSnakeTest.setFood(x, y), {
      x: state.snake[0].x + 1,
      y: state.snake[0].y,
    });
    await page.evaluate(() => window.__orbitSnakeTest.tick());
    await expect(page.locator('#score')).toHaveText('10');
    await expect(page.locator('#length')).toHaveText('5');

    await page.evaluate(() => {
      window.__orbitSnakeTest.setDirection('up');
      for (let i = 0; i < 30; i++) window.__orbitSnakeTest.tick();
    });
    await expect(page.locator('#scores li').first()).toContainText('10');
    await page.reload();
    await expect(page.locator('#best')).toHaveText('10');
    await expect(page.locator('#scores li').first()).toContainText('10');
  });

  test('keeps the custom canvas and touch controls usable on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('.controls')).toBeVisible();
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
  });
});
