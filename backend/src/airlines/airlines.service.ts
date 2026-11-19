import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Airline } from './schemas/airline.schema';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import {
  BaggagePolicyDto,
  CancellationTierDto,
} from './dto/flight-policies.dto';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
  ) {}

  private validatePolicies(policies?: CreateAirlineDto['flightPolicies']) {
    if (!policies) return;
    const days = policies.cancellationTiers.map((tier) => tier.daysBefore);
    if (new Set(days).size !== days.length) {
      throw new BadRequestException(
        'Cancellation tiers need unique day thresholds',
      );
    }
  }

  async create(dto: CreateAirlineDto) {
    this.validatePolicies(dto.flightPolicies);
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
    // ACC-15: deactivated providers are hidden from public listings/search.
    return this.airlineModel
      .find({ isActive: true })
      .sort({ name: 1 })
      .exec();
  }

  async findOne(id: string) {
    const airline = await this.airlineModel.findById(id).exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    return airline;
  }

  async update(id: string, dto: UpdateAirlineDto) {
    this.validatePolicies(dto.flightPolicies);
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

  /** FLT-04 / FLT-08: replace the airline's baggage allowance rules. */
  async setBaggagePolicy(id: string, baggage: BaggagePolicyDto) {
    const airline = await this.findOne(id);
    if (!airline.flightPolicies) {
      throw new BadRequestException(
        'This airline has no flight policies yet; set the cancellation policy first',
      );
    }
    airline.flightPolicies.baggage = { ...baggage };
    airline.markModified('flightPolicies');
    return airline.save();
  }

  /**
   * FLT-09: replace the airline's cancellation tiers. When the airline has no
   * policies yet, baggage starts with no free or extra bags until the
   * moderator sets it with PUT /airlines/:id/baggage-policy.
   */
  async setCancellationPolicy(id: string, tiers: CancellationTierDto[]) {
    const days = tiers.map((tier) => tier.daysBefore);
    if (new Set(days).size !== days.length) {
      throw new BadRequestException(
        'Cancellation tiers need unique day thresholds',
      );
    }
    const airline = await this.findOne(id);
    airline.flightPolicies = {
      kind: 'flight',
      cancellationTiers: tiers.map((tier) => ({ ...tier })),
      baggage: airline.flightPolicies?.baggage ?? {
        freeBagsPerPassenger: 0,
        maxWeightKgPerBag: 0,
        extraBagPrice: 0,
        maxExtraBagsPerPassenger: 0,
      },
    };
    airline.markModified('flightPolicies');
    return airline.save();
  }

  async remove(id: string) {
    const airline = await this.airlineModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
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
