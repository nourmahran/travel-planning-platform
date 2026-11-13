import { Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';

import { User } from './schemas/user.schema';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  async register(registerDto: RegisterDto) {
    const email = registerDto.email.trim().toLowerCase();

    // Step 1: Check whether the email is already registered.
    const existingUser = await this.userModel.findOne({ email });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    // Step 2: Hash the password before saving it.
    const passwordHash = await bcrypt.hash(registerDto.password, 12);

    // Step 3: Create the new user in MongoDB.
    const user = await this.userModel.create({
      name: registerDto.name.trim(),
      email,
      passwordHash,
      role: 'user',
      acceptedTerms: registerDto.acceptedTerms,
      acceptedPrivacyPolicy: registerDto.acceptedPrivacyPolicy,
    });

    // Step 4: Return safe information (never return the password).
    return {
      message: 'Registration successful',
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
