/**
 * @jest-environment node
 *
 * Parser accuracy tests for IndiaMART enquiry emails.
 *
 * Validates that IndiaMARTEmailService.parseIndiaMARTEmail correctly extracts,
 * from realistic IndiaMART enquiry email bodies:
 *   - buyer phone (10-digit Indian mobile)
 *   - buyer name
 *   - product / requirement
 *   - location (city)
 *
 * Uses the EXISTING parseIndiaMARTEmail method (no behaviour added for the test).
 */

import { IndiaMARTEmailService } from '../src/server/services/indiamart-email.service';

// Helper: run the parser against a plain-text body (text path).
function parse(body: string) {
  return IndiaMARTEmailService.parseIndiaMARTEmail('', body);
}

describe('IndiaMART parser — realistic enquiry formats', () => {
  // Fixture 1: Classic IndiaMART "Requirement Details" style template
  const fixtureRequirementDetails = `
IndiaMART Buyer Inquiry

Dear Seller,

New Requirement Details
Buyer Name: Rahul Sharma
Buyer Mobile: +91 98201 23456
Requirement Details: Need 50 units of industrial water pump with 2 HP motor.
City: Pune
State: Maharashtra

Product Name: Industrial Water Pump

Regards,
IndiaMART Team
  `.trim();

  it('extracts fields from a "Requirement Details" template', () => {
    const lead = parse(fixtureRequirementDetails);
    expect(lead).not.toBeNull();
    expect(lead!.phone).toBe('9820123456');
    expect(lead!.name).toMatch(/Rahul Sharma/);
    expect(lead!.product).toMatch(/Industrial Water Pump/i);
    expect(lead!.requirement).toMatch(/industrial water pump/i);
    expect(lead!.city).toMatch(/Pune/i);
  });

  // Fixture 2: "Query from <Name>" + labelled Buyer/Sender contact
  const fixtureQueryFrom = `
Query from Amit Patel

Buyer Details:
Name: Amit Patel
Sender contact: 919824112398
Email: amit.patel@example.com
Requirement for: Stainless steel pipes 304 grade

Location: Ahmedabad

Message: Please share quotation with best price and delivery time.
  `.trim();

  it('extracts fields from a "Query from <Name>" template', () => {
    const lead = parse(fixtureQueryFrom);
    expect(lead).not.toBeNull();
    expect(lead!.phone).toBe('9824112398');
    expect(lead!.name).toMatch(/Amit Patel/);
    expect(lead!.email).toMatch(/amit\.patel@example\.com/);
    expect(lead!.product).toMatch(/Stainless steel pipes/i);
    expect(lead!.requirement).toMatch(/quotation with best price/i);
    expect(lead!.city).toMatch(/Ahmedabad/i);
  });

  // Fixture 3: Compact "Product / Buyer Mobile" style with no greeting
  const fixtureCompact = `
New Lead from IndiaMART

Product: LED Panel Light 40W
Buyer Name: Sneha Nair
Buyer Mobile: 9845011223
City: Kochi
Requirement: Looking for 200 pieces for a commercial project.

Thank you,
IndiaMART
  `.trim();

  it('extracts fields from a compact Product/Buyer Mobile template', () => {
    const lead = parse(fixtureCompact);
    expect(lead).not.toBeNull();
    expect(lead!.phone).toBe('9845011223');
    expect(lead!.name).toMatch(/Sneha Nair/);
    expect(lead!.product).toMatch(/LED Panel Light/i);
    expect(lead!.requirement).toMatch(/commercial project/i);
    expect(lead!.city).toMatch(/Kochi/i);
  });

  // Fixture 4: No usable contact info -> parser returns null (no silent lead)
  const fixtureNoContact = `
IndiaMART Weekly Digest

We have some suggestions for your business growth.
Log in to your dashboard for more details.
  `.trim();

  it('returns null when there is no phone or email', () => {
    const lead = parse(fixtureNoContact);
    expect(lead).toBeNull();
  });
});
