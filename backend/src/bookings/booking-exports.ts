import PDFDocument from 'pdfkit';

export function passengerCsv(rows: string[][]): string {
  // Quoting alone does not prevent spreadsheet formula execution.
  const cell = (value: string) => {
    const safe =
      /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)
        ? "'" + value
        : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return (
    '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}

export function ticketPdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.fontSize(22).text('Flight e-ticket');
    document.moveDown().fontSize(11);
    for (const line of lines) document.text(line).moveDown(0.5);
    document.end();
  });
}
