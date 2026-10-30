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
  // Optional in development (defaults to <cwd>/storage) so compose and the e2e
  // suites keep working; production must name an absolute directory, otherwise
  // the process would write wherever it was started from.
  STORAGE_LOCAL_DIR: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      // oxlint-disable-next-line unicorn/no-thenable -- Joi's `then` branch.
      then: Joi.string().required(),
      otherwise: Joi.string().optional(),
    })
    .messages({
      'any.required':
        'STORAGE_LOCAL_DIR is required in production and must be an absolute path',
    }),
});
