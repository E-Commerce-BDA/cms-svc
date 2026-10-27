import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4050),
  MONGODB_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\/.+\/.+/)
    .required()
    .messages({
      'any.required': 'MONGODB_URI is required',
      'string.pattern.base':
        'MONGODB_URI must start with mongodb:// or mongodb+srv:// and include a database name',
    }),
  JWT_SECRET: Joi.string().min(32).required(),
  REDIS_URL: Joi.string()
    .pattern(/^rediss?:\/\/.+/)
    .default('redis://localhost:6379'),
});
