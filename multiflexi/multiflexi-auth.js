'use strict';

/**
 * Node-RED adminAuth module for MultiFlexi.
 *
 * Validates Node-RED admin login against the MultiFlexi REST API using
 * HTTP Basic authentication. Users with valid MultiFlexi credentials get
 * full admin permissions.
 *
 * Usage in settings.js:
 *   adminAuth: require('node-red-contrib-multiflexi/multiflexi/multiflexi-auth'),
 *
 * Configure the MultiFlexi API base URL via the MULTIFLEXI_URL environment
 * variable (default: http://localhost/multiflexi/api).
 */

const http = require('http');
const https = require('https');

const BASE_URL = (process.env.MULTIFLEXI_URL || 'http://localhost/multiflexi/api').replace(/\/+$/, '');
const PROBE_URL = BASE_URL + '/VitexSoftware/MultiFlexi/1.0.0/apps.json';

function authenticate(username, password) {
    return new Promise(function (resolve) {
        let parsed;
        try {
            parsed = new URL(PROBE_URL);
        } catch (_) {
            return resolve(null);
        }

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + (parsed.search || ''),
            method: 'GET',
            headers: {
                Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
                Accept: 'application/json',
            },
            timeout: 5000,
        };

        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(options, function (res) {
            res.resume(); // drain to free socket
            if (res.statusCode === 200) {
                resolve({ username: username, permissions: '*' });
            } else {
                resolve(null);
            }
        });
        req.on('error', function () { resolve(null); });
        req.on('timeout', function () { req.destroy(); resolve(null); });
        req.end();
    });
}

// node-red's bearerStrategy validates a session token via Tokens.get(), then
// looks up the full user object via Users.get(username) — which only
// consults this `users` list/function, never `authenticate()` again. A
// static (empty) list makes every bearer-token request 401 even right after
// a successful login, since the dynamically-authenticated username was never
// added to it. Returning a synthetic full-permission user for any username
// is safe here because authenticate() above already gated on a real
// MultiFlexi credential check.
function getUser(username) {
    return Promise.resolve({ username: username, permissions: '*' });
}

module.exports = {
    type: 'credentials',
    users: getUser,
    authenticate: authenticate,
};
