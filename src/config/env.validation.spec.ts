import { envValidationSchema } from './env.validation.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4050',
  MONGODB_URI: 'mongodb://127.0.0.1:27018/ecom_cms_test',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
  REDIS_URL: 'redis://localhost:6379',
};

function validate(overrides: Record<string, unknown> = {}) {
  return envValidationSchema.validate(
    { ...validEnv, ...overrides },
    { abortEarly: false, allowUnknown: true },
  );
}

describe('envValidationSchema', () => {
  it('accepts a valid environment and converts the port to a number', () => {
    const { error, value } = validate();

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(4050);
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('rejects a missing MongoDB URI', () => {
    const { error } = validate({ MONGODB_URI: undefined });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a non-MongoDB URI', () => {
    const { error } = validate({ MONGODB_URI: 'http://localhost/ecom_cms' });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a MongoDB URI without a database name', () => {
    const { error } = validate({ MONGODB_URI: 'mongodb://127.0.0.1:27018' });

    expect(error?.message).toContain('MONGODB_URI');
  });

  it('rejects a short JWT secret', () => {
    const { error } = validate({ JWT_SECRET: 'too-short' });

    expect(error?.message).toContain('JWT_SECRET');
  });

  it('rejects an invalid port', () => {
    const { error } = validate({ PORT: 'not-a-port' });

    expect(error?.message).toContain('PORT');
  });
});
