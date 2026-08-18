import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}}); const errors=[];
page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'}); await page.getByRole('button',{name:'Open menu'}).click(); const mobileMenu=await page.locator('.drawer').isVisible(); await page.getByRole('button',{name:'Close menu'}).click();
await page.goto('http://127.0.0.1:4175/shop',{waitUntil:'networkidle'}); await page.getByRole('button',{name:'Filters'}).click(); const filterDrawer=await page.locator('.filter-drawer').isVisible(); await page.getByRole('button',{name:'Show 8 products'}).click();
await page.goto('http://127.0.0.1:4175/product/prototype-flagship-phone',{waitUntil:'networkidle'}); await page.getByRole('button',{name:'512 GB'}).click(); const pearlDisabled=await page.getByRole('button',{name:'Pearl'}).isDisabled(); const selectedFinish=await page.locator('fieldset').nth(1).getByRole('button',{name:'Obsidian'}).getAttribute('class');
console.log(JSON.stringify({mobileMenu,filterDrawer,explicitVariantGuard:pearlDisabled,validFinishSelected:selectedFinish==='selected',errors},null,2)); await browser.close();
