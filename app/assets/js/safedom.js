/**
 * Escape untrusted text before interpolating it into HTML markup or attributes.
 *
 * @param {*} value The value to escape.
 * @returns {string} The escaped value.
 */
function escapeHtml(value){
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;')
}

/**
 * Encode an untrusted value as one URL path segment, including characters that
 * encodeURIComponent leaves unescaped.
 *
 * @param {*} value The value to encode.
 * @returns {string} The encoded path segment.
 */
function encodeUrlSegment(value){
    return encodeURIComponent(String(value))
        .replaceAll('!', '%21')
        .replaceAll('\'', '%27')
        .replaceAll('(', '%28')
        .replaceAll(')', '%29')
        .replaceAll('*', '%2A')
}

module.exports = { encodeUrlSegment, escapeHtml }
