const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const dir = __dirname;

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let filePath = path.join(dir, req.url === '/' ? '/index.html' : req.url);
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Se não encontrar o arquivo (ex: rota /admin), tenta servir o index.html
      fs.readFile(path.join(dir, '/index.html'), (errHtml, dataHtml) => {
        if (errHtml) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Surrogate-Control': 'no-store'
        });
        res.end(dataHtml);
      });
      return;
    }
    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
