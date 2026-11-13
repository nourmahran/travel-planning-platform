import { passengerCsv, ticketPdf } from './booking-exports';
describe('Booking documents', () => {
  it('escapes commas, quotes, newlines and spreadsheet formulas', () => {
    expect(passengerCsv([['=SUM(A1)', 'A,"B"', 'line\nbreak', ' +cmd']])).toBe(
      '\uFEFF"\'=SUM(A1)","A,""B""","line\nbreak","\' +cmd"\r\n',
    );
  });
  it('produces a complete multipage PDF for long passenger lists', async () => {
    const pdf = await ticketPdf(
      Array.from({ length: 100 }, (_, i) => 'Passenger ' + i),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBeGreaterThan(1);
  });
});
