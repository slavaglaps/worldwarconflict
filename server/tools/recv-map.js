// Одноразовый приёмник: браузер POST'ит сюда посчитанный граф карты → пишем в файл.
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', 'sim', 'map-data.json');
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      fs.writeFileSync(OUT, b);
      console.log(`wrote ${b.length} bytes → ${OUT}`);
      res.end('ok');
    });
  } else res.end('POST map json here');
}).listen(2599, () => console.log('recv-map on :2599 →', OUT));
