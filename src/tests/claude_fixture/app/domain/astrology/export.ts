import type { AstrologyRecord } from './types';

function sanitizeFileName(input: string): string {
    return input.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}

function toJsonBlob(value: unknown): Blob {
    return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
}

function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
}

export function downloadAstrologyRecordJson(record: AstrologyRecord): void {
    const base = sanitizeFileName(record.title || record.id);
    downloadBlob(toJsonBlob(record), `${base}.json`);
}

type JsPdfType = InstanceType<(typeof import('jspdf'))['jsPDF']>;

function wrapText(doc: JsPdfType, text: string, maxWidth: number): string[] {
    return doc.splitTextToSize(text, maxWidth);
}

export async function downloadAstrologyRecordPdf(record: AstrologyRecord): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 42;
    let y = 48;

    const pushLine = (text: string, fontSize = 10, bold = false) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(fontSize);
        const lines = wrapText(doc, text, 510);
        for (const line of lines) {
            doc.text(line, marginX, y);
            y += fontSize + 6;
            if (y > 790) {
                doc.addPage();
                y = 48;
            }
        }
    };

    pushLine(`UniMaker Astrology Report`, 16, true);
    pushLine(`Title: ${record.title}`, 11, true);
    pushLine(`Type: ${record.type}`, 10);
    pushLine(`Updated: ${new Date(record.updatedAt).toLocaleString()}`, 10);
    pushLine('', 10);

    pushLine('Input', 12, true);
    pushLine(JSON.stringify(record.input, null, 2), 9);
    pushLine('', 10);

    pushLine('Rule Profile', 12, true);
    pushLine(JSON.stringify(record.profile, null, 2), 9);
    pushLine('', 10);

    if (record.interpretation) {
        pushLine('Interpretation', 12, true);
        pushLine(record.interpretation.summary, 10);
        for (const section of record.interpretation.sections) {
            pushLine(`${section.title}: ${section.content}`, 9);
        }
        pushLine('', 10);
    }

    pushLine('Chart Snapshot', 12, true);
    pushLine(JSON.stringify(record.chart, null, 2), 8);

    const base = sanitizeFileName(record.title || record.id);
    doc.save(`${base}.pdf`);
}
