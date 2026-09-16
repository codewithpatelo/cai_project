const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const SRC = 'dc/project', OUT = 'shots', TMP = 'render';
const boards = {
  'Empty.dc.html':      { w: 1280, h: 860, out: '1-empty-state.png' },
  'Main.dc.html':       { w: 1280, h: 860, out: '2-streaming-answer.png' },
  'Escalation.dc.html': { w: 1280, h: 860, out: '3-escalation-handoff.png' },
  'Static.dc.html':     { w: 1280, h: 860, out: '4-static-tier.png' },
  'Mobile.dc.html':     { w: 390,  h: 844, out: '5-mobile.png' },
  'Dark.dc.html':       { w: 1280, h: 860, out: '6-dark-mode.png' },
};

// The .dc.html files are authored for the design-canvas runtime. For a static
// screenshot we drop the runtime hooks and make its two custom elements block-level.
// Nothing else is touched: every mock uses literal markup, no {{holes}}.
function toStatic(src) {
  return src
    .replace(/<script src="\.\/support\.js"><\/script>/, '')
    .replace(/<script data-dc-script[\s\S]*?<\/script>/, '')
    .replace('</head>', '<style>x-dc,helmet{display:block}helmet{display:none}</style></head>');
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [file, cfg] of Object.entries(boards)) {
    const html = toStatic(fs.readFileSync(path.join(SRC, file), 'utf8'));
    // helmet is hidden above, so lift its <style> into the head for the screenshot
    const helmetStyle = (fs.readFileSync(path.join(SRC, file), 'utf8').match(/<helmet>([\s\S]*?)<\/helmet>/) || [,''])[1];
    const finalHtml = html.replace('</head>', helmetStyle + '</head>');
    const tmp = path.join(TMP, file.replace('.dc.html', '.html'));
    fs.writeFileSync(tmp, finalHtml);

    const page = await browser.newPage({ viewport: { width: cfg.w, height: cfg.h }, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve(tmp));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, cfg.out) });
    await page.close();
    console.log('shot', cfg.out);
  }
  await browser.close();
})();
