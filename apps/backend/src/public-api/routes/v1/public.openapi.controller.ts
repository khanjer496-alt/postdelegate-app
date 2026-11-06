import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import publicApiOpenApi from '../../openapi/public.api.openapi.json';

// The OpenAPI document of the public API, for API directories and code
// generators. A static file kept in the repo (the marketing site serves the
// same copy at /openapi.json), so it never exposes the internal routes the
// Swagger UI lists. No API key needed.
@ApiTags('Public API')
@Controller('/public/v1')
export class PublicOpenApiController {
  @Get('/openapi.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=3600')
  getOpenApi() {
    return publicApiOpenApi;
  }
}
