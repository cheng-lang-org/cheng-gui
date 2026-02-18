// Ecom data layer: parse taobao-detail-sku.csv into typed structures
import csvRaw from './taobao-detail-sku.csv?raw';

// ── Types ──────────────────────────────────────────────────────

export interface EcomSku {
    label: string;
    priceText: string;
    finalPrice: number | null;   // 券后价 (¥)
    originalPrice: number | null; // 优惠前价 (¥)
    finalPriceUsd: string | null;
    originalPriceUsd: string | null;
    sold: string | null;
    link: string;
    mainImage: string;
    images: string[];
}

export interface EcomProduct {
    title: string;
    skus: EcomSku[];
    coverImage: string;
    /** Parsed spec keys from labels, e.g. { '口味': ['甜味','辣味'], '食品口味': [...] } */
    specUniverse: Record<string, string[]>;
}

// ── Price parsing (mirrors Kotlin EcomPricing) ─────────────────

const CNY_TO_USD = 7.2;

function formatUsd(cny: number): string {
    return `$${(cny / CNY_TO_USD).toFixed(2)}`;
}

interface PriceBreakdown {
    finalCny: number | null;
    originalCny: number | null;
    sold: string | null;
}

function parsePriceText(text: string): PriceBreakdown {
    const t = text.replace(/\s+/g, '');
    let finalCny: number | null = null;
    let originalCny: number | null = null;
    let sold: string | null = null;

    // 券后¥XX or just ¥XX
    const couponMatch = t.match(/券后[¥￥]?([\d.]+)/);
    if (couponMatch) {
        finalCny = parseFloat(couponMatch[1]);
    }

    // 优惠前¥XX
    const originalMatch = t.match(/优惠前[¥￥]?([\d.]+)/);
    if (originalMatch) {
        originalCny = parseFloat(originalMatch[1]);
    }

    // No coupon price, just ¥XX
    if (finalCny === null) {
        const simpleMatch = t.match(/[¥￥]([\d.]+)/);
        if (simpleMatch) {
            finalCny = parseFloat(simpleMatch[1]);
        }
    }

    // 已售 N+
    const soldMatch = t.match(/已售\s*([\d万+]+)/);
    if (soldMatch) {
        sold = soldMatch[1];
    }

    return { finalCny, originalCny, sold };
}

// ── Spec parsing (mirrors Kotlin parseSpecs) ───────────────────

function parseSpecs(label: string): Record<string, string> {
    const parts = label.split(/[|，]/).map(s => s.trim()).filter(Boolean);
    const map: Record<string, string> = {};
    for (const piece of parts) {
        const idx = piece.indexOf(':');
        if (idx > 0) {
            const key = piece.substring(0, idx).trim();
            const value = piece.substring(idx + 1).trim();
            if (key && value) map[key] = value;
        }
    }
    return map;
}

// ── CSV parsing ────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                fields.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    fields.push(current);
    return fields;
}

function parseProductsFromCsvRaw(raw: string): EcomProduct[] {
    const lines = raw.split('\n').filter((l: string) => l.trim());
    // skip header
    const dataLines = lines.slice(1);

    const productMap = new Map<string, EcomSku[]>();

    for (const line of dataLines) {
        const fields = parseCSVLine(line);
        if (fields.length < 6) continue;

        const [title, label, price, link, mainImage, imagesStr] = fields;
        if (!title) continue;

        const breakdown = parsePriceText(price || '');
        const images = (imagesStr || '').split('|').map(s => s.trim()).filter(Boolean);

        const sku: EcomSku = {
            label: label || '',
            priceText: price || '',
            finalPrice: breakdown.finalCny,
            originalPrice: breakdown.originalCny,
            finalPriceUsd: breakdown.finalCny !== null ? formatUsd(breakdown.finalCny) : null,
            originalPriceUsd: breakdown.originalCny !== null ? formatUsd(breakdown.originalCny) : null,
            sold: breakdown.sold,
            link: link || '',
            mainImage: mainImage || '',
            images,
        };

        if (!productMap.has(title)) {
            productMap.set(title, []);
        }
        productMap.get(title)!.push(sku);
    }

    const products: EcomProduct[] = [];
    for (const [title, skus] of productMap) {
        // Build spec universe
        const specUniverse: Record<string, Set<string>> = {};
        for (const sku of skus) {
            const specs = parseSpecs(sku.label);
            for (const [key, value] of Object.entries(specs)) {
                if (!specUniverse[key]) specUniverse[key] = new Set();
                specUniverse[key].add(value);
            }
        }

        const specUniverseArr: Record<string, string[]> = {};
        for (const [key, values] of Object.entries(specUniverse)) {
            specUniverseArr[key] = Array.from(values);
        }

        products.push({
            title,
            skus,
            coverImage: skus[0]?.mainImage || '',
            specUniverse: specUniverseArr,
        });
    }

    return products;
}

function loadProducts(): EcomProduct[] {
    return parseProductsFromCsvRaw(csvRaw);
}

// ── Exports ────────────────────────────────────────────────────

let _products: EcomProduct[] | null = null;

export function getAllProducts(): EcomProduct[] {
    if (!_products) _products = loadProducts();
    return _products;
}

export function getProductByTitle(title: string): EcomProduct | undefined {
    return getAllProducts().find(p => p.title === title);
}

export function getProductByIndex(index: number): EcomProduct | undefined {
    return getAllProducts()[index];
}

/** Parse products from an arbitrary CSV string (same format as taobao-detail-sku.csv) */
export function parseProductsFromCsvString(csvString: string): EcomProduct[] {
    return parseProductsFromCsvRaw(csvString);
}

export { parsePriceText, parseSpecs, formatUsd };

