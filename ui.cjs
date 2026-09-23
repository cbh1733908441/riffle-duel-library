// Optional browser regression check: requires Playwright and a local server on 8770.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:8770/');
 await page.locator('#platform').selectOption('roblox');await page.locator('#level').selectOption('high');
 assert.equal(await page.locator('.game-card').count(),3);
 await page.locator('.game-card').filter({hasText:'Blade Ball'}).click();
 assert.equal(await page.locator('.step').count(),4);assert.match(await page.locator('.npc-panel').innerText(),/未做 NPC 原型测试/);
 const dl=page.waitForEvent('download');await page.locator('#export-one').click();assert.ok(await (await dl).path());
 await page.locator('#reset').click();await page.locator('#next').click();assert.match(await page.locator('.pagination').innerText(),/25–48/);
 await page.locator('#scope').selectOption('catalog');assert.match(await page.locator('.result-line').innerText(),/8749/);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('Platform/fit/detail/export/pagination/catalog/mobile checks passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
