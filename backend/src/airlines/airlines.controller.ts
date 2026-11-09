
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(
    private readonly airlinesService: AirlinesService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an airline' })
  create(@Body() dto: CreateAirlineDto) {
    return this.airlinesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List airlines' })
  findAll() {
    return this.airlinesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get airline details' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.airlinesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update airline details' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
  ) {
    return this.airlinesService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an airline' })
  deactivate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.airlinesService.remove(id);
  }
}
