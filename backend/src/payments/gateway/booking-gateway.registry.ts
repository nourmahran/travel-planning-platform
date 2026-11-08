import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BookingType } from '../../common/booking';
import type { BookingGateway } from './booking-gateway.interface';

/**
 * Holds one BookingGateway per booking type.
 *
 * Booking modules register their gateway on startup, e.g. in Part 2:
 *
 *   constructor(registry: BookingGatewayRegistry, gw: FlightBookingGateway) {}
 *   onModuleInit() { this.registry.register(this.gw); }
 */
@Injectable()
export class BookingGatewayRegistry {
  private readonly logger = new Logger(BookingGatewayRegistry.name);
  private readonly gateways = new Map<BookingType, BookingGateway>();

  register(gateway: BookingGateway): void {
    if (!isBookingType(gateway.type)) {
      throw new Error(
        `Cannot register gateway for unknown type "${String(gateway.type)}"`,
      );
    }
    this.gateways.set(gateway.type, gateway);
    this.logger.log(`Booking gateway registered: ${gateway.type}`);
  }

  isRegistered(type: BookingType): boolean {
    return this.gateways.has(type);
  }

  /**
   * 404 for an unknown type; 503 when the type is valid but its booking module
   * has not registered a gateway yet (expected until Part 2 is merged).
   */
  get(type: string): BookingGateway {
    if (!isBookingType(type)) {
      throw new NotFoundException('Unsupported booking type');
    }
    const gateway = this.gateways.get(type);
    if (!gateway) {
      throw new ServiceUnavailableException('Booking type not wired yet');
    }
    return gateway;
  }
}

export function isBookingType(value: unknown): value is BookingType {
  return (Object.values(BookingType) as unknown[]).includes(value);
}
