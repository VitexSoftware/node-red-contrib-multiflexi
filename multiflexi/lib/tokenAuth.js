'use strict';

const crypto = require('crypto');

/**
 * Constant-time comparison of a request-supplied shared secret against the
 * configured one. Both inputs are coerced to Buffers of equal length before
 * comparing so a length mismatch cannot short-circuit via `!==` timing, and
 * `timingSafeEqual`'s own length requirement is always satisfied.
 *
 * @param {string} incoming value from the request (e.g. a header)
 * @param {string} expected configured shared secret
 * @returns {boolean}
 */
function timingSafeTokenEqual(incoming, expected) {
    const a = Buffer.from(String(incoming || ''), 'utf8');
    const b = Buffer.from(String(expected || ''), 'utf8');

    // An empty expected secret must never match, even an empty incoming
    // value - callers should refuse to compare at all in that case, but
    // this keeps the primitive safe on its own.
    if (b.length === 0) {
        return false;
    }

    if (a.length !== b.length) {
        // Compare against a same-length dummy so this branch still costs a
        // full timingSafeEqual call, then report the mismatch.
        crypto.timingSafeEqual(a, a);
        return false;
    }

    return crypto.timingSafeEqual(a, b);
}

module.exports = { timingSafeTokenEqual };
