const https = require('https');

const agent = new https.Agent({
  rejectUnauthorized: false
});

fetch('https://127.0.0.1:4001/tenants', { agent: new https.Agent({ rejectUnauthorized: false }) })
  .then(res => res.json())
  .then(data => console.log('Tenants:', data))
  .catch(err => console.error('Error:', err));
