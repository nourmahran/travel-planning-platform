import {
  ArgumentMetadata,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  PipeTransform,
  ArgumentsHost,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';

@Injectable()
export class ObjectIdPipe implements PipeTransform {
  transform(value: string, metadata: ArgumentMetadata) {
    if (!/^[0-9a-fA-F]{24}$/.test(value)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [metadata.data ?? 'id']: ['Must be a valid MongoDB ID'] },
      });
    }
    return value.toLowerCase();
  }
}

export const ApiErrors = () =>
  applyDecorators(
    ApiBadRequestResponse({
      description: 'Invalid input; field messages are returned in errors',
    }),
    ApiUnauthorizedResponse({
      description:
        'Login required, invalid or expired session, or unavailable account',
    }),
    ApiForbiddenResponse({
      description: 'Ownership, role or CSRF check failed',
    }),
    ApiNotFoundResponse({
      description: 'Item does not exist or is not visible to this caller',
    }),
    ApiConflictResponse({
      description: 'Duplicate report or already-resolved report',
    }),
  );

@Catch()
export class CommunityExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const result = exception.getResponse();
      response.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        ...(typeof result === 'string' ? { message: result } : result),
      });
      return;
    }
    const error = exception as {
      code?: number;
      name?: string;
      errors?: Record<string, { message: string }>;
    };
    if (error.code === 11000) {
      response
        .status(409)
        .json({ statusCode: 409, message: 'This item already exists' });
    } else if (error.name === 'ValidationError') {
      response.status(400).json({
        statusCode: 400,
        message: 'Validation failed',
        errors: Object.fromEntries(
          Object.entries(error.errors ?? {}).map(([field, value]) => [
            field,
            [value.message],
          ]),
        ),
      });
    } else {
      console.error(exception);
      response.status(500).json({
        statusCode: 500,
        message: 'An unexpected server error occurred',
      });
    }
  }
}
