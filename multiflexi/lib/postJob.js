'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Build the Authorization header value for a multiflexi-config node's
 * credentials, preferring a bearer token (issued via
 * `multiflexi-cli token:generate`) over legacy HTTP Basic username/password.
 *
 * @param {object} credentials a multiflexi-config node's `.credentials`
 * @returns {string|null} header value, or null if no credentials are set
 */
function buildAuthHeader(credentials) {
    if (!credentials) {
        return null;
    }
    if (credentials.token) {
        return 'Bearer ' + credentials.token;
    }
    if (credentials.username || credentials.password) {
        const basic = Buffer.from(
            (credentials.username || '') + ':' + (credentials.password || ''),
        ).toString('base64');
        return 'Basic ' + basic;
    }
    return null;
}

/**
 * Schedule a MultiFlexi job via the REST API (POST {baseUrl}/job/).
 *
 * Shared by the static multiflexi-runtemplate node and the dynamically
 * registered per-template nodes built from the MultiFlexi catalog.
 *
 * @param {object} server a multiflexi-config node ({ baseUrl, credentials })
 * @param {object} body   { runtemplate_id, scheduled, executor?, env? }
 * @returns {Promise<object|string>} parsed API response (object) or raw body
 */
function postJob(server, body) {
    return new Promise((resolve, reject) => {
        const target = new URL(server.baseUrl + '/job/');
        const payload = JSON.stringify(body);
        const transport = target.protocol === 'https:' ? https : http;

        const authHeader = buildAuthHeader(server.credentials);

        const options = {
            method: 'POST',
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };
        if (authHeader) {
            options.headers.Authorization = authHeader;
        }

        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    /* keep raw */
                }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsed);
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + JSON.stringify(parsed)));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

module.exports = { postJob, buildAuthHeader };
