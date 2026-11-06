import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

// The Swagger UI lists every internal route (billing, admin and operator
// endpoints included), so it is only served when explicitly switched on
export const swaggerEnabled = () => process.env.ENABLE_SWAGGER === 'true';

export const loadSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('PostDelegate Swagger file')
    .setDescription('API description')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
};
