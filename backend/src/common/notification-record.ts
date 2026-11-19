import { Types } from 'mongoose';

export function notificationRecord(input: {
  recipientId: string;
  eventId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  createdAt?: Date;
}) {
  if (!Types.ObjectId.isValid(input.recipientId))
    throw new Error('Notification recipient must be a user ObjectId');
  return {
    recipientId: new Types.ObjectId(input.recipientId),
    eventId: input.eventId,
    type: input.type,
    title: input.title,
    message: input.message,
    ...(input.link ? { link: input.link } : {}),
    createdAt: input.createdAt ?? new Date(),
    updatedAt: input.createdAt ?? new Date(),
  };
}
