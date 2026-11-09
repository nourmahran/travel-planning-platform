
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Airline } from './schemas/airline.schema';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
  ) {}

  async create(dto: CreateAirlineDto) {
    const existing = await this.airlineModel.findOne({
      code: dto.code,
    });

    if (existing) {
      throw new ConflictException('Airline code already exists');
    }

    try {
      return await this.airlineModel.create(dto);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Airline code already exists');
      }
      throw error;
    }
  }

  async findAll() {
    return this.airlineModel.find().sort({ name: 1 }).exec();
  }

  async findOne(id: string) {
    const airline = await this.airlineModel.findById(id).exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    return airline;
  }

  async update(id: string, dto: UpdateAirlineDto) {
    try {
      const airline = await this.airlineModel
        .findByIdAndUpdate(id, dto, {
          new: true,
          runValidators: true,
        })
        .exec();

      if (!airline) {
        throw new NotFoundException('Airline not found');
      }

      return airline;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('Airline code already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true },
      )
      .exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    return {
      message: 'Airline deactivated successfully',
      airline,
    };
  }
}
