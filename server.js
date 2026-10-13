// Local development server for Roznamcha Cash Book
// Simulates Vercel Serverless environment & cron triggers locally
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const recordsHandler = require('./api/records');
const backupHandler = require('./api/backup');
const adminHandler = require('./api/admin');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Add parsed query to req
  req.query = parsedUrl.query;

  // Helper to collect request body
  const getBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve(body);
      }
    });
  });

  // Polyfill express-like res methods for Vercel functions
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (data) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };

  // Route API requests
  if (pathname.startsWith('/api/records')) {
    req.body = await getBody();
    return recordsHandler(req, res);
  }

  if (pathname.startsWith('/api/backup')) {
    req.body = await getBody();
    return backupHandler(req, res);
  }

  if (pathname.startsWith('/api/admin')) {
    req.body = await getBody();
    return adminHandler(req, res);
  }

  // Serve static files
  let filePath = path.join(__dirname, pathname === '/' || pathname === '/admin' ? 'index.html' : pathname);
  
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Daily Cash Book & Financial Management Local Server Running at http://localhost:${PORT}`);
  console.log(` API Endpoints:`);
  console.log(`  - Database Records: http://localhost:${PORT}/api/records`);
  console.log(`  - Nightly 1AM Backup: http://localhost:${PORT}/api/backup?auto=true`);
  console.log(`  - Admin Auth & CMS: http://localhost:${PORT}/api/admin`);
  console.log(`======================================================\n`);
});
