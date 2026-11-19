import PDFDocument from 'pdfkit';
import type { ItineraryDetail } from './itinerary-detail';

export function itineraryPdf(itinerary: ItineraryDetail): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.fontSize(20).text(itinerary.title).moveDown(0.5);
    pdf.fontSize(10).text(`Start: ${itinerary.startDate}  |  Countries: ${itinerary.countries.join(', ')}  |  Currency: ${itinerary.currency}`);
    pdf.moveDown();
    for (const day of itinerary.days) {
      pdf.fontSize(14).text(`Day ${day.dayNumber} — ${day.date}`);
      pdf.fontSize(10).text(`City: ${day.cityId}`);
      if (day.notes) pdf.text(day.notes);
      for (const activity of day.activities) {
        pdf.text(`• ${activity.title}${activity.startTime ? ` (${activity.startTime})` : ''}${activity.cost !== undefined ? ` — ${activity.cost} ${itinerary.currency}` : ''}`);
        if (activity.notes) pdf.text(`  ${activity.notes}`);
      }
      for (const budget of day.budgets) pdf.text(`${budget.category}: ${budget.amount} ${budget.currency}`);
      pdf.moveDown();
    }
    if (itinerary.transportCosts.length) {
      pdf.fontSize(14).text('Transport');
      pdf.fontSize(10);
      for (const cost of itinerary.transportCosts) {
        pdf.text(`${cost.mode}: ${cost.fromCityId} to ${cost.toCityId} — ${cost.amount} ${cost.currency}`);
      }
    }
    pdf.end();
  });
}
