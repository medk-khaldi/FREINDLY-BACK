const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testApi() {
  try {
    // 1. Login
    const loginRes = await axios.post('http://localhost:5000/api/auth/login-admin', {
      email: 'superviseur@platform.com',
      password: '123456'
    });
    
    // Extract cookie from response headers
    const cookie = loginRes.headers['set-cookie'];
    console.log('Logged in successfully');
    
    // 2. Fetch stock-consolide
    const res = await axios.get('http://localhost:5000/api/stock-consolide', {
      headers: { Cookie: cookie }
    });
    
    console.log(`API returned ${res.data.length} items`);
    console.log(`X-Debug-Count header: ${res.headers['x-debug-count']}`);
    console.log('Structure of first item:', JSON.stringify(res.data[0], null, 2).slice(0, 500));
    
  } catch (err) {
    console.error('Error:', err.response ? err.response.data : err.message);
  }
}

testApi();
