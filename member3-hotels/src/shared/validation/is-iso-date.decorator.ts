import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidISODateString } from '../utils/date.util';

/** Validates a real calendar date written as YYYY-MM-DD. */
export function IsIsoDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isIsoDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isValidISODateString(value);
        },
        defaultMessage(): string {
          return `${propertyName} must be a valid date in YYYY-MM-DD format.`;
        },
      },
    });
  };
}
