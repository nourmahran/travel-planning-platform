import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Sandbox')
@Controller('api')
export class SandboxController {
  @Get('health')
  @ApiOperation({ summary: 'Sandbox health check' })
  @ApiOkResponse({ description: 'Service is up.' })
  health(): { status: string; module: string; time: string } {
    return { status: 'ok', module: 'hotels', time: new Date().toISOString() };
  }
}
