const crypto = require('crypto');
const https = require('https');

const CONFIG = {
    api_key: 'c66289394c2a6e8515c8e8b382fba719',
    offer_id: '14369',
    user_id: '75329',
    api_domain: 'https://t-api.org',
};

function checkSum(jsonData) {
    return crypto.createHash('sha1').update(jsonData + CONFIG.api_key).digest('hex');
}

function httpsPost(url, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy(new Error('Request timeout'));
        });
        req.write(body);
        req.end();
    });
}

function getBody(req) {
    // If Vercel already parsed the body, use it
    if (req.body && typeof req.body === 'object') {
        return Promise.resolve(req.body);
    }
    // Otherwise parse it manually
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk.toString(); });
        req.on('end', () => {
            try {
                if (raw.startsWith('{')) {
                    resolve(JSON.parse(raw));
                } else {
                    const params = new URLSearchParams(raw);
                    const obj = {};
                    for (const [k, v] of params.entries()) obj[k] = v;
                    resolve(obj);
                }
            } catch {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).end('Method Not Allowed');
        return;
    }

    let postData;
    try {
        postData = await getBody(req);
    } catch (e) {
        console.error('Body parse error:', e);
        postData = {};
    }

    const queryData = req.query || {};
    const name = (postData.name || '').trim();
    const phone = (postData.phone || '').trim();

    if (!name || !phone) {
        const referer = req.headers['referer'] || '/';
        res.writeHead(302, { Location: referer });
        res.end();
        return;
    }

    const leadData = {
        name,
        phone,
        offer_id: CONFIG.offer_id,
        country: postData.country || 'HR',
    };

    const optionalFields = [
        'tz', 'address', 'region', 'city', 'zip', 'stream_id', 'count',
        'email', 'user_comment', 'referer', 'user_agent', 'ip',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'sub_id', 'sub_id_1', 'sub_id_2', 'sub_id_3', 'sub_id_4',
    ];

    for (const field of optionalFields) {
        const val = postData[field] || queryData[field];
        if (val) leadData[field] = val;
    }

    if (!leadData.referer) {
        leadData.referer = queryData.referer || req.headers['referer'] || null;
    }

    const payload = { user_id: CONFIG.user_id, data: leadData };
    const jsonPayload = JSON.stringify(payload);
    const checksum = checkSum(jsonPayload);
    const apiUrl = `${CONFIG.api_domain}/api/lead/create?check_sum=${checksum}`;

    try {
        const response = await httpsPost(apiUrl, jsonPayload);
        console.log('API response status:', response.statusCode);
        console.log('API response body:', response.body);

        let redirectUrl = '/success.html';

        if (response.statusCode === 200) {
            try {
                const parsed = JSON.parse(response.body);
                if (parsed.status === 'ok' && parsed.data?.id) {
                    redirectUrl = `/success.html?id=${parsed.data.id}`;
                }
            } catch { /* ignore json parse error */ }
        }

        res.writeHead(302, { Location: redirectUrl });
        res.end();
    } catch (e) {
        console.error('API request failed:', e.message);
        // Still redirect to success to not leave user on error page
        res.writeHead(302, { Location: '/success.html' });
        res.end();
    }
};
