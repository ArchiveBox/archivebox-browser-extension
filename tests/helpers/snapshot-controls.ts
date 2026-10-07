import {expect,type Page} from '@playwright/test';

/** Use the canonical stack and card controls, never the thumbnail's inner UI. */
export async function openSnapshotOutput(page:Page,plugin:string) {
  await expect(page.locator('.stack-shelf')).toBeVisible();
  await expect(page.locator('#snapshot-output-browser')).toHaveAttribute('aria-busy','false');
  const card=page.locator(`.thumb-card[data-plugin-name=${JSON.stringify(plugin)}]`);
  if(await card.count()===0){
    const stack=page.locator('.output-stack-other');
    if(await stack.getAttribute('aria-expanded')!=='true')await stack.click();
    await page.locator('.stack-tray .loose-items').locator('a[data-plugin-view='+JSON.stringify(plugin)+']').click();
    const viewer=page.locator('#main-frame-wrapper .plugin-view:visible');
    await expect(viewer).toHaveAttribute('data-plugin',plugin);
    return viewer;
  }
  await expect(card).toHaveCount(1);
  const group=await card.getAttribute('data-output-group');
  expect(group,`Output group for ${plugin}`).toBeTruthy();
  const stack=page.locator(`.output-stack-${group}`);
  if(await stack.getAttribute('aria-expanded')!=='true')await stack.click();
  await page.locator(`.stack-tray .thumb-card[data-plugin-name=${JSON.stringify(plugin)}] .thumbnail-click-overlay`).click();
  const viewer=page.locator('#main-frame-wrapper .plugin-view:visible');
  await expect(viewer).toHaveAttribute('data-plugin',plugin);
  return viewer;
}
