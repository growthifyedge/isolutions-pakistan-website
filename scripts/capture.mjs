import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const out='artifacts/screenshots'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const checks=[['desktop-home','/',1440,1000],['desktop-shop','/shop',1440,1000],['desktop-pdp','/product/prototype-flagship-phone',1440,1000],['mobile-home','/',390,844],['mobile-shop','/shop',390,844],['mobile-pdp','/product/prototype-flagship-phone',390,844],['tablet-home','/',768,1024],['tablet-pdp','/product/prototype-flagship-phone',768,1024]];
const report=[];
for(const [name,path,width,height] of checks){
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1}); const issues=[];
 page.on('console',m=>{if(m.type()==='error')issues.push(`console: ${m.text()}`)}); page.on('pageerror',e=>issues.push(`pageerror: ${e.message}`));
 await page.goto(`http://127.0.0.1:${process.env.QA_PORT||4174}${path}`,{waitUntil:'networkidle',timeout:60000}); await page.waitForTimeout(400);
 const audit=await page.evaluate(()=>({title:document.title,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,broken:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)}));
 await page.screenshot({path:`${out}/${name}.png`,fullPage:true}); report.push({name,path,width,height,...audit,issues}); await page.close();
}
await browser.close(); await writeFile(`${out}/qa-report.json`,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
