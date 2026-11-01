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
  // Media renditions are SQS tasks. Everything here has a working default or is
  // optional, so `pnpm test` and a LocalStack-less `pnpm start:dev` both boot:
  // `SQS_TASKS_ENABLED` defaults to off in development and on elsewhere, and
  // `AWS_ENDPOINT_URL` is only set when talking to LocalStack.
  SQS_TASKS_ENABLED: Joi.string()
    .valid('true', 'false')
    .when('NODE_ENV', {
      is: 'production',
      // In production the queue is the only path to a rendition, so it must be
      // on unless someone says otherwise on purpose.
      // oxlint-disable-next-line unicorn/no-thenable -- Joi's `then` branch.
      then: Joi.string().default('true'),
      otherwise: Joi.string().default('false'),
    }),
  AWS_REGION: Joi.string().default('us-east-1'),
  // `.empty('')` so the blank line a developer leaves in `.env` means "unset"
  // rather than "an endpoint of zero length".
  AWS_ENDPOINT_URL: Joi.string()
    .empty('')
    .pattern(/^https?:\/\/.+/)
    .optional()
    .messages({
      'string.pattern.base':
        'AWS_ENDPOINT_URL must be an http(s) URL such as http://localhost:4566',
    }),
  // Only needed for LocalStack, which accepts any value. Unset in production,
  // where the SDK falls back to its normal credential chain (task role, SSO…).
  AWS_ACCESS_KEY_ID: Joi.string().empty('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().empty('').optional(),
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
