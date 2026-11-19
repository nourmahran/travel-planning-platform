import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types, isValidObjectId } from 'mongoose';

type FavouriteType = 'hotel' | 'itinerary';

@Injectable()
export class FavouritesService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private parse(type: string, id: string): { type: FavouriteType; targetId: Types.ObjectId } {
    if (type !== 'hotel' && type !== 'itinerary') throw new BadRequestException('Invalid favourite type');
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid target ID');
    return { type, targetId: new Types.ObjectId(id) };
  }

  private async publicTarget(type: FavouriteType, targetId: Types.ObjectId) {
    if (type === 'hotel') {
      return this.connection.collection('hotels').findOne({
        _id: targetId,
        isActive: true,
      }, { projection: { name: 1, city: 1, country: 1 } });
    }
    return this.connection.collection('itineraries').findOne({
      _id: targetId,
      visibility: 'public',
      isHidden: { $ne: true },
    }, { projection: { title: 1, startDate: 1, endDate: 1 } });
  }

  async add(userId: string, typeInput: string, id: string) {
    const { type, targetId } = this.parse(typeInput, id);
    if (!(await this.publicTarget(type, targetId))) throw new NotFoundException('Favourite target not found');
    const collection = this.connection.collection('favourites');
    await collection.createIndex({ userId: 1, type: 1, targetId: 1 }, { unique: true });
    const filter = { userId: new Types.ObjectId(userId), type, targetId };
    await collection.updateOne(filter, { $setOnInsert: { ...filter, createdAt: new Date() } }, { upsert: true });
    return { type, targetId: id, saved: true };
  }

  async remove(userId: string, typeInput: string, id: string) {
    const { type, targetId } = this.parse(typeInput, id);
    await this.connection.collection('favourites').deleteOne({ userId: new Types.ObjectId(userId), type, targetId });
    return { type, targetId: id, saved: false };
  }

  async list(userId: string, page: number) {
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw new BadRequestException('Invalid page');
    const collection = this.connection.collection('favourites');
    const filter = { userId: new Types.ObjectId(userId) };
    const all = await collection.find(filter).sort({ createdAt: -1, _id: -1 }).toArray();
    const visible = (await Promise.all(all.map(async (item) => {
      const target = await this.publicTarget(item.type as FavouriteType, item.targetId as Types.ObjectId);
      return target ? { id: item._id, type: item.type, target, savedAt: item.createdAt } : null;
    }))).filter((item) => item !== null);
    return { items: visible.slice((page - 1) * 10, page * 10), page, limit: 10, total: visible.length, totalPages: Math.ceil(visible.length / 10) };
  }
}
