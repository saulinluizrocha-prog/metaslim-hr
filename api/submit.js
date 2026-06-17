const https = require('https');
const crypto = require('crypto');

const CONFIG = {
    api_key: 'c66289394c2a6e8515c8e8b382fba719',
    offer_id: '14369',
    user_id: '75329',
    api_domain: 'https://t-api.org',
};

function checkSum(jsonData) {
    return crypto.createHash('sha1').update(jsonData + CONFIG.api_key).digest('hex');
}

function postRequest(url, body) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                // Try JSON first
                resolve(JSON.parse(body));
            } catch {
                // Parse URL-encoded form data
                const params = new URLSearchParams(body);
                const obj = {};
                for (const [key, value] of params.entries()) {
                    obj[key] = value;
                }
                resolve(obj);
            }
        });
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    // Only accept POST
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    let postData;
    try {
        postData = await parseBody(req);
    } catch (e) {
        res.status(400).send('Bad Request');
        return;
    }

    const { name, phone } = postData;

    if (!name || !phone) {
        const referer = req.headers['referer'] || '/';
        res.redirect(302, referer);
        return;
    }

    // Get query params (UTM, sub_id, etc.)
    const queryParams = req.query || {};

    const leadData = {
        name: name.trim(),
        phone: phone.trim(),
        offer_id: CONFIG.offer_id,
        country: postData.country || 'HR',
    };

    const optionalFields = [
        'tz', 'address', 'region', 'city', 'zip', 'stream_id', 'count',
        'email', 'user_comment',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'sub_id', 'sub_id_1', 'sub_id_2', 'sub_id_3', 'sub_id_4',
        'referer', 'user_agent', 'ip',
    ];

    for (const field of optionalFields) {
        if (postData[field]) leadData[field] = postData[field];
        else if (queryParams[field]) leadData[field] = queryParams[field];
    }

    if (!leadData.referer) {
        leadData.referer = queryParams.referer || req.headers['referer'] || null;
    }

    const payload = {
        user_id: CONFIG.user_id,
        data: leadData,
    };

    const jsonPayload = JSON.stringify(payload);
    const checksum = checkSum(jsonPayload);
    const apiUrl = `${CONFIG.api_domain}/api/lead/create?check_sum=${checksum}`;

    try {
        const response = await postRequest(apiUrl, jsonPayload);
        const body = JSON.parse(response.body);

        if (body.status === 'ok') {
            const leadId = body.data?.id || '';
            res.redirect(302, `/success.html?id=${leadId}`);
        } else {
            console.error('API error:', body.error);
            res.redirect(302, `/success.html`);
        }
    } catch (e) {
        console.error('Request failed:', e.message);
        // Redirect to success anyway so user doesn't see error
        res.redirect(302, `/success.html`);
    }
};
