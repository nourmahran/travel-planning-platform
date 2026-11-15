import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiResponse } from '@nestjs/swagger';

/** Shape produced by the global HttpExceptionFilter. */
export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Booking is not awaiting payment' })
  message: string;

  @ApiProperty({ example: '2026-11-08T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/payments' })
  path: string;
}

/**
 * Documents error responses with example bodies in one line:
 *   @ApiErrors([404, 'Booking not found'], [409, 'Booking already paid'])
 * Several messages for the same status are merged into one description.
 */
export function ApiErrors(...errors: Array<[number, string]>) {
  const byStatus = new Map<number, string[]>();
  for (const [status, message] of errors) {
    byStatus.set(status, [...(byStatus.get(status) ?? []), message]);
  }
  return applyDecorators(
    ...[...byStatus.entries()].map(([status, messages]) =>
      ApiResponse({
        status,
        description: messages.join(' | '),
        type: ErrorResponseDto,
        example: {
          statusCode: status,
          message: messages[0],
          timestamp: '2026-11-08T10:00:00.000Z',
          path: '/api/...',
        },
      }),
    ),
  );
}

export const UNAUTHORIZED: [number, string] = [401, 'Not logged in'];
export const BAD_PARAMS: [number, string] = [
  400,
  'Validation failed (e.g. type must be "flight" or "hotel", id must be a valid id)',
];
export const NOT_WIRED: [number, string] = [503, 'Booking type not wired yet'];
