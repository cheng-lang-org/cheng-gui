/**
 * Content sanitization utilities to prevent XSS attacks
 * Provides functions to safely render user-generated content
 */

/**
 * HTML entity encoding map
 */
const HTML_ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
};

/**
 * Escape HTML special characters to prevent XSS
 * Use this for plain text content that should not contain HTML
 */
export function escapeHtml(text: string): string {
    if (!text) return '';
    return String(text).replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Allowed HTML tags for rich content (very restrictive)
 */
const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'span']);

/**
 * Allowed HTML attributes (none for now - can be extended)
 */
const ALLOWED_ATTRS = new Set(['class']);

/**
 * Simple HTML sanitization for limited rich content
 * Removes all scripts, event handlers, and dangerous elements
 * For production, consider using DOMPurify library
 */
export function sanitizeHtml(html: string): string {
    if (!html) return '';

    // First escape everything
    let sanitized = escapeHtml(html);

    // If you need to allow specific tags, uncomment and modify:
    // sanitized = sanitized
    //     .replace(/&lt;(\/?(b|i|u|strong|em|br|p|span))&gt;/gi, '<$1>')
    //     .replace(/&lt;(\/?(b|i|u|strong|em|br|p|span))\s+class="[^"]*"&gt;/gi, '<$1>');

    return sanitized;
}

/**
 * Validate and sanitize URL to prevent javascript: and data: URLs
 */
export function sanitizeUrl(url: string): string {
    if (!url) return '';

    const trimmed = url.trim().toLowerCase();

    // Block dangerous protocols
    const dangerousProtocols = [
        'javascript:',
        'data:',
        'vbscript:',
        'file:',
        'about:',
    ];

    for (const protocol of dangerousProtocols) {
        if (trimmed.startsWith(protocol)) {
            return '#'; // Return safe placeholder
        }
    }

    // Only allow http, https, mailto, tel, and relative URLs
    if (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('mailto:') ||
        trimmed.startsWith('tel:') ||
        trimmed.startsWith('/') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('?')
    ) {
        return url.trim();
    }

    // For relative URLs without leading /
    if (!trimmed.includes(':')) {
        return url.trim();
    }

    return '#'; // Default to safe placeholder
}

/**
 * Sanitize user content for display
 * This is the main function to use for rendering user-generated text
 */
export function sanitizeContent(content: string): string {
    return escapeHtml(content);
}

/**
 * Truncate content to a maximum length while preserving word boundaries
 */
export function truncateContent(content: string, maxLength: number): string {
    if (!content || content.length <= maxLength) return content;

    const truncated = content.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    // If we found a space, truncate at word boundary
    if (lastSpace > maxLength * 0.8) {
        return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + '...';
}

/**
 * Sanitize content and truncate for preview display
 */
export function sanitizeAndTruncate(content: string, maxLength: number = 200): string {
    return truncateContent(sanitizeContent(content), maxLength);
}
