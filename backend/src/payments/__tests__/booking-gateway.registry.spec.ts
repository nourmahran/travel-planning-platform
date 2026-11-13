import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BookingType } from '../../common/booking';
import { BookingGatewayRegistry } from '../gateway/booking-gateway.registry';
import { FakeBookingGateway } from './fake-booking.gateway';

describe('BookingGatewayRegistry', () => {
  let registry: BookingGatewayRegistry;

  beforeEach(() => {
    registry = new BookingGatewayRegistry();
  });

  it('returns a registered gateway', () => {
    const gw = new FakeBookingGateway(BookingType.Flight);
    registry.register(gw);
    expect(registry.get('flight')).toBe(gw);
    expect(registry.isRegistered(BookingType.Flight)).toBe(true);
  });

  it('throws 404 for an unknown type', () => {
    expect(() => registry.get('train')).toThrow(NotFoundException);
  });

  it('throws 503 when a valid type is not wired yet', () => {
    expect(() => registry.get('hotel')).toThrow(ServiceUnavailableException);
  });

  it('refuses to register an unknown type', () => {
    const gw = new FakeBookingGateway('bus' as BookingType);
    expect(() => registry.register(gw)).toThrow();
  });
});
