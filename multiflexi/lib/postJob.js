'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

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

        const auth = server.credentials
            ? Buffer.from(
                  (server.credentials.username || '') + ':' + (server.credentials.password || ''),
              ).toString('base64')
            : '';

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
        if (auth) {
            options.headers.Authorization = 'Basic ' + auth;
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

module.exports = { postJob };
