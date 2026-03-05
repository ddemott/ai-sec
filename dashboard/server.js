// Custom HTTPS dev server for the Next.js dashboard
// Serves the app on https://localhost:3001 using the shared self-signed certs

const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, port: 3001 });
const handle = app.getRequestHandler();

const certDir = path.join(__dirname, '..', 'certs');

const httpsOptions = {
  key: fs.readFileSync(path.join(certDir, 'localhost-key.pem')),
  cert: fs.readFileSync(path.join(certDir, 'localhost-cert.pem')),
};

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(3001, (err) => {
    if (err) throw err;
    console.log('> Dashboard ready on https://localhost:3001');
  });
});
