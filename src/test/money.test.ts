import { formatCtsColumn, formatKshsColumn, formatMoney, formatUnitPrice, parseMoneyToCents, parsePercentToBasisPoints, parseQuantity } from '../domain/money';

describe('money', () => {
  it('formats KSh with cents', () => {
    expect(formatMoney(3_000_000)).toBe('KSh 30,000.00');
    expect(formatMoney(123_456_705)).toBe('KSh 1,234,567.05');
    expect(formatMoney(5)).toBe('KSh 0.05');
  });
  it('splits into KSHS. and CTS. columns', () => {
    expect(formatKshsColumn(3_000_050)).toBe('30,000');
    expect(formatCtsColumn(3_000_050)).toBe('.50');
    expect(formatCtsColumn(3_000_000)).toBe('.00');
  });
  it('formats unit prices', () => {
    expect(formatUnitPrice(120_000)).toBe('1,200');
    expect(formatUnitPrice(120_050)).toBe('1,200.50');
  });
  it('parses money without floating-point error', () => {
    expect(parseMoneyToCents('1,200')).toBe(120_000);
    expect(parseMoneyToCents('0.1')).toBe(10);
    expect(parseMoneyToCents('19.99')).toBe(1999);
    expect(parseMoneyToCents('KSh 2,250.5')).toBe(225_050);
    expect(parseMoneyToCents('12.345')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('-5')).toBeNull();
  });
  it('parses quantities and percentages', () => {
    expect(parseQuantity('12')).toBe(12);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('1.2345')).toBeNull();
    expect(parsePercentToBasisPoints('16')).toBe(1600);
    expect(parsePercentToBasisPoints('16.07')).toBe(1607);
    expect(parsePercentToBasisPoints('101')).toBeNull();
  });
});
