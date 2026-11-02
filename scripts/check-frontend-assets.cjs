const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');

const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());

inline.forEach((match, index) => {
  new Function(match[2]);
  console.log('Inline script ' + (index + 1) + ': syntax OK');
});

const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
const styles = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/gi)].map(match => match[1]);

for (const ref of [...scripts, ...styles].filter(source => source.startsWith('./'))) {
  const file = ref.split('?')[0].replace(/^\.\//, '');
  if (!fs.existsSync(file)) throw new Error('Missing local asset: ' + file);
  if (/\.js$/i.test(file)) {
    new Function(fs.readFileSync(file, 'utf8'));
    console.log('External JS syntax OK: ' + file);
  } else {
    console.log('CSS asset exists: ' + file);
  }
}

if (!inline.length && !scripts.length) throw new Error('No JavaScript assets found');
console.log('Checked ' + inline.length + ' inline and ' + scripts.length + ' external script tags.');
