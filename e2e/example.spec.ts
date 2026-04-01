import { test, expect } from '@playwright/test';

test.describe('Orxa Code App', () => {
  test('has correct title', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await expect(page).toHaveTitle(/Orxa Code/);
  });

  test('main container is visible', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const main = page.locator('#root');
    await expect(main).toBeVisible();
  });
});
